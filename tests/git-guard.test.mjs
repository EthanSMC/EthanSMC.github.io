import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
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
  await mkdir(path.join(directory, "content", "albums"), { recursive: true });
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
  run(directory, "chmod", [
    "+x",
    ".githooks/pre-commit",
    ".githooks/commit-msg",
    ".githooks/obsidian_guard.py",
    ".githooks/obsidian-commit-message.sh"
  ]);
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

test("Obsidian automatically assigns a timestamp filename on publish", async () => {
  const directory = await fixture();
  const naturalName = path.join(directory, "content", "published", "我的正常标题.md");
  await writeFile(naturalName, "# 我的正常标题\n\n只管正常写作。\n");
  run(directory, "git", ["add", "-A"]);

  const message = run(directory, ".githooks/obsidian-commit-message.sh", []);
  assert.equal(message.status, 0, message.stderr);
  const commit = run(directory, "git", ["commit", "-m", message.stdout.trim()]);
  assert.equal(commit.status, 0, commit.stderr);
  assert.match(commit.stderr, /assigned 我的正常标题\.md -> \d{4}-\d{2}-\d{2}-\d{6}\.md/);

  const publishedFiles = await readdir(path.join(directory, "content", "published"));
  assert.equal(publishedFiles.includes("我的正常标题.md"), false);
  assert.equal(
    publishedFiles.filter(filename => /^\d{4}-\d{2}-\d{2}-\d{6}\.md$/.test(filename)).length,
    2
  );
  const committedNames = run(directory, "git", ["show", "--format=", "--name-only", "HEAD"]).stdout;
  assert.doesNotMatch(committedNames, /我的正常标题\.md/);
  assert.match(committedNames, /content\/published\/\d{4}-\d{2}-\d{2}-\d{6}\.md/);
});

test("older Obsidian settings prepare a safe automatic retry", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "content", "published", "普通文章名.md"),
    "# 普通文章名\n\n第一次提交会完成迁移。\n"
  );
  run(directory, "git", ["add", "-A"]);

  const firstAttempt = run(directory, "git", ["commit", "-m", "blog: sync legacy settings"]);
  assert.notEqual(firstAttempt.status, 0);
  assert.match(firstAttempt.stderr, /next automatic retry/);

  const secondAttempt = run(directory, "git", ["commit", "-m", "blog: sync legacy retry"]);
  assert.equal(secondAttempt.status, 0, secondAttempt.stderr);
  const committedNames = run(directory, "git", ["show", "--format=", "--name-only", "HEAD"]).stdout;
  assert.doesNotMatch(committedNames, /普通文章名\.md/);
  assert.match(committedNames, /content\/published\/\d{4}-\d{2}-\d{2}-\d{6}\.md/);
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
  const names = run(
    directory,
    "git",
    ["-c", "core.quotepath=false", "show", "--format=", "--name-only", "HEAD"],
  ).stdout;
  assert.match(names, /content\/assets\/figure one\.png/);
  assert.doesNotMatch(names, /private\.png|draft\.md/);
});

test("Obsidian publishes album Markdown and only its frontmatter cover", async () => {
  const directory = await fixture();
  const coverDirectory = path.join(directory, "content", "assets", "albums", "ai-native");
  await mkdir(coverDirectory, { recursive: true });
  await writeFile(
    path.join(directory, "content", "albums", "AI原生个人内容系统.md"),
    `---
kind: album
slug: ai-native
cover: "[[assets/albums/ai-native/cover.png]]"
---
# AI 原生个人内容系统

![不应发布](../assets/body-only.png)
`,
  );
  await writeFile(path.join(coverDirectory, "cover.png"), "album cover\n");
  await writeFile(path.join(directory, "content", "assets", "body-only.png"), "body asset\n");
  await writeFile(path.join(directory, "content", "assets", "private.png"), "private asset\n");
  run(directory, "git", ["add", "-A"]);

  const commit = run(directory, "git", ["commit", "-m", "blog: sync album"], { OBSIDIAN_GIT: "1" });

  assert.equal(commit.status, 0, commit.stderr);
  const names = run(
    directory,
    "git",
    ["-c", "core.quotepath=false", "show", "--format=", "--name-only", "HEAD"],
  ).stdout;
  assert.match(names, /content\/albums\/AI原生个人内容系统\.md/);
  assert.match(names, /content\/assets\/albums\/ai-native\/cover\.png/);
  assert.doesNotMatch(names, /body-only\.png|private\.png/);
});

