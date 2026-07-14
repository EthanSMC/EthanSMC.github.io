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
