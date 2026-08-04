import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WechatApiError, WechatClient, mimeType } = require("../scripts/wechat/client.cjs");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("uses stable_token once and sends the documented add/update draft payloads", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/cgi-bin/stable_token")) return jsonResponse({ access_token: "token", expires_in: 7200 });
    if (String(url).includes("/cgi-bin/draft/add")) return jsonResponse({ media_id: "draft-id" });
    if (String(url).includes("/cgi-bin/draft/update")) return jsonResponse({ errcode: 0, errmsg: "ok" });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const client = new WechatClient({ appId: "app-id", appSecret: "secret", fetchImpl });
  const article = { title: "标题", content: "<p>正文</p>", thumb_media_id: "cover" };

  assert.equal(await client.addDraft(article), "draft-id");
  await client.updateDraft("draft-id", article);

  assert.equal(calls.filter((call) => call.url.endsWith("/cgi-bin/stable_token")).length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    grant_type: "client_credential",
    appid: "app-id",
    secret: "secret",
    force_refresh: false,
  });
  assert.deepEqual(JSON.parse(calls[1].init.body), { articles: [article] });
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    media_id: "draft-id",
    index: 0,
    articles: article,
  });
  assert.match(calls[1].url, /access_token=token/);
});

test("uploads article and permanent cover images as multipart media", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-client-"));
  const filename = path.join(directory, "cover.png");
  fs.writeFileSync(filename, "png fixture");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/cgi-bin/stable_token")) return jsonResponse({ access_token: "token" });
    if (String(url).includes("/cgi-bin/media/uploadimg")) return jsonResponse({ url: "https://mmbiz.qpic.cn/image" });
    if (String(url).includes("/cgi-bin/material/add_material")) return jsonResponse({ media_id: "cover-id" });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const client = new WechatClient({ appId: "app-id", appSecret: "secret", fetchImpl });

  assert.equal(await client.uploadArticleImage(filename), "https://mmbiz.qpic.cn/image");
  assert.equal(await client.uploadPermanentImage(filename), "cover-id");
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(calls[1].init.body.get("media").name, "cover.png");
  assert.match(calls[2].url, /type=image/);
});

test("surfaces WeChat error codes without exposing credentials", async () => {
  const client = new WechatClient({
    appId: "app-id",
    appSecret: "super-secret-value",
    fetchImpl: async () => jsonResponse({ errcode: 40164, errmsg: "invalid ip" }),
  });
  await assert.rejects(
    () => client.getAccessToken(),
    (error) => {
      assert.ok(error instanceof WechatApiError);
      assert.equal(error.code, 40164);
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("accepts only supported image extensions before calling WeChat", () => {
  assert.equal(mimeType("cover.JPG"), "image/jpeg");
  assert.equal(mimeType("cover.png"), "image/png");
  assert.throws(() => mimeType("cover.svg"), /Unsupported WeChat image type/);
});
