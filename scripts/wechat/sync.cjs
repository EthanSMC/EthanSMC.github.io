const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadBlog } = require("../prepare-content.cjs");
const { WechatApiError, WechatClient } = require("./client.cjs");
const {
  buildArticle,
  collectPostAssets,
  hashBuffer,
  publicationFingerprint,
} = require("./content.cjs");
const { desiredLocation, loadWithdrawalMarkers } = require("./lifecycle-intent.cjs");
const { publicationForNewPost } = require("./lifecycle-state.cjs");
const { loadState, saveState } = require("./state.cjs");

const MISSING_DRAFT_ERROR_CODES = new Set([40007]);

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function nullSeparatedPaths(value) {
  return value.split("\0").filter(Boolean);
}

function changedPostSelection(root, posts, range) {
  if (!range) return { posts, deleted: [] };
  const changed = new Set(nullSeparatedPaths(runGit(root, [
    "diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", range, "--", "content/published", "content/assets",
  ])));
  const deleted = nullSeparatedPaths(runGit(root, [
    "diff", "--name-only", "-z", "--diff-filter=D", range, "--", "content/published",
  ])).filter((filename) => filename.endsWith(".md"));

  const changedMarkdown = new Set(
    [...changed]
      .filter((filename) => filename.startsWith("content/published/") && filename.endsWith(".md"))
      .map((filename) => path.posix.basename(filename)),
  );
  const changedAssets = new Set(
    [...changed]
      .filter((filename) => filename.startsWith("content/assets/"))
      .map((filename) => filename.slice("content/assets/".length)),
  );
  return {
    posts: posts.filter((post) => (
      changedMarkdown.has(post.filename)
      || post.attachments.some((attachment) => changedAssets.has(attachment))
    )),
    deleted,
  };
}

function resolveCover(root, assets, configuredCover) {
  if (assets.length > 0 && !configuredCover) return assets[0];
  const absolutePath = path.resolve(root, configuredCover || "assets/share-card-writing.png");
  const data = fs.readFileSync(absolutePath);
  return {
    relative: path.relative(root, absolutePath),
    absolutePath,
    data,
    hash: hashBuffer(data),
  };
}

function preparePost(root, post, config) {
  const sourcePath = path.join(root, "content", "published", post.filename);
  const source = fs.readFileSync(sourcePath, "utf8");
  const assets = collectPostAssets(root, post);
  const cover = resolveCover(root, assets, config.defaultCover);
  const fingerprint = publicationFingerprint({
    source,
    assets,
    author: config.author,
    siteUrl: config.siteUrl,
    coverHash: cover.hash,
  });
  return { source, assets, cover, fingerprint };
}

async function uploadedArticleImages(client, state, stateFile, assets, dryRun) {
  const urls = new Map();
  for (const asset of assets) {
    const cached = state.articleImages[asset.hash];
    if (cached?.url) {
      urls.set(asset.relative, cached.url);
      continue;
    }
    if (dryRun) {
      urls.set(asset.relative, `https://mmbiz.qpic.cn/dry-run/${asset.hash}`);
      continue;
    }
    const url = await client.uploadArticleImage(asset.absolutePath);
    state.articleImages[asset.hash] = {
      url,
      source: asset.relative,
      uploadedAt: new Date().toISOString(),
    };
    saveState(stateFile, state);
    urls.set(asset.relative, url);
  }
  return urls;
}

async function uploadedCover(client, state, stateFile, cover, dryRun) {
  const cached = state.covers[cover.hash];
  if (cached?.mediaId) return cached.mediaId;
  if (dryRun) return `DRY_RUN_COVER_${cover.hash.slice(0, 16)}`;
  const mediaId = await client.uploadPermanentImage(cover.absolutePath);
  state.covers[cover.hash] = {
    mediaId,
    source: cover.relative,
    uploadedAt: new Date().toISOString(),
  };
  saveState(stateFile, state);
  return mediaId;
}

function isMissingDraft(error) {
  return error instanceof WechatApiError && MISSING_DRAFT_ERROR_CODES.has(error.code);
}

