# Task 5 Report — MD5-aware native image sync

## Outcome

Implemented native `newspic` synchronization for `kind: note` while preserving the existing fail-closed `news` article path. No real network, WeChat API, logged-in browser, dependency installation, or lockfile mutation was used.

The final scope was narrowed to **WeChat draft-box sync only**. Automatic publish/withdraw, live E2E, and real test content are explicitly outside Task 5. No lifecycle/publisher implementation was changed; `WECHAT_AUTO_PUBLISH` and `WECHAT_AUTO_WITHDRAW` remain documented as `0`/disabled.

## TDD record

### RED

- Client contract: 2 failures because `uploadNewspicImage` did not exist.
- First note sync: 1 failure because notes still entered the article cover path.
- Opt-out: rendering was incorrectly invoked for `wechat: false`.
- Note isolation: one rendering error aborted the whole sync loop.
- State migration: legacy records lacked normalized MD5/render/cache fields.
- Legacy article backfill: an unchanged record kept `sourceMd5: null`.
- Cached dry-run: returned `skipped` instead of validating the current `newspic` payload.
- Existing pending opt-out: stayed `pending` after `wechat: false`.
- Failed pending refresh: stayed `pending`, which could have published a stale draft.

Each RED failed for the named missing behavior before the corresponding production change.

### GREEN

- Raw source buffers are MD5 hashed into `sourceMd5`.
- Articles retain `news`; notes dispatch to `newspic`; opt-out returns `wechat-disabled`.
- One to four rendered pages upload through the permanent image material endpoint in payload order.
- Existing draft IDs use `draft/update`; only WeChat code `40007` falls back to `draft/add`.
- State records normalize and retain `sourceMd5`, `renderHash`, `generatedImages`, `draftKind`, and all lifecycle publication identity.
- Persistent note cache reuse requires matching source/render hashes plus an exact, regular-file, content-hashed inventory. Stale extra pages invalidate and are removed from the next payload.
- `everPublished` exits before rendering or API work; later changes are website-only.
- Note render/upload/API failures persist a per-post `syncError`, disarm stale pending drafts, and continue unrelated notes. Article API failures still reject the sync.
- Dry-run always validates current note pagination and payload with temporary files and placeholder media IDs, then removes temporary output without state/cache/API writes.
- `loadBlog` now receives both `root/content/published` and `root/content/albums`; range selection ignores album-only changes and includes changed note Markdown.

## Verification

- `node --check scripts/wechat/client.cjs scripts/wechat/state.cjs scripts/wechat/sync.cjs` — PASS.
- `node --test tests/wechat-client.test.mjs tests/wechat-sync.test.mjs tests/wechat-content.test.mjs` — PASS, 68/68, 0 skipped.
- Additional `tests/wechat-state.test.mjs` focused run — PASS, 16/16.
- `pnpm build` — PASS; Eleventy wrote 20 files.
- `pnpm test` — 231/232 PASS, 0 skipped. The only failure is the pre-existing real Chrome launch in `tests/wechat-browser.test.mjs`: sandboxed Chrome exits `SIGABRT` and Playwright cannot kill it (`EPERM`). This is an environment/browser launch failure before the fixture assertions, not a Task 5 business assertion; it was not converted to a skip.
- `git diff --check` — PASS.

## Files

- `scripts/wechat/client.cjs`
- `scripts/wechat/sync.cjs`
- `scripts/wechat/state.cjs`
- `docs/wechat-draft-sync.md`
- `tests/wechat-client.test.mjs`
- `tests/wechat-sync.test.mjs`

No dependency or lockfile changed. The worktree's pre-existing untracked `node_modules` symlink was not staged.

## Concerns

- Superseded by review fix round 1: current records use a Chrome-free preflight before rendering; only legacy records without `renderInputHash` require one temporary render to migrate safely.
- Permanent image media uploaded before a later draft API failure can remain orphaned remotely. The failed post is recorded and retried safely; no stale draft becomes publish-eligible.
- Full-suite Chrome fixture verification still requires an environment where local Chrome can launch. No business assertion is skipped.

## Review fix round 1/5

### Findings addressed

