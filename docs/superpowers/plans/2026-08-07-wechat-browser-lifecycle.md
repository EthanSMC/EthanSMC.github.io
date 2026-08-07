# WeChat Browser Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish each newly eligible WeChat draft once and use an explicit move back to private drafts to cancel or withdraw it without a second confirmation.

**Architecture:** The existing draft API synchronizer remains the content producer. A versioned local lifecycle state and a content-free Git marker carry author intent into a deterministic Playwright adapter that uses a dedicated Chrome profile; a serial orchestrator performs cancellation/withdrawal before publication and persists state before either destructive click.

**Tech Stack:** Node.js CommonJS, Bun-compatible CLIs, `node:test`, Python 3 Obsidian Git hook, `playwright-core`, installed Google Chrome, macOS LaunchAgent.

## Global Constraints

- `content/drafts/` remains Git-ignored; no draft text, tags, title, assets, or local path may enter a lifecycle marker.
- Existing posts at arm time are baseline `manual` records and are never automatically published.
- Each non-baseline post may receive at most one automatic publish click; any post known to have been published is never automatically republished.
- Each withdrawal intent may receive at most one automatic withdrawal click; an uncertain post-click result enters reconciliation and is never clicked again automatically.
- Moving a safely unpublished post back to drafts keeps its WeChat draft and cancels publication without launching a browser.
- Login expiry, QR login, CAPTCHA, account verification, ambiguous candidates, unexpected dialogs, selector drift, and profile locking fail closed.
- Browser cookies, screenshots, HTML, tokens, and state remain outside Git under the private Agent directory.
- Use `playwright-core` with channel `chrome`; do not install or bundle a Playwright browser.
- Runtime decisions use fixed selectors and state transitions, never an LLM.
- `WECHAT_AUTO_PUBLISH=0` and `WECHAT_AUTO_WITHDRAW=0` remain the installation defaults.
- Neither current article may be used for a real publication or withdrawal test.

## File Structure

- Modify `scripts/wechat/state.cjs`: migrate version-1 JSON to lifecycle state version 2 and keep atomic persistence.
- Create `scripts/wechat/lifecycle-state.cjs`: pure status constructors, arming, eligibility, interruption recovery, and transition validation.
- Modify `.githooks/obsidian_guard.py`: translate an exact published-to-drafts move into a content-free tracked marker.
- Modify `tests/git-guard.test.mjs`: verify marker privacy, duplicate protection, and unmarked deletions.
- Create `scripts/wechat/lifecycle-intent.cjs`: validate marker files and reconcile desired source locations.
- Modify `scripts/wechat/sync.cjs`: connect draft add/update results to lifecycle eligibility and suppress WeChat mutations after first publication.
- Modify `tests/wechat-sync.test.mjs`: cover arming, cancellation, restore, terminal publication, and unmarked deletion behavior.
- Create `scripts/wechat/browser-session.cjs`: launch and close the dedicated persistent Chrome context and retain bounded private diagnostics.
- Create `scripts/wechat/browser-publisher.cjs`: deterministic page adapter for session health, exact candidate matching, publish, withdrawal, and verification.
- Create `tests/fixtures/wechat-browser/*.html`: local authenticated, login, draft, published, dialog, success, and blocker pages.
- Create `tests/wechat-browser.test.mjs`: execute the real adapter against local fixture pages.
- Create `scripts/wechat/publisher.cjs`: serial publish/withdraw state machine with injected adapter and clock.
- Create `scripts/wechat-publish.cjs`: login, arm, status, dry-run, run, retry, and resolve CLI.
- Create `tests/wechat-publisher.test.mjs`: fake-adapter integration tests and click-count assertions.
- Modify `scripts/wechat-mac-agent.cjs`: run lifecycle reconciliation after draft sync, expose browser paths, and install safe configuration defaults.
- Modify `tests/wechat-mac-agent.test.mjs`: verify environment, run order, and no-browser dry-run behavior.
- Modify `package.json` and `pnpm-lock.yaml`: add `playwright-core` and publisher commands without a browser download script.
- Modify `docs/wechat-draft-sync.md` and `docs/obsidian-publishing.md`: document arming, login, flags, withdrawal semantics, recovery, and device-hook requirement.

---

### Task 1: Versioned lifecycle state and transition rules

**Files:**
- Create: `scripts/wechat/lifecycle-state.cjs`
- Modify: `scripts/wechat/state.cjs`
- Create: `tests/wechat-state.test.mjs`

