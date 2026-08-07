import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  LABEL,
  agentPaths,
  createPlist,
  environmentTemplate,
  missingEnvironmentLines,
  parseArguments,
  runAgent,
  statusAgent,
  updateCheckout,
} = require("../scripts/wechat-mac-agent.cjs");

const PRIVATE_ENVIRONMENT_DEFAULTS = [
  "WECHAT_AUTO_PUBLISH=0",
  "WECHAT_AUTO_WITHDRAW=0",
  "WECHAT_BROWSER_CHANNEL=chrome",
  "WECHAT_BROWSER_HEADLESS=0",
];

function git(cwd, args) {
  return execFileSync("/usr/bin/git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("parses Mac Agent commands and rejects unsafe polling intervals", () => {
  assert.deepEqual(parseArguments([]), {
    command: "status",
    interval: null,
    repo: null,
    branch: null,
    dryRun: false,
    force: false,
  });
  assert.deepEqual(parseArguments([
    "install", "--interval", "120", "--branch", "main", "--repo", "https://example.com/repo.git",
  ]), {
    command: "install",
    interval: 120,
    repo: "https://example.com/repo.git",
    branch: "main",
    dryRun: false,
    force: false,
  });
  assert.equal(parseArguments(["run", "--dry-run"]).dryRun, true);
  assert.equal(parseArguments(["run", "--", "--dry-run"]).dryRun, true);
  assert.equal(parseArguments(["run", "--force"]).force, true);
  assert.throws(() => parseArguments(["install", "--interval", "30"]), /不小于 60/);
  assert.throws(() => parseArguments(["install", "--force"]), /只能与 run/);
  assert.throws(() => parseArguments(["deploy"]), /未知命令/);
  assert.throws(() => parseArguments(["install", "--repo"]), /必须提供值/);
});

test("keeps checkout, credentials, state, and logs outside the writing workspace", () => {
  const paths = agentPaths({}, "/Users/tester");
  assert.equal(paths.agentHome, "/Users/tester/Library/Application Support/EthanSMC/WeChat Draft Sync");
  assert.equal(paths.checkout, `${paths.agentHome}/repo`);
  assert.equal(paths.envFile, `${paths.agentHome}/wechat.env`);
  assert.equal(paths.stateFile, `${paths.agentHome}/state.json`);
  assert.equal(paths.browserProfile, `${paths.agentHome}/browser-profile`);
  assert.equal(paths.diagnosticsDir, `${paths.agentHome}/diagnostics`);
  assert.equal(paths.plistFile, `/Users/tester/Library/LaunchAgents/${LABEL}.plist`);
});

