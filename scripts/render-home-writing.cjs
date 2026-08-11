const { renderWritingShowcase } = require("./render-writing-showcase.cjs");

function renderHomeWriting(blog) {
  return renderWritingShowcase(blog, { context: "home" });
}

function injectHomeWriting(content, blog) {
  const startMarker = "<!-- HOME_WRITING_CONTENT_START -->";
  const endMarker = "<!-- HOME_WRITING_CONTENT_END -->";
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);

  if (start < 0 || end < 0 || end < start) {
    throw new Error("Homepage Writing markers are missing or out of order.");
  }

  const rendered = renderHomeWriting(blog);
  const injected = `${content.slice(0, start)}${rendered}\n          ${content.slice(end + endMarker.length)}`;

  return injected.replace(
    /href="[^"]*"\s+data-site-href="([^"]+)"/g,
    'href="$1"'
  );
}

module.exports = { injectHomeWriting, renderHomeWriting };
