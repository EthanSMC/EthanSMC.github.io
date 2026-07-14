# GitHub Contribution Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, private-contribution-aware GitHub calendar for `EthanSMC` after the featured repository cards, styled as a hand-drawn paper note.

**Architecture:** A same-origin Vercel Node.js function authenticates to GitHub GraphQL, reduces `ContributionCalendar` to safe daily totals, and caches successful responses for one hour. The existing static frontend fetches that endpoint, renders a 53-by-7 responsive grid with accessible tooltip and keyboard behavior, and falls back cleanly when the API is unavailable.

**Tech Stack:** Static HTML/CSS, browser JavaScript ES modules, Vercel Node.js Functions, GitHub GraphQL API, Node.js built-in test runner, Python `unittest`, Playwright.

## Global Constraints

- Username is exactly `EthanSMC`.
- Calendar copy is exactly `365 days of making`.
- Place the heatmap after `.repo-cards` and before the `Now` section.
- Use GitHub contribution-counting semantics and anonymous daily private-contribution totals.
- Never expose `GITHUB_TOKEN`, repository identities, commit messages, or GraphQL internals.
- Use five levels numbered `0` through `4`, styled with existing paper, graphite, and ink-blue tokens rather than GitHub green.
- Show all 53 week columns without horizontal page overflow on desktop or mobile.
- Cache successful API responses with `public, s-maxage=3600, stale-while-revalidate=86400`.
- Use no third-party heatmap library and no browser-to-GitHub API request.
- Preserve reduced-motion support and all existing portfolio behavior.

## File Map

- Create `api/github-contributions.js`: GitHub GraphQL query, response validation, level normalization, credential-safe Vercel handler.
- Create `tests/github-contributions.test.cjs`: unit tests for API transformation and handler errors.
- Modify `index.html`: semantic heatmap note after the repository cards.
- Modify `styles.css`: paper-note presentation, five color levels, responsive grid, tooltip, loading/error states, reduced motion.
- Modify `script.js`: fetch, validation, skeleton/rendering, tooltip, roving focus, timeout, and profile navigation.
- Modify `tests/portfolio_e2e.py`: deterministic API fixtures and browser coverage at desktop/mobile sizes.
- Modify `README.md`: local API and Vercel `GITHUB_TOKEN` setup without including a token value.

---

### Task 1: Credential-Safe GitHub Contribution API

**Files:**
- Create: `api/github-contributions.js`
- Create: `tests/github-contributions.test.cjs`

**Interfaces:**
- Consumes: `process.env.GITHUB_TOKEN`, GitHub GraphQL `contributionCalendar` response.
- Produces: `normalizeContributionCalendar(calendar, username, from, to) -> { username, from, to, total, weeks }`.
- Produces: `createHandler({ fetchImpl, token, now }) -> async (request, response)`.
- HTTP output: status `200` with safe calendar JSON, `405` for non-GET methods, or generic `503` JSON on configuration/upstream failure.

- [ ] **Step 1: Write failing API unit tests**

Create `tests/github-contributions.test.cjs` with deterministic normalization and handler tests:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTRIBUTION_LEVELS,
  createHandler,
  normalizeContributionCalendar,
} = require("../api/github-contributions.js");

const calendar = {
  totalContributions: 7,
  weeks: [{
    contributionDays: [
      { date: "2026-07-13", contributionCount: 0, contributionLevel: "NONE" },
      { date: "2026-07-14", contributionCount: 7, contributionLevel: "FOURTH_QUARTILE" },
    ],
  }],
};

const createResponse = () => ({
  statusCode: 200,
  headers: {},
  body: "",
  setHeader(name, value) { this.headers[name] = value; },
  end(value = "") { this.body = value; },
});

test("normalizes GitHub contribution levels without private details", () => {
  assert.deepEqual(CONTRIBUTION_LEVELS, {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
  });
  assert.deepEqual(
    normalizeContributionCalendar(calendar, "EthanSMC", "2025-07-14", "2026-07-14"),
    {
      username: "EthanSMC",
      from: "2025-07-14",
      to: "2026-07-14",
      total: 7,
      weeks: [{ days: [
        { date: "2026-07-13", count: 0, level: 0 },
        { date: "2026-07-14", count: 7, level: 4 },
      ] }],
    },
  );
});

