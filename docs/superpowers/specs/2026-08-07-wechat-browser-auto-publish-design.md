# WeChat Browser Auto-Publish and Withdraw Design

## 1. Context

The existing pipeline turns each published Markdown article into a WeChat draft:

```text
content/published/
  → GitHub main
  → Mac LaunchAgent
  → WeChat draft/add or draft/update
  → manual publish in mp.weixin.qq.com
```

The current account can create and update drafts, but its official publish endpoints return `48001 api unauthorized`. The requested next step is therefore not another API integration. It is a deterministic browser publisher running on the same Mac after draft synchronization succeeds.

The author confirms an article before moving it into `content/published/`. That move becomes authorization for one automatic WeChat publication. No second human confirmation is required after the WeChat draft is created.

Moving the same timestamped article back into the local, Git-ignored `content/drafts/` folder becomes the single withdrawal gesture. The Agent determines from persisted state and a verified WeChat page whether it should only cancel an unpublished item or automatically withdraw an already published item. Normal withdrawal has no confirmation prompt, but uncertain identity or outcome still fails closed.

## 2. Goals

1. Complete one verified automatic publication for each healthy eligible draft without a second confirmation prompt, while allowing at most one automatic publish click across uncertain retries.
2. Keep the existing Markdown, image upload, draft rendering, GitHub polling, and LaunchAgent pipeline.
3. Grandfather all articles that exist when the publisher is armed so they are never backfilled automatically.
4. Treat later Markdown edits as website-only changes after the first WeChat publication.
5. Detect a prior successful publication before clicking again after a crash or uncertain browser result.
6. Stop safely on login expiry, QR codes, CAPTCHA, ambiguous draft matches, unexpected dialogs, or page changes.
7. Keep browser credentials and diagnostics local to the Mac and outside Git.
8. Use one author-facing gesture—moving an article back to `content/drafts/`—to cancel an unpublished item or withdraw a verified published WeChat article without another confirmation.
9. Preserve private draft contents locally while sending only a content-free withdrawal marker through GitHub to the Mac Agent.

## 3. Non-goals

- Circumventing QR login, CAPTCHA, account verification, or WeChat security controls.
- Calling undocumented WeChat HTTP endpoints directly with copied browser cookies.
- Editing or republishing an already published WeChat article.
- Deleting an unpublished WeChat draft merely because its local article returned to `content/drafts/`.
- Treating an unmarked file deletion, branch change, or missing checkout file as withdrawal authorization.
- Publishing the two current articles or any other article that predates explicit publisher arming.
- Running while the Mac is shut down or unable to access GitHub and WeChat.
- Using an LLM to decide which buttons are safe to click at runtime.
- General browser automation for other platforms.

## 4. Chosen Approach

Use `playwright-core` with the installed Google Chrome and a dedicated persistent browser profile under the existing WeChat Agent directory. The project does not download or bundle another browser. The same deterministic adapter handles publication and withdrawal, but the two operations have separate states and click guards.

The implementation is deterministic:

- the one-time login command opens a visible browser for QR login;
- background publication reuses the authenticated profile;
- the publisher locates one exact draft, checks a fixed sequence of page states, and clicks only expected controls;
- unexpected states abort instead of asking a model to improvise.

This is preferred over the alternatives:

1. `freepublish/submit` is cleaner but unavailable to the current account.
2. AppleScript coordinate clicks are tied to window position and are too fragile.
3. Invoking an interactive Codex computer-use task every five minutes is not a reliable unattended service.

Codex builds and tests the publisher, but the installed LaunchAgent executes ordinary code at runtime.

## 5. User Contract

After the publisher is armed:

```text
moving a new article into content/published/
  = publish it to the website
  + create its WeChat draft
  + publish that draft once
```

The author must finish content review before that move. There is no second approval between draft creation and the browser click.

An existing article is never made eligible merely because its Markdown changes. Once a post reaches `published`, every later source change updates only the website. The Agent records the new fingerprint and logs the WeChat skip without creating another draft.

Returning an article to drafts means:

```text
moving the same timestamped article from content/published/ to content/drafts/
  = remove it from the website
  + if it has not been published to WeChat, cancel pending publication
  + if WeChat publication is verified, withdraw it once without prompting
```

