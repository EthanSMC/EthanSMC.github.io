const fs = require("node:fs");
const path = require("node:path");

const {
  BROWSER_ERROR_CODES,
  RECORD_LOCAL_BROWSER_ERROR_CODES,
} = require("./browser-publisher.cjs");
const { loadWithdrawalMarkers } = require("./lifecycle-intent.cjs");
const {
  armPublisher,
  recoverInterruptedOperations,
  transitionPublication,
} = require("./lifecycle-state.cjs");
const { loadState, saveState } = require("./state.cjs");

const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{6}$/;
const RECORD_LOCAL_ERROR_CODES = new Set(RECORD_LOCAL_BROWSER_ERROR_CODES);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function timestamp(now = () => new Date()) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("公众号生命周期时钟返回了无效时间。");
  return date.toISOString();
}

function publishedPostIds(root) {
  const directory = path.join(root, "content", "published");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.basename(entry.name, ".md"))
    .filter((postId) => POST_ID_PATTERN.test(postId))
    .sort();
}

function activeWithdrawalMarkers(root, markerInventory) {
  const markers = markerInventory || loadWithdrawalMarkers(root);
  const published = new Set(publishedPostIds(root));
  return new Map([...markers.entries()].filter(([postId]) => !published.has(postId)));
}

function statusChanged(before, state) {
  return Object.keys(state.posts).some(
    (postId) => before[postId] !== state.posts[postId].publication?.status,
  );
}

function sanitizedError(error, fallback) {
  let message = error instanceof Error ? error.message : String(error || fallback);
  message = message.split(/\r?\n/, 1)[0]
    .replace(/(?:\/[\w.@%+,:=-]+){2,}/g, "[private path]")
    .replace(/(access[_ -]?token|cookie|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .trim();
  return (message || fallback).slice(0, 240);
}

function armingStatus(state) {
  const value = state.publisher?.armedAt;
  if (value === null || value === undefined) return { armed: false, invalid: false, armedAt: null };
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return { armed: true, invalid: false, armedAt: value };
  }
  return { armed: false, invalid: true, armedAt: null };
}

function assertValidArming(state) {
  const status = armingStatus(state);
  if (status.invalid) {
    throw codedError(
      "WECHAT_PUBLISHER_ARMING_INVALID",
      "公众号自动发布基线时间无效，已停止所有自动操作。",
    );
  }
  return status;
}

function browserErrorKind(error) {
  if (error?.code === BROWSER_ERROR_CODES.PUBLISHED_CANDIDATE_NOT_FOUND) return "absence";
  if (RECORD_LOCAL_ERROR_CODES.has(error?.code)) return "record";
  return "global";
}

function validatedPublishedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw codedError(
      "WECHAT_PUBLISHED_URL_INVALID",
      "已发表文章 URL 必须是微信公众平台公开文章链接。",
    );
  }
  if (
    url.protocol !== "https:"
    || url.host !== "mp.weixin.qq.com"
    || url.username
    || url.password
    || !/^\/s(?:\/.*)?$/.test(url.pathname)
  ) {
    throw codedError(
      "WECHAT_PUBLISHED_URL_INVALID",
      "已发表文章 URL 必须是微信公众平台公开文章链接。",
    );
  }
  return url;
}

function exactCandidate(value) {
  return value?.kind === "exact" && typeof value.title === "string" && typeof value.href === "string";
}

async function findPublished(adapter, record) {
  try {
    const candidate = await adapter.findPublishedCandidate(record);
    if (exactCandidate(candidate)) return { kind: "exact", candidate };
    throw codedError("WECHAT_ADAPTER_RESULT_INVALID", "已发表文章查找结果不明确。");
  } catch (error) {
    if (browserErrorKind(error) === "absence") return { kind: "absent" };
    throw error;
  }
}

function candidatePatch(candidate) {
  let platformArticleId = candidate?.platformArticleId || null;
  if (!platformArticleId && candidate?.href) {
    try {
      const url = new URL(candidate.href);
      platformArticleId = url.searchParams.get("appmsgid")
        || url.searchParams.get("appmsg_id")
        || url.searchParams.get("article_id")
        || null;
    } catch {
      platformArticleId = null;
    }
  }
  return {
    publishedUrl: candidate?.href || null,
    platformArticleId,
  };
}

