# Unified Scroll Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's three visually separate header islands with an open first-view layout that merges into a unified 1080px paper-glass capsule after 80px of scrolling, while retaining every control and the existing mobile split navigation.

**Architecture:** Add a `.header-shell` inside the existing fixed `.site-header` in the homepage and shared blog layout. Keep the existing `scrolled` class as the only JavaScript state contract, change its threshold to `scrollY > 80`, and express the visual transition entirely in `styles.css`. Extend the existing Playwright/unittest suite to verify threshold behavior, desktop geometry, blog initial state, mobile positioning, reduced motion, and overflow.

**Tech Stack:** Eleventy 3.1.6, semantic HTML/Nunjucks, CSS, vanilla browser JavaScript, Python `unittest` with Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-unified-scroll-navigation-design.md`

## Global Constraints

- Keep Eleventy, HTML, CSS, and vanilla JavaScript; add no runtime dependency or animation framework.
- Use `scrollY > 80` as the compact-state threshold; `80px` itself remains open.
- Retain the four navigation links, three locale controls, sound control, and WeChat contact action.
- At widths above `1100px`, show the `EthanSMC` wordmark only in the open state; at `901–1100px` and in every compact state, show only the `E` mark.
- Keep the existing `900px` breakpoint: top utilities plus fixed bottom navigation on mobile.
- Blog pages begin in compact state with Writing active.
- Preserve the staged Digital Ethan hero, `ABOUT_NAV_PROGRESS`, anchor offsets, language behavior, sound behavior, and WeChat dialog behavior.
- Preserve WCAG 2.2 AA intent, visible keyboard focus, `44 × 44px` touch targets, reduced-motion behavior, and no horizontal overflow at `320px`.
- Do not add scroll-direction detection, an auto-hiding header, a progress meter, or a new floating badge.

## File Responsibility Map

- `index.html`: homepage header semantics and the new shell wrapper.
- `_includes/layouts/blog-shell.njk`: identical shell structure for generated blog pages; retains static `scrolled` state.
- `script.js`: homepage compact-state threshold only; active navigation and anchor code remain unchanged.
- `styles.css`: desktop open/compact surfaces, child integration, wordmark collapse, responsive split layout, fallback glass surface, and motion.
- `tests/portfolio_e2e.py`: behavioral and layout contracts across homepage, blog, desktop, mobile, and reduced-motion modes.
- `eleventy.config.mjs`: ignore the repository-local `.pnpm-store` so the required build and E2E fixture cannot ingest package-manager cache templates.

## Local E2E Server

After the first `pnpm build`, keep the generated site available in a separate terminal for every Python E2E command:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory _site
```

The tests read `PORTFOLIO_URL` when set and otherwise use `http://127.0.0.1:4173/`.

---

### Task 1: Establish the header shell and 80px state contract

**Files:**
- Modify: `eleventy.config.mjs:8-15`
- Modify: `index.html:56-96`
- Modify: `_includes/layouts/blog-shell.njk:85-125`
- Modify: `script.js:142-160`
- Modify: `tests/portfolio_e2e.py:1050-1190`

**Interfaces:**
- Consumes: existing `.site-header`, `.brand`, `.nav-links`, `.header-actions`, and `scrolled` class names.
- Produces: one `.site-header > .header-shell` per page; `.brand-name` for explicit wordmark animation; homepage `scrolled` state defined by `window.scrollY > 80`.

- [ ] **Step 1: Isolate Eleventy input from the local pnpm store**

Add the exact ignore alongside the other repository-only ignores in `eleventy.config.mjs`:

```js
eleventyConfig.ignores.add(".pnpm-store/**");
```

Run:

```bash
pnpm build
```

Expected: Eleventy completes without treating `.pnpm-store/**/404.html` as an input template and writes the generated site to `_site/`.

- [ ] **Step 2: Write the failing structure and threshold test**

