import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePost } = require("../scripts/prepare-content.cjs");
const {
  buildArticle,
  buildNewspic,
  canonicalPostUrl,
  renderWechatHtml,
  truncateVisible,
} = require("../scripts/wechat/content.cjs");
const { selectNoteCast } = require("../scripts/wechat/note-cast.cjs");
const {
  NOTE_POSTER_HEIGHT,
  NOTE_POSTER_WIDTH,
  paginateNote,
  renderNotePosters,
} = require("../scripts/wechat/note-poster.cjs");

function notePost({
  filename = "2026-08-04-120000.md",
  frontmatter = "kind: note",
  body = "第一段。",
} = {}) {
  return parsePost({
    filename,
    source: `---\n${frontmatter}\n---\n${body}`,
  });
}

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

test("selects only a confident classifier cast for automatic notes", async () => {
  for (const cast of ["mochi", "molly"]) {
    assert.equal(
      await selectNoteCast({ cast: "auto", text: "正文" }, {
        classify: async () => ({ cast, confidence: 0.9 }),
      }),
      cast,
    );
  }
});

test("does not accept none from automatic classification", async () => {
  assert.equal(
    await selectNoteCast({ cast: "auto", text: "正文" }, {
      classify: async () => ({ cast: "none", confidence: 0.99 }),
    }),
    "molly",
  );
});

test("explicit note casts bypass classification", async () => {
  for (const cast of ["mochi", "molly"]) {
    assert.equal(
      await selectNoteCast({ cast, text: "正文" }, {
        classify: async () => {
          throw new Error("explicit cast must not classify");
        },
      }),
      cast,
    );
  }
});

test("keeps an explicit none cast without classification", async () => {
  assert.equal(
    await selectNoteCast({ cast: "none", text: "正文" }, {
      classify: async () => {
        throw new Error("explicit none must not classify");
      },
    }),
    "none",
  );
});

test("falls back to Molly for low-confidence, malformed, invalid, or failed classification", async () => {
  const classifiers = [
    async () => ({ cast: "mochi", confidence: 0.79 }),
    async () => ({ cast: "auto", confidence: 1 }),
    async () => ({ cast: "mochi", confidence: "0.99" }),
    async () => null,
    async () => { throw new Error("offline"); },
  ];

  for (const classify of classifiers) {
    assert.equal(await selectNoteCast({ cast: "auto", text: "正文" }, { classify }), "molly");
  }
  assert.equal(await selectNoteCast({ cast: "snoopy", text: "正文" }, {}), "molly");
});

test("falls back to Molly when automatic classification times out", async () => {
  const selected = await selectNoteCast({ cast: "auto", text: "正文" }, {
    timeoutMs: 5,
    classify: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { cast: "mochi", confidence: 0.99 };
    },
  });

  assert.equal(selected, "molly");
});

test("paginates Markdown blocks in order using injected pixel measurements", () => {
  const note = notePost({ body: "第一段。\n\n第二段。\n\n第三段。" });
  const pages = paginateNote(note, {
    contentHeight: 110,
    blockGap: 10,
    measureBlock: (block) => block.type === "title" ? 0 : 45,
  });

  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((page) => page.blocks.filter((block) => block.type !== "title").map((block) => block.text)),
    [["第一段。", "第二段。"], ["第三段。"]],
  );
});

test("splits oversized paragraphs by sentence and then Unicode grapheme without losing text", () => {
  const source = "甲乙丙丁戊。👨‍👩‍👧‍👦庚辛壬癸。";
  const note = notePost({ body: source });
  const measureBlock = (block) => block.type === "title"
    ? 0
    : Array.from(new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(block.text)).length * 10;
  const pages = paginateNote(note, {
    contentHeight: 50,
    blockGap: 0,
    measureBlock,
  });
  const blocks = pages.flatMap((page) => page.blocks).filter((block) => block.type !== "title");

  assert.ok(pages.length >= 1 && pages.length <= 4);
  assert.equal(blocks.map((block) => block.text).join(""), source);
  assert.ok(blocks.every((block) => measureBlock(block) <= 50));
});

test("packs sentence fragments into the previous page before opening another page", () => {
  const note = notePost({
    body: "甲乙丙丁戊己\n\n庚辛。壬癸。子丑。寅卯。",
  });
  const pages = paginateNote(note, {
    contentHeight: 100,
    blockGap: 0,
    measureBlock: (block) => block.type === "title" ? 0 : Array.from(block.text).length * 10,
  });

  assert.equal(pages.length, 2);
  assert.deepEqual(
    pages.map((page) => page.blocks.filter((block) => block.type !== "title").map((block) => block.text).join("")),
    ["甲乙丙丁戊己庚辛。", "壬癸。子丑。寅卯。"],
  );
});

