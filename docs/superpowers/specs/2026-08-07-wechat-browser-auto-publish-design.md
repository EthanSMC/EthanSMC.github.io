# WeChat Browser Auto-Publish Design

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

## 2. Goals

1. Complete one verified automatic publication for each healthy eligible draft without a second confirmation prompt, while allowing at most one automatic publish click across uncertain retries.
2. Keep the existing Markdown, image upload, draft rendering, GitHub polling, and LaunchAgent pipeline.
3. Grandfather all articles that exist when the publisher is armed so they are never backfilled automatically.
4. Treat later Markdown edits as website-only changes after the first WeChat publication.
5. Detect a prior successful publication before clicking again after a crash or uncertain browser result.
6. Stop safely on login expiry, QR codes, CAPTCHA, ambiguous draft matches, unexpected dialogs, or page changes.
7. Keep browser credentials and diagnostics local to the Mac and outside Git.

## 3. Non-goals

- Circumventing QR login, CAPTCHA, account verification, or WeChat security controls.
- Calling undocumented WeChat HTTP endpoints directly with copied browser cookies.
- Automatically deleting, retracting, editing, or republishing an already published WeChat article.
- Publishing the two current articles or any other article that predates explicit publisher arming.
- Running while the Mac is shut down or unable to access GitHub and WeChat.
- Using an LLM to decide which buttons are safe to click at runtime.
- General browser automation for other platforms.

## 4. Chosen Approach

Use `playwright-core` with the installed Google Chrome and a dedicated persistent browser profile under the existing WeChat Agent directory. The project does not download or bundle another browser.

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
│ Draft synchronizer   │
│ add/update + state   │
└──────────┬───────────┘
           │ pending records only
           ▼
┌──────────────────────┐
│ Browser publisher    │
│ preflight → click    │
└──────────┬───────────┘
           │ verified result
           ▼
┌──────────────────────┐
│ Atomic local state   │
└──────────────────────┘
```

Draft synchronization and browser publication remain separate phases. A draft failure prevents publication from starting. A browser failure does not corrupt the draft and is retried only through the publisher state machine.

## 7. Components

### 7.1 Publisher state and eligibility

`scripts/wechat/state.cjs` upgrades the local state from version 1 to version 2 while preserving images, covers, draft IDs, and fingerprints.

An explicit arm command establishes a baseline:

```bash
pnpm wechat:publisher:arm
```

Arming records every currently published article ID as `manual`. It refuses to run when the draft state is missing or unreadable. The command prints the exact count of grandfathered posts before writing state.

The Agent refuses automatic publication until all of these are true:

- `WECHAT_AUTO_PUBLISH=1` is present in the private Agent environment;
- publisher state has a valid `armedAt` and baseline;
- the dedicated browser profile passes a logged-in health check.

New post IDs first seen after arming become `pending` only after `draft/add` succeeds. Existing IDs stay `manual`, even when edited or when their draft is rebuilt.

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
```

Selectors prefer accessible roles, labels, and visible Chinese control names. CSS classes generated by WeChat are not treated as stable identifiers.

A candidate must match the exact article title. When available, the adapter also checks `content_source_url` against the post's permanent website URL. Zero matches, multiple matches, or conflicting source URLs block the record. The publisher never chooses the first fuzzy match.

### 7.4 Publisher orchestrator

`scripts/wechat-publish.cjs` processes only `pending`, `publishing`, or `reconcile` records. It never scans all drafts and decides what looks publishable.

Records are processed serially. A record-specific ambiguity blocks that record and allows later safe records to continue. A global condition such as login expiry, CAPTCHA, browser-profile locking, or an unrecognized page aborts the entire publisher run.

A `publishing` state loaded from a previous process is treated as uncertain and changed to `reconcile` before any browser click. Only the same live process that atomically moved a record from `pending` to `publishing` may perform its first click.

For one record:

1. Check the published list before opening a draft.
2. If one verified published match exists, mark the record `published` without clicking.
3. If the state is `reconcile` and no trustworthy published match exists, stop for manual reconciliation; do not click.
4. Locate exactly one eligible draft.
5. Persist `publishing` and `publishStartedAt` before the click.
6. Open the draft and verify the expected title.
7. Click the expected publish control and only the expected confirmation dialog.
8. Observe a successful UI or network response.
9. Verify the article in the published list.
10. Atomically persist `published`, `publishedAt`, and the public URL or platform article ID when available.

If the click may have succeeded but final verification fails, persist `reconcile`. A future run checks published content but never clicks again automatically from that state.

### 7.5 Mac Agent integration

The existing LaunchAgent continues to own one process lock. Its run order becomes:

```text
checkout update
→ draft sync child process
→ publisher child process when enabled
→ last-run status
```

The draft CLI persists pending state before it exits, so a crash between phases is recoverable. `--dry-run` renders articles and reports which posts would become pending, but never launches Chrome or writes publication state.

`--force` may rebuild a non-published draft, but it never resets `manual` or `published` records and never authorizes publication.

## 8. State Model

Each post gains a publication block:

```json
{
  "fingerprint": "latest-observed-source-fingerprint",
  "mediaId": "wechat-draft-media-id",
  "title": "article title",
  "sourceUrl": "https://example.com/blog/.../",
  "publication": {
    "status": "manual | pending | publishing | reconcile | published | blocked",
    "eligibleAt": "ISO timestamp or null",
    "draftFingerprint": "fingerprint sent to the eligible draft or null",
    "publishStartedAt": "ISO timestamp or null",
    "publishedAt": "ISO timestamp or null",
    "publishedUrl": "URL or null",
    "platformArticleId": "ID or null",
    "lastError": "sanitized local diagnostic or null"
  }
}
```

Publisher-level state contains:

```json
{
  "armedAt": "ISO timestamp",
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
publishing + uncertain result ─────────→ reconcile
pending + safe deterministic failure ──→ blocked
blocked + explicit retry after repair ─→ pending
```

There is no transition from `published` back to `pending`.

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
```

`--retry` moves one `blocked` record back to `pending` after a safe pre-click failure. It cannot change a `reconcile` or `published` record. A `reconcile` record requires the operator to inspect WeChat and use `publisher:resolve`: `--published` records the verified result, while `--not-published` returns it to `pending`. The latter is an explicit human assertion that the earlier click did not publish anything.

Private configuration additions:

```text
WECHAT_AUTO_PUBLISH=0
WECHAT_BROWSER_CHANNEL=chrome
WECHAT_BROWSER_HEADLESS=0
```

Automatic publication is opt-in. Installation and code deployment do not change `WECHAT_AUTO_PUBLISH` from `0` to `1`.

Status output shows arming state, browser login health, pending count, reconcile count, blocked count, and the last verified publication. It does not print cookies, access tokens, page contents, or private browser paths beyond the existing Agent home location.

## 11. Error Handling

The publisher distinguishes these conditions:

- **Not armed:** draft sync continues; publication is skipped with one clear message.
- **Not logged in / QR visible:** mark the run failed and request `wechat:publisher:login`.
- **CAPTCHA or account verification:** stop immediately; no retry click.
- **No exact draft:** block that record and preserve its media ID.
- **Multiple exact drafts:** block rather than guess.
- **Unexpected confirmation dialog:** stop before confirming.
- **Navigation timeout before click:** leave `pending` for a safe retry.
- **Failure after click begins:** move to `reconcile`; never click again automatically.
- **Published match found during preflight:** mark `published` without clicking.
- **Browser profile locked by another Chrome process:** fail the run without copying or deleting profile data.

`blocked` records can be retried only with the explicit `--retry POST_ID` command. `reconcile` records can be changed only with the explicit resolve commands described above.

Errors saved to state are sanitized and bounded. DOM dumps, cookies, local storage, API secrets, and full HTML are never logged.

On failure, an optional screenshot may be written under the private Agent diagnostics directory with mode `0600`. The default retention is three screenshots; none are committed or uploaded.

## 12. Safety and Privacy

- The browser profile and diagnostics remain under the private Agent home.
- The repository contains code and fixtures only, never an authenticated profile.
- The existing LaunchAgent lock prevents simultaneous draft and publish runs.
- Exact matching and explicit page-state assertions replace fuzzy or visual guessing.
- No browser cookie is converted into an unofficial HTTP client credential.
- Auto-publish is disabled by default and requires login, arm, and environment enablement.
- Existing articles are grandfathered before enablement.
- `content/published/` is documented as an externally publishing action once enabled.

## 13. Testing Strategy

### Unit tests

- State migration preserves version-1 draft records.
- Arming marks every current post `manual` and is idempotent.
- A new successful `draft/add` becomes `pending` only after arming.
- Existing and baseline posts never become eligible.
- `published` is terminal, including after source edits and `--force`.
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
- CAPTCHA and session-expired pages.

Tests assert real DOM behavior and click counts. They never access `mp.weixin.qq.com` or publish external content.

### Integration tests

- Draft add → pending → fake browser success → published.
- Crash before click → safe pending retry.
- Crash or timeout after click → reconcile without a second click.
- Preflight finds prior publication → published without clicking.
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

## 14. Rollout

1. Add state migration and eligibility rules while auto-publish remains disabled.
2. Add local browser fixtures and deterministic publisher tests.
3. Add the dedicated browser profile and login/status commands.
4. Add publisher orchestration and Agent integration.
5. Deploy with `WECHAT_AUTO_PUBLISH=0` and verify draft sync remains unchanged.
6. Login, arm, and verify current articles are grandfathered.
7. Set `WECHAT_AUTO_PUBLISH=1` only after dry-run is clean.
8. Use the next deliberately selected new article for real acceptance.

## 15. Rollback

Set:

```text
WECHAT_AUTO_PUBLISH=0
```

The Agent immediately returns to draft-only behavior. Draft synchronization, website deployment, and stored publication history remain intact. The browser profile may be retained for later use or removed manually after the Agent is stopped. Rollback never changes published WeChat articles.

## 16. Success Criteria

- No current article is automatically published during installation or enablement.
- The first new eligible article progresses from draft creation to one verified publication without a second confirmation.
- Re-running the Agent never clicks publish again for that article.
- Editing that article later performs no WeChat draft or browser mutation.
- Login expiry, CAPTCHA, ambiguous matches, and page changes fail closed.
- Disabling the feature restores the existing draft-only workflow without code rollback.