async function syncOnePost({ client, config, dryRun, force, logger, post, prepared, state, stateFile }) {
  const previous = state.posts[post.id];
  if (previous?.publication?.everPublished) {
    let changed = false;
    if (previous.fingerprint !== prepared.fingerprint) {
      previous.fingerprint = prepared.fingerprint;
      changed = true;
    }
    if (changed && !dryRun) saveState(stateFile, state);
    logger(`公众号已发布一次，本次修改仅更新网站：${post.title}`);
    return { action: "website-only", post, mediaId: previous.mediaId };
  }
  const restoredPublication = previous?.publication?.status === "draft_only"
    && previous.publication.desiredLocation === "published"
    ? publicationForNewPost(state, post.id, new Date().toISOString())
    : null;
  const canRestore = restoredPublication?.status === "pending";
  if (!dryRun && !force && previous?.fingerprint === prepared.fingerprint && canRestore && previous.mediaId) {
    previous.publication = {
      ...restoredPublication,
      draftFingerprint: prepared.fingerprint,
    };
    delete previous.sourceDeletedAt;
    saveState(stateFile, state);
    logger(`已恢复公众号待发布状态：${post.title}`);
    return { action: "restored", post, mediaId: previous.mediaId };
  }
  if (
    !force
    && previous?.fingerprint === prepared.fingerprint
    && !(canRestore && !previous.mediaId)
  ) {
    if (previous.sourceDeletedAt && !dryRun) {
      delete previous.sourceDeletedAt;
      saveState(stateFile, state);
    }
    logger(`跳过未变化文章：${post.title}`);
    return { action: "skipped", post, mediaId: previous.mediaId };
  }

  const imageUrls = await uploadedArticleImages(client, state, stateFile, prepared.assets, dryRun);
  const coverMediaId = await uploadedCover(client, state, stateFile, prepared.cover, dryRun);
  const article = buildArticle(post, {
    author: config.author,
    coverMediaId,
    imageUrls,
    siteUrl: config.siteUrl,
  });

  if (dryRun) {
    const action = previous?.mediaId ? "update" : "add";
    logger(`[dry-run] ${action === "add" ? "新增" : "更新"}草稿：${article.title}`);
    return { action: `dry-run-${action}`, post, article };
  }

  let action = "add";
  let mediaId = previous?.mediaId;
  if (mediaId) {
    try {
      await client.updateDraft(mediaId, article);
      action = "update";
    } catch (error) {
      if (!isMissingDraft(error)) throw error;
      mediaId = null;
      logger(`原草稿已发布或被删除，重新创建：${article.title}`);
    }
  }
  if (!mediaId) mediaId = await client.addDraft(article);

  const publication = publicationForNewPost(state, post.id, new Date().toISOString());
  if (publication.status === "pending") {
    publication.draftFingerprint = prepared.fingerprint;
  }
  const record = {
    ...(previous || {}),
    fingerprint: prepared.fingerprint,
    mediaId,
    title: article.title,
    sourceUrl: article.content_source_url,
    syncedAt: new Date().toISOString(),
    publication,
  };
  delete record.sourceDeletedAt;
  state.posts[post.id] = record;
  saveState(stateFile, state);
  logger(`${action === "add" ? "已新增" : "已更新"}公众号草稿：${article.title}`);
  return { action, post, mediaId };
}

async function syncWechatDrafts({
  root,
  range = null,
  dryRun = false,
  force = false,
  config,
  client = null,
  logger = console.log,
}) {
  const blog = loadBlog({ publishedDir: path.join(root, "content", "published") });
  const publishedIds = new Set(blog.posts.map((post) => post.id));
  const markers = loadWithdrawalMarkers(root);
  const stateFile = config.stateFile || path.join(root, ".wechat-sync", "state.json");
  const state = loadState(stateFile);
  let stateChanged = false;
  for (const [postId, record] of Object.entries(state.posts)) {
    const location = desiredLocation(postId, publishedIds, markers, record.publication);
    if (!location) continue;
    const marker = markers.get(postId);
    if (record.publication.desiredLocation !== location) {
      record.publication.desiredLocation = location;
      stateChanged = true;
    }
    if (
      location === "published"
      && marker
      && (
        !Number.isFinite(Date.parse(record.publication.withdrawRequestedAt || ""))
        || Date.parse(marker.requestedAt) > Date.parse(record.publication.withdrawRequestedAt)
      )
    ) {
      record.publication.withdrawRequestedAt = marker.requestedAt;
      stateChanged = true;
    }
    if (
      location === "drafts"
      && record.publication.withdrawRequestedAt !== marker.requestedAt
    ) {
      record.publication.withdrawRequestedAt = marker.requestedAt;
      stateChanged = true;
    }
    if (
      location === "drafts"
      && (
        record.publication.status === "pending"
        || record.publication.blockedOperation === "publish"
      )
      && record.publication.status !== "draft_only"
    ) {
      record.publication.status = "draft_only";
      stateChanged = true;
    }
  }
  if (stateChanged && !dryRun) saveState(stateFile, state);
  let selection;
  try {
    selection = changedPostSelection(root, blog.posts, range);
  } catch (error) {
    if (!range) throw error;
    logger(`无法计算提交差异，将按全部文章检查：${error.message}`);
    selection = { posts: blog.posts, deleted: [] };
  }
  for (const filename of selection.deleted) {
    logger(`文章已从网站撤下，公众号仍需人工处理：${filename}`);
  }
  const currentPostIds = publishedIds;
  stateChanged = false;
  for (const [postId, record] of Object.entries(state.posts)) {
    if (currentPostIds.has(postId) || record.sourceDeletedAt) continue;
    record.sourceDeletedAt = new Date().toISOString();
    stateChanged = true;
    logger(`文章已从网站撤下，公众号仍需人工处理：${record.title || postId}`);
  }
  if (stateChanged && !dryRun) saveState(stateFile, state);
  if (selection.posts.length === 0) {
    logger("本次提交没有需要同步的公众号文章。");
    return { results: [], deleted: selection.deleted };
  }

  const preparedPosts = selection.posts.map((post) => ({ post, prepared: preparePost(root, post, config) }));
  const needsNetwork = preparedPosts.some(({ post, prepared }) => (
    !state.posts[post.id]?.publication?.everPublished
    && (
      force
      || state.posts[post.id]?.fingerprint !== prepared.fingerprint
      || (
        state.posts[post.id]?.publication?.status === "draft_only"
        && state.posts[post.id]?.publication?.desiredLocation === "published"
        && !state.posts[post.id]?.mediaId
        && publicationForNewPost(state, post.id, new Date().toISOString()).status === "pending"
      )
    )
  ));
  const apiClient = client || (
    needsNetwork && !dryRun
      ? new WechatClient({ appId: config.appId, appSecret: config.appSecret })
      : null
  );

  const results = [];
  for (const { post, prepared } of preparedPosts) {
    results.push(await syncOnePost({
      client: apiClient,
      config,
      dryRun,
      force,
      logger,
      post,
      prepared,
      state,
      stateFile,
    }));
  }
  return { results, deleted: selection.deleted };
}

module.exports = {
  changedPostSelection,
  isMissingDraft,
  preparePost,
  resolveCover,
  syncWechatDrafts,
};
