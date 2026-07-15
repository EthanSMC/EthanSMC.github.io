import * as THREE from "./assets/vendor/three/three.module.min.js";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const reducedMotion = window.matchMedia(reducedMotionQuery);

const listenForReducedMotion = (listener) => {
  let mediaQuery;
  let removed = false;

  const bind = () => {
    if (removed) return;
    mediaQuery = window.matchMedia(reducedMotionQuery);
    mediaQuery.addEventListener("change", listener);
    listener({ matches: mediaQuery.matches });
  };

  if (document.readyState === "complete") {
    bind();
  } else {
    window.addEventListener("load", bind, { once: true });
  }

  return () => {
    removed = true;
    window.removeEventListener("load", bind);
    mediaQuery?.removeEventListener("change", listener);
  };
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const mix = (from, to, progress) => from + (to - from) * progress;
const smoothstep = (start, end, value) => {
  const x = clamp((value - start) / (end - start));
  return x * x * (3 - 2 * x);
};

const createIntroController = (stage, sequence) => {
  const state = { progress: 0, target: 0 };
  let frameId = 0;
  let destroyed = false;

  const applyProgress = () => {
    const progress = state.progress;
    const heroProgress = smoothstep(0.16, 0.36, progress);

    stage.style.setProperty("--hero-opacity", (1 - heroProgress).toFixed(3));
    stage.style.setProperty("--hero-y", `${mix(0, -64, heroProgress).toFixed(1)}px`);
    stage.style.setProperty("--intro-primary", smoothstep(0.42, 0.56, progress).toFixed(3));
    stage.style.setProperty("--intro-secondary", smoothstep(0.68, 0.8, progress).toFixed(3));
    stage.dataset.phase = progress < 0.25 ? "hero" : progress < 0.45 ? "recenter" : progress < 0.72 ? "intro" : "domain";
  };

  const measure = () => {
    const bounds = sequence.getBoundingClientRect();
    const range = Math.max(sequence.offsetHeight - window.innerHeight, 1);
    state.target = clamp(-bounds.top / range);

    if (reducedMotion.matches) {
      state.progress = state.target;
      applyProgress();
    }
  };

  const render = () => {
    frameId = 0;
    if (destroyed || reducedMotion.matches) return;

    state.progress += (state.target - state.progress) * 0.12;
    applyProgress();
    frameId = requestAnimationFrame(render);
  };

  const stop = () => {
    if (!frameId) return;
    cancelAnimationFrame(frameId);
    frameId = 0;
  };

  const start = () => {
    if (destroyed || reducedMotion.matches || frameId) return;
    frameId = requestAnimationFrame(render);
  };

  const handleMotionChange = (event) => {
    measure();

    if (event.matches) {
      stop();
      state.progress = state.target;
      applyProgress();
      return;
    }

    start();
  };

  measure();
  applyProgress();
  window.addEventListener("scroll", measure, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);
  const removeMotionListener = listenForReducedMotion(handleMotionChange);
  start();

  return {
    state,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      removeMotionListener();
    },
  };
};

const header = document.querySelector("[data-header]");
const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const setActiveLink = (id) => {
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
  });
};