Add this test near the existing navigation tests in `tests/portfolio_e2e.py`:

```python
def test_header_shell_and_scroll_threshold(self):
    page = self.open_page(width=1440, height=1000)
    header = page.locator(".site-header")

    self.assertEqual(page.locator(".site-header > .header-shell").count(), 1)
    self.assertEqual(page.locator(".brand-name").inner_text(), "EthanSMC")

    page.evaluate(
        """() => {
          document.documentElement.style.scrollBehavior = 'auto';
          scrollTo(0, 80);
        }"""
    )
    page.wait_for_timeout(80)
    self.assertNotIn("scrolled", header.get_attribute("class"))

    page.evaluate("scrollTo(0, 81)")
    page.wait_for_function("document.querySelector('.site-header').classList.contains('scrolled')")
    self.assertIn("scrolled", header.get_attribute("class"))

    page.evaluate("scrollTo(0, 0)")
    page.wait_for_function("!document.querySelector('.site-header').classList.contains('scrolled')")
    self.assertNotIn("scrolled", header.get_attribute("class"))

    page.goto(f"{BASE_URL.rstrip('/')}/blog/", wait_until="networkidle")
    self.assertEqual(page.locator(".site-header > .header-shell").count(), 1)
    self.assertIn("scrolled", page.locator(".site-header").get_attribute("class"))
```

- [ ] **Step 3: Run the new test and verify it fails for the missing shell**

With `_site/` served at `http://127.0.0.1:4173`, run:

```bash
python3 tests/portfolio_e2e.py PortfolioE2E.test_header_shell_and_scroll_threshold
```

Expected: FAIL because `.site-header > .header-shell` has count `0`.

- [ ] **Step 4: Add the semantic shell to the homepage**

Inside `index.html`, insert this line immediately after `<header class="site-header" data-header>`:

```html
<div class="header-shell">
```

Change the brand wordmark line to:

```html
<span class="brand-name">EthanSMC</span>
```

Insert the shell's closing `</div>` immediately after the existing `.header-actions` closing tag and before `</header>`. The existing anchors and buttons stay byte-for-byte unchanged.

- [ ] **Step 5: Add the same shell contract to the blog layout**

In `_includes/layouts/blog-shell.njk`, insert this line immediately after `<header class="site-header scrolled" data-header>`:

```html
<div class="header-shell">
```

Change the blog brand wordmark line to:

```html
<span class="brand-name">EthanSMC</span>
```

Insert the shell's closing `</div>` immediately after the existing `.header-actions` closing tag and before `</header>`. The existing `aria-current="page"`, anchors, locale buttons, sound button, and WeChat button stay byte-for-byte unchanged.

- [ ] **Step 6: Change only the homepage compact threshold**

Update `setHeaderState` in `script.js`:

```js
const setHeaderState = () => {
  header?.classList.toggle("scrolled", window.scrollY > 80);
};
```

Leave `updateActiveLink`, `ABOUT_NAV_PROGRESS`, `getHeaderOffset`, and anchor behavior untouched.

- [ ] **Step 7: Build and run the contract test**

Run:

```bash
pnpm build
python3 tests/portfolio_e2e.py PortfolioE2E.test_header_shell_and_scroll_threshold
```

Expected: PASS. The homepage toggles after `80px`, restores at the top, and `/blog/` starts compact.

- [ ] **Step 8: Commit the structural state contract**

```bash
git add eleventy.config.mjs index.html _includes/layouts/blog-shell.njk script.js tests/portfolio_e2e.py
git commit -m "feat: add unified header state contract"
```

---

### Task 2: Implement and verify the desktop paper-glass transition

**Files:**
- Modify: `styles.css:108-330`
- Modify: `tests/portfolio_e2e.py` near `test_header_shell_and_scroll_threshold`

**Interfaces:**
- Consumes: `.header-shell`, `.brand-name`, and `scrolled` from Task 1.
- Produces: open desktop shell, settled compact geometry (`1080px` when space permits), integrated child controls, warm paper-glass surface, and compact wordmark state.

