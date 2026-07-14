# EthanSMC Personal Site

Hand-drawn personal site for EthanSMC, inspired by interactive portfolio layouts and powered by a lightweight Three.js Digital Ethan scene.

## 本地预览

因为页面使用 ES modules 和 Three.js CDN import，建议用本地 HTTP server：

```bash
python3 -m http.server 4173
```

然后打开 <http://localhost:4173>。

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

Production is deployed through the linked Vercel project so the serverless
contribution endpoint and static portfolio ship together. Configure
`GITHUB_TOKEN` in Vercel's Production environment, then deploy the `main`
branch through Vercel.

## 内容来源

- Resume and product/project background from EthanSMC.
- Digital Ethan hand-drawn cutout assets.