test("rejects a fifth poster page without truncating or reducing body type", () => {
  const note = notePost({ body: "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌" });

  assert.throws(
    () => paginateNote(note, {
      contentHeight: 40,
      blockGap: 0,
      measureBlock: (block) => block.type === "title" ? 0 : Array.from(block.text).length * 10,
    }),
    (error) => error?.code === "content_too_long",
  );
});

test("renders deterministic 1080 by 1440 note posters with source-date title and corner cast", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-poster-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const note = notePost({
    frontmatter: "kind: note\ncast: mochi",
    body: "第一段。\n\n第二段。",
  });
  const captures = [];
  const capture = async (input) => {
    captures.push(input);
    fs.writeFileSync(input.outputPath, Buffer.from(`page-${input.index + 1}`));
  };
  const options = {
    outputDir: path.join(root, "first"),
    author: "Ethan",
    siteUrl: "https://example.com",
    contentHeight: 900,
    measureBlock: (block) => block.type === "title" ? 0 : 700,
    capture,
  };

  const first = await renderNotePosters(note, options);
  const second = await renderNotePosters(note, {
    ...options,
    outputDir: path.join(root, "second"),
    capture: async (input) => fs.writeFileSync(input.outputPath, Buffer.from("repeat")),
  });

  assert.equal(NOTE_POSTER_WIDTH, 1080);
  assert.equal(NOTE_POSTER_HEIGHT, 1440);
  assert.equal(first.pages.length, 2);
  assert.equal(first.files.length, 2);
  assert.equal(first.cast, "mochi");
  assert.equal(first.renderHash, second.renderHash);
  assert.ok(first.files.every((file) => file.endsWith(".png") && fs.existsSync(file)));
  assert.equal(captures[0].width, 1080);
  assert.equal(captures[0].height, 1440);
  assert.match(captures[0].svg, /碎碎念 · 2026\.08\.04/);
  assert.match(captures[0].svg, /data-cast="mochi"/);
  assert.match(captures[0].svg, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(captures[1].svg, /data-cast=/);
  assert.doesNotMatch(captures[0].svg, /Ethan · example\.com/);
  assert.match(captures[1].svg, /Ethan · example\.com/);
});

test("paginates a long authored title at fixed type size without losing title or body text", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-long-title-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const title = "把一段很长很长的中文标题完整放进海报而不是悄悄裁掉";
  const body = "正文甲。正文乙。";
  const note = notePost({
    frontmatter: "kind: note\ncast: none",
    body: `# ${title}\n\n${body}`,
  });
  const captures = [];
  const result = await renderNotePosters(note, {
    outputDir: root,
    author: "Ethan",
    siteUrl: "https://example.com",
    contentHeight: 100,
    blockGap: 0,
    measureBlock: (block) => Array.from(
      new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(block.text),
    ).length * (block.type === "title" ? 8 : 10),
    capture: async (input) => { captures.push(input); },
  });
  const blocks = result.pages.flatMap((page) => page.blocks);

  assert.equal(blocks.filter((block) => block.type === "title").map((block) => block.text).join(""), title);
  assert.equal(blocks.filter((block) => block.type !== "title").map((block) => block.text).join(""), body);
  assert.match(captures.map(({ svg }) => svg).join(""), /note-block--title/);
  assert.doesNotMatch(captures.map(({ svg }) => svg).join(""), /<text[^>]*font-size="54"[^>]*>把一段很长/);
});

test("keeps the untitled fallback as one title block without repeating body text", () => {
  const note = notePost({ body: "第一段。\n\n第二段。" });
  const pages = paginateNote(note, {
    contentHeight: 500,
    blockGap: 0,
    measureBlock: () => 50,
  });
  const blocks = pages.flatMap((page) => page.blocks);

  assert.equal(blocks.filter((block) => block.type === "title").map((block) => block.text).join(""), "碎碎念 · 2026.08.04");
  assert.equal(blocks.filter((block) => block.type !== "title").map((block) => block.text).join(""), "第一段。第二段。");
});

test("keeps the page-one character outside the measured content rectangle", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-cast-layout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let svg = "";
  await renderNotePosters(notePost({ frontmatter: "kind: note\ncast: mochi" }), {
    outputDir: root,
    author: "Ethan",
    siteUrl: "https://example.com",
    contentHeight: 900,
    measureBlock: (block) => block.type === "title" ? 0 : 100,
    capture: async (input) => { svg = input.svg; },
  });

  const content = svg.match(/<foreignObject x="\d+" y="(\d+)" width="\d+" height="(\d+)">/);
  const cast = svg.match(/<g data-cast="mochi">[\s\S]*?<circle cx="\d+" cy="(\d+)" r="(\d+)"/);
  assert.ok(content && cast);
  assert.ok(Number(content[1]) + Number(content[2]) <= Number(cast[1]) - Number(cast[2]));
});

