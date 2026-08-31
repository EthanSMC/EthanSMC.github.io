(function initializeReadingNavigation(globalObject) {
  function slugifyHeading(text) {
    const slug = String(text || "")
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("zh-CN")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "section";
  }

  function assignHeadingIds(headings) {
    const items = Array.from(headings || []);
    const used = new Set();

    items.filter((heading) => String(heading.id || "").trim()).forEach((heading) => {
      const base = String(heading.id).trim();
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) candidate = `${base}-${suffix++}`;
      heading.id = candidate;
      used.add(candidate);
    });

    items.filter((heading) => !String(heading.id || "").trim()).forEach((heading) => {
      const base = slugifyHeading(heading.textContent);
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) candidate = `${base}-${suffix++}`;
      heading.id = candidate;
      used.add(candidate);
    });

    return items;
  }

  function shouldEnableContents({ headingCount = 0, readingMinutes = 0 } = {}) {
    return Number(headingCount) >= 3 || Number(readingMinutes) >= 5;
  }

  function calculateReadingProgress({
    scrollY = 0,
    bodyStart = 0,
    bodyEnd = 0,
    viewportHeight = 0,
    toolbarOffset = 0,
  } = {}) {
    const values = [scrollY, bodyStart, bodyEnd, viewportHeight, toolbarOffset].map(Number);
    if (values.some((value) => !Number.isFinite(value))) return 0;
    const [currentScroll, startY, endY, viewHeight, offset] = values;
    const journeyStart = startY - offset;
    const journeyEnd = endY - viewHeight;
    if (journeyEnd <= journeyStart) return currentScroll >= journeyStart ? 1 : 0;
    return Math.max(0, Math.min(1, (currentScroll - journeyStart) / (journeyEnd - journeyStart)));
  }

  function createReaderNavigation(root, view = globalObject) {
    if (!root) return null;
    const documentObject = root.ownerDocument || view?.document;
    const body = root.querySelector(".post-body");
    const toolbar = root.querySelector("[data-reader-toolbar]");
    const currentLabel = root.querySelector("[data-reader-current]");
    const percentLabel = root.querySelector("[data-reader-percent]");
    const progressBar = root.querySelector("[data-reader-progress]");
    const toc = root.querySelector("[data-reader-toc]");
    const tocLists = Array.from(root.querySelectorAll("[data-reader-toc-list]"));
    const openButton = root.querySelector("[data-reader-open]");
    const closeButton = root.querySelector("[data-reader-close]");
    const dialog = root.querySelector("[data-reader-dialog]");
    if (!body || !toolbar || !documentObject) return null;

    const headings = assignHeadingIds(body.querySelectorAll("h2, h3"));
    const readingMinutes = Number(root.dataset.readerMinutes || 0);
    const postTitle = root.dataset.postTitle || currentLabel?.textContent?.trim() || "";
    const hasContents = headings.length > 0 && shouldEnableContents({
      headingCount: headings.length,
      readingMinutes,
    });
    const translateAuthored = (source) => view?.siteI18n?.translateAuthored?.(source) || source;
    const translate = (key) => view?.siteI18n?.t?.(key) || key;
    const requestFrame = view?.requestAnimationFrame?.bind(view) || ((callback) => setTimeout(callback, 16));
    const cancelFrame = view?.cancelAnimationFrame?.bind(view) || clearTimeout;
    const linksByHeading = new Map();
    let activeHeading = null;
    let scheduledFrame = null;
    let observer = null;
    let closeTimer = null;

    const sourceForHeading = (heading) => {
      heading.dataset.readerHeadingSource ||= heading.textContent.trim();
      return heading.dataset.readerHeadingSource;
    };

    const setCurrentLabel = (source) => {
      if (!currentLabel) return;
      currentLabel.dataset.i18nAuthored = source;
      currentLabel.dataset.i18nAuthoredSource = source;
      currentLabel.textContent = translateAuthored(source);
    };

    const setActiveHeading = (heading) => {
      if (activeHeading === heading) return;
      activeHeading = heading || null;
      linksByHeading.forEach((links, item) => {
        links.forEach((link) => {
          if (item === activeHeading) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      });
      setCurrentLabel(activeHeading ? sourceForHeading(activeHeading) : postTitle);
    };

    const toolbarOffset = () => {
      const header = documentObject.querySelector(".site-header");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      return headerBottom + toolbar.getBoundingClientRect().height;
    };

    const updateActiveHeading = () => {
      if (!headings.length) {
        setActiveHeading(null);
        return;
      }
      const threshold = toolbarOffset() + 28;
      let nextHeading = null;
      headings.forEach((heading) => {
        if (heading.getBoundingClientRect().top <= threshold) nextHeading = heading;
      });
      setActiveHeading(nextHeading);
    };

    const updateProgress = () => {
      const scrollY = Number(view?.scrollY ?? view?.pageYOffset ?? 0);
      const bodyBounds = body.getBoundingClientRect();
      const progress = calculateReadingProgress({
        scrollY,
        bodyStart: bodyBounds.top + scrollY,
        bodyEnd: bodyBounds.bottom + scrollY,
        viewportHeight: Number(view?.innerHeight || documentObject.documentElement?.clientHeight || 0),
        toolbarOffset: toolbarOffset(),
      });
      const percentage = Math.round(progress * 100);
      root.style.setProperty("--reader-progress", String(progress));
      if (progressBar) progressBar.style.transform = `scaleX(${progress})`;
      if (percentLabel) {
        percentLabel.textContent = `${percentage}%`;
        percentLabel.setAttribute("aria-label", `${translate("blog.reader.progress")}: ${percentage}%`);
      }
    };

    const refresh = () => {
      updateProgress();
      updateActiveHeading();
    };

    const scheduleRefresh = () => {
      if (scheduledFrame !== null) return;
      scheduledFrame = requestFrame(() => {
        scheduledFrame = null;
        refresh();
      });
    };

    const populateToc = () => {
      if (!hasContents) return;
      tocLists.forEach((list) => {
        const fragment = documentObject.createDocumentFragment();
        headings.forEach((heading) => {
          const item = documentObject.createElement("li");
          const link = documentObject.createElement("a");
          const source = sourceForHeading(heading);
          item.dataset.readerLevel = heading.tagName.toLocaleLowerCase();
          link.href = `#${heading.id}`;
          link.dataset.readerTarget = heading.id;
          link.dataset.i18nAuthored = source;
          link.dataset.i18nAuthoredSource = source;
          link.textContent = translateAuthored(source);
          item.append(link);
          fragment.append(item);
          if (!linksByHeading.has(heading)) linksByHeading.set(heading, []);
          linksByHeading.get(heading).push(link);
        });
        list.replaceChildren(fragment);
      });
    };

    const openContents = () => {
      if (!dialog || !hasContents) return;
      if (dialog.hasAttribute("open")) return;
      if (closeTimer !== null) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      openButton?.setAttribute("aria-expanded", "true");
      requestFrame(() => {
        dialog.classList.add("is-open");
        const activeLink = Array.from(dialog.querySelectorAll("a")).find(
          (link) => link.getAttribute("aria-current") === "location",
        );
        (activeLink || dialog.querySelector("a") || closeButton)?.focus();
      });
    };

    const closeContents = ({ restoreFocus = false, immediate = false } = {}) => {
      if (!dialog?.hasAttribute("open")) return;
      dialog.classList.remove("is-open");
      openButton?.setAttribute("aria-expanded", "false");
      const finish = () => {
        closeTimer = null;
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
        if (restoreFocus) openButton?.focus({ preventScroll: true });
      };
      if (immediate || view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) finish();
      else closeTimer = setTimeout(finish, 240);
    };

    populateToc();
    root.classList.add("reader-enhanced");
    if (hasContents) {
      root.classList.add("reader-has-contents");
      toc?.removeAttribute("hidden");
      openButton?.removeAttribute("hidden");
    }

    openButton?.addEventListener("click", openContents);
    closeButton?.addEventListener("click", () => closeContents({ restoreFocus: true }));
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) closeContents({ restoreFocus: true });
    });
    dialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeContents({ restoreFocus: true });
    });
    dialog?.addEventListener("close", () => {
      dialog.classList.remove("is-open");
      openButton?.setAttribute("aria-expanded", "false");
    });
    dialog?.querySelectorAll("[data-reader-toc-list] a").forEach((link) => {
      link.addEventListener("click", () => closeContents({ immediate: true }));
    });

    view?.addEventListener?.("scroll", scheduleRefresh, { passive: true });
    view?.addEventListener?.("resize", scheduleRefresh);
    view?.addEventListener?.("hashchange", scheduleRefresh);
    if (typeof view?.IntersectionObserver === "function" && headings.length) {
      observer = new view.IntersectionObserver(scheduleRefresh, {
        rootMargin: `-${Math.round(toolbarOffset())}px 0px -65% 0px`,
      });
      headings.forEach((heading) => observer.observe(heading));
    }
    const unsubscribeLocale = view?.siteI18n?.onChange?.(() => {
      linksByHeading.forEach((links, heading) => {
        const source = sourceForHeading(heading);
        links.forEach((link) => { link.textContent = translateAuthored(source); });
      });
      setCurrentLabel(activeHeading ? sourceForHeading(activeHeading) : postTitle);
      updateProgress();
    });
    refresh();

    return Object.freeze({
      closeContents,
      openContents,
      refresh,
      destroy() {
        if (scheduledFrame !== null) cancelFrame(scheduledFrame);
        if (closeTimer !== null) clearTimeout(closeTimer);
        observer?.disconnect();
        unsubscribeLocale?.();
        view?.removeEventListener?.("scroll", scheduleRefresh);
        view?.removeEventListener?.("resize", scheduleRefresh);
        view?.removeEventListener?.("hashchange", scheduleRefresh);
      },
    });
  }

  if (typeof document !== "undefined") {
    document.querySelectorAll("[data-reader]").forEach((root) => createReaderNavigation(root));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      assignHeadingIds,
      calculateReadingProgress,
      createReaderNavigation,
      shouldEnableContents,
      slugifyHeading,
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