function verificationCandidate(result) {
  if (exactCandidate(result)) return result;
  if (result?.published === true && exactCandidate(result.candidate)) return result.candidate;
  return null;
}

function verifiedWithdrawal(result) {
  return result?.withdrawn === true;
}

function statusSummary(state) {
  const entries = Object.entries(state.posts || {});
  const arming = armingStatus(state);
  const counts = {
    pending: 0,
    publishReconcile: 0,
    withdrawReconcile: 0,
    blockedPublish: 0,
    blockedWithdraw: 0,
  };
  for (const [, record] of entries) {
    const publication = record.publication || {};
    if (publication.status === "pending") counts.pending += 1;
    if (publication.status === "publish_reconcile") counts.publishReconcile += 1;
    if (publication.status === "withdraw_reconcile") counts.withdrawReconcile += 1;
    if (publication.status === "blocked" && publication.blockedOperation === "publish") counts.blockedPublish += 1;
    if (publication.status === "blocked" && publication.blockedOperation === "withdraw") counts.blockedWithdraw += 1;
  }

  function latest(field) {
    return entries
      .filter(([, record]) => Number.isFinite(Date.parse(record.publication?.[field] || "")))
      .sort((left, right) => Date.parse(right[1].publication[field]) - Date.parse(left[1].publication[field]))
      .map(([postId, record]) => ({ postId, at: record.publication[field] }))[0] || null;
  }

  return {
    armed: arming.armed,
    armedAt: arming.armedAt,
    baselineCount: Array.isArray(state.publisher?.baselinePostIds)
      ? state.publisher.baselinePostIds.length
      : 0,
    browserSessionCheckedAt: state.publisher?.browserSessionCheckedAt || null,
    counts,
    lastPublished: latest("publishedAt"),
    lastWithdrawn: latest("withdrawnAt"),
  };
}

function arm(options) {
  const stateFile = options.stateFile;
  const load = options.loadState || loadState;
  const save = options.saveState || saveState;
  if (load === loadState && !fs.existsSync(stateFile)) {
    throw new Error("公众号草稿状态不存在，无法建立自动发布基线。");
  }

  const state = load(stateFile);
  const arming = assertValidArming(state);
  const alreadyArmed = arming.armed;
  const postIds = alreadyArmed ? state.publisher.baselinePostIds : publishedPostIds(options.root);
  const baselineCount = postIds.length;
  if (typeof options.announce === "function") options.announce(baselineCount);
  if (!alreadyArmed) {
    armPublisher(state, postIds, timestamp(options.now));
    save(stateFile, state);
  }
  return { baselineCount, armedAt: state.publisher.armedAt, alreadyArmed };
}

function retryBlockedRecord(state, postId) {
  if (!postId) return false;
  const record = state.posts[postId];
  if (!record) throw new Error(`找不到公众号文章状态：${postId}`);
  const publication = record.publication;
  if (publication.status !== "blocked") {
    throw new Error("--retry 只能用于点击前已阻塞的公众号操作。");
  }
  if (publication.blockedOperation === "publish") {
    transitionPublication(state, postId, "pending", {
      blockedOperation: null,
      lastError: null,
    });
  } else if (publication.blockedOperation === "withdraw") {
    publication.status = publication.everPublished
      ? "published"
      : (publication.publishStartedAt ? "publish_reconcile" : "manual");
    publication.blockedOperation = null;
    publication.lastError = null;
  } else {
    throw new Error("公众号阻塞状态缺少可重试的操作类型。");
  }
  return true;
}