test("builds a launchd plist with escaped absolute paths and a five-minute default-compatible interval", () => {
  const plist = createPlist({
    bunPath: "/opt/homebrew/bin/bun",
    checkout: "/Users/test/Library/Application Support/A&B/repo",
    envFile: "/Users/test/Library/Application Support/A&B/wechat.env",
    agentHome: "/Users/test/Library/Application Support/A&B",
    interval: 300,
    logDir: "/Users/test/Library/Logs/A&B",
  });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<integer>300<\/integer>/);
  assert.match(plist, /A&amp;B\/repo\/scripts\/wechat-mac-agent\.cjs/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  if (process.platform === "darwin") {
    const lint = execFileSync("/usr/bin/plutil", ["-lint", "-"], {
      input: plist,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.match(lint, /OK/);
  }
  assert.throws(() => createPlist({
    bunPath: "bun",
    checkout: "/tmp/repo",
    envFile: "/tmp/wechat.env",
    agentHome: "/tmp/agent",
    interval: 300,
    logDir: "/tmp/logs",
  }), /绝对路径/);
});

test("creates an external configuration template without storing an access token", () => {
  const source = environmentTemplate({
    repoUrl: "https://github.com/EthanSMC/EthanSMC.github.io.git",
    branch: "main",
    stateFile: "/private/state.json",
  });
  assert.match(source, /^WECHAT_APP_ID=$/m);
  assert.match(source, /^WECHAT_APP_SECRET=$/m);
  assert.match(source, /^WECHAT_SYNC_STATE_FILE=\/private\/state\.json$/m);
  for (const line of PRIVATE_ENVIRONMENT_DEFAULTS) {
    assert.match(source, new RegExp(`^${line}$`, "m"));
  }
  assert.doesNotMatch(source, /ACCESS_TOKEN/);
  assert.doesNotMatch(source, /WEBHOOK/);
});

function agentFixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-agent-run-test-"));
  const paths = agentPaths({ WECHAT_AGENT_HOME: path.join(temporary, "agent") }, temporary);
  fs.mkdirSync(path.join(paths.checkout, ".git"), { recursive: true });
  fs.writeFileSync(paths.envFile, `${PRIVATE_ENVIRONMENT_DEFAULTS.join("\n")}\n`);
  return { temporary, paths };
}

function successfulChild() {
  return { status: 0, stdout: "", stderr: "" };
}

test("uses --automatic only as the Agent compatibility marker in one serial lifecycle", () => {
  const fixture = agentFixture();
  const events = [];
  const calls = [];
  let syncFinished = false;
  try {
    const result = runAgent({
      paths: fixture.paths,
      bunPath: "/private/fake-bun",
      updateCheckoutRunner: ({ checkout }) => {
        events.push("checkout");
        assert.equal(checkout, fixture.paths.checkout);
        return { before: "before", after: "after" };
      },
      commandRunner: (commandName, args, options) => {
        calls.push({ commandName, args, options });
        if (path.basename(args[0]) === "wechat-sync.cjs") {
          events.push("sync:start");
          syncFinished = true;
          events.push("sync:finish");
        } else if (path.basename(args[0]) === "wechat-publish.cjs") {
          assert.equal(syncFinished, true, "publisher started before draft sync finished");
          events.push("lifecycle");
        }
        return successfulChild();
      },
      logger: () => {},
    });

    assert.deepEqual(events, ["checkout", "sync:start", "sync:finish", "lifecycle"]);
    assert.deepEqual(calls.map(({ args }) => args), [
      [path.join(fixture.paths.checkout, "scripts", "wechat-sync.cjs"), "--automatic"],
      [path.join(fixture.paths.checkout, "scripts", "wechat-publish.cjs"), "run", "--automatic"],
    ]);
    for (const call of calls) {
      assert.equal(call.commandName, "/private/fake-bun");
      assert.equal(call.options.cwd, fixture.paths.checkout);
      assert.equal(call.options.env.WECHAT_ENV_FILE, fixture.paths.envFile);
      assert.equal(call.options.env.WECHAT_SYNC_STATE_FILE, fixture.paths.stateFile);
      assert.equal(call.options.env.WECHAT_AGENT_HOME, fixture.paths.agentHome);
      assert.equal(call.options.env.WECHAT_AUTO_PUBLISH, "0");
      assert.equal(call.options.env.WECHAT_AUTO_WITHDRAW, "0");
    }
    assert.equal(result.status, "success");
    assert.equal(result.mode, "automatic");
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test("passes dry-run to both children so the lifecycle cannot launch Chrome", () => {
  const fixture = agentFixture();
  const childArguments = [];
  try {
    runAgent({
      paths: fixture.paths,
      bunPath: "/private/fake-bun",
      updateCheckoutRunner: () => ({ before: "same", after: "same" }),
      commandRunner: (_commandName, args) => {
        childArguments.push(args);
        return successfulChild();
      },
      dryRun: true,
      logger: () => {},
    });

    assert.deepEqual(childArguments, [
      [path.join(fixture.paths.checkout, "scripts", "wechat-sync.cjs"), "--automatic", "--dry-run"],
      [path.join(fixture.paths.checkout, "scripts", "wechat-publish.cjs"), "run", "--automatic", "--dry-run"],
    ]);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test("limits force to draft sync without authorizing a browser operation", () => {
  const fixture = agentFixture();
  const childArguments = [];
  try {
    runAgent({
      paths: fixture.paths,
      bunPath: "/private/fake-bun",
      updateCheckoutRunner: () => ({ before: "same", after: "same" }),
      commandRunner: (_commandName, args) => {
        childArguments.push(args);
        return successfulChild();
      },
      force: true,
      logger: () => {},
    });

    assert.deepEqual(childArguments, [
      [path.join(fixture.paths.checkout, "scripts", "wechat-sync.cjs"), "--automatic", "--force"],
      [path.join(fixture.paths.checkout, "scripts", "wechat-publish.cjs"), "run", "--automatic"],
    ]);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test("does not start lifecycle when draft sync fails", () => {
  const fixture = agentFixture();
  const childNames = [];
  try {
    assert.throws(() => runAgent({
      paths: fixture.paths,
      bunPath: "/private/fake-bun",
      updateCheckoutRunner: () => ({ before: "same", after: "same" }),
      commandRunner: (_commandName, args) => {
        childNames.push(path.basename(args[0]));
        throw new Error("sync failed");
      },
      logger: () => {},
    }), /sync failed/);

    assert.deepEqual(childNames, ["wechat-sync.cjs"]);
    const lastRun = JSON.parse(fs.readFileSync(fixture.paths.lastRunFile, "utf8"));
    assert.equal(lastRun.status, "failure");
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test("records lifecycle failure without changing the draft state saved by sync", () => {
  const fixture = agentFixture();
  try {
    assert.throws(() => runAgent({
      paths: fixture.paths,
      bunPath: "/private/fake-bun",
      updateCheckoutRunner: () => ({ before: "same", after: "same" }),
      commandRunner: (_commandName, args) => {
        if (path.basename(args[0]) === "wechat-sync.cjs") {
          fs.writeFileSync(fixture.paths.stateFile, "draft-state-saved\n");
          return successfulChild();
        }
        throw new Error("lifecycle failed");
      },
      logger: () => {},
    }), /lifecycle failed/);

    assert.equal(fs.readFileSync(fixture.paths.stateFile, "utf8"), "draft-state-saved\n");
    const lastRun = JSON.parse(fs.readFileSync(fixture.paths.lastRunFile, "utf8"));
    assert.equal(lastRun.status, "failure");
    assert.equal(lastRun.error, "lifecycle failed");
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test("status lists copyable defaults missing from an existing private env without overwriting it", () => {
  const fixture = agentFixture();
  const existing = "WECHAT_APP_ID=private-id\nWECHAT_AUTO_PUBLISH=0\n";
  fs.writeFileSync(fixture.paths.envFile, existing);
  const logs = [];
  try {
    assert.deepEqual(missingEnvironmentLines(existing), [
      "WECHAT_AUTO_WITHDRAW=0",
      "WECHAT_BROWSER_CHANNEL=chrome",
      "WECHAT_BROWSER_HEADLESS=0",
    ]);
    statusAgent({
      paths: fixture.paths,
      commandRunner: () => ({ status: 1, stdout: "", stderr: "" }),
      logger: (line) => logs.push(line),
    });

    const output = logs.join("\n");
    assert.match(output, /复制到私密配置文件末尾/);
    for (const line of missingEnvironmentLines(existing)) assert.match(output, new RegExp(line));
    assert.equal(fs.readFileSync(fixture.paths.envFile, "utf8"), existing);
  } finally {
    fs.rmSync(fixture.temporary, { recursive: true, force: true });
  }
});

test("fast-forwards only the dedicated checkout to a newer remote commit", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-agent-test-"));
  try {
    const remote = path.join(temporary, "remote.git");
    const source = path.join(temporary, "source");
    const checkout = path.join(temporary, "checkout");
    git(temporary, ["init", "--bare", remote]);
    git(temporary, ["clone", remote, source]);
    git(source, ["config", "user.name", "Wechat Agent Test"]);
    git(source, ["config", "user.email", "wechat-agent@example.com"]);
    fs.writeFileSync(path.join(source, "package.json"), "{}\n");
    fs.writeFileSync(path.join(source, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    git(source, ["add", "package.json", "pnpm-lock.yaml"]);
    git(source, ["commit", "-m", "initial"]);
    git(source, ["branch", "-M", "main"]);
    git(source, ["push", "-u", "origin", "main"]);
    git(temporary, ["clone", "--branch", "main", remote, checkout]);
    fs.mkdirSync(path.join(checkout, "node_modules", "markdown-it"), { recursive: true });
    const before = git(checkout, ["rev-parse", "HEAD"]);

    fs.writeFileSync(path.join(source, "content.md"), "new article\n");
    git(source, ["add", "content.md"]);
    git(source, ["commit", "-m", "publish"]);
    git(source, ["push", "origin", "main"]);
    const expected = git(source, ["rev-parse", "HEAD"]);

    const result = updateCheckout({
      checkout,
      remote: "origin",
      branch: "main",
      bunPath: process.execPath,
      logger: () => {},
    });
    assert.equal(result.before, before);
    assert.equal(result.after, expected);
    assert.equal(git(checkout, ["rev-parse", "HEAD"]), expected);
    assert.equal(fs.readFileSync(path.join(checkout, "content.md"), "utf8"), "new article\n");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
