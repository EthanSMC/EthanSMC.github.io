#!/usr/bin/env node
const os = require("node:os");
const path = require("node:path");

const { loadEnvFile } = require("./wechat/env.cjs");
const { launchWechatContext } = require("./wechat/browser-session.cjs");
const { WechatBrowserAdapter } = require("./wechat/browser-publisher.cjs");
const { loadState, saveState } = require("./wechat/state.cjs");
const {
  POST_ID_PATTERN,
  arm,
  resolveRecord,
  runLifecycle,
  statusSummary,
} = require("./wechat/publisher.cjs");

const ROOT = path.resolve(__dirname, "..");

function requirePostId(value) {
  if (!POST_ID_PATTERN.test(value || "")) throw new Error("需要有效的时间戳文章 ID。");
  return value;
}

function parseArguments(argv) {
  const values = argv.filter((value) => value !== "--");
  const command = values[0];
  if (["login", "arm", "status"].includes(command)) {
    if (values.length !== 1) throw new Error(`${command} 命令包含不支持的参数。`);
    return { command };
  }
  if (command === "run") {
    const options = { command, dryRun: false, automatic: false, retry: null };
    for (let index = 1; index < values.length; index += 1) {
      const value = values[index];
      if (value === "--dry-run") options.dryRun = true;
      else if (value === "--automatic") options.automatic = true;
      else if (value === "--retry") {
        options.retry = requirePostId(values[index + 1]);
        index += 1;
      } else throw new Error(`run 命令包含不支持的参数：${value}`);
    }
    return options;
  }
  if (command === "resolve") {
    const postId = requirePostId(values[1]);
    const flag = values[2];
    if (flag === "--published") {
      if (!values[3]) throw new Error("--published 需要 URL。");
      if (values.length !== 4) throw new Error("resolve 命令包含多余参数。");
      try {
        new URL(values[3]);
      } catch {
        throw new Error("--published 需要有效 URL。");
      }
      return { command, postId, resolution: "published", url: values[3] };
    }
    const resolutions = {
      "--not-published": "not-published",
      "--withdrawn": "withdrawn",
      "--still-published": "still-published",
    };
    if (!resolutions[flag]) throw new Error("resolve 命令需要明确的解决方式。");
    if (values.length !== 3) throw new Error("resolve 命令包含多余参数。");
    return { command, postId, resolution: resolutions[flag] };
  }
  if (command === "--help" || command === "-h" || !command) return { command: "help" };
  throw new Error(`未知的公众号发布命令：${command}`);
}

function usage() {
  return [
    "微信公众号浏览器发布器",
    "",
    "用法：",
    "  login",
    "  arm",
    "  status",
    "  run [--dry-run] [--automatic] [--retry POST_ID]",
    "  resolve POST_ID --published URL",
    "  resolve POST_ID --not-published",
    "  resolve POST_ID --withdrawn",
    "  resolve POST_ID --still-published",
    "",
  ].join("\n");
}

function configuration(root, env = process.env) {
  return {
    root,
    stateFile: env.WECHAT_SYNC_STATE_FILE
      ? path.resolve(root, env.WECHAT_SYNC_STATE_FILE)
      : path.join(root, ".wechat-sync", "state.json"),
    agentHome: env.WECHAT_AGENT_HOME
      ? path.resolve(env.WECHAT_AGENT_HOME)
      : path.join(os.homedir(), "Library", "Application Support", "EthanSMC", "WeChat Draft Sync"),
    channel: env.WECHAT_BROWSER_CHANNEL || "chrome",
    headless: env.WECHAT_BROWSER_HEADLESS === "1",
    autoPublish: env.WECHAT_AUTO_PUBLISH === "1",
    autoWithdraw: env.WECHAT_AUTO_WITHDRAW === "1",
  };
}

async function defaultOpenAdapter(config, headed = false) {
  const context = await launchWechatContext({
    agentHome: config.agentHome,
    channel: config.channel,
    headless: headed ? false : config.headless,
  });
  try {
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto("https://mp.weixin.qq.com/");
    return {
      adapter: new WechatBrowserAdapter(page),
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function waitForLogin(adapter, options = {}) {
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + (options.timeoutMs || 300_000);
  while (Date.now() < deadline) {
    try {
      const session = await adapter.checkSession();
      if (session?.authenticated) return;
    } catch {
      // Navigation between the QR page and dashboard is transient during login.
    }
    await sleep(1_000);
  }
  throw new Error("微信浏览器登录等待超时，请重新运行 login。");
}

async function main(dependencies = {}) {
  const root = dependencies.root || ROOT;
  const argv = dependencies.argv || process.argv.slice(2);
  const output = dependencies.output || ((line) => process.stdout.write(`${line}\n`));
  const env = dependencies.env || process.env;
  const options = parseArguments(argv);
  if (options.command === "help") {
    output(usage().trimEnd());
    return;
  }
  (dependencies.loadEnvFile || loadEnvFile)(root);
  const config = configuration(root, env);
  const now = dependencies.now || (() => new Date());
  const openAdapter = dependencies.openAdapter
    || (() => defaultOpenAdapter(config));

  if (options.command === "arm") {
    const result = arm({
      root,
      stateFile: config.stateFile,
      now,
      announce: (count) => output(`自动发布基线文章数：${count}`),
    });
    if (result.alreadyArmed) output("自动发布器已经建立基线，本次未修改。");
    return result;
  }
  if (options.command === "status") {
    const summary = statusSummary(loadState(config.stateFile));
    output(JSON.stringify(summary, null, 2));
    return summary;
  }
  if (options.command === "resolve") {
    const result = resolveRecord({
      root,
      stateFile: config.stateFile,
      postId: options.postId,
      resolution: options.resolution,
      url: options.url,
      now,
    });
    output(`文章 ${result.postId} 已解决为 ${result.status}。`);
    return result;
  }
  if (options.command === "login") {
    const opened = dependencies.openLoginAdapter
      ? await dependencies.openLoginAdapter()
      : await defaultOpenAdapter(config, true);
    try {
      output("请在专用 Chrome 窗口中完成微信扫码登录。");
      await waitForLogin(opened.adapter, dependencies);
      const state = loadState(config.stateFile);
      const checkedAt = now();
      state.publisher.browserSessionCheckedAt = (
        checkedAt instanceof Date ? checkedAt : new Date(checkedAt)
      ).toISOString();
      saveState(config.stateFile, state);
      output("微信浏览器登录状态已验证。");
    } finally {
      if (typeof opened.close === "function") await opened.close();
    }
    return;
  }

  const result = await runLifecycle({
    root,
    stateFile: config.stateFile,
    openAdapter,
    autoPublish: config.autoPublish,
    autoWithdraw: config.autoWithdraw,
    dryRun: options.dryRun,
    retry: options.retry,
    now,
  });
  output(JSON.stringify(result.summary, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  configuration,
  main,
  parseArguments,
  usage,
  waitForLogin,
};
