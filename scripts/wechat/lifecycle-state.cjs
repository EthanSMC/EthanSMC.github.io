const STATUSES = new Set([
  "manual", "draft_only", "pending", "publishing", "publish_reconcile",
  "published", "withdrawing", "withdraw_reconcile", "withdrawn", "blocked",
]);

const NEW_POST_ELIGIBLE_STATUSES = new Set(["manual", "draft_only"]);
const PENDING_TRANSITION_STATUSES = new Set([
  "manual", "draft_only", "blocked", "pending",
]);
const WITHDRAWAL_START_STATUSES = new Set([
  "manual", "published", "publishing", "publish_reconcile",
]);
const PUBLICATION_IDENTITY_FIELDS = [
  "publicationOrigin",
  "draftFingerprint",
  "publishedAt",
  "publishedUrl",
  "platformArticleId",
];
const PUBLISHED_EVIDENCE_STATUSES = new Set([
  "published", "withdrawing", "withdraw_reconcile", "withdrawn",
]);
const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{6}$/;

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" || !value.endsWith("Z")) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function hasValidBaselineSnapshot(publisher) {
  if (publisher?.baselineCaptured !== true || !Array.isArray(publisher.baselinePostIds)) return false;
  if (!publisher.baselinePostIds.every((postId) => POST_ID_PATTERN.test(postId))) return false;
  return new Set(publisher.baselinePostIds).size === publisher.baselinePostIds.length;
}

function emptyPublication(status = "manual") {
  if (!STATUSES.has(status)) throw new Error(`未知公众号生命周期状态：${status}`);
  return {
    status,
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
  };
}

function copyPublication(value, fallbackStatus = "manual") {
  const status = STATUSES.has(value?.status) ? value.status : fallbackStatus;
  const publication = emptyPublication(status);
  for (const field of Object.keys(publication)) {
    if (field !== "status" && Object.hasOwn(value || {}, field)) {
      publication[field] = value[field];
    }
  }
  return publication;
}

function hasValidPublisherArming(state) {
  const armedAt = state.publisher?.armedAt;
  return isCanonicalUtcTimestamp(armedAt) && hasValidBaselineSnapshot(state.publisher);
}

function armPublisher(state, postIds, now) {
  if (hasValidPublisherArming(state)) return state;
  if (!isCanonicalUtcTimestamp(now) || !Array.isArray(postIds)) {
    throw new Error("公众号自动发布基线输入无效。");
  }
  const baselinePostIds = [...new Set(postIds)];
  if (!baselinePostIds.every((postId) => POST_ID_PATTERN.test(postId))) {
    throw new Error("公众号自动发布基线文章 ID 无效。");
  }
  state.publisher.armedAt = now;
  state.publisher.baselineCaptured = true;
  state.publisher.baselinePostIds = baselinePostIds;
  return state;
}

function recoverInterruptedOperations(state, now) {
  void now;
  for (const record of Object.values(state.posts)) {
    if (record.publication?.status === "publishing") {
      record.publication.status = "publish_reconcile";
    } else if (record.publication?.status === "withdrawing") {
      record.publication.status = "withdraw_reconcile";
    }
  }
  return state;
}

function publicationForNewPost(state, postId, now) {
  const publication = copyPublication(state.posts[postId]?.publication);
  const baselinePostIds = state.publisher?.baselinePostIds || [];
  if (
    !hasValidPublisherArming(state)
    || baselinePostIds.includes(postId)
    || !NEW_POST_ELIGIBLE_STATUSES.has(publication.status)
    || publication.everPublished
  ) {
    return publication;
  }
  return {
    ...publication,
    status: "pending",
    desiredLocation: "published",
    eligibleAt: now,
  };
}

function transitionPublication(state, postId, nextStatus, patch = {}) {
  if (!STATUSES.has(nextStatus)) {
    throw new Error(`未知公众号生命周期状态：${nextStatus}`);
  }
  const record = state.posts[postId];
  if (!record) throw new Error(`找不到公众号文章状态：${postId}`);

  const publication = copyPublication(record.publication);
  const isBaseline = (state.publisher?.baselinePostIds || []).includes(postId);
  if (
    nextStatus === "pending"
    && (
      !PENDING_TRANSITION_STATUSES.has(publication.status)
      || isBaseline
      || publication.everPublished
    )
  ) {
    throw new Error(`公众号文章不可重新进入待发布状态：${postId}`);
  }
  if (
    nextStatus === "publishing"
    && (publication.status !== "pending" || isBaseline || publication.everPublished)
  ) {
    throw new Error(`公众号文章不可开始自动发布：${postId}`);
  }
  if (nextStatus === "withdrawing" && !WITHDRAWAL_START_STATUSES.has(publication.status)) {
    throw new Error(`公众号文章不可开始自动撤回：${postId}`);
  }

  const transitioned = copyPublication({ ...publication, ...patch }, nextStatus);
  transitioned.status = nextStatus;
  if (publication.everPublished || PUBLISHED_EVIDENCE_STATUSES.has(nextStatus)) {
    transitioned.everPublished = true;
  }
  if (nextStatus === "withdrawn") {
    for (const field of PUBLICATION_IDENTITY_FIELDS) {
      if (publication[field] !== null) transitioned[field] = publication[field];
    }
  }
  record.publication = transitioned;
  return transitioned;
}

module.exports = {
  STATUSES,
  armPublisher,
  emptyPublication,
  hasValidPublisherArming,
  isCanonicalUtcTimestamp,
  publicationForNewPost,
  recoverInterruptedOperations,
  transitionPublication,
};
