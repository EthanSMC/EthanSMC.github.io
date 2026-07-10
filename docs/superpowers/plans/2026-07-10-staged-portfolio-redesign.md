# Staged Portfolio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved staged homepage where Digital Ethan moves from the right to the center on scroll, introduction cards appear around the character, content and repository categories are corrected, navigation works visibly, and the result is deployed.

**Architecture:** Keep the static HTML/CSS/JavaScript site. A `260vh` DOM wrapper owns a one-viewport sticky stage; a small native scroll controller exposes smoothed progress to both CSS custom properties and the existing Three.js animation loop. All readable content and links remain semantic DOM; Three.js renders only the hand-drawn character plane, floor grid, and shadow.

**Tech Stack:** Semantic HTML, CSS sticky positioning and custom properties, vanilla JavaScript, self-hosted Three.js 0.178.0, Python Playwright/unittest, Vercel CLI.

## Global Constraints

- Preserve the hand-drawn paper, blue ink, green connector, and yellow marker visual identity.
- Do not add an avatar, profile photo, framework, bundler, GSAP, Lenis, or copied David Heckhoff source/assets.
- First viewport contains no tools wall, terminal, repository stack, or project wall.
- Product cases and personal Skill repositories remain separate.
- Featured Projects are exactly `AI-native Wealth & Asset Management System`, `Bond Agent & Financial Q`, and `Novelty Studio`.
- Only Novelty Studio links externally, to `https://noveltystudio.cn`.
- Featured repositories are exactly `pm-skills`, `digital-me`, `mcd-skill`, and `learn-back`.
- External destinations use normal same-tab anchors.
- Preserve detailed resume-derived Experience content.
- Add a visible footer reference to David Heckhoff's portfolio/repository.
- Honor `prefers-reduced-motion` and preserve static content when WebGL fails.

---

## File Structure

- Create `tests/portfolio_e2e.py`: permanent browser regression checks for content, links, sticky phases, navigation, reduced motion, canvas rendering, and overflow.
- Modify `index.html`: replace the hero information wall with the sticky intro markup, move About summary into callouts, rename Experience, correct project/repository content, and add attribution.
- Modify `styles.css`: remove obsolete hero-room styles and define sticky-stage, phase, callout, project-link, responsive, Contact, and reduced-motion rules.
- Modify `script.js`: add explicit anchor navigation, add a scroll-progress controller, simplify the Three.js scene, and map progress to character/camera transforms.
- Modify `.gitignore`: ignore `.superpowers/` visual-companion state.

---

### Task 1: Add Failing Browser Contracts

**Files:**
- Create: `tests/portfolio_e2e.py`

**Interfaces:**
- Consumes: `PORTFOLIO_URL` environment variable, defaulting to `http://127.0.0.1:4173/`.
- Produces: executable `unittest` suite used by all later tasks.

- [ ] **Step 1: Write the failing test suite**

