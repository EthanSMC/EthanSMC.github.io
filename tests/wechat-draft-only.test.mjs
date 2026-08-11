import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { syncWechatDrafts } = require("../scripts/wechat/sync.cjs");
const { emptyPublication } = require("../scripts/wechat/lifecycle-state.cjs");
const { emptyState, loadState, saveState } = require("../scripts/wechat/state.cjs");

const PENDING_ID = "2026-08-12-090000";
const PUBLISHED_ID = "2026-08-12-100000";

function rootFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-draft-only-"));
  for (const directory of ["published", "albums", "assets"]) {
    fs.mkdirSync(path.join(root, "content", directory), { recursive: true });
  }
  return root;
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

function armedState() {
  const state = emptyState();
  state.publisher = {
    armedAt: "2026-08-12T00:00:00.000Z",
    baselineCaptured: true,
    baselinePostIds: [],
    browserSessionCheckedAt: "2026-08-12T00:01:00.000Z",
  };
  return state;
}

test("draft sync clears legacy arming and downgrades unpublished automatic lifecycle state", async (t) => {
  const root = rootFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = armedState();
  state.posts[PENDING_ID] = {
    publication: {
      ...emptyPublication("pending"),
      eligibleAt: "2026-08-12T00:02:00.000Z",
      draftFingerprint: "pending-fingerprint",
    },
  };
  state.posts[PUBLISHED_ID] = {
    publication: {
      ...emptyPublication("published"),
      everPublished: true,
      publishedAt: "2026-08-12T00:03:00.000Z",
      publishedUrl: "https://mp.weixin.qq.com/s/historical",
      platformArticleId: "historical-id",
    },
  };
  saveState(config(root).stateFile, state);

  await syncWechatDrafts({
    root,
    config: config(root),
    client: new Proxy({}, { get: () => { throw new Error("draft API must not be called"); } }),
    logger: () => {},
  });

  const saved = loadState(config(root).stateFile);
  assert.deepEqual(saved.publisher, {
    armedAt: null,
    baselineCaptured: false,
    baselinePostIds: [],
    browserSessionCheckedAt: null,
  });
  assert.equal(saved.posts[PENDING_ID].publication.status, "draft_only");
  assert.equal(saved.posts[PENDING_ID].publication.eligibleAt, null);
  assert.equal(saved.posts[PENDING_ID].publication.blockedOperation, null);
  assert.equal(saved.posts[PUBLISHED_ID].publication.status, "published");
  assert.equal(saved.posts[PUBLISHED_ID].publication.everPublished, true);
  assert.equal(saved.posts[PUBLISHED_ID].publication.publishedUrl, "https://mp.weixin.qq.com/s/historical");
  assert.equal(saved.posts[PUBLISHED_ID].publication.platformArticleId, "historical-id");
});

test("an armed legacy state still creates only a non-eligible article draft", async (t) => {
  const root = rootFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "content", "assets", "cover.png"), "cover");
  fs.writeFileSync(
    path.join(root, "content", "published", `${PENDING_ID}.md`),
    "---\nkind: article\n---\n# 只进入草稿箱\n\n这篇文章必须由我在微信后台检查后手动发表。\n\n![封面](../assets/cover.png)\n",
  );
  saveState(config(root).stateFile, armedState());
  const calls = [];
  const client = {
    async uploadArticleImage() {
      calls.push("uploadArticleImage");
      return "https://mmbiz.qpic.cn/cover";
    },
    async uploadPermanentImage() {
      calls.push("uploadPermanentImage");
      return "cover-media";
    },
    async addDraft() {
      calls.push("addDraft");
      return "draft-media";
    },
  };

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  const saved = loadState(config(root).stateFile);
  assert.equal(calls.filter((call) => call === "addDraft").length, 1);
  assert.equal(saved.posts[PENDING_ID].mediaId, "draft-media");
  assert.equal(saved.posts[PENDING_ID].publication.status, "draft_only");
  assert.equal(saved.posts[PENDING_ID].publication.eligibleAt, null);
  assert.equal(saved.publisher.armedAt, null);
});