`content/drafts/` remains Git-ignored so private draft text is never pushed. During an Obsidian Git commit, the content guard recognizes a staged deletion of `content/published/<POST_ID>.md` whose same timestamped filename now exists at `content/drafts/<POST_ID>.md`. It writes a tracked, content-free marker at `content/.lifecycle/withdrawals/<POST_ID>.json`. The marker contains only the post ID and request time; it never contains title, body, tags, assets, or a local path. The marker and deletion of the matching `content/published/` file are committed together.

The marker is the remote authorization. A missing published file without that marker removes the website page but causes no WeChat action. A plain deletion with no same-ID local draft is therefore allowed but unmarked. If the same post ID exists in both folders or marker data is malformed, the Obsidian commit is rejected instead of guessing. Every writing device that may withdraw an article must have the updated repository hook installed.

The marker remains as an audit record. Its canonical UTC `requestedAt` is a generation, and `publication.withdrawRequestedAt` records the generation consumed before cancellation, withdrawal, or reconciliation. While the matching source exists in `content/published/`, that current source location takes precedence and the marker is inactive. After restore, a later plain deletion cannot reactivate an equal or older marker; only a later exact move that writes a strictly newer generation creates a new authorization. A non-baseline article that was canceled before any publish click may become `pending` again when returned to `content/published/`; it is still waiting for its one first publication. A withdrawn article, or any record known to have been published, is never eligible for another automatic WeChat publication when returned; that move restores the website only. Baseline articles are never auto-published. This preserves the rule that each article is automatically published at most once.

## 6. Architecture

```text
┌──────────────────────┐
│ Mac LaunchAgent lock │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Fast-forward checkout│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Desired-state reader │
│ publish or withdrawal│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Draft synchronizer   │
│ add/update + state   │
└──────────┬───────────┘
           │ pending or withdrawal records
           ▼
┌──────────────────────┐
│ Browser lifecycle    │
│ verify → one click   │
└──────────┬───────────┘
           │ verified result or reconciliation
           ▼
┌──────────────────────┐
│ Atomic local state   │
└──────────────────────┘
```

Draft synchronization, desired-state reconciliation, and browser operations remain separate phases. Withdrawal and cancellation intents are reconciled before any pending publication, so an article already marked for drafts cannot be published in the same Agent run. A draft failure prevents publication from starting. A browser failure does not corrupt the draft and is retried only through the lifecycle state machine.

## 7. Components

### 7.1 Lifecycle intent, state, and eligibility

`scripts/wechat/state.cjs` upgrades the local state from version 1 to version 2 while preserving images, covers, draft IDs, and fingerprints.

An explicit arm command establishes a baseline:

```bash
pnpm wechat:publisher:arm
```

Arming records every currently published article ID as `manual`. It refuses to run when the draft state is missing or unreadable. The command prints the exact count of grandfathered posts before writing state.

The Agent refuses automatic publication until all of these are true:

- `WECHAT_AUTO_PUBLISH=1` is present in the private Agent environment;
- publisher state has a canonical `armedAt`, `baselineCaptured: true`, and a validated baseline array (including a valid empty array);
- the dedicated browser profile passes a logged-in health check.

Browser withdrawal additionally requires `WECHAT_AUTO_WITHDRAW=1`. A valid withdrawal marker always cancels a not-yet-started publication even when browser withdrawal is disabled; the withdrawal flag gates only the destructive browser action.

New post IDs first seen after arming become `pending` only after `draft/add` succeeds. Existing IDs stay `manual`, even when edited or when their draft is rebuilt.

The desired-state reader loads both published posts and tracked withdrawal markers. It never reads private draft contents in the Agent checkout because those contents are intentionally absent from Git. A valid withdrawal intent requires all of the following:

- the marker post ID is a valid timestamp-derived article ID;
- the matching article is absent from `content/published/`;
- the marker was created by the content guard for an exact local move into `content/drafts/`;

An unmarked disappearance keeps the existing `sourceDeletedAt` diagnostic behavior and performs no browser action.

### 7.2 Browser session manager

`scripts/wechat/browser-session.cjs` owns the persistent Chrome context.

The profile lives at:

```text
~/Library/Application Support/EthanSMC/WeChat Draft Sync/browser-profile/
```

The directory is created with mode `0700`. Cookies, local storage, screenshots, and browser logs never enter the repository or the JSON sync state.

The login command is explicit:

```bash
pnpm wechat:publisher:login
```

It opens a headed Chrome window at `https://mp.weixin.qq.com/`, waits for the operator to complete QR login, verifies a known authenticated dashboard state, then exits without publishing anything.

