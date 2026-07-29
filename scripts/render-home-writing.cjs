function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLatestEssay(essay, hasNotes) {
  if (!essay) return "";

  const tags = essay.tags
    .map((tag) => `<span>#${escapeHtml(tag.label)}</span>`)
    .join("");
  const onlyClass = hasNotes ? "" : " home-essay--only";

  return `
            <article class="home-essay${onlyClass}">
              <p class="home-writing-kicker">LATEST ESSAY · ${escapeHtml(essay.display)}</p>
              <h3><a href="${escapeHtml(essay.url)}">${escapeHtml(essay.title)}</a></h3>
              <p>${escapeHtml(essay.summary)}</p>
              <div class="home-essay-meta">
                <span>${escapeHtml(essay.readingMinutes)} min read</span>
                ${tags}
              </div>
              <a class="home-writing-link" href="${escapeHtml(essay.url)}">阅读全文 <span aria-hidden="true">→</span></a>
            </article>`;
}

function renderLatestNotes(notes, hasEssay) {
  if (!notes.length) return "";

  const onlyClass = hasEssay ? "" : " home-notes--only";
  const items = notes.map((note) => `
              <article class="home-note">
                <div class="home-note-body">${note.bodyHtml}</div>
                <div class="home-note-meta"><time datetime="${escapeHtml(note.iso)}">${escapeHtml(note.display)}</time><span>Note</span></div>
                <a class="home-writing-link" href="${escapeHtml(note.url)}">永久链接 <span aria-hidden="true">→</span></a>
              </article>`).join("");

  return `
            <div class="home-notes${onlyClass}">${items}
            </div>`;
}

function renderHomeWriting(blog) {
  if (!blog.posts.length) {
    return `
          <div class="home-writing-empty">
            <h3>第一篇还在纸上。</h3>
            <p>从 Obsidian 发布后，最新的 Essay 和 Note 会自动出现在这里。</p>
            <a class="home-writing-link" href="/blog/">进入 Writing <span aria-hidden="true">→</span></a>
          </div>`;
  }

  const essay = renderLatestEssay(blog.latestEssay, blog.latestNotes.length > 0);
  const notes = renderLatestNotes(blog.latestNotes, Boolean(blog.latestEssay));
  return `${essay}${notes}`;
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
