const CLASSIFIER_CASTS = new Set(["mochi", "molly", "none"]);
const EXPLICIT_CASTS = new Set(CLASSIFIER_CASTS);
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_TIMEOUT_MS = 4_000;

async function classifyWithTimeout(classify, post, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => classify(post)),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function selectNoteCast(post, options = {}) {
  if (EXPLICIT_CASTS.has(post?.cast)) return post.cast;
  if (post?.cast !== "auto" || typeof options.classify !== "function") return "molly";

  const confidenceThreshold = Number.isFinite(options.confidenceThreshold)
    ? options.confidenceThreshold
    : DEFAULT_CONFIDENCE_THRESHOLD;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  try {
    const result = await classifyWithTimeout(options.classify, post, timeoutMs);
    if (
      result
      && CLASSIFIER_CASTS.has(result.cast)
      && typeof result.confidence === "number"
      && Number.isFinite(result.confidence)
      && result.confidence >= confidenceThreshold
    ) {
      return result.cast;
    }
  } catch {
    // Classification is advisory. Publishing retains a stable Molly fallback.
  }
  return "molly";
}

module.exports = {
  DEFAULT_CONFIDENCE_THRESHOLD,
  selectNoteCast,
};
