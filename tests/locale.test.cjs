const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
};

const loadBrowserI18n = async ({
  query = "",
  savedLocale,
  cachedIpLocale,
  browserLanguages = [],
  browserLanguage = browserLanguages[0] || "",
  ipLocale = "en",
  rejectIpLookup = false,
} = {}) => {
  const localStorage = createStorage(savedLocale ? { "ethansmc.locale": savedLocale } : {});
  const sessionStorage = createStorage(cachedIpLocale ? { "ethansmc.ip-locale": cachedIpLocale } : {});
  const location = {
    href: `https://example.com/${query}`,
    hostname: "example.com",
    protocol: "https:",
    search: query,
  };
  const document = {
    body: { dataset: {} },
    documentElement: { dataset: {}, lang: "zh-CN" },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const fetchCalls = [];
  const fetch = async (...args) => {
    fetchCalls.push(args);
    if (rejectIpLookup) throw new Error("offline");
    return { ok: true, json: async () => ({ locale: ipLocale }) };
  };
  class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }
  const window = {
    dispatchEvent() {},
    history: { replaceState() {}, state: null },
    localStorage,
    location,
    sessionStorage,
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "i18n.js"), "utf8");
  vm.runInNewContext(source, {
    CustomEvent,
    URL,
    URLSearchParams,
    document,
    fetch,
    location,
    navigator: { language: browserLanguage, languages: browserLanguages },
    window,
  }, { filename: "i18n.js" });

  await new Promise((resolve) => setImmediate(resolve));
  return { fetchCalls, localStorage, sessionStorage, siteI18n: window.siteI18n };
};

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

test("explicit query and saved choices override browser and IP languages", async () => {
  const queryChoice = await loadBrowserI18n({
    query: "?lang=zh",
    savedLocale: "en",
    browserLanguages: ["ja-JP"],
    ipLocale: "ja",
  });
  assert.equal(queryChoice.siteI18n.getLocale(), "zh");
  assert.equal(queryChoice.localStorage.getItem("ethansmc.locale"), "zh");
  assert.equal(queryChoice.fetchCalls.length, 0);

  const savedChoice = await loadBrowserI18n({
    savedLocale: "en",
    browserLanguages: ["ja-JP"],
    ipLocale: "zh",
  });
  assert.equal(savedChoice.siteI18n.getLocale(), "en");
  assert.equal(savedChoice.fetchCalls.length, 0);
});

test("the first supported browser language wins without an IP request", async () => {
  const result = await loadBrowserI18n({
    browserLanguages: ["fr-FR", "ja-JP", "en-US"],
    ipLocale: "zh",
  });
  assert.equal(result.siteI18n.getLocale(), "ja");
  assert.equal(result.fetchCalls.length, 0);

  const languageFallback = await loadBrowserI18n({
    browserLanguage: "en-US",
    ipLocale: "ja",
  });
  assert.equal(languageFallback.siteI18n.getLocale(), "en");
  assert.equal(languageFallback.fetchCalls.length, 0);
});

test("IP inference is used only when the browser has no supported language", async () => {
  const result = await loadBrowserI18n({
    browserLanguages: ["fr-FR", "de-DE"],
    ipLocale: "ja",
  });
  assert.equal(result.siteI18n.getLocale(), "ja");
  assert.equal(result.fetchCalls.length, 1);
  assert.equal(result.sessionStorage.getItem("ethansmc.ip-locale"), "ja");
});

test("a cached IP inference avoids another request when browser language is unsupported", async () => {
  const result = await loadBrowserI18n({
    browserLanguages: ["fr-FR"],
    cachedIpLocale: "zh",
    ipLocale: "ja",
  });
  assert.equal(result.siteI18n.getLocale(), "zh");
  assert.equal(result.fetchCalls.length, 0);
});

test("English is the final fallback when browser and IP inference are unavailable", async () => {
  const result = await loadBrowserI18n({
    browserLanguages: ["fr-FR"],
    rejectIpLookup: true,
  });
  assert.equal(result.siteI18n.getLocale(), "en");
  assert.equal(result.fetchCalls.length, 1);
});

test("localizes the writing showcase categories and view-all link", async () => {
  const english = await loadBrowserI18n({ query: "?lang=en" });
  assert.equal(english.siteI18n.t("writing.albums"), "Albums");
  assert.equal(english.siteI18n.t("writing.independent"), "Independent writing");
  assert.equal(english.siteI18n.t("writing.smallTalks"), "Small Talks");
  assert.equal(english.siteI18n.t("writing.viewAll"), "View all writing");

  const chinese = await loadBrowserI18n({ query: "?lang=zh" });
  assert.equal(chinese.siteI18n.t("writing.albums"), "专辑");
  assert.equal(chinese.siteI18n.t("writing.independent"), "独立文章");
  assert.equal(chinese.siteI18n.t("writing.smallTalks"), "碎碎念");
  assert.equal(chinese.siteI18n.t("writing.viewAll"), "查看全部写作");
});
