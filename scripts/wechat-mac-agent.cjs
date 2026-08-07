#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadEnvFile, parseEnv } = require("./wechat/env.cjs");

const ROOT = path.resolve(__dirname, "..");
const LABEL = "com.ethansmc.wechat-draft-sync";
const DEFAULT_INTERVAL_SECONDS = 300;
const LOCK_INITIALIZATION_GRACE_MS = 5_000;
const PRIVATE_ENVIRONMENT_DEFAULTS = Object.freeze([
  "WECHAT_AUTO_PUBLISH=0",
  "WECHAT_AUTO_WITHDRAW=0",
  "WECHAT_BROWSER_CHANNEL=chrome",
  "WECHAT_BROWSER_HEADLESS=0",
]);

function parseArguments(argv) {
  const options = {
    command: "status",
    interval: null,
    repo: null,
    branch: null,
    dryRun: false,
    force: false,
  };
  const values = [...argv];
  if (values[0] && !values[0].startsWith("-")) options.command = values.shift();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") continue;
    if (value === "--interval") options.interval = Number(values[++index]);
    else if (value === "--repo") options.repo = values[++index];
    else if (value === "--branch") options.branch = values[++index];
    else if (value === "--dry-run") options.dryRun = true;
    else if (value === "--force") options.force = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`未知参数：${value}`);
  }
  if (!new Set(["install", "run", "status", "uninstall"]).has(options.command)) {
    throw new Error(`未知命令：${options.command}`);
  }
  if (options.interval !== null && (!Number.isInteger(options.interval) || options.interval < 60)) {
    throw new Error("--interval 必须是不小于 60 的整数秒数");
  }
  if ((values.includes("--repo") && !options.repo) || (values.includes("--branch") && !options.branch)) {
    throw new Error("--repo 和 --branch 后必须提供值");
  }
  if (options.command !== "run" && (options.dryRun || options.force)) {
    throw new Error("--dry-run 和 --force 只能与 run 命令一起使用");
  }
  return options;
}

function usage() {
  return `Mac 微信公众号草稿后台同步\n\n用法：\n  bun scripts/wechat-mac-agent.cjs install\n  bun scripts/wechat-mac-agent.cjs run [--dry-run | --force]\n  bun scripts/wechat-mac-agent.cjs status\n  bun scripts/wechat-mac-agent.cjs uninstall\n\n选项：\n  --repo URL       覆盖 Git 仓库地址\n  --branch NAME    覆盖同步分支，默认 main\n  --interval SEC   后台检查间隔，最小 60 秒，默认 300 秒\n  --dry-run        只渲染和校验，不访问微信\n  --force          强制更新或重建草稿，不发布或删除\n`;
}

function agentPaths(env = process.env, home = os.homedir()) {
  const agentHome = path.resolve(
    env.WECHAT_AGENT_HOME || path.join(home, "Library", "Application Support", "EthanSMC", "WeChat Draft Sync"),
  );
  return {
    agentHome,
    checkout: path.resolve(env.WECHAT_AGENT_CHECKOUT || path.join(agentHome, "repo")),
    envFile: path.resolve(env.WECHAT_ENV_FILE || path.join(agentHome, "wechat.env")),
    stateFile: path.resolve(env.WECHAT_SYNC_STATE_FILE || path.join(agentHome, "state.json")),
    browserProfile: path.join(agentHome, "browser-profile"),
    diagnosticsDir: path.join(agentHome, "diagnostics"),
    lastRunFile: path.join(agentHome, "last-run.json"),
    lockDir: path.join(agentHome, "run.lock"),
    logDir: path.join(home, "Library", "Logs", "EthanSMC"),
    plistFile: path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`),
  };
}

function command(commandName, args, { cwd = ROOT, env = process.env, allowFailure = false, logger = null } = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (logger && result.stdout) logger(result.stdout.trimEnd());
  if (logger && result.stderr) logger(result.stderr.trimEnd());
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${commandName} ${args.join(" ")} 执行失败${detail ? `：${detail}` : ""}`);
  }
  return result;
}

function findExecutable(name, candidates = []) {
  const located = command("/usr/bin/which", [name], { allowFailure: true });
  if (located.status === 0 && located.stdout.trim()) return located.stdout.trim();
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next known installation path.
    }
  }
  return null;
}

function gitOutput(args, cwd) {
  return command("/usr/bin/git", args, { cwd }).stdout.trim();
}

function repositoryUrl(options) {
  if (options.repo) return options.repo;
  if (process.env.WECHAT_REPO_URL) return process.env.WECHAT_REPO_URL;
  return gitOutput(["remote", "get-url", "origin"], ROOT);
}

