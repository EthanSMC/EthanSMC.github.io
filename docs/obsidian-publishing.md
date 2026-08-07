# Obsidian Writing 发布说明

你只负责写作和移动文件。标题、日期、摘要、类型、Tag、阅读时间、URL、RSS 和网页均由构建自动生成。

## 1. 一次性初始化

在终端运行：

```bash
cd /Users/ethancc/Documents/Personal_Page
./scripts/setup-obsidian-git.sh
```

脚本会复用现有 `Obsidian_vault` 中已经安装的 Obsidian Git，并在新 vault 内写入下述 Git 与文件设置。配置保存在被忽略的 `content/.obsidian/`，不会上传到公开仓库。

然后在 Obsidian 中选择“打开本地仓库”，打开：

```text
/Users/ethancc/Documents/Personal_Page/content
```

不要打开整个 `Personal_Page`；`content/` 才是写作仓库。

## 2. Obsidian 设置

在“文件与链接”中设置：

- 新建笔记的存放位置：指定文件夹中的 `drafts`。
- 新附件的默认位置：指定文件夹中的 `assets`。
- 新链接格式：基于当前笔记的相对路径。
- 关闭“使用 [[Wikilinks]]”。公开内容使用标准 Markdown 链接和图片。

不需要启用“唯一笔记创建器”，也不需要按时间戳给文章命名。直接使用 Obsidian 的普通“新建笔记”，文件名写成你自己看得懂的标题即可。

## 3. Obsidian Git 设置

初始化脚本会自动复制、启用并配置社区插件 **Git**（Vinzent03）。可以在设置页核对：

- Auto pull on startup：开启。
- Auto commit-and-sync interval：`2` 分钟。
- Auto commit-and-sync after stopping file edits：开启。
- Pull on commit-and-sync：开启。
- Push on commit-and-sync：开启。
- Auto commit only staged files：关闭。
- Auto commit message：`blog: sync {{date}}`。
- 状态与错误通知：保持开启。

“停止编辑后同步”和固定间隔共用同一个 interval。这里不是把 interval 设为 0，而是设为 2 分钟并开启停止编辑模式。

## 4. 写作和发布

新建的草稿类似：

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

完成后只需要把 Markdown 从 `drafts/` 移到 `published/`。停止编辑两分钟后，Git 保护脚本会自动把文件名转换为内部时间戳 ID，再继续发布：

```text
自动分配时间戳 → Obsidian Git 提交 → 拉取 → 推送 → Vercel 构建 → Writing 更新
```

配置 Mac 后台 Agent 后，同一次 GitHub Push 还会进入：

```text
GitHub main → Mac Agent 定期检查 → 独立副本拉取 → 转换公众号格式 → 新增或更新公众号草稿
```

从任何设备写作都遵循同一流程。Mac 在线时通常在 5 分钟内同步；离线时 GitHub 保留最新内容，Mac 下次上线后自动补同步。公众号当前只自动进入草稿箱，仍需在微信后台人工检查和发布；从网站撤稿也不会自动删除已发布的微信文章。详细设置参见 [微信公众号草稿自动同步](wechat-draft-sync.md)。

类型会自动判断：包含二级标题或正文超过 600 个可见字符的是 Essay，否则是 Note。需要覆盖判断时，可二选一添加 `#essay` 或 `#note`；它们不会显示成公开 Tag，同时出现会阻止发布并提示修正。

## 5. Git 保护的实际边界

自动提交时，仓库 hook 只允许：

- `content/published/` 中的 Markdown；普通文件名会在提交前自动转换为时间戳 ID。
- 这些已发布 Markdown 实际引用的 `content/assets/` 附件。

Obsidian Git 本身会先暂存整个仓库。发布保护会在提交前自动移除网站代码，只把 `published/` 和被正文引用的附件放进本次提交；网站代码仍留在工作区，不会被推送。若只有网站代码、没有可发布内容，自动提交会停止。

在 Codex 或编辑器中开发网站时，不要依赖暂存区长期保存选中的文件：Obsidian 的自动同步会重新暂存仓库，保护脚本随后会把网站代码取消暂存。工作内容不会丢失，但原有暂存选择不会保留。

这层保护针对“自动提交和推送”，不能拦截 Obsidian Git 中人工触发的 **Discard all changes / 丢弃全部更改**。不要在 Obsidian 中使用丢弃全部更改、重置仓库或删除仓库等命令；它们可能作用于整个 `Personal_Page` 仓库。

草稿与未引用附件被 Git 忽略，因此不会出现在公开 GitHub，也没有 Git 备份。使用 Time Machine 或其他私有备份保护它们。

## 6. 常见错误

- `automatic sync found no publishable content`：只有网站代码变化，没有新文章；代码仍在本地，无需处理。
- `published filename must use YYYY-MM-DD-HHmmss.md`：通常不会再出现；若出现，表示自动命名脚本未能完成，请保留原文件并检查 Obsidian Git 通知。
- `missing published attachment`：文章引用的本地图片被移动或删除；修正链接或恢复图片。
- Push 失败：先确认普通终端中的 `git push` 可用，再检查 Obsidian Git 的认证提示。
- Vercel 构建失败：到 Vercel Deployment 查看构建日志；失败构建不会生成新的 Writing 页面。

正式网站以 Vercel 为准。`ethansmc.github.io` 由 GitHub Actions 构建同一份静态网站，作为可直接访问的镜像；本地预览始终使用 <http://localhost:4173/>，不要直接双击 `index.html` 作为正式预览。