test("returns a generic 503 when the token is missing", async () => {
  const response = createResponse();
  await createHandler({ token: "", fetchImpl: async () => assert.fail("fetch called") })
    ({ method: "GET" }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "Contribution data unavailable" });
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("rejects malformed calendar data", () => {
  assert.throws(
    () => normalizeContributionCalendar(
      { totalContributions: 1, weeks: [{ contributionDays: [{ date: "bad" }] }] },
      "EthanSMC",
      "2025-07-14",
      "2026-07-14",
    ),
    /Invalid contribution calendar/,
  );
});

test("does not leak GitHub GraphQL errors", async () => {
  const response = createResponse();
  await createHandler({
    token: "secret-test-token",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { errors: [{ message: "sensitive upstream detail" }] };
      },
    }),
  })({ method: "GET" }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "Contribution data unavailable" });
  assert.equal(response.body.includes("sensitive upstream detail"), false);
});

test("returns normalized data with edge caching", async () => {
  const response = createResponse();
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer secret-test-token");
    return {
      ok: true,
      async json() {
        return { data: { user: { contributionsCollection: { contributionCalendar: calendar } } } };
      },
    };
  };
  await createHandler({
    token: "secret-test-token",
    fetchImpl,
    now: new Date("2026-07-14T12:00:00Z"),
  })({ method: "GET" }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers["Cache-Control"],
    "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  assert.equal(JSON.parse(response.body).total, 7);
  assert.equal(response.body.includes("secret-test-token"), false);
});
```

- [ ] **Step 2: Run the API tests and verify the expected failure**

Run:

```bash
/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/github-contributions.test.cjs
```

Expected: FAIL with `Cannot find module '../api/github-contributions.js'`.

- [ ] **Step 3: Implement the Vercel function and pure transformer**

Create `api/github-contributions.js` with these concrete behaviors:

```js
const USERNAME = "EthanSMC";
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const CONTRIBUTION_LEVELS = Object.freeze({
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
});

const QUERY = `
  query ContributionCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

const isoDate = (date) => date.toISOString().slice(0, 10);
const rangeFor = (now) => {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { from: isoDate(from), to: isoDate(to) };
};

const normalizeContributionCalendar = (calendar, username, from, to) => {
  if (!calendar || !Number.isInteger(calendar.totalContributions) || !Array.isArray(calendar.weeks)) {
    throw new Error("Invalid contribution calendar");
  }

  return {
    username,
    from,
    to,
    total: calendar.totalContributions,
    weeks: calendar.weeks.map((week) => ({
      days: week.contributionDays.map((day) => {
        const level = CONTRIBUTION_LEVELS[day.contributionLevel];
        if (
          typeof day.date !== "string"
          || !Number.isInteger(day.contributionCount)
          || level === undefined
        ) {
          throw new Error("Invalid contribution calendar");
        }
        return {
          date: day.date,
          count: day.contributionCount,
          level,
        };
      }),
    })),
  };
};

const sendJson = (response, statusCode, body, cacheControl) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.end(JSON.stringify(body));
};

const createHandler = ({
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN,
  now = new Date(),
} = {}) => async (request, response) => {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, "no-store");
    return;
  }
  if (!token) {
    sendJson(response, 503, { error: "Contribution data unavailable" }, "no-store");
    return;
  }

  try {
    const range = rangeFor(now);
    const githubResponse = await fetchImpl(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "EthanSMC-portfolio",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          login: USERNAME,
          from: `${range.from}T00:00:00Z`,
          to: `${range.to}T23:59:59Z`,
        },
      }),
    });
    const payload = await githubResponse.json();
    const calendar = payload?.data?.user?.contributionsCollection?.contributionCalendar;
    if (!githubResponse.ok || payload.errors || !calendar) throw new Error("GitHub request failed");
    sendJson(
      response,
      200,
      normalizeContributionCalendar(calendar, USERNAME, range.from, range.to),
      CACHE_CONTROL,
    );
  } catch {
    sendJson(response, 503, { error: "Contribution data unavailable" }, "no-store");
  }
};

const handler = (request, response) => createHandler()(request, response);
module.exports = handler;
module.exports.CONTRIBUTION_LEVELS = CONTRIBUTION_LEVELS;
module.exports.createHandler = createHandler;
module.exports.normalizeContributionCalendar = normalizeContributionCalendar;
```

