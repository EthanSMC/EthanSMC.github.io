const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const MarkdownIt = require("markdown-it");

const { selectNoteCast } = require("./note-cast.cjs");

const NOTE_POSTER_WIDTH = 1080;
const NOTE_POSTER_HEIGHT = 1440;
const NOTE_CONTENT_WIDTH = 896;
const NOTE_CONTENT_HEIGHT = 860;
const NOTE_CONTENT_Y = 180;
const NOTE_BLOCK_GAP = 24;
const NOTE_BODY_FONT_SIZE = 43;
const NOTE_POSTER_TEMPLATE_VERSION = "note-poster-v1";
const NOTE_FONT_IDENTITY = "PingFang SC/Hiragino Sans GB/Arial@43px";
const MAX_POSTER_PAGES = 4;
const SENTENCE_PATTERN = /[^。！？!?]+[。！？!?]?/gu;
const CLASS_NAMES = new Set(["title", "paragraph", "heading", "quote", "list", "code"]);
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

const DEFAULT_CAST_ASSETS = {
  mochi: path.resolve(__dirname, "..", "..", "assets", "writing", "mochi-note.jpg"),
  molly: path.resolve(__dirname, "..", "..", "assets", "writing", "molly-note.jpg"),
};
const DEFAULT_FONT_PATHS = [
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/PingFangUI.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/Menlo.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
];
const DEFAULT_RENDERER_FINGERPRINT = filesFingerprint([
  __filename,
  path.resolve(__dirname, "note-cast.cjs"),
]);
const DEFAULT_FONT_FINGERPRINT = filesFingerprint(DEFAULT_FONT_PATHS);
const DEFAULT_RUNTIME_FINGERPRINT = hash(JSON.stringify({
  node: process.versions.node,
  markdownIt: packageVersion("markdown-it"),
  playwrightCore: packageVersion("playwright-core"),
}));

const BLOCK_CSS = `
.note-block {
  box-sizing: border-box;
  margin: 0;
  color: #26354a;
  font-family: "PingFang SC", "Hiragino Sans GB", Arial, sans-serif;
  font-size: ${NOTE_BODY_FONT_SIZE}px;
  font-weight: 430;
  line-height: 1.62;
  letter-spacing: 0.018em;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.note-block--heading {
  color: #275ba8;
  font-size: 50px;
  font-weight: 700;
  line-height: 1.42;
}
.note-block--title {
  color: #1e3150;
  font-size: 54px;
  font-weight: 750;
  line-height: 1.35;
}
.note-block--quote {
  border-left: 5px solid #7fa2d3;
  color: #4d607a;
  padding-left: 26px;
}
.note-block--list { padding-left: 14px; }
.note-block--code {
  background: #e7edf5;
  border-radius: 12px;
  color: #34465f;
  font-family: Menlo, Consolas, monospace;
  font-size: 32px;
  line-height: 1.55;
  padding: 20px 24px;
}
`;

function contentTooLong(message = "Note requires more than four poster pages") {
  const error = new Error(message);
  error.code = "content_too_long";
  return error;
}

function normalizedInlineText(token) {
  if (!Array.isArray(token.children)) return token.content || "";
  return token.children.map((child) => {
    if (child.type === "softbreak" || child.type === "hardbreak") return "\n";
    if (child.type === "image") return child.content || "";
    return child.content || "";
  }).join("");
}

function normalizeBlockText(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function markdownBlocks(post) {
  const source = typeof post?.bodySource === "string"
    ? post.bodySource
    : (typeof post?.text === "string" ? post.text : "");
  const tokens = markdown.parse(source, {});
  const blocks = [];
  let blockquoteDepth = 0;
  let listDepth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "blockquote_open") blockquoteDepth += 1;
    if (token.type === "blockquote_close") blockquoteDepth = Math.max(0, blockquoteDepth - 1);
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") listDepth += 1;
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      listDepth = Math.max(0, listDepth - 1);
    }

    if (token.type === "fence" || token.type === "code_block") {
      const text = normalizeBlockText(token.content);
      if (text) blocks.push({ type: "code", text });
      continue;
    }
    if (token.type === "hr") {
      blocks.push({ type: "paragraph", text: "——" });
      continue;
    }
    if (token.type !== "inline") continue;

    const text = normalizeBlockText(normalizedInlineText(token));
    if (!text) continue;
    const parent = tokens[index - 1]?.type || "";
    const type = parent === "heading_open"
      ? "heading"
      : (blockquoteDepth > 0 ? "quote" : (listDepth > 0 ? "list" : "paragraph"));
    blocks.push({ type, text: type === "list" ? `• ${text}` : text });
  }
  return blocks;
}

