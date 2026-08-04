const fs = require("node:fs");
const path = require("node:path");

function emptyState() {
  return { version: 1, articleImages: {}, covers: {}, posts: {} };
}

function normalizeState(value) {
  if (!value || value.version !== 1) return emptyState();
  return {
    version: 1,
    articleImages: value.articleImages || {},
    covers: value.covers || {},
    posts: value.posts || {},
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