- [ ] **Step 4: Run unit tests and inspect the response boundary**

Run:

```bash
/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/github-contributions.test.cjs
```

Expected: 5 tests PASS. Confirm the serialized success body contains only `username`, `from`, `to`, `total`, `weeks`, and each day's `date`, `count`, `level`.

- [ ] **Step 5: Commit the API slice**

```bash
git add api/github-contributions.js tests/github-contributions.test.cjs
git commit -m "feat: add GitHub contribution API"
```

---

### Task 2: Semantic Paper-Note Heatmap Shell

**Files:**
- Modify: `index.html` after `.repo-cards` and before `</section>` for `#repos`.
- Modify: `styles.css` after the repository-card styles and within existing mobile/reduced-motion queries.
- Modify: `tests/portfolio_e2e.py`

**Interfaces:**
- Consumes: Existing `#repos`, `.repo-cards`, paper/line/blue CSS variables.
- Produces: `[data-contributions]`, `[data-contribution-grid]`, `[data-contribution-total]`, `[data-contribution-status]`, and `[data-contribution-tooltip]` DOM hooks used by Task 3.

- [ ] **Step 1: Add a failing placement and accessibility test**

Add this test to `tests/portfolio_e2e.py`:

```python
def test_contribution_note_follows_repository_cards(self):
    page = self.open_page()
    note = page.locator("[data-contributions]")
    self.assertEqual(note.count(), 1)
    self.assertEqual(note.locator("h3").inner_text(), "365 days of making")
    self.assertEqual(
        note.get_attribute("aria-labelledby"),
        "contributions-title",
    )
    self.assertTrue(
        page.evaluate(
            """() => {
              const cards = document.querySelector("#repos .repo-cards");
              const note = document.querySelector("[data-contributions]");
              return cards?.nextElementSibling === note;
            }"""
        )
    )
```

- [ ] **Step 2: Run the placement test and verify it fails**

Run:

```bash
python3 -m unittest tests.portfolio_e2e.PortfolioE2E.test_contribution_note_follows_repository_cards
```

Expected: FAIL because `[data-contributions]` does not exist.

- [ ] **Step 3: Add semantic markup after the repository cards**

Insert this block immediately after `.repo-cards` in `index.html`:

```html
<section
  class="contribution-note"
  data-contributions
  data-state="loading"
  aria-labelledby="contributions-title"
>
  <span class="contribution-tape" aria-hidden="true"></span>
  <div class="contribution-heading">
    <div>
      <p class="contribution-kicker">GitHub · EthanSMC</p>
      <h3 id="contributions-title">365 days of making</h3>
    </div>
    <p class="contribution-total" data-contribution-total aria-live="polite">
      Loading contributions
    </p>
  </div>
  <div class="contribution-calendar-wrap">
    <div
      class="contribution-grid"
      data-contribution-grid
      role="grid"
      aria-label="GitHub contribution calendar"
      aria-busy="true"
    ></div>
    <div class="contribution-tooltip" data-contribution-tooltip role="tooltip" hidden></div>
  </div>
  <div class="contribution-footer">
    <p class="contribution-status" data-contribution-status aria-live="polite"></p>
    <a href="https://github.com/EthanSMC">View GitHub profile <span aria-hidden="true">↗</span></a>
  </div>
</section>
```

- [ ] **Step 4: Style the fixed-format shell and responsive grid**

Add focused CSS using the existing tokens:

```css
.contribution-note {
  position: relative;
  margin-top: 34px;
  padding: 24px;
  border: 2px solid rgba(58, 53, 45, 0.48);
  border-radius: 5px;
  background: rgba(255, 250, 240, 0.88);
  box-shadow: 9px 12px 0 rgba(64, 49, 31, 0.055);
  transform: rotate(-0.3deg);
}

.contribution-tape {
  position: absolute;
  top: -12px;
  left: 50%;
  width: 92px;
  height: 20px;
  background: rgba(231, 185, 54, 0.3);
  transform: translateX(-50%) rotate(-1deg);
}

.contribution-heading,
.contribution-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.contribution-kicker,
.contribution-total,
.contribution-status {
  margin: 0;
  color: var(--muted);
  font-family: var(--hand);
  font-weight: 850;
}

.contribution-heading h3 {
  margin: 4px 0 0;
  color: var(--blue);
  font-family: var(--hand);
  font-size: 1.55rem;
  line-height: 1.2;
}

.contribution-calendar-wrap {
  position: relative;
  margin: 22px 0 16px;
}

.contribution-grid {
  display: grid;
  grid-template-columns: repeat(53, minmax(0, 1fr));
  grid-template-rows: repeat(7, auto);
  grid-auto-flow: column;
  gap: clamp(1px, 0.22vw, 4px);
  width: 100%;
}

.contribution-day,
.contribution-placeholder {
  width: 100%;
  min-width: 0;
  aspect-ratio: 1;
  border: 1px solid rgba(58, 53, 45, 0.11);
  border-radius: 2px;
  background: rgba(89, 84, 76, 0.07);
}

.contribution-day[data-level="1"] { background: #c9d3df; }
.contribution-day[data-level="2"] { background: #8da9ca; }
.contribution-day[data-level="3"] { background: #527fb5; }
.contribution-day[data-level="4"] { background: var(--blue); }

.contribution-tooltip {
  position: absolute;
  z-index: 5;
  max-width: 220px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--paper);
  color: var(--ink);
  font-size: 0.78rem;
  pointer-events: none;
}

@media (max-width: 640px) {
  .contribution-note { padding: 18px 14px; }
  .contribution-heading { align-items: flex-start; flex-direction: column; gap: 7px; }
  .contribution-grid { gap: 1px; }
  .contribution-heading h3 { font-size: 1.3rem; }
}

@media (prefers-reduced-motion: reduce) {
  .contribution-note,
  .contribution-day { transition: none; }
}
```

- [ ] **Step 5: Run placement test and inspect desktop/mobile shell**

Run:

```bash
python3 -m unittest tests.portfolio_e2e.PortfolioE2E.test_contribution_note_follows_repository_cards
```

Expected: PASS. Capture Playwright screenshots at `1440x1000` and `390x844`; confirm the note is after the four cards, text does not overlap, and the page has no horizontal overflow.

- [ ] **Step 6: Commit the visual shell**

```bash
git add index.html styles.css tests/portfolio_e2e.py
git commit -m "feat: add contribution heatmap shell"
```

---

### Task 3: Live Rendering, Tooltip, And Keyboard Navigation

**Files:**
- Modify: `script.js`
- Modify: `tests/portfolio_e2e.py`

**Interfaces:**
- Consumes: `GET /api/github-contributions` response from Task 1 and DOM hooks from Task 2.
- Produces: `initContributionHeatmap(root)`, `data-state="ready|unavailable"`, day buttons with `data-week-index`, `data-weekday`, `data-level`, and ISO-date accessible labels.

- [ ] **Step 1: Add deterministic frontend fixtures and failing browser tests**

At the top of `tests/portfolio_e2e.py`, import `date` and `timedelta`, then add:

```python
from datetime import date, timedelta

NO_CONTRIBUTION_ROUTE = object()


def contribution_fixture():
    first = date(2025, 7, 15)
    last = date(2026, 7, 14)
    weeks = {}
    current = first
    while current <= last:
        weekday = (current.weekday() + 1) % 7
        sunday = current - timedelta(days=weekday)
        count = (current.toordinal() * 7) % 9
        level = 0 if count == 0 else min(4, (count + 1) // 2)
        weeks.setdefault(sunday, []).append({
            "date": current.isoformat(),
            "count": count,
            "level": level,
        })
        current += timedelta(days=1)
    return {
        "username": "EthanSMC",
        "from": first.isoformat(),
        "to": last.isoformat(),
        "total": sum(day["count"] for days in weeks.values() for day in days),
        "weeks": [{"days": days} for _, days in sorted(weeks.items())],
    }
```

Extend `open_page` with `contribution_payload=NO_CONTRIBUTION_ROUTE` and
`contribution_status=200`. Before `page.goto`, install this route when a fixture
was supplied:

```python
if contribution_payload is not NO_CONTRIBUTION_ROUTE:
    page.route(
        "**/api/github-contributions",
        lambda route: route.fulfill(
            status=contribution_status,
            json=contribution_payload,
        ),
    )
```

Add these tests:

