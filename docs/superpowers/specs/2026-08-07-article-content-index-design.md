# Article Content Index Design

**Status:** Design complete; awaiting written-spec review  
**Date:** 2026-08-07  
**Scope:** Hybrid local retrieval for published articles; semantic search degrades safely at runtime

## 1. Context

The content system currently has two published essays in `content/published/`. The existing parser in `scripts/prepare-content.cjs` already derives stable article IDs, titles, dates, types, summaries, tags, permanent URLs, rendered HTML, plain text, and referenced assets. Eleventy turns that data into the blog timeline, article pages, tag archives, RSS, sitemap, and homepage excerpts. The Mac Agent separately syncs the same published Markdown to WeChat drafts.

The current tag archives answer “which articles use this exact author-created tag?” They do not answer “where have I expressed a similar idea before?” The original blog design explicitly left full-text search out of scope. That omission now blocks the intended next step of the personal content center: finding earlier judgments before drafting a new article.

The first use case is private and author-facing. Before writing a third article, Ethan should be able to describe a topic in natural language and recover the relevant article sections, original wording, source lines, and permanent links. A public website search can reuse a sanitized form of the index later, but it is not part of this delivery.

## 2. Goals

1. Build a deterministic, rebuildable index from published Markdown without adding YAML or manual metadata.
2. Retrieve specific sections and passages, not only whole-article links.
3. Support Chinese and English lexical retrieval entirely offline.
4. Add local semantic retrieval without sending article text or queries to a cloud service.
5. Expose one human-readable command and one stable structured interface for writing assistants.
6. Refresh automatically when published content is added, changed, deleted, or replaced by a branch switch.
7. Keep blog builds and WeChat synchronization independent from index availability.
8. Preserve the existing rule that published Markdown is the only source of truth.

## 3. Non-goals

- Indexing `content/drafts/`, the full Obsidian Vault, or private notes.
- Adding a public search box to the Writing page.
- Building a knowledge graph or topic-map visualization.
- Generating, rewriting, or merging article prose.
- Adding another distribution platform.
- Requiring Vercel, a hosted database, OpenAI API access, or a background server.
- Blocking website or WeChat publishing when indexing fails.
- Performing OCR on article images.

## 4. Chosen Approach

The implementation will use a local hybrid index:

1. A deterministic structural layer turns each article into article metadata and heading-aware passage chunks.
2. A lexical layer provides offline Chinese and English retrieval with field weighting and phrase bonuses.
3. A local semantic layer generates multilingual embeddings through the existing Ollama installation and degrades to lexical retrieval when Ollama is unavailable.
4. A ranking layer fuses lexical and semantic rankings and groups matching passages by article.
5. Two CLI interfaces serve humans and model-independent writing assistants.

This approach is preferred over tag-only navigation because it can recover untagged passages, and over a public-only full-text search because the primary requirement is author retrieval with source-file locations. It also keeps semantic data local and does not introduce a service that must be available for ordinary publishing.

## 5. Architecture

```text
content/published/*.md
        │
        ▼
existing article parser (`scripts/prepare-content.cjs`)
        │
        ├── article metadata
        └── Markdown source
                │
                ▼
heading-aware chunker with source line maps
                │
                ▼
deterministic local index
        ┌───────┴────────┐
        ▼                ▼
lexical ranking    local Ollama embeddings
        └───────┬────────┘
                ▼
reciprocal-rank fusion and article grouping
        ┌───────┴────────┐
        ▼                ▼
human CLI        structured context CLI
```

The index is a derived local artifact under `.content-index/`. It is ignored by Git and can be deleted at any time. The next query or explicit build recreates it from Markdown.

## 6. Components

```text
scripts/content-index/
├── chunks.cjs       Build heading paths and passage chunks with source lines
├── schema.cjs       Define schema versions, validation, and fingerprints
├── builder.cjs      Build or incrementally refresh local index artifacts
├── tokenize.cjs     Normalize and tokenize Chinese and English text
├── lexical.cjs      Build postings and calculate lexical scores
├── semantic.cjs     Call Ollama and maintain the vector cache
└── search.cjs       Fuse rankings, group articles, and explain matches

scripts/
├── content-index.cjs    Explicit build and diagnostics entry point
├── content-search.cjs   Human-readable search entry point
└── content-context.cjs  Stable machine-readable retrieval entry point
```

