# GitHub Contribution Heatmap Design

## Goal

Add a live GitHub contribution heatmap for `EthanSMC` to the portfolio. The
calendar must follow GitHub's contribution-counting semantics, include
anonymous private-repository contributions, preserve the site's hand-drawn
paper aesthetic, and never expose GitHub credentials to the browser.

## Placement And Visual Direction

The heatmap appears in the `Featured Repositories` section, after the four
repository cards and before the `Now` section. This is layout B from the visual
comparison: visitors see the work first, then the longer contribution rhythm.

The component is a full-width paper note with a subtle hand-placed rotation,
graphite border, paper shadow, and a small tape detail. It is not nested inside
another card.

The heading reads `365 days of making`. The latest 12-month contribution total
appears opposite the heading. The calendar uses five intensity levels:

1. Paper-white for no contributions.
2. Light graphite-blue.
3. Soft ink blue.
4. Medium ink blue.
5. Deep ink blue.

This preserves GitHub's intensity semantics without copying its green palette.
The colors must reuse or derive from the portfolio's existing paper, line, and
blue tokens.

Desktop displays all 53 week columns. Mobile also displays the complete year
inside the available width by reducing fixed cell and gap sizes through
responsive constraints; it does not introduce horizontal page scrolling.

## Interaction And Accessibility

Hovering or tapping a contribution day reveals a compact tooltip containing
the date and contribution count. The component links to
`https://github.com/EthanSMC` without obscuring day-level interaction.

The calendar uses grid semantics and exposes an accessible summary containing
the account name, date range, and total contributions. Day cells use roving
keyboard focus so arrow keys can inspect dates without adding hundreds of
stops to the page's normal tab order. Reduced-motion mode disables decorative
entrance animation while preserving tooltips and keyboard navigation.

## Architecture

### Serverless API

Add a Vercel Node.js function at `/api/github-contributions`. It sends an
authenticated request to GitHub's GraphQL API for the `EthanSMC` user's
`contributionsCollection` and `contributionCalendar` over the latest available
12-month range.

The function returns only presentation-safe fields:

```json
{
  "username": "EthanSMC",
  "from": "2025-07-14",
  "to": "2026-07-14",
  "total": 1284,
  "weeks": [
    {
      "days": [
        {
          "date": "2026-07-14",
          "count": 3,
          "level": 2
        }
      ]
    }
  ]
}
```

GitHub's `contributionLevel` values are normalized to integer levels `0` to
`4`. The API does not return repository names, commit messages, contribution
URLs, token metadata, or GraphQL error internals.

Successful responses use:

```text
Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
```

This provides near-real-time hourly refreshes while allowing Vercel to serve a
recent response during a transient GitHub failure.

### Credentials And Privacy

`GITHUB_TOKEN` exists only as a Vercel environment variable and is read only by
the serverless function. It is never embedded in HTML, CSS, JavaScript bundles,
logs, API responses, test fixtures, or git history.

Use a read-only GitHub token owned by `EthanSMC` with access to all repositories
whose contribution counts should appear. It must have no write or
administration permissions. GitHub profile settings must allow private
contributions to appear anonymously. The public site exposes daily totals only;
private repository identities and activity details remain hidden.

### Frontend Component

Add semantic heatmap markup after `.repo-cards`, with loading placeholders that
match the final grid dimensions. `script.js` fetches the same-origin API,
validates the response shape, renders week/day cells, calculates tooltip text,
and manages roving keyboard focus.

No third-party heatmap library or client-side GitHub request is used. Keeping
rendering local allows the component to match the hand-drawn design and keeps
the credential boundary easy to audit.

## Data Flow

1. The portfolio loads and renders the fixed-size heatmap skeleton.
2. The browser requests `/api/github-contributions` from the same origin.
3. Vercel serves a cached response or invokes the serverless function.
4. The function reads `GITHUB_TOKEN` and requests GitHub GraphQL.
5. The function validates and reduces GitHub's response to calendar totals.
6. The browser replaces skeleton cells with contribution levels and enables
   tooltip and keyboard interaction.

## Loading And Failure States

While loading, the component shows a low-contrast paper grid with the same
dimensions as the final calendar, preventing layout shift.

If the token is missing, GitHub rejects the request, the response is malformed,
or the network is unavailable, the serverless function returns a generic `503`
JSON response without sensitive details. The frontend retains the paper note,
shows `Contribution data is temporarily unavailable`, and provides the GitHub
profile link. The rest of the page remains fully usable.

An `AbortController` timeout prevents a stalled request from leaving the
component permanently in its loading state.

## Testing

Automated coverage includes:

- Server-side transformation of GitHub GraphQL calendar data.
- Mapping all GitHub contribution levels to integers `0` through `4`.
- Missing-token, GraphQL-error, malformed-response, and timeout behavior.
- Frontend loading, populated, and unavailable states using deterministic
  fixtures rather than a live GitHub token.
- Correct username, date range, total, cell count, and profile URL.
- Tooltip content and roving arrow-key navigation.
- Desktop and mobile screenshots, no horizontal overflow, readable labels, and
  stable component dimensions.
- Reduced-motion behavior.
- A production smoke test confirming that the deployed API returns a valid,
  credential-free payload and the calendar renders.

## Deployment

Before production deployment, add `GITHUB_TOKEN` to the linked Vercel project's
Production environment. The token value is entered directly through Vercel's
secure environment-variable flow and is not pasted into source files.

Deploy the code to the existing `main` branch and linked Vercel production
project. After deployment, verify the stable alias, API cache headers, private
contribution inclusion, mobile layout, and absence of token-like values in the
HTML and API response.

## Out Of Scope

- Repository-level private contribution details.
- Commit messages or contribution activity feeds.
- Historical year switching.
- User-selectable color themes.
- A third-party heatmap embed.
