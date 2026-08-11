# WeChat Automatic Publish and Withdrawal E2E Design

## Goal

Prove and repair the complete unattended lifecycle: a newly synced draft is published exactly once, verified as a unique published record, later receives a strict withdrawal marker, is withdrawn exactly once, and is verified inaccessible. Re-running any stage must not repeat a destructive click.

## Test boundary

The E2E uses a stateful local semantic WeChat fixture and the real `WechatBrowserAdapter`, lifecycle state machine, state files, source inventory, and withdrawal marker parser. It never calls the real WeChat account. Network/API upload behavior remains covered by client and sync contract tests.

The fixture must model dashboard navigation, draft editor, publish confirmation, published list/detail, withdrawal confirmation, and public URL availability. Publish moves the fixture record from draft to published; withdrawal removes it and changes the public URL response from 200 to 410.

Production published-list discovery must wait for loading to settle and exhaust every page before reporting absence. It must reject duplicate identity matches across pages. The E2E uses the production readiness/search implementation rather than injecting a fixture-only replacement.

## Safety invariants

- Persist `publishing` before the publish click and `withdrawing` before the withdrawal click.
- A click with uncertain verification enters reconciliation and never clicks again automatically.
- Automatic withdrawal runs before automatic publication in the same queue.
- Baseline or ever-published content is never newly auto-published.
- Only a strict, source-absent withdrawal marker authorizes withdrawal.
- Page-shape, identity, login, CAPTCHA, verification, or incomplete-list ambiguity fails closed.
- Pagination is traversed exhaustively; a missing page, cyclic next link, inconsistent total, or duplicate match remains ambiguous.
- A record already marked `published` cannot become `withdrawn` from list absence alone when a saved public URL exists; the public URL must return 404 or 410.
- The test is deterministic and runnable without an installed Chrome channel when bundled Chromium is available; a missing browser skips only the browser contract test with an explicit reason.

## Baseline finding

At plan creation, `pnpm test` passed 161 of 162 tests. The sole failure was the semantic browser fixture test because the installed Chrome process was terminated with `SIGABRT` and the test only classified a missing executable as skippable. The E2E repair must separate browser-environment unavailability from application assertions and make the CI/browser selection explicit.

The audit also found two application-level root causes: `livePublishedListReadiness()` rejects every paginated real account before candidate search, and the `published + list absent` withdrawal branch bypasses the existing public URL verification. Both receive failing regression tests before implementation changes.

## Controlled live acceptance

After all local suites pass, one explicit opt-in live acceptance creates exactly two uniquely named temporary sources: one `kind: article` and one `kind: note`. A dedicated state file is armed before the sources are created so every real pre-existing post is baseline and ineligible. The titles include `[E2E-DELETE]` plus a unique run ID.

The acceptance syncs both drafts, automatically publishes and verifies them, creates strict source-absent withdrawal markers, automatically withdraws them, verifies their public URLs are unavailable, and then removes both Markdown files, any test assets, markers, and disposable generated posters. The dedicated private lifecycle record is retained as the audit trail and duplicate-publication guard. A failure never targets, edits, publishes, withdraws, or deletes a non-test record.