**Interfaces:**
- Consumes: version-1 state shape `{ version: 1, articleImages, covers, posts }`.
- Produces: `STATUSES`, `emptyPublication(status)`, `armPublisher(state, postIds, now)`, `publicationForNewPost(state, postId, now)`, `recoverInterruptedOperations(state, now)`, `transitionPublication(state, postId, nextStatus, patch)`, `normalizeState(value)` and atomic `saveState(filename, state)`.

- [ ] **Step 1: Write failing migration, arming, and interruption tests**

```js
test("migrates v1 posts without making them eligible", () => {
  const state = normalizeState({ version: 1, articleImages: {}, covers: {}, posts: {
    "2026-08-04-120000": { mediaId: "draft", title: "旧文章" },
  }});
  assert.equal(state.version, 2);
  assert.equal(state.posts["2026-08-04-120000"].publication.status, "manual");
  assert.equal(state.posts["2026-08-04-120000"].publication.everPublished, false);
});

test("arming is idempotent and baselines every current post", () => {
  const state = emptyState();
  armPublisher(state, ["2026-08-04-120000"], "2026-08-07T00:00:00.000Z");
  armPublisher(state, ["2026-08-04-120000"], "2026-08-08T00:00:00.000Z");
  assert.deepEqual(state.publisher.baselinePostIds, ["2026-08-04-120000"]);
  assert.equal(state.publisher.armedAt, "2026-08-07T00:00:00.000Z");
});

test("recovers persisted click states into operation-specific reconciliation", () => {
  const state = emptyState();
  state.posts.a = { publication: emptyPublication("publishing") };
  state.posts.b = { publication: emptyPublication("withdrawing") };
  recoverInterruptedOperations(state, "2026-08-07T00:00:00.000Z");
  assert.equal(state.posts.a.publication.status, "publish_reconcile");
  assert.equal(state.posts.b.publication.status, "withdraw_reconcile");
});
```

- [ ] **Step 2: Run the new state tests and verify they fail**

Run: `node --test tests/wechat-state.test.mjs`

Expected: FAIL because `lifecycle-state.cjs` and version-2 normalization do not exist.

- [ ] **Step 3: Implement the pure lifecycle module and version-2 normalization**

Use this canonical publication shape in `lifecycle-state.cjs`:

```js
const STATUSES = new Set([
  "manual", "draft_only", "pending", "publishing", "publish_reconcile",
  "published", "withdrawing", "withdraw_reconcile", "withdrawn", "blocked",
]);

function emptyPublication(status = "manual") {
  if (!STATUSES.has(status)) throw new Error(`未知公众号生命周期状态：${status}`);
  return {
    status,
    desiredLocation: "published",
    everPublished: false,
    publicationOrigin: null,
    eligibleAt: null,
    draftFingerprint: null,
    publishStartedAt: null,
    publishedAt: null,
    publishedUrl: null,
    platformArticleId: null,
    withdrawRequestedAt: null,
    withdrawStartedAt: null,
    withdrawnAt: null,
    blockedOperation: null,
    lastError: null,
  };
}
```

`normalizeState` must preserve caches and post metadata, copy only recognized lifecycle fields, convert every v1 post to `manual`, add `publisher: { armedAt: null, baselinePostIds: [], browserSessionCheckedAt: null }`, and reject neither readable v1 nor readable v2 files. `saveState` continues writing a `0600` temporary file followed by atomic rename.

- [ ] **Step 4: Add transition invariants**

`publicationForNewPost` returns `pending` only when the publisher is armed, the ID is not in `baselinePostIds`, and `everPublished` is false. `transitionPublication(state, postId, nextStatus, patch)` rejects a transition to `pending` from `published`, `withdrawn`, a baseline post, or any record with `everPublished: true`. Entering `published` sets `everPublished: true`; entering `withdrawn` retains all publication identity fields.

- [ ] **Step 5: Run state and existing sync tests**

Run: `node --test tests/wechat-state.test.mjs tests/wechat-sync.test.mjs`

Expected: PASS with no loss of existing media IDs, cover cache, or image cache.

- [ ] **Step 6: Commit the state foundation**

```bash
git add scripts/wechat/state.cjs scripts/wechat/lifecycle-state.cjs tests/wechat-state.test.mjs
git commit -m "feat: add WeChat lifecycle state"
```