```python
def test_contribution_heatmap_renders_live_payload(self):
    payload = contribution_fixture()
    page = self.open_page(contribution_payload=payload)
    note = page.locator("[data-contributions]")
    note.scroll_into_view_if_needed()
    page.wait_for_function(
        "document.querySelector('[data-contributions]')?.dataset.state === 'ready'"
    )
    self.assertEqual(note.locator("[data-contribution-day]").count(), 365)
    self.assertEqual(
        note.locator("[data-contribution-total]").inner_text(),
        f"{payload['total']:,} contributions",
    )
    self.assertEqual(
        note.locator("[data-contribution-grid]").get_attribute("aria-busy"),
        "false",
    )

def test_contribution_heatmap_keyboard_and_tooltip(self):
    page = self.open_page(contribution_payload=contribution_fixture())
    page.wait_for_function(
        "document.querySelector('[data-contributions]')?.dataset.state === 'ready'"
    )
    start = page.locator('[data-contribution-day][data-week-index="1"][data-weekday="2"]')
    start.focus()
    page.keyboard.press("ArrowRight")
    focused = page.locator(":focus")
    self.assertEqual(focused.get_attribute("data-week-index"), "2")
    tooltip = page.locator("[data-contribution-tooltip]")
    self.assertFalse(tooltip.is_hidden())
    self.assertIn("contribution", tooltip.inner_text())

def test_contribution_heatmap_failure_is_usable(self):
    page = self.open_page(
        contribution_payload={"error": "Contribution data unavailable"},
        contribution_status=503,
    )
    page.wait_for_function(
        "document.querySelector('[data-contributions]')?.dataset.state === 'unavailable'"
    )
    note = page.locator("[data-contributions]")
    self.assertIn(
        "temporarily unavailable",
        note.locator("[data-contribution-status]").inner_text(),
    )
    self.assertEqual(
        note.locator('a[href="https://github.com/EthanSMC"]').count(),
        1,
    )
```

- [ ] **Step 2: Run frontend tests and verify they fail**

Run:

```bash
python3 -m unittest \
  tests.portfolio_e2e.PortfolioE2E.test_contribution_heatmap_renders_live_payload \
  tests.portfolio_e2e.PortfolioE2E.test_contribution_heatmap_keyboard_and_tooltip \
  tests.portfolio_e2e.PortfolioE2E.test_contribution_heatmap_failure_is_usable
```

Expected: FAIL because the loading state never becomes `ready` or `unavailable`.

- [ ] **Step 3: Implement response validation, rendering, and failure timeout**

Add `initContributionHeatmap` near the repository/project interaction code in
`script.js`. Use this exact boundary and state flow:

```js
const initContributionHeatmap = (root) => {
  if (!root) return;
  const grid = root.querySelector("[data-contribution-grid]");
  const total = root.querySelector("[data-contribution-total]");
  const status = root.querySelector("[data-contribution-status]");
  const tooltip = root.querySelector("[data-contribution-tooltip]");
  if (!grid || !total || !status || !tooltip) return;

  const renderSkeleton = () => {
    grid.replaceChildren();
    for (let index = 0; index < 371; index += 1) {
      const cell = document.createElement("span");
      cell.className = "contribution-placeholder";
      cell.setAttribute("aria-hidden", "true");
      grid.appendChild(cell);
    }
  };

  const isValidPayload = (payload) => payload
    && payload.username === "EthanSMC"
    && typeof payload.from === "string"
    && typeof payload.to === "string"
    && Number.isInteger(payload.total)
    && Array.isArray(payload.weeks)
    && payload.weeks.every((week) => Array.isArray(week.days));

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  const showTooltip = (day, button) => {
    tooltip.textContent = `${day.date} · ${day.count} ${day.count === 1 ? "contribution" : "contributions"}`;
    tooltip.hidden = false;
    const wrapBounds = grid.parentElement.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    const proposedLeft = buttonBounds.left - wrapBounds.left
      + buttonBounds.width / 2
      - tooltip.offsetWidth / 2;
    const proposedTop = buttonBounds.top - wrapBounds.top - tooltip.offsetHeight - 8;
    tooltip.style.left = `${clamp(proposedLeft, 4, wrapBounds.width - tooltip.offsetWidth - 4)}px`;
    tooltip.style.top = `${Math.max(4, proposedTop)}px`;
  };

  const focusNeighbor = (button, weekDelta, weekdayDelta) => {
    const weekIndex = Number(button.dataset.weekIndex) + weekDelta;
    const weekday = Number(button.dataset.weekday) + weekdayDelta;
    const next = grid.querySelector(
      `[data-contribution-day][data-week-index="${weekIndex}"][data-weekday="${weekday}"]`,
    );
    if (next) {
      button.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  };

  const renderCalendar = (payload) => {
    grid.replaceChildren();
    let firstButton;
    payload.weeks.forEach((week, weekIndex) => {
      const daysByWeekday = new Map(week.days.map((day) => [
        new Date(`${day.date}T00:00:00Z`).getUTCDay(),
        day,
      ]));
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const day = daysByWeekday.get(weekday);
        if (!day) {
          const placeholder = document.createElement("span");
          placeholder.className = "contribution-placeholder";
          placeholder.setAttribute("aria-hidden", "true");
          grid.appendChild(placeholder);
          continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "contribution-day";
        button.dataset.contributionDay = "";
        button.dataset.weekIndex = String(weekIndex);
        button.dataset.weekday = String(weekday);
        button.dataset.level = String(day.level);
        button.tabIndex = firstButton ? -1 : 0;
        button.setAttribute("role", "gridcell");
        button.setAttribute(
          "aria-label",
          `${day.date}: ${day.count} ${day.count === 1 ? "contribution" : "contributions"}`,
        );
        button.addEventListener("pointerenter", () => showTooltip(day, button));
        button.addEventListener("pointerleave", hideTooltip);
        button.addEventListener("focus", () => showTooltip(day, button));
        button.addEventListener("blur", hideTooltip);
        button.addEventListener("click", () => showTooltip(day, button));
        button.addEventListener("keydown", (event) => {
          const moves = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          const move = moves[event.key];
          if (!move) return;
          event.preventDefault();
          focusNeighbor(button, move[0], move[1]);
        });
        firstButton ||= button;
        grid.appendChild(button);
      }
    });
    total.textContent = `${payload.total.toLocaleString("en-US")} contributions`;
    grid.setAttribute("aria-label", `${payload.username} GitHub contributions from ${payload.from} to ${payload.to}: ${payload.total} total`);
    grid.setAttribute("aria-busy", "false");
    root.dataset.state = "ready";
  };

  const renderUnavailable = () => {
    root.dataset.state = "unavailable";
    grid.setAttribute("aria-busy", "false");
    total.textContent = "GitHub activity";
    status.textContent = "Contribution data is temporarily unavailable";
  };

  renderSkeleton();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  fetch("/api/github-contributions", {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error("Contribution request failed");
      return response.json();
    })
    .then((payload) => {
      if (!isValidPayload(payload)) throw new Error("Invalid contribution payload");
      renderCalendar(payload);
    })
    .catch(renderUnavailable)
    .finally(() => window.clearTimeout(timeoutId));
};

initContributionHeatmap(document.querySelector("[data-contributions]"));
```

- [ ] **Step 4: Add click-through behavior without covering day controls**

In the same initializer, obtain the profile anchor and add a root click handler
that ignores day buttons and explicit links:

```js
const profileLink = root.querySelector('a[href="https://github.com/EthanSMC"]');
root.addEventListener("click", (event) => {
  if (!profileLink || event.target.closest("a, [data-contribution-day]")) return;
  window.location.href = profileLink.href;
});
```

Add `.contribution-note { cursor: pointer; }` and reset day buttons to
`cursor: crosshair`. Keep the explicit profile anchor for keyboard and screen
reader users.

- [ ] **Step 5: Run focused frontend tests**

Run the three commands from Step 2.

Expected: all three tests PASS. Also run:

```bash
/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check script.js
```

Expected: no output and exit code `0`.

- [ ] **Step 6: Commit the live frontend behavior**

```bash
git add script.js styles.css tests/portfolio_e2e.py
git commit -m "feat: render live GitHub contribution heatmap"
```

---

### Task 4: Responsive QA, Setup Documentation, And Production Deployment

