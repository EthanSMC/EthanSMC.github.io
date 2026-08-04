import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { syncWechatDrafts } = require("../scripts/wechat/sync.cjs");
const { loadState } = require("../scripts/wechat/state.cjs");
const { parseArguments } = require("../scripts/wechat-sync.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-sync-"));
  fs.mkdirSync(path.join(root, "content", "published"), { recursive: true });
  fs.mkdirSync(path.join(root, "content", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "content", "assets", "cover.png"), "png fixture");
  fs.writeFileSync(
    path.join(root, "content", "published", "2026-08-04-120000.md"),
    "# 第一版\n\n正文。\n\n![封面](../assets/cover.png)\n",
  );
  return root;
}

function fakeClient() {
  const calls = [];
  return {
    calls,
    async uploadArticleImage(filename) {
      calls.push(["uploadArticleImage", path.basename(filename)]);
      return "https://mmbiz.qpic.cn/uploaded";
    },
    async uploadPermanentImage(filename) {
      calls.push(["uploadPermanentImage", path.basename(filename)]);
      return "cover-media";
    },
    async addDraft(article) {
      calls.push(["addDraft", article.title]);
      return "draft-media";
    },
    async updateDraft(mediaId, article) {
      calls.push(["updateDraft", mediaId, article.title]);
    },
  };
}

function config(root) {
  return {
    appId: "app-id",
    appSecret: "secret",
    author: "Ethan",
    siteUrl: "https://example.com",
    defaultCover: "",
    stateFile: path.join(root, ".wechat-sync", "state.json"),
  };
}

test("accepts pnpm's argument separator", () => {
  assert.deepEqual(parseArguments(["--", "--dry-run"]), {
    range: null,
    dryRun: true,
    force: false,
    automatic: false,
  });
});

test("adds once, skips unchanged content, and updates the same draft after edits", async () => {
  const root = fixture();
  const client = fakeClient();
  const logs = [];

  const first = await syncWechatDrafts({ root, config: config(root), client, logger: (line) => logs.push(line) });
  assert.equal(first.results[0].action, "add");
  assert.deepEqual(client.calls.map((call) => call[0]), [
    "uploadArticleImage",
    "uploadPermanentImage",
    "addDraft",
  ]);

  const second = await syncWechatDrafts({ root, config: config(root), client, logger: (line) => logs.push(line) });
  assert.equal(second.results[0].action, "skipped");
  assert.equal(client.calls.length, 3);

  fs.writeFileSync(
    path.join(root, "content", "published", "2026-08-04-120000.md"),
    "# 第二版\n\n正文有变化。\n\n![封面](../assets/cover.png)\n",
  );
  const third = await syncWechatDrafts({ root, config: config(root), client, logger: (line) => logs.push(line) });
  assert.equal(third.results[0].action, "update");
  assert.deepEqual(client.calls.at(-1), ["updateDraft", "draft-media", "第二版"]);
  assert.equal(client.calls.filter((call) => call[0] === "uploadArticleImage").length, 1);
  assert.equal(client.calls.filter((call) => call[0] === "uploadPermanentImage").length, 1);

  const state = loadState(config(root).stateFile);
  assert.equal(state.posts["2026-08-04-120000"].mediaId, "draft-media");
  assert.ok(state.posts["2026-08-04-120000"].fingerprint);
});

test("dry-run validates a draft without credentials, API mutations, or state writes", async () => {
  const root = fixture();
  const logs = [];
  const result = await syncWechatDrafts({
    root,
    config: config(root),
    dryRun: true,
    logger: (line) => logs.push(line),
  });
  assert.equal(result.results[0].action, "dry-run-add");
  assert.match(logs.join("\n"), /\[dry-run\] 新增草稿/);
  assert.equal(fs.existsSync(config(root).stateFile), false);
});

test("marks source deletions for manual WeChat handling without deleting remotely", async () => {
  const root = fixture();
  const client = fakeClient();
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  fs.unlinkSync(path.join(root, "content", "published", "2026-08-04-120000.md"));
  const logs = [];
  const result = await syncWechatDrafts({ root, config: config(root), client, logger: (line) => logs.push(line) });

  assert.equal(result.results.length, 0);
  assert.match(logs.join("\n"), /公众号仍需人工处理/);
  assert.ok(loadState(config(root).stateFile).posts["2026-08-04-120000"].sourceDeletedAt);
  assert.equal(client.calls.filter((call) => call[0] === "updateDraft").length, 0);
});
