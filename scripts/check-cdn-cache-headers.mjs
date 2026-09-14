#!/usr/bin/env node
// check-cdn-cache-headers.mjs — forward-guard: hold Vercels CDN-cache-headers på plads.
//
// Baggrund (2026-08-07, Vercel-alarm "Edge Requests spike", refs #2423):
// Vercels DEFAULT for statiske filer er `Cache-Control: public, max-age=0, must-revalidate`.
// Det betyder at browseren revaliderer HVER fil ved HVERT sideload — og hver revalidering
// tæller som en billable Edge Request, også når svaret er 304. Med ~27 asset-referencer i
// app.html kostede ét gensyn ~27 edge requests i stedet for ~3.
//
// Fejlklassen er lumsk fordi den er 100 % USYNLIG i produktet: siden er hurtig, alt virker,
// intet fejler. Den viser sig kun på Vercels forbrugstal. Derfor denne gate: den måler de
// LEVENDE headers efter deploy, ikke konfigurationen — en regel i vercel.json der ikke
// matcher (forkert glob, ændret output-mappe) ser korrekt ud i review men virker ikke.
//
// #5251/#5239 — anonym '/' viser nu marketing-sitet, ikke SPA'en:
// frontend/middleware.ts (#4067) proxy'er anonyme besøg på '/' videre til
// cycling-zone-marketing.vercel.app, når klienten ikke sender markør-cookien
// `cz_session=1` (sat af frontend/src/lib/sessionCookie.ts ved login). Marketing-HTML'en
// har ingen '/assets/*.js|css'-referencer, så et anonymt GET '/' kan ikke længere bruges
// til at finde et hashet build-asset at teste immutable-cache på. Derfor sender vi
// `cookie: cz_session=1` med når vi henter HTML'en for at finde et asset — det får
// middleware.ts til at lade requesten passere igennem til appens egen index.html/app.html,
// præcis som en logget-ind spiller. SPA-entry-tjekket på '/' forbliver et ÆGTE anonymt
// kald (uden cookie), fordi det skal måle det marketing-svaret (eller SPA-fallbacket)
// som en rigtig anonym besøgende rent faktisk får.
//
// Kør: node scripts/check-cdn-cache-headers.mjs [origin]
//   origin default https://cyclingzone.org
// exit 0 = alle regler holder, exit 1 = mindst én regression.

import { pathToFileURL } from "node:url";
import { appShellHeaders, fetchAppShell } from "./lib/fetchAppShell.mjs";

const ORIGIN = (process.argv[2] || "https://cyclingzone.org").replace(/\/$/, "");

// Krav pr. sti-klasse. minMaxAge i sekunder; requireImmutable for content-hashede filer.
const RULES = [
  { label: "hashed build-assets", pick: pickHashedAsset, minMaxAge: 31536000, requireImmutable: true },
  { label: "fonts", pick: () => "/fonts/dm-sans-latin-wght-normal.woff2", minMaxAge: 86400, requireImmutable: false },
  { label: "brand-assets", pick: () => "/brand/wordmark-ondark.svg", minMaxAge: 86400, requireImmutable: false },
  { label: "favicon", pick: () => "/favicon.svg", minMaxAge: 86400, requireImmutable: false },
];

// SPA-entry SKAL forblive kortlivet — ellers ser brugere en gammel index efter deploy.
// Gælder BEGGE svar-varianter på '/' (marketing-proxy for anonyme, SPA-fallback for
// loggede-ind), jf. #5251 — se check nederst.
const ENTRY_MAX_MAX_AGE = 60;

export function parseMaxAge(cc) {
  const m = /max-age=(\d+)/.exec(cc || "");
  return m ? Number(m[1]) : null;
}

// Udtrækker en hashet '/assets/*.js|css'-reference fra en serveret HTML-streng.
// Ren funktion (ingen netværk) så den kan unit-testes uafhængigt af prod.
export function extractHashedAssetPath(html) {
  const m = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/.exec(html);
  if (!m) throw new Error("fandt ingen /assets/*.js|css i den serverede HTML — er build-output flyttet?");
  return m[1];
}

async function head(path, extraHeaders = {}) {
  const res = await fetch(`${ORIGIN}${path}`, { method: "GET", redirect: "follow", headers: extraHeaders });
  return {
    status: res.status,
    cc: res.headers.get("cache-control") || "",
    ct: res.headers.get("content-type") || "",
  };
}

// Find en rigtig hashet asset-URL i den serverede HTML i stedet for at hardcode et filnavn
// (hashen skifter ved hvert build). Hentes MED cz_session-cookien (#5251) så vi altid får
// appens egen SPA-HTML, uanset om '/' for anonyme lige nu proxy'er marketing-sitet ind.
let cachedHtml = null;
async function getHtml() {
  if (cachedHtml === null) {
    cachedHtml = await (await fetchAppShell(`${ORIGIN}/`)).text();
  }
  return cachedHtml;
}
async function pickHashedAsset() {
  return extractHashedAssetPath(await getHtml());
}

