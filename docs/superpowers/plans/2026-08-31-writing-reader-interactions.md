# Writing Reader Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every primary writing entry reliably clickable and give long-form readers quiet, accessible progress and section navigation on desktop and mobile.

**Architecture:** Keep Eleventy and the current Nunjucks/CSS stack. Add semantic reader markup to article pages, isolate scroll/TOC behavior in a dependency-free `reading-navigation.js`, and progressively enhance only long reads. Reuse the existing brand tokens, i18n runtime, native links, and native dialog behavior.

**Tech Stack:** Eleventy 3, Nunjucks, vanilla JavaScript, CSS, Node test runner, Python Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-31-writing-reader-interactions-design.md`

## Global Constraints

- Do not deploy to Vercel or change the production domain.
- Do not add a framework, animation library, font, icon set, or content dependency.
- Preserve the existing blue, paper, hand-drawn brand system and authored Markdown.
- Core navigation must use native links, buttons, and dialog semantics.
- Target WCAG 2.2 AA, 44×44px touch targets, 200% zoom, and reduced motion.
- A long read has at least 3 `h2`/`h3` headings or at least 5 reading minutes.
- The repository index currently references a missing image object; if commits remain blocked, keep verified changes local and report the blocker instead of rebuilding or resetting the index.

---

### Task 1: Make the independent-writing card a native full-card link

**Files:**
- Modify: `scripts/render-writing-showcase.cjs`
- Modify: `blog.css`
- Modify: `tests/blog-content.test.mjs`
- Modify: `tests/portfolio_e2e.py`

**Interfaces:**
- Consumes: `post.url`, `post.title`, `post.summary`, `post.iso`, `post.display`, `post.readingMinutes`, and `post.tags`.
- Produces: `.independent-card > a.independent-card__link[href]` containing the card’s meta, title, summary, and tag text.

- [x] **Step 1: Write the failing renderer and browser tests**

Add literal assertions that the independent card has exactly one direct anchor and that a real pointer click changes `page.url`:

```js
assert.match(html, /<article class="independent-card">\s*<a class="independent-card__link" href="\/blog\/essay\/"/);
```

```python
article = page.locator(".writing-showcase--home .independent-card").first
link = article.locator(":scope > a.independent-card__link")
self.assertEqual(link.count(), 1)
href = link.get_attribute("href")
article.click()
self.assertEqual(page.url, f"{BASE_URL.rstrip('/')}{href}")
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern="shared album, independent writing" tests/blog-content.test.mjs
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest tests.portfolio_e2e.PortfolioE2E.test_home_writing_primary_cards_have_clickable_native_link_targets
```

Expected: the renderer assertion fails because only the title is linked; the E2E test either fails the direct-anchor assertion or does not navigate from the card surface.

- [x] **Step 3: Implement the single native link**

Render this structure without nested anchors:

```html
<article class="independent-card">
  <a class="independent-card__link" href="/blog/.../">
    <p class="writing-card__meta">…</p>
    <h3>…</h3>
    <p class="independent-card__summary">…</p>
    <div class="writing-card__tags">…</div>
  </a>
</article>
```

Move the card’s layout, hover, active, and focus-visible styles to `.independent-card__link`. Keep the card border-only treatment and do not add a wide shadow.

- [x] **Step 4: Re-run the focused tests and verify GREEN**

Run the two commands from Step 2. Expected: both pass.

- [x] **Step 5: Commit only this task if the index permits it**

```bash
git add scripts/render-writing-showcase.cjs blog.css tests/blog-content.test.mjs tests/portfolio_e2e.py
git commit -m "fix: make writing cards fully clickable"
```

If Git reports the existing missing image object, stop the commit attempt and continue without modifying the index structure.

### Task 2: Add the semantic reader shell and localized copy

**Files:**
- Modify: `blog/post.njk`
- Modify: `_includes/layouts/blog-shell.njk`
- Modify: `eleventy.config.mjs`
- Modify: `i18n.js`
- Modify: `tests/blog-content.test.mjs`
- Modify: `tests/locale.test.cjs`
- Create: `reading-navigation.js`

**Interfaces:**
- Consumes: `post.title`, `post.readingMinutes`, `post.bodyHtml`, and the existing `siteI18n` DOM attributes. The reader root uses `data-reader-minutes`; `data-reading-minutes` remains reserved for localized leaf text.
- Produces: `[data-reader]`, `[data-reader-toolbar]`, `[data-reader-current]`, `[data-reader-percent]`, `[data-reader-progress]`, `[data-reader-toc]`, two `[data-reader-toc-list]` containers, and `[data-reader-dialog]`.
- Produces script API: `createReaderNavigation(root, view)`, `slugifyHeading(text)`, `assignHeadingIds(headings)`, `shouldEnableContents({ headingCount, readingMinutes })`, and `calculateReadingProgress({ scrollY, bodyStart, bodyEnd, viewportHeight, toolbarOffset })`.

- [x] **Step 1: Write failing structural and locale tests**

Assert rendered post HTML contains the reader landmarks and each locale exposes the exact keys:

```js
assert.match(output, /data-reader-toolbar/);
assert.match(output, /data-reader-dialog/);
assert.equal(english.siteI18n.t("blog.reader.contents"), "Contents");
assert.equal(chinese.siteI18n.t("blog.reader.contents"), "目录");
assert.equal(japanese.siteI18n.t("blog.reader.contents"), "目次");
```

Also assert `eleventy.config.mjs` passes through `reading-navigation.js` and the blog shell loads `/reading-navigation.js` after `/blog.js`.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern="renders ordered|localizes the writing showcase|loads the shared manual" tests/blog-content.test.mjs tests/locale.test.cjs
```

