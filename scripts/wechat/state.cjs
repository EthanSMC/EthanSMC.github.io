const fs = require("node:fs");
const path = require("node:path");

const { STATUSES, emptyPublication } = require("./lifecycle-state.cjs");

const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{6}$/;

function normalizedBaseline(publisher) {
  const baselinePostIds = Array.isArray(publisher.baselinePostIds)
    ? [...publisher.baselinePostIds]
    : [];
  const valid = publisher.baselineCaptured === true
    && baselinePostIds.every((postId) => typeof postId === "string" && POST_ID_PATTERN.test(postId))
    && new Set(baselinePostIds).size === baselinePostIds.length;
  return {
    baselineCaptured: valid,
    baselinePostIds: valid ? baselinePostIds : [],
  };
}

function emptyState() {
  return {
    version: 2,
    articleImages: {},
    covers: {},
    posts: {},
    publisher: {
      armedAt: null,
      baselineCaptured: false,
      baselinePostIds: [],
      browserSessionCheckedAt: null,
    },
  };
}

function normalizedGeneratedImages(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((image) => (
    image
    && typeof image === "object"
    && !Array.isArray(image)
    && /^page-0[1-4]\.png$/u.test(image.filename)
    && typeof image.hash === "string"
    && image.hash.length > 0
    && typeof image.mediaId === "string"
    && image.mediaId.length > 0
  )).map(({ filename, hash, mediaId }) => ({ filename, hash, mediaId }));
}

function normalizedPostMetadata(metadata) {
  const md5 = typeof metadata.sourceMd5 === "string" && /^[a-f\d]{32}$/iu.test(metadata.sourceMd5)
    ? metadata.sourceMd5.toLowerCase()
    : null;
  return {
    ...metadata,
    sourceMd5: md5,
    renderHash: typeof metadata.renderHash === "string" && metadata.renderHash
      ? metadata.renderHash
      : null,
    generatedImages: normalizedGeneratedImages(metadata.generatedImages),
    draftKind: metadata.draftKind === "newspic" ? "newspic" : "news",
  };
}

function normalizeState(value) {
  if (!value || (value.version !== 1 && value.version !== 2)) return emptyState();
  const posts = Object.fromEntries(Object.entries(value.posts || {}).map(([postId, record]) => {
    const metadata = record && typeof record === "object" && !Array.isArray(record) ? record : {};
    let publication = emptyPublication("manual");
    if (value.version === 2 && metadata.publication && typeof metadata.publication === "object") {
      const source = metadata.publication;
      publication = emptyPublication(STATUSES.has(source.status) ? source.status : "manual");
      for (const field of Object.keys(publication)) {
        if (field !== "status" && Object.hasOwn(source, field)) publication[field] = source[field];
      }
    }
    return [postId, { ...normalizedPostMetadata(metadata), publication }];
  }));
  const publisher = value.version === 2 && value.publisher && typeof value.publisher === "object"
    ? value.publisher
    : {};
  const baseline = normalizedBaseline(publisher);
  return {
    version: 2,
    articleImages: value.articleImages || {},
    covers: value.covers || {},
    posts,
    publisher: {
      armedAt: publisher.armedAt ?? null,
      baselineCaptured: baseline.baselineCaptured,
      baselinePostIds: baseline.baselinePostIds,
      browserSessionCheckedAt: publisher.browserSessionCheckedAt ?? null,
    },
  };
}

function loadState(filename) {
  if (!fs.existsSync(filename)) return emptyState();
  return normalizeState(JSON.parse(fs.readFileSync(filename, "utf8")));
}

function saveState(filename, state) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalizeState(state), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filename);
}

module.exports = { emptyState, loadState, normalizeState, saveState };
