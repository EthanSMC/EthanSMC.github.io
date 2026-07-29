const fs = require("node:fs");
const path = require("node:path");
const MarkdownIt = require("markdown-it");
const markdownItFootnote = require("markdown-it-footnote");

const ROOT = path.resolve(__dirname, "..");
const PUBLISHED_DIR = path.join(ROOT, "content", "published");
const PAGE_SIZE = 20;
const RESERVED_TYPES = new Set(["note", "essay"]);
const TAG_PATTERN = /(^|[\s（(【\[])#([\p{L}\p{N}_-]+)/gu;
const TAG_ONLY_PATTERN = /^\s*(?:#[\p{L}\p{N}_-]+\s*)+$/u;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.md$/;
const MARKDOWN_ATTACHMENT_PATTERN = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
}).use(markdownItFootnote);

const defaultImageRenderer = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const srcIndex = token.attrIndex("src");
  if (srcIndex >= 0) {
    const source = token.attrs[srcIndex][1];
    if (source.startsWith("../assets/")) {
      token.attrs[srcIndex][1] = `/blog/assets/${source.slice("../assets/".length)}`;
    }
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
  }
  return defaultImageRenderer(tokens, index, options, env, self);
};

const defaultLinkOpenRenderer = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const hrefIndex = token.attrIndex("href");
  if (hrefIndex >= 0) {
    const source = token.attrs[hrefIndex][1];
    const isRelative = !source.startsWith("/")
      && !source.startsWith("#")
      && !source.startsWith("//")
      && !/^[a-z][a-z\d+.-]*:/i.test(source);
    if (isRelative) {
      const hashIndex = source.indexOf("#");
      const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
      const pathWithQuery = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
      const rawPath = pathWithQuery.split("?", 1)[0];
      try {
        const filename = path.posix.basename(decodeURIComponent(rawPath).replaceAll("\\", "/"));
        if (TIMESTAMP_PATTERN.test(filename)) {
          token.attrs[hrefIndex][1] = `${parseTimestamp(filename).url}${hash}`;
        }
      } catch {
        // Keep malformed or non-published links unchanged; MarkdownIt will render them safely.
      }
    }
  }
  return defaultLinkOpenRenderer
    ? defaultLinkOpenRenderer(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function removeInlineNoise(line) {
  return line
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
}

function extractTagNames(line) {
  const tags = [];
  const cleanLine = removeInlineNoise(line);
  for (const match of cleanLine.matchAll(TAG_PATTERN)) tags.push(match[2]);
  return tags;
}

function cleanSourceAndExtractTags(source) {
  const publicTags = new Map();
  const directives = new Set();
  const cleanedLines = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      cleanedLines.push(line);
      continue;
    }

    const isHeading = /^\s{0,3}#{1,6}\s/.test(line);
    if (!inFence && !isHeading) {
      for (const tag of extractTagNames(line)) {
        const normalized = tag.toLocaleLowerCase("zh-CN");
        if (RESERVED_TYPES.has(normalized)) directives.add(normalized);
        else if (!publicTags.has(normalized)) publicTags.set(normalized, tag);
      }
      if (TAG_ONLY_PATTERN.test(removeInlineNoise(line).trim())) continue;
    }
    cleanedLines.push(line);
  }

  return {
    cleanedSource: cleanedLines.join("\n").trim(),
    tags: [...publicTags].map(([normalized, label]) => ({ normalized, label })),
    directives
  };
}