- [ ] **Step 1: Write the failing desktop visual-state test**

Add the following test:

```python
def test_desktop_header_merges_into_one_capsule(self):
    page = self.open_page(width=1440, height=1000)

    open_state = page.evaluate(
        """() => {
          const shell = document.querySelector('.header-shell');
          const nav = document.querySelector('.nav-links');
          const wordmark = document.querySelector('.brand-name');
          const shellStyle = getComputedStyle(shell);
          return {
            shellWidth: shell.getBoundingClientRect().width,
            shellBackground: shellStyle.backgroundColor,
            shellBorder: shellStyle.borderTopColor,
            navBackground: getComputedStyle(nav).backgroundColor,
            wordmarkOpacity: Number(getComputedStyle(wordmark).opacity),
            wordmarkWidth: wordmark.getBoundingClientRect().width,
          };
        }"""
    )
    self.assertGreater(open_state["shellWidth"], 1200)
    self.assertIn(open_state["shellBackground"], ["rgba(0, 0, 0, 0)", "transparent"])
    self.assertNotIn(open_state["navBackground"], ["rgba(0, 0, 0, 0)", "transparent"])
    self.assertGreater(open_state["wordmarkOpacity"], 0.99)
    self.assertGreater(open_state["wordmarkWidth"], 80)

    page.evaluate(
        """() => {
          document.documentElement.style.scrollBehavior = 'auto';
          scrollTo(0, 220);
        }"""
    )
    page.wait_for_function("document.querySelector('.site-header').classList.contains('scrolled')")
    page.wait_for_timeout(650)

    compact = page.evaluate(
        """() => {
          const shell = document.querySelector('.header-shell');
          const nav = document.querySelector('.nav-links');
          const wordmark = document.querySelector('.brand-name');
          const controls = document.querySelectorAll(
            '.nav-links a, .language-switcher button, .sound-toggle, .say-hi'
          );
          return {
            shell: shell.getBoundingClientRect().toJSON(),
            shellBackground: getComputedStyle(shell).backgroundColor,
            navBackground: getComputedStyle(nav).backgroundColor,
            wordmarkOpacity: Number(getComputedStyle(wordmark).opacity),
            wordmarkWidth: wordmark.getBoundingClientRect().width,
            visibleControls: [...controls].filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width >= 40 && rect.height >= 40 && style.visibility !== 'hidden';
            }).length,
          };
        }"""
    )
    self.assertAlmostEqual(compact["shell"]["width"], 1080, delta=3)
    self.assertAlmostEqual(compact["shell"]["x"], 180, delta=3)
    self.assertGreaterEqual(compact["shell"]["height"], 54)
    self.assertLessEqual(compact["shell"]["height"], 62)
    self.assertNotIn(compact["shellBackground"], ["rgba(0, 0, 0, 0)", "transparent"])
    self.assertIn(compact["navBackground"], ["rgba(0, 0, 0, 0)", "transparent"])
    self.assertLess(compact["wordmarkOpacity"], 0.05)
    self.assertLess(compact["wordmarkWidth"], 1)
    self.assertEqual(compact["visibleControls"], 9)
```

- [ ] **Step 2: Run the desktop visual test and verify it fails**

Run:

```bash
pnpm build
python3 tests/portfolio_e2e.py PortfolioE2E.test_desktop_header_merges_into_one_capsule
```

Expected: FAIL because `.header-shell` has no compact geometry or paper-glass surface and the wordmark does not collapse.

- [ ] **Step 3: Move fixed positioning to the outer header and layout to the shell**

Replace the current desktop `.site-header` grid with these responsibilities:

```css
.site-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 40;
  width: 100%;
  padding: 12px 48px 0;
  pointer-events: none;
}

.header-shell {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto minmax(310px, 1fr);
  align-items: center;
  width: 100%;
  max-width: 1420px;
  min-height: 56px;
  margin: 0 auto;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  box-shadow: 0 0 0 rgba(64, 49, 31, 0);
  backdrop-filter: blur(0);
  transition:
    max-width 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
    padding 520ms cubic-bezier(0.2, 0.8, 0.2, 1),
    background-color 380ms ease,
    border-color 380ms ease,
    box-shadow 380ms ease,
    backdrop-filter 380ms ease;
  pointer-events: auto;
}

.site-header.scrolled .header-shell {
  max-width: 1080px;
  padding: 5px 6px 5px 12px;
  border-color: rgba(58, 53, 45, 0.17);
  background: rgba(var(--paper-card-rgb), 0.8);
  box-shadow:
    0 14px 34px rgba(64, 49, 31, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
  backdrop-filter: blur(16px) saturate(1.15);
}
```

Keep `.brand`, `.nav-links`, and `.header-actions` pointer-enabled.

- [ ] **Step 4: Reverse the existing wordmark behavior**

Replace the generic last-child rules with an explicit animated width contract:

```css
.brand-name {
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  opacity: 1;
  transform: translateX(0);
  white-space: nowrap;
  transition:
    max-width 360ms ease,
    opacity 220ms ease,
    transform 360ms ease;
}

.site-header.scrolled .brand-name {
  max-width: 0;
  opacity: 0;
  transform: translateX(-8px);
}
```

Delete the previous rule that reveals the wordmark in `.site-header.scrolled`.

- [ ] **Step 5: Merge child pills into the compact shell**

Keep the existing visual tokens and update the central navigation and locale transitions:

```css
.nav-links {
  isolation: isolate;
  transition:
    height 420ms ease,
    background 320ms ease,
    border-color 320ms ease,
    box-shadow 320ms ease,
    backdrop-filter 320ms ease;
}

.site-header.scrolled .nav-links {
  height: 46px;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.nav-links a {
  min-width: 92px;
  transition:
    min-width 420ms ease,
    color 160ms ease,
    background 160ms ease;
}

.site-header.scrolled .nav-links a {
  min-width: 76px;
}

.language-switcher {
  height: 48px;
  transition:
    height 420ms ease,
    background 320ms ease,
    border-color 320ms ease,
    box-shadow 320ms ease;
}

.site-header.scrolled .language-switcher {
  height: 44px;
  border-color: transparent;
  background: rgba(58, 53, 45, 0.055);
  box-shadow: none;
}
```

Retain the existing yellow marker pseudo-element and add `isolation: isolate` so it remains above the shell surface.

- [ ] **Step 6: Give the contact action the approved blue hand-drawn pill treatment**

Replace the underlined-text presentation with:

```css
.say-hi {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 17px;
  border: 1.5px solid var(--line);
  border-radius: 999px 920px 999px 940px;
  background: var(--blue);
  color: #fff;
  font-family: var(--hand);
  font-size: 1.05rem;
  font-weight: 850;
  text-decoration: none;
  box-shadow: 3px 3px 0 rgba(58, 53, 45, 0.24);
  transform: rotate(-0.3deg);
  cursor: pointer;
  transition: transform 180ms ease, box-shadow 180ms ease;
}

.say-hi:hover {
  box-shadow: 1px 1px 0 rgba(58, 53, 45, 0.24);
  transform: translate(2px, 2px) rotate(-0.3deg);
}
```

Preserve the existing button element and WeChat dialog attributes.

- [ ] **Step 7: Add the no-blur fallback**

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .site-header.scrolled .header-shell {
    background: rgba(var(--paper-card-rgb), 0.96);
  }
}
```

- [ ] **Step 8: Build and run desktop plus existing navigation tests**

Run:

```bash
pnpm build
python3 tests/portfolio_e2e.py \
  PortfolioE2E.test_header_shell_and_scroll_threshold \
  PortfolioE2E.test_desktop_header_merges_into_one_capsule \
  PortfolioE2E.test_contact_navigation_aligns_heading \
  PortfolioE2E.test_about_navigation_targets_about_phase_and_active_link \
  PortfolioE2E.test_writing_entrypoint_and_generated_index_are_reachable
