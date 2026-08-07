const fs = require("node:fs");
const path = require("node:path");

const { STATUSES, emptyPublication } = require("./lifecycle-state.cjs");

function emptyState() {
  return {
    version: 2,
    articleImages: {},
    covers: {},
    posts: {},
    publisher: {
      armedAt: null,
      baselinePostIds: [],
      browserSessionCheckedAt: null,
    },
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
    return [postId, { ...metadata, publication }];
  }));
  const publisher = value.version === 2 && value.publisher && typeof value.publisher === "object"
    ? value.publisher
    : {};
  return {
    version: 2,
    articleImages: value.articleImages || {},
    covers: value.covers || {},
    posts,
    publisher: {
      armedAt: publisher.armedAt ?? null,
      baselinePostIds: Array.isArray(publisher.baselinePostIds)
        ? [...publisher.baselinePostIds]
        : [],
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
