# Obsidian Writing 与草稿同步说明

你只负责写作和移动文件。标题、日期、摘要、类型、Tag、阅读时间、URL、RSS、网页和公众号草稿均由后续流程生成。专辑的元数据和封面由 `content/albums/` 中的 Album MD 声明。

## 1. 每台设备都要初始化

在每一台会写作或发布网站文章的设备上，进入该设备的仓库根目录并运行：

```bash
./scripts/setup-obsidian-git.sh
```

首次克隆要运行；以后拉到新版脚本或 Git hook 后也要重新运行。脚本会设置当前仓库的 `core.hooksPath`，复用并配置 Obsidian Git，然后提示应该打开的 vault。只同步仓库文件不会自动启用更新后的 hook。

在 Obsidian 中选择“打开本地仓库”，只打开：

```text
/Users/ethancc/Documents/Personal_Page/content
```

不要打开整个 `Personal_Page`。`content/` 才是写作 vault。

## 2. Obsidian 设置

在“文件与链接”中设置：

- 新建笔记的存放位置：指定文件夹中的 `drafts`。
- 新附件的默认位置：指定文件夹中的 `assets`。
- 新链接格式：基于当前笔记的相对路径。
- 关闭“使用 [[Wikilinks]]”，使用标准 Markdown 链接和图片。

Obsidian Git 应保持：启动时拉取、每 2 分钟自动 commit-and-sync、停止编辑后自动同步、提交前拉取、提交后推送、显示状态与错误通知。自动提交消息是 `blog: sync {{date}}`。

## 3. 写作与发布

普通文章可以这样写：

```markdown
# 当执行越来越便宜，判断力还剩下什么？

#AI #产品 #判断

最近我越来越强烈地感受到，方案正在变便宜……
```

短 Note 可以没有标题：

```markdown
产品经理不是需求翻译器。真正困难的是知道哪些话不能直接翻译成需求。

#产品 #工作
```

完成后，把 Markdown 从 `drafts/` 移到 `published/`。Git hook 会把普通文件名转换为内部时间戳 ID，再允许 Obsidian Git 提交：

```text
移动到 published/
  → 分配时间戳 ID
  → Obsidian Git 提交、拉取、推送
  → Vercel / GitHub Pages 更新网站
  → Mac Agent 同步公众号草稿
  → 人工进入公众号草稿箱检查并发表
```

类型会自动判断：包含二级标题或正文超过 600 个可见字符的是 Essay，否则是 Note。需要覆盖时可以添加 `#essay` 或 `#note`，但不能同时添加。

### 专辑

专辑文件放在 `content/albums/`，使用稳定、可读的文件名，不会被转换为时间戳。示例：

```markdown
---
kind: album
slug: ai-native-content-system
status: ongoing
featured: true
order: 1
cover: "[[assets/albums/ai-native-content-system/cover.jpg]]"
cover_alt: 白猫 Mochi 趴在床上望向镜头
cover_cast: mochi
description: 从 Obsidian 出发，逐步搭建属于自己的 AI 原生个人内容系统。
---
# AI 原生个人内容系统
```

封面必须是 `content/assets/` 内的普通文件，并通过严格的 `[[assets/...]]` 链接声明；远程地址、路径穿越、symlink 和缺失文件都会被拒绝。专辑可以先保持空状态。

文章加入专辑时只需在文章 frontmatter 中引用 Album MD 的精确文件 basename，并给出唯一的正整数轨道号；不要在 Album MD 中重复维护文章列表：

```markdown
---
kind: article
album: "[[AI原生个人内容系统]]"
track: 1
---
```

专辑页固定发布到 `/blog/albums/<slug>/`。修改专辑只会重建网站视图，不会重写旧文章正文或改变旧文章 URL。

## 4. 私密草稿与下线边界

`content/drafts/` 被 Git 忽略。草稿正文、标题、Tag、附件和本机路径都不会推送到公开仓库；请使用 Time Machine 或其他私有备份保护它们。

要把内容从网站下线，可以把时间戳文件原样从：

```text
content/published/POST_ID.md
```

移动到：

```text
content/drafts/POST_ID.md
```

不要改名，也不要复制出第二份。Obsidian Git 提交后网站文件会删除，私密正文仍留在本机。

这几个边界必须区分：

- 移动或删除 `published/` 文件只影响网站，不会自动删除公众号草稿。
- 已经手动发表到公众号的内容不会被自动更新、撤回或删除。
- 如果要撤回已发表内容，必须进入微信公众号后台人工操作。
- 重新移到 `published/` 只恢复网站，并在合适时新增或更新一个未发表草稿。

如果同一个时间戳 ID 同时存在于 `published/` 和 `drafts/`，提交会被拒绝，直到只保留符合真实意图的一份。

## 5. 公众号草稿同步设置

Mac Agent 的安装与私密配置详见 [微信公众号草稿箱同步](wechat-draft-sync.md)。安装后只需要填写公众号 API 凭据：

```bash
open -e "$HOME/Library/Application Support/EthanSMC/WeChat Draft Sync/wechat.env"
```

然后检查状态或手动同步一次：

```bash
pnpm wechat:agent:status
pnpm wechat:agent:run
```

不需要公众号后台登录态、Chrome 配置、发布器基线或自动发布开关。即使旧私密配置中仍保留这些字段，Agent 也只运行草稿同步。

## 6. 草稿检查与发表

Agent 同步成功后，在微信公众号后台打开草稿箱，人工检查标题、正文、图片页序和封面，再手动发表。

需要重建未发表草稿时运行：

```bash
pnpm wechat:agent:run -- --force
```

`--force` 只重建尚未发表的 API 草稿。它不会发表、撤回或修改任何已发表内容。

## 7. Git 保护边界

自动提交只允许：

- `content/published/` 中的 Markdown；普通文件名会先转换为时间戳 ID。
- `content/albums/` 中的 Album MD；文件名保持稳定，不会分配时间戳。
- 被 `content/published/` Markdown 正文实际引用的 `content/assets/` 附件。
- 被 Album MD 的 `cover` frontmatter 实际引用且通过安全验证的 `content/assets/` 封面。

Obsidian Git 会先暂存整个仓库，保护脚本再移除网站代码，只提交允许的内容。网站开发改动仍留在工作区，但原有暂存选择可能被自动同步重排。

保护脚本不能拦截 Obsidian 中人工触发的 **Discard all changes / 丢弃全部更改**、重置或删除仓库。不要使用这些命令；它们可能作用于整个 `Personal_Page`。

## 8. 常见错误

- `automatic sync found no publishable content`：只有网站代码变化，没有新文章；代码仍在本地。
- `published filename must use YYYY-MM-DD-HHmmss.md`：自动命名没有完成；保留原文件并查看 Obsidian Git 通知。
- `同一文章不能同时位于 published 和 drafts`：同一时间戳 ID 两处都存在；按真实意图只保留一处。
- `missing published attachment`：本地图片被移动或删除；修正链接或恢复图片。
- Push 失败：先确认普通终端中的 `git push` 可用，再检查 Obsidian Git 认证。
- 微信草稿异常：先运行 `pnpm wechat:agent:run -- --dry-run` 检查本地渲染，再查看 Agent 错误日志。

正式网站以 Vercel 为准；`ethansmc.github.io` 是由 GitHub Actions 构建的镜像。本地预览使用 <http://localhost:4173/>。
