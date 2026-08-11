import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { changedPostSelection, syncWechatDrafts } = require("../scripts/wechat/sync.cjs");
const { WechatApiError } = require("../scripts/wechat/client.cjs");
const { noteRenderInputHash } = require("../scripts/wechat/note-poster.cjs");
const { runLifecycle } = require("../scripts/wechat/publisher.cjs");
const { desiredLocation, loadWithdrawalMarkers } = require("../scripts/wechat/lifecycle-intent.cjs");
const { emptyPublication } = require("../scripts/wechat/lifecycle-state.cjs");
const { emptyState, loadState, normalizeState, saveState } = require("../scripts/wechat/state.cjs");
const { parseArguments } = require("../scripts/wechat-sync.cjs");

const POST_ID = "2026-08-04-120000";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-sync-"));
  fs.mkdirSync(path.join(root, "content", "published"), { recursive: true });
  fs.mkdirSync(path.join(root, "content", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "content", "assets", "cover.png"), "png fixture");
  fs.writeFileSync(
    path.join(root, "content", "published", "2026-08-04-120000.md"),
    "---\nkind: article\n---\n# 第一版\n\n正文。\n\n![封面](../assets/cover.png)\n",
  );
  return root;
}

function noteFixture({
  id = POST_ID,
  body = "今天把一个小想法变成了可以工作的东西。",
  frontmatter = "kind: note",
} = {}) {
  const root = fixture();
  fs.rmSync(path.join(root, "content", "published", `${POST_ID}.md`));
  const source = `---\n${frontmatter}\n---\n${body}\n`;
  fs.writeFileSync(path.join(root, "content", "published", `${id}.md`), source);
  return { root, id, source };
}

function fakeNoteRenderer({ pages = 1, renderHash = "poster-v1", failFor = null } = {}) {
  const calls = [];
  const render = async (post, options) => {
    calls.push({ postId: post.id, outputDir: options.outputDir });
    if (post.id === failFor) throw new Error(`render failed for ${post.id}`);
    fs.mkdirSync(options.outputDir, { recursive: true });
    const files = [];
    for (let index = 0; index < pages; index += 1) {
      const filename = path.join(options.outputDir, `page-${String(index + 1).padStart(2, "0")}.png`);
      fs.writeFileSync(filename, `PNG:${post.id}:${renderHash}:${index + 1}`);
      files.push(filename);
    }
    return {
      pages: Array.from({ length: pages }, (_, index) => ({ number: index + 1, total: pages })),
      files,
      renderHash,
      cast: post.cast,
    };
  };
  render.calls = calls;
  return render;
}

