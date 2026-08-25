# Unified Scroll Navigation

Date: 2026-08-25
Status: Approved visual direction, pending implementation plan

## Goal

Improve the transition from the homepage hero into the reading and portfolio content by turning the existing three-part header into one coherent scroll-responsive navigation system.

The result must preserve Ethan's paper-grid, hand-drawn, yellow-marker identity. It borrows the interaction principle from the DeepSeek Harness header—an initially open layout that becomes a compact floating bar—but does not copy its dark glass styling or reduce Ethan's available controls.

Success means:

- the first viewport still feels open and editorial;
- scrolling makes the header feel more focused instead of merely darkening three separate floating islands;
- every current control remains available;
- the transition feels natural with the existing staged Digital Ethan introduction;
- desktop and mobile keep layouts appropriate to their available width;
- blog pages use the same compact navigation language as the homepage.

## Explored Approaches

### 1. Preserve the current three floating islands

Keep the brand, section navigation, and utilities as visually independent elements, while strengthening their existing `scrolled` styles.

This has the lowest implementation cost, but it does not solve the fragmented header composition. The three regions continue to compete with the hero and do not produce the clear state change seen in the reference interaction.

### 2. Copy the narrow DeepSeek-style bar

Collapse the desktop header into an approximately 980px pill and move language and sound controls into a secondary menu.

This creates the strongest compression, but it hides existing functions and feels too product-like for Ethan's personal editorial site. It also weakens the hand-drawn identity.

### 3. Unified paper-glass capsule with every control retained

Use an open, distributed first-view layout, then merge all regions into an approximately 1080px paper-glass capsule after scrolling. Collapse only the `EthanSMC` wordmark to the `E` mark; keep the four section links, three locales, sound control, and contact action visible.

This is the approved direction. It creates a meaningful scroll transition without removing functionality or importing a generic SaaS appearance.

## Approved Prototype

The approved interactive prototype is stored outside the production project:

`/Users/ethancc/.codex/visualizations/2026/08/25/01a03746-a3f5-7890-b648-e8a6dffa8cc6/ethan-nav-scroll-prototype.html`

The prototype defines the intended interaction and visual rhythm. Production implementation should adapt its values to the existing site rather than replacing the site's content or staged intro with the prototype markup.

## Desktop Header States

Desktop behavior applies above the existing `900px` mobile breakpoint.

### Open state: `scrollY <= 80`

- The fixed header uses the available page width, respecting the existing maximum content width.
- The outer header container is transparent and has no visible enclosing border or shadow.
- At widths above `1100px`, the brand shows both the hand-drawn `E` mark and `EthanSMC` wordmark.
- At `901–1100px`, the open state may show only the `E` mark so the complete control set does not overlap.
- The four section links remain in their current central paper pill.
- The locale switcher remains a separate paper pill.
- Sound and `打个招呼` remain visible on the right.
- The overall composition feels distributed and light, so the hero remains primary.

### Compact state: `scrollY > 80`

- Add a single compact-state class to the header.
- Animate the inner shell to a maximum width of approximately `1080px`.
- Keep the shell centered, approximately `12px` from the viewport top.
- The settled shell height is approximately `58px`.
- Apply a warm paper-glass surface, not neutral gray glass:
  - translucent `paper-card` background near 80% opacity;
  - subtle ink-colored border near 17% opacity;
  - `16px` backdrop blur where supported;
  - restrained downward shadow and a faint inset highlight.
- Collapse the `EthanSMC` wordmark using width, opacity, and slight horizontal translation; keep the `E` mark visible.
- Reduce the central navigation's internal width and remove its independent border, background, and shadow so it reads as part of the enclosing shell.
- Reduce the locale pill's visual weight while keeping all three locale buttons visible.
- Keep sound and contact controls visible and keyboard reachable.
- Preserve the yellow active-section marker and blue hand-drawn underline.

Scrolling back to `80px` or less reverses the transition. The interaction is threshold-based, not scroll-direction-based.

## Motion

The production site remains dependency-free. Do not add Framer Motion, GSAP, or a spring library for this header.

- Shell width and padding: approximately `520ms`, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Surface, border, blur, and shadow: approximately `380ms ease`.
- Wordmark collapse: approximately `360ms` for width/translation and `220ms` for opacity.
- Child pill integration: approximately `320–420ms`.
- Active section updates continue to use the existing scroll-position logic.

The motions should overlap so the separate controls appear to merge into the enclosing shell rather than changing in unrelated steps.

Under `prefers-reduced-motion: reduce`, state changes happen effectively immediately and smooth anchor scrolling remains disabled as it is today.

## Hero-to-Content Transition

The existing staged Digital Ethan intro remains intact. This feature changes the navigation's relationship to the intro, not the intro's content choreography.