function environmentTemplate({ repoUrl, branch, stateFile }) {
  return `# 微信公众号 API 凭据；只保存在这台 Mac，不提交到 Git。\nWECHAT_APP_ID=\nWECHAT_APP_SECRET=\n\n# 后台同步来源。\nWECHAT_REPO_URL=${repoUrl}\nWECHAT_SYNC_BRANCH=${branch}\nWECHAT_SYNC_REMOTE=origin\nWECHAT_SYNC_STATE_FILE=${stateFile}\n\nSITE_URL=https://ethansmc-personal-page.vercel.app\nWECHAT_AUTHOR=申名翀 Ethan\n\n# 浏览器生命周期默认关闭；完成单独验收后再逐项改为 1。\n${PRIVATE_ENVIRONMENT_DEFAULTS.join("\n")}\n\n# 默认取文章第一张本地图片作为封面；需要固定封面时取消下一行注释。\n# WECHAT_DEFAULT_COVER=assets/share-card-writing.png\n`;
}

function missingEnvironmentLines(source) {
  const configured = parseEnv(source);
  return PRIVATE_ENVIRONMENT_DEFAULTS.filter((line) => {
    const key = line.slice(0, line.indexOf("="));
    return !Object.hasOwn(configured, key);
  });
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function createPlist({ bunPath, checkout, envFile, agentHome, interval, logDir }) {
  const values = { bunPath, checkout, envFile, agentHome, logDir };
  for (const [name, value] of Object.entries(values)) {
    if (!path.isAbsolute(value)) throw new Error(`${name} 必须是绝对路径`);
  }
  if (!Number.isInteger(interval) || interval < 60) throw new Error("后台检查间隔必须不小于 60 秒");
  const script = path.join(checkout, "scripts", "wechat-mac-agent.cjs");
  const stdout = path.join(logDir, "wechat-draft-sync.log");
  const stderr = path.join(logDir, "wechat-draft-sync.error.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(bunPath)}</string>
    <string>${xmlEscape(script)}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(checkout)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WECHAT_AGENT_HOME</key>
    <string>${xmlEscape(agentHome)}</string>
    <key>WECHAT_ENV_FILE</key>
    <string>${xmlEscape(envFile)}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
</dict>
</plist>
`;
}

function writePrivateFile(filename, content) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function saveLastRun(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function dependenciesChanged(checkout, before, after) {
  if (!fs.existsSync(path.join(checkout, "node_modules", "markdown-it"))) return true;
  if (!before || before === after) return false;
  const result = command("/usr/bin/git", [
    "diff", "--quiet", before, after, "--", "package.json", "pnpm-lock.yaml",
  ], { cwd: checkout, allowFailure: true });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error("无法判断依赖文件是否发生变化");
}

function installDependencies(checkout, bunPath, logger = console.log) {
  logger("安装后台副本依赖…");
  command(bunPath, ["install", "--no-save", "--ignore-scripts"], { cwd: checkout, logger });
}

function updateCheckout({ checkout, remote, branch, bunPath, logger = console.log }) {
  const dirty = gitOutput(["status", "--porcelain", "--untracked-files=no"], checkout);
  if (dirty) throw new Error("后台专用仓库存在已跟踪的本地改动，请检查后重新安装 Agent");
  const before = gitOutput(["rev-parse", "HEAD"], checkout);
  logger(`检查 ${remote}/${branch}…`);
  command("/usr/bin/git", ["fetch", "--quiet", remote, branch], { cwd: checkout });
  const target = gitOutput(["rev-parse", "FETCH_HEAD"], checkout);
  if (before !== target) {
    command("/usr/bin/git", ["merge", "--ff-only", "--quiet", "FETCH_HEAD"], { cwd: checkout });
    logger(`已更新后台副本：${before.slice(0, 7)} → ${target.slice(0, 7)}`);
  }
  const after = gitOutput(["rev-parse", "HEAD"], checkout);
  if (dependenciesChanged(checkout, before, after)) installDependencies(checkout, bunPath, logger);
  return { before, after };
}

function acquireLock(paths, logger = console.log) {
  try {
    fs.mkdirSync(paths.lockDir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let ownerPid = null;
    try {
      ownerPid = JSON.parse(fs.readFileSync(path.join(paths.lockDir, "owner.json"), "utf8")).pid;
    } catch {
      // A missing or incomplete owner file is treated as a stale lock below.
    }
    let ownerIsRunning = false;
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        ownerIsRunning = true;
      } catch (ownerError) {
        ownerIsRunning = ownerError.code === "EPERM";
      }
    }
    const age = Date.now() - fs.statSync(paths.lockDir).mtimeMs;
    if (ownerIsRunning || (ownerPid === null && age < LOCK_INITIALIZATION_GRACE_MS)) {
      logger("已有公众号同步任务正在运行，本次跳过。");
      return false;
    }
    fs.rmSync(paths.lockDir, { recursive: true, force: true });
    fs.mkdirSync(paths.lockDir, { mode: 0o700 });
  }
  fs.writeFileSync(path.join(paths.lockDir, "owner.json"), `${JSON.stringify({ pid: process.pid })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return true;
}

function releaseLock(paths) {
  fs.rmSync(paths.lockDir, { recursive: true, force: true });
}

function runAgent({
  logger = console.log,
  dryRun = false,
  force = false,
  paths: providedPaths = null,
  bunPath: providedBunPath = null,
  commandRunner = command,
  updateCheckoutRunner = updateCheckout,
} = {}) {
  let paths = providedPaths || agentPaths();
  loadEnvFile(ROOT, paths.envFile);
  if (!providedPaths) paths = agentPaths();
  fs.mkdirSync(paths.agentHome, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(path.join(paths.checkout, ".git"))) {
    throw new Error(`后台专用仓库不存在，请先运行 install：${paths.checkout}`);
  }
  if (!acquireLock(paths, logger)) return { skipped: true };

  const startedAt = new Date().toISOString();
  try {
    const bunPath = providedBunPath || process.env.WECHAT_BUN_PATH || findExecutable("bun", [
      "/opt/homebrew/bin/bun",
      "/usr/local/bin/bun",
    ]);
    if (!bunPath) throw new Error("未找到 Bun；请先通过 Homebrew 安装 bun");
    const branch = process.env.WECHAT_SYNC_BRANCH || "main";
    const remote = process.env.WECHAT_SYNC_REMOTE || "origin";
    const { after } = updateCheckoutRunner({ checkout: paths.checkout, remote, branch, bunPath, logger });
    const syncScript = path.join(paths.checkout, "scripts", "wechat-sync.cjs");
    const childEnv = {
      ...process.env,
      WECHAT_ENV_FILE: paths.envFile,
      WECHAT_SYNC_STATE_FILE: paths.stateFile,
      WECHAT_AGENT_HOME: paths.agentHome,
    };
    logger("检查微信公众号草稿…");
    const syncArguments = [syncScript, "--automatic"];
    if (dryRun) syncArguments.push("--dry-run");
    if (force) syncArguments.push("--force");
    commandRunner(bunPath, syncArguments, { cwd: paths.checkout, env: childEnv, logger });

    logger("检查微信公众号发布生命周期…");
    const publisherScript = path.join(paths.checkout, "scripts", "wechat-publish.cjs");
    const publisherArguments = [publisherScript, "run", "--automatic"];
    if (dryRun) publisherArguments.push("--dry-run");
    commandRunner(bunPath, publisherArguments, { cwd: paths.checkout, env: childEnv, logger });
    const result = {
      status: "success",
      mode: dryRun ? "dry-run" : force ? "force" : "automatic",
      startedAt,
      finishedAt: new Date().toISOString(),
      commit: after,
    };
    saveLastRun(paths.lastRunFile, result);
    return result;
  } catch (error) {
    saveLastRun(paths.lastRunFile, {
      status: "failure",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  } finally {
    releaseLock(paths);
  }
}

function cloneCheckout({ checkout, repoUrl, branch, logger = console.log }) {
  if (fs.existsSync(path.join(checkout, ".git"))) return;
  if (fs.existsSync(checkout) && fs.readdirSync(checkout).length > 0) {
    throw new Error(`后台副本目录已存在且不是 Git 仓库：${checkout}`);
  }
  fs.mkdirSync(path.dirname(checkout), { recursive: true, mode: 0o700 });
  logger(`创建后台专用仓库副本：${checkout}`);
  command("/usr/bin/git", [
    "clone", "--quiet", "--single-branch", "--branch", branch, repoUrl, checkout,
  ]);
}

function launchctlDomain() {
  return `gui/${process.getuid()}`;
}

function installAgent(options, { logger = console.log } = {}) {
  if (process.platform !== "darwin") throw new Error("后台 Agent 安装仅支持 macOS");
  let paths = agentPaths();
  loadEnvFile(ROOT, paths.envFile);
  paths = agentPaths();
  const bunPath = process.env.WECHAT_BUN_PATH || findExecutable("bun", [
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ]);
  if (!bunPath) throw new Error("未找到 Bun；请先运行 brew install bun");
  const branch = options.branch || process.env.WECHAT_SYNC_BRANCH || "main";
  const repoUrl = repositoryUrl(options);
  const interval = options.interval || Number(process.env.WECHAT_POLL_INTERVAL || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isInteger(interval) || interval < 60) throw new Error("WECHAT_POLL_INTERVAL 必须是不小于 60 的整数");

  fs.mkdirSync(paths.agentHome, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.agentHome, 0o700);
  fs.chmodSync(paths.logDir, 0o700);
  if (!fs.existsSync(paths.envFile)) {
    writePrivateFile(paths.envFile, environmentTemplate({ repoUrl, branch, stateFile: paths.stateFile }));
    logger(`已创建私密配置模板：${paths.envFile}`);
  }
  fs.chmodSync(paths.envFile, 0o600);
  cloneCheckout({ checkout: paths.checkout, repoUrl, branch, logger });
  updateCheckout({
    checkout: paths.checkout,
    remote: process.env.WECHAT_SYNC_REMOTE || "origin",
    branch,
    bunPath,
    logger,
  });
  const agentScript = path.join(paths.checkout, "scripts", "wechat-mac-agent.cjs");
  if (!fs.existsSync(agentScript)) {
    throw new Error("远端分支还没有 Mac Agent 代码；请先提交并推送本次改动，再重新安装");
  }

  const plist = createPlist({
    bunPath,
    checkout: paths.checkout,
    envFile: paths.envFile,
    agentHome: paths.agentHome,
    interval,
    logDir: paths.logDir,
  });
  fs.mkdirSync(path.dirname(paths.plistFile), { recursive: true });
  fs.writeFileSync(paths.plistFile, plist, { encoding: "utf8", mode: 0o644 });

  const domain = launchctlDomain();
  command("/bin/launchctl", ["bootout", domain, paths.plistFile], { allowFailure: true });
  command("/bin/launchctl", ["bootstrap", domain, paths.plistFile]);
  command("/bin/launchctl", ["enable", `${domain}/${LABEL}`]);
  command("/bin/launchctl", ["kickstart", "-k", `${domain}/${LABEL}`]);
  logger(`Mac Agent 已安装，每 ${interval} 秒检查一次 GitHub。`);
  logger(`请填写 ${paths.envFile} 中的 WECHAT_APP_ID 和 WECHAT_APP_SECRET。`);
  return paths;
}

function uninstallAgent({ logger = console.log } = {}) {
  const paths = agentPaths();
  command("/bin/launchctl", ["bootout", launchctlDomain(), paths.plistFile], { allowFailure: true });
  if (fs.existsSync(paths.plistFile)) fs.unlinkSync(paths.plistFile);
  logger("Mac Agent 已停用。凭据、同步状态、日志和后台仓库副本均已保留，可重新安装恢复。 ");
  return paths;
}

function statusAgent({
  logger = console.log,
  paths: providedPaths = null,
  commandRunner = command,
} = {}) {
  let paths = providedPaths || agentPaths();
  loadEnvFile(ROOT, paths.envFile);
  if (!providedPaths) paths = agentPaths();
  const service = commandRunner("/bin/launchctl", ["print", `${launchctlDomain()}/${LABEL}`], {
    allowFailure: true,
  });
  logger(`LaunchAgent：${service.status === 0 ? "已加载" : "未加载"}`);
  logger(`后台仓库：${fs.existsSync(path.join(paths.checkout, ".git")) ? paths.checkout : "未创建"}`);
  logger(`私密配置：${fs.existsSync(paths.envFile) ? paths.envFile : "未创建"}`);
  if (fs.existsSync(paths.envFile)) {
    const missing = missingEnvironmentLines(fs.readFileSync(paths.envFile, "utf8"));
    if (missing.length > 0) {
      logger("私密配置缺少以下设置；请复制到私密配置文件末尾：");
      for (const line of missing) logger(line);
    }
  }
  if (fs.existsSync(paths.lastRunFile)) {
    try {
      const lastRun = JSON.parse(fs.readFileSync(paths.lastRunFile, "utf8"));
      logger(`最近执行：${lastRun.finishedAt || "未知"} / ${lastRun.status || "未知"}`);
      if (lastRun.mode) logger(`执行模式：${lastRun.mode}`);
      if (lastRun.commit) logger(`同步提交：${lastRun.commit}`);
      if (lastRun.error) logger(`最近错误：${lastRun.error}`);
    } catch {
      logger("最近执行：状态文件无法读取");
    }
  } else {
    logger("最近执行：暂无记录");
  }
  return { loaded: service.status === 0, paths };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.command === "install") installAgent(options);
  else if (options.command === "run") runAgent({ dryRun: options.dryRun, force: options.force });
  else if (options.command === "uninstall") uninstallAgent();
  else statusAgent();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  LABEL,
  agentPaths,
  createPlist,
  dependenciesChanged,
  environmentTemplate,
  missingEnvironmentLines,
  parseArguments,
  runAgent,
  statusAgent,
  updateCheckout,
  usage,
  xmlEscape,
};