function fakeClient() {
  const calls = [];
  const draftPayloads = { add: [], update: [] };
  return {
    calls,
    draftPayloads,
    async uploadArticleImage(filename) {
      calls.push(["uploadArticleImage", path.basename(filename)]);
      return "https://mmbiz.qpic.cn/uploaded";
    },
    async uploadPermanentImage(filename) {
      calls.push(["uploadPermanentImage", path.basename(filename)]);
      return "cover-media";
    },
    async uploadNewspicImage(filename) {
      calls.push(["uploadNewspicImage", path.basename(filename)]);
      return `newspic-${path.basename(filename)}`;
    },
    async addDraft(article) {
      calls.push(["addDraft", article.title]);
      draftPayloads.add.push(article);
      return "draft-media";
    },
    async updateDraft(mediaId, article) {
      calls.push(["updateDraft", mediaId, article.title]);
      draftPayloads.update.push({ mediaId, article });
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
      contents: JSON.stringify({ postId: POST_ID, requestedAt: "2026-08-07T08:00:00+08:00" }),
    },
    {
      filename: `${POST_ID}.json`,
      contents: JSON.stringify({ postId: POST_ID, requestedAt: "2026-08-07T00:00:00Z" }),
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

test("normalizes native draft metadata while preserving legacy publication identity", () => {
  const state = normalizeState({
    version: 2,
    posts: {
      legacy: {
        mediaId: "legacy-draft",
        publication: {
          ...emptyPublication("published"),
          everPublished: true,
          publishedUrl: "https://mp.weixin.qq.com/s/legacy",
        },
      },
      note: {
        sourceMd5: "0123456789abcdef0123456789abcdef",
        renderHash: "render-v1",
        renderInputHash: "input-v1",
        renderCast: "molly",
        draftKind: "newspic",
        generatedImages: [
          { filename: "page-01.png", hash: "page-hash", mediaId: "image-media" },
        ],
        publication: emptyPublication("manual"),
      },
      invalidManifest: {
        sourceMd5: "0123456789abcdef0123456789abcdef",
        renderHash: "render-v1",
        renderInputHash: "input-v1",
        renderCast: "molly",
        draftKind: "newspic",
        generatedImages: [
          { filename: "page-01.png", hash: "page-1", mediaId: "image-1" },
          { filename: "page-03.png", hash: "page-3", mediaId: "image-3" },
        ],
        publication: emptyPublication("manual"),
      },
    },
  });

  assert.equal(state.version, 2);
  assert.equal(state.posts.legacy.sourceMd5, null);
  assert.equal(state.posts.legacy.renderHash, null);
  assert.equal(state.posts.legacy.renderInputHash, null);
  assert.equal(state.posts.legacy.renderCast, null);
  assert.equal(state.posts.legacy.draftKind, "news");
  assert.deepEqual(state.posts.legacy.generatedImages, []);
  assert.equal(state.posts.legacy.publication.everPublished, true);
  assert.equal(state.posts.legacy.publication.publishedUrl, "https://mp.weixin.qq.com/s/legacy");
  assert.deepEqual(state.posts.note.generatedImages, [
    { filename: "page-01.png", hash: "page-hash", mediaId: "image-media" },
  ]);
  assert.equal(state.posts.note.renderInputHash, "input-v1");
  assert.equal(state.posts.note.renderCast, "molly");
  assert.deepEqual(state.posts.invalidManifest.generatedImages, []);
});

test("loads album metadata only from the supplied temporary root", async () => {
  const { root } = noteFixture();
  fs.mkdirSync(path.join(root, "content", "albums"), { recursive: true });
  fs.writeFileSync(path.join(root, "content", "albums", "invalid.md"), "# missing album frontmatter\n");
  const client = fakeClient();

  await assert.rejects(
    syncWechatDrafts({
      root,
      config: config(root),
      client,
      renderNote: fakeNoteRenderer(),
      logger: () => {},
    }),
    /Album file must declare kind: album/,
  );
  assert.deepEqual(client.calls, []);
});

test("changed selection ignores album metadata but includes changed note source", () => {
  const { root, id } = noteFixture();
  fs.mkdirSync(path.join(root, "content", "albums"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "content", "albums", "Collection.md"),
    "---\nkind: album\nslug: collection\n---\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "content"], { cwd: root });
  execFileSync("git", [
    "-c", "user.name=Test", "-c", "user.email=test@example.com",
    "commit", "-qm", "fixture",
  ], { cwd: root });
  const posts = [{ filename: `${id}.md`, attachments: [] }];

  fs.appendFileSync(path.join(root, "content", "albums", "Collection.md"), "description update\n");
  assert.deepEqual(changedPostSelection(root, posts, "HEAD").posts, []);

  fs.appendFileSync(path.join(root, "content", "published", `${id}.md`), "note update\n");
  assert.deepEqual(changedPostSelection(root, posts, "HEAD").posts, posts);
});

test("stores the raw Markdown MD5 for a native note and skips an unchanged draft", async () => {
  const { root, id, source } = noteFixture({ body: "原样保留 CRLF 前的正文。\r" });
  const client = fakeClient();
  const renderNote = fakeNoteRenderer();

  const first = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote,
    logger: () => {},
  });
  const saved = loadState(config(root).stateFile).posts[id];

  assert.equal(first.results[0].action, "add");
  assert.equal(saved.sourceMd5, crypto.createHash("md5").update(Buffer.from(source)).digest("hex"));
  assert.equal(saved.renderHash, "poster-v1");
  assert.equal(saved.draftKind, "newspic");
  assert.deepEqual(saved.generatedImages.map(({ filename }) => filename), ["page-01.png"]);
  assert.equal(client.draftPayloads.add[0].article_type, "newspic");

  const callsAfterFirstSync = client.calls.length;
  const second = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote,
    logger: () => {},
  });

  assert.equal(second.results[0].action, "skipped");
  assert.equal(client.calls.length, callsAfterFirstSync);
});

test("keeps rendered note PNGs temporary and persists only their strict manifest", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  const renderNote = fakeNoteRenderer({ pages: 2 });

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote,
    logger: () => {},
  });
  const saved = loadState(config(root).stateFile).posts[id];

  assert.equal(result.results[0].action, "add");
  assert.deepEqual(saved.generatedImages.map(({ filename }) => filename), ["page-01.png", "page-02.png"]);
  assert.equal(fs.existsSync(path.join(root, ".wechat-sync", "generated")), false);
  assert.equal(fs.existsSync(renderNote.calls[0].outputDir), false);
});

test("a valid preflight cache skips rendering, classification, browser, and API work", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  let classifierCalls = 0;
  const noteRenderInput = async (_post, options) => {
    const cast = options.resolvedCast || (() => {
      classifierCalls += 1;
      return "molly";
    })();
    return { renderInputHash: `input-v1-${cast}`, cast };
  };
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: fakeNoteRenderer(),
    logger: () => {},
  });
  client.calls.length = 0;
  classifierCalls = 0;
  let renderCalls = 0;

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: async () => {
      renderCalls += 1;
      throw new Error("valid cache must bypass renderer");
    },
    logger: () => {},
  });
  const saved = loadState(config(root).stateFile).posts[id];

  assert.equal(result.results[0].action, "skipped");
  assert.equal(saved.renderInputHash, "input-v1-molly");
  assert.equal(saved.renderCast, "molly");
  assert.equal(classifierCalls, 0);
  assert.equal(renderCalls, 0);
  assert.deepEqual(client.calls, []);
});