test("Obsidian validates the staged Album blob instead of a later valid working tree", async () => {
  const directory = await fixture();
  const album = path.join(directory, "content", "albums", "快照校验.md");
  await writeFile(album, "---\nkind: note\nslug: staged-invalid\n---\n# Invalid staged blob\n");
  run(directory, "git", ["add", "--", "content/albums/快照校验.md"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;
  await writeFile(album, "---\nkind: album\nslug: working-valid\n---\n# Valid only in working tree\n");

  const commit = run(directory, "git", ["commit", "-m", "blog: staged album blob"], { OBSIDIAN_GIT: "1" });

  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /staged Album Markdown must declare kind: album/i);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
  assert.notEqual(
    run(directory, "git", ["cat-file", "-e", "HEAD:content/albums/快照校验.md"]).status,
    0,
  );
});

test("Obsidian rejects a staged Album symlink after working tree replacement", async () => {
  const directory = await fixture();
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "ethan-staged-album-link-"));
  const externalAlbum = path.join(externalDirectory, "outside.md");
  const album = path.join(directory, "content", "albums", "暂存链接.md");
  await writeFile(externalAlbum, "---\nkind: album\nslug: outside\n---\n# Outside\n");
  await symlink(externalAlbum, album);
  run(directory, "git", ["add", "--", "content/albums/暂存链接.md"]);
  assert.match(
    run(directory, "git", ["ls-files", "--stage", "--", "content/albums/暂存链接.md"]).stdout,
    /^120000 /,
  );
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;
  await unlink(album);
  await writeFile(album, "---\nkind: album\nslug: working-regular\n---\n# Regular only in working tree\n");

  const commit = run(directory, "git", ["commit", "-m", "blog: staged album symlink"], { OBSIDIAN_GIT: "1" });

  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /staged Album Markdown must be a regular file/i);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
  assert.equal(await readFile(externalAlbum, "utf8"), "---\nkind: album\nslug: outside\n---\n# Outside\n");
});

test("Obsidian honors a staged Album deletion despite a replacement working file", async () => {
  const directory = await fixture();
  const relativeAlbum = "content/albums/待删除专辑.md";
  const album = path.join(directory, relativeAlbum);
  await writeFile(album, "---\nkind: album\nslug: tracked-album\n---\n# Tracked album\n");
  run(directory, "git", ["add", "--", relativeAlbum]);
  assert.equal(run(directory, "git", ["commit", "-m", "test: tracked album"]).status, 0);
  await unlink(album);
  run(directory, "git", ["add", "--", relativeAlbum]);
  await writeFile(album, "---\nkind: note\nslug: replacement\n---\n# Unstaged replacement\n");

  const commit = run(directory, "git", ["commit", "-m", "blog: delete album"], { OBSIDIAN_GIT: "1" });

  assert.equal(commit.status, 0, commit.stderr);
  assert.notEqual(run(directory, "git", ["cat-file", "-e", `HEAD:${relativeAlbum}`]).status, 0);
  assert.match(run(directory, "git", ["status", "--short", "--", relativeAlbum]).stdout, /^\?\?/);
});

