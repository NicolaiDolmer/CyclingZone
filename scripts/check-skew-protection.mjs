#!/usr/bin/env node
// check-skew-protection.mjs — forward-guard for #2423 (Vercel Skew Protection).
//
// FEJLKLASSEN denne gate findes for (den kostede en prod-nedetid 4/9, PR #4745):
// hvis NOGEN bygget URL bærer `?dpl=<deployment-id>`, loader browseren den samme
// fil under to forskellige URL'er — Vites STATISKE chunk-imports
// (`from "./react-XXXX.js"`) bærer nemlig ingen query-string, mens entry-HTML og
// dynamiske imports gør. React og context-providers instantieres så to gange og
// hele appen dør (`useConsent must be used within ConsentProvider`, React #418).
// Postmortem: `.claude/learnings/2026-09-04-skew-protection-dpl-query-brak-hele-appen.md`.
//
// Den korrekte mekanik er cookien `__vdpl` (frontend/src/lib/skewProtection.js),
// som ikke rører en eneste URL. Gaten måler derfor det BYGGEDE output:
//
//   1. HÅRD: ingen fil i dist/ må indeholde `?dpl=` / `&dpl=` (asset-URL-
//      omskrivning er permanent forbudt — kører altid, også uden Vercel-env).
//   2. Når VERCEL_DEPLOYMENT_ID er sat i env (dvs. buildet KØRTE med Skew
//      Protection slået til): deployment-id'et og cookienavnet `__vdpl` skal
//      faktisk være bagt ind i en JS-chunk. Ellers er `define`-wiringen død og
//      pinnen ville aldrig blive sat — grøn config, ingen effekt.
//   2b. Er VERCEL_ENV sat til noget ANDET end "production", vender gate 2 om og
//      fejler hvis id'et ER bagt ind: preview-deploys må aldrig pinnes, fordi de
//      slettes af retention og en cookie mod et slettet deployment giver hård
//      404 uden selvheling.
//
// Brug (fra repo-roden, EFTER et build):
//   node scripts/check-skew-protection.mjs [dist-dir]
//   VERCEL_SKEW_PROTECTION_ENABLED=1 VERCEL_DEPLOYMENT_ID=dpl_test \
//     npm run build --prefix frontend && node scripts/check-skew-protection.mjs
//
// exit 0 = ok, exit 1 = gaten fejler.
//
// Refs #2423 #4595 #4745.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DIST_DIR = path.join("frontend", "dist");
// Kun det browseren faktisk eksekverer/henter URL'er fra. Sourcemaps (.map) er
// bevidst UDE: de bærer `sourcesContent` med den originale kode, hvor netop
// denne fejlklasse er dokumenteret i prosa — det ville give en falsk positiv på
// et Vercel-build (hvor sourcemaps genereres til Sentry).
const SCANNED_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css"]);

// `[?&]dpl=` og IKKE bare `dpl=`: cookienavnet `__vdpl=` indeholder tegnene
// "dpl=" og er præcis det vi ØNSKER at finde i bundlen.
export const DPL_QUERY_RE = /[?&]dpl=/;

export const VDPL_COOKIE_NAME = "__vdpl"; // gitleaks:allow — Vercel-cookienavn, ikke en hemmelighed

