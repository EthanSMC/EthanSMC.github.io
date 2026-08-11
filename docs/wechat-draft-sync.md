# 微信公众号草稿箱同步

这条管线的终点是微信公众号草稿箱。文章和碎碎念可以自动新增或更新草稿，但系统不会打开公众号后台、点击发表或撤回。最终检查、发表以及已发表内容的删除都由人在微信后台完成。

## 1. 流程边界

```text
Obsidian 写作
  → Markdown 移入 content/published/
  → Obsidian Git 推送 main
  → 网站构建
  → Mac Agent 快进后台专用仓库
  → 微信 API 新增或更新草稿
  → 人工进入公众号草稿箱检查并发表
```

Mac Agent 每次只运行 `scripts/wechat-sync.cjs --automatic`。旧配置中的 `WECHAT_AUTO_PUBLISH`、`WECHAT_AUTO_WITHDRAW` 和浏览器设置即使仍存在或被设为 `1`，也不会启动发布器或浏览器。

删除或移动本地 Markdown 只影响网站和后续草稿同步资格，不会删除、撤回或修改已经发表的微信公众号内容。

## 2. 内容类型

- `kind: article` 生成微信 `news` 草稿。首次使用 `draft/add`，内容变化时更新同一个未发表草稿。
- `kind: note` 生成微信原生 `newspic` 草稿。正文渲染为一至四张 1080×1440 PNG，第一页作为封面，按页码顺序上传。
- 碎碎念默认同步。写入 `wechat: false` 会跳过该篇的渲染、上传和草稿 API 操作。
- 系统根据元数据稳定选择 Mochi 或 Molly；显式 `cast` 可以固定角色。

每篇记录保存原始 Markdown 的 MD5、渲染输入指纹、角色、草稿类型和图片素材清单。Markdown、角色素材、实际字体或关键渲染依赖未变化时，普通同步不会重新分类、渲染、上传或调用草稿 API；`--force` 会重建尚未发表的草稿。

碎碎念海报只在操作系统临时目录生成，上传后立即清理。长期状态只保存经过严格校验的页码、内容哈希和微信 media ID，不在仓库中维护可写图片缓存。

一旦历史状态确认 `everPublished: true`，自动流程不再修改那条微信内容。以后是否更新、删除或重新发表，都由人在公众号后台决定。

## 3. 安装 Mac Agent

本机需要 macOS、Git、Bun，以及能访问 GitHub 和 `api.weixin.qq.com` 的网络。公众号 API IP 白名单需包含当前公网出口 IPv4。

```bash
cd /Users/ethancc/Documents/Personal_Page
pnpm wechat:agent:install
```

默认每 300 秒检查一次，也可以指定不小于 60 秒的间隔：

```bash
pnpm wechat:agent:install -- --interval 120
```

Agent 的后台仓库、密钥、状态和日志位于：

```text
~/Library/Application Support/EthanSMC/WeChat Draft Sync/
~/Library/Logs/EthanSMC/
```

这些内容不进入 GitHub、Vercel 或日常写作目录。

## 4. 私密配置

安装器只在配置不存在时创建它，并设置为 `0600`：

```bash
open -e "$HOME/Library/Application Support/EthanSMC/WeChat Draft Sync/wechat.env"
```

填写：

```text
WECHAT_APP_ID=公众号 AppID
WECHAT_APP_SECRET=公众号 AppSecret
```

可选配置包括 `SITE_URL`、`WECHAT_AUTHOR` 和 `WECHAT_DEFAULT_COVER`。不需要 Chrome 登录态，也不需要任何自动发布、自动撤回或浏览器参数。

## 5. 日常运行

后台 Agent 会按安装时的间隔自动检查。也可以手动运行：

```bash
pnpm wechat:agent:run
```

完整渲染和校验，但不访问微信 API、不写状态：

```bash
pnpm wechat:agent:run -- --dry-run
```

强制重建尚未发表的草稿：

```bash
pnpm wechat:agent:run -- --force
```

`--force` 仍然只操作草稿箱，不能发表、撤回或修改任何已发表内容。

查看 Agent 和最近一次结果：

```bash
pnpm wechat:agent:status
tail -f "$HOME/Library/Logs/EthanSMC/wechat-draft-sync.log"
```

## 6. 失败与恢复

- 单篇碎碎念渲染、上传或草稿 API 失败会记录在该篇状态中，其他内容继续处理。
- 全局凭据、网络或状态文件错误会终止本轮；修复后再次运行即可。
- 微信报告原草稿不存在时，系统会创建新的草稿；其他不明确错误不会猜测或重复创建。
- `--dry-run` 可先验证分页和 payload，不会留下海报缓存或访问微信。
- 不要通过删除 `state.json` 解决问题；它保存草稿 media ID、内容哈希和已发表保护信息。

## 7. 人工发表与撤回

同步成功后，打开微信公众号后台的草稿箱，检查标题、正文、图片顺序和封面，然后手动发表。

发表后的内容不再由这条自动管线管理。要撤回或删除，必须在微信公众号后台人工操作。移动、重命名或删除 Obsidian/网站里的 Markdown，都不会对已发表微信内容产生副作用。

## 8. 停用

停用后台轮询：

```bash
pnpm wechat:agent:uninstall
```

卸载会保留凭据、状态、日志和后台仓库副本，之后可以重新安装恢复草稿同步。