async function main() {
  const failures = [];
  const lines = [];

  for (const rule of RULES) {
    let path;
    try {
      path = typeof rule.pick === "function" ? await rule.pick() : rule.pick;
    } catch (e) {
      failures.push(`${rule.label}: ${e.message}`);
      continue;
    }
    const { status, cc, ct } = await head(path, appShellHeaders());
    if (status !== 200) {
      failures.push(`${rule.label}: ${path} svarede ${status}`);
      continue;
    }
    // SPA-rewriten `/(.*)` → /app.html gør at ENHVER ukendt sti svarer 200 med HTML.
    // Uden dette tjek ville et forkert filnavn i RULES fejle med en forvirrende
    // cache-besked i stedet for "filen findes ikke".
    if (/text\/html/.test(ct)) {
      failures.push(`${rule.label}: ${path} returnerede HTML (SPA-fallback) — filen findes ikke, ret stien i RULES`);
      continue;
    }
    const maxAge = parseMaxAge(cc);
    const problems = [];
    if (maxAge === null || maxAge < rule.minMaxAge) {
      problems.push(`max-age=${maxAge ?? "mangler"} < krævet ${rule.minMaxAge}`);
    }
    if (rule.requireImmutable && !/immutable/.test(cc)) {
      problems.push("mangler `immutable`");
    }
    if (problems.length) {
      failures.push(`${rule.label} (${path}): ${problems.join("; ")} — fik "${cc}"`);
      lines.push(`  ✗ ${rule.label.padEnd(20)} ${cc}`);
    } else {
      lines.push(`  ✓ ${rule.label.padEnd(20)} ${cc}`);
    }
  }

  // Omvendt krav: SPA-entry må IKKE cache længe. Sendes MED cz_session-cookien (#5251)
  // så vi rent faktisk måler appens egen index.html/app.html og ikke — siden #4067/#5239 —
  // marketing-originens svar, som middleware.ts nu proxy'er ind for anonyme på '/'.
  {
    const { status, cc } = await head("/", appShellHeaders());
    const maxAge = parseMaxAge(cc);
    if (status === 200 && maxAge !== null && maxAge > ENTRY_MAX_MAX_AGE) {
      failures.push(`SPA-entry (/): max-age=${maxAge} > ${ENTRY_MAX_MAX_AGE} — nye deploys når ikke ud til brugerne`);
      lines.push(`  ✗ ${"SPA-entry".padEnd(20)} ${cc}`);
    } else {
      lines.push(`  ✓ ${"SPA-entry".padEnd(20)} ${cc}`);
    }
  }

  // Ekstra dækning (#5251): den ANDEN svar-variant på '/' — ægte anonymt kald (ingen
  // cookie), som siden #4067/#5239 proxy'er marketing-sitets forside ind — skal LIGELEDES
  // forblive kortlivet, ellers når nye marketing-deploys ikke ud til anonyme besøgende.
  // To varianter af samme sti kan i praksis have forskellige cache-headers (marketing-
  // originen sætter sine egne, uafhængigt af frontend/vercel.json), så begge tjekkes.
  {
    const { status, cc } = await head("/");
    const maxAge = parseMaxAge(cc);
    if (status === 200 && maxAge !== null && maxAge > ENTRY_MAX_MAX_AGE) {
      failures.push(`marketing-entry (anonym /): max-age=${maxAge} > ${ENTRY_MAX_MAX_AGE} — nye deploys når ikke ud til brugerne`);
      lines.push(`  ✗ ${"marketing-entry".padEnd(20)} ${cc}`);
    } else {
      lines.push(`  ✓ ${"marketing-entry".padEnd(20)} ${cc}`);
    }
  }

  console.log(`CDN-cache-headers @ ${ORIGIN}`);
  lines.forEach((l) => console.log(l));

  if (failures.length) {
    console.error("\n✗ CDN-cache-regression — hver manglende cache-header koster edge requests på HVERT sideload:");
    failures.forEach((f) => console.error(`  - ${f}`));
    console.error("\nRet reglerne i frontend/vercel.json (headers[]). Se #2423 + .claude/learnings/2026-08-07-vercel-edge-requests-spike.md");
    process.exit(1);
  }

  console.log("\n✓ Alle cache-regler holder.");
}

// Kør kun main() ved direkte invokation (`node scripts/check-cdn-cache-headers.mjs`) —
// ikke når scriptet importeres af en testfil (#5251, gør extractHashedAssetPath testbar
// uden netværkskald).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
