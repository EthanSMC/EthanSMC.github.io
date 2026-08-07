import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { arm, resolveRecord, runLifecycle, statusSummary } = require("../scripts/wechat/publisher.cjs");
const { WechatBrowserAdapter } = require("../scripts/wechat/browser-publisher.cjs");
const { main, parseArguments, publicCliFailure } = require("../scripts/wechat-publish.cjs");
const { emptyPublication } = require("../scripts/wechat/lifecycle-state.cjs");
const { emptyState, loadState, saveState } = require("../scripts/wechat/state.cjs");

const POST_ID = "2026-08-07-120000";
const SECOND_ID = "2026-08-07-120001";
const NOW = "2026-08-07T04:00:00.000Z";

function codedError(code, message = "opaque browser failure") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-publisher-"));
  const stateFile = path.join(root, ".wechat-sync", "state.json");
  fs.mkdirSync(path.join(root, "content", "published"), { recursive: true });
  return { root, stateFile };
}

function post(status = "pending", overrides = {}) {
  const publication = { ...emptyPublication(status), ...(overrides.publication || {}) };
  return {
    title: overrides.title || "可验证文章",
    sourceUrl: overrides.sourceUrl || "https://example.test/blog/verified/",
    mediaId: overrides.mediaId || "draft-media",
    fingerprint: overrides.fingerprint || "fingerprint",
    publication,
  };
}

function seed(options = {}) {
  const { root, stateFile } = fixture();
  const state = emptyState();
  state.publisher.armedAt = NOW;
  state.publisher.baselineCaptured = true;
  state.publisher.baselinePostIds = [];
  state.posts[POST_ID] = post(options.status, options);
  for (const [postId, record] of Object.entries(options.posts || {})) state.posts[postId] = record;
  saveState(stateFile, state);
  return { root, stateFile };
}

function marker(root, postId = POST_ID, requestedAt = "2026-08-07T03:00:00.000Z") {
  const directory = path.join(root, "content", ".lifecycle", "withdrawals");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${postId}.json`), `${JSON.stringify({
    postId,
    requestedAt,
  })}\n`);
}

function exact(postId = POST_ID) {
  return {
    kind: "exact",
    title: postId === POST_ID ? "可验证文章" : "第二篇文章",
    href: `https://mp.weixin.qq.com/s/${postId}`,
    platformArticleId: `platform-${postId}`,
  };
}

function fakeAdapter(options = {}) {
  const adapter = {
    calls: [],
    publishClicks: 0,
    withdrawClicks: 0,
    async checkSession() {
      adapter.calls.push(["checkSession"]);
      return options.session || { authenticated: true };
    },
    async findPublishedCandidate(record) {
      adapter.calls.push(["findPublishedCandidate", record.title]);
      if (options.onBrowserCall) options.onBrowserCall("findPublishedCandidate");
      if (options.findPublished) return options.findPublished(record);
      return { kind: "absent" };
    },
    async findDraftCandidate(record) {
      adapter.calls.push(["findDraftCandidate", record.title]);
      if (options.onBrowserCall) options.onBrowserCall("findDraftCandidate");
      if (options.findDraftError) throw options.findDraftError;
      if (options.findDraft) return options.findDraft(record);
      return { kind: "exact", title: record.title, href: "https://mp.weixin.qq.com/draft/1" };
    },
    async openDraft(candidate) {
      adapter.calls.push(["openDraft", candidate.href]);
      if (options.openDraftError) throw options.openDraftError;
    },
    async publishCurrentDraft(record) {
      adapter.calls.push(["publishCurrentDraft", record.title]);
      adapter.publishClicks += 1;
      if (options.onPublish) options.onPublish();
      if (options.publishError) throw options.publishError;
    },
    async verifyPublished(record) {
      adapter.calls.push(["verifyPublished", record.title]);
      if (options.verifyPublishedError) throw options.verifyPublishedError;
      if (options.verifyPublished) return options.verifyPublished(record);
      return { published: true, candidate: exact() };
    },
    async openPublished(candidate) {
      adapter.calls.push(["openPublished", candidate.href]);
      if (options.openPublishedError) throw options.openPublishedError;
    },
    async withdrawCurrentArticle(record) {
      adapter.calls.push(["withdrawCurrentArticle", record.title]);
      adapter.withdrawClicks += 1;
      if (options.onWithdraw) options.onWithdraw();
      if (options.withdrawError) throw options.withdrawError;
    },
    async verifyWithdrawn(record) {
      adapter.calls.push(["verifyWithdrawn", record.title]);
      if (options.onBrowserCall) options.onBrowserCall("verifyWithdrawn");
      if (options.verifyWithdrawnError) throw options.verifyWithdrawnError;
      return options.verifyWithdrawn ? options.verifyWithdrawn(record) : { withdrawn: true };
    },
  };
  return adapter;
}

async function run(seedData, adapter, options = {}) {
  return runLifecycle({
    ...seedData,
    adapter,
    autoPublish: true,
    autoWithdraw: true,
    now: () => NOW,
    ...options,
  });
}

