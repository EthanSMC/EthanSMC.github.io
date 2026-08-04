# 微信公众号草稿自动同步

当前公众号已验证：草稿接口可用，但发布能力接口返回 `48001 api unauthorized`。因此第一版只自动创建和更新草稿，最终发布与已发布文章的删除仍在微信公众平台人工完成。

## 1. 最终流程

```text
任意设备上的 Obsidian
  → drafts/ 移入 published/
  → Obsidian Git 提交并推送 main
  → GitHub 保存最新内容
  → Mac 后台 Agent 每 5 分钟检查一次
  → 独立仓库副本快进到最新 main
  → 上传正文图片和永久封面
  → 新增或更新公众号草稿
  → 人工检查并发布
```

Mac 在线时，Push 后通常 5 分钟内进入草稿箱。Mac 离线时不会丢事件；它下次上线后会直接同步 GitHub 上的最新状态。Vercel 继续只负责网站部署，不保存微信密钥，也不调用微信 API。

后台 Agent 的仓库副本位于 `~/Library/Application Support/EthanSMC/WeChat Draft Sync/repo`，与日常写作目录隔离。它只对自己的副本执行 `git fetch` 和 `git merge --ff-only`，不会拉取、重置或覆盖正在编辑的 `Personal_Page` 工作区。

## 2. 同步规则

- Markdown 母稿和本地附件仍是唯一内容源。
- 第一次同步一篇文章时调用 `draft/add`。
- 母稿发生变化时调用 `draft/update`，继续更新同一个待发布草稿。
- 微信后台发布或删除草稿后，原草稿 `media_id` 会失效；母稿再次变化时，系统自动创建一个新草稿。
- 正文图片先经微信“上传发表内容中的图片”接口换成微信 CDN URL。
- 默认使用文章第一张本地图片作为封面；没有图片时使用 `assets/share-card-writing.png`。
- 标题、作者和摘要会按微信限制安全截断到 32、16 和 120 个字。
- `content_source_url` 指向个人网站的永久文章地址，作为“阅读原文”。
- 从 `published/` 删除文章只会让网站撤稿并写入日志；公众号文章必须人工处理，不调用任何删除接口。
- 外链图片不会自动下载。正文图片必须先保存到 `content/assets/`，再以 `../assets/...` 的标准 Markdown 方式引用。

同步状态保存在 `~/Library/Application Support/EthanSMC/WeChat Draft Sync/state.json`。其中只有草稿 `media_id`、微信图片 URL、内容指纹和同步时间，没有 AppSecret 或 Access Token。状态会在后台副本更新后保留，因此相同文章不会重复创建草稿。

## 3. 前置条件

本机需要：

- macOS；
- Git；
- Bun；当前机器已安装在 `/opt/homebrew/bin/bun`；
- 能访问 GitHub 与 `api.weixin.qq.com`；
- 微信公众平台 API IP 白名单包含这台 Mac 当前的公网出口 IPv4。

公网 IP 发生变化时，微信会返回 `40164 invalid ip`。更新微信白名单后手动重跑即可，无需清理状态或重新创建文章。

## 4. 安装 Mac Agent

先确保本功能已经提交并推送到 `main`，因为安装器会从 GitHub 创建后台专用副本。然后在日常仓库运行：

```bash
cd /Users/ethancc/Documents/Personal_Page
pnpm wechat:agent:install
```

安装器会：

1. 创建私有目录 `~/Library/Application Support/EthanSMC/WeChat Draft Sync`；
2. 从 GitHub 克隆独立仓库副本；
3. 创建权限为 `600` 的 `wechat.env` 配置模板；
4. 安装 `~/Library/LaunchAgents/com.ethansmc.wechat-draft-sync.plist`；
5. 设置登录后启动，并每 300 秒运行一次。

可以覆盖检查间隔，但不能低于 60 秒：

```bash
pnpm wechat:agent:install -- --interval 120
```

## 5. 填写私密配置

打开安装器创建的文件：

```bash
open -e "$HOME/Library/Application Support/EthanSMC/WeChat Draft Sync/wechat.env"
```

至少填写：

```text
WECHAT_APP_ID=公众号 AppID
WECHAT_APP_SECRET=公众号 AppSecret
```

仓库、分支、状态路径、网站 URL 和作者已经由安装器生成。密钥文件只保存在这台 Mac，权限为 `600`。不要把 AppSecret 或 Access Token 放进 GitHub Secrets、Vercel、文章 Markdown、命令行参数或浏览器代码。

## 6. 首次验证与真实同步

先让后台副本只渲染和校验，不访问微信：

```bash
pnpm wechat:agent:run -- --dry-run
```

确认标题和文章能正常转换、并且 Mac 当前 IP 已加入微信白名单后，手动运行一次后台流程：

```bash
pnpm wechat:agent:run
```

第一次真实运行会上传文章图片和封面，并为当前所有已发布文章创建草稿。以后未变化的文章会按内容指纹跳过。需要主动重建或更新草稿时，仍从后台副本执行：

```bash
pnpm wechat:agent:run -- --force
```

`--force` 会更新或重建草稿，但不会发布或删除文章。

## 7. 查看状态和日志

```bash
pnpm wechat:agent:status
```

状态命令会显示 LaunchAgent 是否加载、后台仓库位置、最近执行时间、结果和已同步提交。运行日志位于：

```text
~/Library/Logs/EthanSMC/wechat-draft-sync.log
~/Library/Logs/EthanSMC/wechat-draft-sync.error.log
```

实时查看：

```bash
tail -f "$HOME/Library/Logs/EthanSMC/wechat-draft-sync.log"
```

如果同步失败，GitHub 提交、Vercel 部署和网站内容都不受影响。修复 IP 白名单、网络、素材格式或凭据后，运行 `pnpm wechat:agent:run` 即可幂等重试。

## 8. 停用

```bash
pnpm wechat:agent:uninstall
```

停用命令只卸载 LaunchAgent，保留凭据、状态、日志和后台仓库副本，重新安装即可恢复。需要彻底删除时，应先停用，再手工确认并移除 `~/Library/Application Support/EthanSMC/WeChat Draft Sync` 和对应日志。

## 9. 当前能力边界

这套 Agent 不会：

- 调用 `freepublish/submit` 自动发布；
- 调用 `freepublish/delete` 删除已发布文章；
- 模拟登录微信公众平台；
- 把 AppSecret 或 Access Token 发送到 GitHub 或 Vercel；
- 下载和转存任意外链图片；
- 在 Mac 关机期间实时运行。

以后账号获得发布权限时，可以在现有 `WechatClient` 和状态机之后接入 `freepublish/submit → freepublish/get → article_id`，不需要重做 Markdown、图片和后台同步流程。