async function runLifecycle(options) {
  const load = options.loadState || loadState;
  const save = options.saveState || saveState;
  const dryRun = Boolean(options.dryRun);
  const loadedState = load(options.stateFile);
  const arming = assertValidArming(loadedState);
  const state = dryRun ? structuredClone(loadedState) : loadedState;
  const beforeRecovery = Object.fromEntries(
    Object.entries(state.posts).map(([postId, record]) => [postId, record.publication?.status]),
  );
  recoverInterruptedOperations(state, timestamp(options.now));
  const persist = () => {
    if (!dryRun) save(options.stateFile, state);
  };
  if (statusChanged(beforeRecovery, state)) persist();

  if (options.retry && retryBlockedRecord(state, options.retry)) persist();

  const markers = activeWithdrawalMarkers(options.root, options.markers);
  const markerEntries = [...markers.entries()]
    .filter(([postId]) => state.posts[postId])
    .sort(([left], [right]) => left.localeCompare(right));

  if (dryRun) return { state, summary: statusSummary(state), browserOpened: false };

  let opened = null;
  let adapter = options.adapter || null;
  let sessionChecked = false;
  async function getAdapter() {
    if (!adapter) {
      if (typeof options.openAdapter !== "function") {
        throw new Error("公众号浏览器适配器未配置。");
      }
      opened = await options.openAdapter();
      adapter = opened?.adapter || opened;
    }
    if (!adapter || typeof adapter.findPublishedCandidate !== "function") {
      throw new Error("公众号浏览器适配器无效。");
    }
    if (!sessionChecked && typeof adapter.checkSession === "function") {
      const session = await adapter.checkSession();
      if (!session?.authenticated) {
        const blockerCodes = {
          login: BROWSER_ERROR_CODES.SESSION_LOGIN_REQUIRED,
          captcha: BROWSER_ERROR_CODES.SESSION_CAPTCHA_REQUIRED,
          verification: BROWSER_ERROR_CODES.SESSION_VERIFICATION_REQUIRED,
        };
        throw codedError(
          blockerCodes[session?.blocker] || BROWSER_ERROR_CODES.PAGE_UNRECOGNIZED,
          "微信浏览器登录或页面状态无效，已停止所有操作。",
        );
      }
      sessionChecked = true;
      state.publisher.browserSessionCheckedAt = timestamp(options.now);
      persist();
    }
    return adapter;
  }

  function saveRecordError(postId, operation, error, blockDeterministic = false) {
    const record = state.posts[postId];
    const patch = {
      lastError: sanitizedError(error, `公众号${operation}操作失败。`),
    };
    const kind = browserErrorKind(error);
    if (blockDeterministic && kind === "record") {
      transitionPublication(state, postId, "blocked", {
        ...patch,
        blockedOperation: operation,
      });
    } else {
      Object.assign(record.publication, patch);
    }
    persist();
    if (kind === "global") throw error;
  }

  function markDraftOnly(postId, markerValue) {
    transitionPublication(state, postId, "draft_only", {
      desiredLocation: "drafts",
      withdrawRequestedAt: markerValue.requestedAt,
      blockedOperation: null,
      lastError: null,
    });
    persist();
  }

  function markPublished(postId, candidate, origin) {
    transitionPublication(state, postId, "published", {
      ...candidatePatch(candidate),
      publicationOrigin: origin,
      publishedAt: timestamp(options.now),
      blockedOperation: null,
      lastError: null,
    });
    persist();
  }

  async function withdrawRecord(postId, markerValue) {
    const record = state.posts[postId];
    const publication = record.publication;
    publication.desiredLocation = "drafts";
    publication.withdrawRequestedAt = markerValue.requestedAt;

    if (
      publication.status === "pending"
      || (publication.status === "blocked" && publication.blockedOperation === "publish")
    ) {
      markDraftOnly(postId, markerValue);
      return;
    }
    if (publication.status === "withdrawn" || publication.status === "draft_only") {
      persist();
      return;
    }
    if (publication.status === "blocked" && publication.blockedOperation === "withdraw") {
      persist();
      return;
    }
    if (!options.autoWithdraw || !arming.armed) {
      persist();
      return;
    }

    const browser = await getAdapter();
    if (publication.status === "withdraw_reconcile") {
      try {
        const result = await browser.verifyWithdrawn(record);
        if (verifiedWithdrawal(result)) {
          transitionPublication(state, postId, "withdrawn", {
            desiredLocation: "drafts",
            withdrawnAt: timestamp(options.now),
            blockedOperation: null,
            lastError: null,
          });
          persist();
        }
      } catch (error) {
        saveRecordError(postId, "withdraw", error);
      }
      return;
    }

    let lookup;
    try {
      lookup = await findPublished(browser, record);
    } catch (error) {
      saveRecordError(postId, "withdraw", error, true);
      return;
    }
    if (lookup.kind === "ambiguous") {
      saveRecordError(postId, "withdraw", lookup.error, true);
      return;
    }
    if (lookup.kind === "absent") {
      if (publication.status === "manual") markDraftOnly(postId, markerValue);
      else if (publication.status === "published") {
        transitionPublication(state, postId, "withdrawn", {
          desiredLocation: "drafts",
          withdrawRequestedAt: markerValue.requestedAt,
          withdrawnAt: timestamp(options.now),
          blockedOperation: null,
          lastError: null,
        });
        persist();
      }
      else {
        publication.lastError = sanitizedError(
          new Error("无法证明已开始发布的文章从未发表，保留人工核对状态。"),
          "公众号发表状态需要人工核对。",
        );
        persist();
      }
      return;
    }

    const candidate = lookup.candidate;
    try {
      await browser.openPublished(candidate);
    } catch (error) {
      saveRecordError(postId, "withdraw", error, true);
      return;
    }

    const origin = publication.publicationOrigin
      || (publication.publishStartedAt ? "automatic" : "manual-detected");
    transitionPublication(state, postId, "withdrawing", {
      ...candidatePatch(candidate),
      desiredLocation: "drafts",
      publicationOrigin: origin,
      publishedAt: publication.publishedAt || timestamp(options.now),
      withdrawRequestedAt: markerValue.requestedAt,
      withdrawStartedAt: timestamp(options.now),
      blockedOperation: null,
      lastError: null,
    });
    persist();

    try {
      await browser.withdrawCurrentArticle(record);
    } catch (error) {
      transitionPublication(state, postId, "withdraw_reconcile", {
        lastError: sanitizedError(error, "公众号撤回结果需要人工核对。"),
      });
      persist();
      if (browserErrorKind(error) === "global") throw error;
      return;
    }

    try {
      const result = await browser.verifyWithdrawn(record);
      if (!verifiedWithdrawal(result)) throw new Error("公众号撤回结果无法精确验证。");
      transitionPublication(state, postId, "withdrawn", {
        desiredLocation: "drafts",
        withdrawnAt: timestamp(options.now),
        blockedOperation: null,
        lastError: null,
      });
      persist();
    } catch (error) {
      transitionPublication(state, postId, "withdraw_reconcile", {
        lastError: sanitizedError(error, "公众号撤回结果需要人工核对。"),
      });
      persist();
      if (browserErrorKind(error) === "global") throw error;
    }
  }

  async function publishRecord(postId) {
    const record = state.posts[postId];
    const publication = record.publication;
    const browser = await getAdapter();
    let lookup;
    try {
      lookup = await findPublished(browser, record);
    } catch (error) {
      if (browserErrorKind(error) === "record") {
        transitionPublication(state, postId, "publish_reconcile", {
          blockedOperation: null,
          lastError: sanitizedError(error, "公众号发表状态需要人工核对。"),
        });
        persist();
      } else {
        saveRecordError(postId, "publish", error);
      }
      return;
    }
    if (lookup.kind === "ambiguous") {
      transitionPublication(state, postId, "publish_reconcile", {
        blockedOperation: null,
        lastError: sanitizedError(lookup.error, "公众号发表状态需要人工核对。"),
      });
      persist();
      return;
    }
    if (lookup.kind === "exact") {
      markPublished(
        postId,
        lookup.candidate,
        publication.publishStartedAt ? "automatic" : "manual-detected",
      );
      return;
    }
    if (publication.status === "publish_reconcile") {
      publication.lastError = sanitizedError(
        new Error("未找到可证明结果的发表记录，需要人工核对。"),
        "公众号发表状态需要人工核对。",
      );
      persist();
      return;
    }

    let candidate;
    try {
      candidate = await browser.findDraftCandidate(record);
      if (!exactCandidate(candidate)) throw new Error("草稿候选项无法精确验证。");
      await browser.openDraft(candidate);
    } catch (error) {
      saveRecordError(postId, "publish", error, true);
      return;
    }

    transitionPublication(state, postId, "publishing", {
      publishStartedAt: timestamp(options.now),
      blockedOperation: null,
      lastError: null,
    });
    persist();
    try {
      await browser.publishCurrentDraft(record);
    } catch (error) {
      transitionPublication(state, postId, "publish_reconcile", {
        lastError: sanitizedError(error, "公众号发表结果需要人工核对。"),
      });
      persist();
      if (browserErrorKind(error) === "global") throw error;
      return;
    }

    try {
      const result = await browser.verifyPublished(record);
      const verified = verificationCandidate(result);
      if (!verified) throw new Error("公众号发表结果无法精确验证。");
      markPublished(postId, verified, "automatic");
    } catch (error) {
      transitionPublication(state, postId, "publish_reconcile", {
        lastError: sanitizedError(error, "公众号发表结果需要人工核对。"),
      });
      persist();
      if (browserErrorKind(error) === "global") throw error;
    }
  }

  try {
    for (const [postId, markerValue] of markerEntries) {
      await withdrawRecord(postId, markerValue);
    }

    if (options.autoPublish && arming.armed) {
      const publishIds = Object.keys(state.posts)
        .filter((postId) => {
          const publication = state.posts[postId].publication;
          return publication.desiredLocation === "published"
            && (publication.status === "pending" || publication.status === "publish_reconcile");
        })
        .sort();
      for (const postId of publishIds) await publishRecord(postId);
    }
  } finally {
    if (opened && typeof opened.close === "function") await opened.close();
  }

  return { state, summary: statusSummary(state), browserOpened: Boolean(adapter) };
}