```

Expected: all selected tests PASS.

- [ ] **Step 9: Commit the desktop transition**

```bash
git add styles.css tests/portfolio_e2e.py
git commit -m "feat: merge desktop navigation on scroll"
```

---

### Task 3: Preserve mobile split navigation and complete regression coverage

**Files:**
- Modify: `styles.css:1820-2080, 2320-2340`
- Modify: `tests/portfolio_e2e.py` near the new header tests and existing overflow test

**Interfaces:**
- Consumes: the desktop shell and state styles from Task 2.
- Produces: `901–1100px` compact wordmark handling, `<=900px` top-utilities/bottom-navigation layout, icon-only narrow contact action, reduced-motion compliance, and final multi-viewport coverage.

- [ ] **Step 1: Write the failing responsive and reduced-motion test**

Add:

```python
def test_header_responsive_split_and_reduced_motion(self):
    tablet = self.open_page(width=1024, height=900)
    self.assertLess(
        tablet.locator(".brand-name").evaluate("element => element.getBoundingClientRect().width"),
        1,
    )

    mobile = self.open_page(width=390, height=844)
    mobile_state = mobile.evaluate(
        """() => {
          const shell = document.querySelector('.header-shell').getBoundingClientRect();
          const nav = document.querySelector('.nav-links').getBoundingClientRect();
          const actions = document.querySelector('.header-actions').getBoundingClientRect();
          return {
            shell: shell.toJSON(),
            nav: nav.toJSON(),
            actions: actions.toJSON(),
            wordmarkDisplay: getComputedStyle(document.querySelector('.brand-name')).display,
            sayHiSize: document.querySelector('.say-hi').getBoundingClientRect().toJSON(),
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
          };
        }"""
    )
    self.assertEqual(mobile_state["wordmarkDisplay"], "none")
    self.assertLessEqual(abs(mobile_state["nav"]["bottom"] - (844 - 14)), 3)
    self.assertGreaterEqual(mobile_state["sayHiSize"]["width"], 44)
    self.assertGreaterEqual(mobile_state["sayHiSize"]["height"], 44)
    self.assertLessEqual(mobile_state["documentWidth"], mobile_state["viewportWidth"] + 1)

    reduced = self.open_page(width=1440, height=1000, reduced_motion=True)
    reduced.evaluate("scrollTo(0, 220)")
    reduced.wait_for_function("document.querySelector('.site-header').classList.contains('scrolled')")
    duration = reduced.locator(".header-shell").evaluate(
        "element => Math.max(...getComputedStyle(element).transitionDuration.split(',').map(parseFloat))"
    )
    self.assertLessEqual(duration, 0.001)