### Task 2: Private-draft withdrawal intent marker

**Files:**
- Modify: `.githooks/obsidian_guard.py`
- Modify: `tests/git-guard.test.mjs`

**Interfaces:**
- Consumes: staged deletion `content/published/<YYYY-MM-DD-HHmmss>.md` plus same filename present in ignored `content/drafts/`.
- Produces: staged `content/.lifecycle/withdrawals/<POST_ID>.json` containing exactly `postId` and `requestedAt`.

- [ ] **Step 1: Add failing hook tests for a move, a plain deletion, and a duplicate**

```js
test("moving a published article to private drafts commits a content-free withdrawal marker", async () => {
  const directory = await fixture();
  const filename = "2026-07-28-120000.md";
  await rename(
    path.join(directory, "content", "published", filename),
    path.join(directory, "content", "drafts", filename),
  );
  run(directory, "git", ["add", "-A"]);
  const commit = run(directory, "git", ["commit", "-m", "blog: withdraw"], { OBSIDIAN_GIT: "1" });
  assert.equal(commit.status, 0, commit.stderr);
  const marker = JSON.parse(run(directory, "git", ["show", "HEAD:content/.lifecycle/withdrawals/2026-07-28-120000.json"]).stdout);
  assert.deepEqual(Object.keys(marker).sort(), ["postId", "requestedAt"]);
  assert.equal(marker.postId, "2026-07-28-120000");
  assert.doesNotMatch(JSON.stringify(marker), /Baseline|Published|drafts/);
});
```

The plain-deletion test must assert no marker path is committed. The duplicate test creates the same timestamped filename in both folders without deleting the published copy and expects the Obsidian commit to fail with `同一文章不能同时位于 published 和 drafts`.

- [ ] **Step 2: Run the guard tests and verify the new cases fail**

Run: `node --test tests/git-guard.test.mjs`

Expected: the move lacks a marker and the duplicate is currently accepted.

- [ ] **Step 3: Generate and stage markers before the allowlist is evaluated**

In `obsidian_guard.py`, derive staged deleted published filenames using the existing null-separated Git diff. For each deletion whose same filename exists in `content/drafts/`, write UTF-8 JSON with a UTC ISO timestamp and stage it:

```python
marker = {
    "postId": draft_path.stem,
    "requestedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}
marker_path.write_text(json.dumps(marker, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
subprocess.run(["git", "add", "--", marker_path.relative_to(root).as_posix()], cwd=root, check=True)
```

Allow only markers generated for a matching staged deletion in this commit. Do not allow arbitrary files under `content/.lifecycle/`. A plain deletion remains a valid website-only content commit.

- [ ] **Step 4: Reject same-ID duplicates before staging**

Compare timestamped basenames in both local folders. If an ID exists in both, add the exact Chinese error named in the test and reject without modifying the index.

- [ ] **Step 5: Run all hook tests**

Run: `node --test tests/git-guard.test.mjs`

Expected: PASS; marker contains no source content and private drafts remain untracked.

- [ ] **Step 6: Commit the author intent bridge**

```bash
git add .githooks/obsidian_guard.py tests/git-guard.test.mjs
git commit -m "feat: record WeChat withdrawal intent"
```

### Task 3: Desired-location reconciliation in draft sync

**Files:**
- Create: `scripts/wechat/lifecycle-intent.cjs`
- Modify: `scripts/wechat/sync.cjs`
- Modify: `tests/wechat-sync.test.mjs`

**Interfaces:**
- Consumes: `loadBlog().posts`, validated marker JSON, and version-2 state.
- Produces: `loadWithdrawalMarkers(root)`, `desiredLocation(postId, publishedIds, markers)`, lifecycle-aware `syncWechatDrafts()` results, and cancellation before browser execution.

- [ ] **Step 1: Write failing marker validation and lifecycle sync tests**

Add tests that prove:

```js
assert.equal(loadWithdrawalMarkers(root).get("2026-08-04-120000").postId, "2026-08-04-120000");
assert.throws(() => loadWithdrawalMarkers(rootWithExtraMarkerField), /撤回标记格式无效/);
```

Add sync scenarios with a pre-armed state:

```js
assert.equal(state.posts[id].publication.status, "pending"); // only after successful addDraft
assert.equal(state.posts[id].publication.status, "draft_only"); // marker before publish click
assert.equal(client.calls.filter(([name]) => name === "deleteDraft").length, 0);
```

