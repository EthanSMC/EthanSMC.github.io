const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTRIBUTION_LEVELS,
  createHandler,
  normalizeContributionCalendar,
} = require("../api/github-contributions.js");

const createCalendar = ({ weekCount = 53, totalContributions = 7 } = {}) => ({
  totalContributions,
  weeks: Array.from({ length: weekCount }, (_, weekIndex) => ({
    contributionDays: weekIndex === weekCount - 1
      ? [
        { date: "2026-07-13", contributionCount: 0, contributionLevel: "NONE" },
        { date: "2026-07-14", contributionCount: 7, contributionLevel: "FOURTH_QUARTILE" },
      ]
      : [],
  })),
});

const calendar = createCalendar();

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
  const normalized = normalizeContributionCalendar(
    calendar,
    "EthanSMC",
    "2025-07-15",
    "2026-07-14",
  );
  assert.deepEqual(Object.keys(normalized), ["username", "from", "to", "total", "weeks"]);
  assert.equal(normalized.weeks.length, 53);
  assert.deepEqual(normalized.weeks.at(-1), { days: [
    { date: "2026-07-13", count: 0, level: 0 },
    { date: "2026-07-14", count: 7, level: 4 },
  ] });
});

test("pads a legitimate 52-week calendar with an empty leading display week", () => {
  const calendar52 = createCalendar({ weekCount: 52 });
  calendar52.weeks[0].contributionDays.push({
    date: "2025-07-20",
    contributionCount: 1,
    contributionLevel: "FIRST_QUARTILE",
  });

  const normalized = normalizeContributionCalendar(
    calendar52,
    "EthanSMC",
    "2025-07-15",
    "2026-07-14",
  );

  assert.equal(normalized.weeks.length, 53);
  assert.deepEqual(normalized.weeks[0], { days: [] });
  assert.equal(normalized.weeks[1].days[0].date, "2025-07-20");
  assert.equal(normalized.weeks[52].days.at(-1).date, "2026-07-14");
});

test("rejects calendar lengths other than 52 or 53 weeks", () => {
  for (const weekCount of [0, 51, 54]) {
    assert.throws(
      () => normalizeContributionCalendar(
        createCalendar({ weekCount }),
        "EthanSMC",
        "2025-07-15",
        "2026-07-14",
      ),
      /Invalid contribution calendar/,
    );
  }
});

test("returns a generic 503 when the token is missing", async () => {
  const response = createResponse();
  await createHandler({ token: "", fetchImpl: async () => assert.fail("fetch called") })
    ({ method: "GET" }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "Contribution data unavailable" });
  assert.equal(response.headers["Cache-Control"], "no-store");
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

test("returns a generic no-store 503 for malformed upstream calendars", async (t) => {
  const malformedCalendars = [
    ["negative total", () => createCalendar({ totalContributions: -1 })],
    ["impossible date", () => {
      const value = createCalendar();
      value.weeks[52].contributionDays[0].date = "2026-02-30";
      return value;
    }],
    ["negative contribution count", () => {
      const value = createCalendar();
      value.weeks[52].contributionDays[0].contributionCount = -1;
      return value;
    }],
    ["unrecognized contribution level", () => {
      const value = createCalendar();
      value.weeks[52].contributionDays[0].contributionLevel = "toString";
      return value;
    }],
    ["unsafe day value", () => {
      const value = createCalendar();
      value.weeks[52].contributionDays[0] = null;
      return value;
    }],
    ["non-array day collection", () => {
      const value = createCalendar();
      value.weeks[0].contributionDays = "sensitive upstream detail";
      return value;
    }],
    ["unsafe week value", () => {
      const value = createCalendar();
      value.weeks[0] = null;
      return value;
    }],
    ["non-array week collection", () => ({
      totalContributions: 7,
      weeks: "sensitive upstream detail",
    })],
    ["invalid week count", () => createCalendar({ weekCount: 51 })],
  ];

  for (const [name, createMalformedCalendar] of malformedCalendars) {
    await t.test(name, async () => {
      const response = createResponse();
      await createHandler({
        token: "secret-test-token",
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return {
              data: {
                user: {
                  contributionsCollection: {
                    contributionCalendar: createMalformedCalendar(),
                  },
                },
              },
            };
          },
        }),
      })({ method: "GET" }, response);

      assert.equal(response.statusCode, 503);
      assert.deepEqual(JSON.parse(response.body), { error: "Contribution data unavailable" });
      assert.equal(response.headers["Cache-Control"], "no-store");
      assert.equal(response.body.includes("sensitive upstream detail"), false);
    });
  }
});

test("requests exactly 365 inclusive days and returns normalized data with edge caching", async () => {
  const response = createResponse();
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer secret-test-token");
    assert.deepEqual(JSON.parse(options.body).variables, {
      login: "EthanSMC",
      from: "2025-07-15T00:00:00Z",
      to: "2026-07-14T23:59:59Z",
    });
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
  assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
  const body = JSON.parse(response.body);
  assert.equal(body.from, "2025-07-15");
  assert.equal(body.to, "2026-07-14");
  assert.equal(body.total, 7);
  assert.equal(body.weeks.length, 53);
  assert.equal(response.body.includes("secret-test-token"), false);
});
