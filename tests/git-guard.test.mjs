import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function run(cwd, command, args, env = {}) {
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ethan-blog-guard-"));
  await mkdir(path.join(directory, ".githooks"), { recursive: true });
  await mkdir(path.join(directory, "content", "published"), { recursive: true });
  await mkdir(path.join(directory, "content", "assets"), { recursive: true });
  await mkdir(path.join(directory, "content", "drafts"), { recursive: true });
  await mkdir(path.join(directory, "site"), { recursive: true });
  await cp(path.join(projectRoot, ".githooks"), path.join(directory, ".githooks"), { recursive: true });
  await writeFile(path.join(directory, ".gitignore"), "content/drafts/\ncontent/assets/*\n");
  await writeFile(path.join(directory, "site", "app.js"), "console.log('baseline');\n");
  await writeFile(path.join(directory, "content", "published", "2026-07-28-120000.md"), "# Baseline\n\nPublished.\n");
  run(directory, "git", ["init", "-b", "main"]);
  run(directory, "git", ["config", "user.name", "Test"]);
  run(directory, "git", ["config", "user.email", "test@example.com"]);
  run(directory, "git", ["config", "core.hooksPath", ".githooks"]);
  run(directory, "chmod", ["+x", ".githooks/pre-commit", ".githooks/commit-msg", ".githooks/obsidian_guard.py"]);
  run(directory, "git", ["add", "-A"]);
  const baseline = run(directory, "git", ["commit", "-m", "test: baseline"]);
  assert.equal(baseline.status, 0, baseline.stderr);
  return directory;
}

test("Obsidian allows content-only commits and ordinary Git allows code commits", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "content", "published", "2026-07-28-120000.md"), "# Baseline\n\nUpdated.\n");
  run(directory, "git", ["add", "-A"]);
  const contentCommit = run(directory, "git", ["commit", "-m", "blog: sync content"], { OBSIDIAN_GIT: "1" });
  assert.equal(contentCommit.status, 0, contentCommit.stderr);

  await writeFile(path.join(directory, "site", "app.js"), "console.log('developer');\n");
  run(directory, "git", ["add", "-A"]);
  const developerCommit = run(directory, "git", ["commit", "-m", "feat: developer change"]);
  assert.equal(developerCommit.status, 0, developerCommit.stderr);
});

test("Obsidian rejects code-only commits and excludes code from mixed commits", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "site", "app.js"), "console.log('unsafe');\n");
  run(directory, "git", ["add", "-A"]);
  const codeOnly = run(directory, "git", ["commit", "-m", "blog: sync code"], { OBSIDIAN_GIT: "1" });
  assert.notEqual(codeOnly.status, 0);
  assert.match(codeOnly.stderr, /no publishable content/);
  assert.equal(run(directory, "git", ["diff", "--cached", "--name-only"]).stdout, "");
  assert.match(run(directory, "git", ["diff", "--name-only"]).stdout, /site\/app\.js/);

  await writeFile(path.join(directory, "content", "published", "2026-07-28-120000.md"), "# Baseline\n\nMixed.\n");
  run(directory, "git", ["add", "-A"]);
  const mixed = run(directory, "git", ["commit", "-m", "blog: sync mixed"], { OBSIDIAN_GIT: "1" });
  assert.equal(mixed.status, 0, mixed.stderr);
  const committedNames = run(directory, "git", ["show", "--format=", "--name-only", "HEAD"]).stdout;
  assert.match(committedNames, /content\/published\/2026-07-28-120000\.md/);
  assert.doesNotMatch(committedNames, /site\/app\.js/);
  assert.match(run(directory, "git", ["diff", "--name-only"]).stdout, /site\/app\.js/);
});

test("only referenced ignored attachments are force-staged", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "content", "published", "2026-07-28-120000.md"),
    "# With image\n\n![图](<../assets/figure one.png>)\n"
  );
  await writeFile(path.join(directory, "content", "assets", "figure one.png"), "published fixture\n");
  await writeFile(path.join(directory, "content", "assets", "private.png"), "private fixture\n");
  await writeFile(path.join(directory, "content", "drafts", "draft.md"), "private draft\n");
  run(directory, "git", ["add", "-A"]);
  const commit = run(directory, "git", ["commit", "-m", "blog: sync image"], { OBSIDIAN_GIT: "1" });
  assert.equal(commit.status, 0, commit.stderr);
  const names = run(directory, "git", ["show", "--format=", "--name-only", "HEAD"]).stdout;
  assert.match(names, /content\/assets\/figure one\.png/);
  assert.doesNotMatch(names, /private\.png|draft\.md/);
});

test("allows deletion of a tracked attachment after its last reference is removed", async () => {
  const directory = await fixture();
  const article = path.join(directory, "content", "published", "2026-07-28-120000.md");
  const image = path.join(directory, "content", "assets", "old.png");
  await writeFile(article, "# With image\n\n![图](../assets/old.png)\n");
  await writeFile(image, "old image\n");
  run(directory, "git", ["add", article]);
  run(directory, "git", ["add", "-f", image]);
  assert.equal(run(directory, "git", ["commit", "-m", "test: published image"]).status, 0);

  await writeFile(article, "# Without image\n\nThe image is no longer needed.\n");
  await unlink(image);
  run(directory, "git", ["add", "-A"]);
  const commit = run(directory, "git", ["commit", "-m", "blog: sync remove image"], { OBSIDIAN_GIT: "1" });
  assert.equal(commit.status, 0, commit.stderr);
  const status = run(directory, "git", ["show", "--format=", "--name-status", "HEAD"]).stdout;
  assert.match(status, /D\s+content\/assets\/old\.png/);
});