`scripts/prepare-content.cjs` remains the only implementation of article-level parsing rules. The index imports its public functions and does not duplicate title, tag, summary, timestamp, or URL logic.

## 7. Index Data Model

### 7.1 Local files

```text
.content-index/
├── index-v1.json
└── vectors-v1.json
```

`index-v1.json` contains the corpus manifest, documents, chunks, and lexical postings in one file so a temporary-file rename can replace the lexical index atomically. It contains no volatile timestamp; unchanged source content produces byte-identical output.

`vectors-v1.json` is an optional cache. It has its own schema, model, instruction, dimension, and corpus compatibility fields. An incompatible or damaged vector cache is ignored and can be rebuilt without invalidating lexical search.

### 7.2 Article record

Each article record contains:

- `id`: the existing timestamp-derived stable article ID;
- `filename`: repository-relative published Markdown filename;
- `type`: `Essay` or `Note` from the current parser;
- `title` and `summary`;
- `tags`: normalized keys and authored labels;
- `publishedAt`: the existing ISO timestamp;
- `url`: the permanent public URL;
- `sourceHash`: SHA-256 of the Markdown source;
- `chunkIds`: ordered passage references.

No absolute home directory or credential path is stored.

### 7.3 Chunk record

Each chunk contains:

- `id`: SHA-256 of article ID, heading path, normalized text, and chunk ordinal;
- `articleId`;
- `headingPath`: ordered authored heading labels;
- `text`: plain-text passage content;
- `startLine` and `endLine`: one-based inclusive Markdown source lines;
- `contentHash`: SHA-256 of the normalized passage;
- `imageAltText`: local image descriptions that belong to the passage;
- lexical field tokens used to build postings.

Chunk IDs intentionally change when passage content changes. The unchanged content hash lets the semantic layer reuse vectors for unchanged passages.

## 8. Chunking Rules

1. The article title is metadata and is not repeated as a body chunk.
2. Level-two through level-six headings create a heading path. Level-one headings after the article title are treated as section headings.
3. A heading starts a new natural section. Text never crosses an article boundary.
4. Sections between approximately 300 and 800 visible Chinese characters remain one chunk.
5. Longer sections split at paragraph boundaries. Adjacent prose may overlap by at most one short paragraph when required to preserve context.
6. Lists and blockquotes remain intact unless a single block alone exceeds the maximum size.
7. Image alt text is indexed with the surrounding passage; image bytes are not inspected.
8. Inline code is retained as text. Fenced code blocks are excluded from semantic text and lexical body tokens in version 1 to avoid overwhelming prose retrieval.
9. Tag-only lines and reserved `#essay` or `#note` directives remain excluded by the current parser.
10. Empty headings and passages containing only an image are not emitted as standalone chunks.

Markdown token line maps are authoritative for source positions. Tests must prove that reported one-based lines select the displayed source passage.

## 9. Lexical Retrieval

### 9.1 Tokenization

- Unicode normalization uses NFKC.
- English tokens are lowercased and split on non-letter/non-number boundaries.
- Chinese text emits meaningful single characters, overlapping bigrams, and the normalized full query phrase.
- Product names, acronyms, numbers, and inline-code identifiers are preserved.
- Chinese stop words are not aggressively removed in version 1.

### 9.2 Scoring

BM25 supplies the base score for each field. Field weights are:

```text
article title   4.0
article tags    3.0
heading path    2.5
summary         1.5
passage body    1.0
image alt text  0.5
```

An exact normalized query phrase adds a deterministic bonus. Recency adds no bonus; old judgments must remain retrievable. Empty queries are rejected rather than returning the whole corpus.

### 9.3 Grouping and explanations

The default result set contains at most five articles and two passages per article. Each result shows:

- article title and permanent URL;
- heading path;
- matching original passage;
- repository-relative Markdown filename and line range;
- matched fields or terms explaining why the result appeared.

The highest-ranked passage determines article order, with a small secondary contribution from the next passage in the same article.

## 10. Local Semantic Retrieval

### 10.1 Provider

The default provider is the local Ollama API at `http://127.0.0.1:11434/api/embed`, using `qwen3-embedding:0.6b`. The model is approximately 639MB, designed for embedding tasks, and supports more than 100 languages. It is appropriate for the current Apple Silicon Mac with 16GB memory. The implementation never downloads a model implicitly.

