#!/usr/bin/env node
// check-skew-protection.mjs — forward-guard for #2423 P1 (Vercel Skew Protection).
//
// Baggrund: en Vite-SPA serverer content-hashede chunks. Under et deploy kan en
// klient på den gamle index.html ramme en edge-node der allerede kører den nye
// deployment, og ende med at forespørge en chunk der er roteret væk — se
// #4595/#4545/#2423. Skew Protection (frontend/vite.config.js,
// `experimental.renderBuiltUrl`) løser det ved at stemple hver bygget asset-URL
// (entry-HTML'ens <script>/<link> OG chunk-preload-koden bag dynamic import())
// med `?dpl=<VERCEL_DEPLOYMENT_ID>`, så Vercels edge pinner requesten til netop
// den deployment klienten kører.
//
// Denne gate måler det BYGGEDE resultat (dist/), ikke konfigurationen — en fejl i
// vite.config.js's renderBuiltUrl-hook (forkert felt-navn, glemt filter) ser
// korrekt ud i review men producerer intet `dpl=` i outputtet.
//
// Kør (fra frontend/, EFTER `npm run build` med env sat):
//   VERCEL_SKEW_PROTECTION_ENABLED=1 VERCEL_DEPLOYMENT_ID=dpl_xxx npm run build
//   node ../scripts/check-skew-protection.mjs
// eller fra repo-roden: node scripts/check-skew-protection.mjs [dist-dir]
//
// exit 0 = entry-HTML + mindst én dynamisk chunk-reference bærer dpl=, exit 1 = ikke.
// Uden VERCEL_DEPLOYMENT_ID i env: exit 0 med en "skipped"-besked (samme som et
// build uden Skew Protection slået til — intet at verificere).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DIST_DIR = path.join("frontend", "dist");
const ENTRY_HTML_CANDIDATES = ["app.html", "index.html"];
const ASSET_TAG_RE = /(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g;

export function findEntryHtmlFiles(distDir) {
  return ENTRY_HTML_CANDIDATES.map((name) => path.join(distDir, name)).filter((file) =>
    existsSync(file)
  );
}

export function extractAssetRefs(html) {
  const refs = [];
  for (const match of html.matchAll(ASSET_TAG_RE)) refs.push(match[1]);
  return refs;
}

function hasDplParam(url, deploymentId) {
  const query = url.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const value = params.get("dpl");
  return deploymentId ? value === deploymentId : Boolean(value);
}

export function checkEntryHtml(distDir, deploymentId) {
  const files = findEntryHtmlFiles(distDir);
  if (files.length === 0) {
    return { ok: false, reason: `ingen entry-HTML fundet (${ENTRY_HTML_CANDIDATES.join(", ")}) under ${distDir}` };
  }

  const results = files.map((file) => {
    const html = readFileSync(file, "utf8");
    const refs = extractAssetRefs(html);
    const withDpl = refs.filter((ref) => hasDplParam(ref, deploymentId));
    return { file, refCount: refs.length, dplCount: withDpl.length };
  });

  const missing = results.filter((r) => r.refCount > 0 && r.dplCount === 0);
  return { ok: missing.length === 0, results, missing };
}

export function checkDynamicChunkReferences(distDir, deploymentId) {
  const assetsDir = path.join(distDir, "assets");
  if (!existsSync(assetsDir)) {
    return { ok: false, reason: `${assetsDir} findes ikke — kør build først` };
  }

  const needle = deploymentId ? `?dpl=${deploymentId}` : "?dpl=";
  const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  const matches = [];

  for (const file of jsFiles) {
    const content = readFileSync(path.join(assetsDir, file), "utf8");
    if (content.includes(needle) && content.includes(".js?dpl=")) matches.push(file);
  }

  return { ok: matches.length > 0, matches, filesScanned: jsFiles.length };
}

export function runSkewProtectionCheck({ distDir = DEFAULT_DIST_DIR, deploymentId } = {}) {
  if (!deploymentId) {
    return {
      ok: true,
      skipped: true,
      message: "VERCEL_DEPLOYMENT_ID ikke sat — intet at verificere (build uden Skew Protection er forventet uændret).",
    };
  }

  const htmlCheck = checkEntryHtml(distDir, deploymentId);
  const chunkCheck = checkDynamicChunkReferences(distDir, deploymentId);

  return {
    ok: htmlCheck.ok && chunkCheck.ok,
    skipped: false,
    htmlCheck,
    chunkCheck,
  };
}

function main() {
  const distDir = process.argv[2] || DEFAULT_DIST_DIR;
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  const result = runSkewProtectionCheck({ distDir, deploymentId });

  if (result.skipped) {
    console.log(`check-skew-protection: SKIPPED — ${result.message}`);
    process.exit(0);
  }

  if (!result.htmlCheck.ok) {
    console.error(`check-skew-protection: FEJL — entry-HTML mangler dpl=${deploymentId}`);
    console.error(JSON.stringify(result.htmlCheck, null, 2));
  } else {
    const total = result.htmlCheck.results.reduce((sum, r) => sum + r.dplCount, 0);
    console.log(
      `check-skew-protection: OK — entry-HTML (${result.htmlCheck.results.map((r) => r.file).join(", ")}) bærer dpl= på ${total} asset-referencer`
    );
  }

  if (!result.chunkCheck.ok) {
    console.error(
      `check-skew-protection: FEJL — ${result.chunkCheck.reason || "ingen dynamisk chunk-reference bærer dpl="}`
    );
  } else {
    console.log(
      `check-skew-protection: OK — ${result.chunkCheck.matches.length} af ${result.chunkCheck.filesScanned} JS-chunks bærer dynamiske dpl=-referencer (fx ${result.chunkCheck.matches[0]})`
    );
  }

  if (!result.ok) {
    console.error("check-skew-protection: samlet FEJL — se ovenstående.");
    process.exit(1);
  }

  console.log("check-skew-protection: samlet OK.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
