#!/usr/bin/env node
const path = require("node:path");

const { loadEnvFile } = require("./wechat/env.cjs");
const { syncWechatDrafts } = require("./wechat/sync.cjs");

const ROOT = path.resolve(__dirname, "..");

function parseArguments(argv) {
  const options = { range: null, dryRun: false, force: false, automatic: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--dry-run") options.dryRun = true;
    else if (value === "--force") options.force = true;
    else if (value === "--automatic") options.automatic = true;
    else if (value === "--range") {
      options.range = argv[index + 1];
      index += 1;
      if (!options.range) throw new Error("--range requires a git revision range");
    } else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function usage() {
  return `微信公众号草稿同步\n\n用法：\n  pnpm wechat:sync -- --dry-run\n  pnpm wechat:sync\n  pnpm wechat:sync -- --range BEFORE..AFTER\n  pnpm wechat:sync -- --force\n`;
}

function configuration() {
  const site = require("../_data/site.js")();
  return {
    appId: process.env.WECHAT_APP_ID,
    appSecret: process.env.WECHAT_APP_SECRET,
    author: process.env.WECHAT_AUTHOR || site.author,
    siteUrl: process.env.SITE_URL || site.url,
    defaultCover: process.env.WECHAT_DEFAULT_COVER || "",
    stateFile: process.env.WECHAT_SYNC_STATE_FILE
      ? path.resolve(ROOT, process.env.WECHAT_SYNC_STATE_FILE)
      : path.join(ROOT, ".wechat-sync", "state.json"),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  loadEnvFile(ROOT);
  const config = configuration();
  if (!options.dryRun && (!config.appId || !config.appSecret)) {
    if (options.automatic) {
      console.log("公众号草稿同步未配置，跳过本次自动任务。");
      return;
    }
    throw new Error("请在私密环境变量文件或 .env.local 中设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET");
  }
  await syncWechatDrafts({ root: ROOT, ...options, config });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { configuration, main, parseArguments, usage };