```python
import os
import unittest

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("PORTFOLIO_URL", "http://127.0.0.1:4173/")


class PortfolioE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def open_page(self, width=1440, height=1000, reduced_motion=False):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        if reduced_motion:
            page.emulate_media(reduced_motion="reduce")
        page.goto(BASE_URL, wait_until="networkidle")
        return context, page

    def test_content_and_link_contract(self):
        context, page = self.open_page()
        cards = page.locator("[data-project-card]")
        self.assertEqual(cards.count(), 3)
        self.assertEqual(cards.nth(0).locator("h3").inner_text(), "AI-native Wealth & Asset Management System")
        self.assertEqual(cards.nth(0).locator("a").count(), 0)
        self.assertEqual(cards.nth(1).locator("h3").inner_text(), "Bond Agent & Financial Q")
        self.assertEqual(cards.nth(1).locator("a").count(), 0)
        self.assertEqual(
            cards.nth(2).locator("a").get_attribute("href"),
            "https://noveltystudio.cn",
        )
        self.assertIsNone(cards.nth(2).locator("a").get_attribute("target"))

        repo_names = page.locator(".repo-card h3").all_inner_texts()
        self.assertEqual(repo_names, ["pm-skills", "digital-me", "mcd-skill", "learn-back"])
        self.assertNotIn("jinshi-finpm", repo_names)
        context.close()

    def test_intro_is_quiet_and_staged(self):
        context, page = self.open_page()
        intro = page.locator("[data-intro]")
        self.assertEqual(intro.count(), 1)
        self.assertEqual(page.locator(".floating-note, .repo-stack, .terminal-note").count(), 0)
        self.assertEqual(page.locator("[data-intro-callout]").count(), 4)
        self.assertEqual(page.locator("[data-intro-stage]").get_attribute("data-phase"), "hero")

        intro_box = intro.bounding_box()
        scroll_range = intro_box["height"] - page.evaluate("window.innerHeight")
        page.evaluate("y => window.scrollTo(0, y)", intro_box["y"] + scroll_range * 0.82)
        page.wait_for_function(
            "document.querySelector('[data-intro-stage]').dataset.phase === 'domain'"
        )
        visible = page.locator("[data-intro-callout]").evaluate_all(
            "els => els.filter(el => Number(getComputedStyle(el).opacity) > 0.8).length"
        )
        self.assertEqual(visible, 4)
        context.close()

    def test_contact_navigation_aligns_heading(self):
        context, page = self.open_page(width=1024, height=900)
        page.locator(".nav-links a[href='#contact']").click()
        page.wait_for_function("location.hash === '#contact'")
        page.wait_for_function(
            "Math.abs(document.querySelector('#contact-title').getBoundingClientRect().top - 104) < 40"
        )
        top = page.locator("#contact-title").evaluate("el => el.getBoundingClientRect().top")
        self.assertGreaterEqual(top, 64)
        self.assertLessEqual(top, 144)
        context.close()

    def test_reduced_motion_keeps_intro_content(self):
        context, page = self.open_page(width=390, height=844, reduced_motion=True)
        self.assertEqual(page.locator("[data-intro-callout]").count(), 4)
        page.locator("[data-intro-callout]").last.scroll_into_view_if_needed()
        self.assertTrue(page.locator("[data-intro-callout]").last.is_visible())
        context.close()

    def test_no_horizontal_overflow(self):
        for width, height in [(1440, 1000), (1024, 900), (820, 900), (390, 844)]:
            with self.subTest(width=width):
                context, page = self.open_page(width=width, height=height)
                dimensions = page.evaluate(
                    "({inner: window.innerWidth, scroll: document.documentElement.scrollWidth})"
                )
                self.assertLessEqual(dimensions["scroll"], dimensions["inner"] + 1)
                context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

- [ ] **Step 2: Run the suite and verify RED**

Run:

```bash
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest tests/portfolio_e2e.py -v
```

Expected: failures for missing `[data-intro]`, old first-project title, missing Novelty link, five repository cards including `jinshi-finpm`, and Contact heading not aligning near 104px.

- [ ] **Step 3: Commit the failing contract**

```bash
git add tests/portfolio_e2e.py
git commit -m "test: define staged portfolio behavior"
```

---

### Task 2: Restructure Semantic Content

**Files:**
- Modify: `index.html:46-327`
- Modify: `index.html:432-435`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `[data-intro]`, `[data-intro-stage]`, four `[data-intro-callout]` elements, three `[data-project-card]` elements, and four `.repo-card` links.
- Consumed by: `styles.css`, `script.js`, and `tests/portfolio_e2e.py`.

- [ ] **Step 1: Replace hero and About wrapper with sticky semantic markup**

Use this structure and exact copy:

```html
<section class="intro-sequence section-anchor" id="about" data-intro aria-labelledby="intro-title">
  <div class="intro-sticky" data-intro-stage data-phase="hero">
    <canvas class="three-canvas" id="ethan-three" aria-label="Interactive hand-drawn Digital Ethan scene"></canvas>
    <div class="intro-floor" aria-hidden="true"></div>

    <div class="hero-copy" data-hero-copy>
      <h1 id="intro-title">申名翀<br><span>Ethan</span></h1>
      <p class="hero-banner">Fintech Product Manager × AI Agent Builder</p>
    </div>

    <div class="intro-callouts" aria-label="About Ethan">
      <article class="intro-callout identity" data-intro-callout>
        <h2>申名翀 Ethan</h2><p>Shanghai, China</p>
      </article>
      <article class="intro-callout role" data-intro-callout>
        <h2>Fintech Product Manager</h2><p>Wealth &amp; asset management workflows</p>
      </article>
      <article class="intro-callout domain" data-intro-callout>
        <h2>Domain</h2><p>Bonds · Trading · Risk</p>
      </article>
      <article class="intro-callout builder" data-intro-callout>
        <h2>AI Builder</h2><p>Agent-assisted systems</p>
      </article>
    </div>

    <img class="digital-ethan hero-character" src="assets/digital-ethan/digital-ethan-main-cutout.png"
      alt="Hand-drawn Digital Ethan standing with a MacBook" width="364" height="941" fetchpriority="high">
    <a class="scroll-cue" href="#experience" aria-label="Scroll to experience">Scroll</a>
  </div>