- Replaced recursive cache removal/creation with a strict timestamp-ID gate and non-following `lstat` verification of the repository root, `.wechat-sync`, `generated`, and the post cache directory. Missing directories are created one level at a time with private permissions and immediately reverified. Existing symlinks or non-directories fail before cache reading, deletion, or writing.
- Cache replacement now deletes only verified regular files. Symlinks and unexpected directory-like entries fail closed instead of being followed or recursively removed.
- Added a Chrome-free `renderInputHash` over the renderer source fingerprint, template/font/dimensions, layout inputs, author/site label, selected cast, and selected JPEG asset content hash.
- Added normalized `renderInputHash` and `renderCast` metadata. When source bytes are unchanged, the persisted cast is reused so a valid cache hit does not reclassify. Source changes still select the cast again.
- A non-dry, non-force run now checks source MD5 + render-input hash + exact safe inventory before rendering. Valid hits skip classification, renderer/browser work, and WeChat API calls. Dry-run continues to render and validate the current payload.
- Legacy note records without `renderInputHash` render once, compare the authoritative old `renderHash` and inventory, then migrate metadata without uploading or mutating the draft. Later runs use the preflight fast path.
- The renderer accepts the preflight-selected cast, avoiding a second classifier call. Renderer-only, config, cast, and selected asset changes invalidate the preflight input as intended.
- Draft-box-only scope remains unchanged: no publisher/lifecycle implementation or real WeChat/browser operation was modified or invoked; automatic publish/withdraw flags remain documented as `0`.

### TDD evidence

- RED: all three ancestor-symlink regressions failed because sync did not reject `.wechat-sync`, `generated`, or post-cache symlinks.
- GREEN: all three now reject with `Unsafe note cache path`; each external fixture retains only its unchanged sentinel and records zero fake-client calls.
- RED: a valid unchanged cache entered a throwing renderer; GREEN: action is `skipped`, render/classifier/browser/API call counts are all zero.
- RED: legacy metadata rendered and updated the draft; GREEN: it renders exactly once to migrate, makes zero API calls, and the next run renders zero times.
- RED: renderer ignored the preflight cast and classified again; GREEN: it uses the resolved cast with zero classifier calls.
- Added coverage for renderer/config/cast/asset fingerprint changes, selected-asset invalidation updating the same draft, and state normalization compatibility.

### Verification

- `node --check scripts/wechat/note-poster.cjs scripts/wechat/sync.cjs scripts/wechat/state.cjs` — PASS.
- `node --test tests/wechat-client.test.mjs tests/wechat-sync.test.mjs tests/wechat-content.test.mjs tests/wechat-state.test.mjs` — PASS, 92/92, 0 skipped.
- `pnpm build` — PASS; Eleventy wrote 20 files.
- `git diff --check` — PASS.
- Diff scope is limited to note poster/state/sync, their focused tests, and draft-sync documentation. No dependency, lockfile, publisher, or lifecycle file changed. The pre-existing untracked `node_modules` symlink remains unstaged.

### Remaining concerns

- `renderInputHash` is intentionally a preflight invalidation key, not a replacement for the authoritative page-level `renderHash`; legacy records therefore need one renderer run to migrate safely.
- The previously classified full-suite Chrome sandbox failure remains environment-specific and was not rerun for this focused security/cache review. No business assertion was skipped.

## Review fix round 2/5

### Findings addressed

- Removed every persistent PNG cache read/list/delete/copy/create path from draft sync. Rendered PNGs now exist only under an OS temporary directory and are removed by the sync `finally` block after upload or failure.
- The renderer's standalone default output also uses an OS temporary directory; it no longer falls back to `.wechat-sync/generated/<post-id>/`.
- Existing `.wechat-sync/generated` trees, including symlinked `generated` or post directories, are never read, listed, deleted, written, or migrated. The separate `.wechat-sync` state-directory symlink guard remains fail-closed because state itself is persistent.
- State is the sole cache authority and keeps only a strict one-to-four-page manifest: filenames must be the continuous ordered sequence `page-01.png` through the final page, with a non-empty content hash and permanent media ID for every page. One invalid, missing, or out-of-order entry rejects the whole manifest.
- Current records reuse only when raw source MD5, preflight input hash, selected cast, and the strict manifest are valid. Cache hits still perform zero renderer, classifier, browser, or API work.
- Legacy records without `renderInputHash` render once in the temporary directory and compare those temporary page hashes directly with the state manifest. No legacy generated directory participates in migration.
- Preflight and authoritative render hashes now include the actual contents of available macOS Chinese/Western/code font candidates, including Hiragino Sans GB, Arial/Arial Unicode, Menlo, and available PingFang candidates.
- The renderer fingerprint now covers both poster and cast-selection source. The runtime fingerprint includes the active Node, `playwright-core`, and `markdown-it` versions. `fontPaths`, `fontFingerprint`, and `runtimeFingerprint` are injectable for deterministic tests.
- Scope remains WeChat draft-box synchronization only. No real network, WeChat, live Chrome, publisher, or lifecycle operation was used or modified.

### TDD evidence

- RED: five new regressions failed together: font/runtime changes left the key unchanged; a gapped manifest was accepted; sync created `.wechat-sync/generated`; and generated/post-cache symlinks were inspected and rejected instead of ignored.
- GREEN: all five pass. Temporary pages are cleaned, strict manifests normalize fail-closed, and both legacy symlink layers remain untouched while the draft is added normally.
- RED: the renderer's missing-`outputDir` fallback created the repository-local generated directory.
- GREEN: the fallback returns files from a uniquely created OS temporary directory and leaves the repository without a generated tree.
- The pre-existing cache-hit regression remains green with renderer/classifier/browser/API call counts all zero.

