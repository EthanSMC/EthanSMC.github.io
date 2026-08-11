# WeChat Automatic Lifecycle E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair automatic publish/withdraw behavior and prove the full lifecycle with a stateful browser E2E that cannot double-click.

**Architecture:** A stateful local HTTP fixture exposes semantic WeChat pages and mutates server-side draft/publication state after confirmed actions. The real Playwright adapter drives the fixture while the real lifecycle engine persists state and consumes real withdrawal markers. Focused unit tests retain all fail-closed edge cases.

**Tech Stack:** Node.js 20+, Node test runner, Playwright Core, semantic HTML fixture server, existing CommonJS lifecycle modules.

## Global Constraints

- E2E must cover automatic publish then automatic withdrawal in that order across two lifecycle runs.
- Publish and withdrawal each receive exactly one primary click and one confirmation click.
- Re-running after success produces zero additional destructive clicks.
- `publishing`/`withdrawing` are persisted before clicks; uncertain outcomes reconcile without retry clicks.
- Tests never access the real WeChat account or external network.
- Browser unavailability is classified explicitly; application assertion failures are never skipped.
- All existing fail-closed identity, session, and list-completeness behavior remains intact.
- Published-list search waits for readiness, exhausts all pages, and reports absence only after a complete search.
- A saved public URL must return 404 or 410 before list absence can prove withdrawal.

---

### Task 1: Stateful semantic lifecycle fixture

**Files:**
- Create: `tests/helpers/wechat-lifecycle-fixture.mjs`
- Create: `tests/fixtures/wechat-browser/lifecycle-dashboard.html`
- Create: `tests/fixtures/wechat-browser/lifecycle-drafts.html`
- Create: `tests/fixtures/wechat-browser/lifecycle-published.html`
- Create: `tests/fixtures/wechat-browser/lifecycle-public.html`
- Test: `tests/wechat-lifecycle.e2e.test.mjs`

**Interfaces:**
- Produces: `startWechatLifecycleFixture(seed) -> { baseUrl, publicUrl, snapshot(), close() }`.
- HTTP actions `POST /actions/publish` and `POST /actions/withdraw` mutate one record and increment exact counters.

- [ ] **Step 1: Add a failing fixture state test**

```js
assert.equal(fixture.snapshot().status, "draft");
await fetch(`${fixture.baseUrl}/actions/publish`, { method: "POST" });
assert.equal(fixture.snapshot().status, "published");
await fetch(`${fixture.baseUrl}/actions/withdraw`, { method: "POST" });
assert.equal(fixture.snapshot().status, "withdrawn");
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --test tests/wechat-lifecycle.e2e.test.mjs`
Expected: FAIL because the stateful fixture does not exist.

- [ ] **Step 3: Implement the fixture and semantic pages**

Pages must expose the same accessible roles, identity fields, labels, navigation, exhaustive published count, and confirmation dialogs consumed by `WechatBrowserAdapter`. Confirm buttons call the local action endpoints and navigate to the resulting list.

- [ ] **Step 4: Run the fixture test and commit**

Run: `node --test tests/wechat-lifecycle.e2e.test.mjs`
Expected: the fixture state test passes; lifecycle portion may remain failing until Task 2.

```bash
git add tests/helpers/wechat-lifecycle-fixture.mjs tests/fixtures/wechat-browser/lifecycle-*.html tests/wechat-lifecycle.e2e.test.mjs
git commit -m "test: add stateful WeChat lifecycle fixture"
```

### Task 2: Complete real-adapter lifecycle E2E

**Files:**
- Modify: `tests/wechat-lifecycle.e2e.test.mjs`
- Modify: `tests/wechat-browser.test.mjs`
- Modify: `scripts/wechat/browser-publisher.cjs`

**Interfaces:**
- Test helper `launchFixtureBrowser(t) -> { browser, page }` uses an explicit executable/channel strategy.
- Adapter navigation must reach draft and published lists after action confirmation.
- Published candidate search returns one exact match across all pages, rejects duplicates across pages, and returns absence only after the last complete page.

- [ ] **Step 1: Add the failing publish/withdraw lifecycle assertion**

```js
await runLifecycle({ autoPublish: true, autoWithdraw: true, adapter, stateFile, root, now });
assert.equal(loadState(stateFile).posts[id].publication.status, "published");
writeWithdrawalMarker(root, id, requestedAt);
await runLifecycle({ autoPublish: true, autoWithdraw: true, adapter, stateFile, root, now });
assert.equal(loadState(stateFile).posts[id].publication.status, "withdrawn");
assert.deepEqual(fixture.snapshot().clicks, { publish: 1, confirmPublish: 1, withdraw: 1, confirmWithdraw: 1 });
assert.equal(fixture.snapshot().publishedListPagesVisited, fixture.snapshot().publishedListPageCount);
```

- [ ] **Step 2: Run and confirm the exact failure**

Run: `node --test tests/wechat-lifecycle.e2e.test.mjs`
Expected: FAIL at the current adapter navigation, verification, or browser launch boundary; record the exact boundary in the task report.

- [ ] **Step 3: Make browser selection deterministic**

