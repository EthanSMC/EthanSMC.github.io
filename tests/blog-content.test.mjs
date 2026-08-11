import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import configureEleventy from "../eleventy.config.mjs";

const require = createRequire(import.meta.url);
const { cleanSourceAndExtractTags, loadBlog, parsePost, parseTimestamp } = require("../scripts/prepare-content.cjs");
const { parseFrontmatter } = require("../scripts/content/frontmatter.cjs");
const { injectHomeWriting } = require("../scripts/render-home-writing.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function contentFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ethan-writing-content-"));
  const publishedDir = path.join(root, "published");
  const albumsDir = path.join(root, "albums");
  fs.mkdirSync(publishedDir);
  fs.mkdirSync(albumsDir);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { albumsDir, publishedDir };
}

function writeMarkdown(directory, filename, source) {
  fs.writeFileSync(path.join(directory, filename), source, "utf8");
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
  assert.doesNotMatch(source, /location\.replace|ethansmc\.github\.io/);
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
