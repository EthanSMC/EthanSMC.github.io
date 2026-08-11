# 微信公众号草稿与浏览器生命周期

> **本次交付边界：只同步到微信公众号草稿箱。** `kind: article` 和 `kind: note` 的自动化都在草稿成功新增或更新后停止；不自动点击发表，也不自动撤回。`WECHAT_AUTO_PUBLISH=0` 与 `WECHAT_AUTO_WITHDRAW=0` 必须继续保持关闭，本次交付不包含真实发表、真实撤回或 live E2E 验收。

Mac Agent 现在在同一把进程锁内串行执行一条流程：更新后台专用仓库、同步公众号草稿，再处理浏览器发布或撤回生命周期。文章草稿或全局同步失败时不会启动浏览器阶段；单篇碎碎念的海报渲染、上传或草稿 API 失败会写入该篇记录、撤销其旧草稿的待发布资格，并继续处理其他内容。浏览器阶段失败时，已经保存的草稿和状态仍然保留。

## 1. 完整流程

```text
任意写作设备上的 Obsidian
  → drafts/ 移入 published/
  → Obsidian Git 提交并推送 main
  → GitHub / Vercel 更新网站
  → Mac Agent 快进后台专用仓库
  → API 新增或更新公众号草稿
  → 生命周期状态机按配置决定是否打开专用 Chrome
  → 精确匹配后发布，或按撤回标记撤回
```

后台仓库位于 `~/Library/Application Support/EthanSMC/WeChat Draft Sync/repo`，不会拉取、重置或覆盖日常写作目录。状态、Chrome 配置、诊断截图和密钥也都位于 Agent 私有目录，不进入 GitHub 或 Vercel。

Agent 内部传给生命周期命令的 `--automatic` 只表示“这是后台无人值守调用”。它不会启用发布或撤回，也不是第二套运行模式；真正的授权始终来自私密配置中的两个独立开关和已经持久化的生命周期状态。

## 2. 发布与撤回约定

- `content/drafts/` 继续被 Git 忽略，草稿正文、标题、Tag、附件路径不会上传。
- `kind: article` 使用 `news` 草稿：第一次同步时使用 `draft/add`，未发表文章发生变化时使用 `draft/update`；正文图片先转换为微信 CDN URL，封面继续使用永久图片素材。
- `kind: note` 使用原生 `newspic` 草稿。正文先渲染成一至四张 1080×1440 PNG，再按页码顺序通过永久图片素材接口上传；第一页即封面，草稿 payload 只包含本轮有效页面的 media ID。
- 碎碎念默认同步公众号；`wechat: false` 明确关闭该篇的渲染、上传和草稿 mutation。若它曾处于自动待发布状态，会先降为 `draft_only`，避免浏览器发表旧草稿。重新启用后只在草稿重新验证或更新成功时恢复资格。
- 每篇记录保存原始 Markdown bytes 的 `sourceMd5`、Task 4 海报渲染器返回的 `renderHash`、`draftKind` 和 `generatedImages`。海报缓存只位于 `.wechat-sync/generated/<post-id>/`；两个 hash、状态 inventory、实际文件名和文件内容 hash 必须全部一致才可复用，多余或缺失页面会使整组缓存失效。
- 未发表的碎碎念源 MD5 或 renderer/font/character asset 发生变化时，会重新生成并更新同一个草稿 media ID；只有微信明确报告原草稿缺失时才重新 `draft/add`。一旦 `everPublished` 为真，后续源文件变化只更新网站观察状态，绝不重新绘图、上传或修改微信草稿。
- 单篇碎碎念失败时，根记录中的 `syncError` 保存错误码、消息和时间；其他文章和碎碎念继续同步。未同步成功的旧待发布草稿会变成 `draft_only`，下一次成功同步后再恢复。
- 建立发布基线后才会产生自动发布候选。基线内的旧文章永不自动补发。
- 新文章只有在草稿成功保存后才会成为待发布状态。
- 把 `published/<时间戳 ID>.md` 原样移回本机的 `drafts/`，更新后的 Git hook 才会生成同 ID、无正文的撤回标记。只有这种精确移动授权微信操作。
- 撤回标记带有规范 UTC `requestedAt` 代次。Agent 在取消、撤回或核对前先持久化已消费代次；保留在 Git 中的旧标记不会在文章恢复后因一次普通删除而重新授权。以后再次精确移回 `drafts/` 会写入严格更新的代次，形成一次新的明确授权。
- 直接删除 `published/` 文件而不保留同 ID 私密草稿，不生成标记，只让网站下线，不触碰微信。
- 尚未开始发布的文章移回草稿时，只取消自动发布；已经存在的微信草稿会保留。
- 已验证发表的文章移回草稿后，在 `WECHAT_AUTO_WITHDRAW=1` 时会精确匹配并撤回，不再逐篇询问。
- 任何已知发表过的文章，即使撤回、重新编辑或移回 `published/`，也永远不会自动再次发表；重新移回只恢复网站。
- 找不到唯一文章、页面变化、验证码、登录失效或点击结果不确定时，系统停止猜测。点击后的不确定状态必须由操作员 `resolve`，无人值守运行不会重复点击。

