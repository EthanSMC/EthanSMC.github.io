import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  launchWechatContext,
  retainDiagnosticScreenshot,
} = require("../scripts/wechat/browser-session.cjs");
const { chromium } = require("playwright-core");
const {
  WechatBrowserAdapter,
} = require("../scripts/wechat/browser-publisher.cjs");

const temporaryDirectories = [];

function temporaryDirectory(prefix = "wechat-browser-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("launches installed Chrome with a private persistent profile", async () => {
  const agentHome = temporaryDirectory();
  const calls = [];
  const context = { close: async () => {} };
  const chromium = {
    launchPersistentContext: async (directory, options) => {
      calls.push({ directory, options });
      return context;
    },
  };

  const result = await launchWechatContext({
    agentHome,
    chromium,
    channel: "chrome",
    headless: false,
  });

  assert.equal(result, context);
  assert.deepEqual(calls, [{
    directory: path.join(agentHome, "browser-profile"),
    options: {
      channel: "chrome",
      headless: false,
      acceptDownloads: false,
    },
  }]);
  assert.equal(fs.statSync(calls[0].directory).mode & 0o777, 0o700);
});

test("sanitizes a browser profile lock error without leaking sensitive text", async () => {
  const agentHome = temporaryDirectory();
  const secretProfile = path.join(agentHome, "browser-profile");
  const chromium = {
    launchPersistentContext: async () => {
      throw new Error(`Failed to create a ProcessSingleton for ${secretProfile}; cookie=session-secret`);
    },
  };

  await assert.rejects(
    () => launchWechatContext({ agentHome, chromium }),
    (error) => {
      assert.equal(error.code, "WECHAT_BROWSER_PROFILE_LOCKED");
      assert.match(error.message, /专用浏览器配置正在被另一个进程使用/);
      assert.equal(error.message.includes(secretProfile), false);
      assert.equal(error.message.includes("session-secret"), false);
      assert.ok(error.message.length <= 120);
      return true;
    },
  );
});