const setHeaderState = () => {
  header?.classList.toggle("scrolled", window.scrollY > 20);
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

const ABOUT_NAV_PROGRESS = 0.82;
const getHeaderOffset = () => (window.innerWidth <= 900 ? 82 : 96);
const bodyPaddingBottom = Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
let anchorBottomSpace = 0;

const updateActiveLink = () => {
  const marker = window.scrollY + getHeaderOffset() + 1;
  let activeSection = sections[0];

  sections.forEach((section) => {
    if (section.offsetTop <= marker) {
      activeSection = section;
    }
  });

  if (activeSection) {
    setActiveLink(activeSection.id);
  }
};

updateActiveLink();
window.addEventListener("scroll", updateActiveLink, { passive: true });
window.addEventListener("resize", updateActiveLink);

const getAnchorTop = (hash, target) => {
  if (hash === "#top") return 0;

  if (target.matches("[data-intro]")) {
    if (reducedMotion.matches) {
      const callouts = target.querySelector(".intro-callouts");
      if (callouts) {
        const firstCallout = callouts.querySelector("[data-intro-callout]") || callouts;
        return Math.max(
          0,
          firstCallout.getBoundingClientRect().top + window.scrollY - getHeaderOffset(),
        );
      }
    }

    const range = Math.max(target.offsetHeight - window.innerHeight, 1);
    return target.offsetTop + range * ABOUT_NAV_PROGRESS;
  }

  const scrollTarget = target.querySelector("h1, h2") || target;
  return Math.max(
    0,
    scrollTarget.getBoundingClientRect().top + window.scrollY - getHeaderOffset(),
  );
};

const makeAnchorRoom = (top) => {
  const maximumTop = document.documentElement.scrollHeight - window.innerHeight;
  const requiredSpace = Math.max(0, Math.ceil(top - maximumTop));

  if (requiredSpace === anchorBottomSpace) return;

  anchorBottomSpace = requiredSpace;
  document.body.style.paddingBottom = `${bodyPaddingBottom + anchorBottomSpace}px`;
};

const scrollToSection = (hash, { updateHash = true, behavior } = {}) => {
  let target;

  try {
    target = document.querySelector(hash);
  } catch {
    return;
  }

  if (!target) return;

  const top = getAnchorTop(hash, target);

  makeAnchorRoom(top);
  window.scrollTo({
    top,
    behavior: behavior || (reducedMotion.matches ? "auto" : "smooth"),
  });

  if (updateHash && window.location.hash !== hash) {
    history.pushState(null, "", hash);
  }
};

document.querySelectorAll("a[href^='#']").forEach((link) => {
  link.addEventListener("click", (event) => {
    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;

    event.preventDefault();
    scrollToSection(hash);

    if (link.matches(".skip-link")) {
      document.querySelector("#top")?.focus({ preventScroll: true });
    }
  });
});

window.addEventListener("popstate", () => {
  if (window.location.hash) {
    scrollToSection(window.location.hash, { updateHash: false });
  }
});

window.addEventListener("hashchange", () => {
  if (window.location.hash) {
    scrollToSection(window.location.hash, { updateHash: false });
  }
});

if (window.location.hash) {
  requestAnimationFrame(() => scrollToSection(window.location.hash, { updateHash: false, behavior: "auto" }));
}

const introStage = document.querySelector("[data-intro-stage]");
const introSequence = document.querySelector("[data-intro]");
const originalDocumentOverflowX = document.documentElement.style.overflowX;

// Chromium does not keep this sticky stage pinned while the root clips horizontally.
if (introStage) {
  document.documentElement.style.overflowX = "visible";
}

const introController = introStage && introSequence
  ? createIntroController(introStage, introSequence)
  : null;

const projectCards = Array.from(document.querySelectorAll("[data-project-card]"));
const projectPrev = document.querySelector("[data-project-prev]");
const projectNext = document.querySelector("[data-project-next]");
let activeProject = projectCards.findIndex((card) => card.classList.contains("active"));

if (activeProject < 0) {
  activeProject = 0;
}

const setActiveProject = (index) => {
  activeProject = (index + projectCards.length) % projectCards.length;
  projectCards.forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === activeProject);
  });
};

projectPrev?.addEventListener("click", () => setActiveProject(activeProject - 1));
projectNext?.addEventListener("click", () => setActiveProject(activeProject + 1));

projectCards.forEach((card, index) => {
  card.addEventListener("click", () => setActiveProject(index));
});

