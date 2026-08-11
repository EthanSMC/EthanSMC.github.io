const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadBlog } = require("../prepare-content.cjs");
const { WechatApiError, WechatClient } = require("./client.cjs");
const {
  buildArticle,
  buildNewspic,
  collectPostAssets,
  hashBuffer,
  publicationFingerprint,
} = require("./content.cjs");
const {
  desiredLocation,
  isCanonicalUtcTimestamp,
  loadWithdrawalMarkers,
} = require("./lifecycle-intent.cjs");
const { emptyPublication, publicationForNewPost } = require("./lifecycle-state.cjs");
const { noteRenderInputHash, renderNotePosters } = require("./note-poster.cjs");
const { loadState, saveState } = require("./state.cjs");

const MISSING_DRAFT_ERROR_CODES = new Set([40007]);
const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{6}$/u;
const UNSAFE_NOTE_CACHE_CODE = "unsafe_note_cache_path";

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

function sourceMd5(source) {
  return crypto.createHash("md5").update(source).digest("hex");
}

function preparePost(root, post, config) {
  const sourcePath = path.join(root, "content", "published", post.filename);
  const sourceBytes = fs.readFileSync(sourcePath);
  const source = sourceBytes.toString("utf8");
  const md5 = sourceMd5(sourceBytes);
  if (post.kind === "note") return { source, sourceMd5: md5 };
  const assets = collectPostAssets(root, post);
  const cover = resolveCover(root, assets, config.defaultCover);
  const fingerprint = publicationFingerprint({
    source,
    assets,
    author: config.author,
    siteUrl: config.siteUrl,
    coverHash: cover.hash,
  });
  return { source, sourceMd5: md5, assets, cover, fingerprint };
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

function unsafeNoteCachePath(target) {
  const error = new Error(`Unsafe note cache path: ${target}`);
  error.code = UNSAFE_NOTE_CACHE_CODE;
  return error;
}

function verifiedCacheDirectory(target, create) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!create) return false;
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (mkdirError) {
      if (mkdirError?.code !== "EEXIST") throw mkdirError;
    }
    stat = fs.lstatSync(target);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafeNoteCachePath(target);
  return true;
}

function noteCacheDirectory(root, postId, { create = false } = {}) {
  if (!POST_ID_PATTERN.test(postId)) throw unsafeNoteCachePath(postId);
  const resolvedRoot = path.resolve(root);
  if (!verifiedCacheDirectory(resolvedRoot, false)) throw unsafeNoteCachePath(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of [".wechat-sync", "generated", postId]) {
    current = path.join(current, segment);
    if (!verifiedCacheDirectory(current, create)) return null;
  }
  return current;
}

function backfillArticleMetadata(record, prepared) {
  let changed = false;
  const expected = {
    sourceMd5: prepared.sourceMd5,
    renderHash: prepared.fingerprint,
    draftKind: "news",
  };
  for (const [field, value] of Object.entries(expected)) {
    if (record[field] !== value) {
      record[field] = value;
      changed = true;
    }
  }
  if (!Array.isArray(record.generatedImages) || record.generatedImages.length !== 0) {
    record.generatedImages = [];
    changed = true;
  }
  return changed;
}