test("persists publishing before exactly one publish click", async () => {
  const data = seed();
  const observed = [];
  const adapter = fakeAdapter({
    onPublish: () => observed.push(loadState(data.stateFile).posts[POST_ID].publication.status),
  });

  await run(data, adapter);

  const publication = loadState(data.stateFile).posts[POST_ID].publication;
  assert.deepEqual(observed, ["publishing"]);
  assert.equal(adapter.publishClicks, 1);
  assert.equal(publication.status, "published");
  assert.equal(publication.everPublished, true);
  assert.equal(publication.publicationOrigin, "automatic");
  assert.equal(publication.publishedUrl, `https://mp.weixin.qq.com/s/${POST_ID}`);
});

test("an exact published preflight records publication without a publish click", async () => {
  const data = seed();
  const adapter = fakeAdapter({ findPublished: () => exact() });

  await run(data, adapter);

  const publication = loadState(data.stateFile).posts[POST_ID].publication;
  assert.equal(adapter.publishClicks, 0);
  assert.equal(publication.status, "published");
  assert.equal(publication.publicationOrigin, "manual-detected");
});

test("a failure while opening the verified draft remains pending before the click boundary", async () => {
  const data = seed();
  const adapter = fakeAdapter({ openDraftError: new Error("navigation failed") });

  await assert.rejects(() => run(data, adapter), /navigation failed/);

  assert.equal(adapter.publishClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
});

test("stored diagnostics redact secrets and private paths", async () => {
  const data = seed();
  const adapter = fakeAdapter({
    openDraftError: new Error("secret=super-secret at /Users/operator/private/browser-profile"),
  });

  await assert.rejects(() => run(data, adapter));

  const diagnostic = loadState(data.stateFile).posts[POST_ID].publication.lastError;
  assert.match(diagnostic, /secret=\[redacted\]/);
  assert.doesNotMatch(diagnostic, /super-secret|\/Users\/operator/);
});

test("a deterministic draft identity failure blocks publication until explicit retry", async () => {
  const data = seed();
  const adapter = fakeAdapter({
    findDraftError: codedError("WECHAT_DRAFT_CANDIDATE_NOT_FOUND"),
  });

  await run(data, adapter);

  let publication = loadState(data.stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "blocked");
  assert.equal(publication.blockedOperation, "publish");
  assert.equal(adapter.publishClicks, 0);

  await runLifecycle({
    ...data,
    adapter: fakeAdapter(),
    autoPublish: false,
    autoWithdraw: false,
    retry: POST_ID,
    now: () => NOW,
  });
  publication = loadState(data.stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "pending");
  assert.equal(publication.blockedOperation, null);
});

test("ambiguous published preflight enters reconciliation instead of a safely cancellable block", async () => {
  const data = seed();
  const adapter = fakeAdapter({
    findPublished: () => { throw codedError("WECHAT_PUBLISHED_CANDIDATE_MULTIPLE"); },
  });

  await run(data, adapter);

  const publication = loadState(data.stateFile).posts[POST_ID].publication;
  assert.equal(adapter.publishClicks, 0);
  assert.equal(publication.status, "publish_reconcile");
  assert.equal(publication.blockedOperation, null);
});

test("a failure after publish invocation reconciles and never clicks again", async () => {
  const data = seed();
  const first = fakeAdapter({ publishError: new Error("response lost") });
  await assert.rejects(() => run(data, first), /response lost/);
  assert.equal(first.publishClicks, 1);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "publish_reconcile");

  const retry = fakeAdapter();
  await run(data, retry);
  assert.equal(retry.publishClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "publish_reconcile");
});

test("loaded publishing is durably recovered before browser reconciliation and never clicks", async () => {
  const data = seed({ status: "publishing" });
  const observed = [];
  const adapter = fakeAdapter({
    onBrowserCall: () => observed.push(loadState(data.stateFile).posts[POST_ID].publication.status),
  });

  await run(data, adapter);

  assert.equal(adapter.publishClicks, 0);
  assert.deepEqual(observed, ["publish_reconcile"]);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "publish_reconcile");
});