function posterBlocks(post) {
  return [{ type: "title", text: posterTitle(post) }, ...markdownBlocks(post)];
}

function graphemes(value) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(value)]
      .map((part) => part.segment);
  }
  return Array.from(value);
}

function sentenceSegments(value) {
  const segments = [];
  let cursor = 0;
  for (const match of value.matchAll(SENTENCE_PATTERN)) {
    if (match.index > cursor) {
      const punctuation = value.slice(cursor, match.index);
      if (segments.length > 0) segments[segments.length - 1] += punctuation;
      else segments.push(punctuation);
    }
    segments.push(match[0]);
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    const remainder = value.slice(cursor);
    if (segments.length > 0) segments[segments.length - 1] += remainder;
    else segments.push(remainder);
  }
  return segments.filter(Boolean);
}

function classNameFor(block) {
  const type = CLASS_NAMES.has(block.type) ? block.type : "paragraph";
  return `note-block note-block--${type}`;
}

function defaultMeasureBlock(block, { width = NOTE_CONTENT_WIDTH } = {}) {
  const fontSize = block.type === "title"
    ? 54
    : (block.type === "heading" ? 50 : (block.type === "code" ? 32 : NOTE_BODY_FONT_SIZE));
  const lineHeight = block.type === "title"
    ? fontSize * 1.35
    : (block.type === "heading"
      ? fontSize * 1.42
      : (block.type === "code" ? fontSize * 1.55 : fontSize * 1.62));
  const horizontalPadding = block.type === "quote" ? 31 : (block.type === "code" ? 48 : 0);
  const usableWidth = Math.max(fontSize, width - horizontalPadding);
  const lines = String(block.text).split("\n").reduce((total, line) => {
    const units = graphemes(line).reduce((sum, character) => (
      sum + (/^[\x00-\xff]$/u.test(character) ? 0.56 : 1)
    ), 0);
    return total + Math.max(1, Math.ceil((units * fontSize) / usableWidth));
  }, 0);
  return Math.ceil(lines * lineHeight + (block.type === "code" ? 40 : 0));
}

function measuredHeight(measureBlock, block, context) {
  const value = measureBlock(block, context);
  if (!Number.isFinite(value) || value < 0) throw new Error("Poster measurement must be a non-negative pixel height");
  return value;
}

function blockAtomsSync(block, contentHeight, measureBlock, context) {
  const atoms = [];
  for (const sentence of sentenceSegments(block.text)) {
    const sentenceBlock = { ...block, text: sentence };
    if (measuredHeight(measureBlock, sentenceBlock, context) <= contentHeight) {
      atoms.push(sentence);
      continue;
    }
    for (const grapheme of graphemes(sentence)) {
      if (measuredHeight(measureBlock, { ...block, text: grapheme }, context) > contentHeight) {
        throw contentTooLong("A single grapheme does not fit the fixed poster body size");
      }
      atoms.push(grapheme);
    }
  }
  return atoms;
}