function cachedNoteImages(root, postId, previous, expected) {
  if (
    previous?.sourceMd5 !== expected.sourceMd5
    || (expected.renderHash !== undefined && previous?.renderHash !== expected.renderHash)
    || (expected.renderInputHash !== undefined && previous?.renderInputHash !== expected.renderInputHash)
    || !Array.isArray(previous.generatedImages)
    || previous.generatedImages.length < 1
    || previous.generatedImages.length > 4
  ) return null;

  const cacheDir = noteCacheDirectory(root, postId);
  if (!cacheDir) return null;
  let filenames;
  try {
    filenames = fs.readdirSync(cacheDir).sort();
  } catch {
    return null;
  }
  const expectedFilenames = previous.generatedImages.map((image) => image.filename);
  if (new Set(expectedFilenames).size !== expectedFilenames.length || filenames.length !== expectedFilenames.length) return null;
  if (!filenames.every((filename, index) => filename === expectedFilenames[index])) return null;

  for (const image of previous.generatedImages) {
    if (!image.mediaId || !image.hash || !/^page-\d{2}\.png$/u.test(image.filename)) return null;
    const filename = path.join(cacheDir, image.filename);
    let stat;
    try {
      stat = fs.lstatSync(filename);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if (hashBuffer(fs.readFileSync(filename)) !== image.hash) return null;
  }
  return previous.generatedImages;
}

function validatedRenderedFiles(rendered) {
  if (
    !rendered
    || !Array.isArray(rendered.pages)
    || !Array.isArray(rendered.files)
    || rendered.pages.length < 1
    || rendered.pages.length > 4
    || rendered.files.length !== rendered.pages.length
    || typeof rendered.renderHash !== "string"
    || !rendered.renderHash
  ) {
    throw new Error("Note renderer must produce one to four files and a render hash");
  }
  return rendered.files.map((filename) => {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Note renderer output is not a regular file: ${filename}`);
    }
    return filename;
  });
}

function replaceNoteCache(root, postId, files, mediaIds) {
  const cacheDir = noteCacheDirectory(root, postId, { create: true });
  for (const entry of fs.readdirSync(cacheDir)) {
    const target = path.join(cacheDir, entry);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw unsafeNoteCachePath(target);
    fs.unlinkSync(target);
  }
  return files.map((source, index) => {
    const filename = `page-${String(index + 1).padStart(2, "0")}.png`;
    const target = path.join(cacheDir, filename);
    fs.copyFileSync(source, target);
    return {
      filename,
      hash: hashBuffer(fs.readFileSync(target)),
      mediaId: mediaIds[index],
    };
  });
}

function recordNoteFailure({ dryRun, error, logger, post, state, stateFile }) {
  const diagnostic = {
    code: typeof error?.code === "string" ? error.code : "sync_failed",
    message: error instanceof Error ? error.message : "Unknown note sync failure",
    at: new Date().toISOString(),
  };
  if (!dryRun) {
    const previous = state.posts[post.id];
    const publication = { ...(previous?.publication || emptyPublication("manual")) };
    if (
      !publication.everPublished
      && (
        publication.status === "pending"
        || (publication.status === "blocked" && publication.blockedOperation === "publish")
      )
    ) {
      publication.status = "draft_only";
      publication.blockedOperation = null;
    }
    state.posts[post.id] = {
      ...(previous || {}),
      title: previous?.title || post.title,
      draftKind: "newspic",
      syncError: diagnostic,
      publication,
    };
    saveState(stateFile, state);
  }
  logger(`公众号图片草稿同步失败，网站继续发布：${post.title}（${diagnostic.code}）`);
  return { action: "failed", post, error: diagnostic };
}

function disableWechatPost(postId, state, stateFile, dryRun) {
  const publication = state.posts[postId]?.publication;
  if (
    dryRun
    || !publication
    || publication.everPublished
    || !(
      publication.status === "pending"
      || (publication.status === "blocked" && publication.blockedOperation === "publish")
    )
  ) return;
  publication.status = "draft_only";
  publication.blockedOperation = null;
  publication.lastError = null;
  saveState(stateFile, state);
}

function reuseCachedNote({
  cached,
  logger,
  post,
  previous,
  renderCast,
  renderInputHash,
  state,
  stateFile,
}) {
  if (!cached || !previous?.mediaId) return null;
  const restoredPublication = previous.publication?.status === "draft_only"
    && previous.publication.desiredLocation === "published"
    ? publicationForNewPost(state, post.id, new Date().toISOString())
    : null;
  const canRestore = restoredPublication?.status === "pending";
  let changed = false;
  if (previous.renderInputHash !== renderInputHash) {
    previous.renderInputHash = renderInputHash;
    changed = true;
  }
  if (previous.renderCast !== renderCast) {
    previous.renderCast = renderCast;
    changed = true;
  }
  if (previous.syncError) {
    delete previous.syncError;
    changed = true;
  }
  if (previous.sourceDeletedAt) {
    delete previous.sourceDeletedAt;
    changed = true;
  }
  if (canRestore) {
    previous.publication = {
      ...restoredPublication,
      draftFingerprint: previous.renderHash,
    };
    changed = true;
  }
  if (changed) saveState(stateFile, state);
  logger(`${canRestore ? "已恢复公众号待发布状态" : "跳过未变化文章"}：${post.title}`);
  return { action: canRestore ? "restored" : "skipped", post, mediaId: previous.mediaId };
}

async function syncNotePost({
  getClient,
  config,
  dryRun,
  force,
  logger,
  post,
  prepared,
  noteRenderInput,
  renderNote,
  root,
  state,
  stateFile,
}) {
  const previous = state.posts[post.id];
  if (previous?.publication?.everPublished) {
    if (previous.sourceMd5 !== prepared.sourceMd5 && !dryRun) {
      previous.sourceMd5 = prepared.sourceMd5;
      saveState(stateFile, state);
    }
    logger(`公众号已发布一次，本次修改仅更新网站：${post.title}`);
    return { action: "website-only", post, mediaId: previous.mediaId };
  }

  const reusableCast = previous?.sourceMd5 === prepared.sourceMd5
    && ["mochi", "molly", "none"].includes(previous?.renderCast)
    ? previous.renderCast
    : null;
  const renderInput = await noteRenderInput(post, {
    root,
    author: config.author,
    siteUrl: config.siteUrl,
    ...(reusableCast ? { resolvedCast: reusableCast } : {}),
  });
  if (!renderInput?.renderInputHash || !["mochi", "molly", "none"].includes(renderInput.cast)) {
    throw new Error("Note render preflight must produce a render input hash and cast");
  }
  if (!dryRun && !force) {
    const preflightCached = cachedNoteImages(root, post.id, previous, {
      sourceMd5: prepared.sourceMd5,
      renderInputHash: renderInput.renderInputHash,
    });
    const reused = reuseCachedNote({
      cached: preflightCached,
      logger,
      post,
      previous,
      renderCast: renderInput.cast,
      renderInputHash: renderInput.renderInputHash,
      state,
      stateFile,
    });
    if (reused) return reused;
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wechat-note-${post.id}-`));
  try {
    const rendered = await renderNote(post, {
      root,
      outputDir: temporaryRoot,
      author: config.author,
      siteUrl: config.siteUrl,
      resolvedCast: renderInput.cast,
    });
    const files = validatedRenderedFiles(rendered);

    if (!dryRun && !force && previous?.renderInputHash === null) {
      const legacyCached = cachedNoteImages(root, post.id, previous, {
        sourceMd5: prepared.sourceMd5,
        renderHash: rendered.renderHash,
      });
      const reused = reuseCachedNote({
        cached: legacyCached,
        logger,
        post,
        previous,
        renderCast: renderInput.cast,
        renderInputHash: renderInput.renderInputHash,
        state,
        stateFile,
      });
      if (reused) return reused;
    }

    const imageMediaIds = dryRun
      ? files.map((_, index) => `DRY_RUN_NEWS_PIC_${index + 1}`)
      : await Promise.all(files.map((filename) => getClient().uploadNewspicImage(filename)));
    const article = buildNewspic(post, {
      imageMediaIds,
      author: config.author,
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
        await getClient().updateDraft(mediaId, article);
        action = "update";
      } catch (error) {
        if (!isMissingDraft(error)) throw error;
        mediaId = null;
        logger(`原草稿已发布或被删除，重新创建：${article.title}`);
      }
    }
    if (!mediaId) mediaId = await getClient().addDraft(article);

    const generatedImages = replaceNoteCache(root, post.id, files, imageMediaIds);
    const publication = publicationForNewPost(state, post.id, new Date().toISOString());
    if (publication.status === "pending") publication.draftFingerprint = rendered.renderHash;
    const record = {
      ...(previous || {}),
      fingerprint: rendered.renderHash,
      sourceMd5: prepared.sourceMd5,
      renderHash: rendered.renderHash,
      renderInputHash: renderInput.renderInputHash,
      renderCast: renderInput.cast,
      generatedImages,
      draftKind: "newspic",
      mediaId,
      title: article.title,
      sourceUrl: article.content_source_url,
      syncedAt: new Date().toISOString(),
      publication,
    };
    delete record.syncError;
    delete record.sourceDeletedAt;
    state.posts[post.id] = record;
    saveState(stateFile, state);
    logger(`${action === "add" ? "已新增" : "已更新"}公众号草稿：${article.title}`);
    return { action, post, mediaId };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function syncOnePost({ getClient, config, dryRun, force, logger, post, prepared, state, stateFile }) {
  const previous = state.posts[post.id];
  if (previous?.publication?.everPublished) {
    let changed = false;
    if (previous.fingerprint !== prepared.fingerprint) {
      previous.fingerprint = prepared.fingerprint;
      changed = true;
    }
    changed = backfillArticleMetadata(previous, prepared) || changed;
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
    backfillArticleMetadata(previous, prepared);
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
    let changed = false;
    if (!dryRun) changed = backfillArticleMetadata(previous, prepared);
    if (previous.sourceDeletedAt && !dryRun) {
      delete previous.sourceDeletedAt;
      changed = true;
    }
    if (changed) saveState(stateFile, state);
    logger(`跳过未变化文章：${post.title}`);
    return { action: "skipped", post, mediaId: previous.mediaId };
  }

  const client = dryRun ? null : getClient();
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
    sourceMd5: prepared.sourceMd5,
    renderHash: prepared.fingerprint,
    generatedImages: [],
    draftKind: "news",
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
  noteRenderInput = noteRenderInputHash,
  renderNote = renderNotePosters,
  logger = console.log,
}) {
  const blog = loadBlog({
    publishedDir: path.join(root, "content", "published"),
    albumsDir: path.join(root, "content", "albums"),
  });
  for (const post of blog.posts) {
    if (post.kind === "note") noteCacheDirectory(root, post.id);
  }
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
        !isCanonicalUtcTimestamp(record.publication.withdrawRequestedAt)
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

  const preparedPosts = selection.posts.map((post) => ({
    post,
    prepared: post.wechat === false ? null : preparePost(root, post, config),
  }));
  let apiClient = client;
  const getClient = () => {
    if (!apiClient) apiClient = new WechatClient({ appId: config.appId, appSecret: config.appSecret });
    return apiClient;
  };

  const results = [];
  for (const { post, prepared } of preparedPosts) {
    if (post.wechat === false) {
      disableWechatPost(post.id, state, stateFile, dryRun);
      logger(`已关闭公众号同步：${post.title}`);
      results.push({ action: "wechat-disabled", post });
      continue;
    }
    const input = {
      getClient,
      config,
      dryRun,
      force,
      logger,
      post,
      prepared,
      state,
      stateFile,
    };
    if (post.kind === "note") {
      try {
        results.push(await syncNotePost({ ...input, noteRenderInput, renderNote, root }));
      } catch (error) {
        if (error?.code === UNSAFE_NOTE_CACHE_CODE) throw error;
        results.push(recordNoteFailure({ dryRun, error, logger, post, state, stateFile }));
      }
    } else {
      results.push(await syncOnePost(input));
    }
  }
  return { results, deleted: selection.deleted };
}

module.exports = {
  changedPostSelection,
  isMissingDraft,
  preparePost,
  resolveCover,
  sourceMd5,
  syncWechatDrafts,
};