Initial setup is explicit:

```bash
ollama pull qwen3-embedding:0.6b
```

The model choice and API are documented by Ollama at <https://ollama.com/library/qwen3-embedding>.

### 10.2 Vector inputs and cache

Document embeddings use a versioned instruction plus article title, heading path, and passage text. Query embeddings use a separate versioned retrieval instruction plus the query. The exact instruction strings are constants covered by tests so a change invalidates the corresponding cache.

Vectors are stored as Base64-encoded `Float32Array` values with:

- model name;
- embedding dimension;
- document-instruction version;
- chunk content hash;
- vector bytes.

Only new or changed chunks call Ollama. Deleted chunks are removed. Model, dimension, instruction, or schema mismatches invalidate the cache entries they affect.

### 10.3 Hybrid ranking and degradation

Cosine similarity ranks semantic candidates. Lexical and semantic lists are combined with Reciprocal Rank Fusion:

```text
hybrid score = 1.00 / (60 + lexical rank)
             + 1.25 / (60 + semantic rank)
```

The small semantic preference supports paraphrase retrieval without allowing a semantically broad match to erase a strong exact match.

`--semantic auto` is the default. If Ollama is stopped, times out, or lacks the configured model, the command prints one concise warning and returns lexical results. `--semantic on` makes such a failure fatal for diagnostics; `--semantic off` never contacts Ollama.

## 11. Commands and Interfaces

Package scripts expose:

```bash
pnpm content:index
pnpm content:index -- --semantic
pnpm content:search "平台依赖和内容归属"
pnpm content:search "平台依赖和内容归属" -- --semantic off --limit 5
pnpm content:context "平台依赖和内容归属" -- --json --limit 8 --max-chars 12000
```

### Human search

`content:search` prints ranked articles, heading paths, source excerpts, relative source locations, URLs, and match explanations. It exits successfully when no result is found and says so plainly.

### Writing-assistant context

`content:context --json` returns a versioned object containing:

- normalized query;
- retrieval mode actually used;
- corpus fingerprint;
- ranked passages and article metadata;
- relative source locations and public URLs;
- truncation information.

It does not generate “what to write next.” A writing assistant consumes these cited passages and separately reasons about existing claims, possible extensions, and repetition risk. This keeps retrieval deterministic and model-independent.

## 12. Refresh and Incremental Behavior

Every build or query performs a cheap corpus check:

1. Enumerate `content/published/*.md` in stable filename order.
2. Hash each source file.
3. Compare filename and source hash with the current index.
4. Reuse unchanged article records and chunks.
5. Reparse new or changed sources.
6. Remove deleted articles and their chunks.
7. Rebuild lexical postings from the resulting deterministic chunk set.
8. Write a complete temporary index and atomically rename it.

A changed Git branch naturally produces a different corpus fingerprint and refreshes the index. A missing, malformed, or unsupported index schema triggers a full rebuild. If the process is interrupted before rename, the previous complete index remains usable.

The index is not added to Git hooks and does not run as part of the WeChat Agent. It can be rebuilt independently on any device after pulling the repository.

## 13. Error Handling and Privacy

- Empty query: print usage and return a non-zero validation exit code.
- Invalid CLI option: identify the option and return a non-zero validation exit code.
- Markdown parse error: identify the repository-relative source file; do not replace the current index.
- Corrupt lexical index: rebuild once; if rebuilding fails, report the source error.
- Corrupt or incompatible vector cache: ignore it, preserve lexical search, and rebuild vectors only when requested.
- Ollama offline or model missing in auto mode: warn and fall back to lexical search.
- Ollama failure in required mode: exit non-zero without modifying vector cache.
- Concurrent build: use an atomic lock with stale-owner recovery; a second query waits briefly or uses the latest complete index.
- Index JSON: no absolute home path, environment values, WeChat credentials, access tokens, or draft content.
- `.content-index/`: added to `.gitignore` and treated as disposable local data.

Index failure never blocks Eleventy, Vercel, GitHub Pages, Obsidian Git, or WeChat synchronization.

## 14. Writing Workflow

Before starting a substantial new article:

