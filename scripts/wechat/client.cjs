const fs = require("node:fs/promises");
const path = require("node:path");

const API_ORIGIN = "https://api.weixin.qq.com";

const MIME_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

class WechatApiError extends Error {
  constructor(operation, code, message) {
    super(`WeChat ${operation} failed (${code}): ${message}`);
    this.name = "WechatApiError";
    this.operation = operation;
    this.code = Number(code);
  }
}

function mimeType(filename) {
  const value = MIME_TYPES.get(path.extname(filename).toLowerCase());
  if (!value) throw new Error(`Unsupported WeChat image type: ${filename}`);
  return value;
}

class WechatClient {
  constructor({ appId, appSecret, fetchImpl = globalThis.fetch }) {
    if (!appId || !appSecret) throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required");
    if (typeof fetchImpl !== "function") throw new Error("A Fetch API implementation is required");
    this.appId = appId;
    this.appSecret = appSecret;
    this.fetch = fetchImpl;
    this.accessToken = null;
  }

  async parseResponse(operation, response) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`WeChat ${operation} returned a non-JSON response (${response.status})`);
    }
    if (!response.ok) throw new Error(`WeChat ${operation} returned HTTP ${response.status}`);
    if (payload.errcode && payload.errcode !== 0) {
      throw new WechatApiError(operation, payload.errcode, payload.errmsg || "unknown error");
    }
    return payload;
  }

  async getAccessToken() {
    if (this.accessToken) return this.accessToken;
    const response = await this.fetch(`${API_ORIGIN}/cgi-bin/stable_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: this.appId,
        secret: this.appSecret,
        force_refresh: false,
      }),
    });
    const payload = await this.parseResponse("stable_token", response);
    if (!payload.access_token) throw new Error("WeChat stable_token response did not include access_token");
    this.accessToken = payload.access_token;
    return this.accessToken;
  }

  async jsonRequest(operation, pathname, body) {
    const token = await this.getAccessToken();
    const url = new URL(pathname, API_ORIGIN);
    url.searchParams.set("access_token", token);
    const response = await this.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.parseResponse(operation, response);
  }

  async uploadImage(operation, pathname, filename, extraQuery = {}) {
    const token = await this.getAccessToken();
    const url = new URL(pathname, API_ORIGIN);
    url.searchParams.set("access_token", token);
    for (const [key, value] of Object.entries(extraQuery)) url.searchParams.set(key, value);
    const data = await fs.readFile(filename);
    const form = new FormData();
    form.set("media", new Blob([data], { type: mimeType(filename) }), path.basename(filename));
    const response = await this.fetch(url, { method: "POST", body: form });
    return this.parseResponse(operation, response);
  }

  async uploadArticleImage(filename) {
    const payload = await this.uploadImage("upload article image", "/cgi-bin/media/uploadimg", filename);
    if (!payload.url) throw new Error("WeChat upload article image response did not include url");
    return payload.url;
  }

  async uploadPermanentImage(filename) {
    const payload = await this.uploadImage(
      "upload permanent cover",
      "/cgi-bin/material/add_material",
      filename,
      { type: "image" },
    );
    if (!payload.media_id) throw new Error("WeChat permanent image response did not include media_id");
    return payload.media_id;
  }

  async addDraft(article) {
    const payload = await this.jsonRequest("add draft", "/cgi-bin/draft/add", { articles: [article] });
    if (!payload.media_id) throw new Error("WeChat add draft response did not include media_id");
    return payload.media_id;
  }

  async updateDraft(mediaId, article) {
    await this.jsonRequest("update draft", "/cgi-bin/draft/update", {
      media_id: mediaId,
      index: 0,
      articles: article,
    });
  }
}

module.exports = { API_ORIGIN, WechatApiError, WechatClient, mimeType };