</section>
```

- [ ] **Step 2: Rename the detailed section from About to Experience**

Change the section to:

```html
<section class="experience section-anchor" id="experience" aria-labelledby="experience-title">
  <div class="section-heading">
    <div>
      <h2 id="experience-title">Experience</h2>
      <p>从债券与资管业务出发，把复杂判断做成真正可用的产品与 AI 工作流。</p>
    </div>
  </div>
  <!-- preserve all four existing experience-card articles -->
</section>
```

- [ ] **Step 3: Correct Featured Projects semantics and copy**

The first two cards remain `<article>`. The Novelty card contains one explicit anchor:

```html
<article class="project-card active" data-project-card>
  <!-- existing product illustration -->
  <h3>AI-native Wealth &amp; Asset Management System</h3>
  <p>AI-native wealth and asset-management workspace spanning research, trading, and risk workflows.</p>
  <div class="tags"><span>Fintech PM</span><span>Workflow</span><span>Risk</span></div>
</article>

<article class="project-card" data-project-card>
  <!-- existing product illustration -->
  <h3>Bond Agent &amp; Financial Q</h3>
  <p>Natural-language bond screening and OTC trading automation using NLP and LLM-assisted workflows.</p>
  <div class="tags"><span>Bond</span><span>LLM</span><span>Quote flow</span></div>
</article>

<article class="project-card" data-project-card>
  <!-- existing project illustration -->
  <h3>Novelty Studio</h3>
  <p>Multi-agent interactive fiction with Writer, Editor, Archiver, and Option Generator roles.</p>
  <div class="tags"><span>Multi-Agent</span><span>Memory</span><span>Builder</span></div>
  <a class="project-link" href="https://noveltystudio.cn">Open site <span aria-hidden="true">↗</span></a>
</article>
```

- [ ] **Step 4: Reduce Featured Repositories to four exact same-tab links**

Delete the `jinshi-finpm` card. Remove `target="_blank"` and `rel="noreferrer"` from the remaining repository cards and `View all repos`. Keep exact order: `pm-skills`, `digital-me`, `mcd-skill`, `learn-back`.

- [ ] **Step 5: Add visible attribution and ignore visual-companion state**

Footer markup:

```html
<footer class="site-footer">
  <span>© 2026 EthanSMC</span>
  <span class="design-credit">Interaction reference: <a href="https://david-hckh.com/">David Heckhoff</a></span>
  <a href="#top">Back to top ↑</a>
