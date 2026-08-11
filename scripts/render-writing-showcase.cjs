const HOME_ARTICLE_LIMIT = 3;
const HOME_NOTE_LIMIT = 3;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function authored(value = "") {
  const escaped = escapeHtml(value);
  return `<span data-i18n-authored="${escaped}">${escaped}</span>`;
}

function normalizeBlog(blog = {}) {
  const posts = Array.isArray(blog.posts) ? blog.posts : [];
  return {
    albums: Array.isArray(blog.albums) ? blog.albums : [],
    independentArticles: Array.isArray(blog.independentArticles)
      ? blog.independentArticles
      : posts.filter((post) => (
        (post.kind === "article" || (!post.kind && post.type === "Essay"))
        && !post.albumSlug
      )),
    smallTalks: Array.isArray(blog.smallTalks)
      ? blog.smallTalks
      : posts.filter((post) => post.kind === "note" || (!post.kind && post.type === "Note")),
  };
}

function albumOrder(album) {
  return Number.isFinite(album?.order) ? album.order : Number.POSITIVE_INFINITY;
}

function activeAlbumIndex(albums) {
  const featuredIndex = albums.findIndex((album) => album.featured);
  if (featuredIndex >= 0) return featuredIndex;
  if (!albums.length) return -1;
  return albums.reduce((selected, album, index) => (
    albumOrder(album) < albumOrder(albums[selected]) ? index : selected
  ), 0);
}

function renderAlbumTrack(track) {
  return `
                  <li>
                    <a href="${escapeHtml(track.url)}">
                      <span class="album-track__number">${escapeHtml(track.track ?? "")}</span>
                      ${authored(track.title)}
                    </a>
                  </li>`;
}

function renderAlbumSlide(album, index, selectedIndex) {
  const isSelected = index === selectedIndex;
  const title = album.basename || album.title || album.slug || "";
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];
  const cover = album.cover
    ? `<img src="${escapeHtml(album.cover)}" alt="${escapeHtml(album.coverAlt || title)}" loading="${isSelected ? "eager" : "lazy"}" decoding="async" />`
    : `<span class="album-cover__monogram" aria-hidden="true">${escapeHtml(Array.from(title)[0] || "✦")}</span>`;
  const trackList = tracks.length
    ? `<ol class="album-track-list">${tracks.map(renderAlbumTrack).join("")}
                </ol>`
    : `<p class="album-slide__empty" data-i18n="writing.albumTracksEmpty">文章正在装订中。</p>`;
  const albumTitle = album.url
    ? `<a href="${escapeHtml(album.url)}">${authored(title)}</a>`
    : authored(title);

  return `
            <article class="album-slide" data-album-slide="${escapeHtml(album.slug)}" aria-current="${isSelected}" tabindex="${isSelected ? "0" : "-1"}" style="--album-offset: ${index - selectedIndex}; --album-depth: ${Math.abs(index - selectedIndex)};" data-album-title="${escapeHtml(title)}"${isSelected ? "" : " inert"}>
              <div class="album-cover" data-album-cast="${escapeHtml(album.coverCast || "auto")}">${cover}</div>
              <div class="album-slide__copy">
                <h3>${albumTitle}</h3>
                ${album.description ? `<p class="album-slide__description">${authored(album.description)}</p>` : ""}
                ${trackList}
              </div>
            </article>`;
}