Background runs reuse the profile. Headless mode is allowed only after a real acceptance check proves the current WeChat session works with it; otherwise the publisher uses a headed browser under the logged-in macOS user session.

### 7.3 Page adapter

`scripts/wechat/browser-publisher.cjs` exposes a small adapter instead of spreading selectors through the Agent:

```text
checkSession()
findPublishedCandidate(post)
findDraftCandidate(post)
openDraft(candidate)
publishCurrentDraft(post)
verifyPublished(post)
openPublished(candidate)
withdrawCurrentArticle(post)
verifyWithdrawn(post)
```

Selectors prefer accessible roles, labels, and visible Chinese control names. CSS classes generated by WeChat are not treated as stable identifiers.

A candidate must match the exact article title. When available, the adapter also checks `content_source_url` against the post's permanent website URL and a previously stored platform article ID. A published-list zero match becomes typed `{ kind: "absent" }` only after an injected, accepted contract proves the list is ready and exhaustive. Loading, partial, paginated, or unrecognized results are coded global failures. Until real WeChat acceptance supplies that contract, the production adapter fails closed before automatic clicks. Multiple matches or conflicting source URLs also block a click. The lifecycle runner never chooses the first fuzzy match.

For withdrawal, the adapter accepts only the documented WeChat UI control whose effect was verified in real acceptance to make the public article unavailable. Whether the current UI labels that control “撤回” or “删除” is isolated inside the adapter. Unexpected secondary choices, account verification, or changed wording stop before confirmation.

### 7.4 Lifecycle orchestrator

`scripts/wechat-publish.cjs` processes only records with explicit publication or withdrawal state. It never scans all drafts or published items and decides what looks actionable.

Records are processed serially, with cancellation and withdrawal intents before publication intents. A record-specific pre-click ambiguity blocks that record and allows later safe records to continue. Any invalid, still-readable, or ambiguous withdrawal verification stops later clicks in the same run. A global condition such as login expiry, CAPTCHA, browser-profile locking, or an unrecognized page aborts the entire runner.

A `publishing` state loaded from a previous process is treated as uncertain and changed to `publish_reconcile` before any browser click. A `withdrawing` state loaded from a previous process is similarly changed to `withdraw_reconcile`. Only the same live process that atomically entered an operation state may perform that operation's first click.

For one record:

1. Check the published list before opening a draft.
2. If one verified published match exists, mark the record `published` without clicking.
3. If the state is `publish_reconcile` and no trustworthy published match exists, stop for manual reconciliation; do not click.
4. Locate exactly one eligible draft.
5. Persist `publishing` and `publishStartedAt` before the click.
6. Open the draft and verify the expected title.
7. Click the expected publish control and only the expected confirmation dialog.
8. Observe a successful UI or network response.
9. Verify the article in the published list.
10. Atomically persist `published`, `publishedAt`, and the public URL or platform article ID when available.

If the click may have succeeded but final verification fails, persist `publish_reconcile`. A future run checks published content but never clicks again automatically from that state.

For one withdrawal marker:

1. Re-check that the matching post is absent from `content/published/` and the marker is valid.
2. If state is `pending` or safely pre-click `blocked`, persist `draft_only`; leave any WeChat draft intact and perform no browser click.
3. If state is `manual`, query the published list before deciding the branch. One exact verified match means published; a trustworthy zero result means `draft_only`; ambiguity blocks the record.
4. If state is `publishing` or `publish_reconcile`, never interpret one zero-result lookup as proof of non-publication. One exact verified match continues into withdrawal; otherwise retain `publish_reconcile` with desired location `drafts` so no future run can publish it.
5. If state is `published`, or step 3 or 4 proves a publication, locate exactly one published candidate using stored identity.
6. Persist `withdrawing`, `withdrawRequestedAt`, and `withdrawStartedAt` before the click.
7. Open the exact published item, re-check its identity, click the expected withdrawal/delete control, and accept only the expected confirmation dialog.
8. Verify absence from a recognized ready/exhaustive published list and, when a stored public URL is available, verify that exact HTTPS WeChat URL has a deterministic unavailable status such as `404` or `410`.
9. Persist `withdrawn`, `withdrawnAt`, and the retained publication audit fields.

If the withdrawal click may have succeeded but verification is inconclusive, persist `withdraw_reconcile` and stop later clicks in that run. Future runs may verify completion but never click withdrawal a second time automatically. A still-readable public URL also stays in reconciliation. An already absent exact item is marked `withdrawn` only when the adapter can distinguish successful absence from a broken/partial page and any stored public URL is deterministically unavailable; otherwise it remains in reconciliation.