function paginateBlocksSync(blocks, options) {
  const contentHeight = options.contentHeight;
  const blockGap = options.blockGap;
  const measureBlock = options.measureBlock;
  const context = { width: NOTE_CONTENT_WIDTH };
  const pages = [{ number: 1, blocks: [], usedHeight: 0 }];

  const addPage = () => {
    if (pages.length >= MAX_POSTER_PAGES) throw contentTooLong();
    const page = { number: pages.length + 1, blocks: [], usedHeight: 0 };
    pages.push(page);
    return page;
  };
  const addBlock = (page, block, height) => {
    const gap = page.blocks.length > 0 ? blockGap : 0;
    page.blocks.push(block);
    page.usedHeight += gap + height;
  };

  for (const block of blocks) {
    let page = pages[pages.length - 1];
    const height = measuredHeight(measureBlock, block, context);
    const gap = page.blocks.length > 0 ? blockGap : 0;
    if (page.usedHeight + gap + height <= contentHeight) {
      addBlock(page, block, height);
      continue;
    }
    if (height <= contentHeight) {
      page = addPage();
      addBlock(page, block, height);
      continue;
    }

    const atoms = blockAtomsSync(block, contentHeight, measureBlock, context);
    let atomIndex = 0;
    while (atomIndex < atoms.length) {
      page = pages[pages.length - 1];
      const pieceGap = page.blocks.length > 0 ? blockGap : 0;
      const availableHeight = contentHeight - page.usedHeight - pieceGap;
      let pieceText = "";
      let nextAtomIndex = atomIndex;
      while (nextAtomIndex < atoms.length) {
        const candidate = `${pieceText}${atoms[nextAtomIndex]}`;
        if (measuredHeight(measureBlock, { ...block, text: candidate }, context) > availableHeight) break;
        pieceText = candidate;
        nextAtomIndex += 1;
      }
      if (!pieceText) {
        if (page.blocks.length > 0) {
          addPage();
          continue;
        }
        throw contentTooLong("A sentence fragment does not fit the fixed poster body size");
      }
      const piece = { ...block, text: pieceText };
      const pieceHeight = measuredHeight(measureBlock, piece, context);
      addBlock(page, piece, pieceHeight);
      atomIndex = nextAtomIndex;
      if (atomIndex < atoms.length) addPage();
    }
  }

  return pages.map((page) => ({ ...page, total: pages.length }));
}

function paginateNote(post, options = {}) {
  const contentHeight = options.contentHeight ?? NOTE_CONTENT_HEIGHT;
  const blockGap = options.blockGap ?? NOTE_BLOCK_GAP;
  const measureBlock = options.measureBlock || options.measure || defaultMeasureBlock;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) throw new Error("Poster contentHeight must be positive");
  if (!Number.isFinite(blockGap) || blockGap < 0) throw new Error("Poster blockGap must not be negative");
  return paginateBlocksSync(posterBlocks(post), { contentHeight, blockGap, measureBlock });
}

async function measuredHeightAsync(measureBlock, block, context) {
  const value = await measureBlock(block, context);
  if (!Number.isFinite(value) || value < 0) throw new Error("Poster measurement must be a non-negative pixel height");
  return value;
}

async function blockAtomsAsync(block, contentHeight, measureBlock, context) {
  const atoms = [];
  for (const sentence of sentenceSegments(block.text)) {
    const sentenceBlock = { ...block, text: sentence };
    if (await measuredHeightAsync(measureBlock, sentenceBlock, context) <= contentHeight) {
      atoms.push(sentence);
      continue;
    }
    for (const grapheme of graphemes(sentence)) {
      if (await measuredHeightAsync(measureBlock, { ...block, text: grapheme }, context) > contentHeight) {
        throw contentTooLong("A single grapheme does not fit the fixed poster body size");
      }
      atoms.push(grapheme);
    }
  }
  return atoms;
}