/** Alle scannede filer under `dir`, rekursivt. */
export function listBuiltFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (SCANNED_EXTENSIONS.has(path.extname(entry).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Gate 1 — ingen `?dpl=` nogen steder i outputtet.
 * @returns {{ok: boolean, scanned: number, offenders: Array<{file: string, sample: string}>}}
 */
export function checkNoDplQuery(distDir) {
  const files = listBuiltFiles(distDir);
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const match = source.match(DPL_QUERY_RE);
    if (!match) continue;
    const at = Math.max(0, match.index - 60);
    offenders.push({ file, sample: source.slice(at, match.index + 60).replace(/\s+/g, " ") });
  }
  return { ok: offenders.length === 0, scanned: files.length, offenders };
}

/**
 * Gate 2 — deployment-id + cookienavn er bagt ind i en JS-chunk.
 * Køres kun når buildet blev lavet med Skew Protection slået til.
 * @returns {{ok: boolean, reason?: string, idFile?: string, cookieFile?: string}}
 */
export function checkDeploymentIdBaked(distDir, deploymentId) {
  const files = listBuiltFiles(distDir).filter((f) => /\.(js|mjs)$/i.test(f));
  if (files.length === 0) return { ok: false, reason: `ingen JS-filer under ${distDir}` };

  let idFile = null;
  let cookieFile = null;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!idFile && source.includes(deploymentId)) idFile = file;
    if (!cookieFile && source.includes(VDPL_COOKIE_NAME)) cookieFile = file;
    if (idFile && cookieFile) break;
  }

  if (!idFile) {
    return {
      ok: false,
      reason:
        `deployment-id'et "${deploymentId}" findes ikke i nogen bygget JS-chunk. ` +
        "define-wiringen i frontend/vite.config.js (__CZ_SKEW_DEPLOYMENT_ID__) rammer " +
        "ikke igennem, så __vdpl-cookien ville aldrig blive sat.",
    };
  }
  if (!cookieFile) {
    return {
      ok: false,
      reason:
        `cookienavnet "${VDPL_COOKIE_NAME}" findes ikke i nogen bygget JS-chunk — ` +
        "installSkewProtection() er tree-shaket væk eller kaldes ikke fra src/main.jsx.",
    };
  }
  return { ok: true, idFile, cookieFile };
}

export function run(distDir = DEFAULT_DIST_DIR, env = process.env) {
  const lines = [];
  if (!existsSync(distDir)) {
    return { ok: false, lines: [`[fejl] ${distDir} findes ikke — kør et build først.`] };
  }

  const noQuery = checkNoDplQuery(distDir);
  if (!noQuery.ok) {
    lines.push(`[FEJL] ${noQuery.offenders.length} bygget fil bærer "?dpl=" i en URL.`);
    lines.push(
      "       Asset-URL'er må ALDRIG stemples med deployment-id: Vites statiske chunk-"
    );
    lines.push(
      "       imports bærer ingen query-string, så samme modul loades to gange og appen dør."
    );
    lines.push("       Brug __vdpl-cookien (frontend/src/lib/skewProtection.js) i stedet.");
    for (const o of noQuery.offenders.slice(0, 5)) {
      lines.push(`       - ${o.file}: …${o.sample}…`);
    }
    return { ok: false, lines };
  }
  lines.push(`[ok] ingen "?dpl=" i ${noQuery.scanned} byggede filer under ${distDir}`);

  const deploymentId = env.VERCEL_DEPLOYMENT_ID;
  if (!deploymentId) {
    lines.push(
      "[skip] VERCEL_DEPLOYMENT_ID ikke sat — buildet kørte uden Skew Protection, " +
        "der er intet pin-id at verificere."
    );
    return { ok: true, lines };
  }

  // Preview/development: buildet SKAL have bagt et tomt id ind, selvom Vercel
  // har sat VERCEL_DEPLOYMENT_ID i env'en. Gaten vender derfor om og fejler hvis
  // id'et ER med — en pinnet preview-klient hænger fast på et build der bliver
  // slettet af retention, og får så hård 404 uden selvheling.
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    const leaked = checkDeploymentIdBaked(distDir, deploymentId);
    if (leaked.ok) {
      lines.push(
        `[FEJL] VERCEL_ENV="${vercelEnv}" men deployment-id'et "${deploymentId}" er bagt ind i ` +
          `${path.basename(leaked.idFile)}. Kun production må pinnes ` +
          "(frontend/vite.config.js kræver VERCEL_ENV === \"production\")."
      );
      return { ok: false, lines };
    }
    lines.push(`[ok] VERCEL_ENV="${vercelEnv}": intet deployment-id bagt ind, previewet pinnes ikke`);
    return { ok: true, lines };
  }

  const baked = checkDeploymentIdBaked(distDir, deploymentId);
  if (!baked.ok) {
    lines.push(`[FEJL] ${baked.reason}`);
    return { ok: false, lines };
  }
  lines.push(`[ok] deployment-id bagt ind i ${path.basename(baked.idFile)}`);
  lines.push(`[ok] "${VDPL_COOKIE_NAME}"-cookie-koden er med i ${path.basename(baked.cookieFile)}`);
  return { ok: true, lines };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const distDir = process.argv[2] || DEFAULT_DIST_DIR;
  const result = run(distDir);
  for (const line of result.lines) console.log(line);
  process.exit(result.ok ? 0 : 1);
}