### Verification

- `node --check scripts/wechat/note-poster.cjs scripts/wechat/sync.cjs scripts/wechat/state.cjs` — PASS.
- `node --test tests/wechat-client.test.mjs tests/wechat-sync.test.mjs tests/wechat-content.test.mjs tests/wechat-state.test.mjs` — PASS, 95/95, 0 skipped.
- `pnpm build` — PASS; Eleventy wrote 20 files.
- `git diff --check` — PASS for the five implementation/test files and this report.
- No dependency or lockfile changed. Task 6's concurrent documentation, package, Mac Agent, plan, and Mac Agent test changes were deliberately left unstaged.

### Files

- `scripts/wechat/note-poster.cjs`
- `scripts/wechat/state.cjs`
- `scripts/wechat/sync.cjs`
- `tests/wechat-content.test.mjs`
- `tests/wechat-sync.test.mjs`
- `.superpowers/sdd/2026-08-11-writing-albums-newspic/task-5-report.md`

### Remaining concerns

- Successful standalone calls to `renderNotePosters()` without `outputDir` return files in a unique OS temporary directory; the caller owns those returned files. Task 5 sync always supplies and cleans its own enclosing temporary directory.
- The previously classified full-suite Chrome sandbox failure was not rerun because this review used injected capture/render functions and the requested focused suites. No business assertion was skipped.

## Review fix round 3/5

### Finding addressed

- `renderInputHash` and the authoritative `renderHash` now include the actual browser runtime fingerprint without launching Chrome: the configured `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or explicit renderer path wins, otherwise the system/user Google Chrome channel candidates are resolved.
- Chrome identity covers the configured path, resolved real path, executable mode/size/timestamps/inode, bounded-memory SHA-256 content digest, and the containing app bundle's `Info.plist` content/stat fingerprint when present. Missing or invalid executables produce a deterministic non-launching fingerprint.
- Current process identity explicitly includes Node and Bun independently. Node-only processes hash `bun: null`; Bun processes include `Bun.version`. `markdown-it` and `playwright-core` versions remain part of the runtime fingerprint.
- Default font discovery now walks `/System/Library/Fonts`, `/Library/Fonts`, and the current user's `Library/Fonts` with stable ordering, fixed depth/file limits, supported macOS font extensions, non-following `lstat` checks, and `O_NOFOLLOW` file opens. Symlinked files/directories and unreadable entries are ignored rather than followed.
- Every accepted font fingerprint covers its path, opened-file stat identity, and bounded-memory content digest. Only the final aggregate hash is stored through `renderInputHash`; user paths are not persisted in state.
- Environment and file fingerprints are memoized in process. Normal Task 5 preflight and rendering share the result across posts; tests and callers can inject executable/font/runtime inputs, provide `discoverFontPaths`, choose an explicit cache key, or set `environmentCache: false` to recompute.
- Cache-hit behavior remains unchanged: valid source/input/manifest records perform zero classifier, renderer, browser launch, or WeChat API work.
- Scope remains draft-box only. No network, live Chrome, WeChat, publishing, withdrawal, Task 6 Mac Agent, package, or documentation behavior was changed.

### TDD evidence

- RED: 4/4 focused regressions failed because Chrome executable/path/stat/bundle changes, Node-vs-Bun identity, discovered fallback fonts, and injected discovery memoization did not affect the environment key.
- GREEN: 4/4 pass. Fake executable content/mode/path and fake `Info.plist` changes each alter the key; Bun identity differs from Node-only; nested unlisted font addition/content changes alter the key while symlink-target changes do not; injected discovery runs once for cached calls and once more when caching is explicitly disabled.
- Existing unchanged-note sync coverage remains green with zero render/classifier/browser/API calls.

### Verification

- `node --check scripts/wechat/note-poster.cjs` — PASS.
- `node --test tests/wechat-content.test.mjs tests/wechat-sync.test.mjs` — PASS, 78/78, 0 skipped.
- `pnpm build` — PASS; Eleventy wrote 20 files.
- `git diff --check` — PASS.
- No dependency or lockfile changed.

### Files

- `scripts/wechat/note-poster.cjs`
- `tests/wechat-content.test.mjs`
- `.superpowers/sdd/2026-08-11-writing-albums-newspic/task-5-report.md`

### Remaining concerns

- The first default environment fingerprint in a process reads the selected Chrome executable and discovered font files; subsequent posts reuse the memoized result. A new process or explicit cache disable intentionally recomputes it.
- Full-suite live Chrome verification remains outside this draft-only, non-launching review. No business assertion was skipped.