async function paginateBlocksAsync(blocks, options) {
  const { contentHeight, blockGap, measureBlock } = options;
  const context = { width: NOTE_CONTENT_WIDTH };
  const pages = [{ number: 1, blocks: [], usedHeight: 0 }];
  const addPage = () => {
    if (pages.length >= MAX_POSTER_PAGES) throw contentTooLong();
    const page = { number: pages.length + 1, blocks: [], usedHeight: 0 };
    pages.push(page);
    return page;
  };
  const addBlock = (page, block, height) => {
    const gap = page.blocks.length > 0 ? blockGap : 0;
    page.blocks.push(block);
    page.usedHeight += gap + height;
  };

  for (const block of blocks) {
    let page = pages[pages.length - 1];
    const height = await measuredHeightAsync(measureBlock, block, context);
    const gap = page.blocks.length > 0 ? blockGap : 0;
    if (page.usedHeight + gap + height <= contentHeight) {
      addBlock(page, block, height);
      continue;
    }
    if (height <= contentHeight) {
      page = addPage();
      addBlock(page, block, height);
      continue;
    }
    const atoms = await blockAtomsAsync(block, contentHeight, measureBlock, context);
    let atomIndex = 0;
    while (atomIndex < atoms.length) {
      page = pages[pages.length - 1];
      const pieceGap = page.blocks.length > 0 ? blockGap : 0;
      const availableHeight = contentHeight - page.usedHeight - pieceGap;
      let pieceText = "";
      let nextAtomIndex = atomIndex;
      while (nextAtomIndex < atoms.length) {
        const candidate = `${pieceText}${atoms[nextAtomIndex]}`;
        if (await measuredHeightAsync(measureBlock, { ...block, text: candidate }, context) > availableHeight) break;
        pieceText = candidate;
        nextAtomIndex += 1;
      }
      if (!pieceText) {
        if (page.blocks.length > 0) {
          addPage();
          continue;
        }
        throw contentTooLong("A sentence fragment does not fit the fixed poster body size");
      }
      const piece = { ...block, text: pieceText };
      const pieceHeight = await measuredHeightAsync(measureBlock, piece, context);
      addBlock(page, piece, pieceHeight);
      atomIndex = nextAtomIndex;
      if (atomIndex < atoms.length) addPage();
    }
  }
  return pages.map((page) => ({ ...page, total: pages.length }));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sourceDate(post) {
  if (/^\d{4}\.\d{2}\.\d{2}$/u.test(post?.display || "")) return post.display;
  const source = [post?.iso, post?.id, post?.filename].find((value) => /^\d{4}-\d{2}-\d{2}/u.test(value || ""));
  if (!source) throw new Error("Note poster requires a source date");
  return source.slice(0, 10).replaceAll("-", ".");
}

function posterTitle(post) {
  if (typeof post?.authoredTitle === "string") {
    return post.authoredTitle.trim() || `碎碎念 · ${sourceDate(post)}`;
  }
  return String(post?.title || "").trim() || `碎碎念 · ${sourceDate(post)}`;
}

function siteLabel(siteUrl) {
  if (!siteUrl) return "";
  return new URL(siteUrl).hostname.replace(/^www\./u, "");
}

function xhtmlText(value) {
  return escapeXml(value).replace(/\n/g, "<br />");
}

function pageSvg({ page, title, date, cast, castData, author, site, contentHeight, blockGap }) {
  const character = page.number === 1 && castData
    ? `<g data-cast="${escapeXml(cast)}">
        <circle cx="925" cy="1195" r="92" fill="#f7f3e9" stroke="#275ba8" stroke-width="4" />
        <image x="837" y="1107" width="176" height="176" href="data:image/jpeg;base64,${castData}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cast-clip)" />
      </g>`
    : "";
  const footerText = page.number === page.total && (author || site)
    ? `<text x="92" y="1334" fill="#6d7890" font-family="Menlo, Consolas, monospace" font-size="24" letter-spacing="1.2">${escapeXml([author, site].filter(Boolean).join(" · "))}</text>`
    : "";
  const blocks = page.blocks.map((block) => (
    `<div class="${classNameFor(block)}">${xhtmlText(block.text)}</div>`
  )).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOTE_POSTER_WIDTH}" height="${NOTE_POSTER_HEIGHT}" viewBox="0 0 ${NOTE_POSTER_WIDTH} ${NOTE_POSTER_HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <pattern id="paper-grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#275ba8" stroke-opacity="0.035" stroke-width="1" />
    </pattern>
    <clipPath id="cast-clip"><circle cx="925" cy="1195" r="84" /></clipPath>
  </defs>
  <rect width="1080" height="1440" fill="#f4f0e6" />
  <rect width="1080" height="1440" fill="url(#paper-grid)" />
  <rect x="0" y="0" width="18" height="1440" fill="#275ba8" />
  <text x="92" y="92" fill="#275ba8" font-family="Menlo, Consolas, monospace" font-size="22" font-weight="700" letter-spacing="3">ETHANSMC / SMALL TALK</text>
  <text x="988" y="92" text-anchor="end" fill="#6d7890" font-family="Menlo, Consolas, monospace" font-size="22">${escapeXml(date)} · ${page.number}/${page.total}</text>
  <line x1="92" y1="145" x2="988" y2="145" stroke="#8caad3" stroke-width="2" />
  <foreignObject x="92" y="${NOTE_CONTENT_Y}" width="${NOTE_CONTENT_WIDTH}" height="${contentHeight}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;flex-direction:column;gap:${blockGap}px;width:${NOTE_CONTENT_WIDTH}px;">
      <style>${BLOCK_CSS}</style>${blocks}
    </div>
  </foreignObject>
  ${character}
  ${footerText}
</svg>`;
}

async function browserSession(options = {}) {
  const { chromium } = require("playwright-core");
  const browserLaunchOptions = { headless: true, ...(options.browserLaunchOptions || {}) };
  if (options.executablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    browserLaunchOptions.executablePath = options.executablePath
      || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  } else if (!Object.hasOwn(browserLaunchOptions, "channel")) {
    browserLaunchOptions.channel = "chrome";
  }
  const browser = options.launchBrowser
    ? await options.launchBrowser(browserLaunchOptions)
    : await chromium.launch(browserLaunchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width: NOTE_POSTER_WIDTH, height: NOTE_POSTER_HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.setContent(`<!doctype html><html><head><style>${BLOCK_CSS}</style></head><body></body></html>`);
    await page.evaluate(() => document.fonts.ready);

    return {
      measureBlock: async (block, context) => page.evaluate(({ className, text, width }) => {
        const element = document.createElement("div");
        element.className = className;
        element.textContent = text;
        element.style.position = "absolute";
        element.style.visibility = "hidden";
        element.style.width = `${width}px`;
        document.body.append(element);
        const height = element.getBoundingClientRect().height;
        element.remove();
        return height;
      }, { className: classNameFor(block), text: block.text, width: context.width }),
      capture: async ({ svg, outputPath }) => {
        await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${NOTE_POSTER_WIDTH}px;height:${NOTE_POSTER_HEIGHT}px;overflow:hidden}</style></head><body>${svg}</body></html>`);
        await page.screenshot({
          path: outputPath,
          type: "png",
          clip: { x: 0, y: 0, width: NOTE_POSTER_WIDTH, height: NOTE_POSTER_HEIGHT },
        });
      },
      close: () => browser.close(),
    };
  } catch (error) {
    try {
      await browser.close();
    } catch {
      // Preserve the initialization error after attempting resource cleanup.
    }
    throw error;
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function filesFingerprint(filenames) {
  return hash(JSON.stringify(filenames.map((filename) => {
    try {
      return { filename, hash: hash(fs.readFileSync(filename)) };
    } catch (error) {
      if (error?.code === "ENOENT") return { filename, missing: true };
      throw error;
    }
  })));
}

function packageVersion(packageName) {
  try {
    const packageFilename = require.resolve(`${packageName}/package.json`);
    const packageMetadata = JSON.parse(fs.readFileSync(packageFilename, "utf8"));
    return typeof packageMetadata.version === "string" ? packageMetadata.version : "unknown";
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND" || error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") return "missing";
    throw error;
  }
}

