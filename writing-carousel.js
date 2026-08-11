(function initializeAlbumCarousels(globalObject) {
  const SWIPE_THRESHOLD = 48;

  function createAlbumCarousel(root) {
    if (!root) return null;

    const slides = Array.from(root.querySelectorAll("[data-album-slide]"));
    const previousButton = root.querySelector("[data-album-prev]");
    const nextButton = root.querySelector("[data-album-next]");
    const status = root.querySelector("[data-album-status]");
    const view = root.ownerDocument?.defaultView || globalObject;
    let selectedIndex = Math.max(0, slides.findIndex((slide) => slide.getAttribute("aria-current") === "true"));
    let pointerStart = null;

    const statusText = () => {
      if (!slides.length) return "0 / 0";
      const title = slides[selectedIndex].getAttribute("data-album-title") || "";
      return view?.siteI18n?.t?.("writing.albumStatus", {
        current: selectedIndex + 1,
        total: slides.length,
        title,
      }) || `${selectedIndex + 1} / ${slides.length} · ${title}`;
    };

    const updateUrl = () => {
      const slug = slides[selectedIndex]?.getAttribute("data-album-slide");
      if (!slug || !view?.location?.href || !view?.history?.replaceState) return;
      const url = new URL(view.location.href);
      url.searchParams.set("album", slug);
      view.history.replaceState(view.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    };

    const select = (index, { focus = false, writeUrl = true } = {}) => {
      if (!slides.length) return;
      selectedIndex = Math.max(0, Math.min(index, slides.length - 1));
      slides.forEach((slide, slideIndex) => {
        const selected = slideIndex === selectedIndex;
        const offset = slideIndex - selectedIndex;
        slide.setAttribute("aria-current", String(selected));
        slide.tabIndex = selected ? 0 : -1;
        slide.style.setProperty("--album-offset", offset);
        slide.style.setProperty("--album-depth", Math.abs(offset));
      });
      if (previousButton) previousButton.disabled = selectedIndex === 0 || slides.length < 2;
      if (nextButton) nextButton.disabled = selectedIndex === slides.length - 1 || slides.length < 2;
      if (status) status.textContent = statusText();
      if (focus) slides[selectedIndex].focus({ preventScroll: true });
      if (writeUrl) updateUrl();
    };

    const queryAlbum = (() => {
      if (!view?.location?.href) return "";
      try {
        return new URL(view.location.href).searchParams.get("album") || "";
      } catch {
        return "";
      }
    })();
    const queryIndex = slides.findIndex((slide) => slide.getAttribute("data-album-slide") === queryAlbum);
    if (queryIndex >= 0) selectedIndex = queryIndex;
    select(selectedIndex, { writeUrl: false });

    const onCarouselKeydown = (event) => {
      const destinations = {
        ArrowLeft: selectedIndex - 1,
        ArrowRight: selectedIndex + 1,
        Home: 0,
        End: slides.length - 1,
      };
      if (!Object.hasOwn(destinations, event.key) || !slides.length) return;
      event.preventDefault();
      select(destinations[event.key], { focus: true });
    };

    const onCarouselPointerDown = (event) => {
      if (event.button !== 0) return;
      pointerStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      root.setPointerCapture?.(event.pointerId);
    };

    const onCarouselPointerUp = (event) => {
      if (!pointerStart || event.pointerId !== pointerStart.id) return;
      const deltaX = event.clientX - pointerStart.x;
      const deltaY = event.clientY - pointerStart.y;
      pointerStart = null;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      select(selectedIndex + (deltaX < 0 ? 1 : -1));
    };

    root.addEventListener("keydown", onCarouselKeydown);
    root.addEventListener("pointerdown", onCarouselPointerDown);
    root.addEventListener("pointerup", onCarouselPointerUp);
    root.addEventListener("pointercancel", () => { pointerStart = null; });
    previousButton?.addEventListener("click", () => select(selectedIndex - 1));
    nextButton?.addEventListener("click", () => select(selectedIndex + 1));
    slides.forEach((slide, index) => {
      slide.addEventListener("click", (event) => {
        if (event.target?.closest?.("a")) return;
        select(index, { focus: true });
      });
    });
    view?.siteI18n?.onChange?.(() => {
      if (status) status.textContent = statusText();
    });

    return Object.freeze({ select });
  }

  if (typeof document !== "undefined") {
    document.querySelectorAll("[data-album-carousel]").forEach((root) => createAlbumCarousel(root));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createAlbumCarousel };
  }
})(typeof window !== "undefined" ? window : globalThis);