</footer>
```

Append to `.gitignore`:

```gitignore
.superpowers/
```

- [ ] **Step 6: Run content test and verify remaining failures are interaction/style only**

Run:

```bash
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest tests.portfolio_e2e.PortfolioE2E.test_content_and_link_contract -v
```

Expected: PASS.

- [ ] **Step 7: Commit semantic content**

```bash
git add .gitignore index.html
git commit -m "feat: restructure portfolio content"
```

---

### Task 3: Build Sticky Layout And Responsive States

**Files:**
- Modify: `styles.css:277-998`
- Modify: `styles.css:1084-1444`
- Modify: `styles.css:1630-2150`

**Interfaces:**
- Consumes CSS custom properties `--hero-opacity`, `--hero-y`, `--intro-primary`, and `--intro-secondary` from `script.js`.
- Produces responsive geometry for `.intro-sequence`, `.intro-sticky`, `.intro-callout`, `.hero-character`, `.contact`, and four-card `.repo-cards`.

- [ ] **Step 1: Remove obsolete information-wall styles**

Delete selectors for `.sketch-stage`, `.stage-wall`, `.floating-note`, `.focus-note`, `.tools-note`, `.commit-graph`, `.terminal-note`, `.repo-stack`, `.plant`, `.desk`, and `.shipping-note`. Retain shared `.digital-ethan` image rules.

- [ ] **Step 2: Add sticky stage and phase-driven styles**

```css
.intro-sequence {
  position: relative;
  height: 260svh;
  scroll-margin-top: 0;
}

.intro-sticky {
  --hero-opacity: 1;
  --hero-y: 0px;
  --intro-primary: 0;
  --intro-secondary: 0;
  position: sticky;
  top: 0;
  width: 100%;
  height: 100svh;
  overflow: clip;
  isolation: isolate;
}

.intro-sticky .three-canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.intro-sticky .hero-copy {
  position: absolute;
  left: max(48px, calc((100vw - 1384px) / 2));
  top: 50%;
  z-index: 3;
  opacity: var(--hero-opacity);
  transform: translateY(calc(-50% + var(--hero-y)));
  pointer-events: none;
}

.intro-callout {
  position: absolute;
  z-index: 4;
  width: min(300px, 24vw);
  padding: 18px 20px;
  border: 2px solid rgba(58, 53, 45, 0.56);
  border-radius: 5px;
  background: rgba(255, 250, 240, 0.94);
  box-shadow: 8px 10px 0 rgba(64, 49, 31, 0.06);
  transform: translateY(18px);
  pointer-events: none;
}

.intro-callout h2 {
  margin: 0 0 5px;
  color: var(--blue);
  font-family: var(--mono);
  font-size: 1rem;
}

.intro-callout p { margin: 0; color: var(--ink-soft); line-height: 1.45; }
.intro-callout.identity { left: 8vw; top: 30%; opacity: var(--intro-primary); }
.intro-callout.role { right: 8vw; top: 35%; opacity: var(--intro-primary); }
.intro-callout.domain { left: 7vw; bottom: 18%; opacity: var(--intro-secondary); }
.intro-callout.builder { right: 7vw; bottom: 20%; opacity: var(--intro-secondary); }
```

Add `::after` connector lines only at desktop widths; connector endpoints must stop before the character safe area.

- [ ] **Step 3: Make project-card actions and repository grid intentional**

```css
.project-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  margin-top: 16px;
  color: var(--blue);
  font-family: var(--hand);
  font-weight: 900;
  text-decoration: underline;
  text-underline-offset: 5px;
}

.project-card:not(:has(.project-link)) { cursor: default; }
.repo-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
```

- [ ] **Step 4: Make Contact alignable and footer credit readable**

```css
.contact {
  min-height: calc(100svh - 84px);
  align-content: center;
}