1. Write a one-sentence proposed thesis.
2. Search that thesis in its natural wording.
3. Search two alternative phrasings or adjacent concepts.
4. Review the cited passages and their surrounding sections.
5. Decide whether the new piece extends, updates, contradicts, or merely repeats an earlier judgment.
6. Start the draft only after stating that distinction.

The workflow is guidance, not a publishing gate. Notes and spontaneous writing remain possible without running retrieval first.

## 15. Testing Strategy

### Unit tests

- Heading paths and one-based source lines.
- Chinese, English, acronyms, numbers, inline code, lists, quotes, image alt text, and fenced-code exclusion.
- Stable chunking at paragraph boundaries and maximum lengths.
- Deterministic schema serialization and SHA-256 fingerprints.
- Tokenization and field weights.
- BM25, exact phrase bonus, cosine similarity, RRF, article grouping, and explanations.
- Base64 `Float32Array` round trips and cache compatibility.

### Integration tests

- Build from an empty published directory.
- Add, edit, rename, and delete an article.
- Switch corpus contents to simulate a branch change.
- Detect and rebuild a malformed index.
- Preserve the previous complete index after a simulated interrupted write.
- Exclude `content/drafts/` even when a draft shares a query phrase.
- Exercise human and JSON CLI contracts.
- Mock Ollama success, timeout, missing model, invalid dimension, and offline fallback.

### Real-corpus acceptance tests

The current two published essays must satisfy:

1. `内容归属和平台依赖` ranks the first essay section “我希望原文真的属于自己” first.
2. `Mac 关机后公众号怎么办` ranks the second essay section “Mac 关机了，也没关系” first.
3. `AI 少写一点` ranks the corresponding first-essay section first.
4. Each result reports source lines that select the displayed text.
5. Semantic retrieval finds the first target when the query uses no exact authored phrase.
6. Stopping Ollama still returns a useful lexical result.

### Regression and performance

- The complete existing test suite remains green.
- Eleventy production build remains green.
- WeChat dry-run remains green and does not read `.content-index/`.
- On the current Mac, a no-change check over 1,000 simulated articles completes under one second and a query completes under 200ms, excluding a cold semantic model start.

## 16. Rollout Plan

### Phase 0: Acceptance baseline

Create real-corpus fixtures for the three required queries and record the current parser output. Define schema version 1 and the deterministic serialization contract.

### Phase 1: Structural index

Implement schema, chunking, source maps, fingerprints, atomic persistence, and incremental add/edit/delete behavior.

**Gate:** every current article section can be enumerated with correct heading paths and source lines.

### Phase 2: Offline lexical retrieval

Implement tokenization, postings, BM25 field weighting, phrase bonuses, grouping, human CLI, JSON context CLI, and automatic refresh.

**Gate:** all three real queries rank the required passage first without network access.

### Phase 3: Local semantic retrieval

Install the explicit embedding model, implement the Ollama adapter, cache vectors by content hash, calculate cosine similarity, fuse rankings, and test failure degradation.

**Gate:** paraphrased topic retrieval works and Ollama downtime falls back cleanly.

### Phase 4: Writing-assistant integration

Document and wire the stable JSON context command into the authoring assistant workflow. Keep retrieval citations visible and leave prose decisions to the user.

**Gate:** a proposed third-article thesis produces a bounded cited context package showing earlier claims and likely overlap.

### Phase 5: Reliability and documentation

Complete privacy, corruption, branch-switch, performance, regression, and from-zero rebuild tests. Update README and Obsidian workflow documentation.

**Gate:** deleting `.content-index/` and rerunning a query restores a valid index; blog and WeChat workflows remain unchanged.

The expected effort is three to four focused development days. Phases 1 and 2 create an immediately useful offline tool. The retrieval problem is considered fully solved for the stated scope only after Phases 3 through 5 also pass their gates.

## 17. Deferred Public Search

A later public-search project may export a separate sanitized index containing only already-public article fields. It must omit source filenames, line numbers, local vector caches, and diagnostics. Its interface and visual design require a separate design cycle and are not implicit in this implementation.

## 18. Rollback

All new runtime data lives under ignored `.content-index/`. Removing the package scripts and index modules restores the previous repository behavior. Deleting `.content-index/` never removes source articles. No database, account, cloud resource, or WeChat state needs cleanup.
