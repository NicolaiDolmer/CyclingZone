#!/usr/bin/env node
// #6558: indsender de offentlige sitemap-URL'er til IndexNow efter et verificeret
// deploy. Noeglefilen (`https://<host>/<key>.txt`) hostes allerede via #5493;
// intet har til nu indsendt URL'er, saa Bing meldte IndexNow som "ikke sat op".
//
// Koeres fra .github/workflows/deploy-verify.yml EFTER smoke-testen. Noeglen
// kommer fra env INDEXNOW_KEY (GitHub Actions secret) og printes ALDRIG.
// Ubesat -> no-op med exit 0 (samme moenster som generate-indexnow-key.ts).
//
// Sikkerhedsnet: SPA-fallbacken svarer 200 text/html paa ENHVER ukendt sti, saa
// "noeglefilen svarer 200" er et tomt bevis. Scriptet kraever derfor at
// filens BODY er noeglen, foer der indsendes noget.
//
// Ingen loebende udgift: api.indexnow.org er gratis og noeglefri at kalde.

import { pathToFileURL } from "node:url";

const DEFAULT_HOST ="cyclingzone.org";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;
// IndexNow tillader maks 10.000 URL'er pr. kald; sitemap'en er langt under.
const MAX_URLS = 10000;

// Udtraekker <loc>-vaerdier fra en sitemap. Kommentarer fjernes foerst, saa en
// kommenteret URL aldrig indsendes. Kun URL'er paa `host` (IndexNow kraever at
// urlList hoerer til samme host som noeglefilen); alt andet droppes.
export function extractSitemapUrls(xml, host = DEFAULT_HOST) {
  // Gentag til teksten er stabil, saa indlejrede/overlappende kommentarer
  // (fx "<!<!-- -->-- x -->") ikke efterlader en ny "<!--" (CodeQL #374).
  let withoutComments = String(xml || "");
  for (let prev = null; prev !== withoutComments; ) {
    prev = withoutComments;
    withoutComments = withoutComments.replace(/<!--[\s\S]*?-->/g, "");
  }
  const seen = new Set();
  const urls = [];
  for (const match of withoutComments.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const raw = decodeXmlEntities(match[1]);
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== host) continue;
    const href = parsed.href;
    if (seen.has(href)) continue;
    seen.add(href);
    urls.push(href);
  }
  return urls.slice(0, MAX_URLS);
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function buildPayload({ host, key, urls }) {
  return {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: urls,
  };
}

// Noeglefilen er gyldig kun hvis body === noeglen (trimmet).
export async function keyFileIsLive({ host, key, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://${host}/${key}.txt`, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return false;
  const body = (await res.text()).trim();
  return body === key;
}

// Returnerer { status: "skipped" | "submitted", count?, reason? }; kaster ved fejl.
export async function main({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const key = (env.INDEXNOW_KEY || "").trim();
  const host = (env.INDEXNOW_HOST || DEFAULT_HOST).trim();
  if (!key) {
    log("indexnow-submit: INDEXNOW_KEY er ikke sat - springer over (#6558).");
    return { status: "skipped", reason: "no-key" };
  }
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`indexnow-submit: INDEXNOW_KEY matcher ikke formatet ([a-zA-Z0-9-]{8,128}), laengde ${key.length}.`);
  }

  if (!(await keyFileIsLive({ host, key, fetchImpl }))) {
    throw new Error(`indexnow-submit: noeglefilen paa https://${host}/<key>.txt svarer ikke med noeglen - indsender ikke.`);
  }

  const sitemapRes = await fetchImpl(`https://${host}/sitemap.xml`, { signal: AbortSignal.timeout(30_000) });
  if (!sitemapRes.ok) {
    throw new Error(`indexnow-submit: sitemap.xml svarede ${sitemapRes.status}.`);
  }
  const urls = extractSitemapUrls(await sitemapRes.text(), host);
  if (urls.length === 0) {
    throw new Error("indexnow-submit: ingen URL'er fundet i sitemap.xml.");
  }

  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(buildPayload({ host, key, urls })),
    signal: AbortSignal.timeout(30_000),
  });
  // 200 = modtaget, 202 = modtaget, noeglevalidering afventer.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`indexnow-submit: IndexNow svarede ${res.status}.`);
  }
  log(`indexnow-submit: indsendte ${urls.length} URL'er (HTTP ${res.status}).`);
  return { status: "submitted", count: urls.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