## 3. 每台写作设备都要安装 Git 保护

克隆或更新仓库后，每一台可能发布或撤回文章的设备都必须在该设备的仓库根目录重新运行：

```bash
./scripts/setup-obsidian-git.sh
```

这个步骤把当前仓库的 `.githooks` 配置为实际 Git hook。只把脚本拉到设备上并不等于已经启用；没有重新运行脚本的设备不能产生可信撤回标记。

移动文章时必须保留自动分配的时间戳文件名。草稿正文仍只留在本机；提交到 Git 的撤回标记只有 `postId` 和 UTC `requestedAt`。

## 4. 安装 Mac Agent

本机需要 macOS、Git、Bun、已安装的 Google Chrome，以及能访问 GitHub、`api.weixin.qq.com` 和微信公众平台的网络。公众号 API IP 白名单需要包含当前公网出口 IPv4。

先确保功能代码已经推送到 Agent 跟踪的分支，然后运行：

```bash
cd /Users/ethancc/Documents/Personal_Page
pnpm wechat:agent:install
```

默认每 300 秒运行一次；可以指定不小于 60 秒的间隔：

```bash
pnpm wechat:agent:install -- --interval 120
```

安装器会创建权限为 `0600` 的 `wechat.env`，并且只在文件不存在时创建。重新安装不会覆盖已有配置，也不会把任何自动化开关改成 `1`。

## 5. 私密配置与安全默认值

打开安装器创建的文件：

```bash
open -e "$HOME/Library/Application Support/EthanSMC/WeChat Draft Sync/wechat.env"
```

至少填写 API 凭据，并保留浏览器生命周期默认值：

```text
WECHAT_APP_ID=公众号 AppID
WECHAT_APP_SECRET=公众号 AppSecret

WECHAT_AUTO_PUBLISH=0
WECHAT_AUTO_WITHDRAW=0
WECHAT_BROWSER_CHANNEL=chrome
WECHAT_BROWSER_HEADLESS=0
```

旧版 `wechat.env` 不会被安装器改写。运行以下命令时，状态输出会列出缺少的设置，并逐行给出可以复制到文件末尾的默认值：

```bash
pnpm wechat:agent:status
```

`WECHAT_AUTO_PUBLISH` 与 `WECHAT_AUTO_WITHDRAW` 本次必须保持 `0`；自动发表、自动撤回及其真实验收不属于本次交付。`WECHAT_BROWSER_HEADLESS` 默认也保持 `0`，不要为本次草稿箱同步启用浏览器自动化。

## 6. 登录、建立基线与无副作用验证

在操作发布器命令的终端里，先指向 Agent 私密配置：

```bash
export WECHAT_ENV_FILE="$HOME/Library/Application Support/EthanSMC/WeChat Draft Sync/wechat.env"
```

确认 Agent 已经至少成功同步一次草稿状态，然后按这个顺序设置：

```bash
pnpm install
pnpm wechat:publisher:login
pnpm wechat:publisher:arm
pnpm wechat:publisher:status
pnpm wechat:publisher:run -- --dry-run
```

`login` 打开专用的有界面 Chrome 配置，只验证登录，不发表文章。`arm` 把当前全部文章记录为基线，因此必须在开启自动发布前完成，而且可安全重复运行。`status` 显示基线、待发布、阻塞、发表待核对、撤回待核对以及最近成功时间。`--dry-run` 不写状态，也不会启动浏览器。

