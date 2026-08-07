import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  armPublisher,
  emptyPublication,
  publicationForNewPost,
  recoverInterruptedOperations,
  transitionPublication,
} = require("../scripts/wechat/lifecycle-state.cjs");
const { emptyState, normalizeState, saveState } = require("../scripts/wechat/state.cjs");

test("creates the canonical publication record and rejects unknown statuses", () => {
  assert.deepEqual(emptyPublication("pending"), {
    status: "pending",
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
  });
  assert.throws(
    () => emptyPublication("unknown"),
    /未知公众号生命周期状态：unknown/,
  );
});

test("migrates v1 posts without making them eligible", () => {
  const state = normalizeState({
    version: 1,
    articleImages: { image: { url: "https://mmbiz.qpic.cn/legacy-image" } },
    covers: { cover: { mediaId: "legacy-cover" } },
    posts: {
      "2026-08-04-120000": { mediaId: "draft", title: "旧文章" },
    },
  });
  assert.equal(state.version, 2);
  assert.equal(state.articleImages.image.url, "https://mmbiz.qpic.cn/legacy-image");
  assert.equal(state.covers.cover.mediaId, "legacy-cover");
  assert.equal(state.posts["2026-08-04-120000"].mediaId, "draft");
  assert.equal(state.posts["2026-08-04-120000"].title, "旧文章");
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

test("normalizes readable v2 state without losing caches or post metadata", () => {
  const state = normalizeState({
    version: 2,
    articleImages: { image: { url: "https://mmbiz.qpic.cn/image" } },
    covers: { cover: { mediaId: "cover-media" } },
    posts: {
      post: {
        mediaId: "draft-media",
        title: "文章",
        publication: {
          status: "published",
          desiredLocation: "drafts",
          everPublished: true,
          publishedUrl: "https://mp.weixin.qq.com/s/article",
          ignoredLifecycleField: "drop-me",
        },
      },
    },
    publisher: {
      armedAt: "2026-08-07T00:00:00.000Z",
      baselinePostIds: ["baseline"],
      browserSessionCheckedAt: "2026-08-07T01:00:00.000Z",
    },
  });

  assert.equal(state.version, 2);
  assert.equal(state.articleImages.image.url, "https://mmbiz.qpic.cn/image");
  assert.equal(state.covers.cover.mediaId, "cover-media");
  assert.equal(state.posts.post.mediaId, "draft-media");
  assert.equal(state.posts.post.title, "文章");
  assert.equal(state.posts.post.publication.status, "published");
  assert.equal(state.posts.post.publication.desiredLocation, "drafts");
  assert.equal(state.posts.post.publication.everPublished, true);
  assert.equal(state.posts.post.publication.publishedUrl, "https://mp.weixin.qq.com/s/article");
  assert.equal(state.posts.post.publication.eligibleAt, null);
  assert.equal("ignoredLifecycleField" in state.posts.post.publication, false);
  assert.deepEqual(state.publisher, {
    armedAt: "2026-08-07T00:00:00.000Z",
    baselinePostIds: ["baseline"],
    browserSessionCheckedAt: "2026-08-07T01:00:00.000Z",
  });
});

test("only makes armed non-baseline never-published posts pending", () => {
  const unarmed = emptyState();
  assert.equal(
    publicationForNewPost(unarmed, "new", "2026-08-07T00:00:00.000Z").status,
    "manual",
  );

  const armed = emptyState();
  armPublisher(armed, ["baseline"], "2026-08-07T00:00:00.000Z");
  const pending = publicationForNewPost(armed, "new", "2026-08-07T01:00:00.000Z");
  assert.equal(pending.status, "pending");
  assert.equal(pending.eligibleAt, "2026-08-07T01:00:00.000Z");
  assert.equal(publicationForNewPost(armed, "baseline", "later").status, "manual");

  armed.posts.published = { publication: {
    ...emptyPublication("published"),
    everPublished: true,
  }};
  armed.posts.ever = { publication: {
    ...emptyPublication("draft_only"),
    everPublished: true,
  }};
  assert.equal(publicationForNewPost(armed, "published", "later").status, "published");
  assert.equal(publicationForNewPost(armed, "ever", "later").status, "draft_only");
});

test("rejects pending transitions for terminal, baseline, and ever-published posts", () => {
  assert.equal(typeof transitionPublication, "function");
  const state = emptyState();
  armPublisher(state, ["baseline"], "2026-08-07T00:00:00.000Z");
  state.posts.published = { publication: emptyPublication("published") };
  state.posts.withdrawn = { publication: emptyPublication("withdrawn") };
  state.posts.baseline = { publication: emptyPublication("manual") };
  state.posts.ever = { publication: {
    ...emptyPublication("draft_only"),
    everPublished: true,
  }};

  for (const postId of ["published", "withdrawn", "baseline", "ever"]) {
    assert.throws(() => transitionPublication(state, postId, "pending"));
  }
});

test("published transitions become terminal and withdrawn transitions retain identity", () => {
  const state = emptyState();
  state.posts.post = { publication: {
    ...emptyPublication("publishing"),
    draftFingerprint: "frozen-fingerprint",
    publishedUrl: "https://mp.weixin.qq.com/s/article",
    platformArticleId: "article-id",
  }};

  transitionPublication(state, "post", "published", {
    publishedAt: "2026-08-07T01:00:00.000Z",
  });
  assert.equal(state.posts.post.publication.everPublished, true);
  transitionPublication(state, "post", "withdrawn", {
    withdrawnAt: "2026-08-07T02:00:00.000Z",
  });
  assert.equal(state.posts.post.publication.draftFingerprint, "frozen-fingerprint");
  assert.equal(state.posts.post.publication.publishedUrl, "https://mp.weixin.qq.com/s/article");
  assert.equal(state.posts.post.publication.platformArticleId, "article-id");
  assert.equal(state.posts.post.publication.publishedAt, "2026-08-07T01:00:00.000Z");
  assert.equal(state.posts.post.publication.withdrawnAt, "2026-08-07T02:00:00.000Z");
});

test("saves normalized state through a private atomic temporary file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-state-"));
  const filename = path.join(directory, "private", "state.json");
  const state = emptyState();
  state.posts.post = { mediaId: "draft-media", publication: emptyPublication("manual") };

  saveState(filename, state);

  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(filename, "utf8")).posts.post.mediaId, "draft-media");
  assert.deepEqual(fs.readdirSync(path.dirname(filename)), ["state.json"]);
});