test("malformed arming fails closed in run, status, and arm", async () => {
  const data = seed();
  const state = loadState(data.stateFile);
  state.publisher.armedAt = "not-a-timestamp";
  saveState(data.stateFile, state);
  let browserOpens = 0;

  await assert.rejects(
    () => runLifecycle({
      ...data,
      openAdapter: async () => {
        browserOpens += 1;
        return { adapter: fakeAdapter(), close: async () => {} };
      },
      autoPublish: true,
      autoWithdraw: true,
      now: () => NOW,
    }),
    (error) => {
      assert.equal(error.code, "WECHAT_PUBLISHER_ARMING_INVALID");
      return true;
    },
  );
  assert.equal(browserOpens, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
  assert.deepEqual(
    { armed: statusSummary(state).armed, armedAt: statusSummary(state).armedAt },
    { armed: false, armedAt: null },
  );
  assert.throws(
    () => arm({ ...data, now: () => NOW }),
    (error) => {
      assert.equal(error.code, "WECHAT_PUBLISHER_ARMING_INVALID");
      return true;
    },
  );
});

test("a timestamp without a validated baseline snapshot fails closed before browser work", async () => {
  const data = seed();
  const state = loadState(data.stateFile);
  state.publisher.baselineCaptured = false;
  saveState(data.stateFile, state);
  let browserOpens = 0;

  await assert.rejects(
    () => runLifecycle({
      ...data,
      openAdapter: async () => {
        browserOpens += 1;
        return { adapter: fakeAdapter(), close: async () => {} };
      },
      autoPublish: true,
      autoWithdraw: true,
      now: () => NOW,
    }),
    (error) => error.code === "WECHAT_PUBLISHER_ARMING_INVALID",
  );

  assert.equal(browserOpens, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
});

test("dry-run recovery and retry preview clone injected state without mutating it", async () => {
  const data = fixture();
  const shared = emptyState();
  shared.publisher.armedAt = NOW;
  shared.publisher.baselineCaptured = true;
  shared.posts[POST_ID] = post("publishing");
  shared.posts[SECOND_ID] = post("blocked", {
    title: "第二篇文章",
    publication: { blockedOperation: "publish" },
  });
  const original = structuredClone(shared);

  const result = await runLifecycle({
    ...data,
    loadState: () => shared,
    saveState: () => assert.fail("dry-run must not save"),
    retry: SECOND_ID,
    autoPublish: true,
    autoWithdraw: true,
    dryRun: true,
    now: () => NOW,
  });

  assert.deepEqual(shared, original);
  assert.notEqual(result.state, shared);
  assert.equal(result.state.posts[POST_ID].publication.status, "publish_reconcile");
  assert.equal(result.state.posts[SECOND_ID].publication.status, "pending");
});

test("pending withdrawal intent cancels without opening a browser even when withdrawal is disabled", async () => {
  const data = seed();
  marker(data.root);
  let opens = 0;

  await runLifecycle({
    ...data,
    openAdapter: async () => {
      opens += 1;
      return { adapter: fakeAdapter(), close: async () => {} };
    },
    autoPublish: true,
    autoWithdraw: false,
    now: () => NOW,
  });

  assert.equal(opens, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "draft_only");
});

test("manual withdrawal intent branches on trustworthy published evidence", async () => {
  const publishedData = seed({ status: "manual" });
  marker(publishedData.root);
  const observed = [];
  const publishedAdapter = fakeAdapter({
    findPublished: () => exact(),
    onWithdraw: () => observed.push(loadState(publishedData.stateFile).posts[POST_ID].publication.status),
  });
  await run(publishedData, publishedAdapter);
  const publication = loadState(publishedData.stateFile).posts[POST_ID].publication;
  assert.deepEqual(observed, ["withdrawing"]);
  assert.equal(publishedAdapter.withdrawClicks, 1);
  assert.equal(publication.status, "withdrawn");
  assert.equal(publication.publicationOrigin, "manual-detected");

  const absentData = seed({ status: "manual" });
  marker(absentData.root);
  const absentAdapter = fakeAdapter();
  await run(absentData, absentAdapter);
  assert.equal(absentAdapter.withdrawClicks, 0);
  assert.equal(loadState(absentData.stateFile).posts[POST_ID].publication.status, "draft_only");
});

test("typed trustworthy absence preserves lifecycle certainty", async () => {
  const representations = [
    ["structured absence", { findPublished: () => ({ kind: "absent" }) }],
  ];

  for (const [label, adapterOptions] of representations) {
    const publishedData = seed({ status: "published", publication: { everPublished: true } });
    marker(publishedData.root);
    const publishedAdapter = fakeAdapter(adapterOptions);

    await run(publishedData, publishedAdapter);

    const publication = loadState(publishedData.stateFile).posts[POST_ID].publication;
    assert.equal(publishedAdapter.withdrawClicks, 0, label);
    assert.equal(publication.status, "withdrawn", label);
    assert.equal(publication.withdrawnAt, NOW, label);

    const uncertainData = seed({ status: "publish_reconcile" });
    marker(uncertainData.root);
    const uncertainAdapter = fakeAdapter(adapterOptions);

    await run(uncertainData, uncertainAdapter);

    assert.equal(uncertainAdapter.withdrawClicks, 0, label);
    assert.equal(
      loadState(uncertainData.stateFile).posts[POST_ID].publication.status,
      "publish_reconcile",
      label,
    );
  }
});

test("ambiguous withdrawal identity blocks before any withdrawal click", async () => {
  const data = seed({ status: "manual" });
  marker(data.root);
  const adapter = fakeAdapter({
    findPublished: () => { throw codedError("WECHAT_PUBLISHED_CANDIDATE_MULTIPLE"); },
  });

  await run(data, adapter);

  const publication = loadState(data.stateFile).posts[POST_ID].publication;
  assert.equal(adapter.withdrawClicks, 0);
  assert.equal(publication.status, "blocked");
  assert.equal(publication.blockedOperation, "withdraw");

  const unattendedRetry = fakeAdapter({ findPublished: () => exact() });
  await run(data, unattendedRetry);
  assert.equal(unattendedRetry.withdrawClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "blocked");
});

test("published withdrawal intent persists withdrawing and clicks exactly once", async () => {
  const data = seed({ status: "published", publication: { everPublished: true } });
  marker(data.root);
  const observed = [];
  const adapter = fakeAdapter({
    findPublished: () => exact(),
    onWithdraw: () => observed.push(loadState(data.stateFile).posts[POST_ID].publication.status),
  });

  await run(data, adapter);

  assert.deepEqual(observed, ["withdrawing"]);
  assert.equal(adapter.withdrawClicks, 1);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdrawn");
});

test("terminal, baseline, and ever-published records cannot reach an automatic publish click", async () => {
  const data = fixture();
  const state = emptyState();
  state.publisher.armedAt = NOW;
  state.publisher.baselineCaptured = true;
  state.publisher.baselinePostIds = [POST_ID];
  state.posts[POST_ID] = post("pending");
  state.posts[SECOND_ID] = post("pending", {
    title: "第二篇文章",
    publication: { everPublished: true },
  });
  state.posts["2026-08-07-120002"] = post("withdrawn", {
    title: "终态文章",
    publication: { everPublished: true },
  });
  saveState(data.stateFile, state);
  const adapter = fakeAdapter({ findPublished: () => ({ kind: "absent" }) });

  await run(data, adapter);

  assert.equal(adapter.publishClicks, 0);
  assert.equal(
    adapter.calls.some(([name]) => name === "findDraftCandidate" || name === "openDraft"),
    false,
  );
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
  assert.equal(loadState(data.stateFile).posts[SECOND_ID].publication.status, "pending");
});

test("loaded withdrawing becomes withdraw_reconcile before inspection and never clicks", async () => {
  const data = seed({ status: "withdrawing", publication: { everPublished: true } });
  marker(data.root);
  const observed = [];
  const adapter = fakeAdapter({
    onBrowserCall: () => observed.push(loadState(data.stateFile).posts[POST_ID].publication.status),
    verifyWithdrawnError: codedError("WECHAT_WITHDRAWAL_STILL_PRESENT"),
  });

  await run(data, adapter);

  assert.equal(adapter.withdrawClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdraw_reconcile");
  assert.ok(observed.every((status) => status === "withdraw_reconcile"));
});

test("uncertain withdrawal outcome never causes an unattended second click", async () => {
  const data = seed({ status: "published", publication: { everPublished: true } });
  marker(data.root);
  const first = fakeAdapter({
    findPublished: () => exact(),
    withdrawError: new Error("response lost"),
  });
  await assert.rejects(() => run(data, first), /response lost/);
  assert.equal(first.withdrawClicks, 1);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdraw_reconcile");

  const retry = fakeAdapter({
    verifyWithdrawnError: codedError("WECHAT_WITHDRAWAL_STILL_PRESENT"),
  });
  await run(data, retry);
  assert.equal(retry.withdrawClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdraw_reconcile");
});

test("withdraw reconciliation persists its marker generation before verification and resolve authorizes one new attempt", async () => {
  const requestedAt = "2026-08-07T03:00:00.000Z";
  const data = seed({
    status: "withdraw_reconcile",
    publication: {
      everPublished: true,
      desiredLocation: "drafts",
      withdrawRequestedAt: null,
      publishedUrl: `https://mp.weixin.qq.com/s/${POST_ID}`,
    },
  });
  marker(data.root, POST_ID, requestedAt);
  const observedGenerations = [];
  const reconcile = fakeAdapter({
    onBrowserCall: (name) => {
      if (name === "verifyWithdrawn") {
        observedGenerations.push(
          loadState(data.stateFile).posts[POST_ID].publication.withdrawRequestedAt,
        );
      }
    },
    verifyWithdrawnError: codedError("WECHAT_WITHDRAWAL_STILL_PRESENT"),
  });

  await run(data, reconcile);
  assert.deepEqual(observedGenerations, [requestedAt]);
  assert.equal(reconcile.withdrawClicks, 0);
  resolveRecord({
    ...data,
    postId: POST_ID,
    resolution: "still-published",
    now: () => NOW,
  });

  const retry = fakeAdapter({ findPublished: () => exact() });
  await run(data, retry);
  assert.equal(retry.withdrawClicks, 1);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdrawn");

  const later = fakeAdapter({ findPublished: () => exact() });
  await run(data, later);
  assert.equal(later.withdrawClicks, 0);
});

test("invalid withdrawal verification blocks every later automatic click", async () => {
  const data = seed({ status: "published", publication: { everPublished: true } });
  marker(data.root);
  const first = fakeAdapter({
    findPublished: () => exact(),
    verifyWithdrawn: () => ({ withdrawn: true, extra: "untrusted" }),
  });

  await assert.rejects(() => run(data, first));
  assert.equal(first.withdrawClicks, 1);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdraw_reconcile");

  const later = fakeAdapter({
    findPublished: () => exact(),
    verifyWithdrawnError: codedError("WECHAT_WITHDRAWAL_STILL_PRESENT"),
  });
  await run(data, later);
  assert.equal(later.withdrawClicks, 0);
  assert.equal(later.publishClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "withdraw_reconcile");
});

test("a still-readable or ambiguous public withdrawal verification aborts later queue clicks", async () => {
  for (const code of ["WECHAT_WITHDRAWAL_STILL_PRESENT", "WECHAT_WITHDRAWAL_AMBIGUOUS"]) {
    const data = seed({
      status: "withdraw_reconcile",
      publication: {
        everPublished: true,
        desiredLocation: "drafts",
        withdrawRequestedAt: "2026-08-07T03:00:00.000Z",
      },
      posts: { [SECOND_ID]: post("pending", { title: "第二篇文章" }) },
    });
    marker(data.root);
    const adapter = fakeAdapter({
      verifyWithdrawnError: codedError(code),
      verifyPublished: () => ({ published: true, candidate: exact(SECOND_ID) }),
    });

    await run(data, adapter);

    const state = loadState(data.stateFile);
    assert.equal(adapter.withdrawClicks, 0, code);
    assert.equal(adapter.publishClicks, 0, code);
    assert.equal(state.posts[POST_ID].publication.status, "withdraw_reconcile", code);
    assert.equal(state.posts[SECOND_ID].publication.status, "pending", code);
  }
});

test("publisher passes nested publication URL to withdrawal verification before later clicks", async () => {
  const publishedUrl = `https://mp.weixin.qq.com/s/${POST_ID}`;
  const data = seed({
    status: "withdraw_reconcile",
    publication: {
      everPublished: true,
      desiredLocation: "drafts",
      withdrawRequestedAt: "2026-08-07T03:00:00.000Z",
      publishedUrl,
    },
    posts: { [SECOND_ID]: post("pending", { title: "第二篇文章" }) },
  });
  marker(data.root);
  const requestedPublicUrls = [];
  const adapter = new WechatBrowserAdapter({}, {
    fetchPublicArticle: async (url) => {
      requestedPublicUrls.push(url);
      return { status: 200 };
    },
  });
  let laterAutomaticClicks = 0;
  adapter.checkSession = async () => ({ authenticated: true });
  adapter.findPublishedCandidate = async () => ({ kind: "absent" });
  adapter.findDraftCandidate = async (record) => ({
    kind: "exact",
    title: record.title,
    href: "https://mp.weixin.qq.com/draft/second",
  });
  adapter.openDraft = async () => {};
  adapter.publishCurrentDraft = async () => { laterAutomaticClicks += 1; };
  adapter.verifyPublished = async (record) => ({
    published: true,
    candidate: exact(record.title === "第二篇文章" ? SECOND_ID : POST_ID),
  });

  await run(data, adapter);

  const state = loadState(data.stateFile);
  assert.deepEqual(requestedPublicUrls, [publishedUrl]);
  assert.equal(state.posts[POST_ID].publication.status, "withdraw_reconcile");
  assert.equal(state.posts[SECOND_ID].publication.status, "pending");
  assert.equal(laterAutomaticClicks, 0);
});

test("disabled automatic withdrawal retains an actionable published record without browser work", async () => {
  const data = seed({ status: "published", publication: { everPublished: true } });
  marker(data.root);
  let opens = 0;

  await runLifecycle({
    ...data,
    openAdapter: async () => {
      opens += 1;
      return { adapter: fakeAdapter(), close: async () => {} };
    },
    autoPublish: false,
    autoWithdraw: false,
    now: () => NOW,
  });

  assert.equal(opens, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "published");
});

test("withdrawal queue finishes before the publication queue starts", async () => {
  const data = seed({
    status: "published",
    publication: { everPublished: true },
    posts: { [SECOND_ID]: post("pending", { title: "第二篇文章" }) },
  });
  marker(data.root);
  const order = [];
  const adapter = fakeAdapter({
    findPublished: (record) => record.title === "可验证文章"
      ? exact()
      : { kind: "absent" },
    onWithdraw: () => order.push("withdraw"),
    onPublish: () => order.push("publish"),
    verifyPublished: () => ({ published: true, candidate: exact(SECOND_ID) }),
  });

  await run(data, adapter);

  assert.deepEqual(order, ["withdraw", "publish"]);
});

test("invalid withdrawal reconciliation results abort before later publication clicks", async () => {
  const invalidResults = [
    null,
    {},
    { withdrawn: false },
    { withdrawn: true, extra: "untrusted" },
  ];

  for (const result of invalidResults) {
    const data = seed({
      status: "withdraw_reconcile",
      publication: { everPublished: true },
      posts: { [SECOND_ID]: post("pending", { title: "第二篇文章" }) },
    });
    marker(data.root);
    const adapter = fakeAdapter({
      verifyWithdrawn: () => result,
      verifyPublished: () => ({ published: true, candidate: exact(SECOND_ID) }),
    });

    await assert.rejects(
      () => run(data, adapter),
      (error) => {
        assert.equal(error.code, "WECHAT_ADAPTER_RESULT_INVALID");
        return true;
      },
    );

    const state = loadState(data.stateFile);
    assert.equal(adapter.withdrawClicks, 0);
    assert.equal(adapter.publishClicks, 0);
    assert.equal(state.posts[POST_ID].publication.status, "withdraw_reconcile");
    assert.equal(state.posts[SECOND_ID].publication.status, "pending");
  }
});

test("enumerated candidate errors block one record and allow the next safe record", async () => {
  const data = seed({
    posts: { [SECOND_ID]: post("pending", { title: "第二篇文章" }) },
  });
  const adapter = fakeAdapter({
    findDraft: (record) => {
      if (record.title === "可验证文章") {
        throw codedError("WECHAT_DRAFT_CANDIDATE_NOT_FOUND");
      }
      return { kind: "exact", title: record.title, href: "https://mp.weixin.qq.com/draft/2" };
    },
    verifyPublished: (record) => ({
      published: true,
      candidate: exact(record.title === "第二篇文章" ? SECOND_ID : POST_ID),
    }),
  });

  await run(data, adapter);

  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "blocked");
  assert.equal(loadState(data.stateFile).posts[SECOND_ID].publication.status, "published");
  assert.equal(adapter.publishClicks, 1);
});

test("unclassified page drift aborts the queue before a later record can click", async () => {
  const data = seed({
    posts: { [SECOND_ID]: post("pending", { title: "第二篇文章" }) },
  });
  const adapter = fakeAdapter({
    findPublished: (record) => {
      if (record.title === "可验证文章") throw new Error("changed page shape");
      return { kind: "absent" };
    },
  });

  await assert.rejects(() => run(data, adapter), /changed page shape/);

  assert.equal(adapter.publishClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
  assert.equal(loadState(data.stateFile).posts[SECOND_ID].publication.status, "pending");
  assert.equal(
    adapter.calls.some(([name, title]) => name === "findPublishedCandidate" && title === "第二篇文章"),
    false,
  );
});

test("failed session health uses the adapter's shared global blocker code", async () => {
  const data = seed();
  const adapter = fakeAdapter({
    session: { authenticated: false, blocker: "captcha" },
  });

  await assert.rejects(
    () => run(data, adapter),
    (error) => {
      assert.equal(error.code, "WECHAT_SESSION_CAPTCHA_REQUIRED");
      return true;
    },
  );
  assert.equal(adapter.publishClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
});

test("an unstructured absence result aborts instead of authorizing a click", async () => {
  const data = seed();
  const adapter = fakeAdapter({ findPublished: () => null });

  await assert.rejects(
    () => run(data, adapter),
    (error) => {
      assert.equal(error.code, "WECHAT_ADAPTER_RESULT_INVALID");
      return true;
    },
  );
  assert.equal(adapter.publishClicks, 0);
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "pending");
});

test("dry-run performs no writes and never opens a browser", async () => {
  const data = seed({ status: "publishing" });
  const before = fs.readFileSync(data.stateFile, "utf8");
  let opens = 0;

  await runLifecycle({
    ...data,
    openAdapter: async () => {
      opens += 1;
      return { adapter: fakeAdapter(), close: async () => {} };
    },
    autoPublish: true,
    autoWithdraw: true,
    dryRun: true,
    now: () => NOW,
  });

  assert.equal(opens, 0);
  assert.equal(fs.readFileSync(data.stateFile, "utf8"), before);
});

test("arm baselines current published IDs once", () => {
  const data = fixture();
  saveState(data.stateFile, emptyState());
  fs.writeFileSync(path.join(data.root, "content", "published", `${POST_ID}.md`), "---\ntitle: A\n---\n");
  fs.writeFileSync(path.join(data.root, "content", "published", `${SECOND_ID}.md`), "---\ntitle: B\n---\n");

  const first = arm({ ...data, now: () => NOW });
  fs.writeFileSync(path.join(data.root, "content", "published", "2026-08-07-120002.md"), "later");
  const second = arm({ ...data, now: () => "2026-08-08T00:00:00.000Z" });

  assert.equal(first.baselineCount, 2);
  assert.equal(second.baselineCount, 2);
  assert.deepEqual(loadState(data.stateFile).publisher.baselinePostIds, [POST_ID, SECOND_ID]);
  assert.equal(loadState(data.stateFile).publisher.armedAt, NOW);
  assert.equal(loadState(data.stateFile).publisher.baselineCaptured, true);
});

test("status summary reports actionable and last verified lifecycle state", () => {
  const state = emptyState();
  state.publisher.armedAt = NOW;
  state.publisher.baselineCaptured = true;
  state.publisher.baselinePostIds = [POST_ID];
  state.posts.a = post("pending");
  state.posts.b = post("publish_reconcile");
  state.posts.c = post("withdraw_reconcile", { publication: { everPublished: true } });
  state.posts.d = post("blocked", { publication: { blockedOperation: "publish" } });
  state.posts.e = post("published", { publication: { everPublished: true, publishedAt: NOW } });
  state.posts.f = post("withdrawn", { publication: { everPublished: true, withdrawnAt: "2026-08-07T05:00:00.000Z" } });

  const summary = statusSummary(state);

  assert.equal(summary.armed, true);
  assert.equal(summary.baselineCount, 1);
  assert.deepEqual(summary.counts, {
    pending: 1,
    publishReconcile: 1,
    withdrawReconcile: 1,
    blockedPublish: 1,
    blockedWithdraw: 0,
  });
  assert.equal(summary.lastPublished.postId, "e");
  assert.equal(summary.lastWithdrawn.postId, "f");
});

test("explicit resolution is the only way to re-arm uncertain lifecycle outcomes", () => {
  const publishedData = seed({ status: "publish_reconcile" });
  resolveRecord({ ...publishedData, postId: POST_ID, resolution: "published", url: "https://mp.weixin.qq.com/s/manual", now: () => NOW });
  let publication = loadState(publishedData.stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "published");
  assert.equal(publication.publishedUrl, "https://mp.weixin.qq.com/s/manual");

  const notPublishedData = seed({ status: "publish_reconcile" });
  resolveRecord({ ...notPublishedData, postId: POST_ID, resolution: "not-published", now: () => NOW });
  assert.equal(loadState(notPublishedData.stateFile).posts[POST_ID].publication.status, "pending");

  const canceledData = seed({ status: "publish_reconcile" });
  marker(canceledData.root);
  resolveRecord({ ...canceledData, postId: POST_ID, resolution: "not-published", now: () => NOW });
  assert.equal(loadState(canceledData.stateFile).posts[POST_ID].publication.status, "draft_only");

  const withdrawnData = seed({ status: "withdraw_reconcile", publication: { everPublished: true } });
  resolveRecord({ ...withdrawnData, postId: POST_ID, resolution: "withdrawn", now: () => NOW });
  assert.equal(loadState(withdrawnData.stateFile).posts[POST_ID].publication.status, "withdrawn");

  const stillPublishedData = seed({ status: "withdraw_reconcile", publication: { everPublished: true } });
  resolveRecord({ ...stillPublishedData, postId: POST_ID, resolution: "still-published", now: () => NOW });
  publication = loadState(stillPublishedData.stateFile).posts[POST_ID].publication;
  assert.equal(publication.status, "published");
  assert.equal(publication.blockedOperation, null);
});

test("published resolution accepts only public HTTPS WeChat article URLs", () => {
  const invalidUrls = [
    "http://mp.weixin.qq.com/s/article",
    "https://example.com/s/article",
    "https://mp.weixin.qq.com.evil.test/s/article",
    "https://mp.weixin.qq.com/cgi-bin/appmsg",
    "https://mp.weixin.qq.com/sneaky/article",
    "file:///private/browser-profile",
    "javascript:alert(1)",
  ];
  for (const url of invalidUrls) {
    const data = seed({ status: "publish_reconcile" });
    assert.throws(
      () => resolveRecord({
        ...data,
        postId: POST_ID,
        resolution: "published",
        url,
        now: () => NOW,
      }),
      (error) => {
        assert.equal(error.code, "WECHAT_PUBLISHED_URL_INVALID");
        return true;
      },
      url,
    );
    assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "publish_reconcile");
  }

  for (const url of ["https://mp.weixin.qq.com/s", "https://mp.weixin.qq.com/s/article?scene=1"]) {
    const data = seed({ status: "publish_reconcile" });
    assert.doesNotThrow(() => resolveRecord({
      ...data,
      postId: POST_ID,
      resolution: "published",
      url,
      now: () => NOW,
    }));
    assert.equal(loadState(data.stateFile).posts[POST_ID].publication.publishedUrl, url);
  }
});

test("not-published resolution cannot make a baseline article eligible", () => {
  const data = seed({ status: "publish_reconcile" });
  const state = loadState(data.stateFile);
  state.publisher.baselinePostIds = [POST_ID];
  saveState(data.stateFile, state);

  assert.throws(
    () => resolveRecord({ ...data, postId: POST_ID, resolution: "not-published", now: () => NOW }),
    /基线/,
  );
  assert.equal(loadState(data.stateFile).posts[POST_ID].publication.status, "publish_reconcile");

  const canceled = seed({ status: "publish_reconcile" });
  const canceledState = loadState(canceled.stateFile);
  canceledState.publisher.baselinePostIds = [POST_ID];
  saveState(canceled.stateFile, canceledState);
  marker(canceled.root);
  assert.doesNotThrow(
    () => resolveRecord({ ...canceled, postId: POST_ID, resolution: "not-published", now: () => NOW }),
  );
  assert.equal(loadState(canceled.stateFile).posts[POST_ID].publication.status, "draft_only");
});

test("CLI parser accepts only documented commands and resolution shapes", () => {
  assert.deepEqual(parseArguments(["login"]), { command: "login" });
  assert.deepEqual(parseArguments(["arm"]), { command: "arm" });
  assert.deepEqual(parseArguments(["status"]), { command: "status" });
  assert.deepEqual(parseArguments(["run", "--dry-run", "--automatic", "--retry", POST_ID]), {
    command: "run",
    dryRun: true,
    automatic: true,
    retry: POST_ID,
  });
  assert.deepEqual(parseArguments(["resolve", POST_ID, "--published", "https://mp.weixin.qq.com/s/example"]), {
    command: "resolve",
    postId: POST_ID,
    resolution: "published",
    url: "https://mp.weixin.qq.com/s/example",
  });
  assert.deepEqual(parseArguments(["resolve", POST_ID, "--not-published"]), {
    command: "resolve",
    postId: POST_ID,
    resolution: "not-published",
  });
  assert.deepEqual(parseArguments(["resolve", POST_ID, "--withdrawn"]), {
    command: "resolve",
    postId: POST_ID,
    resolution: "withdrawn",
  });
  assert.deepEqual(parseArguments(["resolve", POST_ID, "--still-published"]), {
    command: "resolve",
    postId: POST_ID,
    resolution: "still-published",
  });
  assert.throws(() => parseArguments(["run", "--retry", "bad-id"]), /文章 ID/);
  assert.throws(() => parseArguments(["resolve", POST_ID, "--published"]), /URL/);
  assert.throws(() => parseArguments(["resolve", POST_ID, "--withdrawn", "extra"]), /参数/);
});

test("CLI parser rejects non-public WeChat resolution URLs without echoing input", () => {
  const invalidUrls = [
    "http://mp.weixin.qq.com/s/article",
    "https://unrelated.test/s/article",
    "https://mp.weixin.qq.com/cgi-bin/appmsg",
    "file:///Users/operator/private-profile",
    "javascript:cookie=secret-value",
  ];
  for (const url of invalidUrls) {
    assert.throws(
      () => parseArguments(["resolve", POST_ID, "--published", url]),
      (error) => {
        assert.equal(error.code, "WECHAT_CLI_USAGE");
        assert.doesNotMatch(error.message, /operator|secret-value|unrelated\.test|javascript|file:/);
        return true;
      },
      url,
    );
  }
});

test("CLI argument errors and unexpected failures use bounded private output", async () => {
  const rawArgument = "--cookie=<html>/Users/operator/private-profile";
  assert.throws(
    () => parseArguments(["run", rawArgument]),
    (error) => {
      assert.equal(error.code, "WECHAT_CLI_USAGE");
      assert.equal(error.message, "公众号发布命令参数无效。");
      assert.equal(error.message.includes(rawArgument), false);
      return true;
    },
  );

  const errors = [];
  const result = await main({
    root: fixture().root,
    argv: ["status"],
    loadEnvFile: () => {
      throw new Error("cookie=secret-value /Users/operator/private-profile <html>");
    },
    output: () => assert.fail("failed status must not write normal output"),
    errorOutput: (line) => errors.push(line),
  });

  assert.deepEqual(result, {
    ok: false,
    errorCode: "WECHAT_CLI_UNEXPECTED",
  });
  assert.deepEqual(errors, ["微信公众号发布器执行失败，未执行不确定操作。"]);
  assert.doesNotMatch(errors.join("\n"), /secret-value|operator|html|cookie/);
});

test("CLI maps the known published URL code without trusting its message", () => {
  const error = codedError(
    "WECHAT_PUBLISHED_URL_INVALID",
    "cookie=secret-value /Users/operator/private-profile <html>",
  );

  assert.deepEqual(publicCliFailure(error), {
    errorCode: "WECHAT_PUBLISHED_URL_INVALID",
    message: "已发表文章 URL 无效，仅接受微信公众平台公开文章链接。",
  });
});

test("login uses one injected timestamp and closes the dedicated browser", async () => {
  const data = fixture();
  saveState(data.stateFile, emptyState());
  let clockCalls = 0;
  let closed = false;

  await main({
    root: data.root,
    argv: ["login"],
    env: { WECHAT_SYNC_STATE_FILE: ".wechat-sync/state.json" },
    loadEnvFile: () => ({ loaded: false }),
    output: () => {},
    now: () => {
      clockCalls += 1;
      if (clockCalls > 1) throw new Error("clock called twice");
      return new Date(NOW);
    },
    openLoginAdapter: async () => ({
      adapter: { checkSession: async () => ({ authenticated: true }) },
      close: async () => { closed = true; },
    }),
  });

  assert.equal(clockCalls, 1);
  assert.equal(closed, true);
  assert.equal(loadState(data.stateFile).publisher.browserSessionCheckedAt, NOW);
});
