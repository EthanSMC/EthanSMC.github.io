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
  parseArguments,
  updateCheckout,
} = require("../scripts/wechat-mac-agent.cjs");

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
  assert.doesNotMatch(source, /ACCESS_TOKEN/);
  assert.doesNotMatch(source, /WEBHOOK/);
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