Expected: missing reader landmarks, script, and locale keys.

- [x] **Step 3: Add semantic markup and translations**

Add `data-reader-minutes` and `data-post-title` to the post `<article>`. Insert a sticky `<nav>` after `.post-heading`, a three-column `.reader-layout` around the TOC/body, and a native `<dialog>` after the layout. The toolbar back link stays usable without JavaScript; TOC controls start hidden until enhancement proves they are useful.

Add these keys in zh/ja/en:

```text
blog.reader.aria
blog.reader.progress
blog.reader.contents
blog.reader.contentsTitle
blog.reader.closeContents
blog.reader.currentSection
```

Add `reading-navigation.js` to Eleventy passthrough and load it in the blog shell.

- [x] **Step 4: Add the module boundary without behavior**

Create an IIFE matching `writing-carousel.js` so it runs in browsers and exposes helpers through `module.exports` in Node:

```js
(function initializeReadingNavigation(globalObject) {
  function createReaderNavigation(root, view = globalObject) {
    if (!root) return null;
    return Object.freeze({ refresh() {} });
  }

  if (typeof document !== "undefined") {
    document.querySelectorAll("[data-reader]").forEach((root) => createReaderNavigation(root));
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createReaderNavigation };
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [x] **Step 5: Re-run focused tests and verify GREEN**

Run the command from Step 2. Expected: pass.

### Task 3: Implement stable headings, long-read detection, TOC state, and progress

**Files:**
- Create: `tests/reading-navigation.test.cjs`
- Modify: `reading-navigation.js`
- Modify: `blog.js`
- Modify: `tests/portfolio_e2e.py`

**Interfaces:**
- Consumes: the Task 2 reader DOM contract.
- Produces: unique heading IDs, native TOC links, `.reader-enhanced`, `.reader-has-contents`, current-section text, `aria-current="location"`, `--reader-progress`, and toolbar visibility state.

- [x] **Step 1: Write failing pure-function tests**

Use hand-derived expectations:

```js
assert.equal(slugifyHeading("Why：为什么值得自己做？"), "why-为什么值得自己做");
assert.deepEqual(assignHeadingIds([
  { textContent: "重复", id: "" },
  { textContent: "重复", id: "" },
]).map((heading) => heading.id), ["重复", "重复-2"]);
assert.equal(shouldEnableContents({ headingCount: 3, readingMinutes: 2 }), true);
assert.equal(shouldEnableContents({ headingCount: 0, readingMinutes: 5 }), true);
assert.equal(shouldEnableContents({ headingCount: 1, readingMinutes: 2 }), false);
assert.equal(calculateReadingProgress({ scrollY: 350, bodyStart: 100, bodyEnd: 1100, viewportHeight: 400, toolbarOffset: 100 }), 0.5);
```

- [x] **Step 2: Run the unit test and verify RED**

Run: `node --test tests/reading-navigation.test.cjs`

Expected: helpers are missing or return incorrect values.

- [x] **Step 3: Implement the pure helpers**

`slugifyHeading` lowercases Chinese/Latin text, collapses whitespace to hyphens, strips punctuation, and falls back to `section`. `assignHeadingIds` preserves a unique authored ID and appends `-2`, `-3`, etc. for collisions. `calculateReadingProgress` clamps to `[0, 1]` and handles a non-positive denominator without `NaN`.

- [x] **Step 4: Re-run the unit test and verify GREEN**

Run: `node --test tests/reading-navigation.test.cjs`. Expected: pass.

- [x] **Step 5: Write failing real-browser behavior tests**

Add E2E coverage that opens the longest published article and asserts:

```python
self.assertGreaterEqual(page.locator("[data-reader-toc-list] a").count(), 3)
page.evaluate("scrollTo(0, document.querySelector('.prose h2').offsetTop + 120)")
page.wait_for_function("Number(document.querySelector('[data-reader-percent]').textContent.replace('%', '')) > 0")
self.assertEqual(page.locator("[data-reader-toc-list] a[aria-current='location']").count(), 2)
```

The count is two because desktop and dialog lists mirror the same active section. Add a short-note test that asserts the TOC button and desktop aside remain hidden.

- [x] **Step 6: Run the E2E tests and verify RED**

Run the exact new test methods against the local Eleventy server. Expected: no TOC, progress, or active section exists yet.

- [x] **Step 7: Implement the reader controller**

Populate both TOC lists with native anchors. Use `IntersectionObserver` with a top root margin below both headers; fall back to a requestAnimationFrame-coalesced heading position scan. Update progress from a passive scroll listener and `resize`. Use text content for authored section labels and never inject authored HTML.

Remove the old heading-ID loop from `blog.js` after the new controller owns the behavior.

- [x] **Step 8: Re-run unit and E2E tests and verify GREEN**

Run Task 3’s unit and browser commands. Expected: all pass.

### Task 4: Build the desktop margin TOC and mobile bottom sheet

**Files:**
- Modify: `blog.css`
- Modify: `reading-navigation.js`
- Modify: `tests/portfolio_e2e.py`

**Interfaces:**
- Consumes: `.reader-enhanced`, `.reader-has-contents`, and Task 2 data attributes.
- Produces: a sticky margin TOC at `min-width: 1240px`, a dialog TOC below that width, and `is-closing`/`is-open` transition states.

- [x] **Step 1: Write failing responsive, dialog, and focus tests**

For 1440px, assert the aside is visible, body measure is 65–72ch, and the page has no horizontal overflow. For 820px and 390px, assert the aside is hidden, the toolbar TOC button is at least 44×44px, `showModal()` opens the dialog, the first link receives focus, an anchor click closes it and reaches the heading, and `Escape` closes it.

For reduced motion, assert the maximum transition duration on the dialog sheet and toolbar is at most `0.001s`.

- [x] **Step 2: Run the focused E2E tests and verify RED**

Expected: responsive visibility, dialog behavior, focus handling, or reduced-motion timing fails.

- [x] **Step 3: Implement layout and interaction states**

Use a centered three-column `.reader-layout` only above 1240px so the 68ch body remains centered. Use a border-only sticky TOC with no card shadow. The toolbar sits below the fixed global header with a lower z-index. The dialog uses a full-width bottom sheet capped to a readable height, `::backdrop`, safe-area padding, and 220–280ms ease-out transitions.

`reading-navigation.js` must:

- call `showModal()` or set `open` as fallback;
- update `aria-expanded`;
- close on the explicit button, backdrop click, Escape, and TOC link click;
- focus the active link or first link on open;
- restore focus to the opener after explicit close;
- bypass delayed closing when reduced motion is active.

- [x] **Step 4: Re-run focused E2E tests and verify GREEN**

Expected: all desktop, tablet, phone, keyboard, and reduced-motion checks pass.

### Task 5: Polish reading typography and verify the full local experience

**Files:**
- Modify: `blog.css`
- Modify: `tests/portfolio_e2e.py`
- Modify: `docs/superpowers/plans/2026-08-31-writing-reader-interactions.md`

**Interfaces:**
- Consumes: all prior task behavior.
- Produces: the final locally reviewable reader experience and checked plan boxes.

- [x] **Step 1: Add failing typography and overflow assertions**

At 390px, 820px, and 1440px assert body font size is at least 16px, line height is at least 1.75× font size, body measure does not exceed 72ch at desktop, headings are not hidden after hash navigation, and `documentElement.scrollWidth <= innerWidth + 1`.

- [x] **Step 2: Run tests and verify RED where current CSS misses the contract**

Run the new focused methods. Confirm any failure is from typography, offset, or overflow rather than selector setup.

- [x] **Step 3: Apply the minimal typography polish**

Use `max-width: 68ch`, fixed rem body text, fluid heading sizes, deliberate `h2`/`h3` rhythm, `scroll-margin-top` large enough for both headers, tabular progress numerals, bounded code/table scrolling, and the existing blue focus ring. Do not replace fonts or add decorative effects.

- [x] **Step 4: Run fresh full verification**

Run:

```bash
pnpm build
node --test tests/reading-navigation.test.cjs tests/blog-content.test.mjs tests/locale.test.cjs
PORTFOLIO_URL=http://127.0.0.1:4173/ python3 -m unittest tests.portfolio_e2e.PortfolioE2E
git diff --check
```

If the known WeChat Chrome test fails only because of the macOS sandbox, rerun that exact test outside the sandbox and report both outputs.

- [x] **Step 5: Inspect the implementation in a real browser**

Use fresh browser sessions at 1440×1000, 820×900, 390×844, and reduced motion. Inspect the article opening, sticky toolbar, current section, desktop TOC, mobile dialog, article end, adjacent navigation, keyboard focus, and short-note state. Read every captured screenshot rather than trusting its creation path.

- [x] **Step 6: Critique, patch material defects, and repeat verification**

Compare the live result to the spec and selected “quiet editorial room” direction. Fix only evidence-backed defects in hierarchy, spacing, contrast, clipping, or state feedback, then rerun the affected tests and browser states.

- [x] **Step 7: Hand off locally without deployment**

Keep the local server running and provide its URL plus the representative article URL. State the viewports and states verified, any remaining limitation, and explicitly confirm that no preview or production deployment was performed.