test("migrates a legacy note cache once before future preflight skips", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  const noteRenderInput = async () => ({ renderInputHash: "input-v1", cast: "molly" });
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: fakeNoteRenderer({ renderHash: "poster-v1" }),
    logger: () => {},
  });
  const legacyState = loadState(config(root).stateFile);
  legacyState.posts[id].renderInputHash = null;
  legacyState.posts[id].renderCast = null;
  saveState(config(root).stateFile, legacyState);
  client.calls.length = 0;
  const migrationRenderer = fakeNoteRenderer({ renderHash: "poster-v1" });

  const migrated = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: migrationRenderer,
    logger: () => {},
  });
  const skipped = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: async () => { throw new Error("migrated cache must skip rendering"); },
    logger: () => {},
  });

  assert.equal(migrated.results[0].action, "skipped");
  assert.equal(skipped.results[0].action, "skipped");
  assert.equal(migrationRenderer.calls.length, 1);
  assert.equal(loadState(config(root).stateFile).posts[id].renderInputHash, "input-v1");
  assert.deepEqual(client.calls, []);
});

test("keeps a note with wechat false on the website without rendering or API calls", async () => {
  const { root, id } = noteFixture({ frontmatter: "kind: note\nwechat: false" });
  const client = fakeClient();
  const renderNote = async () => {
    throw new Error("opted-out note must not render");
  };

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote,
    logger: () => {},
  });

  assert.equal(result.results[0].action, "wechat-disabled");
  assert.deepEqual(client.calls, []);
  assert.equal(loadState(config(root).stateFile).posts[id], undefined);
  assert.equal(fs.existsSync(path.join(root, ".wechat-sync", "generated", id)), false);
});

test("wechat false keeps an existing never-published draft non-eligible", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
  });
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer(),
    logger: () => {},
  });
  assert.equal(loadState(config(root).stateFile).posts[id].publication.status, "draft_only");
  fs.writeFileSync(
    path.join(root, "content", "published", `${id}.md`),
    "---\nkind: note\nwechat: false\n---\n仍然只发布到网站。\n",
  );
  client.calls.length = 0;

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const publication = loadState(config(root).stateFile).posts[id].publication;

  assert.equal(result.results[0].action, "wechat-disabled");
  assert.equal(publication.status, "draft_only");
  assert.deepEqual(client.calls, []);
});

test("records one note render failure and continues syncing later notes", async () => {
  const failedId = "2026-08-05-120000";
  const successfulId = "2026-08-04-120000";
  const { root } = noteFixture({ id: successfulId, body: "这一篇应该继续同步。" });
  fs.writeFileSync(
    path.join(root, "content", "published", `${failedId}.md`),
    "---\nkind: note\n---\n这一篇渲染失败。\n",
  );
  const client = fakeClient();
  const renderNote = fakeNoteRenderer({ failFor: failedId });

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote,
    logger: () => {},
  });
  const state = loadState(config(root).stateFile);

  assert.deepEqual(result.results.map(({ action }) => action), ["failed", "add"]);
  assert.equal(state.posts[failedId].syncError.code, "sync_failed");
  assert.match(state.posts[failedId].syncError.message, /render failed/);
  assert.equal(state.posts[failedId].draftKind, "newspic");
  assert.equal(state.posts[successfulId].mediaId, "draft-media");
  assert.equal(client.calls.filter(([name]) => name === "addDraft").length, 1);
});

test("a failed note refresh remains draft-only after sync recovers", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
  });
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer(),
    logger: () => {},
  });
  fs.appendFileSync(path.join(root, "content", "published", `${id}.md`), "需要重新渲染。\n");

  const failed = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: async () => { throw new Error("renderer unavailable"); },
    logger: () => {},
  });
  let record = loadState(config(root).stateFile).posts[id];

  assert.equal(failed.results[0].action, "failed");
  assert.equal(record.publication.status, "draft_only");
  assert.equal(record.publication.desiredLocation, "published");

  const recovered = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer({ renderHash: "poster-v2" }),
    logger: () => {},
  });
  record = loadState(config(root).stateFile).posts[id];
  assert.equal(recovered.results[0].action, "update");
  assert.equal(record.publication.status, "draft_only");
  assert.equal(record.syncError, undefined);
});

