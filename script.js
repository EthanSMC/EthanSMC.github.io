import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js";

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

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (visible) {
      setActiveLink(visible.target.id);
    }
  },
  {
    rootMargin: "-24% 0px -58% 0px",
    threshold: [0.12, 0.28, 0.5],
  },
);

sections.forEach((section) => observer.observe(section));

const tiltScene = document.querySelector("[data-tilt-scene]");

if (tiltScene && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  tiltScene.addEventListener("pointermove", (event) => {
    const bounds = tiltScene.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    tiltScene.style.setProperty("--mx", (x * 7).toFixed(2));
    tiltScene.style.setProperty("--my", (y * 7).toFixed(2));
  });

  tiltScene.addEventListener("pointerleave", () => {
    tiltScene.style.setProperty("--mx", "0");
    tiltScene.style.setProperty("--my", "0");
  });
}

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

const soundToggle = document.querySelector(".sound-toggle");

soundToggle?.addEventListener("click", () => {
  const enabled = soundToggle.getAttribute("aria-pressed") === "true";
  soundToggle.setAttribute("aria-pressed", String(!enabled));
});

const initThreeScene = () => {
  const canvas = document.querySelector("#ethan-three");
  const stage = document.querySelector("[data-tilt-scene]");

  if (!canvas || !stage) return;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0.05, 0.62, 7.85);

  const root = new THREE.Group();
  root.position.set(0.08, -0.08, 0);
  scene.add(root);

  const pointer = { x: 0, y: 0 };
  const targetPointer = { x: 0, y: 0 };
  const scroll = { value: 0 };

  const loader = new THREE.TextureLoader();
  const loadTexture = (src) =>
    new Promise((resolve, reject) => {
      loader.load(
        src,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          resolve(texture);
        },
        undefined,
        reject,
      );
    });

  const makePanelTexture = ({ title, lines = [], width = 520, height = 340, color = "#275ba8" }) => {
    const dpr = 2;
    const panel = document.createElement("canvas");
    panel.width = width * dpr;
    panel.height = height * dpr;
    const ctx = panel.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 250, 240, 0.92)";
    ctx.strokeStyle = "rgba(58, 53, 45, 0.55)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(10, 16, width - 20, height - 32, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(231, 185, 54, 0.33)";
    ctx.rotate(-0.02);
    ctx.fillRect(width * 0.38, 0, 118, 26);
    ctx.rotate(0.02);

    ctx.font = "700 26px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = color;
    ctx.fillText(title, 44, 72);

    ctx.font = "700 26px Bradley Hand, Segoe Print, Comic Sans MS, sans-serif";
    ctx.fillStyle = "#504b43";
    lines.forEach((line, index) => {
      const y = 122 + index * 44;
      ctx.strokeStyle = "#66a56a";
      ctx.lineWidth = 3;
      ctx.strokeRect(45, y - 20, 20, 20);
      ctx.beginPath();
      ctx.moveTo(50, y - 9);
      ctx.lineTo(56, y - 2);
      ctx.lineTo(69, y - 24);
      ctx.stroke();
      ctx.fillText(line, 84, y);
    });

    const texture = new THREE.CanvasTexture(panel);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  const makeCardTexture = ({ title, subtitle, width = 480, height = 150 }) => {
    const dpr = 2;
    const card = document.createElement("canvas");
    card.width = width * dpr;
    card.height = height * dpr;
    const ctx = card.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "rgba(255, 250, 240, 0.94)";
    ctx.strokeStyle = "rgba(58, 53, 45, 0.58)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(10, 15, width - 20, height - 30, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(231, 185, 54, 0.33)";
    ctx.fillRect(width * 0.48, 0, 90, 22);

    ctx.strokeStyle = "#275ba8";
    ctx.lineWidth = 5;
    ctx.strokeRect(48, 54, 34, 40);
    ctx.beginPath();
    ctx.moveTo(57, 68);
    ctx.lineTo(72, 68);
    ctx.moveTo(57, 80);
    ctx.lineTo(70, 80);
    ctx.stroke();

    ctx.fillStyle = "#275ba8";
    ctx.font = "800 29px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(title, 112, 67);

    ctx.fillStyle = "#504b43";
    ctx.font = "700 24px Bradley Hand, Segoe Print, Comic Sans MS, sans-serif";
    ctx.fillText(subtitle, 112, 101);

    const texture = new THREE.CanvasTexture(card);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  const makePlane = ({ texture, width, height, x, y, z, ry = 0, rz = 0, opacity = 1 }) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      alphaTest: 0.02,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, ry, rz);
    root.add(mesh);
    return mesh;
  };

  const makePaperBox = ({ x, y, z, w, h, color = 0xfffaf0, ry = 0, rz = 0 }) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.set(0, ry, rz);

    const paper = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.045),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    const line = new THREE.LineSegments(
      new THREE.EdgesGeometry(paper.geometry),
      new THREE.LineBasicMaterial({ color: 0x3a352d, transparent: true, opacity: 0.5 }),
    );
    group.add(paper, line);
    root.add(group);
    return group;
  };

  Promise.all([loadTexture("assets/digital-ethan/digital-ethan-main-cutout.png")])
    .then(([ethanTexture]) => {
      stage.classList.add("three-ready");

      const character = makePlane({
        texture: ethanTexture,
        width: 1.26,
        height: 3.25,
        x: 0.46,
        y: -0.72,
        z: 1.25,
        ry: -0.1,
      });

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.82, 42),
        new THREE.MeshBasicMaterial({ color: 0x40311f, transparent: true, opacity: 0.12, depthWrite: false }),
      );
      shadow.position.set(0.36, -2.78, 1.05);
      shadow.rotation.x = -Math.PI / 2;
      root.add(shadow);

      const focusTexture = makePanelTexture({
        title: "// current focus",
        lines: ["Asset Workbench", "Bond AI Agent", "PM Agent Skills", "Digital Me System"],
      });
      const toolsTexture = makePanelTexture({
        title: "// tools",
        lines: ["Product Strategy", "Python / SQL", "LLM Agents", "Bonds / Risk", "UX Workflows"],
        width: 430,
        height: 330,
      });
      const terminalTexture = makePanelTexture({
        title: ">",
        lines: ["turn judgment into systems", "ship agent-assisted tools"],
        width: 460,
        height: 230,
        color: "#504b43",
      });

      const panels = [
        makePlane({ texture: focusTexture, width: 2.35, height: 1.55, x: -1.48, y: 1.18, z: -0.08, ry: 0.18, rz: -0.03 }),
        makePlane({ texture: toolsTexture, width: 1.72, height: 1.35, x: 1.62, y: 1.02, z: -0.18, ry: -0.22, rz: 0.04 }),
        makePlane({ texture: terminalTexture, width: 2.15, height: 1.05, x: -1.2, y: -1.28, z: 0.18, ry: 0.14, rz: 0.07 }),
      ];

      const boxes = [
        makePlane({
          texture: makeCardTexture({ title: "digital-me", subtitle: "Personal IP system" }),
          width: 1.9,
          height: 0.6,
          x: 1.52,
          y: 0.12,
          z: 0.55,
          ry: -0.26,
          rz: 0.02,
        }),
        makePlane({
          texture: makeCardTexture({ title: "pm-skills", subtitle: "PM playbook" }),
          width: 1.9,
          height: 0.6,
          x: 1.52,
          y: -0.6,
          z: 0.62,
          ry: -0.28,
          rz: -0.02,
        }),
        makePlane({
          texture: makeCardTexture({ title: "Novelty Studio", subtitle: "Multi-agent fiction" }),
          width: 1.9,
          height: 0.6,
          x: 1.52,
          y: -1.28,
          z: 0.68,
          ry: -0.3,
          rz: 0.03,
        }),
      ];

      const applySceneLayout = () => {
        const isCompact = window.innerWidth <= 640;
        const isNarrow = window.innerWidth <= 980;

        root.scale.setScalar(isCompact ? 0.82 : isNarrow ? 0.9 : 1);
        root.position.x = isNarrow ? -0.04 : 0.08;

        character.position.x = isNarrow ? 0.03 : 0.46;
        shadow.position.x = isNarrow ? -0.02 : 0.36;

        panels[0].position.set(isCompact ? -0.86 : isNarrow ? -1.35 : -1.48, isNarrow ? 1.36 : 1.18, -0.08);
        panels[1].position.set(isCompact ? 1.08 : isNarrow ? 1.62 : 1.62, isNarrow ? 1.48 : 1.02, -0.18);
        panels[2].position.set(isCompact ? -0.92 : isNarrow ? -1.42 : -1.2, isCompact ? -1.34 : isNarrow ? -1.5 : -1.28, 0.18);
        panels[0].scale.setScalar(isCompact ? 0.92 : 1);
        panels[1].scale.setScalar(isCompact ? 0.82 : isNarrow ? 0.92 : 1);
        panels[2].scale.setScalar(isCompact ? 0.86 : isNarrow ? 0.92 : 1);

        boxes.forEach((box, index) => {
          box.position.x = isCompact ? 1.18 : isNarrow ? 1.78 : 1.52;
          box.position.y = [0.18, -0.54, -1.18][index];
          box.scale.setScalar(isCompact ? 0.84 : isNarrow ? 0.9 : 1);
        });
      };

      applySceneLayout();

      const grid = new THREE.GridHelper(6.4, 11, 0x8b8172, 0xd7cbb6);
      grid.position.set(0.22, -2.92, -0.25);
      grid.rotation.x = 0.05;
      grid.material.transparent = true;
      grid.material.opacity = 0.25;
      root.add(grid);

      const resizeRendererToDisplaySize = () => {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const needResize = canvas.width !== Math.floor(width * renderer.getPixelRatio()) ||
          canvas.height !== Math.floor(height * renderer.getPixelRatio());

        if (needResize) {
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          applySceneLayout();
        }
      };

      const updateScroll = () => {
        const bounds = stage.getBoundingClientRect();
        const progress = 1 - Math.min(Math.max(bounds.top / window.innerHeight, -1), 1);
        scroll.value = progress;
      };

      updateScroll();
      window.addEventListener("scroll", updateScroll, { passive: true });

      const animate = (time) => {
        const t = time * 0.001;
        pointer.x += (targetPointer.x - pointer.x) * 0.08;
        pointer.y += (targetPointer.y - pointer.y) * 0.08;

        resizeRendererToDisplaySize();

        root.rotation.y = pointer.x * 0.16 + Math.sin(t * 0.4) * 0.015;
        root.rotation.x = -pointer.y * 0.08;
        root.position.y = -0.06 + Math.sin(t * 0.8) * 0.018 - scroll.value * 0.05;

        character.rotation.y = -0.1 + pointer.x * -0.18 + Math.sin(t * 0.72) * 0.018;
        character.position.y = -0.72 + Math.sin(t * 0.9) * 0.018;
        shadow.scale.setScalar(1 + Math.sin(t * 0.9) * 0.03);

        panels.forEach((panel, index) => {
          panel.position.y += Math.sin(t * 0.75 + index) * 0.0008;
          panel.rotation.z += Math.sin(t * 0.45 + index) * 0.00008;
        });

        boxes.forEach((box, index) => {
          box.rotation.y = -0.28 + pointer.x * -0.05 + index * -0.02;
        });

        camera.position.x = pointer.x * 0.28;
        camera.position.y = 0.7 + pointer.y * 0.13;
        camera.lookAt(0.18, -0.18, 0.2);

        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    })
    .catch((error) => {
      console.warn("Three.js scene could not load; falling back to static Digital Ethan image.", error);
    });

  stage.addEventListener("pointermove", (event) => {
    const bounds = stage.getBoundingClientRect();
    targetPointer.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    targetPointer.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
  });

  stage.addEventListener("pointerleave", () => {
    targetPointer.x = 0;
    targetPointer.y = 0;
  });
};

initThreeScene();