const initContributionHeatmap = (root) => {
  if (!root) return;
  const grid = root.querySelector("[data-contribution-grid]");
  const total = root.querySelector("[data-contribution-total]");
  const status = root.querySelector("[data-contribution-status]");
  const tooltip = root.querySelector("[data-contribution-tooltip]");
  if (!grid || !total || !status || !tooltip) return;

  const renderSkeleton = () => {
    grid.replaceChildren();
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const row = document.createElement("div");
      row.className = "contribution-row";
      row.dataset.weekdayRow = String(weekday);
      row.setAttribute("role", "row");
      for (let weekIndex = 0; weekIndex < 53; weekIndex += 1) {
        const cell = document.createElement("span");
        cell.className = "contribution-placeholder";
        cell.setAttribute("aria-hidden", "true");
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
  };

  const isIsoDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const isValidDay = (day) => day
    && isIsoDate(day.date)
    && Number.isInteger(day.count)
    && day.count >= 0
    && Number.isInteger(day.level)
    && day.level >= 0
    && day.level <= 4;
  const normalizePayload = (payload) => {
    const isValid = payload
      && payload.username === "EthanSMC"
      && isIsoDate(payload.from)
      && isIsoDate(payload.to)
      && Number.isInteger(payload.total)
      && payload.total >= 0
      && Array.isArray(payload.weeks)
      && [52, 53].includes(payload.weeks.length)
      && payload.weeks.every((week) => week
        && !Array.isArray(week)
        && Array.isArray(week.days)
        && week.days.length <= 7
        && week.days.every(isValidDay));
    if (!isValid) return null;

    const weeks = payload.weeks.slice();
    if (weeks.length === 52) weeks.unshift({ days: [] });
    return { ...payload, weeks };
  };

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  const showTooltip = (day, button) => {
    tooltip.textContent = `${day.date} · ${day.count} ${day.count === 1 ? "contribution" : "contributions"}`;
    tooltip.hidden = false;
    const wrapBounds = grid.parentElement.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    const proposedLeft = buttonBounds.left - wrapBounds.left
      + buttonBounds.width / 2
      - tooltip.offsetWidth / 2;
    const proposedTop = buttonBounds.top - wrapBounds.top - tooltip.offsetHeight - 8;
    const maximumLeft = Math.max(4, wrapBounds.width - tooltip.offsetWidth - 4);
    tooltip.style.left = `${clamp(proposedLeft, 4, maximumLeft)}px`;
    tooltip.style.top = `${Math.max(4, proposedTop)}px`;
  };

  const setRovingTabStop = (button) => {
    grid.querySelectorAll("[data-contribution-day]").forEach((dayButton) => {
      dayButton.tabIndex = dayButton === button ? 0 : -1;
    });
  };

  const focusNeighbor = (button, weekDelta, weekdayDelta) => {
    const weekIndex = Number(button.dataset.weekIndex) + weekDelta;
    const weekday = Number(button.dataset.weekday) + weekdayDelta;
    const next = grid.querySelector(
      `[data-contribution-day][data-week-index="${weekIndex}"][data-weekday="${weekday}"]`,
    );
    if (next) {
      setRovingTabStop(next);
      next.focus();
    }
  };

  const renderCalendar = (payload) => {
    grid.replaceChildren();
    const daysByWeek = payload.weeks.map((week) => new Map(week.days.map((day) => [
      new Date(`${day.date}T00:00:00Z`).getUTCDay(),
      day,
    ])));
    const initialWeekIndex = daysByWeek.findIndex((days) => days.size > 0);
    const initialWeekday = initialWeekIndex >= 0
      ? Math.min(...daysByWeek[initialWeekIndex].keys())
      : -1;
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const row = document.createElement("div");
      row.className = "contribution-row";
      row.dataset.weekdayRow = String(weekday);
      row.setAttribute("role", "row");
      daysByWeek.forEach((daysByWeekday, weekIndex) => {
        const day = daysByWeekday.get(weekday);
        if (!day) {
          const placeholder = document.createElement("span");
          placeholder.className = "contribution-placeholder";
          placeholder.setAttribute("aria-hidden", "true");
          row.appendChild(placeholder);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "contribution-day";
        button.dataset.contributionDay = "";
        button.dataset.weekIndex = String(weekIndex);
        button.dataset.weekday = String(weekday);
        button.dataset.level = String(day.level);
        button.tabIndex = weekIndex === initialWeekIndex && weekday === initialWeekday ? 0 : -1;
        button.setAttribute("role", "gridcell");
        button.setAttribute(
          "aria-label",
          `${day.date}: ${day.count} ${day.count === 1 ? "contribution" : "contributions"}`,
        );
        button.addEventListener("pointerenter", () => showTooltip(day, button));
        button.addEventListener("pointerleave", hideTooltip);
        button.addEventListener("focus", () => {
          setRovingTabStop(button);
          showTooltip(day, button);
        });
        button.addEventListener("blur", hideTooltip);
        button.addEventListener("click", () => showTooltip(day, button));
        button.addEventListener("keydown", (event) => {
          const moves = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          const move = moves[event.key];
          if (!move) return;
          event.preventDefault();
          focusNeighbor(button, move[0], move[1]);
        });
        row.appendChild(button);
      });
      grid.appendChild(row);
    }
    total.textContent = `${payload.total.toLocaleString("en-US")} contributions`;
    grid.setAttribute("aria-label", `${payload.username} GitHub contributions from ${payload.from} to ${payload.to}: ${payload.total} total`);
    grid.setAttribute("aria-busy", "false");
    root.dataset.state = "ready";
  };

  const renderUnavailable = () => {
    root.dataset.state = "unavailable";
    grid.setAttribute("aria-busy", "false");
    total.textContent = "GitHub activity";
    status.textContent = "Contribution data is temporarily unavailable";
  };

  const profileLink = root.querySelector('a[href="https://github.com/EthanSMC"]');
  root.addEventListener("click", (event) => {
    if (!profileLink || event.target.closest("a, [data-contribution-day]")) return;
    profileLink.click();
  });

  renderSkeleton();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  const contributionEndpoint = location.protocol === "file:"
    || location.hostname === "ethansmc.github.io"
    ? "https://ethansmc-personal-page.vercel.app/api/github-contributions"
    : "/api/github-contributions";
  fetch(contributionEndpoint, {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error("Contribution request failed");
      return response.json();
    })
    .then((payload) => {
      const normalizedPayload = normalizePayload(payload);
      if (!normalizedPayload) throw new Error("Invalid contribution payload");
      renderCalendar(normalizedPayload);
    })
    .catch(renderUnavailable)
    .finally(() => window.clearTimeout(timeoutId));
};

initContributionHeatmap(document.querySelector("[data-contributions]"));

const wechatDialog = document.querySelector("#wechat-dialog");
const wechatOpen = document.querySelector("[data-wechat-open]");
const wechatClose = document.querySelector("[data-wechat-close]");

const closeWechatDialog = () => {
  if (!wechatDialog?.open) return;
  wechatDialog.close();
};

wechatOpen?.addEventListener("click", () => {
  if (!wechatDialog || wechatDialog.open) return;

  if (typeof wechatDialog.showModal === "function") {
    wechatDialog.showModal();
  } else {
    wechatDialog.setAttribute("open", "");
  }
});

wechatClose?.addEventListener("click", closeWechatDialog);

wechatDialog?.addEventListener("click", (event) => {
  if (event.target === wechatDialog) {
    closeWechatDialog();
  }
});

const soundToggle = document.querySelector(".sound-toggle");
let audioContext;

const playUiTone = (frequency = 420, duration = 0.045, volume = 0.018) => {
  if (soundToggle?.getAttribute("aria-pressed") !== "true") return;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
};

soundToggle?.addEventListener("click", () => {
  const enabled = soundToggle.getAttribute("aria-pressed") === "true";

  if (enabled) {
    playUiTone(280, 0.055, 0.018);
  }

  soundToggle.setAttribute("aria-pressed", String(!enabled));
  soundToggle.setAttribute("aria-label", enabled ? "Enable sounds" : "Disable sounds");

  if (!enabled) {
    playUiTone(520, 0.07, 0.024);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("a, button") && !event.target.closest(".sound-toggle")) {
    playUiTone(360, 0.035, 0.012);
  }
});

const initThreeScene = (stage, controller) => {
  const canvas = document.querySelector("#ethan-three");
  if (!canvas || !stage || !controller) return () => {};

  const contextOptions = {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  };
  const context = canvas.getContext("webgl2", contextOptions)
    || canvas.getContext("webgl", contextOptions)
    || canvas.getContext("experimental-webgl", contextOptions);

  if (!context) return () => {};

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      ...contextOptions,
    });
  } catch {
    return () => {};
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const pointer = { x: 0, y: 0 };
  const targetPointer = { x: 0, y: 0 };
  const loader = new THREE.TextureLoader();
  let frameId = 0;
  let destroyed = false;
  let ready = false;
  let contextLost = false;
  let pointerListening = false;
  let renderScene = () => {};

  const resizeRenderer = () => {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const pixelRatio = renderer.getPixelRatio();
    const needsResize = canvas.width !== Math.floor(width * pixelRatio)
      || canvas.height !== Math.floor(height * pixelRatio);

    if (needsResize) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  };

  const handlePointerMove = (event) => {
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    targetPointer.x = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
    targetPointer.y = clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1);
  };

  const handlePointerLeave = () => {
    targetPointer.x = 0;
    targetPointer.y = 0;
  };

  const enablePointer = () => {
    if (pointerListening) return;
    pointerListening = true;
    stage.addEventListener("pointermove", handlePointerMove);
    stage.addEventListener("pointerleave", handlePointerLeave);
  };

  const disablePointer = () => {
    if (pointerListening) {
      pointerListening = false;
      stage.removeEventListener("pointermove", handlePointerMove);
      stage.removeEventListener("pointerleave", handlePointerLeave);
    }

    pointer.x = 0;
    pointer.y = 0;
    targetPointer.x = 0;
    targetPointer.y = 0;
  };

  const stopAnimation = () => {
    if (!frameId) return;
    cancelAnimationFrame(frameId);
    frameId = 0;
  };

  const animate = (time) => {
    frameId = 0;
    if (destroyed || contextLost || reducedMotion.matches || !ready) return;

    renderScene(time);
    frameId = requestAnimationFrame(animate);
  };

  const startAnimation = () => {
    if (destroyed || contextLost || reducedMotion.matches || !ready || frameId) return;
    frameId = requestAnimationFrame(animate);
  };

  const handleResize = () => {
    if (!ready || destroyed || contextLost) return;
    resizeRenderer();
    if (reducedMotion.matches) renderScene(0, true);
  };

  const handleMotionChange = (event) => {
    if (destroyed) return;

    stopAnimation();
    disablePointer();

    if (event.matches) {
      stage.classList.remove("three-ready");
      if (ready && !contextLost) {
        resizeRenderer();
        renderScene(0, true);
      }
      return;
    }

    if (!ready || contextLost) return;
    stage.classList.add("three-ready");
    enablePointer();
    startAnimation();
  };

  const handleContextLost = (event) => {
    event.preventDefault();
    contextLost = true;
    stopAnimation();
    disablePointer();
    stage.classList.remove("three-ready");
  };

  const disposeScene = () => {
    scene.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
    });
    renderer.dispose();
  };

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    stopAnimation();
    disablePointer();
    stage.classList.remove("three-ready");
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("orientationchange", handleResize);
    removeMotionListener();
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    disposeScene();
  };

  const removeMotionListener = listenForReducedMotion(handleMotionChange);
  canvas.addEventListener("webglcontextlost", handleContextLost);

  loader.load(
    "assets/digital-ethan/digital-ethan-main-cutout.png",
    (ethanTexture) => {
      if (destroyed) {
        ethanTexture.dispose();
        return;
      }

      ethanTexture.colorSpace = THREE.SRGBColorSpace;
      ethanTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      const character = new THREE.Mesh(
        new THREE.PlaneGeometry(1.26, 3.25),
        new THREE.MeshBasicMaterial({
          map: ethanTexture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          alphaTest: 0.02,
        }),
      );
      character.position.set(0, -0.62, 1.25);
      character.rotation.y = -0.1;
      scene.add(character);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.82, 42),
        new THREE.MeshBasicMaterial({
          color: 0x40311f,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      );
      shadow.position.set(0, -2.64, 1.05);
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);

      const grid = new THREE.GridHelper(6.4, 11, 0x8b8172, 0xd7cbb6);
      grid.position.set(0.12, -2.78, -0.25);
      grid.rotation.x = 0.05;
      grid.material.transparent = true;
      grid.material.opacity = 0.25;
      scene.add(grid);

      renderScene = (time = 0, staticRender = false) => {
        const t = time * 0.001;
        const progress = staticRender ? 0 : controller.state.progress;
        const centerProgress = smoothstep(0.2, 0.46, progress);
        const heroX = window.innerWidth <= 640 ? 0.72 : window.innerWidth <= 980 ? 0.82 : 1.48;
        const heroScale = window.innerWidth <= 640 ? 0.78 : window.innerWidth <= 980 ? 0.88 : 0.92;
        const characterX = mix(heroX, 0, centerProgress);
        const characterScale = mix(heroScale, 1.08, centerProgress);
        const idle = staticRender ? 0 : Math.sin(t * 0.9);

        if (!staticRender) {
          pointer.x += (targetPointer.x - pointer.x) * 0.08;
          pointer.y += (targetPointer.y - pointer.y) * 0.08;
        }

        character.position.x = characterX + pointer.x * -0.08;
        character.position.y = -0.62 + idle * 0.018;
        character.rotation.y = -0.1 + pointer.x * -0.06 + (staticRender ? 0 : Math.sin(t * 0.72) * 0.008);
        character.scale.setScalar(characterScale);

        shadow.position.x = characterX;
        shadow.scale.setScalar(characterScale * (1 + idle * 0.03));

        camera.position.x = pointer.x * 0.18;
        camera.position.y = mix(0.72, 0.58, centerProgress) + pointer.y * 0.1;
        camera.position.z = mix(7.9, 7.25, centerProgress);
        camera.lookAt(0, -0.18, 0.2);

        renderer.render(scene, camera);
      };

      ready = true;
      resizeRenderer();

      window.addEventListener("resize", handleResize);
      window.addEventListener("orientationchange", handleResize);

      if (contextLost) return;

      if (reducedMotion.matches) {
        stage.classList.remove("three-ready");
        renderScene(0, true);
        return;
      }

      stage.classList.add("three-ready");
      enablePointer();
      startAnimation();
    },
    undefined,
    () => {
      if (!destroyed) cleanup();
    },
  );

  return cleanup;
};

const destroyThreeScene = initThreeScene(introStage, introController);

window.addEventListener("pagehide", () => {
  introController?.destroy();
  destroyThreeScene();
  document.documentElement.style.overflowX = originalDocumentOverflowX;
}, { once: true });
