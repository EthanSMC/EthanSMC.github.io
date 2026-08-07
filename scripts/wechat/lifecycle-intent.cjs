const fs = require("node:fs");
const path = require("node:path");

const POST_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{6}$/;

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" || !value.endsWith("Z")) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function invalidMarker(filename) {
  throw new Error(`撤回标记格式无效：${filename}`);
}

function loadWithdrawalMarkers(root) {
  const directory = path.join(root, "content", ".lifecycle", "withdrawals");
  if (!fs.existsSync(directory)) return new Map();

  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    invalidMarker(path.relative(root, directory));
  }

  const markers = new Map();
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) invalidMarker(entry.name);
    const postId = path.basename(entry.name, ".json");
    if (!POST_ID_PATTERN.test(postId)) invalidMarker(entry.name);

    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
    } catch {
      invalidMarker(entry.name);
    }
    const keys = marker && typeof marker === "object" && !Array.isArray(marker)
      ? Object.keys(marker).sort()
      : [];
    if (
      keys.length !== 2
      || keys[0] !== "postId"
      || keys[1] !== "requestedAt"
      || marker.postId !== postId
      || !isCanonicalUtcTimestamp(marker.requestedAt)
    ) {
      invalidMarker(entry.name);
    }
    markers.set(postId, marker);
  }
  return markers;
}

function desiredLocation(postId, publishedIds, markers, publication = null) {
  if (publishedIds.has(postId)) return "published";
  const marker = markers.get(postId);
  const consumedAt = publication?.withdrawRequestedAt;
  if (
    marker
    && (
      !isCanonicalUtcTimestamp(consumedAt)
      || Date.parse(marker.requestedAt) > Date.parse(consumedAt)
    )
  ) return "drafts";
  return null;
}

module.exports = { desiredLocation, loadWithdrawalMarkers };