function renderAlbumRail(albums) {
  const selectedIndex = activeAlbumIndex(albums);
  const selectedTitle = selectedIndex >= 0
    ? albums[selectedIndex].basename || albums[selectedIndex].title || albums[selectedIndex].slug || ""
    : "";
  const slides = albums.length
    ? albums.map((album, index) => renderAlbumSlide(album, index, selectedIndex)).join("")
    : `<div class="writing-region-empty writing-region-empty--albums" data-album-empty>
              <p data-i18n="writing.albumsEmpty">专辑正在装订中。</p>
            </div>`;

  return `
      <section class="writing-region writing-albums" aria-labelledby="writing-albums-title">
        <div class="writing-region__heading">
          <h2 id="writing-albums-title" data-i18n="writing.albums">专辑</h2>
        </div>
        <div class="album-carousel" data-album-carousel tabindex="-1" aria-roledescription="carousel" aria-labelledby="writing-albums-title">
          <div class="album-stage">${slides}
          </div>
          <div class="album-carousel__controls">
            <button type="button" data-album-prev aria-label="上一本专辑" data-i18n-aria-label="writing.albumPrevious"${albums.length < 2 ? " disabled" : ""}><span aria-hidden="true">←</span></button>
            <p data-album-status aria-live="polite" aria-atomic="true">${albums.length ? `${selectedIndex + 1} / ${albums.length} · ${escapeHtml(selectedTitle)}` : "0 / 0"}</p>
            <button type="button" data-album-next aria-label="下一本专辑" data-i18n-aria-label="writing.albumNext"${albums.length < 2 ? " disabled" : ""}><span aria-hidden="true">→</span></button>
          </div>
        </div>
      </section>`;
}

function renderArticle(post) {
  const tags = Array.isArray(post.tags) ? post.tags : [];
  return `
          <article class="independent-card">
            <p class="writing-card__meta"><time datetime="${escapeHtml(post.iso)}">${escapeHtml(post.display)}</time>${post.readingMinutes ? ` · <span data-reading-minutes="${escapeHtml(post.readingMinutes)}">${escapeHtml(post.readingMinutes)} 分钟阅读</span>` : ""}</p>
            <h3><a href="${escapeHtml(post.url)}">${authored(post.title)}</a></h3>
            ${post.summary ? `<p class="independent-card__summary">${authored(post.summary)}</p>` : ""}
            ${tags.length ? `<div class="writing-card__tags">${tags.map((tag) => `<span>#${authored(tag.label)}</span>`).join("")}</div>` : ""}
          </article>`;
}

function renderIndependentArticles(articles, context) {
  const visible = context === "home" ? articles.slice(0, HOME_ARTICLE_LIMIT) : articles;
  const content = visible.length
    ? `<div class="independent-list">${visible.map(renderArticle).join("")}
        </div>`
    : `<div class="writing-region-empty"><p data-i18n="writing.independentEmpty">独立文章还在纸上。</p></div>`;

  return `
      <section class="writing-region writing-independent" aria-labelledby="writing-independent-title">
        <div class="writing-region__heading">
          <h2 id="writing-independent-title" data-i18n="writing.independent">独立文章</h2>
        </div>
        ${content}
      </section>`;
}

function renderSmallTalk(note) {
  return `
          <article class="small-talk-card">
            <p>${authored(note.summary || note.title)}</p>
            <footer><time datetime="${escapeHtml(note.iso)}">${escapeHtml(note.display)}</time><a href="${escapeHtml(note.url)}" aria-label="${escapeHtml(note.title)}"><span aria-hidden="true">↗</span></a></footer>
          </article>`;
}

function renderSmallTalks(notes, context) {
  const visible = context === "home" ? notes.slice(0, HOME_NOTE_LIMIT) : notes;
  const content = visible.length
    ? `<div class="small-talk-list">${visible.map(renderSmallTalk).join("")}
        </div>`
    : `<div class="writing-region-empty"><p data-i18n="writing.smallTalksEmpty">碎碎念还没落到纸上。</p></div>`;

  return `
      <section class="writing-region writing-small-talks" aria-labelledby="writing-small-talks-title">
        <div class="writing-region__heading">
          <h2 id="writing-small-talks-title" data-i18n="writing.smallTalks">碎碎念</h2>
        </div>
        ${content}
      </section>`;
}

function renderWritingShowcase(blog, options = {}) {
  const context = options.context === "index" ? "index" : "home";
  const { albums, independentArticles, smallTalks } = normalizeBlog(blog);
  return `<div class="writing-showcase writing-showcase--${context}">
    <div class="writing-showcase__main">${renderAlbumRail(albums)}${renderIndependentArticles(independentArticles, context)}
    </div>${renderSmallTalks(smallTalks, context)}
  </div>`;
}

module.exports = { renderWritingShowcase };