function renderEnvironmentFingerprints(options) {
  return {
    fontFingerprint: options.fontFingerprint
      ?? (options.fontPaths ? filesFingerprint(options.fontPaths) : DEFAULT_FONT_FINGERPRINT),
    runtimeFingerprint: options.runtimeFingerprint ?? DEFAULT_RUNTIME_FINGERPRINT,
  };
}

function castAsset(cast, assetPaths) {
  if (cast === "none") return { data: null, hash: null };
  const assetPath = assetPaths[cast];
  const data = fs.readFileSync(assetPath);
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    throw new Error(`Note character asset must be a JPEG: ${assetPath}`);
  }
  return { data: data.toString("base64"), hash: hash(data) };
}

async function noteRenderInputHash(post, options = {}) {
  const cast = options.resolvedCast || await selectNoteCast(post, {
    classify: options.classify,
    confidenceThreshold: options.confidenceThreshold,
    timeoutMs: options.classificationTimeoutMs,
  });
  const assetPaths = { ...DEFAULT_CAST_ASSETS, ...(options.assetPaths || {}) };
  const asset = castAsset(cast, assetPaths);
  const environment = renderEnvironmentFingerprints(options);
  const renderInputHash = hash(JSON.stringify({
    template: NOTE_POSTER_TEMPLATE_VERSION,
    rendererFingerprint: options.rendererFingerprint ?? DEFAULT_RENDERER_FINGERPRINT,
    font: NOTE_FONT_IDENTITY,
    fontFingerprint: environment.fontFingerprint,
    runtimeFingerprint: environment.runtimeFingerprint,
    dimensions: [NOTE_POSTER_WIDTH, NOTE_POSTER_HEIGHT],
    contentHeight: options.contentHeight ?? NOTE_CONTENT_HEIGHT,
    blockGap: options.blockGap ?? NOTE_BLOCK_GAP,
    author: String(options.author || "").trim(),
    site: siteLabel(options.siteUrl),
    cast,
    castAssetHash: asset.hash,
  }));
  return { renderInputHash, cast };
}

