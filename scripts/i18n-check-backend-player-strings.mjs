#!/usr/bin/env node
// Forward-guard: ingen hardkodet dansk prosa i backendens spillervendte
// tekstkilder — Refs #4734.
//
// Soesterskript til i18n-check-lib-strings.mjs, som daekker frontend/src.
// Backend har den samme fejlklasse, men en anden fejl-signatur: en spiller ser
// aldrig backend-koden, saa en dansk streng her opdages foerst naar en manager
// med users.language = "en" faar dansk i sin indbakke eller Discord-DM.
//
// Afdaekningen paa #4734 fandt tre kilder der skrev FAERDIG tekst til spillere:
//   • notificationService.js — in-app-notifikationers title/message
//   • auctionFinalization.js — 20 auktions-notifikationer, hardkodet DANSK
//   • discordNotifier.js     — DM-tekst, hardkodet EN for alle
//   • boardClubDna.js        — klub-DNA'ets label/short/long, hardkodet DANSK
//
// Guarden er bevidst SMAL (en eksplicit fil-liste, ikke hele backend/lib):
// backend indeholder legitimt dansk i ops-/admin-/log-tekst, og en bred scanning
// ville drukne signalet i stoej. Tilfoej en fil her naar den begynder at sende
// tekst til spillere.
//
// Heuristik som i frontend-guarden: danske tegn (ae/oe/aa) i ikke-kommentar-kode.
// Fixet er ALDRIG at oversaette strengen i koden, men at give den en noegle i
// frontend/public/locales/{en,da}/ og sende noegle + parametre i stedet.
//
// Brug:
//   node scripts/i18n-check-backend-player-strings.mjs

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Spillervendte backend-kilder. Nye kaldsteder der producerer spillertekst
// hoerer til her.
export const SCANNED_FILES = [
  "backend/lib/notificationService.js",
  "backend/lib/auctionFinalization.js",
  "backend/lib/discordNotifier.js",
  "backend/lib/discordDmCopy.js",
  "backend/lib/boardClubDna.js",
];

const DANISH = /[æøåÆØÅ]/;

/**
 * Blank kommentarer UD i stedet for at fjerne dem: linjeskift bevares, saa de
 * linjenumre guarden rapporterer stadig peger paa den rigtige linje i filen.
 * (i18n-check-lib-strings.mjs sletter dem og rapporterer derfor forskudte
 * linjenumre — bevidst ikke rettet her, det er en anden fils kontrakt.)
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead) => lead);
}

/**
 * Blank hele console.*(...)-kald ud (ogsaa flerlinjede). Ops-logning gaar til
 * Railway-loggen, ikke til en manager, saa dansk dér er lovligt — og udbredt.
 * Linjeskift bevares, saa linjenumre stadig passer.
 */
export function stripOpsLogging(src) {
  const CALL = /\bconsole\.(?:log|info|warn|error|debug)\s*\(/g;
  let out = src;
  let m;
  while ((m = CALL.exec(out)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < out.length; i += 1) {
      if (out[i] === "(") depth += 1;
      else if (out[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const end = i < out.length ? i + 1 : out.length;
    const span = out.slice(m.index, end).replace(/[^\n]/g, " ");
    out = out.slice(0, m.index) + span + out.slice(end);
    CALL.lastIndex = m.index + span.length;
  }
  return out;
}

/**
 * Kendte, dokumenterede undtagelser pr. fil. En linje der matcher et af
 * moenstrene fejler ikke — resten af filen bevogtes stadig, saa en NY dansk
 * streng bliver fanget. Fjern et moenster naar kilden er konverteret.
 */
export const ALLOWED = new Map([
  ["backend/lib/auctionFinalization.js", [
    // finance-hovedbogens `description` er legacy-fallback: raekken baerer
    // ALLEREDE metadata.code + params, og frontend rendrer koden
    // (frontend/src/lib/legacyFinanceMessage.js parser den gamle danske prosa
    // for rakker skrevet foer kontrakten). Egen kilde, egen konvertering.
    { pattern: /^\s*description: /, why: "finance-ledger legacy-fallback, daekket af metadata.code" },
  ]],
  ["backend/lib/discordNotifier.js", [
    // sendTestDM kaster danske fejl der vises ordret i ProfilePage. Reel leak,
    // men den hoerer til en errorCode-kontrakt paa API-svaret, ikke i #4734.
    { pattern: /throw new Error\(/, why: "sendTestDM-fejl vist i ProfilePage — kraever errorCode-kontrakt, ikke konverteret i #4734" },
  ]],
]);

export function findDanishLines(src, rel = "") {
  const allowed = ALLOWED.get(rel) || [];
  const cleaned = stripOpsLogging(stripComments(src));
  const hits = [];
  cleaned.split("\n").forEach((line, i) => {
    if (!DANISH.test(line)) return;
    if (allowed.some((a) => a.pattern.test(line))) return;
    hits.push(i + 1);
  });
  return hits;
}

export function scan({ root = ROOT, files = SCANNED_FILES } = {}) {
  const leaks = [];
  const missing = [];
  for (const rel of files) {
    const abs = join(root, rel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    const hits = findDanishLines(readFileSync(abs, "utf8"), rel);
    if (hits.length) leaks.push({ file: rel, lines: hits });
  }
  return { leaks, missing };
}

function main() {
  const { leaks, missing } = scan();

  if (missing.length) {
    console.error(`❌ Guarden peger paa filer der ikke findes: ${missing.join(", ")}`);
    console.error("   Ret SCANNED_FILES i scripts/i18n-check-backend-player-strings.mjs.");
    process.exit(1);
  }

  if (leaks.length) {
    console.error(`\n❌ ${leaks.length} backend-fil(er) har dansk tekst i ikke-kommentar-kode:`);
    for (const { file, lines } of leaks) {
      const shown = lines.slice(0, 8).join(",");
      console.error(`   - ${file}:${shown}${lines.length > 8 ? ` (+${lines.length - 8} flere)` : ""}`);
    }
    console.error("\nFix: giv strengen en noegle i frontend/public/locales/{en,da}/ og send noegle +");
    console.error("parametre (metadata.titleCode/messageCode for notifikationer, { code, params } for");
    console.error("Discord-DM). Kontrakten staar i docs/i18n/README.md, afsnittet");
    console.error("\"Backend-tekst til spillere\".");
    process.exit(1);
  }

  console.log(`✅ backend player-strings guard: ingen dansk prosa i ${SCANNED_FILES.length} spillervendte backend-filer.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
