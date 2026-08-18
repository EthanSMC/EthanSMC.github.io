# WeChat Note Poster Line Break and Title Design

## Outcome

WeChat note posters preserve the author's Markdown line breaks and contain body text only. Draft titles remain metadata: an authored Markdown title is used when present, while an untitled note falls back to `碎碎念 · YYYY.MM.DD`.

## Scope

This change applies only to the `kind: note` poster and `newspic` draft path. It does not change website rendering, long-form `news` drafts, note cast selection, poster dimensions, typography, or publication lifecycle behavior.

## Poster content

The poster renderer uses the note's body Markdown after the existing content parser has extracted its authored H1 title.

- Every line break written inside a Markdown text block remains a line break in the poster.
- Blank lines continue to create separate blocks with the existing paragraph gap.
- Long lines may still wrap automatically at the fixed poster content width.
- Pagination may still split oversized blocks at sentence and Unicode grapheme boundaries.
- The authored H1 and the generated fallback draft title are never inserted into poster blocks.
- The existing fixed body font size, one-to-four-page limit, and `content_too_long` failure remain unchanged.

The renderer must not collapse authored line breaks while normalizing spaces. Pagination must preserve the exact ordered body text, including newline characters, across page fragments.

## Draft title

Poster content and WeChat draft metadata use separate inputs.

1. If the source Markdown contains an authored H1, the `newspic` draft title uses that title.
2. If the source has no authored H1, the draft title is `碎碎念 · YYYY.MM.DD`, using the source filename date.
3. The generated website title derived from body text is not used for an untitled WeChat note.
4. Existing WeChat title-length truncation remains in place.

Neither the authored title nor the fallback title is visible inside any generated poster image.

## Data flow

`parsePost` continues to extract the first authored H1 into `authoredTitle` and removes it from `bodySource`. The note poster renderer parses only `bodySource`, preserves its line-break tokens, paginates the resulting body blocks, and renders the PNG pages. Separately, `buildNewspic` selects `authoredTitle` or the source-date fallback for the draft payload.

The poster template version or renderer fingerprint changes with this behavior so an existing unpublished note can be regenerated instead of reusing an outdated titled poster.

## Error handling

No new fallback silently rewrites content. Invalid measurements and notes requiring more than four poster pages retain their existing errors. A poster-rendering failure remains isolated from website publication.

## Verification

Focused tests will verify that:

- a single authored line break remains a newline in the poster block and rendered SVG;
- blank-line paragraphs remain separate blocks;
- pagination preserves all body text and newline characters in order;
- posters contain no visible title block for titled or untitled notes;
- authored H1 titles are used in the `newspic` draft payload;
- untitled notes use the source-date fallback instead of a body-derived title;
- the existing page limit, fixed typography, cast, footer, and draft payload tests remain green.
