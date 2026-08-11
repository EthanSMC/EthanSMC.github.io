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
