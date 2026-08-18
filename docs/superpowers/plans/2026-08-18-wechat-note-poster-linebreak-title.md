# WeChat Note Poster Line Break and Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every authored Markdown line break in WeChat note posters, remove titles from poster images, and keep authored-or-date-fallback titles in the `newspic` draft metadata.

**Architecture:** Keep `parsePost` as the boundary that separates `authoredTitle` from `bodySource`. Make `note-poster.cjs` consume only parsed body blocks and preserve both Markdown soft-break and hard-break tokens as newlines; keep `content.cjs` responsible for selecting the independent WeChat draft title.

**Tech Stack:** Node.js CommonJS, `markdown-it`, SVG/HTML poster rendering, Playwright Core, Node's built-in test runner.

## Global Constraints

- This change applies only to the `kind: note` poster and `newspic` draft path.
- Every line break written inside a Markdown text block remains a line break in the poster.
- Blank lines remain separate blocks with the existing paragraph gap.
- The poster never displays the authored H1 or `碎碎念 · YYYY.MM.DD` fallback.
- The draft title uses the authored H1 when present and `碎碎念 · YYYY.MM.DD` otherwise.
- Keep the fixed body font size, 1080×1440 dimensions, one-to-four-page limit, and `content_too_long` behavior.
- Add no runtime dependency.

---

### Task 1: Decouple poster body text from draft title metadata

**Files:**
- Modify: `tests/wechat-content.test.mjs:160-330`
- Modify: `tests/wechat-content.test.mjs:665-690`
- Modify: `scripts/wechat/note-poster.cjs:16-170`
- Modify: `scripts/wechat/note-poster.cjs:290-455`
- Modify: `scripts/wechat/note-poster.cjs:829-915`

**Interfaces:**
- Consumes: `parsePost({ filename, source }) -> Post`, where `Post.authoredTitle` contains the first H1 and `Post.bodySource` excludes it.
- Produces: `paginateNote(post, options) -> PosterPage[]` whose blocks contain body content only and preserve authored `\n` characters.
- Produces: `renderNotePosters(post, options) -> Promise<{ pages, files, renderHash, cast }>` whose SVG pages contain no note title.
- Preserves: `buildNewspic(post, options) -> WeChatArticle`, with authored-title-first and source-date-fallback metadata behavior.

- [x] **Step 1: Add failing poster contract tests**

Replace title-aware assertions and measurement callbacks in `tests/wechat-content.test.mjs` with body-only expectations, and add this line-break regression test next to the existing pagination tests:

```js
test("preserves authored Markdown line breaks in poster blocks and SVG", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-line-breaks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const note = notePost({
    frontmatter: "kind: note\ncast: none",
    body: "第一行\n第二行\n\n第三段。",
  });
  const captures = [];
  const result = await renderNotePosters(note, {
    outputDir: root,
    author: "Ethan",
    siteUrl: "https://example.com",
    contentHeight: 900,
    measureBlock: () => 100,
    capture: async (input) => { captures.push(input); },
  });

  assert.deepEqual(
    result.pages.flatMap((page) => page.blocks).map((block) => block.text),
    ["第一行\n第二行", "第三段。"],
  );
  assert.match(captures[0].svg, /第一行<br \/>第二行/);
});
```

Replace the long-title poster test with a body-only contract:

```js
test("keeps an authored title out of poster blocks and SVG", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-no-title-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const title = "这是我的原文标题";
  const note = notePost({
    frontmatter: "kind: note\ncast: none",
    body: `# ${title}\n\n正文甲。正文乙。`,
  });
  const captures = [];
  const result = await renderNotePosters(note, {
    outputDir: root,
    author: "Ethan",
    siteUrl: "https://example.com",
    contentHeight: 900,
    measureBlock: () => 100,
    capture: async (input) => { captures.push(input); },
  });

  assert.deepEqual(result.pages.flatMap((page) => page.blocks).map((block) => block.text), ["正文甲。正文乙。"]);
  assert.doesNotMatch(captures[0].svg, new RegExp(title));
  assert.doesNotMatch(captures[0].svg, /note-block--title/);
});
```

Update the untitled poster assertion to require zero `title` blocks and require the SVG not to contain `碎碎念 · 2026.08.04`. Remove `block.type === "title"` exceptions and `.filter((block) => block.type !== "title")` calls from pagination tests so body-only blocks are measured and asserted directly. Change the oversized-paragraph test source to `"甲乙\n丙丁戊。👨‍👩‍👧‍👦庚辛壬癸。"`; its existing `blocks.map((block) => block.text).join("") === source` assertion then verifies that pagination preserves an authored newline across page fragments.

- [x] **Step 2: Add the authored draft-title regression assertion**

Extend the native `newspic` payload test in `tests/wechat-content.test.mjs` with a second note:

```js
const titled = buildNewspic(notePost({ body: "# 我的标题\n\n正文。" }), {
  imageMediaIds: ["poster-1"],
  author: "Ethan",
  siteUrl: "https://example.com/",
});
assert.equal(titled.title, "我的标题");
```

Keep the existing assertion that an untitled note produces `碎碎念 · 2026.08.04`; together the two assertions prevent fallback to the body-derived website title.

- [x] **Step 3: Run focused tests and verify the title contracts fail**

Run:

```bash
node --test tests/wechat-content.test.mjs
```

Expected: FAIL because `posterBlocks()` still inserts a `title` block and `pageSvg()` still exposes the note title in the generated SVG. The new line-break assertion may already pass and serves as a regression lock for the existing authored-newline behavior.

- [x] **Step 4: Render only Markdown body blocks**

In `scripts/wechat/note-poster.cjs`, make the rendering contract explicit:

```js
const NOTE_POSTER_TEMPLATE_VERSION = "note-poster-v2";
const CLASS_NAMES = new Set(["paragraph", "heading", "quote", "list", "code"]);

function normalizedInlineText(token) {
  if (!Array.isArray(token.children)) return token.content || "";
  return token.children.map((child) => {
    if (child.type === "softbreak") return "\n";
    if (child.type === "hardbreak") return "\n";
    if (child.type === "image") return child.content || "";
    return child.content || "";
  }).join("");
}
```

Delete `.note-block--title`, `posterBlocks()`, and the title branch in `defaultMeasureBlock()`. Pass `markdownBlocks(post)` directly to both pagination entry points:

```js
return paginateBlocksSync(markdownBlocks(post), { contentHeight, blockGap, measureBlock });
```

```js
const blocks = markdownBlocks(post);
```

This retains `normalizeBlockText()` behavior: it normalizes spaces around lines but does not remove the newline characters produced by Markdown break tokens.

- [x] **Step 5: Remove the poster's title dependency**

Delete `posterTitle()`. Remove the `title` parameter from `pageSvg()` by changing its signature to:

```js
function pageSvg({ page, date, cast, castData, author, site, contentHeight, blockGap }) {
```

Keep the existing function body, but replace the opening `<svg>` line in its returned template with this body-only accessible label:

```js
return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOTE_POSTER_WIDTH}" height="${NOTE_POSTER_HEIGHT}" viewBox="0 0 ${NOTE_POSTER_WIDTH} ${NOTE_POSTER_HEIGHT}" role="img" aria-label="${escapeXml(`碎碎念贴图 ${page.number}/${page.total}`)}">
```

In `renderNotePosters()`, remove `const title = posterTitle(post)`, remove `title` from the render-hash payload, and omit it from the `pageSvg()` arguments. Leave `sourceDate(post)` in place for the visible header date.

- [x] **Step 6: Run the focused tests and verify they pass**

Run:

```bash
node --test tests/wechat-content.test.mjs
```

Expected: PASS, including body line breaks, titled and untitled body-only posters, draft title metadata, pagination, cast assets, render fingerprints, and four-page rejection.

- [x] **Step 7: Run all repository tests**

Run:

```bash
npm test
```

Expected: PASS with no regression in website parsing, WeChat sync, browser publishing safeguards, or portfolio behavior.

- [x] **Step 8: Review the diff and commit the implementation**

Run:

```bash
git diff --check
git diff -- scripts/wechat/note-poster.cjs tests/wechat-content.test.mjs
git status --short
```

Confirm the diff contains only the body-only poster behavior, explicit authored-newline handling, template version bump, and tests. Then commit:

```bash
git add scripts/wechat/note-poster.cjs tests/wechat-content.test.mjs docs/superpowers/plans/2026-08-18-wechat-note-poster-linebreak-title.md
git commit -m "fix: preserve note text in WeChat posters"
```