### 7.5 Mac Agent integration

The existing LaunchAgent continues to own one process lock. Its run order becomes:

```text
checkout update
→ desired-state inventory
→ draft sync child process
→ cancel/withdraw child process when enabled
→ publisher child process when enabled
→ last-run status
```

The draft CLI persists pending state before it exits, so a crash between phases is recoverable. `--dry-run` renders articles and reports which posts would become pending, but never launches Chrome or writes publication state.

`--force` may rebuild a non-published draft, but it never resets `manual`, `published`, or `withdrawn` records and never authorizes publication. It cannot override a valid withdrawal marker.

## 8. State Model

Each post gains a publication block:

```json
{
  "fingerprint": "latest-observed-source-fingerprint",
  "mediaId": "wechat-draft-media-id",
  "title": "article title",
  "sourceUrl": "https://example.com/blog/.../",
  "publication": {
    "status": "manual | draft_only | pending | publishing | publish_reconcile | published | withdrawing | withdraw_reconcile | withdrawn | blocked",
    "desiredLocation": "published | drafts",
    "everPublished": false,
    "publicationOrigin": "automatic | manual-detected | null",
    "eligibleAt": "ISO timestamp or null",
    "draftFingerprint": "fingerprint sent to the eligible draft or null",
    "publishStartedAt": "ISO timestamp or null",
    "publishedAt": "ISO timestamp or null",
    "publishedUrl": "URL or null",
    "platformArticleId": "ID or null",
    "withdrawRequestedAt": "ISO timestamp or null",
    "withdrawStartedAt": "ISO timestamp or null",
    "withdrawnAt": "ISO timestamp or null",
    "blockedOperation": "publish | withdraw | null",
    "lastError": "sanitized local diagnostic or null"
  }
}
```

Publisher-level state contains:

```json
{
  "armedAt": "ISO timestamp",
  "baselineCaptured": true,
  "baselinePostIds": ["timestamp-derived-post-id"],
  "browserSessionCheckedAt": "ISO timestamp or null"
}
```

State transitions are:

```text
pre-arm/current article ───────────────→ manual
new post + successful draft/add ───────→ pending
pending + preflight succeeds ──────────→ publishing
publishing + verified publication ─────→ published
publishing + uncertain result ─────────→ publish_reconcile
pending + safe deterministic failure ──→ blocked
blocked + explicit retry after repair ─→ pending
pending/blocked + withdrawal marker ───→ draft_only
manual + verified absence ─────────────→ draft_only
draft_only + non-baseline source return → pending
manual + verified publication ─────────→ withdrawing
published + withdrawal marker ─────────→ withdrawing
withdrawing + verified absence ────────→ withdrawn
withdrawing + uncertain result ────────→ withdraw_reconcile
withdrawn + source return ──────────────→ withdrawn (website only)
```

There is no transition from `published` back to `pending`.
There is no transition from `withdrawn`, a baseline record, or any record with `everPublished: true` back to `pending`. A canceled non-baseline record with `everPublished: false` may return to `pending` because it has not yet received its first publication.

## 9. Later Edits

When a published post's Markdown changes:

1. Parse and validate the new source as usual.
2. Update its observed fingerprint in local state.
3. Do not upload images, update the old draft, create a new draft, or run the browser publisher.
4. Log `公众号已发布一次，本次修改仅更新网站：<title>`.

The frozen `draftFingerprint`, `publishedAt`, and publication identifiers remain unchanged for auditability.

## 10. Commands and Configuration

Package commands:

```bash
pnpm wechat:publisher:login
pnpm wechat:publisher:arm
pnpm wechat:publisher:status
pnpm wechat:publisher:run -- --dry-run
pnpm wechat:publisher:run
pnpm wechat:publisher:run -- --retry POST_ID
pnpm wechat:publisher:resolve POST_ID -- --published URL
pnpm wechat:publisher:resolve POST_ID -- --not-published
pnpm wechat:publisher:resolve POST_ID -- --withdrawn
pnpm wechat:publisher:resolve POST_ID -- --still-published
```