function resolveRecord(options) {
  const load = options.loadState || loadState;
  const save = options.saveState || saveState;
  const state = load(options.stateFile);
  recoverInterruptedOperations(state, timestamp(options.now));
  const record = state.posts[options.postId];
  if (!record) throw new Error(`找不到公众号文章状态：${options.postId}`);
  const publication = record.publication;
  const activeMarkers = activeWithdrawalMarkers(options.root, options.markers);

  if (options.resolution === "published") {
    if (publication.status !== "publish_reconcile") {
      throw new Error("--published 只能解决待核对的发表结果。");
    }
    const url = validatedPublishedUrl(options.url);
    transitionPublication(state, options.postId, "published", {
      ...candidatePatch({ href: url.href }),
      publicationOrigin: publication.publishStartedAt ? "automatic" : "manual-detected",
      publishedAt: publication.publishedAt || timestamp(options.now),
      blockedOperation: null,
      lastError: null,
    });
  } else if (options.resolution === "not-published") {
    if (publication.status !== "publish_reconcile") {
      throw new Error("--not-published 只能解决待核对的发表结果。");
    }
    if (publication.everPublished) {
      throw new Error("已有发表证据的文章不能重置为待发布。");
    }
    const canceled = activeMarkers.has(options.postId);
    if (!canceled && (state.publisher?.baselinePostIds || []).includes(options.postId)) {
      throw new Error("自动发布基线文章不能重置为待发布。");
    }
    publication.status = canceled ? "draft_only" : "pending";
    publication.desiredLocation = canceled ? "drafts" : "published";
    publication.blockedOperation = null;
    publication.lastError = null;
  } else if (options.resolution === "withdrawn") {
    if (publication.status !== "withdraw_reconcile") {
      throw new Error("--withdrawn 只能解决待核对的撤回结果。");
    }
    transitionPublication(state, options.postId, "withdrawn", {
      withdrawnAt: publication.withdrawnAt || timestamp(options.now),
      blockedOperation: null,
      lastError: null,
    });
  } else if (options.resolution === "still-published") {
    if (publication.status !== "withdraw_reconcile") {
      throw new Error("--still-published 只能解决待核对的撤回结果。");
    }
    transitionPublication(state, options.postId, "published", {
      blockedOperation: null,
      lastError: null,
    });
  } else {
    throw new Error("未知的公众号人工解决方式。");
  }
  save(options.stateFile, state);
  return { postId: options.postId, status: state.posts[options.postId].publication.status };
}

module.exports = {
  POST_ID_PATTERN,
  arm,
  publishedPostIds,
  resolveRecord,
  runLifecycle,
  statusSummary,
  validatedPublishedUrl,
};
