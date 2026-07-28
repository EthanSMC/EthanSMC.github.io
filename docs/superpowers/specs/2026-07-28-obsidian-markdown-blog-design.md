# Obsidian Markdown Blog Design

**Date:** 2026-07-28
**Status:** Approved in conversation, pending written-spec review

## Goal

Extend the existing personal introduction site with a first-party writing space for short notes and longer essays. Ethan writes plain Markdown in a dedicated Obsidian vault. Moving a finished file into `published/` is the only explicit publish action; Obsidian Git, GitHub, Eleventy, and Vercel perform the remaining work automatically.

The blog must add “how Ethan thinks” without turning the homepage into a content portal or weakening the existing hand-drawn Digital Ethan identity.

## Reference and Direction

The information architecture takes inspiration from [ianneo.xyz](https://ianneo.xyz): the personal homepage introduces the author and provides a clear door into a separate writing space. The implementation does not copy Ian's Notion presentation. It keeps this site's paper, pencil, blue-ink, hand-drawn, and Digital Ethan visual language.

The selected visual direction is:

- A full Writing section on the homepage.
- A field-notes timeline for the blog index.
- A margin-notebook layout for essays.
- Full inline rendering for short notes, with permanent links.

## Scope

### Included in the first release

- Same-domain blog at `/blog/`.
- Homepage Writing navigation and generated latest-writing section.
- Plain Markdown authoring in Obsidian without author-maintained YAML.
- Short `Note` and long `Essay` content forms.
- Arbitrary author-created hashtags and generated tag filters.
- Draft isolation and publish-by-moving-file workflow.
- Automatic Git commit, pull, and push through Obsidian Git.
- Static generation with Eleventy.
- Essay and Note permanent pages.
- Generated tag pages, RSS, sitemap, canonical metadata, and social metadata.
- Reading time and previous/next navigation.
- Responsive and accessible layouts.
- Regression protection for the existing portfolio experience.

### Explicitly excluded

- Full-text search.
- Comments, likes, view counts, and email subscriptions.
- Fixed categories.
- Obsidian graph publishing or rendered backlinks.
- Obsidian `[[wikilinks]]` and `![[embeds]]` in the first release.
- A database or runtime CMS.
- Automatic publication on every save.

## Architecture

Eleventy is added incrementally to the existing static site. It generates the blog and the dynamic homepage Writing section while preserving the current HTML structure, Three.js scene, CSS, JavaScript behavior, API function, and test suite. Static assets and unchanged files are copied through to the build output.

The content vault lives inside the existing Git repository:

```text
Personal_Page/
├── content/                    # Open this folder as the Obsidian vault
│   ├── drafts/                 # Local-only, ignored by Git
│   ├── published/              # Public Markdown source
│   └── assets/                 # Local attachments; published references are staged
├── blog/
│   ├── index.njk               # Field-notes timeline
│   ├── post.njk                # Essay page
│   ├── note.njk                # Note permalink page
│   └── tag.njk                 # Generated tag archive
├── _includes/                  # Shared Eleventy layouts and partials
├── scripts/
│   └── prepare-content.mjs     # Deterministic metadata extraction
├── .githooks/
│   ├── pre-commit              # Referenced-attachment staging and validation
│   └── commit-msg              # Obsidian auto-commit path guard
└── _site/                      # Generated output, ignored by Git
```

Obsidian Git supports a vault located in a subdirectory of its Git repository. The vault therefore remains focused on writing while Git operations target the existing `Personal_Page` repository.

## Authoring Contract

Writers do not maintain YAML or properties. A long article can be written as:

```markdown
# 当执行越来越便宜，判断力还剩下什么？

#AI #产品 #判断

最近我越来越强烈地感受到，方案正在变便宜……

## 答案变多以后

正文继续。
```

A short note can be written without a title:

```markdown
产品经理不是需求翻译器。真正困难的部分，是知道哪些话不能直接翻译成需求，以及为什么。

#产品 #工作
```

Standard Markdown headings, lists, quotes, links, images, fenced code, tables, and footnotes are supported. First-release content uses standard Markdown links and images rather than Obsidian-only link syntax.

### Stable file identity

Obsidian's core **Unique note creator** creates every draft in `drafts/` with the filename format:

```text
YYYY-MM-DD-HHmmss.md
```

The timestamp is the stable content ID and displayed date. It does not depend on filesystem birth time, Git history depth, or build time. Moving or rebuilding a note never changes its URL.

Example source and output:

```text
content/published/2026-07-28-084201.md
→ /blog/2026/07/28/084201/
```

The timestamp represents when the thought was first recorded. The site labels it as the note date rather than making a separate publication-date claim.

### Automatic metadata extraction

`prepare-content.mjs` derives metadata deterministically at build time:

- **Title:** First level-one heading. If absent, generate a metadata-only title from the first sentence, limited to 36 visible characters. Notes without an authored title do not display the generated title in the timeline.
- **Date and permalink:** Parsed from the timestamp filename.
- **Tags:** Extract hashtag tokens outside headings, links, inline code, and fenced code blocks. Tag-only lines are removed from rendered body content.
- **Type override:** `#note` and `#essay` are reserved directives and are never exposed as public tags.
- **Automatic type:** Use `Essay` when the document contains a level-two heading or more than 600 normalized visible characters; otherwise use `Note`.
- **Summary:** First non-heading, non-tag-only paragraph converted to plain text and limited to 120 visible characters.
- **Reading time:** Calculated from normalized Chinese characters and Latin words.
- **Updated time:** Not shown in the first release, avoiding unstable filesystem timestamps.

Tag labels retain the author's casing for display. Matching is case-insensitive for Latin text. Tag archive paths use the URL-encoded normalized label, avoiding transliteration dependencies and collisions.

## Obsidian Workflow

### Vault setup

After implementation, Ethan selects **Open local vault** and opens:

```text
/Users/ethancc/Documents/Personal_Page/content
```

The existing `Obsidian_vault` remains separate and unchanged.

Vault configuration:

- Default new-note location: `drafts/`.
- Attachment location: `assets/`, referenced as `../assets/<filename>` from both source folders.
- Enable the core Unique note creator plugin.
- Unique-note format: `YYYY-MM-DD-HHmmss`.
- Unique-note folder: `drafts/`.
- Use standard Markdown links for public content.
- Disable Obsidian's `Use [[Wikilinks]]` option so inserted links and images use portable Markdown syntax.

### Obsidian Git configuration

Install and enable the community plugin **Git** by Vinzent03. Configure:

- Pull when Obsidian starts.
- Enable **Auto commit-and-sync after stopping file edits**.
- Idle delay: 2 minutes.
- Disable the unrelated fixed-interval auto commit timer.
- Enable pull before push and automatic push.
- Commit message: `blog: sync {{date}}`.
- Keep visible status and error notifications enabled.

The authoring loop is:

```text
Create a timestamped draft
→ write Markdown and optional hashtags
→ move the finished Markdown file to published/
→ stop editing
→ Obsidian Git automatically commits, pulls, and pushes
→ Vercel builds and deploys the main branch
```

Moving the file is the publication gate. Saving a draft never publishes it.

### Draft and attachment privacy

The public GitHub repository must not contain drafts. Root `.gitignore` excludes:

```text
content/drafts/
content/.obsidian/
content/.trash/
content/assets/*
```

Attachments are initially ignored so images pasted into private drafts are not uploaded. The pre-commit hook scans published Markdown and force-stages only local assets referenced by published content. Previously tracked assets remain tracked. Unreferenced draft assets stay local.

Drafts are therefore local-only and are not backed up by Git. Time Machine or a separate private sync service may back them up, but that is outside the website's first-release scope.

### Automatic-commit protection

Obsidian Git's automatic commit-and-sync stages repository changes. To prevent a content sync from accidentally including unfinished website code, repository-managed Git hooks enforce:

- The pre-commit hook validates staged published content and force-stages only the local assets referenced by that content.
- The commit-message hook recognizes the configured `blog: sync` prefix.
- An automatic `blog: sync` commit is allowed only when every staged path belongs to `content/published/` or its referenced `content/assets/` allowlist.
- An automatic commit containing website code—whether code-only or mixed with content—is rejected.
- Ordinary developer commits with non-Obsidian messages remain unaffected.
- The rejection explains that website changes must be committed or stashed separately before Obsidian retries.

This guard also covers a subtle case: editing an ignored draft can wake the Obsidian Git timer while unrelated website changes exist. The resulting automatic code-only commit is rejected by its `blog: sync` message. The hook path is enabled locally during setup with `git config core.hooksPath .githooks`.

## Page Design

### Homepage Writing section

Add `Writing` to the primary navigation. Insert the section after Featured Projects and before Featured Repositories.

The section is generated from published content:

- Left: newest Essay with title, summary, tags, and reading time.
- Right: two newest Notes with full short bodies.
- Footer action: `查看全部文章` linking to `/blog/`.

The component looks like a pinned field-note spread using the existing paper palette, blue ink, imperfect borders, and tape/pin vocabulary. It does not introduce a separate design system.

### Blog index

`/blog/` uses the selected field-notes timeline:

- Intro copy: `记录产品现场、AI 实践，以及那些暂时没有结论的想法。`
- Dynamic tag filters generated only from published content.
- Tag counts beside each filter.
- Reverse chronological timeline.
- Solid blue node for Essays.
- Hollow pencil node for Notes.
- Essays show title, summary, tags, and reading time.
- Notes show the full body and a permanent-link action.
- Twenty timeline entries per static page.

Each tag receives a shareable static archive at `/blog/tag/<encoded-tag>/`, using the same timeline component and pagination.

### Essay page

The selected margin-notebook template provides:

- A narrow desktop margin with Essay label, date, reading time, and tags.
- A focused single-column article body.
- Standard treatments for headings, lists, block quotes, images, captions, code, tables, and footnotes.
- Previous article, next article, and return-to-blog links.
- On small screens, margin metadata moves above the title and the body uses the full readable width.
- No floating table of contents or ambient motion.

### Note page

Notes are fully readable in the blog timeline but still receive permanent pages for sharing, RSS, search indexing, and navigation.

The permanent page resembles a single loose note:

- Full body.
- Date and time.
- Public tags.
- No forced visible title or summary.
- Previous/next and return-to-blog links.

## Generated Outputs

Every build generates:

- Homepage latest Writing section.
- Blog index and pagination.
- Tag archives and pagination.
- Essay and Note permanent pages.
- RSS feed with full Note bodies and Essay summaries.
- XML sitemap.
- Canonical URL, page title, description, and Open Graph metadata.
- Previous and next navigation based on timestamp order.

The Vercel build command becomes `npm run build`, and the output directory is `_site`.

## Failure Behavior

- A draft is never included in collections, RSS, sitemap, or copied output.
- A filename that does not match the timestamp contract fails the build with the exact file path and required format.
- Empty published Markdown fails the build.
- Malformed local image references fail the build before deployment.
- Unsupported Obsidian wiki links fail validation with a standard-Markdown replacement hint.
- An automatic `blog: sync` commit containing any non-content path is rejected locally before Git creates it.
- A Git pull conflict stops automatic sync and remains visible in Obsidian; no force push is used.
- A failed Vercel build leaves the previous production deployment active.
- A failed push keeps the published file and local commit available for retry.

## Accessibility and Responsive Requirements

- Semantic headings and landmark regions.
- Real links for navigation, tags, articles, and pagination.
- Visible keyboard focus matching the existing site.
- No interaction depends only on color or pointer hover.
- Note and Essay nodes include text labels in accessible names.
- Comfortable Chinese line height and bounded reading measure.
- Images require generated width/height and authored alt text convention; decorative images use empty alt text.
- Existing reduced-motion behavior remains intact; blog pages add no required motion.
- Mobile layouts preserve full text, large tap targets, and horizontal overflow safety for code and tables.

## Testing Strategy

### Metadata unit tests

- Timestamp filename parsing and stable permalink generation.
- H1 title extraction and first-sentence fallback.
- Hashtag extraction, normalization, directive removal, and code-block exclusion.
- Note/Essay threshold and explicit override.
- Summary and reading-time calculation.
- Local attachment discovery.

### Build integration tests

- Drafts never appear in `_site`, collections, RSS, or sitemap.
- Published Markdown generates the expected permanent route.
- Homepage selects the newest Essay and two newest Notes.
- Tag archives include all and only matching posts.
- RSS, sitemap, canonical URLs, and social descriptions are valid.
- Previous/next links follow timestamp order.
- Invalid filename, empty content, wiki links, and missing assets fail with actionable messages.

### Browser tests

- Homepage Writing navigation and generated content.
- Blog index layout, pagination, and tag navigation.
- Full inline Note rendering and permanent links.
- Essay metadata and article typography.
- Desktop, tablet, and mobile layouts.
- Keyboard navigation and visible focus.
- Existing hero, scrolling navigation, project carousel, repository links, contribution calendar, contact dialog, and Three.js fallback remain functional.

### Git workflow tests

- Draft-only edits produce no tracked content changes.
- Moving a valid draft produces a content-only commit.
- Referenced assets are staged; unreferenced draft assets are not.
- Automatic mixed content-and-code commits are rejected.
- Automatic code-only commits triggered by ignored draft edits are rejected.
- Ordinary developer code-only commits remain allowed.

## Rollout

1. Add Eleventy and content-processing tests without changing production output.
2. Add representative Note and Essay fixtures and generate blog routes.
3. Build the blog index and reading templates.
4. Integrate the generated homepage Writing section and navigation.
5. Add RSS, sitemap, metadata, and attachment validation.
6. Add Git guard and Obsidian vault setup documentation.
7. Run the full portfolio and blog regression suite.
8. Configure Vercel build/output settings and verify a preview deployment.
9. Open `content/` as the Obsidian vault, install/configure Obsidian Git, and perform one end-to-end test publication.

## References

- [Ian's personal site](https://ianneo.xyz)
- [Eleventy](https://www.11ty.dev/)
- [Obsidian Git repository](https://github.com/Vinzent03/obsidian-git)
- [Obsidian Git features](https://publish.obsidian.md/git-doc/Features)
- [Vercel Git deployments](https://vercel.com/docs/git)
