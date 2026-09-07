#!/usr/bin/env node
// Forward-guard mod deploy-unikke bytes i hashede assets (#4595).
//
// Problemet den forhindrer: en streng der er unik pr. deploy (commit-sha,
// deployment-id, build-tidspunkt) i en hashet asset ændrer assetens indhold, så
// Rollup giver den et nyt filnavn. Fordi alle route-chunks importerer
// entry-chunken, roterer HELE asset-træet — også når et deploy ikke rørte en
// eneste frontend-fil. Enhver spiller med en åben fane peger derefter på filer der
// ikke længere findes: CYCLINGZONE-56 ("Failed to fetch dynamically imported
// module"), 50 ramte spillere på 7 dage.
//
// To tilstande:
//
//   --verify-only  (default, bruges i CI)
//       Verificerer en dist/ der ALLEREDE er bygget med markør-env'en nedenfor.
//       Koster nul ekstra byggetid. Fejler hvis en markør findes i dist/assets,
//       eller hvis <meta name="cz-release"> mangler/ikke bærer markøren (så
//       guarden ikke kan gå grøn på et build hvor mekanismen var slået fra).
//
//   --full
//       Bygger frontend TO gange med forskellige sha'er og kræver at
//       dist/assets er byte-identisk (samme filnavne, samme indhold). Fanger
//       enhver deploy-unik byte, ikke kun de kendte markører. Koster ~2 builds,
//       derfor kun lokalt/manuelt — se PR #4595 for begrundelsen.
//
// Kør lokalt:
//   node scripts/check-build-determinism.mjs --full
//
// Kør som CI gør det:
//   (byg frontend med markør-env'en, se .github/workflows/ci.yml)
//   node scripts/check-build-determinism.mjs --verify-only

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(repoRoot, "frontend");
const distDir = path.join(frontendDir, "dist");
const assetsDir = path.join(distDir, "assets");

// De env-variabler der kan bære et deploy-unikt id ind i buildet. Værdierne er
// vilkårlige, men skal være umulige at forveksle med rigtigt output og SKAL være
// identiske med dem `.github/workflows/ci.yml` sætter på "Build frontend".
const MARKERS = {
  VERCEL_GIT_COMMIT_SHA: "c2de7e1211111111111111111111111111111111",
  VITE_VERCEL_GIT_COMMIT_SHA: "c2de7e1222222222222222222222222222222222",
  VITE_SENTRY_RELEASE: "c2de7e1233333333333333333333333333333333",
};

// Uden en DSN dead-code-eliminerer Rollup hele Sentry.init-kaldet, og guarden
// ville gå grøn på et build hvor env-objektet aldrig blev inlinet. Prod HAR en
// DSN, så gaten skal måle det build.
const DUMMY_DSN = "https://determinism-guard@o0.ingest.sentry.io/0";
const BUILD_ENV_BASE = {
  VITE_API_URL: process.env.VITE_API_URL || "https://example.invalid",
  VITE_SENTRY_DSN: process.env.VITE_SENTRY_DSN || DUMMY_DSN,
};