test("Obsidian rejects an album cover that traverses outside content assets", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "content", "albums", "穿越封面.md"),
    '---\nkind: album\nslug: traversal\ncover: "[[assets/../site/app.js]]"\n---\n# Traversal\n',
  );
  run(directory, "git", ["add", "-A"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;

  const commit = run(directory, "git", ["commit", "-m", "blog: unsafe album"], { OBSIDIAN_GIT: "1" });

  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /album cover.*inside content\/assets/i);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
});

test("Obsidian rejects a symlinked album cover without reading external data", async () => {
  const directory = await fixture();
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "ethan-album-cover-target-"));
  const externalFile = path.join(externalDirectory, "private.png");
  const sentinel = "private external cover\n";
  const coverDirectory = path.join(directory, "content", "assets", "albums", "unsafe");
  await mkdir(coverDirectory, { recursive: true });
  await writeFile(externalFile, sentinel);
  await symlink(externalFile, path.join(coverDirectory, "cover.png"));
  await writeFile(
    path.join(directory, "content", "albums", "不安全封面.md"),
    '---\nkind: album\nslug: unsafe\ncover: "[[assets/albums/unsafe/cover.png]]"\n---\n# Unsafe\n',
  );
  run(directory, "git", ["add", "-A"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;

  const commit = run(directory, "git", ["commit", "-m", "blog: symlink cover"], { OBSIDIAN_GIT: "1" });

  assert.equal(await readFile(externalFile, "utf8"), sentinel);
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /album cover.*regular file/i);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
});

test("Obsidian rejects a symlinked content assets directory without reading external data", async () => {
  const directory = await fixture();
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "ethan-album-assets-target-"));
  const externalCover = path.join(externalDirectory, "cover.png");
  const sentinel = "private external asset directory\n";
  await writeFile(externalCover, sentinel);
  await rm(path.join(directory, "content", "assets"), { recursive: true });
  await symlink(externalDirectory, path.join(directory, "content", "assets"), "dir");
  await writeFile(
    path.join(directory, "content", "albums", "不安全目录.md"),
    '---\nkind: album\nslug: unsafe-root\ncover: "[[assets/cover.png]]"\n---\n# Unsafe root\n',
  );
  run(directory, "git", ["add", "-A"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;

  const commit = run(directory, "git", ["commit", "-m", "blog: symlink assets"], { OBSIDIAN_GIT: "1" });

  assert.equal(await readFile(externalCover, "utf8"), sentinel);
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /album cover.*regular file inside content\/assets/i);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
});