- The open header accompanies the quiet first viewport.
- The header enters compact state early in the first scroll, before the intro reaches its later callout phases.
- The compact shell stays stable throughout the rest of the staged intro and subsequent content.
- `About` remains active during the staged intro according to the existing `ABOUT_NAV_PROGRESS` behavior.
- When Writing becomes active, the yellow marker and blue underline move to Writing without changing the compact shell geometry.
- Existing anchor offsets must continue to place section headings below the fixed header.

No new progress meter, auto-hiding header, scroll-direction detection, or extra floating badge is added.

## Mobile And Tablet Behavior

At `900px` and below, retain the site's successful split navigation model rather than forcing every control into one narrow top capsule.

### Top utilities

- Show the `E` brand mark on the left.
- Keep the locale switcher, sound control, and contact action on the right.
- The contact action may use its existing icon-only presentation at narrow sizes, with the accessible label preserved.
- Do not show the `EthanSMC` wordmark on mobile.

### Bottom navigation

- Keep the four section links in a fixed bottom paper-glass pill.
- Preserve safe-area insets, native touch scrolling, and at least `44px` touch targets.
- Keep the active yellow marker and blue underline consistent with desktop.
- The bottom bar does not merge with the top utility row when scrolling.

No horizontal overflow is permitted at `320px` width.

## Blog Pages

Blog listing, album, and post pages start directly in the compact desktop state because they do not have the homepage hero transition.

- Keep Writing active and preserve its `aria-current="page"` behavior.
- Use the same compact paper-glass shell and control layout as the scrolled homepage.
- Preserve all locale, sound, and contact functions.
- On mobile, use the same top-utilities and bottom-navigation split as the homepage.

## Markup And CSS Boundaries

Keep the existing Eleventy, HTML, CSS, and vanilla JavaScript architecture.

### Header shell

Add one inner header shell around the existing brand, navigation, and action regions in both:

- `index.html`
- `_includes/layouts/blog-shell.njk`

The outer `.site-header` remains responsible for fixed positioning, viewport padding, z-index, and pointer-event containment. The inner shell owns the grid, maximum width, surface, border, shadow, and compact transition.

### Existing units

- `.brand` continues to own the mark and wordmark.
- `.nav-links` continues to own primary destinations and active state.
- `.header-actions` continues to own locale, sound, and contact controls.
- The current `scrolled` class remains the single JavaScript state contract; only its threshold changes from `20px` to `80px`.

Do not create additional scroll listeners for individual header children.

## Accessibility

- Preserve semantic `header`, `nav`, anchor, button, and dialog relationships.
- Preserve existing accessible labels and pressed states for locale and sound controls.
- Keep every target at least `44 × 44px` on touch devices.
- Preserve visible `:focus-visible` treatment above the glass surface.
- Do not use color alone for the active section; retain shape/underline treatment.
- Ensure the compact surface and controls meet WCAG 2.2 AA contrast requirements against both the paper hero and later content.
- Provide a usable non-blurred background when `backdrop-filter` is unsupported.
- At 200% zoom, switch to the mobile split layout before controls overlap.

## Performance

- Continue using one passive scroll listener for the threshold state and the existing listener for active-section calculation.
- Do not read layout inside the header threshold handler.
- Limit animated properties to header state changes, not continuous scroll progress.
- Avoid introducing new runtime dependencies or large visual assets.

## Verification

Update the existing portfolio end-to-end coverage and verify at:

- `1440 × 1000`
- `1280 × 720`
- `1024 × 900`
- `900 × 900`
- `390 × 844`
- `320 × 720`

Required checks:

- Homepage at `scrollY = 0` shows the full `EthanSMC` wordmark above `1100px` and no enclosing capsule surface.
- Homepage at `901–1100px` may show only the `E` mark while retaining the open surface state.
- Homepage at `scrollY = 80` remains in open state.
- Homepage at `scrollY = 81` enters compact state.
- Compact desktop shell settles near `1080px` or the available viewport width, without overlap.
- Every existing control remains visible and interactive in compact desktop state.
- Scrolling back to the top restores the open state and wordmark.
- Active navigation still tracks About, Writing, Projects, and Contact.
- Anchor clicks still place headings below the fixed header and update the hash.
- Blog pages start in compact state with Writing active.
- Mobile keeps top utilities and bottom navigation, with no horizontal overflow.
- Locale switching, sound toggling, and the WeChat dialog continue to work.
- Keyboard focus remains visible.
- Reduced-motion mode removes the header transition while preserving state changes.
- No console errors or regressions in the existing test suite.

## Non-Goals

- Redesigning the staged Digital Ethan hero.
- Removing or hiding language, sound, or contact controls.
- Adding a hamburger menu on desktop.
- Adding scroll-direction-aware auto-hide behavior.
- Copying DeepSeek's dark color palette or exact component code.
- Adding an animation framework.
- Reworking writing, project, repository, or contact content.