test("records note upload and draft API failures without blocking unrelated notes", async () => {
  for (const failureStage of ["upload", "draft"]) {
    const failedId = "2026-08-05-120000";
    const successfulId = "2026-08-04-120000";
    const { root } = noteFixture({ id: successfulId, body: "后续正常正文。" });
    fs.writeFileSync(
      path.join(root, "content", "published", `${failedId}.md`),
      `---\nkind: note\n---\n${failureStage} 失败正文。\n`,
    );
    const client = fakeClient();
    if (failureStage === "upload") {
      const upload = client.uploadNewspicImage;
      client.uploadNewspicImage = async (filename) => {
        if (filename.includes(failedId)) {
          const error = new Error("poster upload failed");
          error.code = "upload_failed";
          throw error;
        }
        return upload(filename);
      };
    } else {
      const add = client.addDraft;
      client.addDraft = async (article) => {
        if (article.content.includes("draft 失败")) {
          const error = new Error("draft API failed");
          error.code = "draft_failed";
          throw error;
        }
        return add(article);
      };
    }

    const result = await syncWechatDrafts({
      root,
      config: config(root),
      client,
      renderNote: fakeNoteRenderer(),
      logger: () => {},
    });
    const state = loadState(config(root).stateFile);

    assert.deepEqual(result.results.map(({ action }) => action), ["failed", "add"]);
    assert.equal(state.posts[failedId].syncError.code, `${failureStage}_failed`);
    assert.equal(state.posts[successfulId].mediaId, "draft-media");
  }
});

test("updates the same native note draft after source and renderer changes", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput: async () => ({ renderInputHash: "input-v1", cast: "molly" }),
    renderNote: fakeNoteRenderer({ renderHash: "poster-v1" }),
    logger: () => {},
  });

  fs.writeFileSync(
    path.join(root, "content", "published", `${id}.md`),
    "---\nkind: note\n---\n正文已经改变。\n",
  );
  const sourceChanged = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput: async () => ({ renderInputHash: "input-v2", cast: "molly" }),
    renderNote: fakeNoteRenderer({ renderHash: "poster-v2" }),
    logger: () => {},
  });
  const sameSource = fs.readFileSync(path.join(root, "content", "published", `${id}.md`));
  const rendererChanged = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput: async () => ({ renderInputHash: "input-v3", cast: "molly" }),
    renderNote: fakeNoteRenderer({ renderHash: "poster-v3" }),
    logger: () => {},
  });
  const saved = loadState(config(root).stateFile).posts[id];

  assert.equal(sourceChanged.results[0].action, "update");
  assert.equal(rendererChanged.results[0].action, "update");
  assert.equal(client.calls.filter(([name]) => name === "addDraft").length, 1);
  assert.equal(client.calls.filter(([name]) => name === "updateDraft").length, 2);
  assert.ok(client.calls.filter(([name]) => name === "updateDraft").every((call) => call[1] === "draft-media"));
  assert.equal(saved.sourceMd5, crypto.createHash("md5").update(sameSource).digest("hex"));
  assert.equal(saved.renderHash, "poster-v3");
});

test("rerenders and updates the same note draft when its selected character asset changes", async (t) => {
  const { root } = noteFixture({ frontmatter: "kind: note\ncast: molly" });
  const asset = path.join(root, "molly.jpg");
  fs.writeFileSync(asset, Buffer.from([0xff, 0xd8, 0xff, 0x01]));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = fakeClient();
  const noteRenderInput = (post, options) => noteRenderInputHash(post, {
    ...options,
    rendererFingerprint: "renderer-v1",
    assetPaths: { molly: asset },
  });

  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: fakeNoteRenderer({ renderHash: "poster-v1" }),
    logger: () => {},
  });
  fs.writeFileSync(asset, Buffer.from([0xff, 0xd8, 0xff, 0x02]));
  client.calls.length = 0;
  const changedRenderer = fakeNoteRenderer({ renderHash: "poster-v2" });

  const changed = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    noteRenderInput,
    renderNote: changedRenderer,
    logger: () => {},
  });

  assert.equal(changed.results[0].action, "update");
  assert.equal(changedRenderer.calls.length, 1);
  assert.deepEqual(client.calls.map(([name]) => name), ["uploadNewspicImage", "updateDraft"]);
});

test("adds a replacement note draft only when WeChat reports the stored draft missing", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer({ renderHash: "poster-v1" }),
    logger: () => {},
  });
  fs.appendFileSync(path.join(root, "content", "published", `${id}.md`), "更新。\n");
  client.updateDraft = async (mediaId, article) => {
    client.calls.push(["updateDraft", mediaId, article.title]);
    throw new WechatApiError("update draft", 40007, "invalid media_id");
  };

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer({ renderHash: "poster-v2" }),
    logger: () => {},
  });

  assert.equal(result.results[0].action, "add");
  assert.equal(client.calls.filter(([name]) => name === "updateDraft").length, 1);
  assert.equal(client.calls.filter(([name]) => name === "addDraft").length, 2);
});

test("keeps four poster pages in upload and newspic payload order", async () => {
  const { root } = noteFixture();
  const client = fakeClient();

  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer({ pages: 4 }),
    logger: () => {},
  });

  assert.deepEqual(
    client.calls.filter(([name]) => name === "uploadNewspicImage").map((call) => call[1]),
    ["page-01.png", "page-02.png", "page-03.png", "page-04.png"],
  );
  assert.deepEqual(
    client.draftPayloads.add[0].image_info.image_list,
    [1, 2, 3, 4].map((number) => ({ image_media_id: `newspic-page-0${number}.png` })),
  );
});

