# Staged Portfolio Redesign

Date: 2026-07-10
Status: Approved direction, pending implementation

## Goal

Reshape the homepage around a simple David Heckhoff-inspired scroll narrative while preserving Ethan's hand-drawn visual identity and existing resume depth.

The first viewport must be quiet: name and role on the left, Digital Ethan on the right, with no tool wall or project-card stack. As the visitor scrolls, Digital Ethan moves to the center and short introduction cards appear around the character. Detailed experience and projects continue below as normal document content.

## Reference And Attribution

The interaction model references David Heckhoff's portfolio: a full-viewport sticky Three.js scene, scroll-driven scene transitions, a centered character, and DOM content projected around the character.

No source code or 3D assets from David's repository will be copied. The footer will include a visible interaction-reference link to David's portfolio/repository.

## Information Architecture

The page order will be:

1. Sticky intro and About sequence
2. Detailed Experience
3. Featured Projects
4. Personal Skill Repositories
5. Now
6. Contact

The existing resume-derived experience content remains. The redesign changes its hierarchy and presentation rather than deleting it.

## Sticky Scroll Narrative

The intro wrapper is approximately `260vh`; its visual stage remains sticky for one viewport.

### Phase 1: First View, 0-25%

- Left: `申名翀 Ethan`
- Left label: `Fintech Product Manager × AI Agent Builder`
- Right: hand-drawn Digital Ethan, faint floor grid, and a restrained shadow
- Remove all current focus, tools, terminal, and repository panels from the first viewport
- Preserve subtle pointer parallax and idle breathing

### Phase 2: Recenter, 25-45%

- Name and role move upward and fade out
- Digital Ethan moves smoothly from the right to the horizontal center
- Camera moves slightly closer
- No information card appears until the character is close to center

### Phase 3: Introduction, 45-72%

Two hand-drawn DOM callouts appear and connect to the character with thin green lines:

- `申名翀 Ethan` / `Shanghai, China`
- `Fintech Product Manager` / `Wealth & asset management workflows`

### Phase 4: Domain And Build, 72-100%

Two more DOM callouts appear:

- `Domain` / `Bonds · Trading · Risk`
- `AI Builder` / `Agent-assisted systems`

The full scene then scrolls away to reveal the detailed Experience section.

## Visual Direction

- Preserve the existing paper grid, blue ink, green check/connector lines, yellow marker tape, and hand-drawn Digital Ethan
- Spend visual emphasis on the character transition; surrounding sections remain quieter
- Callouts use restrained paper panels with no overlapping text
- Do not introduce an avatar, profile photo, dashboard layout, dark sci-fi section, or dense hero information wall
- Keep cards at 8px radius or less

## Content And Links

### Featured Projects

1. `AI-native Wealth & Asset Management System`
   - Product case study
   - Not a link
2. `Bond Agent & Financial Q`
   - Product case study
   - Not a link
3. `Novelty Studio`
   - Links to `https://noveltystudio.cn`

The first two cards must not use pointer styling or imply an unavailable destination. Novelty Studio gets an explicit `Open site` action and remains keyboard accessible.

### Personal Skill Repositories

Feature these public repositories:

- `pm-skills`
- `digital-me`
- `mcd-skill`
- `learn-back`

Do not feature `jinshi-finpm` separately because it overlaps with the broader `pm-skills` product-manager Skill library. It remains accessible through the GitHub profile's complete repository list.

### Link Behavior

- Use semantic anchors for every real destination
- External destinations navigate in the current tab by default so the in-app browser visibly changes pages; standard browser modifier-click behavior still works
- Do not represent Three.js textures as links
- `Say hi` and contact email remain `mailto:` links
- Repository links must point to the exact public GitHub repository

## Navigation Fix

Header navigation will use an explicit scroll helper with the fixed-header offset instead of relying only on browser fragment alignment.

- `About` aligns the sticky intro sequence
- `Projects` aligns the Featured Projects heading
- `Contact` aligns the Contact heading below the fixed navigation
- The final Contact section has at least one viewport of height so it can reach the intended alignment instead of stopping near the middle of the screen
- The URL hash is updated after navigation

## Technical Architecture

Keep the current static HTML/CSS/JavaScript architecture and self-hosted Three.js files. Do not introduce Vue, GSAP, Lenis, a bundler, or a new framework.

### DOM Responsibilities

- Sticky section structure and semantic headings
- Hero copy
- Four introduction callouts and connector lines
- Experience, project, repository, and contact content
- All links and keyboard focus behavior

### Three.js Responsibilities

- Render Digital Ethan as the existing hand-drawn textured plane
- Render the floor grid and character shadow
- Interpolate character position, scale, and camera framing from scroll progress
- Continue pointer parallax and idle motion when reduced motion is not requested

### Scroll Controller

- Read the sticky wrapper's progress in a passive scroll handler
- Store the target progress and interpolate it inside the existing animation frame
- Update a single CSS custom property for DOM transitions
- Use smoothstep-style phase ranges rather than many independent scroll listeners
- Recalculate bounds on resize and orientation change

## Responsive Behavior

### Desktop, 981px And Above

- First view uses left copy and right character
- Centered phase shows two callouts on each side
- Callout text never crosses the character silhouette

### Tablet, 641-980px

- First view remains visually split but uses smaller type and character scale
- Centered phase uses a wider safe area and shorter connector lines
- Fixed bottom navigation must not cover callout text

### Mobile, 320-640px

- First view stacks name above a shorter character stage
- Centered phase shows callouts in two vertical side rails or alternating full-width rows, depending on available width
- No horizontal overflow
- Touch scrolling remains native

## Accessibility And Fallbacks

- Honor `prefers-reduced-motion`
- Reduced-motion mode shows a static first view followed by the four introduction cards in normal flow
- If WebGL or the character texture fails, show the existing static Digital Ethan image while keeping all DOM content available
- Preserve visible keyboard focus
- Keep callouts readable without relying on motion
- Decorative connector lines and icons remain hidden from assistive technology

## Verification

Run Playwright at:

- 1440 × 1000
- 1024 × 900
- 820 × 900
- 390 × 844

Required checks:

- First view contains no tools, terminal, or project wall
- Digital Ethan is right-aligned at the top and centered during the About phase
- Four callouts appear in order and do not overlap text or navigation
- WebGL canvas has painted pixels and changes across frames
- Reduced-motion mode exposes the same content without continuous animation
- `Contact` click changes the hash and places the Contact heading below the fixed navigation
- Novelty Studio opens `https://noveltystudio.cn`
- AI-native Wealth & Asset Management System and Bond Agent are not links
- `pm-skills`, `digital-me`, `mcd-skill`, and `learn-back` point to their exact repositories
- No featured `jinshi-finpm` card remains
- No horizontal overflow or browser console errors

## Non-Goals

- Building a new 3D character model
- Copying David Heckhoff's Vue/GSAP implementation
- Adding more hero cards, decorative widgets, or a dashboard
- Publishing private company repositories
- Linking product case studies to unrelated public repositories