const META_RE = /<meta[^>]+name=["']cz-release["'][^>]*>/i;

function fail(message, details = []) {
  console.error(`\n❌ Build-determinisme: ${message}`);
  for (const line of details) console.error(`   ${line}`);
  console.error("");
  process.exit(1);
}

function listAssets() {
  if (!fs.existsSync(assetsDir)) {
    fail(`${path.relative(repoRoot, assetsDir)} findes ikke — blev frontend bygget?`);
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(assetsDir);
  return out.sort();
}

function readMetaContent(htmlPath) {
  if (!fs.existsSync(htmlPath)) return null;
  const html = fs.readFileSync(htmlPath, "utf-8");
  const tag = html.match(META_RE)?.[0];
  if (!tag) return null;
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "";
}

/** Fejler hvis en markør-værdi findes i en hashet asset. */
function assertNoMarkersInAssets() {
  // Kun tekst-assets — binære (fonts, billeder) kan ikke bære en inlinet env-streng.
  const TEXT_EXT = new Set([".js", ".mjs", ".css", ".map", ".json", ".html", ".svg", ".txt"]);
  const files = listAssets().filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf-8");
    for (const [name, value] of Object.entries(MARKERS)) {
      if (text.includes(value)) {
        hits.push(`${path.relative(repoRoot, file)} indeholder ${name}`);
      }
    }
  }
  if (hits.length > 0) {
    fail(
      `${hits.length} deploy-unik(ke) streng(e) i hashede assets — asset-hashene roterer på hvert deploy (#4595).`,
      [
        ...hits,
        "",
        "Fix: læs værdien fra <meta name=\"cz-release\"> via frontend/src/lib/release.js",
        "i stedet for import.meta.env. Bemærk også at DYNAMISK opslag",
        "(import.meta.env[name]) tvinger Vite til at inline hele env-objektet.",
      ]
    );
  }
  console.log(`✓ Ingen deploy-unikke strenge i ${files.length} filer under dist/assets`);
}

/** Fejler hvis release-meta-tagget mangler — så guarden ikke kan gå falsk grøn. */
function assertReleaseMetaPresent() {
  const expected = new Set(Object.values(MARKERS));
  for (const name of ["index.html", "app.html"]) {
    const htmlPath = path.join(distDir, name);
    const content = readMetaContent(htmlPath);
    if (content === null) {
      fail(`dist/${name} mangler <meta name="cz-release"> — release-pluginet i frontend/vite.config.js kørte ikke.`);
    }
    if (!expected.has(content)) {
      fail(
        `dist/${name} har cz-release="${content}", men buildet skulle være lavet med markør-env'en.`,
        [
          "Byg frontend med disse env-variabler før guarden køres:",
          ...Object.entries(MARKERS).map(([k, v]) => `${k}=${v}`),
        ]
      );
    }
  }
  console.log("✓ <meta name=\"cz-release\"> til stede i dist/index.html og dist/app.html");
}

function build(envOverrides) {
  // Én kommando-streng, ingen args-array: `npm` er en .cmd på Windows og kræver
  // shell:true, og shell + args udløser Nodes DEP0190-advarsel.
  const result = spawnSync("npm run build", {
    cwd: frontendDir,
    env: { ...process.env, ...BUILD_ENV_BASE, ...envOverrides },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    fail(`\`npm run build\` fejlede (exit ${result.status}).`);
  }
}

function snapshotAssets() {
  const files = listAssets();
  const snapshot = new Map();
  for (const file of files) {
    const rel = path.relative(assetsDir, file).split(path.sep).join("/");
    snapshot.set(rel, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  }
  return snapshot;
}

function diffSnapshots(a, b) {
  const problems = [];
  for (const name of a.keys()) if (!b.has(name)) problems.push(`kun i build A: ${name}`);
  for (const name of b.keys()) if (!a.has(name)) problems.push(`kun i build B: ${name}`);
  for (const [name, hash] of a) {
    if (b.has(name) && b.get(name) !== hash) problems.push(`forskelligt indhold: ${name}`);
  }
  return problems;
}

function runFull() {
  const shaA = "aaaaaaa1111111111111111111111111111aaaaa";
  const shaB = "bbbbbbb2222222222222222222222222222bbbbb";

  console.log(`▶ Build A (sha ${shaA.slice(0, 7)})`);
  build({ VERCEL_GIT_COMMIT_SHA: shaA, VITE_VERCEL_GIT_COMMIT_SHA: shaA, SENTRY_RELEASE: shaA });
  const snapshotA = snapshotAssets();
  const metaA = readMetaContent(path.join(distDir, "index.html"));

  console.log(`▶ Build B (sha ${shaB.slice(0, 7)})`);
  build({ VERCEL_GIT_COMMIT_SHA: shaB, VITE_VERCEL_GIT_COMMIT_SHA: shaB, SENTRY_RELEASE: shaB });
  const snapshotB = snapshotAssets();
  const metaB = readMetaContent(path.join(distDir, "index.html"));

  const problems = diffSnapshots(snapshotA, snapshotB);
  if (problems.length > 0) {
    fail(
      `dist/assets er IKKE identisk mellem to builds med forskellig commit-sha (${problems.length} afvigelser).`,
      [
        ...problems.slice(0, 25),
        problems.length > 25 ? `... og ${problems.length - 25} mere` : "",
        "",
        "Alt deploy-unikt skal ud af de hashede assets — se frontend/src/lib/release.js.",
      ].filter(Boolean)
    );
  }
  console.log(`✓ ${snapshotA.size} assets byte-identiske på tværs af to builds med forskellig sha`);

  if (metaA === metaB || metaA !== shaA || metaB !== shaB) {
    fail(
      "release-meta-tagget følger ikke commit-sha'en — så testen ovenfor beviser ingenting.",
      [`build A: cz-release="${metaA}" (forventet ${shaA})`, `build B: cz-release="${metaB}" (forventet ${shaB})`]
    );
  }
  console.log("✓ <meta name=\"cz-release\"> følger commit-sha'en (index.html)");

  console.log("\n✅ Build-determinisme OK — et deploy uden frontend-ændringer roterer ikke asset-hashes.");
}

function runVerifyOnly() {
  assertReleaseMetaPresent();
  assertNoMarkersInAssets();
  console.log("\n✅ Build-determinisme (verify-only) OK — ingen deploy-unikke bytes i hashede assets.");
}

const args = process.argv.slice(2);
if (args.includes("--full")) runFull();
else runVerifyOnly();
