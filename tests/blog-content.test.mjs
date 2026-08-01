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
const { injectHomeWriting } = require("../scripts/render-home-writing.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.doesNotMatch(post.bodyHtml, /#essay|#AI/);
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

test("publishes complete homepage and blog sharing metadata", () => {
  const homepage = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const blogLayout = fs.readFileSync(path.join(ROOT, "_includes/layouts/blog-shell.njk"), "utf8");

  assert.match(homepage, /rel="canonical" href="https:\/\/ethansmc-personal-page\.vercel\.app\/"/);
  assert.match(homepage, /property="og:image" content="https:\/\/ethansmc-personal-page\.vercel\.app\/assets\/share-card-home\.png"/);
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
