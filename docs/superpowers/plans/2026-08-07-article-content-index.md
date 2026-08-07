# Article Content Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic local hybrid index that retrieves cited passages from published articles before Ethan starts a new piece.

**Architecture:** Reuse the current Markdown article parser, add heading-aware chunks with source maps, persist a rebuildable lexical index under `.content-index/`, and optionally fuse results with local Ollama embeddings. Human and JSON CLIs share one retrieval service; index failures remain isolated from Eleventy and WeChat publishing.

**Tech Stack:** Node.js 20+ CommonJS, Bun-compatible CLIs, `markdown-it` 14.3.0, Node built-in test runner, SHA-256, JSON persistence, local Ollama `/api/embed`, `qwen3-embedding:0.6b`.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-07-article-content-index-design.md`.
- Only `content/published/*.md` is indexed; `content/drafts/` and the rest of the Obsidian Vault are excluded.
- Published Markdown remains the only source of truth; do not add YAML or manually maintained metadata.
- Reuse `scripts/prepare-content.cjs` for article IDs, titles, dates, types, summaries, tags, text, and URLs.
- Runtime artifacts live only under ignored `.content-index/` and contain no absolute home path, credentials, environment values, or draft content.
- `index-v1.json` is deterministic: identical source bytes produce byte-identical output and no generated timestamp.
- Lexical search works offline in Chinese and English.
- Semantic search uses local Ollama with `qwen3-embedding:0.6b`, never downloads a model implicitly, and falls back to lexical results in `auto` mode.
- Indexing never runs inside Git hooks or the WeChat Agent and never blocks Eleventy, Vercel, GitHub Pages, Obsidian Git, or WeChat synchronization.
- All production modules are CommonJS and must run under both Node.js 20+ and the installed Bun runtime.
- Tests use `node --test`; no hosted database or cloud API is added.
- Public website search, private drafts, OCR, knowledge graphs, and generated prose remain out of scope.

## File Map

### Existing files to modify

- `scripts/prepare-content.cjs`: expose line-preserving source preparation and Markdown-token parsing without changing current blog output.
- `.gitignore`: ignore `.content-index/`.
- `package.json`: add `content:index`, `content:search`, and `content:context` scripts.
- `README.md`: add the short operator entry point.
- `docs/obsidian-publishing.md`: add the pre-writing retrieval workflow.

### New production files

- `scripts/content-index/schema.cjs`: schema constants, SHA-256 helpers, validation, stable record construction, and vector encoding.
- `scripts/content-index/chunks.cjs`: heading-aware passage chunks and one-based source lines.
- `scripts/content-index/builder.cjs`: source discovery, incremental refresh, validation, locks, and atomic persistence.
- `scripts/content-index/tokenize.cjs`: NFKC normalization and Chinese/English tokenization.
- `scripts/content-index/lexical.cjs`: postings, BM25 field scores, phrase bonus, and lexical ranking.
- `scripts/content-index/semantic.cjs`: Ollama adapter, vector cache, cosine ranking, and compatibility checks.
- `scripts/content-index/search.cjs`: index freshness, hybrid fusion, article grouping, explanations, and context payloads.
- `scripts/content-index.cjs`: explicit build and diagnostic CLI.
- `scripts/content-search.cjs`: human-readable search CLI.
- `scripts/content-context.cjs`: machine-readable context CLI.
- `scripts/content-index-benchmark.cjs`: non-CI performance acceptance benchmark.
- `docs/article-content-index.md`: setup, commands, recovery, semantic mode, and workflow documentation.

### New test files

- `tests/content-index-source.test.mjs`: source preservation and parser regression.
- `tests/content-index-chunks.test.mjs`: chunk structure, headings, line ranges, and block rules.
- `tests/content-index-builder.test.mjs`: deterministic and incremental persistence.
- `tests/content-index-lexical.test.mjs`: tokenization, BM25, boosts, grouping inputs, and real lexical queries.
- `tests/content-index-cli.test.mjs`: CLI contracts and privacy.
- `tests/content-index-semantic.test.mjs`: embeddings, cache, cosine ranking, RRF, and degradation.
- `tests/content-index-recovery.test.mjs`: corruption, locks, interrupted writes, and from-zero rebuild.
- `tests/fixtures/content-index-lock-holder.cjs`: child process that owns an index lock during concurrency tests.

---

### Task 1: Expose Source-Aware Markdown Parsing

**Files:**
- Modify: `scripts/prepare-content.cjs:93-179, 221-251, 336-343`
- Create: `tests/content-index-source.test.mjs`
- Test: `tests/blog-content.test.mjs`

**Interfaces:**
- Produces: `prepareIndexSource(source: string): { bodySource: string, titleLine: number | null }`.
- Produces: `parseMarkdown(source: string): MarkdownItToken[]`.
- Produces: `plainTextFromMarkdown(source: string): string` as an exported existing helper.
- Preserves: `parsePost`, `loadBlog`, and all current blog rendering behavior.

- [ ] **Step 1: Write the failing line-preservation tests**

Create `tests/content-index-source.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseMarkdown,
  plainTextFromMarkdown,
  prepareIndexSource,
} = require("../scripts/prepare-content.cjs");

test("prepares indexable Markdown without shifting authored line numbers", () => {
  const source = [
    "# 一篇文章",
    "",
    "#内容系统 #essay",
    "",
    "## 一个判断",
    "正文第一句。",
  ].join("\n");
  const prepared = prepareIndexSource(source);
  const lines = prepared.bodySource.split("\n");

  assert.equal(prepared.titleLine, 1);
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "");
  assert.equal(lines[2], "");
  assert.equal(lines[4], "## 一个判断");

  const heading = parseMarkdown(prepared.bodySource)
    .find((token) => token.type === "heading_open");
  assert.deepEqual(heading.map, [4, 5]);
});

test("exports the same plain-text conversion used by article parsing", () => {
  assert.equal(
    plainTextFromMarkdown("**内容中心** [属于自己](https://example.com)"),
    "内容中心 属于自己",
  );
});
```

- [ ] **Step 2: Run the focused test and verify the missing-interface failure**

Run:

```bash
node --test tests/content-index-source.test.mjs
```

Expected: FAIL because `prepareIndexSource` and `parseMarkdown` are not exported functions.

- [ ] **Step 3: Add line-preserving cleaning and parsing interfaces**

Refactor the existing cleaner and title finder without changing their default output:

```js
function cleanSourceAndExtractTags(source, { preserveLines = false } = {}) {
  // Keep the existing tag extraction loop and fence handling.
  // When a tag-only line is removed, push "" when preserveLines is true.
  // Return joined text without trim only when preserveLines is true.
}

function findTitle(source, { preserveLines = false } = {}) {
  let titleLine = null;
  // Keep the existing first-H1 behavior. Replace that line with "".
  // Do not trim bodySource when preserveLines is true.
  return { authoredTitle, bodySource, titleLine };
}

function prepareIndexSource(source) {
  const { cleanedSource } = cleanSourceAndExtractTags(source, { preserveLines: true });
  const { bodySource, titleLine } = findTitle(cleanedSource, { preserveLines: true });
  return { bodySource, titleLine };
}

function parseMarkdown(source) {
  return markdown.parse(source, {});
}
```

Export `prepareIndexSource`, `parseMarkdown`, and the existing `plainTextFromMarkdown`. Keep `parsePost` calling both helpers with default options.

- [ ] **Step 4: Run parser and source-map tests**

Run:

```bash
node --test tests/content-index-source.test.mjs tests/blog-content.test.mjs
```

Expected: PASS; current title, tag, summary, URL, and HTML tests remain unchanged.

- [ ] **Step 5: Commit the parser boundary**

```bash
git add scripts/prepare-content.cjs tests/content-index-source.test.mjs
git commit -m "refactor: expose source-aware blog parsing"
```

---

### Task 2: Define Schema and Heading-Aware Chunks

**Files:**
- Create: `scripts/content-index/schema.cjs`
- Create: `scripts/content-index/chunks.cjs`
- Create: `tests/content-index-chunks.test.mjs`

**Interfaces:**
- Consumes: `prepareIndexSource`, `parseMarkdown`, and `plainTextFromMarkdown` from Task 1.
- Produces: `hashText(value: string): string`.
- Produces: `createChunkId({ articleId, headingPath, text, ordinal }): string`.
- Produces: `chunkPost({ post, source, minChars?, maxChars? }): ChunkRecord[]`.
- Produces: `validateIndex(index): void` and schema constant `INDEX_SCHEMA_VERSION = 1`.

- [ ] **Step 1: Write failing schema and chunk tests**

Create `tests/content-index-chunks.test.mjs` with these cases:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePost } = require("../scripts/prepare-content.cjs");
const { chunkPost } = require("../scripts/content-index/chunks.cjs");

const source = [
  "# 索引文章",
  "",
  "#内容系统 #essay",
  "",
  "## 为什么要索引",
  "第一段解释为什么旧判断需要找回来，保留 `API_v2`。",
  "",
  "> 一段不能被拆散的引用。",
  "",
  "### 一个例子",
  "- 第一项",
  "- 第二项",
  "",
  "![关系图](../assets/index.png)",
  "",
  "```js",
  "const secretNoise = '不进入索引';",
  "```",
].join("\n");

test("chunks an article by authored heading paths and source lines", () => {
  const post = parsePost({ filename: "2026-08-07-120000.md", source });
  const chunks = chunkPost({ post, source, minChars: 1, maxChars: 800 });

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].headingPath, ["为什么要索引"]);
  assert.equal(chunks[0].startLine, 6);
  assert.equal(chunks[0].endLine, 8);
  assert.match(chunks[0].text, /旧判断需要找回来/);
  assert.match(chunks[0].text, /API_v2/);
  assert.match(chunks[0].text, /不能被拆散的引用/);
  assert.deepEqual(chunks[1].headingPath, ["为什么要索引", "一个例子"]);
  assert.equal(chunks[1].startLine, 11);
  assert.equal(chunks[1].endLine, 14);
  assert.match(chunks[1].text, /第一项/);
  assert.deepEqual(chunks[1].imageAltText, ["关系图"]);
  assert.doesNotMatch(chunks.map((chunk) => chunk.text).join(" "), /secretNoise/);
});

test("produces stable IDs and keeps a long list or quote block intact", () => {
  const post = parsePost({ filename: "2026-08-07-120000.md", source });
  const first = chunkPost({ post, source, minChars: 1, maxChars: 40 });
  const second = chunkPost({ post, source, minChars: 1, maxChars: 40 });
  assert.deepEqual(first, second);
  assert.ok(first.every((chunk) => /^[0-9a-f]{64}$/.test(chunk.id)));
});
```

- [ ] **Step 2: Run the test and verify module-not-found failure**

Run:

```bash
node --test tests/content-index-chunks.test.mjs
```

Expected: FAIL because `scripts/content-index/chunks.cjs` does not exist.

- [ ] **Step 3: Implement schema helpers and validators**

Create `scripts/content-index/schema.cjs` with exact public constants and constructors:

```js
const crypto = require("node:crypto");

const INDEX_SCHEMA_VERSION = 1;
const VECTOR_SCHEMA_VERSION = 1;

function hashText(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function createChunkId({ articleId, headingPath, text, ordinal }) {
  return hashText(JSON.stringify([articleId, headingPath, text, ordinal]));
}

function validateIndex(index) {
  if (!index || index.schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new Error("Unsupported article index schema");
  }
  if (!Array.isArray(index.documents) || !Array.isArray(index.chunks)) {
    throw new Error("Malformed article index records");
  }
}

module.exports = {
  INDEX_SCHEMA_VERSION,
  VECTOR_SCHEMA_VERSION,
  createChunkId,
  hashText,
  validateIndex,
};
```

- [ ] **Step 4: Implement heading and block extraction**

Create `scripts/content-index/chunks.cjs`. Use token `map` values as zero-based half-open source ranges, maintain the heading path by heading level, and emit one-based inclusive lines. Select paragraph, list, and blockquote containers once so nested paragraphs are not duplicated. Skip `fence` and `code_block` tokens. Collect image child `content` as alt text.

The module must finish with:

```js
function chunkPost({ post, source, minChars = 300, maxChars = 800 }) {
  const prepared = prepareIndexSource(source);
  const tokens = parseMarkdown(prepared.bodySource);
  const blocks = extractBlocks(prepared.bodySource, tokens);
  const sections = groupBlocksByHeading(blocks);
  return sections.flatMap((section) => splitSection({
    articleId: post.id,
    section,
    minChars,
    maxChars,
  }));
}

module.exports = {
  chunkPost,
  extractBlocks,
  groupBlocksByHeading,
  splitSection,
};
```

`splitSection` may overlap only the final short prose paragraph from the previous chunk. It must never duplicate a list or blockquote container.

- [ ] **Step 5: Run chunk and parser tests**

Run:

```bash
node --test tests/content-index-source.test.mjs tests/content-index-chunks.test.mjs tests/blog-content.test.mjs
```

Expected: PASS with correct one-based line ranges and stable IDs.

- [ ] **Step 6: Commit deterministic chunks**

```bash
git add scripts/content-index/schema.cjs scripts/content-index/chunks.cjs tests/content-index-chunks.test.mjs
git commit -m "feat: chunk published articles for retrieval"
```

---

### Task 3: Build and Incrementally Persist the Structural Index

**Files:**
- Create: `scripts/content-index/builder.cjs`
- Create: `scripts/content-index.cjs`
- Create: `tests/content-index-builder.test.mjs`
- Modify: `.gitignore:1-10`
- Modify: `package.json:6-18`

**Interfaces:**
- Consumes: `loadBlog`, `chunkPost`, `hashText`, and `validateIndex`.
- Produces: `indexPaths(root): { directory, indexFile, vectorFile, lockDirectory }`.
- Produces: `buildIndex({ root, previousIndex? }): ArticleIndex`.
- Produces: `ensureIndex({ root, force?, logger? }): { index, rebuilt, changedDocuments }`.
- Produces: `readIndex(filename): ArticleIndex | null` and `writeIndexAtomic(filename, index): void`.

- [ ] **Step 1: Write failing deterministic and incremental tests**

Create `tests/content-index-builder.test.mjs` with these imports and fixture helpers, then add the tests below:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildIndex } = require("../scripts/content-index/builder.cjs");

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "article-index-builder-"));
  fs.mkdirSync(path.join(root, "content", "published"), { recursive: true });
  return root;
}

function writePost(root, filename, source) {
  fs.writeFileSync(path.join(root, "content", "published", filename), source, "utf8");
}

test("builds byte-identical index data from unchanged Markdown", () => {
  const root = fixtureRoot();
  writePost(root, "2026-08-07-120000.md", "# 标题\n\n## 章节\n正文。\n\n#essay");
  const first = buildIndex({ root });
  const second = buildIndex({ root, previousIndex: first });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.documents.length, 1);
  assert.equal(first.documents[0].filename, "content/published/2026-08-07-120000.md");
  assert.ok(first.chunks.length > 0);
});

test("reuses unchanged chunks and removes deleted documents", () => {
  const root = fixtureRoot();
  writePost(root, "2026-08-07-120000.md", "# 第一篇\n\n正文一。\n\n#essay");
  writePost(root, "2026-08-07-130000.md", "# 第二篇\n\n正文二。\n\n#essay");
  const first = buildIndex({ root });
  const unchangedIds = first.documents[0].chunkIds;

  fs.writeFileSync(
    path.join(root, "content/published/2026-08-07-130000.md"),
    "# 第二篇\n\n修改后的正文二。\n\n#essay",
  );
  fs.unlinkSync(path.join(root, "content/published/2026-08-07-120000.md"));
  const second = buildIndex({ root, previousIndex: first });

  assert.equal(second.documents.length, 1);
  assert.notDeepEqual(second.documents[0].chunkIds, unchangedIds);
  assert.ok(second.chunks.every((chunk) => chunk.articleId === second.documents[0].id));
});

test("builds a valid empty corpus", () => {
  const index = buildIndex({ root: fixtureRoot() });
  assert.deepEqual(index.documents, []);
  assert.deepEqual(index.chunks, []);
  assert.equal(typeof index.corpusFingerprint, "string");
});

test("treats a renamed article as a corpus change", () => {
  const root = fixtureRoot();
  const source = "# 可重命名文章\n\n正文。\n\n#essay";
  writePost(root, "2026-08-07-120000.md", source);
  const first = buildIndex({ root });
  fs.renameSync(
    path.join(root, "content/published/2026-08-07-120000.md"),
    path.join(root, "content/published/2026-08-07-130000.md"),
  );
  const second = buildIndex({ root, previousIndex: first });
  assert.notEqual(second.corpusFingerprint, first.corpusFingerprint);
  assert.equal(second.documents[0].filename, "content/published/2026-08-07-130000.md");
  assert.notEqual(second.documents[0].id, first.documents[0].id);
});
```

- [ ] **Step 2: Run the builder test and verify failure**

Run:

```bash
node --test tests/content-index-builder.test.mjs
```

Expected: FAIL because `builder.cjs` does not exist.

- [ ] **Step 3: Implement source discovery and document construction**

Create `scripts/content-index/builder.cjs` with sorted `content/published/*.md` discovery. Hash each raw source before parsing. Reuse previous document and chunk records only when filename and `sourceHash` match. Construct document records in this exact key order:

```js
const document = {
  id: post.id,
  filename: `content/published/${post.filename}`,
  type: post.type,
  title: post.title,
  summary: post.summary,
  tags: post.tags.map(({ normalized, label }) => ({ normalized, label })),
  publishedAt: post.iso,
  url: post.url,
  sourceHash,
  chunkIds: chunks.map((chunk) => chunk.id),
};
```

Construct the index with no current time:

```js
const index = {
  schemaVersion: INDEX_SCHEMA_VERSION,
  corpusFingerprint: hashText(JSON.stringify(sourcePairs)),
  documents,
  chunks,
  lexical: null,
};
```

- [ ] **Step 4: Implement deterministic read and atomic write**

`readIndex` returns `null` for a missing file and validates parsed data. `writeIndexAtomic` writes `${filename}.${process.pid}.tmp` with a trailing newline, mode `0600`, then calls `fs.renameSync`. Sort documents by filename and chunks by document order before serialization.

`ensureIndex` reads the prior file, rebuilds when missing, invalid, forced, or corpus fingerprints differ, and returns the existing index without rewriting when content is unchanged.

- [ ] **Step 5: Add explicit build CLI and package configuration**

Create `scripts/content-index.cjs` with argument parsing for `--force`, `--semantic`, and `--help`. At this task, accept `--semantic` but print `Semantic vectors are added in Task 6` and exit non-zero so the interface is reserved rather than silently ignored.

Add to `.gitignore`:

```text
.content-index/
```

Add to `package.json` scripts:

```json
"content:index": "bun scripts/content-index.cjs"
```

- [ ] **Step 6: Run builder tests and an actual local build**

Run:

```bash
node --test tests/content-index-builder.test.mjs
pnpm content:index
test -f .content-index/index-v1.json
git status --short
```

Expected: tests PASS; the local index exists; `.content-index/` does not appear in Git status.

- [ ] **Step 7: Commit structural indexing**

```bash
git add .gitignore package.json scripts/content-index/builder.cjs scripts/content-index.cjs tests/content-index-builder.test.mjs
git commit -m "feat: build incremental article index"
```

---

### Task 4: Add Offline Chinese and English Retrieval

**Files:**
- Create: `scripts/content-index/tokenize.cjs`
- Create: `scripts/content-index/lexical.cjs`
- Create: `tests/content-index-lexical.test.mjs`
- Modify: `scripts/content-index/builder.cjs`

**Interfaces:**
- Consumes: structural documents and chunks from Task 3.
- Produces: `normalizeText(value: string): string`.
- Produces: `tokenize(value: string): string[]`.
- Produces: `buildLexicalIndex({ documents, chunks }): LexicalIndex`.
- Produces: `searchLexical({ index, query, limit? }): LexicalHit[]` where each hit has `chunkId`, `score`, `matchedFields`, and `matchedTerms`.

- [ ] **Step 1: Write tokenizer and ranking tests**

Create `tests/content-index-lexical.test.mjs` with explicit fixtures matching the document and chunk schema:

```js
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { buildIndex } = require("../scripts/content-index/builder.cjs");
const { buildLexicalIndex, searchLexical } = require("../scripts/content-index/lexical.cjs");
const { tokenize } = require("../scripts/content-index/tokenize.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function document(id, title, chunkId) {
  return {
    id,
    filename: `content/published/${id}.md`,
    type: "Essay",
    title,
    summary: "测试摘要",
    tags: [],
    publishedAt: "2026-08-07T12:00:00+08:00",
    url: `/blog/${id}/`,
    sourceHash: id,
    chunkIds: [chunkId],
  };
}

function chunk(id, articleId, text) {
  return {
    id,
    articleId,
    ordinal: 0,
    headingPath: ["测试章节"],
    text,
    imageAltText: [],
    startLine: 3,
    endLine: 3,
    contentHash: id,
  };
}

function weightedFixture() {
  return {
    documents: [
      document("title-article", "内容归属", "title-hit"),
      document("body-article", "普通标题", "body-hit"),
    ],
    chunks: [
      chunk("title-hit", "title-article", "普通正文"),
      chunk("body-hit", "body-article", "这段正文讨论内容归属"),
    ],
  };
}

function phraseFixture() {
  return {
    documents: [
      document("exact-article", "普通标题", "exact-phrase"),
      document("loose-article", "普通标题", "loose-phrase"),
    ],
    chunks: [
      chunk("exact-phrase", "exact-article", "原文属于自己"),
      chunk("loose-phrase", "loose-article", "原文最终也应该属于自己"),
    ],
  };
}

test("tokenizes mixed Chinese, English, numbers, and identifiers", () => {
  const tokens = tokenize("AI 内容中心 API_v2");
  assert.ok(tokens.includes("ai"));
  assert.ok(tokens.includes("内"));
  assert.ok(tokens.includes("内容"));
  assert.ok(tokens.includes("容中"));
  assert.ok(tokens.includes("中心"));
  assert.ok(tokens.includes("api_v2"));
});

test("boosts title, tags, and heading above the same body term", () => {
  const index = buildLexicalIndex(weightedFixture());
  const hits = searchLexical({ index, query: "内容归属", limit: 10 });
  assert.equal(hits[0].chunkId, "title-hit");
  assert.ok(hits[0].matchedFields.includes("title"));
  assert.ok(hits[0].score > hits.at(-1).score);
});

test("gives an exact phrase a deterministic bonus", () => {
  const index = buildLexicalIndex(phraseFixture());
  const hits = searchLexical({ index, query: "原文属于自己", limit: 10 });
  assert.equal(hits[0].chunkId, "exact-phrase");
});

test("ranks the approved current-corpus headings first with lexical search", () => {
  const index = buildIndex({ root: ROOT });
  const cases = [
    ["内容归属和平台依赖", "我希望原文真的属于自己"],
    ["Mac 关机后公众号怎么办", "Mac 关机了，也没关系"],
    ["AI 少写一点", "我想让 AI 少写一点，多搬一点"],
  ];

  for (const [query, expectedHeading] of cases) {
    const [top] = searchLexical({ index: index.lexical, query, limit: 20 });
    const topChunk = index.chunks.find((candidate) => candidate.id === top.chunkId);
    assert.ok(topChunk.headingPath.includes(expectedHeading), `${query}: ${topChunk.headingPath.join(" / ")}`);
  }
});
```

- [ ] **Step 2: Run the lexical tests and verify failure**

Run:

```bash
node --test tests/content-index-lexical.test.mjs
```

Expected: FAIL because tokenizer and lexical modules do not exist.

- [ ] **Step 3: Implement deterministic mixed-language tokenization**

Create `scripts/content-index/tokenize.cjs`. Normalize with `value.normalize("NFKC").toLocaleLowerCase("zh-CN")`. Emit English/number/underscore runs. For every contiguous Han run, emit each character and each overlapping bigram; preserve the normalized full query separately in `searchLexical` for phrase matching. Deduplicate query tokens but keep repeated document tokens for term frequency.

The public exports are:

```js
module.exports = { normalizeText, tokenize };
```

- [ ] **Step 4: Implement field-aware BM25**

Create `scripts/content-index/lexical.cjs` with field weights copied from the spec:

```js
const FIELD_WEIGHTS = Object.freeze({
  title: 4.0,
  tags: 3.0,
  heading: 2.5,
  summary: 1.5,
  body: 1.0,
  imageAlt: 0.5,
});
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const EXACT_PHRASE_BONUS = 2.0;

function bm25({ tf, documentLength, averageLength, documentFrequency, documentCount }) {
  const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
  const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * documentLength / averageLength);
  return idf * (tf * (BM25_K1 + 1)) / denominator;
}
```

Build postings by chunk and field. When searching, sum weighted field scores for query tokens, add the phrase bonus when normalized field text contains the full normalized query, and sort by descending score then stable chunk ID.

- [ ] **Step 5: Include lexical data in every rebuilt index**

Modify `buildIndex` so `lexical` is always `buildLexicalIndex({ documents, chunks })`. Update `validateIndex` to require a lexical object for a fully built version-1 index. Adjust Task 3 fixtures accordingly.

- [ ] **Step 6: Run lexical, builder, and current blog tests**

Run:

```bash
node --test tests/content-index-lexical.test.mjs tests/content-index-builder.test.mjs tests/blog-content.test.mjs
```

Expected: PASS, including the three real-corpus lexical queries.

- [ ] **Step 7: Commit offline retrieval**

```bash
git add scripts/content-index/tokenize.cjs scripts/content-index/lexical.cjs scripts/content-index/builder.cjs scripts/content-index/schema.cjs tests/content-index-lexical.test.mjs tests/content-index-builder.test.mjs
git commit -m "feat: add offline article retrieval"
```

---

### Task 5: Expose Human Search and Structured Context CLIs

**Files:**
- Create: `scripts/content-index/search.cjs`
- Create: `scripts/content-search.cjs`
- Create: `scripts/content-context.cjs`
- Create: `tests/content-index-cli.test.mjs`
- Modify: `package.json:6-22`

**Interfaces:**
- Consumes: `ensureIndex` and `searchLexical`.
- Produces: `searchContent({ root, query, semanticMode?, limit?, passagesPerArticle?, maxChars?, logger? }): SearchResult`.
- Produces: `groupByArticle({ index, hits, articleLimit, passagesPerArticle }): ArticleResult[]`.
- Produces: `formatHuman(result): string`.
- Produces: `buildContextPayload(result): ContentContextV1`.

- [ ] **Step 1: Write failing grouping and CLI contract tests**

Create `tests/content-index-cli.test.mjs` with deterministic temporary content and real child-process CLI calls:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { searchContent } = require("../scripts/content-index/search.cjs");
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "article-index-cli-"));
  const published = path.join(root, "content", "published");
  fs.mkdirSync(published, { recursive: true });
  fs.writeFileSync(
    path.join(published, "2026-08-07-120000.md"),
    "# 内容系统\n\n## 原文属于自己\n内容系统应该保留可引用的原文。\n\n#essay",
    "utf8",
  );
  return root;
}

function runCli(script, root, args) {
  return spawnSync(process.execPath, [path.join(REPOSITORY_ROOT, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CONTENT_INDEX_ROOT: root },
  });
}

function runContextCli(root, args) {
  return runCli("content-context.cjs", root, args);
}

function runSearchCli(root, args) {
  return runCli("content-search.cjs", root, args);
}

test("groups at most two passages under each ranked article", async () => {
  const result = await searchContent({
    root: fixtureRoot(),
    query: "内容系统",
    semanticMode: "off",
    limit: 5,
    passagesPerArticle: 2,
  });
  assert.ok(result.articles.length <= 5);
  assert.ok(result.articles.every((article) => article.passages.length <= 2));
  assert.ok(result.articles[0].passages[0].source.startLine >= 1);
});

test("emits a stable private-safe JSON context contract", () => {
  const run = runContextCli(fixtureRoot(), ["内容系统", "--json", "--semantic", "off"]);
  assert.equal(run.status, 0);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.version, 1);
  assert.equal(payload.mode, "lexical");
  assert.ok(Array.isArray(payload.articles));
  assert.doesNotMatch(run.stdout, new RegExp(os.homedir().replaceAll("/", "\\/")));
  assert.doesNotMatch(run.stdout, /WECHAT_APP_SECRET|content\/drafts/);
});

test("rejects an empty query without dumping the corpus", () => {
  const run = runSearchCli(fixtureRoot(), []);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /query is required/i);
  assert.equal(run.stdout, "");
});

test("reports no matches as a successful empty result", () => {
  const run = runSearchCli(fixtureRoot(), ["完全不存在的术语XYZ999", "--semantic", "off"]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /没有找到相关文章|no matching articles/i);
  assert.equal(run.stderr, "");
});
```

Both entry points resolve the repository root as `process.env.CONTENT_INDEX_ROOT || process.cwd()`. This explicit override exists for tests and local tooling; it is never serialized into the index or output.

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```bash
node --test tests/content-index-cli.test.mjs
```

Expected: FAIL because search service and entry points do not exist.

- [ ] **Step 3: Implement article grouping and match explanations**

Create `scripts/content-index/search.cjs`. Join each hit to its chunk and article. Sort articles by top passage score plus `0.15 * second passage score` when present. Return relative source locations:

```js
const passage = {
  chunkId: chunk.id,
  headingPath: chunk.headingPath,
  text: chunk.text,
  source: {
    filename: document.filename,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
  },
  score: hit.score,
  matchedFields: hit.matchedFields,
  matchedTerms: hit.matchedTerms,
};
```

`searchContent` calls `ensureIndex`, performs lexical search, groups results, enforces `maxChars` by dropping the lowest-ranked passages, and reports whether truncation occurred.

- [ ] **Step 4: Implement human formatting and JSON payload**

Human output must follow this stable shape:

```text
1. 文章标题
   章节：父标题 / 子标题
   > 命中的原文片段
   位置：content/published/file.md:12
   链接：https://example.com/blog/path/
   命中：heading, body · 内容, 系统
```

The JSON payload key order is:

```js
{
  version: 1,
  query: result.query,
  normalizedQuery: result.normalizedQuery,
  mode: result.mode,
  corpusFingerprint: result.corpusFingerprint,
  truncated: result.truncated,
  articles: result.articles,
}
```

- [ ] **Step 5: Add argument parsers and package scripts**

Both CLIs accept the query as the first non-option argument. Implement exact options:

```text
--semantic auto|on|off
--limit INTEGER_FROM_1_TO_20
--passages INTEGER_FROM_1_TO_5
--max-chars INTEGER_FROM_1000_TO_100000
--json
--help
```

`content-search.cjs` defaults to human output. `content-context.cjs` requires `--json` and defaults to `--limit 8 --passages 2 --max-chars 12000`.

Add package scripts:

```json
"content:search": "bun scripts/content-search.cjs",
"content:context": "bun scripts/content-context.cjs"
```

- [ ] **Step 6: Run CLI and real-corpus smoke tests**

Run:

```bash
node --test tests/content-index-cli.test.mjs tests/content-index-lexical.test.mjs
pnpm content:search "AI 少写一点" -- --semantic off
pnpm content:context "Mac 关机后公众号怎么办" -- --json --semantic off
```

Expected: tests PASS; both commands cite the expected article section and relative source lines.

- [ ] **Step 7: Commit public command interfaces**

```bash
git add package.json scripts/content-index/search.cjs scripts/content-search.cjs scripts/content-context.cjs tests/content-index-cli.test.mjs
git commit -m "feat: expose article search context commands"
```

---

### Task 6: Add Local Ollama Embeddings and Hybrid Ranking

**Files:**
- Create: `scripts/content-index/semantic.cjs`
- Create: `tests/content-index-semantic.test.mjs`
- Modify: `scripts/content-index/search.cjs`
- Modify: `scripts/content-index/builder.cjs`
- Modify: `scripts/content-index.cjs`
- Modify: `scripts/content-search.cjs`
- Modify: `scripts/content-context.cjs`

**Interfaces:**
- Consumes: chunks, documents, vector path, and lexical hits from earlier tasks.
- Extends: `searchContent` with injectable `fetchImpl?` and `vectorCache?` dependencies used only by deterministic tests; normal calls read the cache from `indexPaths(root).vectorFile`.
- Produces: `embedTexts({ inputs, model?, endpoint?, fetchImpl?, timeoutMs? }): Promise<number[][]>`.
- Produces: `updateVectorCache({ index, cache?, embedder }): Promise<VectorCacheV1>`.
- Produces: `rankSemantic({ index, cache, queryVector, limit? }): SemanticHit[]`.
- Produces: `fuseRankings({ lexicalHits, semanticHits, limit? }): HybridHit[]`.
- Produces: `encodeVector(vector: number[]): string` and `decodeVector(value: string): Float32Array`.

- [ ] **Step 1: Write failing embedding, cache, and fallback tests**

Create `tests/content-index-semantic.test.mjs` with explicit vector and article fixtures. HTTP is always injected, so this file never depends on a running Ollama process:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ensureIndex } = require("../scripts/content-index/builder.cjs");
const { searchContent } = require("../scripts/content-index/search.cjs");
const {
  decodeVector,
  embedTexts,
  encodeVector,
  fuseRankings,
  rankSemantic,
  updateVectorCache,
} = require("../scripts/content-index/semantic.cjs");

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "article-index-semantic-"));
  const published = path.join(root, "content", "published");
  fs.mkdirSync(published, { recursive: true });
  fs.writeFileSync(
    path.join(published, "2026-08-07-120000.md"),
    "# 内容归属\n\n## 原文属于自己\n平台不应该成为唯一的内容源。\n\n#essay",
    "utf8",
  );
  return root;
}

function vectorChunk(id, contentHash, text) {
  return {
    id,
    articleId: "article",
    ordinal: 0,
    headingPath: ["章节"],
    text,
    imageAltText: [],
    startLine: 3,
    endLine: 3,
    contentHash,
  };
}

function twoChunkIndex() {
  return {
    schemaVersion: 1,
    corpusFingerprint: "two",
    documents: [],
    chunks: [
      vectorChunk("unchanged-chunk", "same-hash", "保留"),
      vectorChunk("deleted-chunk", "deleted-hash", "删除"),
    ],
  };
}

function oneUnchangedChunkIndex() {
  return {
    schemaVersion: 1,
    corpusFingerprint: "one",
    documents: [],
    chunks: [vectorChunk("unchanged-chunk", "same-hash", "保留")],
  };
}

function compatibleCache(index) {
  return {
    schemaVersion: 1,
    model: "qwen3-embedding:0.6b",
    dimension: 2,
    documentInstructionVersion: 1,
    corpusFingerprint: index.corpusFingerprint,
    entries: Object.fromEntries(index.chunks.map((chunk) => [
      chunk.id,
      { contentHash: chunk.contentHash, vector: encodeVector([1, 0]) },
    ])),
  };
}

test("calls the local Ollama embed endpoint with the configured model", async () => {
  const requests = [];
  const vectors = await embedTexts({
    inputs: ["查询：内容归属"],
    model: "qwen3-embedding:0.6b",
    endpoint: "http://127.0.0.1:11434/api/embed",
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ embeddings: [[1, 0, 0]] }), { status: 200 });
    },
  });
  assert.deepEqual(vectors, [[1, 0, 0]]);
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/embed");
  assert.equal(requests[0].body.model, "qwen3-embedding:0.6b");
});

test("reuses unchanged vectors and removes deleted chunk entries", async () => {
  let embeddedInputs = 0;
  const embedder = async (inputs) => {
    embeddedInputs += inputs.length;
    return inputs.map(() => [1, 0]);
  };
  const first = await updateVectorCache({ index: twoChunkIndex(), cache: null, embedder });
  const second = await updateVectorCache({ index: oneUnchangedChunkIndex(), cache: first, embedder });
  assert.equal(embeddedInputs, 2);
  assert.deepEqual(Object.keys(second.entries), ["unchanged-chunk"]);
});

test("auto mode warns and returns lexical results when Ollama is offline", async () => {
  const root = fixtureRoot();
  const index = ensureIndex({ root }).index;
  const warnings = [];
  const result = await searchContent({
    root,
    query: "内容归属",
    semanticMode: "auto",
    vectorCache: compatibleCache(index),
    fetchImpl: async () => { throw new Error("connection refused"); },
    logger: (message) => warnings.push(message),
  });
  assert.equal(result.mode, "lexical");
  assert.match(warnings.join("\n"), /semantic search unavailable/i);
  assert.ok(result.articles.length > 0);
});

test("round-trips Float32 vectors through Base64", () => {
  assert.deepEqual(Array.from(decodeVector(encodeVector([1.5, -2, 0]))), [1.5, -2, 0]);
});

test("rejects inconsistent embedding dimensions and missing models", async () => {
  await assert.rejects(
    embedTexts({
      inputs: ["一", "二"],
      fetchImpl: async () => new Response(JSON.stringify({ embeddings: [[1, 0], [1]] })),
    }),
    /dimension/i,
  );
  await assert.rejects(
    embedTexts({
      inputs: ["一"],
      fetchImpl: async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 }),
    }),
    /model not found|404/i,
  );
});

test("aborts a stalled Ollama request at the configured timeout", async () => {
  await assert.rejects(
    embedTexts({
      inputs: ["超时"],
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }),
    /abort|timeout/i,
  );
});

test("orders cosine matches and fuses rankings deterministically", () => {
  const index = {
    ...oneUnchangedChunkIndex(),
    chunks: [
      vectorChunk("near", "near-hash", "近"),
      vectorChunk("far", "far-hash", "远"),
    ],
  };
  const cache = {
    ...compatibleCache(index),
    entries: {
      far: { contentHash: "far-hash", vector: encodeVector([0, 1]) },
      near: { contentHash: "near-hash", vector: encodeVector([1, 0]) },
    },
  };
  assert.equal(rankSemantic({ index, cache, queryVector: [1, 0] })[0].chunkId, "near");
  const fused = fuseRankings({
    lexicalHits: [{ chunkId: "lexical", score: 10, matchedFields: ["body"], matchedTerms: ["词"] }],
    semanticHits: [{ chunkId: "semantic", score: 0.99 }],
  });
  assert.equal(fused[0].chunkId, "semantic");
  assert.deepEqual(fused.find((hit) => hit.chunkId === "lexical").matchedFields, ["body"]);
});

test("on mode makes an Ollama failure fatal", async () => {
  const root = fixtureRoot();
  await assert.rejects(
    searchContent({
      root,
      query: "内容归属",
      semanticMode: "on",
      fetchImpl: async () => { throw new Error("connection refused"); },
    }),
    /connection refused|semantic search unavailable/i,
  );
});
```

- [ ] **Step 2: Run semantic tests and verify failure**

Run:

```bash
node --test tests/content-index-semantic.test.mjs
```

Expected: FAIL because semantic exports do not exist.

- [ ] **Step 3: Implement the Ollama adapter and timeout**

Create `scripts/content-index/semantic.cjs` constants:

```js
const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/embed";
const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
const DOCUMENT_INSTRUCTION_VERSION = 1;
const QUERY_INSTRUCTION_VERSION = 1;
const DOCUMENT_INSTRUCTION = "为检索建立文章片段向量。";
const QUERY_INSTRUCTION = "为查找相关旧文章片段生成查询向量。";
```

Use `AbortSignal.timeout(timeoutMs)` with a 10-second default. Reject non-2xx responses, missing `embeddings`, count mismatches, empty vectors, non-finite values, and inconsistent dimensions. Do not log request text.

- [ ] **Step 4: Implement compatible vector persistence**

Encode vectors through a copied `Float32Array` buffer:

```js
function encodeVector(vector) {
  return Buffer.from(new Float32Array(vector).buffer).toString("base64");
}

function decodeVector(value) {
  const bytes = Buffer.from(value, "base64");
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
```

The cache must contain `schemaVersion`, `model`, `dimension`, `documentInstructionVersion`, `corpusFingerprint`, and sorted `entries`. Each entry contains `contentHash` and `vector`. Write it atomically only after every requested embedding succeeds.

- [ ] **Step 5: Implement semantic ranking and weighted RRF**

Normalize cosine input safely; a zero-magnitude vector scores zero. Rank by descending similarity then chunk ID.

Fuse rankings with:

```js
function fuseRankings({ lexicalHits, semanticHits, limit = 50 }) {
  const scores = new Map();
  lexicalHits.forEach((hit, index) => {
    scores.set(hit.chunkId, (scores.get(hit.chunkId) || 0) + 1 / (60 + index + 1));
  });
  semanticHits.forEach((hit, index) => {
    scores.set(hit.chunkId, (scores.get(hit.chunkId) || 0) + 1.25 / (60 + index + 1));
  });
  return [...scores]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, limit);
}
```

Preserve lexical match explanations on fused hits.

- [ ] **Step 6: Wire semantic modes into build and query flows**

- `content:index --semantic` refreshes document vectors after the lexical index succeeds.
- `semanticMode: "off"` never reads or calls Ollama.
- `semanticMode: "auto"` attempts query embedding only when a compatible vector cache exists; otherwise it returns lexical results with one warning.
- `semanticMode: "on"` creates missing document vectors, requires Ollama, and fails non-zero on any semantic error.
- A corpus fingerprint mismatch removes deleted entries and embeds only new content hashes.

- [ ] **Step 7: Run semantic and CLI tests**

Run:

```bash
node --test tests/content-index-semantic.test.mjs tests/content-index-cli.test.mjs tests/content-index-builder.test.mjs
```

Expected: PASS with no live Ollama dependency because HTTP is mocked.

- [ ] **Step 8: Commit local hybrid retrieval**

```bash
git add scripts/content-index/semantic.cjs scripts/content-index/search.cjs scripts/content-index/builder.cjs scripts/content-index.cjs scripts/content-search.cjs scripts/content-context.cjs tests/content-index-semantic.test.mjs tests/content-index-cli.test.mjs
git commit -m "feat: add local semantic article retrieval"
```

---

### Task 7: Harden Recovery, Concurrency, Privacy, and Performance

**Files:**
- Create: `tests/content-index-recovery.test.mjs`
- Create: `tests/fixtures/content-index-lock-holder.cjs`
- Create: `scripts/content-index-benchmark.cjs`
- Modify: `scripts/content-index/builder.cjs`
- Modify: `scripts/content-index/schema.cjs`
- Modify: `scripts/content-index/search.cjs`

**Interfaces:**
- Consumes: all index and retrieval interfaces from Tasks 1-6.
- Produces: `acquireIndexLock({ lockDirectory, waitMs?, staleMs? }): () => void` returning a release function.
- Produces: a benchmark command that exits non-zero when current-Mac gates fail.

- [ ] **Step 1: Write failing corruption, interruption, lock, and privacy tests**

Create `tests/content-index-recovery.test.mjs` with these imports and fixtures, then add all tests below:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  acquireIndexLock,
  ensureIndex,
  indexPaths,
  readIndex,
  writeIndexAtomic,
} = require("../scripts/content-index/builder.cjs");
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function fixtureRootWithPublishedPost() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "article-index-recovery-"));
  const published = path.join(root, "content", "published");
  fs.mkdirSync(published, { recursive: true });
  fs.writeFileSync(
    path.join(published, "2026-08-07-120000.md"),
    "# 可恢复文章\n\n## 判断\n完整原文。\n\n#essay",
    "utf8",
  );
  return root;
}

function writeDraft(root, filename, source) {
  const drafts = path.join(root, "content", "drafts");
  fs.mkdirSync(drafts, { recursive: true });
  fs.writeFileSync(path.join(drafts, filename), source, "utf8");
}

test("rebuilds a corrupt lexical index from Markdown", async () => {
  const root = fixtureRootWithPublishedPost();
  const paths = indexPaths(root);
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.writeFileSync(paths.indexFile, "{broken", "utf8");
  const result = await ensureIndex({ root });
  assert.equal(result.rebuilt, true);
  assert.equal(result.index.documents.length, 1);
});

test("keeps the last complete index when a temporary write fails", () => {
  const root = fixtureRootWithPublishedPost();
  const paths = indexPaths(root);
  const first = ensureIndex({ root }).index;
  const changed = structuredClone(first);
  changed.corpusFingerprint = "changed-but-valid";
  assert.throws(() => writeIndexAtomic(paths.indexFile, changed, {
    ...fs,
    renameSync: () => { throw new Error("simulated rename failure"); },
  }));
  assert.deepEqual(readIndex(paths.indexFile), first);
});

test("never indexes drafts, absolute paths, or secret-like environment values", async (t) => {
  const root = fixtureRootWithPublishedPost();
  writeDraft(root, "private.md", "PRIVATE_SENTENCE_FROM_DRAFT");
  const previousSecret = process.env.WECHAT_APP_SECRET;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.WECHAT_APP_SECRET;
    else process.env.WECHAT_APP_SECRET = previousSecret;
  });
  process.env.WECHAT_APP_SECRET = "INDEX_MUST_NOT_STORE_THIS_SECRET";
  const index = (await ensureIndex({ root, force: true })).index;
  const serialized = JSON.stringify(index);
  assert.doesNotMatch(serialized, /PRIVATE_SENTENCE_FROM_DRAFT/);
  assert.doesNotMatch(serialized, /INDEX_MUST_NOT_STORE_THIS_SECRET/);
  assert.doesNotMatch(serialized, new RegExp(root.replaceAll("/", "\\/")));
});

test("a live child-process owner blocks a second writer", async (t) => {
  const root = fixtureRootWithPublishedPost();
  const paths = indexPaths(root);
  fs.mkdirSync(paths.directory, { recursive: true });
  const holder = spawn(process.execPath, [
    path.join(TEST_DIRECTORY, "fixtures", "content-index-lock-holder.cjs"),
    paths.lockDirectory,
  ], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => holder.kill("SIGTERM"));
  const [ready] = await once(holder.stdout, "data");
  assert.match(String(ready), /locked/);
  assert.throws(
    () => acquireIndexLock({ lockDirectory: paths.lockDirectory, waitMs: 100 }),
    /another article index build is running/i,
  );
  const exited = once(holder, "exit");
  holder.kill("SIGTERM");
  await exited;
});

test("recovers a lock whose owner PID is dead", () => {
  const root = fixtureRootWithPublishedPost();
  const paths = indexPaths(root);
  fs.mkdirSync(paths.lockDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(paths.lockDirectory, "owner.json"),
    JSON.stringify({ pid: 999999, acquiredAt: Date.now() }),
    "utf8",
  );
  const release = acquireIndexLock({ lockDirectory: paths.lockDirectory, waitMs: 100 });
  assert.equal(typeof release, "function");
  release();
  assert.equal(fs.existsSync(paths.lockDirectory), false);
});
```

Create `tests/fixtures/content-index-lock-holder.cjs`:

```js
const { acquireIndexLock } = require("../../scripts/content-index/builder.cjs");

const lockDirectory = process.argv[2];
const release = acquireIndexLock({ lockDirectory });
process.stdout.write("locked\n");

function shutdown() {
  release();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
setInterval(() => {}, 1000);
```

- [ ] **Step 2: Run recovery tests and verify failures**

Run:

```bash
node --test tests/content-index-recovery.test.mjs
```

Expected: FAIL on missing lock support and injectable atomic-write operations.

- [ ] **Step 3: Add an atomic lock with stale-owner recovery**

Store `owner.json` inside `.content-index/build.lock` with PID and acquisition epoch milliseconds. Use atomic directory creation. If creation fails:

1. Read owner PID.
2. Test liveness with `process.kill(pid, 0)`.
3. Wait in 50ms intervals up to `waitMs = 2000` for a live writer.
4. Remove and reacquire only when owner is dead or the malformed lock is older than `staleMs = 30000`.
5. Return a release function that removes only a lock still owned by the current PID.

Wrap every index or vector write in `try/finally` release.

- [ ] **Step 4: Make atomic persistence injectable and recover once**

Allow `writeIndexAtomic(filename, index, fsOperations = fs)` so tests can fail `renameSync`. Delete failed temporary files without touching the prior index. `ensureIndex` catches parse or validation errors, rebuilds exactly once, and surfaces a source/build error rather than looping.

- [ ] **Step 5: Add the explicit 1,000-article benchmark**

Create `scripts/content-index-benchmark.cjs`. It must:

1. Create a temporary root with exactly 1,000 timestamp-named Markdown files containing deterministic Chinese and English prose.
2. Run one untimed `buildIndex({ root })` warm-up.
3. Time a real no-change `buildIndex({ root, previousIndex })`, including directory enumeration, source reads, hashing, unchanged-record reuse, and lexical reconstruction.
4. Run 100 deterministic `searchLexical` queries against the rebuilt index and calculate their average latency.
5. Print article count, chunk count, no-change milliseconds, average query milliseconds, and serialized index bytes.
6. Remove only the `fs.mkdtempSync` directory in a `finally` block.

Use `performance.now()` and exit non-zero when:

```text
no-change corpus check >= 1000ms
average lexical query >= 200ms
```

Do not add this benchmark to the default CI test command; it is a current-Mac acceptance command.

- [ ] **Step 6: Run reliability and benchmark verification**

Run:

```bash
node --test tests/content-index-recovery.test.mjs tests/content-index-builder.test.mjs tests/content-index-semantic.test.mjs
bun scripts/content-index-benchmark.cjs
```

Expected: all tests PASS; benchmark prints both measured values below their gates.

- [ ] **Step 7: Commit reliability hardening**

```bash
git add scripts/content-index/builder.cjs scripts/content-index/schema.cjs scripts/content-index/search.cjs scripts/content-index-benchmark.cjs tests/content-index-recovery.test.mjs tests/fixtures/content-index-lock-holder.cjs
git commit -m "test: harden article index recovery and performance"
```

---

### Task 8: Document the Writing Workflow and Complete Real Acceptance

**Files:**
- Create: `docs/article-content-index.md`
- Modify: `README.md:20-55`
- Modify: `docs/obsidian-publishing.md:65-120`
- Test: all `tests/*.test.cjs` and `tests/*.test.mjs`

**Interfaces:**
- Consumes: final commands from Tasks 3, 5, and 6.
- Produces: operator documentation and a model-independent pre-writing workflow.

- [ ] **Step 1: Write the operator document with exact commands**

Create `docs/article-content-index.md` with these sections:

1. Purpose and published-only privacy boundary.
2. Offline first build: `pnpm content:index`.
3. Human search and JSON context examples.
4. Semantic setup: `ollama pull qwen3-embedding:0.6b` and `pnpm content:index -- --semantic`.
5. `auto`, `on`, and `off` mode behavior.
6. Pre-writing three-query checklist.
7. Index location and why it is not committed.
8. Recovery by deleting `.content-index/` and rerunning a query.
9. Error messages for missing model, stopped Ollama, malformed Markdown, and an empty query.
10. Explicit statement that blog and WeChat publishing do not depend on the index.

- [ ] **Step 2: Add concise entry points to existing documentation**

In `README.md`, add a “文章索引” section after WeChat synchronization with:

```bash
pnpm content:search "内容归属和平台依赖"
pnpm content:context "内容归属和平台依赖" -- --json
```

In `docs/obsidian-publishing.md`, add the six-step pre-writing workflow from the spec and link to `docs/article-content-index.md`.

- [ ] **Step 3: Pull the explicit local model and build real vectors**

Run:

```bash
ollama pull qwen3-embedding:0.6b
pnpm content:index -- --semantic
```

Expected: model pull succeeds; vector cache reports the number of newly embedded current passages; neither model data nor `.content-index/` appears in Git status.

- [ ] **Step 4: Run all six real acceptance checks**

Run:

```bash
pnpm content:search "内容归属和平台依赖" -- --semantic on
pnpm content:search "Mac 关机后公众号怎么办" -- --semantic on
pnpm content:search "AI 少写一点" -- --semantic on
pnpm content:search "内容归属和平台依赖" -- --semantic off
pnpm content:context "第三篇想写个人内容为什么不能只依赖平台" -- --json --semantic on
```

Inspect results and confirm:

- the approved section is first for each of the first three queries;
- reported source lines contain the displayed passage;
- the offline query remains useful;
- JSON output stays under 12,000 characters and cites existing claims rather than generating prose.

Stop Ollama temporarily with `ollama stop qwen3-embedding:0.6b`, run the first command in default `auto` mode, and confirm it warns once and returns lexical results. Restart occurs automatically on the next embedding request.

- [ ] **Step 5: Run the complete regression suite and builds**

Run:

```bash
pnpm test
pnpm build
pnpm wechat:sync -- --dry-run
git diff --check
git status --short
```

Expected:

- every existing and new automated test passes;
- Eleventy writes the site successfully;
- WeChat dry-run validates both current articles without reading `.content-index/`;
- no whitespace errors;
- only intended documentation changes are uncommitted.

- [ ] **Step 6: Verify from-zero recovery**

Move `.content-index/` to a temporary backup outside the repository, run `pnpm content:search "AI 少写一点"`, confirm a valid index is recreated and the correct section is returned, then discard the backup after verification. Do not remove any Markdown source.

- [ ] **Step 7: Commit documentation and workflow**

```bash
git add README.md docs/obsidian-publishing.md docs/article-content-index.md
git commit -m "docs: document article retrieval workflow"
```

- [ ] **Step 8: Final clean-state audit**

Run:

```bash
git status --short
git log -8 --oneline
```

Expected: clean worktree and the eight task commits in order. Do not push until the user explicitly approves publishing the implementation commits.
