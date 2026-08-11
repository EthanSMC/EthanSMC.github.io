# Writing Albums and Native WeChat Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build metadata-driven albums, independent articles, small talks, a shared manual Cover Flow UI, and native WeChat note posters without breaking legacy posts.

**Architecture:** `prepare-content.cjs` remains the public content boundary but delegates frontmatter and album resolution to focused modules. A shared server-side showcase renderer feeds both homepage and `/blog/`, while one small client controller supplies carousel behavior. WeChat keeps the existing lifecycle state machine and adds a note-specific poster/newspic renderer selected by `post.kind`.

**Tech Stack:** Node.js 20+, CommonJS content tools, Eleventy 3, Nunjucks, Markdown-It, browser-native CSS/JS, Playwright Core for deterministic PNG capture, Node test runner.

## Global Constraints

- New metadata keys are `kind`, `album`, `track`, `wechat`, `cast`, `slug`, `status`, `featured`, `order`, `cover`, `cover_alt`, `cover_cast`, and `description`.
- `kind: article` without `album` is valid; an explicit unresolved album reference is an error.
- Legacy Markdown without frontmatter retains existing Essay/Note inference.
- The carousel is manual-only and uses 18–24 degree Y-axis perspective for unselected albums.
- Desktop is 70/30 album rail plus independent articles; small talks are full-width below.
- Chinese copy is `专辑`, `独立文章`, `碎碎念`, `查看全部写作`; English copy is `Albums`, `Independent writing`, `Small Talks`, `View all writing`.
- Notes default to website plus native WeChat `newspic`; `wechat: false` opts out.
- Note posters are 1080×1440 PNG, one to four pages, fixed readable type, paragraph/sentence boundaries, no truncation.
- AI classification only chooses `mochi` or `molly`; failures fall back to `molly`; static assets are used.
- Raw Markdown MD5 controls source invalidation; render hash also covers template, renderer, font, and character assets.
- A WeChat failure never blocks the website; once published to WeChat, later source edits are website-only.
- Do not migrate or rewrite old article bodies and do not add a dependency absent from the lockfile.

---

### Task 1: Frontmatter and album content model

**Files:**
- Create: `scripts/content/frontmatter.cjs`
- Create: `scripts/content/albums.cjs`
- Modify: `scripts/prepare-content.cjs`
- Test: `tests/blog-content.test.mjs`

**Interfaces:**
- Produces: `parseFrontmatter(source, filename) -> { attributes, bodySource, hasFrontmatter }`
- Produces: `loadAlbums({ albumsDir, posts }) -> Album[]`
- Extends posts with `kind`, `wechat`, `cast`, `albumSlug`, and `track`.
- Extends `loadBlog()` with `albums`, `independentArticles`, and `smallTalks` while retaining `posts`, `latestEssay`, and `latestNotes`.

- [ ] **Step 1: Add failing frontmatter and routing tests**

```js
assert.equal(parsePost({ filename, source: "---\nkind: note\nwechat: false\ncast: mochi\n---\n正文" }).kind, "note");
assert.equal(independent.kind, "article");
assert.equal(independent.albumSlug, null);
assert.throws(() => loadBlog({ publishedDir, albumsDir }), /Album reference.*not found/);
assert.deepEqual(album.tracks.map((post) => post.track), [1, 2, 3]);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/blog-content.test.mjs`
Expected: FAIL because frontmatter, album loading, and new collections do not exist.

- [ ] **Step 3: Implement a dependency-free strict frontmatter parser**

```js
module.exports = { parseFrontmatter };

const RESERVED_KEYS = new Set([
  "kind", "album", "track", "wechat", "cast", "slug", "status",
  "featured", "order", "cover", "cover_alt", "cover_cast", "description",
]);
```

`parseFrontmatter` accepts booleans, integers, quoted or unquoted scalar strings, and one-line flat arrays. It rejects duplicate keys, nested mappings, multiline YAML, unterminated delimiters, and unsupported reserved-key value types. Unknown scalar keys remain available for future authored metadata but never affect routing.

