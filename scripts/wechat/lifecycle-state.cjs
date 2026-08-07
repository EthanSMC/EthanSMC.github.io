const STATUSES = new Set([
  "manual", "draft_only", "pending", "publishing", "publish_reconcile",
  "published", "withdrawing", "withdraw_reconcile", "withdrawn", "blocked",
]);

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

function armPublisher(state, postIds, now) {
  if (state.publisher.armedAt) return state;
  state.publisher.armedAt = now;
  state.publisher.baselinePostIds = [...new Set(postIds)];
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
  const terminal = publication.status === "published" || publication.status === "withdrawn";
  if (
    !state.publisher?.armedAt
    || baselinePostIds.includes(postId)
    || terminal
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
      publication.status === "published"
      || publication.status === "withdrawn"
      || isBaseline
      || publication.everPublished
    )
  ) {
    throw new Error(`公众号文章不可重新进入待发布状态：${postId}`);
  }

  const transitioned = copyPublication({ ...publication, ...patch }, nextStatus);
  transitioned.status = nextStatus;
  if (nextStatus === "published") transitioned.everPublished = true;
  record.publication = transitioned;
  return transitioned;
}

module.exports = {
  STATUSES,
  armPublisher,
  emptyPublication,
  publicationForNewPost,
  recoverInterruptedOperations,
  transitionPublication,
};