Attempt the repository-supported browser executable first and installed Chrome second. Skip only recognized executable absence or platform launch denial before the first page is created. Do not skip navigation, selector, state, or assertion failures.

- [ ] **Step 4: Repair the minimum adapter behavior exposed by E2E**

Keep exact accessible selectors and fail-closed checks. Add bounded condition-based waiting for list readiness after navigation and confirmation. Search each declared page, accumulate exact identity matches, reject duplicates across pages, and return absent only after the final page. Do not add generic text/position selectors or fixed sleeps.

- [ ] **Step 5: Prove idempotent reruns and commit**

Run lifecycle a third time after withdrawal and assert the click counters remain unchanged.

Run: `node --test tests/wechat-browser.test.mjs tests/wechat-lifecycle.e2e.test.mjs`
Expected: PASS or explicit environment-only skip with all non-browser contract tests passing.

```bash
git add scripts/wechat/browser-publisher.cjs tests/wechat-browser.test.mjs tests/wechat-lifecycle.e2e.test.mjs
git commit -m "fix: complete automatic WeChat lifecycle"
```

### Task 3: Lifecycle persistence and reconciliation regression suite

**Files:**
- Modify: `scripts/wechat/publisher.cjs`
- Modify: `scripts/wechat/lifecycle-state.cjs`
- Modify: `tests/wechat-publisher.test.mjs`
- Modify: `tests/wechat-state.test.mjs`

**Interfaces:**
- No new public CLI surface. Existing `runLifecycle`, `transitionPublication`, recovery, and resolution interfaces remain stable.

- [ ] **Step 1: Add regression tests for every E2E-discovered state gap**

```js
assert.equal(savedBeforePublish.publication.status, "publishing");
assert.equal(savedBeforeWithdraw.publication.status, "withdrawing");
assert.equal(secondRunAdapter.publishClicks, 0);
assert.equal(secondRunAdapter.withdrawClicks, 0);
assert.equal(loadState(stateFile).posts[id].publication.status, "withdraw_reconcile");
```

- [ ] **Step 2: Run focused tests and confirm RED for real gaps only**

Run: `node --test tests/wechat-publisher.test.mjs tests/wechat-state.test.mjs`
Expected: any new regression test that exposes a lifecycle defect fails before its fix.

- [ ] **Step 3: Implement minimal transition fixes**

Preserve `everPublished`, publication identity, operation timestamps, desired location, and strict reconciliation. No failure after a click may restore `pending` or `published` in a way that authorizes another automatic click. In the `published + list absent` path, call the existing exact public-URL withdrawal verification: 404/410 may transition to `withdrawn`; 2xx or ambiguous responses remain `withdraw_reconcile` and stop the queue.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/wechat-publisher.test.mjs tests/wechat-state.test.mjs tests/wechat-lifecycle.e2e.test.mjs`
Expected: PASS with exact one-click lifecycle assertions.

```bash
git add scripts/wechat/publisher.cjs scripts/wechat/lifecycle-state.cjs tests/wechat-publisher.test.mjs tests/wechat-state.test.mjs tests/wechat-lifecycle.e2e.test.mjs
git commit -m "fix: harden publish and withdrawal reconciliation"
```

### Task 4: Agent wiring, documentation, and complete verification

**Files:**
- Modify: `scripts/wechat-mac-agent.cjs`
- Modify: `scripts/wechat-publish.cjs`
- Modify: `config/wechat.env.example`
- Modify: `docs/wechat-draft-sync.md`
- Modify: `docs/obsidian-publishing.md`
- Modify: `package.json`
- Test: `tests/wechat-mac-agent.test.mjs`
- Test: `tests/wechat-publisher.test.mjs`

**Interfaces:**
- Add script `test:wechat:e2e` that runs `tests/wechat-lifecycle.e2e.test.mjs`.
- Automatic feature flags remain explicit environment opt-ins.

- [ ] **Step 1: Add failing command/config tests**

```js
assert.equal(pkg.scripts["test:wechat:e2e"], "node --test tests/wechat-lifecycle.e2e.test.mjs");
assert.equal(config.autoPublish, true);
assert.equal(config.autoWithdraw, true);
```

- [ ] **Step 2: Wire the E2E command and preserve explicit safety flags**

Document how to run local fixture E2E, controlled headed account acceptance, arming, enabling `WECHAT_AUTO_PUBLISH=1`, and only then enabling `WECHAT_AUTO_WITHDRAW=1`. Do not silently change template defaults from `0` to `1`.

- [ ] **Step 3: Run the complete verification matrix**

Run: `pnpm test`
Expected: all non-environment tests pass; browser fixture either passes or reports the single classified environment skip.

Run: `pnpm test:wechat:e2e`
Expected: full publish→withdraw→idempotent rerun passes, or only browser startup is explicitly skipped.

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/wechat-mac-agent.cjs scripts/wechat-publish.cjs config/wechat.env.example docs/wechat-draft-sync.md docs/obsidian-publishing.md package.json tests/wechat-mac-agent.test.mjs tests/wechat-publisher.test.mjs
git commit -m "test: verify automatic WeChat publish and withdrawal"
```
