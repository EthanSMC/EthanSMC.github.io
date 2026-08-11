import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBlog } = require("./scripts/prepare-content.cjs");
const { injectHomeWriting } = require("./scripts/render-home-writing.cjs");
const { renderWritingShowcase } = require("./scripts/render-writing-showcase.cjs");

export default function (eleventyConfig) {
  eleventyConfig.ignores.add("README.md");
  eleventyConfig.ignores.add("PRODUCT.md");
  eleventyConfig.ignores.add(".impeccable/**");
  eleventyConfig.ignores.add("docs/**");
  eleventyConfig.ignores.add("content/**");
  eleventyConfig.ignores.add("assets/**/*.md");
  eleventyConfig.addPassthroughCopy("assets/digital-ethan/*.png");
  eleventyConfig.addPassthroughCopy("assets/favicon.svg");
  eleventyConfig.addPassthroughCopy("assets/share-card-home.png");
  eleventyConfig.addPassthroughCopy("assets/share-card-writing.png");
  eleventyConfig.addPassthroughCopy("assets/vendor");
  eleventyConfig.addPassthroughCopy("assets/wechat-qr.jpg");
  eleventyConfig.addPassthroughCopy("styles.css");
  eleventyConfig.addPassthroughCopy("blog.css");
  eleventyConfig.addPassthroughCopy("script.js");
  eleventyConfig.addPassthroughCopy("blog.js");
  eleventyConfig.addPassthroughCopy("i18n.js");
  eleventyConfig.addPassthroughCopy("writing-carousel.js");
  eleventyConfig.addWatchTarget("content/published");
  eleventyConfig.addWatchTarget("content/assets");

  eleventyConfig.on("eleventy.before", ({ directories }) => {
    const { attachments } = loadBlog();
    for (const relativePath of attachments) {
      const source = path.join("content", "assets", relativePath);
      const destination = path.join(directories.output, "blog", "assets", relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
  });

  eleventyConfig.addFilter("plus", (value, amount = 1) => Number(value) + Number(amount));
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));
  eleventyConfig.addFilter("xmlEscape", (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;"));
  eleventyConfig.addFilter("absoluteUrl", (url, base) => new URL(url, base).href);
  eleventyConfig.addFilter("htmlToAbsoluteUrls", (html, base) => String(html).replace(
    /(src|href)=(['"])(\/[^'"]*)\2/g,
    (_, attribute, quote, url) => `${attribute}=${quote}${new URL(url, base).href}${quote}`
  ));
  eleventyConfig.addFilter("dateToRfc3339", (date) => new Date(date).toISOString());
  eleventyConfig.addFilter("dateToRfc822", (date) => new Date(date).toUTCString());
  eleventyConfig.addFilter("writingShowcase", (blog, context = "home") => (
    renderWritingShowcase(blog, { context })
  ));

  eleventyConfig.addTransform("inject-home-writing", function (content) {
    if (this.page?.inputPath !== "./index.html") return content;
    return injectHomeWriting(content, loadBlog());
  });

  return {
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["html", "njk"]
  };
}
