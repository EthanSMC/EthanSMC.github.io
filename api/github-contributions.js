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