Also assert: an unmarked deletion keeps `sourceDeletedAt`; `published` and `withdrawn` records update only their observed website fingerprint; a canceled non-baseline record restored to published becomes pending after add/update; baseline records do not.

- [ ] **Step 2: Run sync tests and verify lifecycle assertions fail**

Run: `node --test tests/wechat-state.test.mjs tests/wechat-sync.test.mjs`

Expected: FAIL because marker loading and lifecycle-aware sync do not exist.

- [ ] **Step 3: Implement strict marker loading**

`loadWithdrawalMarkers(root)` reads only `content/.lifecycle/withdrawals/*.json`. Every filename stem must match `^\d{4}-\d{2}-\d{2}-\d{6}$`; JSON keys must be exactly `postId` and `requestedAt`; filename stem must equal `postId`; `requestedAt` must parse to a finite date. Any malformed marker aborts the run before external calls.

- [ ] **Step 4: Reconcile desired location before preparing network work**

At the start of `syncWechatDrafts`, compute published IDs and markers. For an active marker:

- set `publication.desiredLocation = "drafts"`;
- convert `pending` or `blockedOperation === "publish"` to `draft_only` and persist;
- retain `manual`, `publishing`, `publish_reconcile`, `published`, `withdrawing`, and `withdraw_reconcile` for browser reconciliation;
- never call a WeChat API for that post.

For an existing source in `content/published/`, set desired location to `published`; an inactive historical marker does not withdraw it.

- [ ] **Step 5: Make draft add/update eligibility transactional**

After and only after a real `addDraft` or `updateDraft` succeeds, set `pending` when `publicationForNewPost` permits it. Preserve `manual` for baselines. When `everPublished` is true, calculate and store the observed source fingerprint but make zero image upload, cover upload, `draft/add`, or `draft/update` calls.

- [ ] **Step 6: Run state, sync, client, and content tests**

Run: `node --test tests/wechat-state.test.mjs tests/wechat-sync.test.mjs tests/wechat-client.test.mjs tests/wechat-content.test.mjs`

Expected: PASS, including existing add/update behavior for non-published drafts.

- [ ] **Step 7: Commit lifecycle-aware draft sync**

```bash
git add scripts/wechat/lifecycle-intent.cjs scripts/wechat/sync.cjs tests/wechat-sync.test.mjs
git commit -m "feat: reconcile WeChat draft lifecycle"
```

### Task 4: Persistent Chrome session and deterministic page adapter