`--retry` retries only a safely pre-click blocked operation. It cannot change either reconciliation state, `published`, or `withdrawn`. A reconciliation record requires the operator to inspect WeChat and use `publisher:resolve`. `--published` and `--not-published` resolve an uncertain publish; when a valid withdrawal marker exists, `--not-published` resolves to `draft_only` rather than `pending`. `--withdrawn` and `--still-published` resolve an uncertain withdrawal. `--still-published` permits one new withdrawal attempt only because it is an explicit human assertion that the earlier click did not remove the article; normal unattended runs never make that assertion.

Private configuration additions:

```text
WECHAT_AUTO_PUBLISH=0
WECHAT_AUTO_WITHDRAW=0
WECHAT_BROWSER_CHANNEL=chrome
WECHAT_BROWSER_HEADLESS=0
```

Automatic publication and withdrawal are separately opt-in during rollout. Installation and code deployment do not change either flag from `0` to `1`. Once `WECHAT_AUTO_WITHDRAW=1` is enabled, a valid move-to-drafts marker requires no per-article confirmation.

Status output shows arming state, browser login health, pending count, both reconciliation counts, blocked counts by operation, and the last verified publication and withdrawal. It does not print cookies, access tokens, page contents, or private browser paths beyond the existing Agent home location.

## 11. Error Handling

The publisher distinguishes these conditions:

- **Not armed:** draft sync continues; browser publication and withdrawal are skipped with one clear message.
- **Not logged in / QR visible:** mark the run failed and request `wechat:publisher:login`.
- **CAPTCHA or account verification:** stop immediately; no retry click.
- **No exact draft:** block that record and preserve its media ID.
- **Multiple exact drafts:** block rather than guess.
- **Unexpected confirmation dialog:** stop before confirming.
- **Navigation timeout before click:** leave `pending` for a safe retry.
- **Failure after publish click begins:** move to `publish_reconcile`; never click publish again automatically.
- **Published match found during preflight:** mark `published` without clicking.
- **Withdrawal marker with unpublished state:** cancel publication, retain the WeChat draft, and use no browser click.
- **Withdrawal identity is ambiguous:** block before clicking.
- **Failure after withdrawal click begins:** move to `withdraw_reconcile`; never click withdrawal again automatically.
- **Unmarked published-file disappearance:** update website/deletion diagnostics only; perform no WeChat action.
- **Browser profile locked by another Chrome process:** fail the run without copying or deleting profile data.

`blocked` records can be retried only with the explicit `--retry POST_ID` command. Reconciliation records can be changed only with the explicit resolve commands described above.

Errors saved to state are sanitized and bounded. DOM dumps, cookies, local storage, API secrets, and full HTML are never logged.

On failure, an optional screenshot may be written under the private Agent diagnostics directory with mode `0600`. The default retention is three screenshots; none are committed or uploaded.

## 12. Safety and Privacy

- The browser profile and diagnostics remain under the private Agent home.
- The repository contains code and fixtures only, never an authenticated profile.
- The existing LaunchAgent lock prevents simultaneous draft and publish runs.
- Exact matching and explicit page-state assertions replace fuzzy or visual guessing.
- No browser cookie is converted into an unofficial HTTP client credential.
- Auto-publish is disabled by default and requires login, arm, and environment enablement.
- Auto-withdraw is disabled independently during rollout and uses the same login and armed baseline.
- Existing articles are grandfathered before enablement.
- `content/published/` is documented as an externally publishing action once enabled.
- Private `content/drafts/` files remain ignored; withdrawal markers disclose only timestamp-derived IDs and request times.
- Only an exact move detected by the content guard creates withdrawal authorization; arbitrary deletion does not.
- Normal withdrawals have no prompt, while ambiguity, security checks, and uncertain click results still fail closed.

## 13. Testing Strategy

### Unit tests

- State migration preserves version-1 draft records.
- Arming marks every current post `manual` and is idempotent.
- A new successful `draft/add` becomes `pending` only after arming.
- Existing and baseline posts never become eligible.
- A published record never returns to publication eligibility, including after source edits, withdrawal, restore-to-published, and `--force`.
- An exact move from published to drafts creates one content-free marker; a plain deletion does not.
- A duplicate ID in published and drafts, or an unprovable move, is rejected by the content guard.
- Pending and safely blocked publication states become `draft_only` without a browser call.
- A canceled non-baseline article can become pending again; baseline and ever-published articles cannot.
- A verified published state becomes `withdrawing`; manual baseline state branches only after an exact published lookup.
- `withdrawn` and `everPublished: true` never become publication-eligible again.
- Error messages and stored diagnostics exclude secrets and browser content.