自动发布的持久化 arming 状态同时要求规范 UTC 时间和显式验证过的基线快照（空数组也是有效快照）。缺少或损坏任一部分都会在打开浏览器前失败关闭，不能让旧文章获得发布资格。

当前真实微信发表列表的“已就绪且结果可穷尽”契约尚未完成受控验收，因此生产浏览器适配器不会把 DOM 零匹配解释为文章不存在，也不会执行依赖该判断的自动点击。加载中、部分结果、分页或无法识别的列表都以代码化全局错误停止。只有在后续真实验收把该契约显式接入适配器后，两个私密开关才具有实际启用条件；在此之前必须继续保持 `0`。

完成单独的受控验收前，两个自动化开关都保持 `0`。验收自动发布后只开启 `WECHAT_AUTO_PUBLISH=1`；使用另选的可丢弃文章完成精确撤回验收后，才开启 `WECHAT_AUTO_WITHDRAW=1`。安装、登录、建立基线和 `--automatic` 都不会代替这两个明确授权。

撤回后的核对不仅检查完整发表列表；若状态中已有 `https://mp.weixin.qq.com/s/...` 公开链接，还必须对这个精确 URL 得到确定的 `404` 或 `410`。链接仍可读取或响应不明确时保留 `withdraw_reconcile`，并停止本轮后续点击。

## 7. 日常运行、强制同步与日志

手动执行完整 Agent：

```bash
pnpm wechat:agent:run
```

只做转换和状态预览、不访问微信 API 或登录态浏览器：

```bash
pnpm wechat:agent:run -- --dry-run
```

`--dry-run` 仍会完整验证碎碎念分页和 `newspic` payload，因此本机海报渲染器可能启动一次无登录态的 headless Chrome。生成物使用临时目录和占位 media ID；它不调用微信 API、不写状态，也不会改动或留下持久海报缓存。

强制重建尚未发表的草稿：

```bash
pnpm wechat:agent:run -- --force
```

`--force` 只传给草稿同步。它不能授权浏览器发表或撤回，不能复活基线文章，也不能让已发表文章再次发表。

日志位于：

```text
~/Library/Logs/EthanSMC/wechat-draft-sync.log
~/Library/Logs/EthanSMC/wechat-draft-sync.error.log
```

查看服务与最近结果：

```bash
pnpm wechat:agent:status
tail -f "$HOME/Library/Logs/EthanSMC/wechat-draft-sync.log"
```

## 8. 阻塞与不确定状态恢复

先运行：

```bash
pnpm wechat:publisher:status
```

点击前因为某一篇文章无法精确匹配而进入 `blocked` 时，修正页面或草稿后可以只重试该文章：

```bash
pnpm wechat:publisher:run -- --retry POST_ID
```

如果可能已经点击发表，状态会停在 `publish_reconcile`。人工查看微信后，二选一：

```bash
pnpm wechat:publisher:resolve POST_ID -- --published https://mp.weixin.qq.com/s/...
pnpm wechat:publisher:resolve POST_ID -- --not-published
```

如果可能已经点击撤回，状态会停在 `withdraw_reconcile`。人工确认公开文章是否仍存在后，二选一：

```bash
pnpm wechat:publisher:resolve POST_ID -- --withdrawn
pnpm wechat:publisher:resolve POST_ID -- --still-published
```

`--still-published` 是唯一允许再次尝试撤回的路径，因为它代表人工确认上一次没有移除文章。不要用 `--retry` 或删除状态文件绕过 reconciliation；这会破坏“至多点击一次”的保护。

登录二维码、CAPTCHA、账号验证或专用 Chrome 配置被占用时，先关闭冲突窗口或重新运行 `pnpm wechat:publisher:login`，再重跑 Agent。不要复制浏览器配置、手改 cookies，或把密钥、HTML 和截图提交到仓库。

## 9. 停用与回滚

只关闭自动发表和撤回时，把私密配置改回：

```text
WECHAT_AUTO_PUBLISH=0
WECHAT_AUTO_WITHDRAW=0
```

草稿同步和网站仍继续，已经发表或撤回的历史不会被重置。完全停用 LaunchAgent：

```bash
pnpm wechat:agent:uninstall
```

卸载命令保留凭据、状态、日志、后台仓库和浏览器配置，重新安装即可恢复。
