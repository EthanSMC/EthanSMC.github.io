const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER_VERSION = "wechat-draft-v1";
const WECHAT_IMAGE_PREFIX = "/blog/assets/";

function hashBuffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function visibleLength(value) {
  return Array.from(String(value)).length;
}

function truncateVisible(value, limit) {
  const chars = Array.from(String(value).trim());
  if (chars.length <= limit) return chars.join("");
  return `${chars.slice(0, Math.max(1, limit - 1)).join("").trim()}…`;
}

function normalizeSiteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SITE_URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

function canonicalPostUrl(siteUrl, post) {
  return new URL(post.url, `${normalizeSiteUrl(siteUrl)}/`).toString();
}

function addInlineStyle(html, tagName, style) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  return html.replace(pattern, (full, attributes) => {
    const styleMatch = attributes.match(/\sstyle=(['"])(.*?)\1/i);
    if (styleMatch) {
      const combined = `${styleMatch[2].trim().replace(/;?$/, ";")} ${style}`.trim();
      return full.replace(styleMatch[0], ` style=${styleMatch[1]}${combined}${styleMatch[1]}`);
    }
    return `<${tagName}${attributes} style="${style}">`;
  });
}

function rewriteLinks(html, siteUrl) {
  return html.replace(/<a\b([^>]*?)\shref=(['"])(.*?)\2([^>]*)>/gi, (full, before, quote, href, after) => {
    if (!href.startsWith("/")) return full;
    const absolute = new URL(href, `${normalizeSiteUrl(siteUrl)}/`).toString();
    return `<a${before} href=${quote}${absolute}${quote}${after}>`;
  });
}

function rewriteImages(html, imageUrls) {
  return html.replace(/<img\b([^>]*?)\ssrc=(['"])(.*?)\2([^>]*)>/gi, (full, before, quote, source, after) => {
    if (!source.startsWith(WECHAT_IMAGE_PREFIX)) {
      throw new Error(`WeChat drafts require local Obsidian images; unsupported image: ${source}`);
    }

    let relative;
    try {
      relative = path.posix.normalize(decodeURIComponent(source.slice(WECHAT_IMAGE_PREFIX.length)));
    } catch {
      throw new Error(`Invalid encoded image path in generated HTML: ${source}`);
    }
    const uploaded = imageUrls.get(relative);
    if (!uploaded) throw new Error(`Missing uploaded WeChat image URL for: ${relative}`);
    return `<img${before} src=${quote}${uploaded}${quote}${after}>`;
  });
}

function styleWechatHtml(html) {
  const styles = new Map([
    ["p", "margin: 0 0 1.1em; color: #2f2f2f; font-size: 16px; line-height: 1.85; letter-spacing: 0.02em;"],
    ["h2", "margin: 2.2em 0 0.8em; color: #171717; font-size: 22px; line-height: 1.45; font-weight: 700;"],
    ["h3", "margin: 1.8em 0 0.7em; color: #222222; font-size: 18px; line-height: 1.55; font-weight: 700;"],
    ["h4", "margin: 1.6em 0 0.6em; color: #292929; font-size: 17px; line-height: 1.55; font-weight: 700;"],
    ["blockquote", "margin: 1.4em 0; padding: 0.8em 1em; border-left: 3px solid #8fa796; background: #f6f8f5; color: #4d574f;"],
    ["ul", "margin: 0.8em 0 1.2em; padding-left: 1.5em; color: #2f2f2f;"],
    ["ol", "margin: 0.8em 0 1.2em; padding-left: 1.5em; color: #2f2f2f;"],
    ["li", "margin: 0.35em 0; font-size: 16px; line-height: 1.8;"],
    ["pre", "margin: 1.2em 0; padding: 1em; overflow-wrap: break-word; white-space: pre-wrap; background: #f5f5f3; border-radius: 6px; font-size: 13px; line-height: 1.65;"],
    ["code", "font-family: Menlo, Consolas, monospace; font-size: 0.9em; background: #f5f5f3;"],
    ["a", "color: #47705a; text-decoration: underline;"],
    ["img", "display: block; width: 100%; height: auto; margin: 1.4em auto; border-radius: 4px;"],
    ["hr", "margin: 2em auto; border: 0; border-top: 1px solid #deded8;"],
    ["strong", "color: #171717; font-weight: 700;"],
  ]);

  let result = html;
  for (const [tagName, style] of styles) result = addInlineStyle(result, tagName, style);
  return `<section style="max-width: 100%; color: #2f2f2f; word-wrap: break-word;">${result}</section>`;
}

function renderWechatHtml(post, { imageUrls, siteUrl }) {
  let html = rewriteImages(post.bodyHtml, imageUrls);
  html = rewriteLinks(html, siteUrl);
  return styleWechatHtml(html);
}

function buildArticle(post, { author, coverMediaId, imageUrls, siteUrl }) {
  const title = truncateVisible(post.title, 32);
  const normalizedAuthor = truncateVisible(author, 16);
  const digest = truncateVisible(post.summary, 120);
  const content = renderWechatHtml(post, { imageUrls, siteUrl });
  if (!title) throw new Error(`WeChat draft title is empty: ${post.filename}`);
  if (!coverMediaId) throw new Error(`WeChat cover media id is empty: ${post.filename}`);
  if (visibleLength(content) >= 20_000 || Buffer.byteLength(content, "utf8") >= 1_000_000) {
    throw new Error(`WeChat draft content exceeds the platform limit: ${post.filename}`);
  }
  return {
    article_type: "news",
    title,
    author: normalizedAuthor,
    digest,
    content,
    content_source_url: canonicalPostUrl(siteUrl, post),
    thumb_media_id: coverMediaId,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
}

function noteSourceDate(post) {
  if (/^\d{4}\.\d{2}\.\d{2}$/u.test(post.display || "")) return post.display;
  const source = [post.iso, post.id, post.filename]
    .find((value) => /^\d{4}-\d{2}-\d{2}/u.test(value || ""));
  if (!source) throw new Error(`WeChat newspic requires a source date: ${post.filename || "unknown note"}`);
  return source.slice(0, 10).replaceAll("-", ".");
}

function noteDraftTitle(post) {
  if (typeof post.authoredTitle === "string") {
    return post.authoredTitle.trim() || `碎碎念 · ${noteSourceDate(post)}`;
  }
  return String(post.title || "").trim() || `碎碎念 · ${noteSourceDate(post)}`;
}

function buildNewspic(post, { imageMediaIds, author, siteUrl }) {
  if (!Array.isArray(imageMediaIds) || imageMediaIds.length === 0) {
    throw new Error("WeChat newspic requires one to four poster images");
  }
  if (imageMediaIds.length > 4) {
    const error = new Error("WeChat newspic cannot contain more than four poster images");
    error.code = "content_too_long";
    throw error;
  }
  if (imageMediaIds.some((mediaId) => typeof mediaId !== "string" || !mediaId.trim())) {
    throw new Error("WeChat newspic image media id must not be empty");
  }

  const title = truncateVisible(noteDraftTitle(post), 32);
  const normalizedAuthor = truncateVisible(author || "", 16);
  const content = truncateVisible(post.text || post.summary || "", 1_000);
  const digest = truncateVisible(post.summary || content, 120);
  if (!title) throw new Error(`WeChat newspic title is empty: ${post.filename}`);

  return {
    article_type: "newspic",
    title,
    author: normalizedAuthor,
    digest,
    content,
    content_source_url: canonicalPostUrl(siteUrl, post),
    image_info: {
      image_list: imageMediaIds.map((image_media_id) => ({ image_media_id })),
    },
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
}

function collectPostAssets(root, post) {
  return post.attachments.map((relative) => {
    const absolutePath = path.resolve(root, "content", "assets", relative);
    const assetsRoot = path.resolve(root, "content", "assets");
    if (absolutePath !== assetsRoot && !absolutePath.startsWith(`${assetsRoot}${path.sep}`)) {
      throw new Error(`Attachment escapes content/assets: ${relative}`);
    }
    const data = fs.readFileSync(absolutePath);
    return { relative, absolutePath, data, hash: hashBuffer(data) };
  });
}

function publicationFingerprint({ source, assets, author, siteUrl, coverHash }) {
  const payload = JSON.stringify({
    renderer: RENDERER_VERSION,
    source,
    assets: assets.map(({ relative, hash }) => [relative, hash]),
    author,
    siteUrl: normalizeSiteUrl(siteUrl),
    coverHash,
  });
  return hashBuffer(payload);
}

module.exports = {
  RENDERER_VERSION,
  buildArticle,
  buildNewspic,
  canonicalPostUrl,
  collectPostAssets,
  hashBuffer,
  normalizeSiteUrl,
  publicationFingerprint,
  renderWechatHtml,
  truncateVisible,
  visibleLength,
};