test("rejects an incomplete state manifest and replaces it with only the current payload pages", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  const renderNote = fakeNoteRenderer({ pages: 4 });
  await syncWechatDrafts({ root, config: config(root), client, renderNote, logger: () => {} });
  const state = loadState(config(root).stateFile);
  state.posts[id].generatedImages = [
    state.posts[id].generatedImages[0],
    state.posts[id].generatedImages[2],
  ];
  saveState(config(root).stateFile, state);
  client.calls.length = 0;

  const result = await syncWechatDrafts({ root, config: config(root), client, renderNote, logger: () => {} });
  const saved = loadState(config(root).stateFile).posts[id];

  assert.equal(result.results[0].action, "update");
  assert.deepEqual(
    saved.generatedImages.map(({ filename }) => filename),
    ["page-01.png", "page-02.png", "page-03.png", "page-04.png"],
  );
  assert.equal(client.draftPayloads.update.at(-1).article.image_info.image_list.length, 4);
  assert.equal(client.calls.filter(([name]) => name === "uploadNewspicImage").length, 4);
  assert.equal(fs.existsSync(path.join(root, ".wechat-sync", "generated")), false);
});

test("rejects a symlinked .wechat-sync before touching external state data", async () => {
  const { root } = noteFixture();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-state-external-"));
  const sentinel = path.join(external, "sentinel.txt");
  fs.writeFileSync(sentinel, "must stay unchanged");
  fs.symlinkSync(external, path.join(root, ".wechat-sync"), "dir");
  const client = fakeClient();

  await assert.rejects(
    syncWechatDrafts({
      root,
      config: { ...config(root), stateFile: path.join(root, "state.json") },
      client,
      renderNote: fakeNoteRenderer(),
      logger: () => {},
    }),
    /Unsafe sync state path/,
  );

  assert.equal(fs.readFileSync(sentinel, "utf8"), "must stay unchanged");
  assert.deepEqual(fs.readdirSync(external), ["sentinel.txt"]);
  assert.deepEqual(client.calls, []);
});

for (const legacyLayer of ["generated", "post cache"]) {
  test(`ignores a symlinked legacy ${legacyLayer} tree without touching external data`, async () => {
    const { root, id } = noteFixture();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-cache-external-"));
    const sentinel = path.join(external, "sentinel.txt");
    fs.writeFileSync(sentinel, "must stay unchanged");
    const wechatRoot = path.join(root, ".wechat-sync");
    const generatedRoot = path.join(wechatRoot, "generated");
    if (legacyLayer === "generated") {
      fs.mkdirSync(wechatRoot);
      fs.symlinkSync(external, generatedRoot, "dir");
    } else {
      fs.mkdirSync(generatedRoot, { recursive: true });
      fs.symlinkSync(external, path.join(generatedRoot, id), "dir");
    }
    const client = fakeClient();

    const result = await syncWechatDrafts({
      root,
      config: config(root),
      client,
      renderNote: fakeNoteRenderer(),
      logger: () => {},
    });

    assert.equal(result.results[0].action, "add");
    assert.equal(fs.readFileSync(sentinel, "utf8"), "must stay unchanged");
    assert.deepEqual(fs.readdirSync(external), ["sentinel.txt"]);
    assert.equal(client.calls.filter(([name]) => name === "addDraft").length, 1);
  });
}

test("never redraws or mutates a native draft after it has ever been published", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  await syncWechatDrafts({
    root,
    config: config(root),
    client,
    renderNote: fakeNoteRenderer({ renderHash: "published-render" }),
    logger: () => {},
  });
  const state = loadState(config(root).stateFile);
  state.posts[id].publication.everPublished = true;
  state.posts[id].publication.status = "published";
  saveState(config(root).stateFile, state);
  const previousImages = state.posts[id].generatedImages;
  client.calls.length = 0;
  fs.writeFileSync(
    path.join(root, "content", "published", `${id}.md`),
    "---\nkind: note\n---\n网站上的正文继续变化。\n",
  );

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    force: true,
    renderNote: async () => { throw new Error("published note must not redraw"); },
    logger: () => {},
  });
  const saved = loadState(config(root).stateFile).posts[id];

  assert.equal(result.results[0].action, "website-only");
  assert.equal(saved.renderHash, "published-render");
  assert.deepEqual(saved.generatedImages, previousImages);
  assert.deepEqual(client.calls, []);
});

