# Task 6 report — draft-box-only WeChat workflow

## Scope correction

The owner canceled automatic WeChat publication and withdrawal. The supported pipeline now ends at a successfully added or updated WeChat draft; final review, publication, and removal happen manually in the WeChat admin UI.

## RED

- Mac Agent tests failed because `runAgent()` still invoked `wechat-publish.cjs` after draft sync.
- Dry-run and force tests observed a second publisher child.
- The private environment template and status output still advertised browser lifecycle flags.
- `package.json` still exposed five `wechat:publisher:*` commands.
- Armed legacy sync state still produced `pending` records and retained publisher arming.

## GREEN

- `runAgent()` invokes only `wechat-sync.cjs --automatic`, with optional `--dry-run` or `--force`.
- Legacy auto-publish/withdraw values, including `1`, cannot create a publisher child.
- New configuration templates and status output omit all browser publication settings.
- Draft sync clears legacy publisher arming before API work and changes unpublished `pending` or publish-blocked records to `draft_only`.
- New and updated article/note drafts remain `draft_only`; historical published identity and `everPublished` protection remain intact.
- Supported package commands and operator documentation end at the draft box.
- Moving or deleting Markdown never mutates an already published WeChat item.

## Verification

- Focused draft sync tests: 48/48 passed.
- Mac Agent tests: 12/12 passed.
- `pnpm build`: passed; 20 Eleventy outputs.
- Full `pnpm test`: 246/247 passed. The single failure is the pre-existing real Chrome fixture launch under the Codex macOS sandbox (`SIGABRT` plus kill `EPERM`) before adapter assertions; the retired browser publisher is not invoked by the supported workflow.
- No real WeChat network, publish, withdrawal, or live-browser acceptance action was performed.