test("sanitizes profile-directory filesystem failures", async () => {
  const agentHome = temporaryDirectory();
  const blockedHome = path.join(agentHome, "private-cookie=session-secret");
  fs.writeFileSync(blockedHome, "not a directory");
  let launched = false;

  await assert.rejects(
    () => launchWechatContext({
      agentHome: blockedHome,
      chromium: {
        launchPersistentContext: async () => {
          launched = true;
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "WECHAT_BROWSER_PROFILE_IO_FAILED");
      assert.match(error.message, /无法准备 Chrome 专用浏览器配置/);
      assert.equal(error.message.includes(blockedHome), false);
      assert.equal(error.message.includes("session-secret"), false);
      assert.ok(error.message.length <= 120);
      return true;
    },
  );
  assert.equal(launched, false);
});

test("retains only three private diagnostic screenshots", async () => {
  const agentHome = temporaryDirectory();
  let timestamp = Date.parse("2026-08-07T08:00:00.000Z");
  const page = {
    screenshot: async ({ path: screenshotPath, type }) => {
      assert.equal(type, "png");
      fs.writeFileSync(screenshotPath, "not-a-real-png", { mode: 0o644 });
    },
  };

  for (let index = 0; index < 4; index += 1) {
    await retainDiagnosticScreenshot({
      agentHome,
      page,
      label: `failure-${index}`,
      now: () => new Date(timestamp++),
    });
  }

  const diagnosticsDirectory = path.join(agentHome, "diagnostics");
  const screenshots = fs.readdirSync(diagnosticsDirectory).sort();
  assert.equal(fs.statSync(diagnosticsDirectory).mode & 0o777, 0o700);
  assert.equal(screenshots.length, 3);
  assert.deepEqual(screenshots.map((name) => name.includes("failure-0")), [false, false, false]);
  for (const screenshot of screenshots) {
    assert.equal(fs.statSync(path.join(diagnosticsDirectory, screenshot)).mode & 0o777, 0o600);
  }
});

test("sanitizes diagnostic directory, Playwright, and screenshot filesystem failures", async () => {
  const assertSanitized = async (operation, privateText) => {
    await assert.rejects(operation, (error) => {
      assert.equal(error.code, "WECHAT_BROWSER_DIAGNOSTIC_FAILED");
      assert.match(error.message, /无法保留浏览器诊断截图/);
      assert.equal(error.message.includes(privateText), false);
      assert.equal(error.message.includes("session-secret"), false);
      assert.ok(error.message.length <= 120);
      return true;
    });
  };

  const directoryFailureRoot = temporaryDirectory();
  const blockedHome = path.join(directoryFailureRoot, "private-cookie=session-secret");
  fs.writeFileSync(blockedHome, "not a directory");
  await assertSanitized(
    () => retainDiagnosticScreenshot({
      agentHome: blockedHome,
      page: { screenshot: async () => assert.fail("screenshot must not run") },
    }),
    blockedHome,
  );

  const playwrightFailureHome = temporaryDirectory();
  const privateScreenshotPath = path.join(playwrightFailureHome, "diagnostics", "private.png");
  await assertSanitized(
    () => retainDiagnosticScreenshot({
      agentHome: playwrightFailureHome,
      page: {
        screenshot: async () => {
          throw new Error(`Playwright failed at ${privateScreenshotPath}; cookie=session-secret`);
        },
      },
    }),
    privateScreenshotPath,
  );

  const chmodFailureHome = temporaryDirectory();
  await assertSanitized(
    () => retainDiagnosticScreenshot({
      agentHome: chmodFailureHome,
      page: { screenshot: async () => {} },
    }),
    chmodFailureHome,
  );
});

function executableMissing(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /browserType\.launch:.*(?:executable|distribution)[^\n]*(?:does not exist|not found)/i.test(message)
    || /Executable doesn't exist/i.test(message);
}

async function startFixtureServer() {
  const fixturesDirectory = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "fixtures",
    "wechat-browser",
  );
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const filename = pathname === "/" ? "dashboard.html" : path.basename(pathname);
    const fixturePath = path.join(fixturesDirectory, filename);
    if (!filename.endsWith(".html") || !fs.existsSync(fixturePath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fs.readFileSync(fixturePath));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("deterministic WeChat page adapter works against semantic fixtures", async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (error) {
    if (executableMissing(error)) {
      t.skip("installed Chrome channel is unavailable");
      return;
    }
    throw error;
  }

  const fixtureServer = await startFixtureServer();
  try {
    const page = await browser.newPage();
    const adapter = new WechatBrowserAdapter(page);
    const draftPost = {
      title: "唯一草稿",
      sourceUrl: "https://ethansmc.com/posts/draft/",
      platformArticleId: "wx-draft-1",
    };
    const publishedPost = {
      title: "已发表文章",
      sourceUrl: "https://ethansmc.com/posts/published/",
      platformArticleId: "wx-published-1",
    };

    await t.test("checks an authenticated dashboard and finds one exact draft", async () => {
      await page.goto(`${fixtureServer.baseUrl}/dashboard.html`);
      assert.deepEqual(await adapter.checkSession(), { authenticated: true });
      const candidate = await adapter.findDraftCandidate(draftPost);
      assert.deepEqual(candidate, {
        kind: "exact",
        title: draftPost.title,
        href: `${fixtureServer.baseUrl}/drafts.html?content_source_url=https%3A%2F%2Fethansmc.com%2Fposts%2Fdraft%2F&appmsgid=wx-draft-1#editor`,
      });
    });

    await t.test("rejects zero, duplicate, and conflicting exact draft candidates distinctly", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      await assert.rejects(
        () => adapter.findDraftCandidate({ title: "不存在", sourceUrl: "https://example.com/missing" }),
        /未找到同名草稿/,
      );
      await assert.rejects(
        () => adapter.findDraftCandidate({ title: "重复草稿", sourceUrl: "https://ethansmc.com/posts/duplicate/" }),
        /找到多个同名草稿/,
      );
      await assert.rejects(
        () => adapter.findDraftCandidate({
          title: "来源冲突草稿",
          sourceUrl: "https://ethansmc.com/posts/expected/",
          platformArticleId: "wx-expected",
        }),
        /草稿元数据与目标文章冲突/,
      );
    });

    await t.test("rejects every conflicting source URL alias occurrence", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      await assert.rejects(
        () => adapter.findDraftCandidate({
          title: "来源别名冲突草稿",
          sourceUrl: "https://ethansmc.com/posts/source-alias/",
          platformArticleId: "wx-source-alias",
        }),
        /草稿元数据与目标文章冲突/,
      );
    });

    await t.test("rejects every conflicting platform ID alias occurrence", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      await assert.rejects(
        () => adapter.findDraftCandidate({
          title: "平台别名冲突草稿",
          sourceUrl: "https://ethansmc.com/posts/platform-alias/",
          platformArticleId: "wx-platform-alias",
        }),
        /草稿元数据与目标文章冲突/,
      );
    });

    await t.test("opens the selected draft and publishes with one primary and one confirmation click", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      const candidate = await adapter.findDraftCandidate(draftPost);
      await adapter.openDraft(candidate);
      await adapter.publishCurrentDraft(draftPost);
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-publish]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=decoy-publish]").textContent(), "0");
    });

    await t.test("rejects changed publish confirmation text without confirming", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      await page.locator("[data-confirm=publish]").evaluate((element) => {
        element.textContent = "继续发表";
      });
      await assert.rejects(
        () => adapter.publishCurrentDraft(draftPost),
        /发布确认内容与预期不符/,
      );
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-publish]").textContent(), "0");
    });

    await t.test("rejects unexpected dialog text even when confirmation buttons are unchanged", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      await page.locator("[data-confirmation-prompt=publish]").evaluate((element) => {
        element.textContent = "确认发表到另一个公众号吗？";
      });
      await assert.rejects(
        () => adapter.publishCurrentDraft(draftPost),
        /发布确认内容与预期不符/,
      );
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-publish]").textContent(), "0");
    });

    await t.test("rejects extra confirmation fields, links, and secondary choices", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html?extra=1`);
      await assert.rejects(
        () => adapter.publishCurrentDraft(draftPost),
        /发布确认内容与预期不符/,
      );
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-publish]").textContent(), "0");
      assert.equal(await page.locator("[data-click-count=secondary-publish]").textContent(), "0");
    });

    await t.test("rejects an unrelated simultaneous dialog with the same buttons", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html?unrelated=1`);
      await assert.rejects(
        () => adapter.publishCurrentDraft(draftPost),
        /多个发布确认对话框/,
      );
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-publish]").textContent(), "0");
      assert.equal(await page.locator("[data-click-count=unrelated-confirm]").textContent(), "0");
    });

    await t.test("finds, opens, verifies, and withdraws one published article once", async () => {
      await page.goto(`${fixtureServer.baseUrl}/published.html`);
      const candidate = await adapter.findPublishedCandidate(publishedPost);
      await adapter.openPublished(candidate);
      assert.deepEqual(await adapter.verifyPublished(publishedPost), {
        published: true,
        candidate,
      });
      await adapter.withdrawCurrentArticle(publishedPost);
      assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-withdraw]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=decoy-withdraw]").textContent(), "0");
      assert.deepEqual(await adapter.verifyWithdrawn(publishedPost), { withdrawn: true });
    });

    await t.test("rejects changed and ambiguous withdrawal controls without clicking", async () => {
      await page.goto(`${fixtureServer.baseUrl}/published.html`);
      await page.locator("[data-verified-container=published] [data-action=withdraw]").evaluate((element) => {
        element.textContent = "下架";
      });
      await assert.rejects(() => adapter.withdrawCurrentArticle(publishedPost), /未找到唯一的撤回控件/);
      assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "0");
      assert.equal(await page.locator("[data-click-count=decoy-withdraw]").textContent(), "0");

      await page.goto(`${fixtureServer.baseUrl}/published.html?ambiguous=1`);
      await assert.rejects(() => adapter.withdrawCurrentArticle(publishedPost), /找到多个撤回控件/);
      assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "0");
      assert.equal(await page.locator("[data-click-count=delete]").textContent(), "0");
      assert.equal(await page.locator("[data-click-count=decoy-withdraw]").textContent(), "0");
    });

    await t.test("rejects changed withdrawal confirmation text without confirming", async () => {
      await page.goto(`${fixtureServer.baseUrl}/published.html`);
      await page.locator("[data-confirm=withdraw]").evaluate((element) => {
        element.textContent = "继续撤回";
      });
      await assert.rejects(
        () => adapter.withdrawCurrentArticle(publishedPost),
        /撤回确认内容与预期不符/,
      );
      assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-withdraw]").textContent(), "0");
    });

    await t.test("stops when a blocker appears after the primary click", async () => {
      await page.goto(`${fixtureServer.baseUrl}/published.html?blockerAfterClick=1`);
      await assert.rejects(
        () => adapter.withdrawCurrentArticle(publishedPost),
        /微信页面要求账号验证/,
      );
      assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "1");
      assert.equal(await page.locator("[data-click-count=confirm-withdraw]").textContent(), "0");
    });

    await t.test("reports login and CAPTCHA blockers before clicking any action", async () => {
      await page.goto(`${fixtureServer.baseUrl}/login.html`);
      assert.deepEqual(await adapter.checkSession(), { authenticated: false, blocker: "login" });
      await assert.rejects(() => adapter.publishCurrentDraft(draftPost), /微信登录已失效/);
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "0");

      await page.goto(`${fixtureServer.baseUrl}/captcha.html`);
      assert.deepEqual(await adapter.checkSession(), { authenticated: false, blocker: "captcha" });
      await assert.rejects(() => adapter.withdrawCurrentArticle(publishedPost), /微信页面要求完成验证码/);
      assert.equal(await page.locator("[data-click-count=withdraw]").textContent(), "0");
    });

    await t.test("stops at account verification before the confirmation click", async () => {
      await page.goto(`${fixtureServer.baseUrl}/drafts.html`);
      await page.locator("[data-verification-message]").evaluate((element) => {
        element.hidden = false;
      });
      await assert.rejects(() => adapter.publishCurrentDraft(draftPost), /微信页面要求账号验证/);
      assert.equal(await page.locator("[data-click-count=publish]").textContent(), "0");
      assert.equal(await page.locator("[data-click-count=confirm-publish]").textContent(), "0");
    });
  } finally {
    await fixtureServer.close();
    await browser.close();
  }
});