**Files:**
- Create: `scripts/wechat/browser-session.cjs`
- Create: `scripts/wechat/browser-publisher.cjs`
- Create: `tests/fixtures/wechat-browser/dashboard.html`
- Create: `tests/fixtures/wechat-browser/login.html`
- Create: `tests/fixtures/wechat-browser/drafts.html`
- Create: `tests/fixtures/wechat-browser/published.html`
- Create: `tests/fixtures/wechat-browser/captcha.html`
- Create: `tests/wechat-browser.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: dedicated `agentHome`, `channel`, `headless`, post `{ title, sourceUrl, platformArticleId }`, and Playwright `chromium`.
- Produces: `launchWechatContext(options)`, `retainDiagnosticScreenshot(options)`, and `WechatBrowserAdapter` methods from design section 7.3.

- [ ] **Step 1: Add `playwright-core` without installing a browser**

Run: `pnpm add --save-dev playwright-core`

Expected: only `package.json`, `pnpm-lock.yaml`, and `node_modules` change; no `playwright install` command runs and no browser dependency is added to package scripts.

- [ ] **Step 2: Write failing browser-session tests with an injected Chromium fake**

```js
test("launches installed Chrome with a private persistent profile", async () => {
  const calls = [];
  const chromium = { launchPersistentContext: async (dir, options) => {
    calls.push({ dir, options });
    return { close: async () => {} };
  }};
  await launchWechatContext({ agentHome: root, chromium, channel: "chrome", headless: false });
  assert.equal(calls[0].dir, path.join(root, "browser-profile"));
  assert.equal(calls[0].options.channel, "chrome");
  assert.equal(calls[0].options.headless, false);
  assert.equal(fs.statSync(calls[0].dir).mode & 0o777, 0o700);
});
```

Also assert a profile-lock launch error is sanitized, screenshot retention keeps at most three files with mode `0600`, and no profile path or cookie text appears in the error.

- [ ] **Step 3: Implement persistent-context and diagnostic helpers**

Use `chromium.launchPersistentContext(profileDir, { channel: "chrome", headless, acceptDownloads: false })`. Create the profile and diagnostics directories with `0700`. Always close the context in CLI `finally` blocks. Sanitize errors to a bounded message and never persist DOM or storage state.

- [ ] **Step 4: Write adapter tests against local fixture pages**

Launch one temporary static HTTP server from the test. Assert:

```js
assert.deepEqual(await adapter.checkSession(), { authenticated: true });
assert.equal((await adapter.findDraftCandidate(post)).kind, "exact");
await assert.rejects(() => adapter.findDraftCandidate(duplicatePost), /找到多个同名草稿/);
await adapter.publishCurrentDraft(post);
assert.equal(await page.locator("[data-click-count=publish]").textContent(), "1");
await adapter.withdrawCurrentArticle(post);
assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "1");
```

Login and CAPTCHA fixtures must be identified before any action. Unexpected confirmation text must cause rejection with a zero confirmation-click count.

- [ ] **Step 5: Implement the adapter with centralized visible-text selectors**

Use `getByRole` and exact `getByText` first. Keep the expected Chinese labels in one frozen object:

```js
const LABELS = Object.freeze({
  drafts: "草稿箱",
  published: "发表记录",
  publish: "发表",
  withdraw: ["撤回", "删除"],
  confirmPublish: "发表",
  confirmWithdraw: ["确认撤回", "确认删除"],
});
```

Every candidate method returns `{ kind: "exact", title, href }` only after exactly one title match and non-conflicting source URL/platform ID. Zero and multiple matches throw distinct sanitized errors. `detectGlobalBlocker(page)` runs before each click and recognizes QR/login, CAPTCHA, and account-verification visible text.

- [ ] **Step 6: Run browser tests using Playwright against fixtures**

Run: `node --test tests/wechat-browser.test.mjs`

Expected: PASS using installed Chrome channel when available. If CI has no Chrome, session unit tests still run and fixture integration is skipped only on the explicit `browserType.launch` executable-not-found error.

- [ ] **Step 7: Commit browser infrastructure**

```bash
git add package.json pnpm-lock.yaml scripts/wechat/browser-session.cjs scripts/wechat/browser-publisher.cjs tests/fixtures/wechat-browser tests/wechat-browser.test.mjs
git commit -m "feat: add deterministic WeChat browser adapter"
```

### Task 5: At-most-once publish and withdrawal orchestrator

**Files:**
- Create: `scripts/wechat/publisher.cjs`
- Create: `scripts/wechat-publish.cjs`
- Create: `tests/wechat-publisher.test.mjs`

**Interfaces:**
- Consumes: version-2 state, marker inventory, injected adapter, `saveState`, flags `{ autoPublish, autoWithdraw, dryRun }`, and clock `now()`.
- Produces: `runLifecycle(options)`, `arm(options)`, `statusSummary(state)`, `resolveRecord(options)`, CLI `parseArguments(argv)` and `main()`.

- [ ] **Step 1: Write fake-adapter tests for the publication state machine**

```js
test("persists publishing before exactly one publish click", async () => {
  const observed = [];
  const adapter = fakeAdapter({ onPublish: () => observed.push(loadState(file).posts[id].publication.status) });
  await runLifecycle({ stateFile: file, root, adapter, autoPublish: true, autoWithdraw: true, now });
  assert.deepEqual(observed, ["publishing"]);
  assert.equal(adapter.publishClicks, 1);
  assert.equal(loadState(file).posts[id].publication.status, "published");
});
```

Add cases: preflight already published means zero publish clicks; exception before click leaves `pending`; exception after click starts becomes `publish_reconcile`; a loaded `publishing` becomes `publish_reconcile` and never clicks.

- [ ] **Step 2: Write withdrawal branch and click-count tests**

Cover: pending marker becomes `draft_only` with zero browser calls; manual exact published match proceeds; manual verified absence becomes `draft_only`; published marker clicks once; loaded `withdrawing` becomes `withdraw_reconcile`; uncertain withdrawal never clicks again; auto-withdraw disabled retains actionable state without clicking; cancellation still happens while disabled.

- [ ] **Step 3: Run publisher tests and verify they fail**

Run: `node --test tests/wechat-publisher.test.mjs`

Expected: FAIL because the orchestrator and CLI do not exist.

- [ ] **Step 4: Implement serial operation selection and publication flow**

Call `recoverInterruptedOperations` immediately after state load and save any recovery before opening Chrome. Build two ordered queues: active withdrawal/cancellation intents first, then records with desired location `published` and status `pending`, `publishing`, or `publish_reconcile`.

Before the first publish click, save `publishing` plus `publishStartedAt`. If `publishCurrentDraft` returns but verification is not exact, save `publish_reconcile`. On exact verification, save `published`, `everPublished: true`, `publicationOrigin: "automatic"`, platform identity, and timestamp.

- [ ] **Step 5: Implement cancellation, withdrawal, and reconciliation flow**

For an active marker, implement the exact decision table:

```text
pending / safe publish-blocked        -> draft_only, no browser
manual + exact published              -> withdrawing
manual + trustworthy absence          -> draft_only
publishing / publish_reconcile + exact -> withdrawing
publishing / publish_reconcile + zero  -> publish_reconcile, no click
published                              -> withdrawing
withdrawing loaded                     -> withdraw_reconcile, no click
withdrawn                              -> no action
```

Save `withdrawing` and click timestamp before the withdrawal click. Exact verified absence becomes `withdrawn`; any uncertainty after the click starts becomes `withdraw_reconcile`.

- [ ] **Step 6: Implement CLI parsing and explicit recovery commands**

Supported forms:

```text
login
arm
status
run [--dry-run] [--automatic] [--retry POST_ID]
resolve POST_ID --published URL
resolve POST_ID --not-published
resolve POST_ID --withdrawn
resolve POST_ID --still-published
```

`arm` loads current `content/published/` IDs, is idempotent, and prints the baseline count. `--not-published` resolves to `draft_only` when a withdrawal marker is active. `--still-published` is the only path that permits a fresh withdrawal attempt after `withdraw_reconcile`. Output never includes secrets, cookies, HTML, or full private profile paths.

- [ ] **Step 7: Run state, sync, browser, and publisher tests**

Run: `node --test tests/wechat-state.test.mjs tests/wechat-sync.test.mjs tests/wechat-browser.test.mjs tests/wechat-publisher.test.mjs`

Expected: PASS with click counts exactly zero or one as specified.

- [ ] **Step 8: Commit the lifecycle runner**

```bash
git add scripts/wechat/publisher.cjs scripts/wechat-publish.cjs tests/wechat-publisher.test.mjs
git commit -m "feat: orchestrate WeChat publish and withdrawal"
```

### Task 6: Mac Agent integration, commands, and operator documentation

**Files:**
- Modify: `scripts/wechat-mac-agent.cjs`
- Modify: `tests/wechat-mac-agent.test.mjs`
- Modify: `package.json`
- Modify: `docs/wechat-draft-sync.md`
- Modify: `docs/obsidian-publishing.md`

**Interfaces:**
- Consumes: draft CLI and publisher CLI exit codes, private env file, existing process lock.
- Produces: one serial Agent run `checkout → sync → lifecycle`, user-facing package commands, install defaults, and recovery instructions.

- [ ] **Step 1: Add failing Agent tests for paths, defaults, and child ordering**

Assert `agentPaths()` adds `browserProfile` and `diagnosticsDir` under `agentHome`. Assert the environment template contains:

```text
WECHAT_AUTO_PUBLISH=0
WECHAT_AUTO_WITHDRAW=0
WECHAT_BROWSER_CHANNEL=chrome
WECHAT_BROWSER_HEADLESS=0
```

Inject a command runner into `runAgent` and assert the sync child finishes before `wechat-publish.cjs run --automatic`. In dry-run, assert publisher receives `--dry-run` and no real browser launch is possible. In force mode, assert force applies only to draft sync.

- [ ] **Step 2: Run Agent tests and verify they fail**

Run: `node --test tests/wechat-mac-agent.test.mjs`

Expected: FAIL because browser paths, flags, injection, and publisher child do not exist.

- [ ] **Step 3: Integrate lifecycle execution under the existing lock**

After a successful draft sync, execute `scripts/wechat-publish.cjs run --automatic` with the same external state file and Agent home. Preserve child stdout/stderr in existing logs. A sync failure prevents lifecycle execution. A lifecycle failure records the Agent run as failure without corrupting the already-saved draft state. `--dry-run` passes through; `--force` does not authorize either browser operation.

- [ ] **Step 4: Add package commands and private configuration defaults**

Add exactly:

```json
"wechat:publisher:login": "bun scripts/wechat-publish.cjs login",
"wechat:publisher:arm": "bun scripts/wechat-publish.cjs arm",
"wechat:publisher:status": "bun scripts/wechat-publish.cjs status",
"wechat:publisher:run": "bun scripts/wechat-publish.cjs run",
"wechat:publisher:resolve": "bun scripts/wechat-publish.cjs resolve"
```

Installation never flips either automation flag. Existing `.env` files are not overwritten; status reports missing additions with copyable lines.

- [ ] **Step 5: Replace manual-publish documentation with the lifecycle contract**

Document the exact setup sequence:

```bash
pnpm install
pnpm wechat:publisher:login
pnpm wechat:publisher:arm
pnpm wechat:publisher:status
pnpm wechat:publisher:run -- --dry-run
```

Explain that each writing device must rerun `./scripts/setup-obsidian-git.sh`; drafts remain private; only exact move markers withdraw; unmarked deletion is website-only; unpublished moves preserve WeChat drafts; published moves withdraw without prompting; uncertain states require `resolve`; previously published posts never republish.

- [ ] **Step 6: Run Agent and complete unit suite**

Run: `pnpm test`

Expected: all existing and new tests pass with no live WeChat access.

- [ ] **Step 7: Commit integration and docs**

```bash
git add scripts/wechat-mac-agent.cjs tests/wechat-mac-agent.test.mjs package.json docs/wechat-draft-sync.md docs/obsidian-publishing.md
git commit -m "feat: integrate WeChat browser lifecycle agent"
```

### Task 7: Full verification and controlled live acceptance gate

**Files:**
- Modify only if verification exposes a concrete defect in files owned by Tasks 1-6.

**Interfaces:**
- Consumes: completed implementation, installed Chrome, private credentials, dedicated profile, and a separately approved disposable article.
- Produces: verified local build and dry-run; live flags remain off until exact selector acceptance succeeds.

- [ ] **Step 1: Run clean static verification**

Run:

```bash
pnpm test
pnpm build
pnpm wechat:sync -- --dry-run
pnpm wechat:publisher:run -- --dry-run
git diff --check
```

Expected: tests and build pass; both dry-runs perform zero network/browser/state mutation; working tree contains only intentional changes.

- [ ] **Step 2: Run a secret and privacy scan**

Run:

```bash
rg -n "WECHAT_APP_SECRET=.+|access_token=.+|Set-Cookie:|content/drafts/.+\.md" --glob '!docs/superpowers/**' .
```

Expected: no credential values, cookies, private drafts, browser profile, screenshots, or DOM dumps are tracked.

- [ ] **Step 3: After explicit push approval, install/update the Agent without enabling automation**

Push the reviewed commits only after the user explicitly approves `git push`, then run: `pnpm wechat:agent:install`.

Expected: private template contains both flags at `0`, the LaunchAgent is loaded, and draft-only behavior remains unchanged.

- [ ] **Step 4: Complete headed login and baseline arming**

Run:

```bash
pnpm wechat:publisher:login
pnpm wechat:publisher:arm
pnpm wechat:publisher:status
```

Expected: QR login is completed by the operator; the two current IDs are baseline `manual`; pending count is zero; neither current article is clicked.

- [ ] **Step 5: Inspect live selectors without final publication**

Use a disposable unpublished WeChat draft. Open and verify exact draft identity, publish button, expected dialog text, published-list navigation, and withdrawal control. Stop before the final confirmation; any mismatch is a code defect and must not be bypassed with coordinates or fuzzy selection.

- [ ] **Step 6: Gate the two automation flags independently**

Only after a separately selected new article completes one verified live publication set `WECHAT_AUTO_PUBLISH=1`. Only after a separately selected disposable article completes one verified withdrawal and becomes publicly unavailable set `WECHAT_AUTO_WITHDRAW=1`. If either acceptance cannot be completed, leave its flag at `0` and report the exact blocker.

- [ ] **Step 7: Final review and handoff**

Review the final diff against every Global Constraint, rerun `pnpm test`, `pnpm build`, both dry-runs, and `git status --short`. Report commits, test counts, inactive/live flags, and any human acceptance still required. Do not push without explicit user approval.
