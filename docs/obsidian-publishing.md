# Obsidian Writing 发布与撤回说明

你只负责写作和移动文件。标题、日期、摘要、类型、Tag、阅读时间、URL、RSS、网页和公众号草稿均由后续流程生成。

## 1. 每台设备都要初始化

在每一台会写作、发布或撤回文章的设备上，进入该设备的仓库根目录并运行：

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
  → 已授权时精确发布到公众号
```

类型会自动判断：包含二级标题或正文超过 600 个可见字符的是 Essay，否则是 Note。需要覆盖时可以添加 `#essay` 或 `#note`，但不能同时添加。

## 4. 私密草稿与精确撤回

`content/drafts/` 被 Git 忽略。草稿正文、标题、Tag、附件和本机路径都不会推送到公开仓库；请使用 Time Machine 或其他私有备份保护它们。

要从网站和微信一起撤回，必须在装有当前 Git hook 的设备上，把时间戳文件原样从：

```text
content/published/POST_ID.md
```

移动到：

```text
content/drafts/POST_ID.md
```

不要改名，也不要复制出第二份。Obsidian Git 提交时会把网站文件删除，并生成只含 `postId` 和 UTC `requestedAt` 的公开撤回标记；私密正文仍留在本机。

这几个边界必须区分：

- 只有“同 ID 的 published 删除 + 本机 drafts 文件存在”这一精确移动会授权微信撤回。
- 直接删除 `published/` 文件、换分支或后台副本暂时缺少文件都没有撤回授权，只让网站下线。
- 尚未发表的文章移回草稿时，系统取消后续发表，但保留已经创建的微信草稿。
- 已经发表的文章移回草稿时，如果自动撤回已通过验收并开启，Mac Agent 会精确匹配后撤回，不再逐篇弹出确认请求。
- 页面身份或点击结果不确定时，Agent 会停止在待核对状态，不会重复点击。操作员必须查看微信并使用 `publisher:resolve`。
- 任何已知发表过的文章都不会自动再次发表。撤回后重新移到 `published/` 只恢复网站。

如果同一个时间戳 ID 同时存在于 `published/` 和 `drafts/`，提交会被拒绝，直到只保留符合真实意图的一份。

## 5. 公众号发布器首次设置

Mac Agent 的安装、私密配置和受控验收详见 [微信公众号草稿与浏览器生命周期](wechat-draft-sync.md)。在用于操作发布器的终端中先设置：

```bash
export WECHAT_ENV_FILE="$HOME/Library/Application Support/EthanSMC/WeChat Draft Sync/wechat.env"
```

确认 Agent 已成功产生外部状态文件后，严格按以下顺序执行：

```bash
pnpm install
pnpm wechat:publisher:login
pnpm wechat:publisher:arm
pnpm wechat:publisher:status
pnpm wechat:publisher:run -- --dry-run
```

安装与建立基线不会开启自动操作。私密配置中的初始值必须保持：

```text
WECHAT_AUTO_PUBLISH=0
WECHAT_AUTO_WITHDRAW=0
WECHAT_BROWSER_CHANNEL=chrome
WECHAT_BROWSER_HEADLESS=0
```

发布和撤回需要分别完成受控验收后再单独改为 `1`。Mac Agent 使用的 `--automatic` 只是无人值守调用标记，不会改变这些开关，也不会形成另一套运行模式。

## 6. 不确定状态怎么处理

先查看状态：

```bash
pnpm wechat:publisher:status
```

若显示发表结果待核对，人工打开微信确认后执行其中一个：

```bash
pnpm wechat:publisher:resolve POST_ID -- --published https://mp.weixin.qq.com/s/...
pnpm wechat:publisher:resolve POST_ID -- --not-published
```

若显示撤回结果待核对，人工确认公开文章是否仍存在后执行其中一个：

```bash
pnpm wechat:publisher:resolve POST_ID -- --withdrawn
pnpm wechat:publisher:resolve POST_ID -- --still-published
```

不要通过删除 `state.json`、重复移动文件或运行 `--force` 来解除待核对状态。`--force` 只重建尚未发表的 API 草稿，不授权任何浏览器操作。

## 7. Git 保护边界

自动提交只允许：

- `content/published/` 中的 Markdown；普通文件名会先转换为时间戳 ID。
- 被这些 Markdown 实际引用的 `content/assets/` 附件。
- 当前精确移动生成的无正文撤回标记。

Obsidian Git 会先暂存整个仓库，保护脚本再移除网站代码，只提交允许的内容。网站开发改动仍留在工作区，但原有暂存选择可能被自动同步重排。

保护脚本不能拦截 Obsidian 中人工触发的 **Discard all changes / 丢弃全部更改**、重置或删除仓库。不要使用这些命令；它们可能作用于整个 `Personal_Page`。

## 8. 常见错误

- `automatic sync found no publishable content`：只有网站代码变化，没有新文章；代码仍在本地。
- `published filename must use YYYY-MM-DD-HHmmss.md`：自动命名没有完成；保留原文件并查看 Obsidian Git 通知。
- `同一文章不能同时位于 published 和 drafts`：同一时间戳 ID 两处都存在；按真实意图只保留一处。
- `missing published attachment`：本地图片被移动或删除；修正链接或恢复图片。
- Push 失败：先确认普通终端中的 `git push` 可用，再检查 Obsidian Git 认证。
- Publisher 显示待核对：不要继续移动或强制重试，按上一节的 `resolve` 流程处理。

正式网站以 Vercel 为准；`ethansmc.github.io` 是由 GitHub Actions 构建的镜像。本地预览使用 <http://localhost:4173/>。
