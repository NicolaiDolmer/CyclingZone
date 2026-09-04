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
//      omskrivning er permanent forbudt — kører altid, også uden Vercel-env,
//      og UANSET om Skew Protection er slået til eller fra i koden).
//
//   FLAG-GATE FØR GATE 2 (#2423, hotfix 4/9): `SKEW_PROTECTION_ENABLED` i
//   frontend/src/lib/skewProtection.js er SSOT for om koden reelt kalder
//   `installSkewProtection()` (main.jsx gør det kun når flaget er `true`).
//   Er flaget `false` — den nuværende, ejer-besluttede tilstand efter
//   prod-hændelsen 4/9 — kaldes funktionen aldrig, så intet deployment-id
//   bliver nogensinde bagt ind i en chunk. Det er PRÆCIS det gate 2 ellers ville
//   opdage som fejl, men her er det tilsigtet, ikke en regression. Gate 2/2b
//   nedenfor SPRINGES DERFOR OVER når flaget er `false` — kun gate 1 forbliver
//   hård og ubetinget. Se
//   `.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md`.
//   Genaktivering af flaget er ejer-only; gate 2/2b vender automatisk tilbage
//   til at måle noget den dag flaget flippes til `true`.
//
//   2. Kun når flaget er `true` OG VERCEL_DEPLOYMENT_ID er sat i env (dvs.
//      buildet KØRTE med Skew Protection slået til): deployment-id'et og
//      cookienavnet `__vdpl` skal faktisk være bagt ind i en JS-chunk. Ellers
//      er `define`-wiringen død og pinnen ville aldrig blive sat — grøn
//      config, ingen effekt.
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
const DEFAULT_SKEW_SOURCE_FILE = path.join(
  "frontend",
  "src",
  "lib",
  "skewProtection.js"
);
// Kun det browseren faktisk eksekverer/henter URL'er fra. Sourcemaps (.map) er
// bevidst UDE: de bærer `sourcesContent` med den originale kode, hvor netop
// denne fejlklasse er dokumenteret i prosa — det ville give en falsk positiv på
// et Vercel-build (hvor sourcemaps genereres til Sentry).
const SCANNED_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css"]);

// `[?&]dpl=` og IKKE bare `dpl=`: cookienavnet `__vdpl=` indeholder tegnene
// "dpl=" og er præcis det vi ØNSKER at finde i bundlen.
export const DPL_QUERY_RE = /[?&]dpl=/;

export const VDPL_COOKIE_NAME = "__vdpl"; // gitleaks:allow — Vercel-cookienavn, ikke en hemmelighed

const SKEW_PROTECTION_ENABLED_RE =
  /export\s+const\s+SKEW_PROTECTION_ENABLED\s*=\s*(true|false)\s*;/;

/**
 * Læser SSOT-flaget `SKEW_PROTECTION_ENABLED` STATISK fra kildefilen (ikke fra
 * det byggede output — flaget skal styre om gate 2/2b overhovedet giver
 * mening, uafhængigt af hvad bundleren tree-shaker væk).
 * @returns {{ok: boolean, enabled?: boolean, reason?: string}}
 */
export function readSkewProtectionEnabledFlag(sourceFile = DEFAULT_SKEW_SOURCE_FILE) {
  if (!existsSync(sourceFile)) {
    return { ok: false, reason: `${sourceFile} findes ikke — kan ikke læse SKEW_PROTECTION_ENABLED.` };
  }
  const source = readFileSync(sourceFile, "utf8");
  const match = source.match(SKEW_PROTECTION_ENABLED_RE);
  if (!match) {
    return {
      ok: false,
      reason:
        `fandt ikke "export const SKEW_PROTECTION_ENABLED = true|false;" i ${sourceFile} — ` +
        "flaget er flyttet, omdøbt eller skrevet om til noget gaten ikke kan parse statisk.",
    };
  }
  return { ok: true, enabled: match[1] === "true" };
}

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

export function run(
  distDir = DEFAULT_DIST_DIR,
  env = process.env,
  { skewSourceFile = DEFAULT_SKEW_SOURCE_FILE } = {}
) {
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

  const flag = readSkewProtectionEnabledFlag(skewSourceFile);
  if (!flag.ok) {
    lines.push(`[FEJL] ${flag.reason}`);
    return { ok: false, lines };
  }
  if (!flag.enabled) {
    lines.push(
      "[skip] Skew Protection er slået fra i koden (#2423): gate 2 springes over, gate 1 kørt: OK"
    );
    return { ok: true, lines };
  }

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