test("dry-run validates all note pages and payload without API, state, or persistent cache writes", async () => {
  const { root } = noteFixture();
  const client = fakeClient();
  const renderNote = fakeNoteRenderer({ pages: 4 });

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    dryRun: true,
    renderNote,
    logger: () => {},
  });

  assert.equal(result.results[0].action, "dry-run-add");
  assert.equal(result.results[0].article.article_type, "newspic");
  assert.equal(result.results[0].article.image_info.image_list.length, 4);
  assert.equal(renderNote.calls.length, 1);
  assert.deepEqual(client.calls, []);
  assert.equal(fs.existsSync(config(root).stateFile), false);
  assert.equal(fs.existsSync(path.join(root, ".wechat-sync", "generated")), false);
  assert.equal(fs.existsSync(renderNote.calls[0].outputDir), false);
});

test("dry-run revalidates an unchanged cached note payload without touching cache or state", async () => {
  const { root, id } = noteFixture();
  const client = fakeClient();
  const renderNote = fakeNoteRenderer({ pages: 4 });
  await syncWechatDrafts({ root, config: config(root), client, renderNote, logger: () => {} });
  const stateBefore = fs.readFileSync(config(root).stateFile);
  client.calls.length = 0;

  const result = await syncWechatDrafts({
    root,
    config: config(root),
    client,
    dryRun: true,
    renderNote,
    logger: () => {},
  });

  assert.equal(result.results[0].action, "dry-run-update");
  assert.equal(result.results[0].article.image_info.image_list.length, 4);
  assert.deepEqual(client.calls, []);
  assert.deepEqual(fs.readFileSync(config(root).stateFile), stateBefore);
  assert.equal(fs.existsSync(path.join(root, ".wechat-sync", "generated")), false);
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
    "---\nkind: article\n---\n# 第二版\n\n正文有变化。\n\n![封面](../assets/cover.png)\n",
  );
  const third = await syncWechatDrafts({ root, config: config(root), client, logger: (line) => logs.push(line) });
  assert.equal(third.results[0].action, "update");
  assert.deepEqual(client.calls.at(-1), ["updateDraft", "draft-media", "第二版"]);
  assert.equal(client.calls.filter((call) => call[0] === "uploadArticleImage").length, 1);
  assert.equal(client.calls.filter((call) => call[0] === "uploadPermanentImage").length, 1);

  const state = loadState(config(root).stateFile);
  assert.equal(state.posts["2026-08-04-120000"].mediaId, "draft-media");
  assert.ok(state.posts["2026-08-04-120000"].fingerprint);
  assert.equal(
    state.posts[POST_ID].sourceMd5,
    crypto.createHash("md5").update(fs.readFileSync(path.join(root, "content", "published", `${POST_ID}.md`))).digest("hex"),
  );
  assert.equal(state.posts[POST_ID].renderHash, state.posts[POST_ID].fingerprint);
  assert.deepEqual(state.posts[POST_ID].generatedImages, []);
  assert.equal(state.posts[POST_ID].draftKind, "news");
  assert.equal(state.posts[POST_ID].publication.status, "draft_only");
});

test("backfills MD5-aware metadata on an unchanged legacy article without mutating its draft", async () => {
  const root = fixture();
  const client = fakeClient();
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const state = loadState(config(root).stateFile);
  state.posts[POST_ID].sourceMd5 = null;
  state.posts[POST_ID].renderHash = null;
  delete state.posts[POST_ID].draftKind;
  delete state.posts[POST_ID].generatedImages;
  saveState(config(root).stateFile, state);
  client.calls.length = 0;

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const saved = loadState(config(root).stateFile).posts[POST_ID];

  assert.equal(result.results[0].action, "skipped");
  assert.match(saved.sourceMd5, /^[a-f\d]{32}$/u);
  assert.equal(saved.renderHash, saved.fingerprint);
  assert.equal(saved.draftKind, "news");
  assert.deepEqual(saved.generatedImages, []);
  assert.deepEqual(client.calls, []);
});

test("keeps an armed legacy new post draft-only after draft creation succeeds", async () => {
  const root = fixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
  });

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const record = loadState(config(root).stateFile).posts[POST_ID];

  assert.equal(result.results[0].action, "add");
  assert.equal(record.publication.status, "draft_only");
  assert.equal(record.publication.desiredLocation, "published");
  assert.equal(record.publication.draftFingerprint, record.fingerprint);
  assert.equal(record.publication.eligibleAt, null);
  assert.equal(loadState(config(root).stateFile).publisher.armedAt, null);
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
    state.publisher.baselineCaptured = true;
  });

  await assert.rejects(
    syncWechatDrafts({ root, config: config(root), client, logger: () => {} }),
    /draft\/add failed/,
  );

  assert.equal(loadState(config(root).stateFile).posts[POST_ID], undefined);
});

test("updates a restored non-baseline post while keeping it draft-only", async () => {
  const root = fixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
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
  assert.equal(record.publication.status, "draft_only");
  assert.equal(record.publication.desiredLocation, "published");
  assert.equal(record.publication.draftFingerprint, record.fingerprint);
  assert.equal(client.calls.filter(([name]) => name === "updateDraft").length, 1);
});