The parser must remove frontmatter before Markdown rendering, preserve body bytes after the closing delimiter, and reject malformed/duplicate reserved keys with the filename in the error.

- [ ] **Step 4: Implement content normalization and album resolution**

```js
module.exports = { loadAlbums, resolveAlbumReference };

const ALLOWED_KINDS = new Set(["album", "article", "note"]);
const ALLOWED_CASTS = new Set(["auto", "mochi", "molly", "none"]);
```

Album files keep stable human-readable basenames under `content/albums/` and are never timestamp-renamed. `resolveAlbumReference` accepts exactly `[[Album basename]]`; the timestamp rename of a published article therefore cannot invalidate its article-to-album edge. Duplicate album basenames, duplicate slugs, duplicate order, multiple featured albums, non-positive tracks, and duplicate tracks in one album fail validation.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/blog-content.test.mjs`
Expected: PASS.

```bash
git add scripts/content/frontmatter.cjs scripts/content/albums.cjs scripts/prepare-content.cjs tests/blog-content.test.mjs
git commit -m "feat: add album and note content metadata"
```

### Task 2: Shared Writing showcase and Cover Flow

**Files:**
- Create: `scripts/render-writing-showcase.cjs`
- Create: `writing-carousel.js`
- Modify: `scripts/render-home-writing.cjs`
- Modify: `eleventy.config.mjs`
- Modify: `index.html`
- Modify: `blog/index.njk`
- Modify: `_includes/layouts/blog-shell.njk`
- Modify: `blog.css`
- Modify: `i18n.js`
- Test: `tests/blog-content.test.mjs`
- Test: `tests/locale.test.cjs`

**Interfaces:**
- Produces: `renderWritingShowcase(blog, { context: "home" | "index" }) -> string`.
- Produces: DOM contract `[data-album-carousel]`, `[data-album-slide]`, `[data-album-prev]`, `[data-album-next]`, and live status `[data-album-status]`.

- [ ] **Step 1: Add failing HTML, localization, and empty-state tests**

```js
assert.match(html, /data-album-carousel/);
assert.match(html, /data-album-slide="ai-native-content-system"/);
assert.match(html, />独立文章</);
assert.match(html, />碎碎念</);
assert.equal(dictionary.en["writing.albums"], "Albums");
assert.equal(dictionary.en["writing.smallTalks"], "Small Talks");
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/blog-content.test.mjs tests/locale.test.cjs`
Expected: FAIL on missing renderer and keys.

- [ ] **Step 3: Implement one server renderer for homepage and writing index**

```js
function renderWritingShowcase(blog, options = {}) {
  const context = options.context === "index" ? "index" : "home";
  return renderAlbumRail(blog.albums, context)
    + renderIndependentArticles(blog.independentArticles, context)
    + renderSmallTalks(blog.smallTalks, context);
}
```

The first active slide is `featured`, otherwise smallest `order`. Homepage limits article and note rows; index shows fuller lists. All author text is escaped.

- [ ] **Step 4: Implement manual carousel behavior and exact visual tokens**

```js
document.querySelectorAll("[data-album-carousel]").forEach((root) => createAlbumCarousel(root));
root.addEventListener("keydown", onCarouselKeydown);
root.addEventListener("pointerdown", onCarouselPointerDown);
```

`onCarouselKeydown` handles ArrowLeft, ArrowRight, Home, and End. Pointer release changes one slide only after a horizontal movement threshold and ignores vertical scrolling. Every selection updates `aria-current`, the live status, slide tab stops, and the `album=<slug>` query parameter without reloading.

Use CSS custom property `--album-offset`; selected slide is front-facing, neighbors use `rotateY(calc(var(--album-offset) * -22deg))`, reduced motion removes animated transitions, focus rings remain visible, and mobile keeps touch scrolling usable.

- [ ] **Step 5: Wire both pages and localization**

Add `writing-carousel.js` as a passthrough copy and module script in both shells. Replace `查看全部文章` with `查看全部写作`. Keep homepage and blog contexts on one data/rendering interface.

- [ ] **Step 6: Run tests, build, and commit**

Run: `node --test tests/blog-content.test.mjs tests/locale.test.cjs`
Expected: PASS.

Run: `pnpm build`
Expected: Eleventy exits 0 and emits homepage plus `/blog/`.

```bash
git add scripts/render-writing-showcase.cjs scripts/render-home-writing.cjs writing-carousel.js eleventy.config.mjs index.html blog/index.njk _includes/layouts/blog-shell.njk blog.css i18n.js tests/blog-content.test.mjs tests/locale.test.cjs
git commit -m "feat: redesign writing around album cover flow"
```

### Task 3: Album pages, asset copying, and Obsidian guard

**Files:**
- Create: `blog/album.njk`
- Modify: `eleventy.config.mjs`
- Modify: `.githooks/obsidian_guard.py`
- Modify: `scripts/setup-obsidian-vault.py`
- Modify: `docs/obsidian-publishing.md`
- Test: `tests/blog-content.test.mjs`
- Test: `tests/git-guard.test.mjs`

**Interfaces:**
- Album URL: `/blog/albums/<slug>/`.
- Album cover public URL: `/blog/assets/<validated content/assets relative path>`.

- [ ] **Step 1: Add failing album output and guard tests**

```js
assert.equal(album.url, "/blog/albums/ai-native-content-system/");
assert.ok(blog.attachments.includes("albums/ai-native-content-system/cover.png"));
assert.match(albumPage, /01.*02.*03/s);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/blog-content.test.mjs tests/git-guard.test.mjs`
Expected: FAIL because Album MD and cover paths are not accepted or emitted.

- [ ] **Step 3: Implement album page generation and safe assets**

Generate one page per album, copy only validated referenced covers, and render description, status, cover alt, ordered tracks, and empty album state.

- [ ] **Step 4: Extend the Obsidian guard**

Permit `content/albums/*.md` and only album assets referenced by an Album MD. Preserve all existing symlink, traversal, and unrelated-code rejection behavior.

- [ ] **Step 5: Run tests, build, and commit**

Run: `node --test tests/blog-content.test.mjs tests/git-guard.test.mjs && pnpm build`
Expected: PASS and build exit 0.

```bash
git add blog/album.njk eleventy.config.mjs .githooks/obsidian_guard.py scripts/setup-obsidian-vault.py docs/obsidian-publishing.md tests/blog-content.test.mjs tests/git-guard.test.mjs
git commit -m "feat: publish album metadata and pages"
```

### Task 4: Deterministic note posters and character routing

**Files:**
- Create: `scripts/wechat/note-poster.cjs`
- Create: `scripts/wechat/note-cast.cjs`
- Create: `assets/writing/mochi-note.png`
- Create: `assets/writing/molly-note.png`
- Modify: `scripts/wechat/content.cjs`
- Test: `tests/wechat-content.test.mjs`

**Interfaces:**
- Produces: `selectNoteCast(post, { classify }) -> Promise<"mochi" | "molly" | "none">`.
- Produces: `paginateNote(post, options) -> PosterPage[]`.
- Produces: `renderNotePosters(post, options) -> Promise<{ pages, files, renderHash, cast }>`.
- Produces: `buildNewspic(post, { imageMediaIds, author, siteUrl }) -> WeChatArticle`.

- [ ] **Step 1: Add failing cast, pagination, hash, and payload tests**

```js
assert.equal(await selectNoteCast({ cast: "auto" }, { classify: async () => ({ cast: "mochi", confidence: 0.9 }) }), "mochi");
assert.equal(await selectNoteCast({ cast: "auto" }, { classify: async () => { throw new Error("offline"); } }), "molly");
assert.ok(paginateNote(note).length >= 1 && paginateNote(note).length <= 4);
assert.equal(buildNewspic(note, input).article_type, "newspic");
assert.deepEqual(buildNewspic(note, input).image_info.image_list, mediaIds.map((image_media_id) => ({ image_media_id })));
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/wechat-content.test.mjs`
Expected: FAIL on missing modules and newspic builder.

- [ ] **Step 3: Implement constrained cast routing**

Accept only `mochi`, `molly`, `none`, or `auto`. The classifier result must have an allowed cast and numeric confidence at or above the configured threshold; every other outcome returns `molly`.

- [ ] **Step 4: Implement layout measurement, four-page limit, and deterministic SVG/PNG capture**

```js
module.exports = {
  NOTE_POSTER_HEIGHT: 1440,
  NOTE_POSTER_WIDTH: 1080,
  paginateNote,
  renderNotePosters,
};
```

`paginateNote` packs parsed Markdown blocks against injected pixel measurements. A block that does not fit is segmented with `/[^。！？!?]+[。！？!?]?/gu`; a sentence that still does not fit is split at Unicode grapheme boundaries. The renderer rejects a fifth page instead of reducing the configured body type size.

Use source date only, never the current clock, in poster content. More than four pages throws an error with `code = "content_too_long"`. Tests inject measurement and capture so they do not require Chrome.

- [ ] **Step 5: Implement native newspic payload and commit**

Run: `node --test tests/wechat-content.test.mjs`
Expected: PASS.

```bash
git add scripts/wechat/note-poster.cjs scripts/wechat/note-cast.cjs scripts/wechat/content.cjs assets/writing/mochi-note.png assets/writing/molly-note.png tests/wechat-content.test.mjs
git commit -m "feat: render small talks as native image drafts"
```

### Task 5: MD5-aware native image sync

**Files:**
- Modify: `scripts/wechat/client.cjs`
- Modify: `scripts/wechat/sync.cjs`
- Modify: `scripts/wechat/state.cjs`
- Modify: `docs/wechat-draft-sync.md`
- Test: `tests/wechat-client.test.mjs`
- Test: `tests/wechat-sync.test.mjs`

**Interfaces:**
- Client adds `uploadNewspicImage(filename) -> mediaId` using permanent image upload.
- State post records add `sourceMd5`, `renderHash`, `generatedImages`, and `draftKind`.
- `syncOnePost` dispatches `article` to `news` and `note` to `newspic` unless `wechat === false`.

- [ ] **Step 1: Add failing API and state transition tests**

```js
assert.equal(saved.posts[id].sourceMd5, md5(rawSource));
assert.equal(client.updateDraftCalls.length, 1);
assert.equal(client.addDraftCalls.length, 0);
assert.equal(result.action, "website-only");
assert.equal(optedOut.action, "wechat-disabled");
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/wechat-client.test.mjs tests/wechat-sync.test.mjs`
Expected: FAIL on note upload, MD5 state, and opt-out.

- [ ] **Step 3: Implement MD5/render cache and same-draft updates**

```js
function sourceMd5(source) { return crypto.createHash("md5").update(Buffer.from(source)).digest("hex"); }
function noteNeedsRender(previous, prepared) { return previous?.sourceMd5 !== prepared.sourceMd5 || previous?.renderHash !== prepared.renderHash; }
```

Generated images live under `.wechat-sync/generated/<post-id>/`. Reuse them only when both hashes and file inventory match. Never regenerate or update the draft after `everPublished`.

- [ ] **Step 4: Implement independent failure reporting**

Record note rendering/upload failures in the post sync record and continue processing other records. Dry-run validates payload and pagination without API mutation or state writes.

- [ ] **Step 5: Run tests, full build, and commit**

Run: `node --test tests/wechat-client.test.mjs tests/wechat-sync.test.mjs tests/wechat-content.test.mjs`
Expected: PASS.

Run: `pnpm build`
Expected: exit 0.

```bash
git add scripts/wechat/client.cjs scripts/wechat/sync.cjs scripts/wechat/state.cjs docs/wechat-draft-sync.md tests/wechat-client.test.mjs tests/wechat-sync.test.mjs
git commit -m "feat: sync md5-aware native note drafts"
```

### Task 6: Retire background publication and stop at the draft box

**Scope amendment (2026-08-11):** The owner canceled automatic publication and withdrawal as insufficiently stable. The supported unattended workflow must end after a verified draft add/update. Existing lifecycle source and historical state may remain for compatibility, but no supported background or package entry point may invoke it.

**Files:**
- Modify: `scripts/wechat-mac-agent.cjs`
- Modify: `scripts/wechat-sync.cjs`
- Modify: `scripts/wechat/sync.cjs`
- Modify: `package.json`
- Modify: `docs/wechat-draft-sync.md`
- Modify: `docs/obsidian-publishing.md`
- Test: `tests/wechat-mac-agent.test.mjs`
- Test: `tests/wechat-sync.test.mjs`

**Interfaces:**
- `runAgent()` invokes exactly one child: `wechat-sync.cjs --automatic` plus optional `--dry-run` or `--force`.
- Legacy `WECHAT_AUTO_PUBLISH`, `WECHAT_AUTO_WITHDRAW`, and browser-session settings never authorize an Agent browser or publisher child.
- Draft sync runs in draft-only mode: never-published records cannot become `pending`; legacy publisher arming is cleared without erasing historical published identity.
- Supported `package.json` commands expose draft sync/Agent only, not publisher login/arm/run/resolve.

- [x] **Step 1: Add failing draft-only Agent and state tests**

```js
process.env.WECHAT_AUTO_PUBLISH = "1";
process.env.WECHAT_AUTO_WITHDRAW = "1";
runAgent({ commandRunner });
assert.deepEqual(childNames, ["wechat-sync.cjs"]);
assert.equal(saved.posts[id].publication.status, "draft_only");
assert.equal(saved.publisher.armedAt, null);
assert.equal(Object.keys(pkg.scripts).some((name) => name.startsWith("wechat:publisher:")), false);
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `node --test tests/wechat-mac-agent.test.mjs tests/wechat-sync.test.mjs`
Expected: FAIL because the Agent still invokes `wechat-publish.cjs`, templates still advertise browser flags, armed draft sync still creates `pending`, and publisher package commands remain exposed.

- [x] **Step 3: Remove the background publisher boundary**

Delete the publisher child invocation from `runAgent()`. Do not condition it on environment flags: the Agent must ignore legacy values, including `1`. Remove automatic publication/browser fields from newly created private environment templates and status suggestions. Preserve API draft credentials, the process lock, dedicated checkout, polling, dry-run, force, logs, and last-run state.

- [x] **Step 4: Make sync state explicitly draft-only**

Draft synchronization must clear publisher arming metadata and downgrade never-published `pending` or publish-blocked records to a non-eligible manual/draft-only status before any API work. New or updated drafts remain non-eligible. Preserve `everPublished`, public URLs, platform IDs, and reconciliation history for old records; do not reinterpret a historical published record.

- [x] **Step 5: Remove supported publisher commands and rewrite operator docs**

Remove `wechat:publisher:*` scripts from `package.json`. Documentation must show only Markdown/Obsidian → website → WeChat draft box → manual review/publish. Remove instructions to log in, arm, enable, retry, resolve, or automatically withdraw. Explicitly state that moving/deleting a Markdown file never mutates a published WeChat item.

- [x] **Step 6: Verify and commit**

Run: `node --test tests/wechat-mac-agent.test.mjs tests/wechat-sync.test.mjs tests/wechat-content.test.mjs tests/wechat-client.test.mjs`
Expected: PASS.

Run: `pnpm build`
Expected: exit 0.

```bash
git add scripts/wechat-mac-agent.cjs scripts/wechat-sync.cjs scripts/wechat/sync.cjs package.json docs/wechat-draft-sync.md docs/obsidian-publishing.md tests/wechat-mac-agent.test.mjs tests/wechat-sync.test.mjs docs/superpowers/plans/2026-08-11-writing-albums-newspic.md
git commit -m "refactor: stop WeChat automation at drafts"
```
