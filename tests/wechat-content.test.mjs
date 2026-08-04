import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePost } = require("../scripts/prepare-content.cjs");
const {
  buildArticle,
  canonicalPostUrl,
  renderWechatHtml,
  truncateVisible,
} = require("../scripts/wechat/content.cjs");

test("renders local Markdown images with uploaded WeChat URLs and inline styles", () => {
  const post = parsePost({
    filename: "2026-08-04-120000.md",
    source: "# 一篇文章\n\n第一段。\n\n![示意图](<../assets/figure one.png>)\n\n## 判断\n\n继续读[上一篇](/blog/old/)。",
  });
  const html = renderWechatHtml(post, {
    imageUrls: new Map([["figure one.png", "https://mmbiz.qpic.cn/example"]]),
    siteUrl: "https://example.com",
  });

  assert.match(html, /https:\/\/mmbiz\.qpic\.cn\/example/);
  assert.match(html, /https:\/\/example\.com\/blog\/old\//);
  assert.match(html, /<section style=/);
  assert.match(html, /<img[^>]+style=/);
  assert.doesNotMatch(html, /\/blog\/assets\/figure/);
});

test("rejects remote Markdown images because WeChat strips external image URLs", () => {
  const post = parsePost({
    filename: "2026-08-04-120001.md",
    source: "# 远程图片\n\n![外链](https://example.com/image.png)",
  });
  assert.throws(
    () => renderWechatHtml(post, { imageUrls: new Map(), siteUrl: "https://example.com" }),
    /require local Obsidian images/,
  );
});

test("builds a WeChat article within title, author, digest and source URL limits", () => {
  const post = parsePost({
    filename: "2026-08-04-120002.md",
    source: `# ${"很长的标题".repeat(10)}\n\n${"这是一段摘要。".repeat(30)}`,
  });
  const article = buildArticle(post, {
    author: "一位名字特别特别长的微信公众号作者",
    coverMediaId: "cover-media-id",
    imageUrls: new Map(),
    siteUrl: "https://example.com",
  });

  assert.ok(Array.from(article.title).length <= 32);
  assert.ok(Array.from(article.author).length <= 16);
  assert.ok(Array.from(article.digest).length <= 120);
  assert.equal(article.content_source_url, "https://example.com/blog/2026/08/04/120002/");
  assert.equal(article.thumb_media_id, "cover-media-id");
});

test("normalizes canonical URLs and visible truncation", () => {
  assert.equal(truncateVisible("一二三四五", 4), "一二三…");
  assert.equal(
    canonicalPostUrl("https://example.com/", { url: "/blog/2026/08/04/120000/" }),
    "https://example.com/blog/2026/08/04/120000/",
  );
});