test("skips an unchanged canceled non-baseline article and keeps it draft-only", async () => {
  const root = fixture();
  const client = fakeClient();
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const state = loadState(config(root).stateFile);
  state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
  state.publisher.baselineCaptured = true;
  state.publisher.baselinePostIds = [];
  state.posts[POST_ID].publication.status = "draft_only";
  state.posts[POST_ID].publication.desiredLocation = "drafts";
  state.posts[POST_ID].sourceDeletedAt = "2026-08-07T01:00:00.000Z";
  saveState(config(root).stateFile, state);
  client.calls.length = 0;

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const restored = loadState(config(root).stateFile).posts[POST_ID];

  assert.equal(result.results[0].action, "skipped");
  assert.equal(restored.publication.status, "draft_only");
  assert.equal(restored.publication.desiredLocation, "published");
  assert.equal(restored.publication.draftFingerprint, restored.fingerprint);
  assert.equal(restored.sourceDeletedAt, undefined);
  assert.deepEqual(client.calls, []);
});

test("recreates an unchanged canceled article with no stored media ID as draft-only", async () => {
  const root = fixture();
  const client = fakeClient();
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const state = loadState(config(root).stateFile);
  state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
  state.publisher.baselineCaptured = true;
  state.publisher.baselinePostIds = [];
  state.posts[POST_ID].mediaId = null;
  state.posts[POST_ID].publication.status = "draft_only";
  state.posts[POST_ID].publication.desiredLocation = "drafts";
  saveState(config(root).stateFile, state);
  client.calls.length = 0;

  const result = await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const restored = loadState(config(root).stateFile).posts[POST_ID];

  assert.equal(result.results[0].action, "add");
  assert.equal(restored.mediaId, "draft-media");
  assert.equal(restored.publication.status, "draft_only");
  assert.deepEqual(client.calls.map(([name]) => name), ["addDraft"]);
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
    state.publisher.baselineCaptured = true;
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

test("keeps baseline posts draft-only after successful draft creation", async () => {
  const root = fixture();
  const client = fakeClient();
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
    state.publisher.baselinePostIds = [POST_ID];
  });

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  const publication = loadState(config(root).stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "draft_only");
  assert.ok(publication.draftFingerprint);
});

test("an inactive historical marker does not cancel a currently published source", async () => {
  const root = fixture();
  const client = fakeClient();
  writeMarker(root);
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
  });

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  const publication = loadState(config(root).stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "draft_only");
  assert.equal(publication.desiredLocation, "published");
  assert.equal(client.calls.filter(([name]) => name === "addDraft").length, 1);
});

test("a consumed cancellation marker cannot reactivate browser automation after draft-only migration", async () => {
  const root = fixture();
  const client = fakeClient();
  const stateFile = config(root).stateFile;
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
    state.publisher.baselinePostIds = [];
  });

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  const sourcePath = path.join(root, "content", "published", `${POST_ID}.md`);
  const source = fs.readFileSync(sourcePath, "utf8");
  fs.unlinkSync(sourcePath);
  writeMarker(root);
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  let publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "draft_only");
  assert.equal(publication.withdrawRequestedAt, "2026-08-07T00:00:00.000Z");

  fs.writeFileSync(sourcePath, source);
  client.calls.length = 0;
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "draft_only");
  assert.equal(publication.desiredLocation, "published");
  assert.deepEqual(client.calls, []);

  let publishClicks = 0;
  const publishAdapter = {
    checkSession: async () => ({ authenticated: true }),
    findPublishedCandidate: async () => ({ kind: "absent" }),
    findDraftCandidate: async (record) => ({
      kind: "exact",
      title: record.title,
      href: "https://mp.weixin.qq.com/draft/exact",
    }),
    openDraft: async () => {},
    publishCurrentDraft: async () => { publishClicks += 1; },
    verifyPublished: async (record) => ({
      published: true,
      candidate: {
        kind: "exact",
        title: record.title,
        href: "https://mp.weixin.qq.com/s/exact",
      },
    }),
  };
  await runLifecycle({
    root,
    stateFile,
    adapter: publishAdapter,
    autoPublish: true,
    autoWithdraw: true,
    now: () => "2026-08-07T02:00:00.000Z",
  });
  assert.equal(publishClicks, 0);
  assert.equal(loadState(stateFile).posts[POST_ID].publication.status, "draft_only");

  fs.unlinkSync(sourcePath);
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  let withdrawClicks = 0;
  await runLifecycle({
    root,
    stateFile,
    adapter: {
      checkSession: async () => ({ authenticated: true }),
      findPublishedCandidate: async (record) => ({
        kind: "exact",
        title: record.title,
        href: "https://mp.weixin.qq.com/s/exact",
      }),
      openPublished: async () => {},
      withdrawCurrentArticle: async () => { withdrawClicks += 1; },
      verifyWithdrawn: async () => ({ withdrawn: true }),
    },
    autoPublish: true,
    autoWithdraw: true,
    now: () => "2026-08-07T03:00:00.000Z",
  });

  publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "draft_only");
  assert.equal(publication.desiredLocation, "published");
  assert.equal(withdrawClicks, 0);
});