.site-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.site-footer > :last-child { justify-self: end; }
.design-credit { text-align: center; }
```

- [ ] **Step 5: Add tablet, mobile, and reduced-motion layouts**

At `max-width: 980px`, use 30px page gutters and callout widths no greater than `230px`. At `max-width: 640px`, use 18px gutters, hide connector lines, place the callouts as an alternating two-column grid in the lower half of the stage, and keep all text above the fixed bottom navigation.

Reduced-motion CSS:

```css
@media (prefers-reduced-motion: reduce) {
  .intro-sequence { height: auto; }
  .intro-sticky {
    position: relative;
    min-height: 150svh;
    height: auto;
    overflow: visible;
  }
  .intro-sticky .hero-copy { opacity: 1; transform: none; }
  .intro-callouts {
    position: relative;
    z-index: 5;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 100svh 18px 110px;
  }
  .intro-callout {
    position: static;
    width: auto;
    opacity: 1 !important;
    transform: none;
  }
}
```

- [ ] **Step 6: Run overflow and reduced-motion tests**

Run:

```bash
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest \
  tests.portfolio_e2e.PortfolioE2E.test_reduced_motion_keeps_intro_content \
  tests.portfolio_e2e.PortfolioE2E.test_no_horizontal_overflow -v
```

Expected: reduced-motion test PASS; overflow may remain red until the Three.js canvas is simplified in Task 4.

- [ ] **Step 7: Commit layout**

```bash
git add styles.css
git commit -m "feat: add staged sticky portfolio layout"
```

---

### Task 4: Implement Scroll Controller, Navigation, And Three.js Motion

**Files:**
- Modify: `script.js:1-510`

**Interfaces:**
- Produces: `createIntroController(stage, sequence)` returning `{ state: { progress: number, target: number }, destroy(): void }`.
- Consumes: `[data-intro]`, `[data-intro-stage]`, `.nav-links a[href^='#']`, and the existing `#ethan-three` canvas.

- [ ] **Step 1: Add deterministic progress helpers and intro controller**

```javascript
const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);
const mix = (from, to, progress) => from + (to - from) * progress;
const smoothstep = (start, end, value) => {
  const x = clamp((value - start) / (end - start));
  return x * x * (3 - 2 * x);
};

const createIntroController = (stage, sequence) => {
  const state = { progress: 0, target: 0 };
  let frameId = 0;

  const measure = () => {
    const bounds = sequence.getBoundingClientRect();
    const range = Math.max(sequence.offsetHeight - window.innerHeight, 1);
    state.target = clamp(-bounds.top / range);
  };

  const render = () => {
    state.progress += (state.target - state.progress) * 0.12;
    const progress = state.progress;
    stage.style.setProperty("--hero-opacity", (1 - smoothstep(0.16, 0.36, progress)).toFixed(3));
    stage.style.setProperty("--hero-y", `${mix(0, -64, smoothstep(0.16, 0.36, progress)).toFixed(1)}px`);
    stage.style.setProperty("--intro-primary", smoothstep(0.42, 0.56, progress).toFixed(3));
    stage.style.setProperty("--intro-secondary", smoothstep(0.68, 0.8, progress).toFixed(3));
    stage.dataset.phase = progress < 0.25 ? "hero" : progress < 0.45 ? "recenter" : progress < 0.72 ? "intro" : "domain";
    frameId = requestAnimationFrame(render);
  };

  measure();
  render();
  window.addEventListener("scroll", measure, { passive: true });
  window.addEventListener("resize", measure);

  return {
    state,
    destroy() {
      cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    },
  };
};
```

- [ ] **Step 2: Replace fragment-only navigation with explicit fixed-header alignment**

```javascript
const scrollToSection = (hash) => {
  const target = document.querySelector(hash);
  if (!target) return;
  const headerOffset = window.innerWidth <= 900 ? 82 : 96;
  const top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
  window.scrollTo({ top, behavior: reducedMotion.matches ? "auto" : "smooth" });
  history.pushState(null, "", hash);
};

document.querySelectorAll("a[href^='#']").forEach((link) => {
  link.addEventListener("click", (event) => {
    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;
    event.preventDefault();
    scrollToSection(hash);
  });
});
```

- [ ] **Step 3: Simplify the Three.js scene**

Delete `makePanelTexture`, `makeCardTexture`, all panel/box creation, paper-box code, and panel animation. Retain the character texture, shadow, and `GridHelper`.

Create the character at a neutral origin:

```javascript
const character = makePlane({
  texture: ethanTexture,
  width: 1.26,
  height: 3.25,
  x: 0,
  y: -0.62,
  z: 1.25,
  ry: -0.1,
});
```

