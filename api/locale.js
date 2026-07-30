const SUPPORTED_LOCALES = Object.freeze(["zh", "ja", "en"]);
const CHINESE_REGIONS = new Set(["CN", "HK", "MO", "TW"]);

const localeForCountry = (value) => {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (CHINESE_REGIONS.has(country)) return "zh";
  if (country === "JP") return "ja";
  return "en";
};

const readCountry = (headers = {}) => {
  const value = headers["x-vercel-ip-country"]
    || headers["X-Vercel-IP-Country"]
    || headers["cf-ipcountry"]
    || headers["CF-IPCountry"];
  return typeof value === "string" ? value.trim().toUpperCase() : "";
};

const sendJson = (response, statusCode, body) => {
  response.statusCode = statusCode;
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response.end(JSON.stringify(body));
};

const createHandler = () => (request, response) => {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const country = readCountry(request.headers);
  const locale = localeForCountry(country);
  sendJson(response, 200, {
    locale: SUPPORTED_LOCALES.includes(locale) ? locale : "en",
    country: country || null,
  });
};

const handler = (request, response) => createHandler()(request, response);
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.localeForCountry = localeForCountry;
module.exports.readCountry = readCountry;

