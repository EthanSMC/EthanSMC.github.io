# EthanSMC Personal Site

Hand-drawn personal site for EthanSMC, inspired by interactive portfolio layouts and powered by a lightweight Three.js Digital Ethan scene.

## 本地开发

网站使用 Eleventy 生成首页、Writing、文章页、Tag 归档、RSS 和 sitemap。

```bash
pnpm install
pnpm dev
```

然后打开 <http://localhost:4173>。

构建与测试：

```bash
pnpm test
pnpm build
```

## Obsidian Writing

Obsidian 只需打开仓库中的 `content/` 文件夹。文章不需要 YAML，也不需要手动使用时间戳文件名：正常命名、用正文第一个一级标题和任意 `#标签` 写作即可。完成后把 Markdown 从 `drafts/` 移到 `published/`，Obsidian Git 会自动分配内部时间戳、提交并推送。

首次设置、发布规则和错误处理参见 [Obsidian 发布说明](docs/obsidian-publishing.md)。

### 微信公众号草稿同步

Mac 后台 Agent 每 5 分钟检查一次 GitHub `main`，使用独立仓库副本将同一份 Markdown 自动转换并同步到微信公众号草稿箱。从其他设备 Push 也会被发现；Mac 离线期间的更新会在下次上线后补同步。发布和已发布文章删除仍由人工确认。安装、密钥、IP 白名单、状态和重试方式参见 [微信公众号草稿自动同步](docs/wechat-draft-sync.md)。

先执行无副作用检查：

```bash
pnpm wechat:sync -- --dry-run
```

安装并检查后台 Agent：

```bash
pnpm wechat:agent:install
pnpm wechat:agent:status
```

## GitHub contribution calendar

The portfolio reads contribution data through the Vercel function at
`/api/github-contributions`. Set `GITHUB_TOKEN` to a read-only GitHub token for
`EthanSMC` with access to every private repository whose anonymous contribution
counts should be included. Do not place the token in this repository or in
browser JavaScript.

For local API development, create an ignored `.env.local` file:

```text
GITHUB_TOKEN=enter-the-token-locally
```

Then run `vercel dev`. For production, add the same variable through Vercel's
secure Production environment-variable UI or
`vercel env add GITHUB_TOKEN production`.

## Production deployment

Production is deployed through the linked Vercel project so the generated site
and serverless contribution endpoint ship together. Configure `GITHUB_TOKEN`
and, when using a custom domain, `SITE_URL` in Vercel's Production environment,
then deploy the `main` branch through Vercel.

Vercel is the canonical host and provides the serverless contribution endpoint.
GitHub Pages is built from the same Eleventy output by GitHub Actions, so
`ethansmc.github.io` remains a working static mirror instead of publishing raw
repository templates. GitHub Actions validates content, hooks, and the
production build on every push to `main`.

## 内容来源

- Resume and product/project background from EthanSMC.
- Digital Ethan hand-drawn cutout assets.
