const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createHandler,
  localeForCountry,
  readCountry,
} = require("../api/locale.js");

const createResponse = () => ({
  statusCode: 200,
  headers: {},
  body: "",
  setHeader(name, value) { this.headers[name] = value; },
  end(value = "") { this.body = value; },
});

test("maps Greater China to Chinese, Japan to Japanese, and other regions to English", () => {
  for (const country of ["CN", "HK", "MO", "TW", "cn"]) {
    assert.equal(localeForCountry(country), "zh");
  }
  assert.equal(localeForCountry("JP"), "ja");
  assert.equal(localeForCountry("US"), "en");
  assert.equal(localeForCountry(""), "en");
});

test("reads Vercel and Cloudflare country headers without exposing an IP address", () => {
  assert.equal(readCountry({ "x-vercel-ip-country": "jp" }), "JP");
  assert.equal(readCountry({ "cf-ipcountry": "cn" }), "CN");
  assert.equal(readCountry({}), "");
});

test("returns a no-store locale response", () => {
  const response = createResponse();
  createHandler()({ method: "GET", headers: { "x-vercel-ip-country": "JP" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { locale: "ja", country: "JP" });
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.equal(response.headers["Access-Control-Allow-Origin"], "*");
});

test("rejects non-GET requests", () => {
  const response = createResponse();
  createHandler()({ method: "POST", headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: "Method not allowed" });
});
