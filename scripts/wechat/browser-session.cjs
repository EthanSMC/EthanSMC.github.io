const fs = require("node:fs");
const path = require("node:path");

const MAX_DIAGNOSTIC_SCREENSHOTS = 3;

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function sanitizedLaunchError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const profileLocked = /ProcessSingleton|SingletonLock|profile[^\n]*(?:lock|in use)|user data directory is already in use/i.test(rawMessage);
  const result = new Error(profileLocked
    ? "无法启动 Chrome：专用浏览器配置正在被另一个进程使用。"
    : "无法启动 Chrome：浏览器会话初始化失败。");
  result.code = profileLocked
    ? "WECHAT_BROWSER_PROFILE_LOCKED"
    : "WECHAT_BROWSER_LAUNCH_FAILED";
  return result;
}

function sanitizedRuntimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function launchWechatContext(options) {
  const {
    agentHome,
    channel = "chrome",
    headless = false,
  } = options;
  const chromium = options.chromium || require("playwright-core").chromium;
  const profileDirectory = path.join(agentHome, "browser-profile");
  try {
    privateDirectory(profileDirectory);
  } catch {
    throw sanitizedRuntimeError(
      "WECHAT_BROWSER_PROFILE_IO_FAILED",
      "无法准备 Chrome 专用浏览器配置。",
    );
  }

  try {
    return await chromium.launchPersistentContext(profileDirectory, {
      channel,
      headless,
      acceptDownloads: false,
    });
  } catch (error) {
    throw sanitizedLaunchError(error);
  }
}

function safeLabel(value) {
  const sanitized = String(value || "browser-failure")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized || "browser-failure";
}

async function retainDiagnosticScreenshot(options) {
  try {
    const diagnosticsDirectory = path.join(options.agentHome, "diagnostics");
    privateDirectory(diagnosticsDirectory);
    const timestamp = (options.now ? options.now() : new Date())
      .toISOString()
      .replace(/[:.]/g, "-");
    const filename = `${timestamp}-${safeLabel(options.label)}.png`;
    const screenshotPath = path.join(diagnosticsDirectory, filename);

    await options.page.screenshot({ path: screenshotPath, type: "png" });
    fs.chmodSync(screenshotPath, 0o600);

    const screenshots = fs.readdirSync(diagnosticsDirectory)
      .filter((entry) => entry.endsWith(".png"))
      .sort();
    for (const expired of screenshots.slice(0, -MAX_DIAGNOSTIC_SCREENSHOTS)) {
      fs.rmSync(path.join(diagnosticsDirectory, expired));
    }

    return screenshotPath;
  } catch {
    throw sanitizedRuntimeError(
      "WECHAT_BROWSER_DIAGNOSTIC_FAILED",
      "无法保留浏览器诊断截图。",
    );
  }
}

module.exports = {
  launchWechatContext,
  retainDiagnosticScreenshot,
};
