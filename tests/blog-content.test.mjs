import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Eleventy from "@11ty/eleventy";
import configureEleventy from "../eleventy.config.mjs";

const require = createRequire(import.meta.url);
const { cleanSourceAndExtractTags, loadBlog, parsePost, parseTimestamp } = require("../scripts/prepare-content.cjs");
const { parseFrontmatter } = require("../scripts/content/frontmatter.cjs");
const { injectHomeWriting } = require("../scripts/render-home-writing.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITING_SHOWCASE_RENDERER = path.join(ROOT, "scripts", "render-writing-showcase.cjs");

function renderWritingShowcase(...args) {
  if (!fs.existsSync(WRITING_SHOWCASE_RENDERER)) return "";
  return require(WRITING_SHOWCASE_RENDERER).renderWritingShowcase(...args);
}

function contentFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ethan-writing-content-"));
  const publishedDir = path.join(root, "published");
  const albumsDir = path.join(root, "albums");
  const assetsDir = path.join(root, "assets");
  fs.mkdirSync(publishedDir);
  fs.mkdirSync(albumsDir);
  fs.mkdirSync(assetsDir);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { albumsDir, assetsDir, publishedDir, root };
}

function writeMarkdown(directory, filename, source) {
  fs.writeFileSync(path.join(directory, filename), source, "utf8");
}