```

- [ ] **Step 2: Run the responsive test and verify it fails**

Run:

```bash
pnpm build
python3 tests/portfolio_e2e.py PortfolioE2E.test_header_responsive_split_and_reduced_motion
```

Expected: FAIL because the existing mobile rules target `.site-header` as the grid and do not neutralize the new compact shell.

- [ ] **Step 3: Add the intermediate desktop compression breakpoint**

Before the `900px` breakpoint, add:

```css
@media (max-width: 1100px) {
  .site-header {
    padding-right: 24px;
    padding-left: 24px;
  }

  .header-shell {
    grid-template-columns: 90px auto 290px;
  }

  .brand-name {
    display: none;
  }

  .nav-links a,
  .site-header.scrolled .nav-links a {
    min-width: 68px;
    padding-right: 10px;
    padding-left: 10px;
  }
}
```

- [ ] **Step 4: Move the mobile grid and reset styles to the shell**

Replace the existing `@media (max-width: 900px)` header layout with:

```css
@media (max-width: 900px) {
  .site-header {
    padding: 10px 16px 0;
  }

  .header-shell,
  .site-header.scrolled .header-shell {
    display: grid;
    grid-template-columns: 1fr auto;
    width: 100%;
    max-width: none;
    min-height: 54px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .brand-name {
    display: none;
  }

  .nav-links,
  .site-header.scrolled .nav-links {
    position: fixed;
    right: max(30px, env(safe-area-inset-right));
    bottom: max(14px, env(safe-area-inset-bottom));
    left: max(30px, env(safe-area-inset-left));
    height: 54px;
    justify-content: center;
    gap: 4px;
    padding: 5px;
    border: 1.5px solid rgba(58, 53, 45, 0.16);
    border-radius: 999px;
    background: rgba(var(--paper-card-rgb), 0.9);
    box-shadow: 0 10px 28px rgba(64, 49, 31, 0.12);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }

  .nav-links a,
  .site-header.scrolled .nav-links a {
    flex: 1;
    min-width: 0;
  }

  .language-switcher,
  .site-header.scrolled .language-switcher {
    height: 46px;
    border-color: rgba(58, 53, 45, 0.18);
    background: rgba(var(--paper-card-rgb), 0.78);
    box-shadow: none;
  }

  .header-actions {
    grid-column: 2;
  }
}
```

Retain the existing `max-width: 640px` safe-area positions, horizontally scrollable nav fallback, and 44px locale targets. Update only selectors that still assume `.site-header` is the grid.

- [ ] **Step 5: Keep the narrow contact action icon-only**

In the existing `@media (max-width: 640px)` rules, retain `.say-hi { font-size: 0; }` and add:

```css
.site-header {
  padding: 10px 16px 0;
}

.say-hi {
  width: 44px;
  padding: 0;
}

.say-hi svg {
  width: 28px;
  height: 28px;
}
```

The button's accessible label and dialog attributes remain unchanged.

- [ ] **Step 6: Run targeted responsive and behavior tests**

Run:

```bash
pnpm build
python3 tests/portfolio_e2e.py \
  PortfolioE2E.test_header_responsive_split_and_reduced_motion \
  PortfolioE2E.test_no_horizontal_overflow \
  PortfolioE2E.test_contact_navigation_aligns_heading \
  PortfolioE2E.test_about_navigation_reduced_motion_aligns_first_callout \
  PortfolioE2E.test_writing_index_has_no_horizontal_overflow
```

Expected: all selected tests PASS at desktop, tablet, mobile, and reduced-motion settings.

- [ ] **Step 7: Run the complete verification suite**

Run:

```bash
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

Expected:

- all Node tests PASS;
- Eleventy build completes;
- all portfolio E2E tests PASS;
- `git diff --check` prints no errors.

- [ ] **Step 8: Manually verify the approved interaction at key sizes**

With `_site/` served locally, inspect:

```text
1440 × 1000: full wordmark at top; 1080px compact capsule after 81px.
1280 × 720: every desktop control remains visible without overlap.
1024 × 900: E-only open state; compact shell uses available width.
900 × 900: mobile split activates at the boundary.
390 × 844: top utilities and bottom navigation match the prototype.
320 × 720: no horizontal overflow; all touch targets remain usable.
```

Also open `/blog/` at `1440 × 1000` and `390 × 844`; confirm it starts compact on desktop and uses the mobile split at narrow width.

- [ ] **Step 9: Commit the responsive implementation and tests**

```bash
git add styles.css tests/portfolio_e2e.py
git commit -m "feat: preserve responsive header navigation"
```

## Completion Criteria

The feature is complete only when all three task commits exist, the full test suite passes, the homepage reverses cleanly between open and compact states, blog pages use the compact state, every existing control still works, and desktop/mobile screenshots match the approved prototype's interaction logic without replacing the production hero.
