import test from "node:test";
import assert from "node:assert/strict";
import { extractSitemapUrls, buildPayload, keyFileIsLive, main, stripXmlComments } from "./indexnow-submit.mjs";

const SITEMAP = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://cyclingzone.org/</loc></url>
  <!-- <loc>https://cyclingzone.org/kommenteret</loc> -->
  <url><loc>
    https://cyclingzone.org/help
  </loc></url>
  <url><loc>https://cyclingzone.org/help</loc></url>
  <url><loc>https://other.example/page</loc></url>
  <url><loc>http://cyclingzone.org/insecure</loc></url>
  <url><loc>not a url</loc></url>
  <url><loc>https://cyclingzone.org/a?x=1&amp;y=2</loc></url>
</urlset>`;

const KEY = "test-indexnow-key-placeholder";

test("extractSitemapUrls: kun https paa host, dedupet, uden kommentarer", () => {
  assert.deepEqual(extractSitemapUrls(SITEMAP), [
    "https://cyclingzone.org/",
    "https://cyclingzone.org/help",
    "https://cyclingzone.org/a?x=1&y=2",
  ]);
});

test("extractSitemapUrls: tom/ugyldig input giver tom liste", () => {
  assert.deepEqual(extractSitemapUrls(""), []);
  assert.deepEqual(extractSitemapUrls(undefined), []);
});

test("buildPayload: IndexNow-felter", () => {
  assert.deepEqual(buildPayload({ host: "cyclingzone.org", key: KEY, urls: ["https://cyclingzone.org/"] }), {
    host: "cyclingzone.org",
    key: KEY,
    keyLocation: `https://cyclingzone.org/${KEY}.txt`,
    urlList: ["https://cyclingzone.org/"],
  });
});

test("keyFileIsLive: SPA-fallback (200 html) afvises, rigtig body godtages", async () => {
  const html = async () => ({ ok: true, text: async () => "<!doctype html><html></html>" });
  const real = async () => ({ ok: true, text: async () => `${KEY}\n` });
  assert.equal(await keyFileIsLive({ host: "cyclingzone.org", key: KEY, fetchImpl: html }), false);
  assert.equal(await keyFileIsLive({ host: "cyclingzone.org", key: KEY, fetchImpl: real }), true);
});

test("main: uden noegle springes over uden netvaerkskald", async () => {
  const calls = [];
  const result = await main({ env: {}, fetchImpl: async (u) => calls.push(u), log: () => {} });
  assert.equal(result.status, "skipped");
  assert.equal(calls.length, 0);
});

test("main: ugyldig noegle kaster uden at ekkoe vaerdien", async () => {
  await assert.rejects(
    main({ env: { INDEXNOW_KEY: "kort" }, fetchImpl: async () => ({}), log: () => {} }),
    (err) => !err.message.includes("kort") && /formatet/.test(err.message),
  );
});

function fakeFetch({ keyBody = KEY, post = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(`/${KEY}.txt`)) return { ok: true, status: 200, text: async () => keyBody };
    if (url.endsWith("/sitemap.xml")) return { ok: true, status: 200, text: async () => SITEMAP };
    if (url === "https://api.indexnow.org/indexnow") return { ok: post < 300, status: post };
    throw new Error(`uventet url ${url}`);
  };
  return { impl, calls };
}

test("main: indsender URL'erne som JSON POST", async () => {
  const { impl, calls } = fakeFetch();
  const result = await main({ env: { INDEXNOW_KEY: KEY }, fetchImpl: impl, log: () => {} });
  assert.deepEqual(result, { status: "submitted", count: 3 });
  const post = calls.find((c) => c.init?.method === "POST");
  const body = JSON.parse(post.init.body);
  assert.equal(body.key, KEY);
  assert.equal(body.urlList.length, 3);
});

test("main: 202 godtages, 403 kaster", async () => {
  const ok = fakeFetch({ post: 202 });
  assert.equal((await main({ env: { INDEXNOW_KEY: KEY }, fetchImpl: ok.impl, log: () => {} })).status, "submitted");
  const bad = fakeFetch({ post: 403 });
  await assert.rejects(main({ env: { INDEXNOW_KEY: KEY }, fetchImpl: bad.impl, log: () => {} }), /403/);
});

test("main: forkert noeglefil-body stopper foer POST", async () => {
  const { impl, calls } = fakeFetch({ keyBody: "<html>spa</html>" });
  await assert.rejects(main({ env: { INDEXNOW_KEY: KEY }, fetchImpl: impl, log: () => {} }), /noeglefilen/);
  assert.equal(calls.some((c) => c.init?.method === "POST"), false);
});

test("stripXmlComments: lineaer, overlappende og uafsluttede kommentarer (#374)", () => {
  assert.equal(stripXmlComments("a<!-- x -->b"), "a b");
  assert.ok(!stripXmlComments("<!<!-- -->-- x -->").includes("<!--"));
  assert.ok(!stripXmlComments("a<!-- open <loc>https://cyclingzone.org/x</loc>").includes("<loc>"));
  const big = "<!--".repeat(20000) + "-->".repeat(20000);
  const t0 = Date.now(); stripXmlComments(big); assert.ok(Date.now() - t0 < 200);
});