async function renderNotePosters(post, options = {}) {
  const contentHeight = options.contentHeight ?? NOTE_CONTENT_HEIGHT;
  const blockGap = options.blockGap ?? NOTE_BLOCK_GAP;
  const injectedMeasure = options.measureBlock || options.measure;
  let session = null;
  const ensureSession = async () => {
    if (!session) session = await browserSession(options);
    return session;
  };

  try {
    const cast = options.resolvedCast || await selectNoteCast(post, {
      classify: options.classify,
      confidenceThreshold: options.confidenceThreshold,
      timeoutMs: options.classificationTimeoutMs,
    });
    const assetPaths = { ...DEFAULT_CAST_ASSETS, ...(options.assetPaths || {}) };
    const asset = castAsset(cast, assetPaths);
    const blocks = posterBlocks(post);
    const pages = injectedMeasure
      ? paginateBlocksSync(blocks, {
        contentHeight,
        blockGap,
        measureBlock: injectedMeasure,
      })
      : await paginateBlocksAsync(blocks, {
        contentHeight,
        blockGap,
        measureBlock: (await ensureSession()).measureBlock,
      });
    const date = sourceDate(post);
    const title = posterTitle(post);
    const author = String(options.author || "").trim();
    const site = siteLabel(options.siteUrl);
    const environment = renderEnvironmentFingerprints(options);
    const renderHash = hash(JSON.stringify({
      template: NOTE_POSTER_TEMPLATE_VERSION,
      rendererFingerprint: options.rendererFingerprint ?? DEFAULT_RENDERER_FINGERPRINT,
      font: NOTE_FONT_IDENTITY,
      fontFingerprint: environment.fontFingerprint,
      runtimeFingerprint: environment.runtimeFingerprint,
      dimensions: [NOTE_POSTER_WIDTH, NOTE_POSTER_HEIGHT],
      contentHeight,
      blockGap,
      title,
      date,
      author,
      site,
      cast,
      castAssetHash: asset.hash,
      pages: pages.map((page) => page.blocks.map(({ type, text }) => ({ type, text }))),
    }));
    const outputDir = options.outputDir
      ? path.resolve(options.outputDir)
      : fs.mkdtempSync(path.join(os.tmpdir(), "wechat-note-poster-"));
    fs.mkdirSync(outputDir, { recursive: true });
    const capture = options.capture || (await ensureSession()).capture;
    const files = [];

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const outputPath = path.join(outputDir, `page-${String(index + 1).padStart(2, "0")}.png`);
      const svg = pageSvg({
        page,
        title,
        date,
        cast,
        castData: asset.data,
        author,
        site,
        contentHeight,
        blockGap,
      });
      const captured = await capture({
        svg,
        outputPath,
        width: NOTE_POSTER_WIDTH,
        height: NOTE_POSTER_HEIGHT,
        index,
        page,
      });
      if (Buffer.isBuffer(captured) || captured instanceof Uint8Array) {
        fs.writeFileSync(outputPath, captured);
      }
      files.push(outputPath);
    }

    return { pages, files, renderHash, cast };
  } finally {
    if (session) await session.close();
  }
}

module.exports = {
  NOTE_POSTER_HEIGHT,
  NOTE_POSTER_WIDTH,
  noteRenderInputHash,
  paginateNote,
  renderNotePosters,
};