**Files:**
- Modify: `tests/portfolio_e2e.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: Complete API and frontend component from Tasks 1-3.
- Produces: Repeatable local test commands, secure Vercel setup instructions, and a verified production deployment.

- [ ] **Step 1: Add desktop/mobile layout and reduced-motion regression coverage**

Add this browser test:

```python
def test_contribution_heatmap_is_responsive_and_stable(self):
    payload = contribution_fixture()
    for width, height in ((1440, 1000), (390, 844)):
        with self.subTest(width=width):
            page = self.open_page(
                width=width,
                height=height,
                reduced_motion=True,
                contribution_payload=payload,
            )
            page.wait_for_function(
                "document.querySelector('[data-contributions]')?.dataset.state === 'ready'"
            )
            note = page.locator("[data-contributions]")
            note.scroll_into_view_if_needed()
            state = note.evaluate(
                """element => {
                  const bounds = element.getBoundingClientRect();
                  const grid = element.querySelector('[data-contribution-grid]').getBoundingClientRect();
                  return {
                    noteLeft: bounds.left,
                    noteRight: bounds.right,
                    gridLeft: grid.left,
                    gridRight: grid.right,
                    viewport: window.innerWidth,
                    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
                    transition: getComputedStyle(element).transitionDuration,
                  };
                }"""
            )
            self.assertGreaterEqual(state["gridLeft"], state["noteLeft"])
            self.assertLessEqual(state["gridRight"], state["noteRight"])
            self.assertGreaterEqual(state["noteLeft"], 0)
            self.assertLessEqual(state["noteRight"], state["viewport"])
            self.assertFalse(state["pageOverflow"])
            self.assertIn(state["transition"], ("0s", "0s, 0s"))
```

- [ ] **Step 2: Run the complete local test matrix**

Run:

```bash
/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/github-contributions.test.cjs
python3 -m unittest tests/portfolio_e2e.py
/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check script.js
git diff --check
```

Expected: all Node and Playwright tests PASS, JavaScript syntax exits `0`, and
`git diff --check` prints nothing.

- [ ] **Step 3: Visually inspect real desktop and mobile renders**

Use Playwright to save screenshots under ignored `output/qa-contributions/` for
`1440x1000` and `390x844`. Inspect both images and verify:

- All 53 week columns remain visible.
- Cells are square and do not overlap headings or footer copy.
- The note reads as a separate taped paper artifact, not a nested card.
- Ink-blue levels are distinguishable against the paper background.
- Tooltip remains inside the viewport at the first and last week edges.
- Repository cards remain unchanged.

- [ ] **Step 4: Document secure local and Vercel setup**

Add this section to `README.md`:

```markdown
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
secure Production environment-variable UI or `vercel env add GITHUB_TOKEN production`.
```

- [ ] **Step 5: Commit the QA and setup slice**

```bash
git add README.md tests/portfolio_e2e.py
git commit -m "test: cover contribution heatmap experience"
```

- [ ] **Step 6: Add the production token securely**

Confirm the user has created a read-only token with access to all repositories
whose anonymous counts should appear. Enter it without echoing or logging it:

```bash
PATH="/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npx -y vercel@latest env add GITHUB_TOKEN production --scope ethansmc
```

Expected: Vercel confirms `GITHUB_TOKEN` was added to the Production environment.
Never pass the token as a command-line argument and never print it for validation.

- [ ] **Step 7: Push and deploy production**

```bash
git push origin main
PATH="/Users/ethancc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  npx -y vercel@latest deploy . --prod -y --no-wait --scope ethansmc
```

Expected: push succeeds and Vercel returns a production deployment URL.

- [ ] **Step 8: Verify the live API and page**

After `vercel inspect <deployment-url> --scope ethansmc --wait` reports `Ready`, run:

```bash
curl -fsS https://ethansmc-personal-page.vercel.app/api/github-contributions \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["username"], d["total"], len(d["weeks"]))'

PORTFOLIO_URL=https://ethansmc-personal-page.vercel.app/ \
  python3 -m unittest \
  tests.portfolio_e2e.PortfolioE2E.test_contribution_note_follows_repository_cards
```

Expected: API prints `EthanSMC`, a non-negative contribution total, and `52` or
`53` weeks; the production browser smoke test passes. Inspect the API payload
and deployed HTML for token-like strings before reporting completion. Compare
the returned total and date range with the signed-in GitHub profile calendar;
they must match, including the anonymous private-contribution count.