test("vault setup creates stable album and asset workspaces", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ethan-album-vault-"));
  const vault = path.join(directory, "content");
  await mkdir(vault, { recursive: true });

  const setup = run(
    projectRoot,
    "/usr/bin/python3",
    [path.join(projectRoot, "scripts", "setup-obsidian-vault.py"), vault],
    { HOME: directory },
  );

  assert.equal(setup.status, 0, setup.stderr);
  assert.deepEqual(
    (await readdir(vault)).filter((name) => !name.startsWith(".")).sort(),
    ["albums", "assets", "drafts", "published"],
  );
  const appSettings = JSON.parse(await readFile(path.join(vault, ".obsidian", "app.json"), "utf8"));
  assert.equal(appSettings.newFileFolderPath, "drafts");
  assert.equal(appSettings.attachmentFolderPath, "assets");
  assert.match(setup.stdout, /albums\//);
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

test("moving a published article to private drafts commits a content-free withdrawal marker", async () => {
  const directory = await fixture();
  const filename = "2026-07-28-120000.md";
  await rename(
    path.join(directory, "content", "published", filename),
    path.join(directory, "content", "drafts", filename),
  );
  run(directory, "git", ["add", "-A"]);

  const commit = run(directory, "git", ["commit", "-m", "blog: withdraw"], { OBSIDIAN_GIT: "1" });

  assert.equal(commit.status, 0, commit.stderr);
  const marker = JSON.parse(
    run(
      directory,
      "git",
      ["show", "HEAD:content/.lifecycle/withdrawals/2026-07-28-120000.json"],
    ).stdout,
  );
  assert.deepEqual(Object.keys(marker).sort(), ["postId", "requestedAt"]);
  assert.equal(marker.postId, "2026-07-28-120000");
  assert.match(marker.requestedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(marker.requestedAt).toISOString(), marker.requestedAt);
  assert.doesNotMatch(JSON.stringify(marker), /Baseline|Published|drafts/);
  assert.equal(run(directory, "git", ["ls-files", "content/drafts"]).stdout, "");
});

test("deleting a published article without a private draft does not commit a withdrawal marker", async () => {
  const directory = await fixture();
  await unlink(path.join(directory, "content", "published", "2026-07-28-120000.md"));
  run(directory, "git", ["add", "-A"]);

  const commit = run(directory, "git", ["commit", "-m", "blog: delete"], { OBSIDIAN_GIT: "1" });

  assert.equal(commit.status, 0, commit.stderr);
  const committedNames = run(directory, "git", ["show", "--format=", "--name-only", "HEAD"]).stdout;
  assert.doesNotMatch(committedNames, /content\/\.lifecycle\/withdrawals\//);
});

test("Obsidian rejects the same timestamped article in published and private drafts", async () => {
  const directory = await fixture();
  const filename = "2026-07-28-120000.md";
  await writeFile(
    path.join(directory, "content", "drafts", filename),
    "# Private duplicate\n",
  );
  await writeFile(
    path.join(directory, "content", "published", filename),
    "# Baseline\n\nStaged update.\n",
  );
  run(directory, "git", ["add", "-A"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;

  const commit = run(directory, "git", ["commit", "-m", "blog: duplicate"], { OBSIDIAN_GIT: "1" });

  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /同一文章不能同时位于 published 和 drafts/);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
});

test("Obsidian rejects a symlinked withdrawal marker without external writes or index changes", async () => {
  const directory = await fixture();
  const filename = "2026-07-28-120000.md";
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "ethan-blog-marker-target-"));
  const externalFile = path.join(externalDirectory, "private.txt");
  const sentinel = "private local content\n";
  await writeFile(externalFile, sentinel);
  const withdrawals = path.join(directory, "content", ".lifecycle", "withdrawals");
  await mkdir(withdrawals, { recursive: true });
  await symlink(externalFile, path.join(withdrawals, "2026-07-28-120000.json"));
  await rename(
    path.join(directory, "content", "published", filename),
    path.join(directory, "content", "drafts", filename),
  );
  run(directory, "git", ["add", "-A"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;

  const commit = run(directory, "git", ["commit", "-m", "blog: unsafe marker"], { OBSIDIAN_GIT: "1" });

  assert.equal(await readFile(externalFile, "utf8"), sentinel);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /withdrawal marker path must be a regular file inside the repository/);
});

test("Obsidian rejects a symlinked withdrawal directory without external writes or index changes", async () => {
  const directory = await fixture();
  const filename = "2026-07-28-120000.md";
  const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "ethan-blog-withdrawals-target-"));
  const lifecycle = path.join(directory, "content", ".lifecycle");
  await mkdir(lifecycle, { recursive: true });
  await symlink(externalDirectory, path.join(lifecycle, "withdrawals"), "dir");
  await rename(
    path.join(directory, "content", "published", filename),
    path.join(directory, "content", "drafts", filename),
  );
  run(directory, "git", ["add", "-A"]);
  const stagedBefore = run(directory, "git", ["diff", "--cached", "--binary"]).stdout;

  const commit = run(directory, "git", ["commit", "-m", "blog: unsafe marker parent"], { OBSIDIAN_GIT: "1" });

  assert.deepEqual(await readdir(externalDirectory), []);
  assert.equal(run(directory, "git", ["diff", "--cached", "--binary"]).stdout, stagedBefore);
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /withdrawal marker path must be a regular file inside the repository/);
});