test("a marker superseded by restore cannot authorize a later plain deletion", async () => {
  const root = fixture();
  const client = fakeClient();
  const stateFile = config(root).stateFile;
  const sourcePath = path.join(root, "content", "published", `${POST_ID}.md`);
  const source = fs.readFileSync(sourcePath, "utf8");
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-07T00:00:00.000Z";
    state.publisher.baselineCaptured = true;
    state.publisher.baselinePostIds = [];
    state.posts[POST_ID] = {
      fingerprint: "published-fingerprint",
      mediaId: "published-media",
      title: "已发表文章",
      sourceUrl: "https://example.com/posts/published/",
      syncedAt: "2026-08-06T23:00:00.000Z",
      publication: {
        ...emptyPublication("published"),
        everPublished: true,
        publicationOrigin: "automatic",
        draftFingerprint: "published-fingerprint",
        publishedAt: "2026-08-06T23:30:00.000Z",
        publishedUrl: "https://mp.weixin.qq.com/s/exact",
        platformArticleId: "wx-published",
      },
    };
  });

  fs.unlinkSync(sourcePath);
  writeMarker(root);
  fs.writeFileSync(sourcePath, source);
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  let publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.desiredLocation, "published");
  assert.equal(publication.withdrawRequestedAt, "2026-08-07T00:00:00.000Z");

  fs.unlinkSync(sourcePath);
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  let withdrawClicks = 0;
  await runLifecycle({
    root,
    stateFile,
    adapter: {
      checkSession: async () => ({ authenticated: true }),
      findPublishedCandidate: async (record) => ({
        kind: "exact",
        title: record.title,
        href: "https://mp.weixin.qq.com/s/exact",
      }),
      openPublished: async () => {},
      withdrawCurrentArticle: async () => { withdrawClicks += 1; },
      verifyWithdrawn: async () => ({ withdrawn: true }),
    },
    autoPublish: true,
    autoWithdraw: true,
    now: () => "2026-08-07T03:00:00.000Z",
  });

  publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "published");
  assert.equal(publication.desiredLocation, "published");
  assert.equal(withdrawClicks, 0);
});

test("restore canonicalizes markers without authorizing browser withdrawal", async () => {
  const root = fixture();
  const client = fakeClient();
  const stateFile = config(root).stateFile;
  const sourcePath = path.join(root, "content", "published", `${POST_ID}.md`);
  writeLifecycleState(root, (state) => {
    state.publisher.armedAt = "2026-08-06T22:00:00.000Z";
    state.publisher.baselineCaptured = true;
    state.publisher.baselinePostIds = [];
    state.posts[POST_ID] = {
      fingerprint: "published-fingerprint",
      mediaId: "published-media",
      title: "已发表文章",
      sourceUrl: "https://example.com/posts/published/",
      syncedAt: "2026-08-06T23:00:00.000Z",
      publication: {
        ...emptyPublication("published"),
        everPublished: true,
        publicationOrigin: "automatic",
        draftFingerprint: "published-fingerprint",
        publishedAt: "2026-08-06T23:30:00.000Z",
        publishedUrl: "https://mp.weixin.qq.com/s/exact",
        platformArticleId: "wx-published",
        withdrawRequestedAt: "2026-08-07T00:00:00Z",
      },
    };
  });
  writeMarker(root);

  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });

  let publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.withdrawRequestedAt, "2026-08-07T00:00:00.000Z");
  assert.equal(publication.desiredLocation, "published");

  fs.unlinkSync(sourcePath);
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  let withdrawClicks = 0;
  const adapter = {
    checkSession: async () => ({ authenticated: true }),
    findPublishedCandidate: async (record) => ({
      kind: "exact",
      title: record.title,
      href: "https://mp.weixin.qq.com/s/exact",
    }),
    openPublished: async () => {},
    withdrawCurrentArticle: async () => { withdrawClicks += 1; },
    verifyWithdrawn: async () => ({ withdrawn: true }),
  };
  await runLifecycle({
    root,
    stateFile,
    adapter,
    autoPublish: true,
    autoWithdraw: true,
    now: () => "2026-08-07T01:00:00.000Z",
  });

  publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "published");
  assert.equal(publication.desiredLocation, "published");
  assert.equal(withdrawClicks, 0);

  writeMarker(root, POST_ID, {
    postId: POST_ID,
    requestedAt: "2026-08-07T02:00:00.000Z",
  });
  await syncWechatDrafts({ root, config: config(root), client, logger: () => {} });
  await runLifecycle({
    root,
    stateFile,
    adapter,
    autoPublish: true,
    autoWithdraw: true,
    now: () => "2026-08-07T03:00:00.000Z",
  });

  publication = loadState(stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "published");
  assert.equal(publication.withdrawRequestedAt, "2026-08-07T02:00:00.000Z");
  assert.equal(withdrawClicks, 0);
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
      state.publisher.baselineCaptured = true;
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
