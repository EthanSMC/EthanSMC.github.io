# Writing Albums and Native WeChat Notes Design

## Outcome

The homepage and `/blog/` present writing as three distinct forms: ordered albums, independent articles, and chronological small talks. Obsidian metadata is the source of truth. Notes continue to render as text on the website and publish to WeChat as one native `newspic` draft containing one to four generated poster images.

## Content contract

All new metadata lives in YAML frontmatter. Existing timestamped Markdown without frontmatter keeps the legacy `Essay`/`Note` inference.

```yaml
---
kind: album
title: AI 原生个人内容系统
slug: ai-native-content-system
status: ongoing
featured: true
order: 1
cover: "[[assets/albums/ai-native-content-system/cover.png]]"
cover_alt: Ethan、Mochi 和 Molly 搭建个人内容系统
cover_cast: [mochi, molly]
description: 从 Obsidian 出发，逐步搭建属于自己的 AI 原生内容系统。
---
```

```yaml
---
kind: article
album: "[[AI原生个人内容系统]]"
track: 3
---
```

```yaml
---
kind: note
wechat: true
cast: auto
---
```

`kind: article` without `album` is a valid independent article. If `album` is present but cannot resolve to exactly one Album MD, that article fails validation instead of silently becoming independent. Tracks are derived by backlinks and sorted by unique positive integer `track`; Album MD does not duplicate a track list.

Album files live under `content/albums/`, retain stable human-readable basenames, and are excluded from the timestamp rename applied to `content/published/`. Article-to-album references therefore remain stable when an article is published. The supported reference is exactly `[[Album basename]]`; aliases, embeds, and ambiguous duplicate basenames are rejected.

## Website

The signature interaction is a restrained manual iPod Cover Flow. The selected album is front-facing; unselected covers rotate 18–24 degrees around the Y axis and recede slightly. It never auto-advances. Arrow buttons, keyboard controls, pointer swipes, accessible status text, and reduced-motion behavior are required.

Both homepage and `/blog/` use the same album rail and data model. Desktop layout is 70/30: album rail on the left and independent articles on the right. Small talks are a full-width chronological list below. Mobile stacks album, independent articles, then small talks. The homepage uses shorter lists; `/blog/` exposes fuller lists and album navigation.

Chinese labels are `专辑`, `独立文章`, `碎碎念`, and `查看全部写作`. English labels are `Albums`, `Independent writing`, `Small Talks`, and `View all writing`. No English section label appears while the Chinese locale is active.

## Native WeChat small talks

`kind: note` defaults to website plus WeChat. `wechat: false` is the explicit opt-out. The website still succeeds when WeChat rendering, upload, or publication fails.

Notes render to 1080×1440 PNG pages. The renderer measures the final type layout, keeps a fixed readable font size, splits at paragraphs before sentences, and never truncates. One to four pages are accepted. More than four pages produces `content_too_long` for WeChat while the website remains published.

Only page one contains a small fixed character asset. A constrained semantic classifier selects Mochi for reflective/long-term/life writing and Molly for product/AI/automation/action writing. Low confidence, timeout, invalid output, or unavailable classification falls back to Molly. `cast: mochi`, `cast: molly`, and `cast: none` override classification. AI never generates the character asset at publication time.

The WeChat internal title for an untitled note is `碎碎念 · YYYY.MM.DD`; it is not inserted into the note body. The final page has a small author and website text line and no QR code.

The native draft uses `article_type: "newspic"` and `image_info.image_list`; the first image is the cover. Existing articles keep the `news` renderer.

## Idempotency and state

Each source record stores `sourceMd5`, a render hash, its reusable WeChat draft media ID, generated asset inventory, and publication lifecycle. Raw file bytes define `sourceMd5`. The render hash includes `sourceMd5`, template version, renderer version, font identity, selected character asset hash, and referenced rendering assets.

If the MD5 is unchanged, sync reuses generated pages and the existing draft. If the MD5 changes before publication, sync regenerates pages and updates the same draft. Once WeChat publication succeeds, future MD5 changes update only the website. Machine state lives in `.wechat-sync`; publication never rewrites source Markdown.

## Compatibility and boundaries

- Old Markdown continues to publish without migration.
- Album changes rebuild website views only and never republish album articles.
- An invalid album link blocks only that article.
- A WeChat failure never blocks the website or unrelated content.
- Generated posters stay under `.wechat-sync/generated/<post-id>/` and never enter public content assets.
- No runtime dependency is added unless it is already present in the lockfile.