class CarouselTestElement {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.disabled = false;
    this.listeners = new Map();
    this.styleValues = new Map();
    this.style = {
      setProperty: (name, value) => this.styleValues.set(name, String(value)),
      getPropertyValue: (name) => this.styleValues.get(name) || "",
    };
    this.inert = false;
    this.tabIndex = Number(attributes.tabindex ?? -1);
    this.textContent = "";
    this.focused = false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type, values = {}) {
    const event = {
      button: 0,
      pointerId: 1,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
      currentTarget: this,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  focus() { this.focused = true; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setPointerCapture() {}
}

function createCarouselFixture({ active = 0, albumQuery = "" } = {}) {
  const labels = ["First album", "Second album", "Third album"];
  const slides = labels.map((label, index) => new CarouselTestElement({
    "aria-current": String(index === active),
    "data-album-slide": ["first", "second", "third"][index],
    "data-album-title": label,
    tabindex: index === active ? "0" : "-1",
  }));
  const previous = new CarouselTestElement();
  const next = new CarouselTestElement();
  const status = new CarouselTestElement();
  status.textContent = `${active + 1} / 3 · ${labels[active]}`;
  const location = { href: `https://example.com/blog/?lang=en${albumQuery}` };
  const historyCalls = [];
  const view = {
    history: {
      state: { fixture: true },
      replaceState(state, title, url) {
        historyCalls.push({ state, title, url });
        location.href = new URL(url, location.href).href;
      },
    },
    location,
    siteI18n: {
      t(key, values) {
        if (key !== "writing.albumStatus") return key;
        return `Album ${values.current} of ${values.total}: ${values.title}`;
      },
    },
  };
  const root = new CarouselTestElement();
  root.ownerDocument = { defaultView: view };
  root.querySelectorAll = (selector) => selector === "[data-album-slide]" ? slides : [];
  root.querySelector = (selector) => ({
    "[data-album-prev]": previous,
    "[data-album-next]": next,
    "[data-album-status]": status,
  }[selector] || null);
  return { historyCalls, next, previous, root, slides, status, view };
}

function loadCarouselModule() {
  const carouselPath = path.join(ROOT, "writing-carousel.js");
  return fs.existsSync(carouselPath) ? require(carouselPath) : { createAlbumCarousel() {} };
}

test("keeps internal Markdown outside Eleventy's public build graph", () => {
  const ignores = [];
  const passthrough = [];
  const config = {
    ignores: { add: (value) => ignores.push(value) },
    addPassthroughCopy: (value) => passthrough.push(value),
    addWatchTarget: () => {},
    addFilter: () => {},
    addTransform: () => {},
    on: () => {},
  };

  const result = configureEleventy(config);

  assert.deepEqual(result.templateFormats, ["html", "njk"]);
  assert.ok(ignores.includes("PRODUCT.md"));
  assert.ok(ignores.includes(".impeccable/**"));
  assert.ok(ignores.includes("assets/**/*.md"));
  assert.ok(passthrough.includes("assets/digital-ethan/*.png"));
  assert.ok(passthrough.includes("writing-carousel.js"));
  assert.ok(!passthrough.includes("assets/digital-ethan"));
});

test("derives title, stable URL, tags, type and summary without YAML", () => {
  const post = parsePost({
    filename: "2026-07-28-084201.md",
    source: `# 当执行越来越便宜，判断力还剩下什么？

#AI #产品 #essay

最近我越来越强烈地感受到，方案正在变便宜。

## 答案变多以后

真正稀缺的是判断。`
  });

  assert.equal(post.title, "当执行越来越便宜，判断力还剩下什么？");
  assert.equal(post.type, "Essay");
  assert.equal(post.url, "/blog/2026/07/28/084201/");
  assert.deepEqual(post.tags.map((tag) => tag.label), ["AI", "产品"]);
  assert.equal(post.summary, "最近我越来越强烈地感受到，方案正在变便宜。");
  assert.equal(post.kind, "article");
  assert.equal(post.wechat, true);
  assert.equal(post.cast, "auto");
  assert.equal(post.albumSlug, null);
  assert.equal(post.track, null);
  assert.doesNotMatch(post.bodyHtml, /#essay|#AI/);
});

test("parses strict frontmatter scalars and preserves body bytes", () => {
  const source = [
    "---",
    "kind: note",
    "wechat: false",
    "cast: mochi",
    "priority: 3",
    "topics: [产品, \"AI systems\", true, 7]",
    "---",
    "",
    "正文\r",
    "末行",
  ].join("\n");

  const result = parseFrontmatter(source, "2026-08-11-120000.md");

  assert.equal(result.hasFrontmatter, true);
  assert.deepEqual(result.attributes, {
    kind: "note",
    wechat: false,
    cast: "mochi",
    priority: 3,
    topics: ["产品", "AI systems", true, 7],
  });
  assert.equal(result.bodySource, "\n正文\r\n末行");

  const post = parsePost({
    filename: "2026-08-11-120000.md",
    source: "---\nkind: note\nwechat: false\ncast: mochi\n---\n正文",
  });
  assert.equal(post.kind, "note");
  assert.equal(post.type, "Note");
  assert.equal(post.wechat, false);
  assert.equal(post.cast, "mochi");
  assert.equal(post.bodySource, "正文");
  assert.doesNotMatch(post.bodyHtml, /kind: note|wechat: false|cast: mochi/);
});

test("leaves sources without frontmatter byte-for-byte unchanged", () => {
  const source = "# 旧文章\r\n\r\n正文。";
  assert.deepEqual(parseFrontmatter(source, "legacy.md"), {
    attributes: {},
    bodySource: source,
    hasFrontmatter: false,
  });
});

test("rejects malformed strict frontmatter with the source filename", () => {
  const invalidSources = [
    "---\nkind: note\nkind: article\n---\n正文",
    "---\nmetadata:\n  owner: Ethan\n---\n正文",
    "---\ndescription: |\n  多行描述\n---\n正文",
    "---\nwechat: [false]\n---\n正文",
    "---\ntrack: first\n---\n正文",
    "---\nkind: note\n正文",
  ];

  for (const source of invalidSources) {
    assert.throws(
      () => parseFrontmatter(source, "broken-frontmatter.md"),
      /broken-frontmatter\.md/,
      source,
    );
  }
});

test("rejects unsupported authored kinds and casts", () => {
  assert.throws(
    () => parsePost({
      filename: "2026-08-11-120001.md",
      source: "---\nkind: memo\n---\n正文",
    }),
    /kind.*2026-08-11-120001\.md/i,
  );
  assert.throws(
    () => parsePost({
      filename: "2026-08-11-120002.md",
      source: "---\nkind: note\ncast: snoopy\n---\n正文",
    }),
    /cast.*2026-08-11-120002\.md/i,
  );
});

test("rejects an explicitly empty authored kind", () => {
  assert.throws(
    () => parsePost({
      filename: "2026-08-11-120020.md",
      source: '---\nkind: ""\n---\n正文',
    }),
    /kind.*2026-08-11-120020\.md/i,
  );
});

test("rejects an explicitly empty album cover_cast", (t) => {
  const { albumsDir, publishedDir } = contentFixture(t);
  writeMarkdown(
    albumsDir,
    "空角色.md",
    '---\nkind: album\nslug: empty-cast\ncover_cast: ""\n---\n# 空角色',
  );

  assert.throws(
    () => loadBlog({ publishedDir, albumsDir }),
    /cover_cast.*空角色\.md/i,
  );
});

test("loads albums by stable basename and derives routed post collections", (t) => {
  const { albumsDir, publishedDir } = contentFixture(t);
  writeMarkdown(albumsDir, "内容系统.md", `---
kind: album
slug: content-system
order: 2
featured: true
description: "一套内容系统"
---
# 内容系统`);
  writeMarkdown(albumsDir, "产品判断.md", `---
kind: album
slug: product-judgment
order: 1
---
# 产品判断`);

  for (const [filename, track] of [
    ["2026-08-11-120003.md", 3],
    ["2026-08-11-120004.md", 1],
    ["2026-08-11-120005.md", 2],
  ]) {
    writeMarkdown(publishedDir, filename, `---
kind: article
album: "[[内容系统]]"
track: ${track}
---
# 专辑文章 ${track}

正文。`);
  }
  writeMarkdown(publishedDir, "2026-08-11-120006.md", `---
kind: article
---
# 独立文章

正文。`);
  writeMarkdown(publishedDir, "2026-08-11-120007.md", `---
kind: note
wechat: false
cast: molly
---
一则碎碎念。`);

  const blog = loadBlog({ publishedDir, albumsDir });
  const album = blog.albums.find((item) => item.slug === "content-system");
  const independent = blog.independentArticles[0];

  assert.deepEqual(blog.albums.map((item) => item.slug), [
    "product-judgment",
    "content-system",
  ]);
  assert.deepEqual(album.tracks.map((post) => post.track), [1, 2, 3]);
  assert.ok(album.tracks.every((post) => post.albumSlug === "content-system"));
  assert.equal(independent.title, "独立文章");
  assert.equal(independent.kind, "article");
  assert.equal(independent.albumSlug, null);
  assert.deepEqual(blog.smallTalks.map((post) => post.title), ["一则碎碎念。"]);
  assert.equal(blog.smallTalks[0].wechat, false);
  assert.equal(blog.smallTalks[0].cast, "molly");
  assert.equal(blog.posts.length, 5);
  assert.equal(blog.latestEssay.kind, "article");
  assert.equal(blog.latestNotes[0].kind, "note");
});

test("publishes a validated album cover at a stable album URL", (t) => {
  const { albumsDir, assetsDir, publishedDir } = contentFixture(t);
  const coverDirectory = path.join(assetsDir, "albums", "ai-native-content-system");
  fs.mkdirSync(coverDirectory, { recursive: true });
  fs.writeFileSync(path.join(coverDirectory, "cover.png"), "static cover fixture\n");
  writeMarkdown(albumsDir, "AI原生个人内容系统.md", `---
kind: album
slug: ai-native-content-system
status: ongoing
featured: true
order: 1
cover: "[[assets/albums/ai-native-content-system/cover.png]]"
cover_alt: AI 原生个人内容系统专辑封面
cover_cast: mochi
description: 从 Obsidian 出发搭建内容系统。
---
# AI 原生个人内容系统`);

  const blog = loadBlog({ publishedDir, albumsDir });
  const [album] = blog.albums;

  assert.equal(album.url, "/blog/albums/ai-native-content-system/");
  assert.equal(album.outputPath, "blog/albums/ai-native-content-system/index.html");
  assert.equal(album.cover, "/blog/assets/albums/ai-native-content-system/cover.png");
  assert.equal(album.coverAlt, "AI 原生个人内容系统专辑封面");
  assert.equal(album.status, "ongoing");
  assert.ok(blog.attachments.includes("albums/ai-native-content-system/cover.png"));
});

test("rejects album covers that are malformed, missing, or leave content assets", (t) => {
  const invalidCovers = [
    ["远程封面.md", "https://example.com/cover.png", /cover.*wikilink.*远程封面\.md/i],
    ["穿越封面.md", "[[assets/../private.png]]", /cover.*inside.*穿越封面\.md/i],
    ["缺失封面.md", "[[assets/albums/missing.png]]", /missing album cover.*缺失封面\.md/i],
  ];

  for (const [index, [filename, cover, expectedError]] of invalidCovers.entries()) {
    const { albumsDir, publishedDir } = contentFixture(t);
    writeMarkdown(
      albumsDir,
      filename,
      `---\nkind: album\nslug: invalid-${index}\ncover: "${cover}"\n---\n# Invalid`,
    );
    assert.throws(() => loadBlog({ publishedDir, albumsDir }), expectedError, filename);
  }
});

test("rejects a symlinked album cover", (t) => {
  const { albumsDir, assetsDir, publishedDir, root } = contentFixture(t);
  const coverDirectory = path.join(assetsDir, "albums", "unsafe");
  fs.mkdirSync(coverDirectory, { recursive: true });
  const externalCover = path.join(root, "private-cover.png");
  fs.writeFileSync(externalCover, "private fixture\n");
  fs.symlinkSync(externalCover, path.join(coverDirectory, "cover.png"));
  writeMarkdown(
    albumsDir,
    "不安全封面.md",
    '---\nkind: album\nslug: unsafe\ncover: "[[assets/albums/unsafe/cover.png]]"\n---\n# Unsafe',
  );

  assert.throws(
    () => loadBlog({ publishedDir, albumsDir }),
    /cover.*regular file.*不安全封面\.md/i,
  );
});

test("renders ordered and empty album pages through Eleventy", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ethan-album-page-"));
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  const template = path.join(ROOT, "blog", "album.njk");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(fs.existsSync(template), true, "album page template should exist");

  fs.mkdirSync(path.join(input, "blog"), { recursive: true });
  fs.mkdirSync(path.join(input, "_includes", "layouts"), { recursive: true });
  fs.copyFileSync(template, path.join(input, "blog", "album.njk"));
  fs.writeFileSync(
    path.join(input, "_includes", "layouts", "blog-shell.njk"),
    "<!doctype html><main>{{ content | safe }}</main>",
  );
  const albums = [
    {
      basename: "有序专辑",
      slug: "ordered",
      status: "ongoing",
      description: "按轨道阅读。",
      cover: "/blog/assets/albums/ordered/cover.png",
      coverAlt: "有序专辑封面",
      coverCast: "molly",
      outputPath: "blog/albums/ordered/index.html",
      tracks: [
        { track: 1, title: "第一轨", url: "/blog/first/" },
        { track: 2, title: "第二轨", url: "/blog/second/" },
        { track: 3, title: "第三轨", url: "/blog/third/" },
      ],
    },
    {
      basename: "空专辑",
      slug: "empty",
      status: "planned",
      description: "先装订封面。",
      cover: null,
      coverAlt: null,
      coverCast: "auto",
      outputPath: "blog/albums/empty/index.html",
      tracks: [],
    },
  ];
  const eleventy = new Eleventy(input, output, {
    configPath: false,
    quietMode: true,
    config(eleventyConfig) {
      eleventyConfig.addGlobalData("blog", { albums });
    },
  });
  await eleventy.write();

  const orderedPage = fs.readFileSync(path.join(output, albums[0].outputPath), "utf8");
  const emptyPage = fs.readFileSync(path.join(output, albums[1].outputPath), "utf8");
  assert.match(orderedPage, /按轨道阅读。/);
  assert.match(orderedPage, /ongoing/);
  assert.match(orderedPage, /alt="有序专辑封面"/);
  assert.match(orderedPage, /01.*第一轨.*02.*第二轨.*03.*第三轨/s);
  assert.match(emptyPage, /文章正在装订中/);
});

test("allows an article without album metadata but rejects an unresolved explicit album", (t) => {
  const { albumsDir, publishedDir } = contentFixture(t);
  writeMarkdown(publishedDir, "2026-08-11-120008.md", "---\nkind: article\n---\n# 独立文章");

  const independentBlog = loadBlog({ publishedDir, albumsDir });
  assert.deepEqual(independentBlog.albums, []);
  assert.deepEqual(independentBlog.independentArticles.map((post) => post.title), ["独立文章"]);

  writeMarkdown(publishedDir, "2026-08-11-120009.md", `---
kind: article
album: "[[不存在的专辑]]"
track: 1
---
# 无法归档的文章`);
  assert.throws(
    () => loadBlog({ publishedDir, albumsDir }),
    /Album reference.*not found.*2026-08-11-120009\.md/i,
  );
});

test("renders the shared album, independent writing, and Small Talks showcase", () => {
  const independent = parsePost({
    filename: "2026-08-11-121000.md",
    source: "---\nkind: article\n---\n# 一篇独立文章\n\n独立判断。",
  });
  const note = parsePost({
    filename: "2026-08-11-121001.md",
    source: "---\nkind: note\n---\n一则碎碎念。",
  });
  const albumTrack = parsePost({
    filename: "2026-08-11-121002.md",
    source: "---\nkind: article\nalbum: \"[[AI 原生内容系统]]\"\ntrack: 1\n---\n# 第一轨\n\n专辑正文。",
  });
  albumTrack.albumSlug = "ai-native-content-system";

  const html = renderWritingShowcase({
    posts: [albumTrack, independent, note],
    albums: [
      {
        basename: "产品判断",
        slug: "product-judgment",
        order: 1,
        featured: false,
        cover: null,
        coverAlt: null,
        coverCast: "auto",
        description: "判断如何形成",
        tracks: [],
      },
      {
        basename: "AI 原生内容系统",
        slug: "ai-native-content-system",
        url: "/blog/albums/ai-native-content-system/",
        order: 2,
        featured: true,
        cover: "/assets/albums/content-system.png",
        coverAlt: "内容系统专辑封面",
        coverCast: "mochi",
        description: "从写作到分发",
        tracks: [albumTrack],
      },
    ],
    independentArticles: [independent],
    smallTalks: [note],
  }, { context: "home" });

  assert.match(html, /data-album-carousel/);
  assert.match(html, /data-album-slide="ai-native-content-system"[^>]*aria-current="true"/);
  assert.match(html, /data-album-slide="product-judgment"[^>]*aria-current="false"/);
  const selectedSlide = html.match(/<article[^>]*data-album-slide="ai-native-content-system"[^>]*>/)?.[0] || "";
  const inactiveSlide = html.match(/<article[^>]*data-album-slide="product-judgment"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(selectedSlide, /\sinert(?:\s|>)/);
  assert.match(inactiveSlide, /\sinert(?:\s|>)/);
  assert.match(html, /data-album-prev/);
  assert.match(html, /data-album-next/);
  assert.match(html, /data-album-status[^>]*aria-live="polite"/);
  assert.match(html, />专辑</);
  assert.match(html, />独立文章</);
  assert.match(html, />碎碎念</);
  assert.match(html, /第一轨/);
  assert.match(html, /href="\/blog\/albums\/ai-native-content-system\/"/);
  assert.match(html, /一篇独立文章/);
  assert.match(html, /一则碎碎念/);
});

test("does not expose untranslated English labels in the Chinese writing showcase", () => {
  const html = renderWritingShowcase({
    posts: [],
    albums: [{ basename: "中文专辑", slug: "chinese-album", order: 1, tracks: [] }],
    independentArticles: [],
    smallTalks: [],
  });

  assert.doesNotMatch(html, />\s*(?:ALBUM\s+\d+|COLLECTIONS|ESSAYS|MARGINALIA)\s*</);
});

test("chooses the smallest album order when no album is featured", () => {
  const html = renderWritingShowcase({
    posts: [],
    albums: [
      { basename: "较晚", slug: "later", order: 8, tracks: [] },
      { basename: "最先", slug: "first", order: 2, tracks: [] },
    ],
    independentArticles: [],
    smallTalks: [],
  });

  assert.match(html, /data-album-slide="first"[^>]*aria-current="true"/);
  assert.match(html, /data-album-slide="later"[^>]*aria-current="false"/);
});

test("escapes authored album and post text in every showcase region", () => {
  const unsafePost = {
    title: '<img src=x onerror="alert(1)">',
    summary: "A & B <script>alert(1)</script>",
    url: '/blog/?q="bad"&x=<tag>',
    display: "2026.08.11",
    readingMinutes: 1,
    tags: [{ label: '<svg onload="alert(1)">' }],
  };
  const html = renderWritingShowcase({
    posts: [unsafePost],
    albums: [{
      basename: '<Album & "friends">',
      slug: "safe-slug",
      order: 1,
      featured: true,
      description: "<b>unsafe</b>",
      tracks: [unsafePost],
    }],
    independentArticles: [unsafePost],
    smallTalks: [{ ...unsafePost, title: "<em>note</em>" }],
  });

  assert.doesNotMatch(html, /<script>|<img src=x|<svg onload|<b>unsafe|<em>note/);
  assert.match(html, /&lt;Album &amp; &quot;friends&quot;&gt;/);
  assert.match(html, /A &amp; B &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="\/blog\/\?q=&quot;bad&quot;&amp;x=&lt;tag&gt;"/);
});

test("keeps empty albums and legacy post-only blog data usable", () => {
  const legacyPost = parsePost({
    filename: "2026-07-28-121003.md",
    source: "# 旧文章仍然可见\n\n旧文章摘要。\n\n#essay",
  });
  const emptyHtml = renderWritingShowcase({ posts: [], albums: [], independentArticles: [], smallTalks: [] });
  const legacyHtml = renderWritingShowcase({ posts: [legacyPost] });

  assert.match(emptyHtml, /data-album-carousel/);
  assert.match(emptyHtml, /data-i18n="writing\.albumsEmpty"/);
  assert.match(emptyHtml, /data-i18n="writing\.independentEmpty"/);
  assert.match(emptyHtml, /data-i18n="writing\.smallTalksEmpty"/);
  assert.match(legacyHtml, /旧文章仍然可见/);
});

test("limits homepage rows while the writing index renders the full collections", () => {
  const articles = Array.from({ length: 5 }, (_, index) => ({
    title: `独立文章 ${index + 1}`,
    summary: `摘要 ${index + 1}`,
    url: `/blog/article-${index + 1}/`,
    display: "2026.08.11",
    readingMinutes: 1,
    tags: [],
    kind: "article",
    albumSlug: null,
  }));
  const notes = Array.from({ length: 5 }, (_, index) => ({
    title: `碎碎念 ${index + 1}`,
    summary: `片段 ${index + 1}`,
    url: `/blog/note-${index + 1}/`,
    display: "2026.08.11",
    kind: "note",
  }));

  const home = renderWritingShowcase({ posts: [...articles, ...notes], albums: [], independentArticles: articles, smallTalks: notes }, { context: "home" });
  const index = renderWritingShowcase({ posts: [...articles, ...notes], albums: [], independentArticles: articles, smallTalks: notes }, { context: "index" });

  assert.doesNotMatch(home, /独立文章 5|碎碎念 5/);
  assert.match(index, /独立文章 5/);
  assert.match(index, /碎碎念 5/);
});

test("album carousel keyboard selection updates ARIA, offsets, status, focus, and URL", () => {
  const { createAlbumCarousel } = loadCarouselModule();
  const fixture = createCarouselFixture();
  createAlbumCarousel(fixture.root);

  const right = fixture.root.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(right.defaultPrevented, true);
  assert.equal(fixture.slides[0].getAttribute("aria-current"), "false");
  assert.equal(fixture.slides[1].getAttribute("aria-current"), "true");
  assert.equal(fixture.slides[0].tabIndex, -1);
  assert.equal(fixture.slides[1].tabIndex, 0);
  assert.equal(fixture.slides[0].inert, true);
  assert.equal(fixture.slides[1].inert, false);
  assert.equal(fixture.slides[2].inert, true);
  assert.equal(fixture.slides[0].style.getPropertyValue("--album-offset"), "-1");
  assert.equal(fixture.slides[1].style.getPropertyValue("--album-offset"), "0");
  assert.equal(fixture.slides[2].style.getPropertyValue("--album-offset"), "1");
  assert.equal(fixture.status.textContent, "Album 2 of 3: Second album");
  assert.equal(fixture.slides[1].focused, true);
  assert.equal(new URL(fixture.view.location.href).searchParams.get("album"), "second");
  assert.equal(new URL(fixture.view.location.href).searchParams.get("lang"), "en");
  assert.equal(fixture.historyCalls.length, 1);

  fixture.root.dispatch("keydown", { key: "End" });
  assert.equal(fixture.slides[2].getAttribute("aria-current"), "true");
  fixture.root.dispatch("keydown", { key: "Home" });
  assert.equal(fixture.slides[0].getAttribute("aria-current"), "true");
});

test("album carousel honors the album query and changes one slide per horizontal gesture", () => {
  const { createAlbumCarousel } = loadCarouselModule();
  const fixture = createCarouselFixture({ albumQuery: "&album=third" });
  createAlbumCarousel(fixture.root);

  assert.equal(fixture.slides[2].getAttribute("aria-current"), "true");
  assert.equal(fixture.historyCalls.length, 0);

  fixture.root.dispatch("pointerdown", { button: 0, clientX: 45, clientY: 20, pointerId: 7 });
  fixture.root.dispatch("pointerup", { clientX: 120, clientY: 24, pointerId: 7 });
  assert.equal(fixture.slides[1].getAttribute("aria-current"), "true");

  fixture.root.dispatch("pointerdown", { button: 0, clientX: 45, clientY: 24, pointerId: 8 });
  fixture.root.dispatch("pointerup", { clientX: 50, clientY: 100, pointerId: 8 });
  assert.equal(fixture.slides[1].getAttribute("aria-current"), "true");

  fixture.next.dispatch("click");
  assert.equal(fixture.slides[2].getAttribute("aria-current"), "true");
  fixture.previous.dispatch("click");
  assert.equal(fixture.slides[1].getAttribute("aria-current"), "true");
});

test("accepts only exact album basename wikilinks", (t) => {
  const invalidReferences = [
    "内容系统",
    "[[内容系统|别名]]",
    "[[内容系统#章节]]",
    " [[内容系统]]",
    "[[内容系统]] ",
  ];

  for (const [index, albumReference] of invalidReferences.entries()) {
    const { albumsDir, publishedDir } = contentFixture(t);
    writeMarkdown(albumsDir, "内容系统.md", "---\nkind: album\nslug: content-system\n---\n# 内容系统");
    writeMarkdown(
      publishedDir,
      `2026-08-11-12${String(index + 10).padStart(2, "0")}00.md`,
      `---\nkind: article\nalbum: "${albumReference}"\ntrack: 1\n---\n# 非精确引用`,
    );
    assert.throws(
      () => loadBlog({ publishedDir, albumsDir }),
      /Album reference.*exact.*wikilink/i,
      albumReference,
    );
  }
});

test("rejects invalid album inventory and track metadata", (t) => {
  const cases = [
    {
      label: "missing slug",
      albums: [["甲.md", "kind: album"]],
      posts: [],
      error: /album slug.*甲\.md/i,
    },
    {
      label: "unsafe slug",
      albums: [["甲.md", "kind: album\nslug: ../escape"]],
      posts: [],
      error: /album slug.*safe URL segment.*甲\.md/i,
    },
    {
      label: "duplicate slug",
      albums: [
        ["甲.md", "kind: album\nslug: duplicate"],
        ["乙.md", "kind: album\nslug: duplicate"],
      ],
      posts: [],
      error: /duplicate album slug/i,
    },
    {
      label: "duplicate order",
      albums: [
        ["甲.md", "kind: album\nslug: first\norder: 1"],
        ["乙.md", "kind: album\nslug: second\norder: 1"],
      ],
      posts: [],
      error: /duplicate album order/i,
    },
    {
      label: "multiple featured albums",
      albums: [
        ["甲.md", "kind: album\nslug: first\nfeatured: true"],
        ["乙.md", "kind: album\nslug: second\nfeatured: true"],
      ],
      posts: [],
      error: /multiple featured albums/i,
    },
    {
      label: "duplicate track",
      albums: [["甲.md", "kind: album\nslug: first"]],
      posts: [
        ["2026-08-11-121500.md", "kind: article\nalbum: '[[甲]]'\ntrack: 1"],
        ["2026-08-11-121501.md", "kind: article\nalbum: '[[甲]]'\ntrack: 1"],
      ],
      error: /duplicate track.*first/i,
    },
    {
      label: "non-positive track",
      albums: [["甲.md", "kind: album\nslug: first"]],
      posts: [["2026-08-11-121502.md", "kind: article\nalbum: '[[甲]]'\ntrack: 0"]],
      error: /positive track.*2026-08-11-121502\.md/i,
    },
  ];

  for (const fixtureCase of cases) {
    const { albumsDir, publishedDir } = contentFixture(t);
    for (const [filename, frontmatter] of fixtureCase.albums) {
      writeMarkdown(albumsDir, filename, `---\n${frontmatter}\n---\n# Album`);
    }
    for (const [filename, frontmatter] of fixtureCase.posts) {
      writeMarkdown(publishedDir, filename, `---\n${frontmatter}\n---\n# Article`);
    }
    assert.throws(
      () => loadBlog({ publishedDir, albumsDir }),
      fixtureCase.error,
      fixtureCase.label,
    );
  }
});

test("collects only local published attachments for the build", () => {
  const post = parsePost({
    filename: "2026-07-28-084202.md",
    source: "![本地图](<../assets/figure one.png>)\n\n![远程图](https://example.com/x.png)"
  });
  assert.deepEqual(post.attachments, ["figure one.png"]);
  assert.match(post.bodyHtml, /src="\/blog\/assets\/figure%20one\.png"/);
});

test("rewrites links between timestamped Markdown files to permanent article URLs", () => {
  const post = parsePost({
    filename: "2026-07-28-084202.md",
    source: "继续阅读[上一篇](2026-07-27-193015.md#一个判断)，外部的 [Markdown](https://example.com/readme.md) 保持不变。"
  });
  assert.match(post.bodyHtml, /href="\/blog\/2026\/07\/27\/193015\/#%E4%B8%80%E4%B8%AA%E5%88%A4%E6%96%AD"/);
  assert.match(post.bodyHtml, /href="https:\/\/example\.com\/readme\.md"/);
});

test("keeps hashtags out of code, headings and links", () => {
  const result = cleanSourceAndExtractTags(`# 标题 #不是标签

#真实标签

\`#inline\` [链接](https://example.com/#anchor)

\`\`\`
#code
\`\`\``);
  assert.deepEqual(result.tags.map((tag) => tag.label), ["真实标签"]);
});

test("recognizes tags after Chinese punctuation", () => {
  const result = cleanSourceAndExtractTags("正文，#AI。下一句：#产品");
  assert.deepEqual(result.tags.map((tag) => tag.label), ["AI", "产品"]);
});

test("does not close a Markdown fence with a shorter marker", () => {
  const result = cleanSourceAndExtractTags(`\`\`\`\`js
#code
\`\`\`
#still-code
\`\`\`\`
#真实标签`);
  assert.deepEqual(result.tags.map((tag) => tag.label), ["真实标签"]);
  assert.match(result.cleanedSource, /#still-code/);
});

test("rejects conflicting article type directives", () => {
  assert.throws(
    () => parsePost({
      filename: "2026-07-28-120000.md",
      source: "# 冲突类型\n\n正文。\n\n#note #essay",
    }),
    /cannot use both #note and #essay/i,
  );
});

test("generates a metadata-only title for an untitled note", () => {
  const post = parsePost({
    filename: "2026-07-28-120000.md",
    source: "产品经理不是需求翻译器。真正困难的是知道哪些话不能直接翻译。\n\n#产品"
  });
  assert.equal(post.type, "Note");
  assert.equal(post.showTitle, false);
  assert.equal(post.title, "产品经理不是需求翻译器。");
});

test("rejects filenames that cannot provide a stable URL", () => {
  assert.throws(() => parseTimestamp("随手记.md"), /YYYY-MM-DD-HHmmss/);
  assert.throws(() => parseTimestamp("2026-02-31-120000.md"), /Invalid timestamp/);
});

test("uses readable filesystem paths and encoded public URLs for Chinese tags", () => {
  const publishedDir = fs.mkdtempSync(path.join(os.tmpdir(), "ethan-blog-tags-"));
  fs.writeFileSync(
    path.join(publishedDir, "2026-07-28-120000.md"),
    "# 中文标签\n\n正文。\n\n#产品",
    "utf8"
  );
  const blog = loadBlog({ publishedDir });
  assert.equal(blog.tags[0].url, "/blog/tag/%E4%BA%A7%E5%93%81/");
  assert.equal(blog.tagPages[0].outputPath, "blog/tag/产品/index.html");
});

test("keeps the source homepage readable without exposing build templates", () => {
  const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(source, /{%|{{/);
  assert.match(source, /第一篇还在纸上。/);
  assert.match(source, /href="https:\/\/ethansmc-personal-page\.vercel\.app\/blog\/" data-site-href="\/blog\/"/);
  assert.match(source, />查看全部写作<\/a>/);
  assert.doesNotMatch(source, /location\.replace|ethansmc\.github\.io/);
});

test("loads the shared manual album carousel from both page shells", () => {
  const homepage = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const blogLayout = fs.readFileSync(path.join(ROOT, "_includes/layouts/blog-shell.njk"), "utf8");

  assert.match(homepage, /<script type="module" src="\/writing-carousel\.js"><\/script>/);
  assert.match(blogLayout, /<script type="module" src="\/writing-carousel\.js"><\/script>/);
});

test("places writing before experience and projects on the homepage", () => {
  const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const writingIndex = source.indexOf('id="writing"');
  const experienceIndex = source.indexOf('id="experience"');
  const projectsIndex = source.indexOf('id="projects"');

  assert.ok(writingIndex > 0);
  assert.ok(writingIndex < experienceIndex);
  assert.ok(experienceIndex < projectsIndex);
  assert.match(source, /class="scroll-cue" href="#writing"/);
});

test("publishes complete homepage and blog sharing metadata", () => {
  const homepage = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const blogLayout = fs.readFileSync(path.join(ROOT, "_includes/layouts/blog-shell.njk"), "utf8");

  assert.match(homepage, /rel="canonical" href="https:\/\/ethansmc-personal-page\.vercel\.app\/"/);
  assert.match(homepage, /<title>是 Ethan，不是埃森｜碎碎念版<\/title>/);
  assert.match(homepage, /content="这里没有标准答案。让思考发生，让讨论继续。"/);
  assert.match(homepage, /property="og:image" content="https:\/\/ethansmc-personal-page\.vercel\.app\/assets\/share-card-home\.png\?v=20260803"/);
  assert.match(homepage, /name="twitter:card" content="summary_large_image"/);
  assert.match(homepage, /type="application\/ld\+json"/);
  assert.match(blogLayout, /assets\/share-card-writing\.png/);
  assert.match(blogLayout, /name="twitter:card" content="summary_large_image"/);
  assert.match(blogLayout, /"@type": "BlogPosting"/);
});

test("injects Writing content and web links during the site build", () => {
  const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const post = parsePost({
    filename: "2026-07-28-120000.md",
    source: "# 构建后的文章\n\n一段摘要。\n\n#产品 #essay"
  });
  const output = injectHomeWriting(source, {
    posts: [post],
    latestEssay: post,
    latestNotes: []
  });

  assert.match(output, /构建后的文章/);
  assert.match(output, /href="\/blog\/"/);
  assert.doesNotMatch(output, /data-site-href|HOME_WRITING_CONTENT/);
  assert.doesNotMatch(output, /{%|{{/);
});
