import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { syncWechatDrafts } = require("../scripts/wechat/sync.cjs");
const { desiredLocation, loadWithdrawalMarkers } = require("../scripts/wechat/lifecycle-intent.cjs");
const { emptyPublication } = require("../scripts/wechat/lifecycle-state.cjs");
const { emptyState, loadState, saveState } = require("../scripts/wechat/state.cjs");
const { parseArguments } = require("../scripts/wechat-sync.cjs");

const POST_ID = "2026-08-04-120000";

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
    async deleteDraft(mediaId) {
      calls.push(["deleteDraft", mediaId]);
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

function markerPath(root, postId = POST_ID) {
  return path.join(root, "content", ".lifecycle", "withdrawals", `${postId}.json`);
}

function writeMarker(root, postId = POST_ID, value = {
  postId,
  requestedAt: "2026-08-07T00:00:00.000Z",
}) {
  const filename = markerPath(root, postId);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`);
}

function writeLifecycleState(root, configure) {
  const state = emptyState();
  configure(state);
  saveState(config(root).stateFile, state);
  return state;
}

test("loads only strict content-free withdrawal markers", () => {
  assert.equal(typeof loadWithdrawalMarkers, "function");
  const root = fixture();
  writeMarker(root);

  const markers = loadWithdrawalMarkers(root);

  assert.equal(markers.size, 1);
  assert.equal(markers.get(POST_ID).postId, POST_ID);
  assert.equal(markers.get(POST_ID).requestedAt, "2026-08-07T00:00:00.000Z");
});

test("rejects malformed withdrawal markers", () => {
  assert.equal(typeof loadWithdrawalMarkers, "function");
  const invalidMarkers = [
    {
      filename: `${POST_ID}.json`,
      contents: JSON.stringify({
        postId: POST_ID,
        requestedAt: "2026-08-07T00:00:00.000Z",
        title: "private content must not be accepted",
      }),
    },
    {
      filename: "not-a-post-id.json",
      contents: JSON.stringify({
        postId: "not-a-post-id",
        requestedAt: "2026-08-07T00:00:00.000Z",
      }),
    },
    {
      filename: `${POST_ID}.json`,
      contents: JSON.stringify({
        postId: "2026-08-05-120000",
        requestedAt: "2026-08-07T00:00:00.000Z",
      }),
    },
    {
      filename: `${POST_ID}.json`,
      contents: JSON.stringify({ postId: POST_ID, requestedAt: "not-a-date" }),
    },
    {
      filename: `${POST_ID}.json`,
      contents: "{",
    },
  ];

  for (const invalid of invalidMarkers) {
    const root = fixture();
    const filename = path.join(root, "content", ".lifecycle", "withdrawals", invalid.filename);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, invalid.contents);
    assert.throws(() => loadWithdrawalMarkers(root), /撤回标记格式无效/);
  }
});

test("published sources take precedence over historical withdrawal markers", () => {
  assert.equal(typeof desiredLocation, "function");
  const markers = new Map([[POST_ID, { postId: POST_ID, requestedAt: "2026-08-07T00:00:00.000Z" }]]);
  assert.equal(desiredLocation(POST_ID, new Set([POST_ID]), markers), "published");
  assert.equal(desiredLocation(POST_ID, new Set(), markers), "drafts");
  assert.equal(desiredLocation(POST_ID, new Set(), new Map()), null);
});

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
  assert.equal(state.posts[POST_ID].publication.status, "manual");
});

test("makes an armed new post pending only after draft creation succeeds", async () => {
  const root = fixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
  });

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const record = loadState(config(root).stateFile).posts[POST_ID];

  assert.equal(result.results[0].action, "add");
  assert.equal(record.publication.status, "pending");
  assert.equal(record.publication.desiredLocation, "published");
  assert.equal(record.publication.draftFingerprint, record.fingerprint);
  assert.ok(Number.isFinite(Date.parse(record.publication.eligibleAt)));
});

test("does not make an armed new post pending when draft creation fails", async () => {
  const root = fixture();
  const client = fakeClient();
  client.addDraft = async (article) => {
    client.calls.push(["addDraft", article.title]);
    throw new Error("draft/add failed");
  };
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
  });

  await assert.rejects(
    syncWechatDrafts({ root, config: config(root), client, logger: () => {} }),
    /draft\/add failed/,
  );

  assert.equal(loadState(config(root).stateFile).posts[POST_ID], undefined);
});

test("restores a canceled non-baseline post to pending only after draft update succeeds", async () => {
  const root = fixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.posts[POST_ID] = {
      fingerprint: "old-observed-fingerprint",
      mediaId: "draft-media",
      title: "旧标题",
      publication: {
        ...emptyPublication("draft_only"),
        desiredLocation: "drafts",
      },
    };
  });

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const record = loadState(config(root).stateFile).posts[POST_ID];

  assert.equal(result.results[0].action, "update");
  assert.equal(record.publication.status, "pending");
  assert.equal(record.publication.desiredLocation, "published");
  assert.equal(record.publication.draftFingerprint, record.fingerprint);
  assert.equal(client.calls.filter(([name]) => name === "updateDraft").length, 1);
});

test("keeps a canceled post draft-only when draft update fails", async () => {
  const root = fixture();
  const client = fakeClient();
  client.updateDraft = async (mediaId, article) => {
    client.calls.push(["updateDraft", mediaId, article.title]);
    throw new Error("draft/update failed");
  };
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.posts[POST_ID] = {
      fingerprint: "old-observed-fingerprint",
      mediaId: "draft-media",
      publication: {
        ...emptyPublication("draft_only"),
        desiredLocation: "drafts",
      },
    };
  });

  await assert.rejects(
    syncWechatDrafts({ root, config: config(root), client, logger: () => {} }),
    /draft\/update failed/,
  );

  const publication = loadState(config(root).stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "draft_only");
  assert.equal(publication.desiredLocation, "published");
});

test("keeps baseline posts manual after successful draft creation", async () => {
  const root = fixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselinePostIds = [POST_ID];
  });

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  const publication = loadState(config(root).stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "manual");
  assert.equal(publication.draftFingerprint, null);
});

test("an inactive historical marker does not cancel a currently published source", async () => {
  const root = fixture();
  const client = fakeClient();
  writeMarker(root);
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
  });

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  const publication = loadState(config(root).stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "pending");
  assert.equal(publication.desiredLocation, "published");
  assert.equal(client.calls.filter(([name]) => name === "addDraft").length, 1);
});

test("active markers cancel safe publication states before any WeChat API call", async () => {
  const root = fixture();
  const client = fakeClient();
  fs.unlinkSync(path.join(root, "content", "published", `${POST_ID}.md`));
  const statuses = new Map([
    ["2026-08-01-000001", "pending"],
    ["2026-08-01-000002", "blocked"],
    ["2026-08-01-000003", "manual"],
    ["2026-08-01-000004", "publishing"],
    ["2026-08-01-000005", "publish_reconcile"],
    ["2026-08-01-000006", "published"],
    ["2026-08-01-000007", "withdrawing"],
    ["2026-08-01-000008", "withdraw_reconcile"],
  ]);
  for (const postId of statuses.keys()) writeMarker(root, postId);
  writeLifecycleState(root, (state) => {
    for (const [postId, status] of statuses) {
      state.posts[postId] = {
        fingerprint: "observed",
        mediaId: `draft-${postId}`,
        publication: {
          ...emptyPublication(status),
          everPublished: ["published", "withdrawing", "withdraw_reconcile"].includes(status),
          blockedOperation: status === "blocked" ? "publish" : null,
        },
      };
    }
  });

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const state = loadState(config(root).stateFile);

  assert.deepEqual(result.results, []);
  assert.equal(state.posts["2026-08-01-000001"].publication.status, "draft_only");
  assert.equal(state.posts["2026-08-01-000002"].publication.status, "draft_only");
  for (const [postId, status] of [...statuses].slice(2)) {
    assert.equal(state.posts[postId].publication.status, status);
  }
  for (const postId of statuses.keys()) {
    assert.equal(state.posts[postId].publication.desiredLocation, "drafts");
  }
  assert.equal(client.calls.length, 0);
  assert.equal(client.calls.filter(([name]) => name === "deleteDraft").length, 0);
});

test("rejects a malformed marker before any WeChat API call", async () => {
  const root = fixture();
  const client = fakeClient();
  writeMarker(root, POST_ID, {
    postId: POST_ID,
    requestedAt: "2026-08-07T00:00:00.000Z",
    title: "must not leave the machine",
  });

  await assert.rejects(
    syncWechatDrafts({ root, config: config(root), client, logger: () => {} }),
    /撤回标记格式无效/,
  );
  assert.equal(client.calls.length, 0);
});

test("ever-published records update only the observed website fingerprint", async () => {
  for (const status of ["published", "withdrawn"]) {
    const root = fixture();
    const client = fakeClient();
    const publication = {
      ...emptyPublication(status),
      everPublished: true,
      draftFingerprint: "frozen-draft-fingerprint",
      publishedAt: "2026-08-07T01:00:00.000Z",
      publishedUrl: "https://mp.weixin.qq.com/s/frozen",
      platformArticleId: "frozen-id",
    };
    writeLifecycleState(root, (state) => {
      state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
      state.posts[POST_ID] = {
        fingerprint: "old-observed-fingerprint",
        mediaId: "published-media",
        title: "保留的公众号标题",
        sourceUrl: "https://example.com/frozen-source",
        syncedAt: "2026-08-07T01:30:00.000Z",
        sourceDeletedAt: "2026-08-07T01:45:00.000Z",
        publication,
      };
    });

    const result = await syncWechatDrafts({
      root,
      config: config(root),
      client,
      force: true,
      logger: () => {},
    });
    const record = loadState(config(root).stateFile).posts[POST_ID];

    assert.equal(result.results[0].action, "website-only");
    assert.notEqual(record.fingerprint, "old-observed-fingerprint");
    assert.equal(record.mediaId, "published-media");
    assert.equal(record.title, "保留的公众号标题");
    assert.equal(record.sourceUrl, "https://example.com/frozen-source");
    assert.equal(record.syncedAt, "2026-08-07T01:30:00.000Z");
    assert.equal(record.sourceDeletedAt, "2026-08-07T01:45:00.000Z");
    assert.deepEqual(record.publication, publication);
    assert.equal(client.calls.length, 0);
  }
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

test("dry-run leaves restored unchanged source state bytes untouched", async () => {
  const root = fixture();
  const client = fakeClient();
  const stateFile = config(root).stateFile;
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const state = loadState(stateFile);
  state.posts[POST_ID].sourceDeletedAt = "2026-08-07T02:00:00.000Z";
  state.posts[POST_ID].publication.desiredLocation = "drafts";
  saveState(stateFile, state);
  const before = fs.readFileSync(stateFile);

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    dryRun: true,
    logger: () => {},
  });

  assert.equal(result.results[0].action, "skipped");
  assert.deepEqual(fs.readFileSync(stateFile), before);
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
  const deletedAt = loadState(config(root).stateFile).posts[POST_ID].sourceDeletedAt;
  assert.ok(deletedAt);
  assert.equal(client.calls.filter((call) => call[0] === "updateDraft").length, 0);

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  assert.equal(loadState(config(root).stateFile).posts[POST_ID].sourceDeletedAt, deletedAt);
  assert.equal(client.calls.filter((call) => call[0] === "deleteDraft").length, 0);
});