### Browser adapter tests

Playwright runs against local HTML fixtures that model:

- authenticated dashboard;
- login QR page;
- one exact draft;
- zero and multiple exact drafts;
- expected publish confirmation;
- unexpected extra confirmation fields;
- successful published list;
- one exact published detail with the expected withdrawal control;
- expected withdrawal confirmation and verified absence;
- ambiguous or changed withdrawal controls;
- CAPTCHA and session-expired pages.

Tests assert real DOM behavior and click counts. They never access `mp.weixin.qq.com` or publish external content.

### Integration tests

- Draft add → pending → fake browser success → published.
- Crash before click → safe pending retry.
- Crash or timeout after publish click → publish_reconcile without a second click.
- Preflight finds prior publication → published without clicking.
- Pending + move-to-drafts marker → draft_only with no publish or withdrawal click.
- Manual + exact published match + marker → one withdrawal click → withdrawn.
- Published + marker + fake browser success → withdrawn.
- Crash or timeout after withdrawal click → withdraw_reconcile without a second click.
- Unmarked deletion → website removal only and zero browser calls.
- Withdrawn source restored to published → website-only handling and no second WeChat publication.
- Canceled, never-published, non-baseline source restored to published → pending for its first publication.
- Later Markdown edit → website fingerprint update with zero WeChat API and browser calls.
- Current state migration → both existing articles remain manual.
- Agent dry-run → zero state writes and zero browser launches.

### Real acceptance

1. Install dependencies without downloading a bundled browser; use installed Chrome.
2. Complete one-time QR login and run the session health check.
3. Arm the publisher and confirm the two current article IDs are `manual`.
4. Run publisher dry-run and confirm zero eligible current articles.
5. Exercise selectors with a disposable unpublished draft without clicking the final confirmation.
6. A real first publication requires a separately selected new article. The implementation must not use either current article as a test publication.
7. After that publication, edit its Markdown in a controlled branch and prove the Agent reports website-only handling with zero draft or browser mutations.
8. Real withdrawal acceptance requires a separately selected disposable article: move its unchanged timestamped file back to `content/drafts/`, verify the marker contains no content, and prove the public WeChat article becomes unavailable after exactly one withdrawal click.
9. Never use either current article to test withdrawal. If the live UI does not expose a deterministic, verifiable withdrawal/delete path, leave `WECHAT_AUTO_WITHDRAW=0` and report the acceptance failure instead of weakening selectors.

## 14. Rollout

1. Add state migration and eligibility rules while auto-publish remains disabled.
2. Add local browser fixtures and deterministic publisher tests.
3. Add the dedicated browser profile and login/status commands.
4. Add publisher orchestration and Agent integration.
5. Deploy with `WECHAT_AUTO_PUBLISH=0` and verify draft sync remains unchanged.
6. Login, arm, and verify current articles are grandfathered.
7. Set `WECHAT_AUTO_PUBLISH=1` only after dry-run is clean.
8. Use the next deliberately selected new article for real acceptance.
9. Validate marker generation and the withdrawal page path with a disposable article while `WECHAT_AUTO_WITHDRAW=0` until the final controlled click.
10. Set `WECHAT_AUTO_WITHDRAW=1` only after exact-match withdrawal and post-click verification pass.

## 15. Rollback

Set:

```text
WECHAT_AUTO_PUBLISH=0
WECHAT_AUTO_WITHDRAW=0
```

The Agent immediately returns to draft-only behavior and performs no withdrawals. Draft synchronization, website deployment, tracked withdrawal markers, and stored publication history remain intact. The browser profile may be retained for later use or removed manually after the Agent is stopped. Rollback never restores an already withdrawn WeChat article.

## 16. Success Criteria

- No current article is automatically published during installation or enablement.
- The first new eligible article progresses from draft creation to one verified publication without a second confirmation.
- Re-running the Agent never clicks publish again for that article.
- Editing that article later performs no WeChat draft or browser mutation.
- Moving a pending article back to drafts cancels publication without deleting its WeChat draft.
- Moving a verified published article back to drafts produces one content-free marker and one unattended withdrawal attempt.
- Re-running after a successful or uncertain withdrawal never clicks withdraw again automatically.
- Returning a withdrawn article to published restores only the website and never triggers a second WeChat publication.
- Login expiry, CAPTCHA, ambiguous matches, and page changes fail closed.
- Disabling both lifecycle flags restores the existing draft-only workflow without code rollback.