- [ ] **Step 4: Map intro progress to character and camera transforms**

Inside the Three.js animation frame:

```javascript
const progress = introController.state.progress;
const centerProgress = smoothstep(0.2, 0.46, progress);
const heroX = window.innerWidth <= 640 ? 0.35 : window.innerWidth <= 980 ? 0.82 : 1.48;
const characterX = mix(heroX, 0, centerProgress);
const characterScale = mix(0.92, 1.08, centerProgress);

character.position.x = characterX + pointer.x * -0.08;
character.position.y = -0.62 + Math.sin(t * 0.9) * 0.018;
character.scale.setScalar(characterScale);
shadow.position.x = characterX;
shadow.scale.setScalar(characterScale * (1 + Math.sin(t * 0.9) * 0.03));

camera.position.x = pointer.x * 0.18;
camera.position.y = mix(0.72, 0.58, centerProgress) + pointer.y * 0.1;
camera.position.z = mix(7.9, 7.25, centerProgress);
camera.lookAt(0, -0.18, 0.2);
```

For reduced motion, render one static frame with `centerProgress = 0` and retain resize rendering.

- [ ] **Step 5: Verify GREEN for intro and navigation**

Run:

```bash
node --check script.js
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest tests/portfolio_e2e.py -v
```

Expected: all tests PASS with no browser console errors.

- [ ] **Step 6: Commit interaction implementation**

```bash
git add script.js
git commit -m "feat: animate Digital Ethan through intro scroll"
```

---

### Task 5: Visual QA, Completion Audit, And Deployment

**Files:**
- Modify: `tests/portfolio_e2e.py`
- Verify: `index.html`, `styles.css`, `script.js`
- Read: `docs/superpowers/specs/2026-07-10-staged-portfolio-redesign-design.md`

**Interfaces:**
- Consumes: complete staged portfolio implementation.
- Produces: verified Git commit on `main`, GitHub Pages update, and Ready Vercel production deployment.

- [ ] **Step 1: Run static and browser verification**

```bash
node --check script.js
git diff --check
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest tests/portfolio_e2e.py -v
```

Expected: zero syntax errors, zero whitespace errors, all browser tests PASS.

- [ ] **Step 2: Capture Playwright evidence at four viewports**

Use `tests/portfolio_e2e.py` selectors to capture full first-view, 50% intro, 82% intro, Experience, Projects, and Contact screenshots at 1440×1000, 1024×900, 820×900, and 390×844. Inspect every image for overlap, clipped text, blank canvas, or fixed-nav occlusion.

- [ ] **Step 3: Verify WebGL pixels and motion**

Read WebGL pixels with `gl.readPixels` after a rendered animation frame. Require more than 100 painted samples. Capture the canvas before and after pointer movement; require more than 100 changed screenshot pixels at each viewport.

- [ ] **Step 4: Audit every spec requirement**

Check the design spec line by line and record evidence for:

- Quiet first view
- Right-to-center character movement
- Four ordered callouts
- Detailed Experience retained
- Exact project/repository taxonomy and links
- Contact alignment
- Reduced motion and WebGL fallback
- Four responsive widths
- David attribution

Do not mark the goal complete if any item is missing or only indirectly inferred.

- [ ] **Step 5: Commit final QA adjustments and push**

```bash
git add .gitignore index.html styles.css script.js tests/portfolio_e2e.py
git commit -m "feat: launch staged Digital Ethan portfolio"
git push origin main
```

- [ ] **Step 6: Deploy the existing Vercel production project**

```bash
npx --yes vercel deploy . --prod -y --no-wait --scope ethansmc
npx --yes vercel inspect https://ethansmc-personal-page.vercel.app --scope ethansmc
```

Expected: deployment target `production`, status `Ready`, stable alias `https://ethansmc-personal-page.vercel.app`.

- [ ] **Step 7: Final repository check**

```bash
git status --short --branch
git log -5 --oneline --decorate
```

Expected: `main` matches `origin/main`; only ignored visual QA artifacts remain.