test("render hash changes with poster content and oversized rendering captures nothing", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-render-hash-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capture = async ({ outputPath }) => fs.writeFileSync(outputPath, Buffer.from("png"));
  const options = {
    outputDir: path.join(root, "short"),
    author: "Ethan",
    siteUrl: "https://example.com",
    contentHeight: 100,
    blockGap: 0,
    measureBlock: (block) => block.type === "title" ? 0 : Array.from(block.text).length * 10,
    capture,
  };
  const short = await renderNotePosters(notePost({ frontmatter: "kind: note\ncast: none", body: "短句。" }), options);
  const changed = await renderNotePosters(notePost({ frontmatter: "kind: note\ncast: none", body: "另一句。" }), {
    ...options,
    outputDir: path.join(root, "changed"),
  });
  let captureCount = 0;

  assert.notEqual(short.renderHash, changed.renderHash);
  await assert.rejects(
    () => renderNotePosters(notePost({
      frontmatter: "kind: note\ncast: none",
      body: "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌",
    }), {
      ...options,
      outputDir: path.join(root, "long"),
      contentHeight: 40,
      capture: async () => { captureCount += 1; },
    }),
    (error) => error?.code === "content_too_long",
  );
  assert.equal(captureCount, 0);
});

test("changes render hash when the renderer fingerprint changes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-renderer-fingerprint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const note = notePost({ frontmatter: "kind: note\ncast: none" });
  const options = {
    author: "Ethan",
    siteUrl: "https://example.com",
    measureBlock: () => 50,
    capture: async () => {},
  };
  const first = await renderNotePosters(note, {
    ...options,
    outputDir: path.join(root, "first"),
    rendererFingerprint: "renderer-a",
  });
  const second = await renderNotePosters(note, {
    ...options,
    outputDir: path.join(root, "second"),
    rendererFingerprint: "renderer-b",
  });

  assert.notEqual(first.renderHash, second.renderHash);
});

test("closes a launched browser exactly once when poster browser initialization fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-browser-init-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const note = notePost({ frontmatter: "kind: note\ncast: none" });

  for (const failureStep of ["newPage", "setContent", "fonts"]) {
    let closeCount = 0;
    const page = {
      setContent: async () => {
        if (failureStep === "setContent") throw new Error("setContent failed");
      },
      evaluate: async () => {
        if (failureStep === "fonts") throw new Error("fonts failed");
      },
    };
    const browser = {
      newPage: async () => {
        if (failureStep === "newPage") throw new Error("newPage failed");
        return page;
      },
      close: async () => { closeCount += 1; },
    };

    await assert.rejects(
      () => renderNotePosters(note, {
        outputDir: path.join(root, failureStep),
        author: "Ethan",
        siteUrl: "https://example.com",
        launchBrowser: async () => browser,
      }),
      new RegExp(`${failureStep} failed`),
    );
    assert.equal(closeCount, 1, failureStep);
  }
});

test("bundles the fixed Mochi and Molly characters as real JPEG files", () => {
  for (const filename of ["mochi-note.jpg", "molly-note.jpg"]) {
    const data = fs.readFileSync(path.join(import.meta.dirname, "..", "assets", "writing", filename));
    assert.deepEqual([...data.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  }
});

test("builds a native newspic draft with one to four poster media ids", () => {
  const note = notePost({ body: "今天完成了一次小迭代。" });
  const imageMediaIds = ["poster-1", "poster-2"];
  const article = buildNewspic(note, {
    imageMediaIds,
    author: "一位名字特别特别长的微信公众号作者",
    siteUrl: "https://example.com/",
  });

  assert.equal(article.article_type, "newspic");
  assert.equal(article.title, "碎碎念 · 2026.08.04");
  assert.ok(Array.from(article.author).length <= 16);
  assert.ok(Array.from(article.digest).length <= 120);
  assert.equal(article.content, "今天完成了一次小迭代。");
  assert.equal(article.content_source_url, "https://example.com/blog/2026/08/04/120000/");
  assert.deepEqual(
    article.image_info.image_list,
    imageMediaIds.map((image_media_id) => ({ image_media_id })),
  );
  assert.equal(Object.hasOwn(article, "thumb_media_id"), false);
});

test("rejects newspic drafts without one to four valid image media ids", () => {
  const note = notePost();
  const input = { author: "Ethan", siteUrl: "https://example.com" };

  assert.throws(() => buildNewspic(note, { ...input, imageMediaIds: [] }), /one to four/i);
  assert.throws(() => buildNewspic(note, { ...input, imageMediaIds: ["ok", ""] }), /media id/i);
  assert.throws(
    () => buildNewspic(note, { ...input, imageMediaIds: ["1", "2", "3", "4", "5"] }),
    (error) => error?.code === "content_too_long",
  );
});