function findTitle(source) {
  const lines = source.split("\n");
  let title = "";
  let found = false;
  const bodyLines = lines.map((line) => {
    if (!found) {
      const match = line.match(/^\s{0,3}#\s+(.+?)\s*$/);
      if (match) {
        title = stripHtml(markdown.renderInline(match[1]));
        found = true;
        return "";
      }
    }
    return line;
  });
  return { authoredTitle: title, bodySource: bodyLines.join("\n").trim() };
}

function plainTextFromMarkdown(source) {
  return stripHtml(markdown.render(source))
    .replace(/↩/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraph(source) {
  const tokens = markdown.parse(source, {});
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "paragraph_open") continue;
    const inline = tokens[index + 1];
    if (!inline || inline.type !== "inline") continue;
    const text = inline.children
      .filter((child) => !["image", "footnote_ref"].includes(child.type))
      .map((child) => child.content || "")
      .join("");
    if (text.trim()) return text.replace(/\s+/g, " ").trim();
  }
  return "";
}

function truncateVisible(value, limit) {
  const chars = Array.from(value.trim());
  if (chars.length <= limit) return chars.join("");
  return `${chars.slice(0, limit).join("").trim()}…`;
}

function generatedTitle(text) {
  const sentence = text.split(/(?<=[。！？!?])/u)[0] || text;
  return truncateVisible(sentence, 36) || "一则未命名笔记";
}

function readingTime(text) {
  const cjk = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const latinWords = (text.replace(/[\p{Script=Han}]/gu, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
  return Math.max(1, Math.ceil(cjk / 400 + latinWords / 220));
}

function parseTimestamp(filename) {
  const match = filename.match(TIMESTAMP_PATTERN);
  if (!match) throw new Error(`Published filename must use YYYY-MM-DD-HHmmss.md: ${filename}`);
  const [, year, month, day, hour, minute, second] = match;
  const wallClock = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (
    wallClock.getUTCFullYear() !== Number(year)
    || wallClock.getUTCMonth() + 1 !== Number(month)
    || wallClock.getUTCDate() !== Number(day)
    || wallClock.getUTCHours() !== Number(hour)
    || wallClock.getUTCMinutes() !== Number(minute)
    || wallClock.getUTCSeconds() !== Number(second)
  ) {
    throw new Error(`Invalid timestamp in filename: ${filename}`);
  }
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp in filename: ${filename}`);
  return {
    id: filename.slice(0, -3),
    iso,
    date,
    display: `${year}.${month}.${day}`,
    url: `/blog/${year}/${month}/${day}/${hour}${minute}${second}/`,
    outputPath: `blog/${year}/${month}/${day}/${hour}${minute}${second}/index.html`
  };
}

function parsePost({ filename, source }) {
  const timestamp = parseTimestamp(filename);
  const { cleanedSource, tags, directives } = cleanSourceAndExtractTags(source);
  const { authoredTitle, bodySource } = findTitle(cleanedSource);
  const text = plainTextFromMarkdown(bodySource);
  const summary = truncateVisible(firstParagraph(bodySource) || text, 120);
  const automaticType = /^\s{0,3}##\s+/m.test(bodySource) || Array.from(text).length > 600
    ? "Essay"
    : "Note";
  const type = directives.has("essay") ? "Essay" : directives.has("note") ? "Note" : automaticType;
  const title = authoredTitle || generatedTitle(text);
  const attachments = [];
  for (const match of source.matchAll(MARKDOWN_ATTACHMENT_PATTERN)) {
    const rawTarget = decodeURIComponent((match[1] || match[2]).split("#", 1)[0]);
    if (!rawTarget.startsWith("../assets/")) continue;
    const relative = path.posix.normalize(rawTarget.slice("../assets/".length));
    if (relative && relative !== ".." && !relative.startsWith("../")) attachments.push(relative);
  }

  return {
    ...timestamp,
    filename,
    type,
    title,
    authoredTitle,
    showTitle: Boolean(authoredTitle) || type === "Essay",
    summary,
    readingMinutes: readingTime(text),
    tags,
    tagKeys: tags.map((tag) => tag.normalized),
    attachments,
    bodySource,
    bodyHtml: markdown.render(bodySource),
    text
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function loadBlog({ publishedDir = PUBLISHED_DIR } = {}) {
  const filenames = fs.existsSync(publishedDir)
    ? fs.readdirSync(publishedDir).filter((filename) => filename.endsWith(".md")).sort()
    : [];
  const posts = filenames
    .map((filename) => parsePost({
      filename,
      source: fs.readFileSync(path.join(publishedDir, filename), "utf8")
    }))
    .sort((a, b) => b.date - a.date);

  posts.forEach((post, index) => {
    post.newer = index > 0
      ? { title: posts[index - 1].title, url: posts[index - 1].url }
      : null;
    post.older = index < posts.length - 1
      ? { title: posts[index + 1].title, url: posts[index + 1].url }
      : null;
    post.canonicalPath = post.url;
  });

  const tagMap = new Map();
  for (const post of posts) {
    for (const tag of post.tags) {
      if (!tagMap.has(tag.normalized)) {
        tagMap.set(tag.normalized, {
          label: tag.label,
          normalized: tag.normalized,
          encoded: encodeURIComponent(tag.normalized),
          posts: []
        });
      }
      tagMap.get(tag.normalized).posts.push(post);
    }
  }

  const tags = [...tagMap.values()]
    .map((tag) => ({
      ...tag,
      count: tag.posts.length,
      url: `/blog/tag/${tag.encoded}/`
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));

  const tagPages = tags.flatMap((tag) => {
    const pages = chunks(tag.posts, PAGE_SIZE);
    return pages.map((pagePosts, pageNumber) => ({
      tag,
      posts: pagePosts,
      pageNumber,
      totalPages: pages.length,
      url: pageNumber === 0 ? tag.url : `${tag.url}page/${pageNumber + 1}/`,
      outputPath: pageNumber === 0
        ? `blog/tag/${tag.normalized}/index.html`
        : `blog/tag/${tag.normalized}/page/${pageNumber + 1}/index.html`,
      previousUrl: pageNumber > 0
        ? (pageNumber === 1 ? tag.url : `${tag.url}page/${pageNumber}/`)
        : null,
      nextUrl: pageNumber + 1 < pages.length ? `${tag.url}page/${pageNumber + 2}/` : null
    }));
  });

  return {
    posts,
    tags,
    tagPages,
    attachments: [...new Set(posts.flatMap((post) => post.attachments))],
    latestEssay: posts.find((post) => post.type === "Essay") || null,
    latestNotes: posts.filter((post) => post.type === "Note").slice(0, 2),
    latestDate: posts[0]?.date || new Date("2026-07-28T00:00:00+08:00"),
    pageSize: PAGE_SIZE
  };
}

module.exports = {
  cleanSourceAndExtractTags,
  loadBlog,
  parsePost,
  parseTimestamp,
  readingTime
};
