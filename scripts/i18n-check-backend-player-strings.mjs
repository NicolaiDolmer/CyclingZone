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
// DEL 2 (Refs #6801) — notifikationer uden noegle, BASELINE-RATCHET:
// Del 1 ovenfor ser kun danske TEGN i en snaever fil-liste. Den ser hverken
// dansk uden ae/oe/aa ("Auktion annulleret"), engelsk hardkodet til alle, eller
// filer uden for listen. Del 2 scanner HELE backend/lib, backend/routes og
// backend/cron.js efter kald til en notifikations-afsender (notifyUser,
// notifyTeamOwner, notify ...) hvis argumenter indeholder en hardkodet
// naturlig-sprogs-streng UDEN titleCode/messageCode. Det er praecis fejlklassen
// "spilleren ser samme tekst uanset users.language".
//
// Kendte kald ligger i scripts/i18n-check-backend-player-strings-baseline.json
// (pr. fil). Guarden fejler KUN paa NYE: flere kald i en fil end baselinen, eller
// en fil der ikke staar i den. Konverterede kald fejler aldrig; de rapporteres
// som "stale baseline" med opfordring til at stramme den:
//   node scripts/i18n-check-backend-player-strings.mjs --update-baseline
// Baselinen er en ratchet: den maa kun skrumpe.
//
// Brug:
//   node scripts/i18n-check-backend-player-strings.mjs
//   node scripts/i18n-check-backend-player-strings.mjs --update-baseline

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
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

// ── Del 2: notifikations-kald uden noegle (baseline-ratchet) — Refs #6801 ─────

export const BASELINE_PATH = join(ROOT, "scripts", "i18n-check-backend-player-strings-baseline.json");

// Funktioner der skriver en in-app-notifikation til en spiller. Tilfoej et navn
// her naar en ny afsender-wrapper opstaar; ellers er den usynlig for guarden.
export const NOTIFY_CALLEES = [
  "notify",
  "notifyUser",
  "notifyTeamOwner",
  "notifyTeamOwnerFn",
  "notifyTeamOwnerShared",
  "notifyUserShared",
  "notifyUserFn",
  "notifyManager",
  "notifyManagerSafe",
  "notifyOwner",
  "notifyInApp",
  "auctionNotify",
  "trackedNotify",
  "notifyFn",
  "persistAndNotify",
];

const CALL_RE = new RegExp(`(?<![.\\w])(?:${NOTIFY_CALLEES.join("|")})\\s*\\(`, "g");
const KEYED = /\b(?:titleCode|messageCode)\b/;
// Naturligt sprog = mindst to ord med mellemrum imellem. "auction_cancelled"
// (type-konstanten) har ingen mellemrum og taeller derfor ikke.
const PROSE = /[A-Za-zÆØÅæøå]{2,}\s+[A-Za-zÆØÅæøå]{2,}/;

/** Index for afsluttende anfoerselstegn (springer ${...} i template-strenge over). */
function skipString(src, start) {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") { i += 1; continue; }
    if (quote === "`" && ch === "$" && src[i + 1] === "{") {
      let depth = 0;
      for (i += 1; i < src.length; i += 1) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
        if (c === "{") depth += 1;
        else if (c === "}") { depth -= 1; if (depth === 0) break; }
      }
      continue;
    }
    if (ch === quote) return i;
  }
  return src.length;
}

/** Index for den ")" der lukker kaldet hvis "(" staar paa `openIdx`; -1 hvis ingen. */
function findCallEnd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(src, i); continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Alle streng-literaler i en kaldtekst, uden ${...}-udtryk. */
function stringLiterals(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, i);
      out.push(text.slice(i + 1, end).replace(/\$\{[^}]*\}/g, " "));
      i = end;
    }
  }
  return out;
}

/**
 * Notifikations-kald hvis argumenter har en hardkodet prosa-streng og ingen
 * titleCode/messageCode. Returnerer [{ line, snippet }] (linjenumre fra 1).
 */
export function findUnkeyedNotificationCalls(src) {
  const cleaned = stripComments(src.replace(/\r/g, ""));
  const hits = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(cleaned)) !== null) {
    const open = m.index + m[0].length - 1;
    const end = findCallEnd(cleaned, open);
    if (end === -1) continue;
    const text = cleaned.slice(m.index, end + 1);
    if (KEYED.test(text)) continue;
    if (!stringLiterals(text.slice(m[0].length - 1)).some((s) => PROSE.test(s))) continue;
    hits.push({
      line: cleaned.slice(0, m.index).split("\n").length,
      snippet: text.replace(/\s+/g, " ").slice(0, 110),
    });
  }
  return hits;
}

function walkSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "locales") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkSources(abs, out);
    else if (/\.(?:js|mjs|ts)$/.test(name) && !/\.test\.(?:js|mjs|ts)$/.test(name) && !name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

export function scanUnkeyedNotifications({ root = ROOT } = {}) {
  const files = [];
  for (const sub of ["backend/lib", "backend/routes"]) {
    const abs = join(root, sub);
    if (existsSync(abs)) walkSources(abs, files);
  }
  const cron = join(root, "backend", "cron.js");
  if (existsSync(cron)) files.push(cron);

  const perFile = {};
  for (const abs of files) {
    const hits = findUnkeyedNotificationCalls(readFileSync(abs, "utf8"));
    if (hits.length) perFile[relative(root, abs).split("\\").join("/")] = hits;
  }
  return perFile;
}

/** Sammenlign fund mod baseline: { added: [...], stale: [...] }. */
export function compareToBaseline(perFile, baselineFiles = {}) {
  const added = [];
  const stale = [];
  for (const [file, hits] of Object.entries(perFile)) {
    const allowed = baselineFiles[file] ?? 0;
    if (hits.length > allowed) added.push({ file, count: hits.length, allowed, hits });
    else if (hits.length < allowed) stale.push({ file, count: hits.length, allowed });
  }
  for (const [file, allowed] of Object.entries(baselineFiles)) {
    if (!perFile[file]) stale.push({ file, count: 0, allowed });
  }
  return { added, stale };
}

function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")).files ?? {};
}

function writeBaseline(perFile, path = BASELINE_PATH) {
  const files = {};
  for (const [file, hits] of Object.entries(perFile).sort(([a], [b]) => a.localeCompare(b))) files[file] = hits.length;
  const body = {
    $comment: "Kendte notifikations-kald med hardkodet spillertekst uden titleCode/messageCode (ratchet, maa kun skrumpe). Genereret af scripts/i18n-check-backend-player-strings.mjs --update-baseline. Refs #6801. Nye kald maa IKKE tilfoejes her: giv teksten en noegle i frontend/public/locales/{en,da}/backendMessages.json.",
    files,
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

function runNotificationRatchet() {
  const perFile = scanUnkeyedNotifications();

  if (process.argv.includes("--update-baseline")) {
    writeBaseline(perFile);
    const total = Object.values(perFile).reduce((n, h) => n + h.length, 0);
    console.log(`Baseline skrevet: ${total} kald i ${Object.keys(perFile).length} fil(er).`);
    return true;
  }

  const { added, stale } = compareToBaseline(perFile, loadBaseline());

  if (added.length) {
    console.error(`\n❌ ${added.length} fil(er) har NYE notifikations-kald med hardkodet spillertekst (ingen titleCode/messageCode):`);
    for (const { file, count, allowed, hits } of added) {
      console.error(`   - ${file}: ${count} kald (baseline ${allowed})`);
      for (const h of hits.slice(0, 5)) console.error(`       linje ${h.line}: ${h.snippet}`);
    }
    console.error("\nFix: tilfoej en noegle i frontend/public/locales/{en,da}/backendMessages.json, koer");
    console.error("`node scripts/build-backend-locales.mjs`, og send metadata.titleCode/messageCode");
    console.error("(brug buildKeyedNotification fra backend/lib/notificationService.js).");
    return false;
  }

  if (stale.length) {
    console.log(`ℹ️  Stale baseline: ${stale.length} fil(er) har faerre kald end baselinen. Stram den:`);
    console.log("   node scripts/i18n-check-backend-player-strings.mjs --update-baseline");
  }
  const known = Object.values(perFile).reduce((n, h) => n + h.length, 0);
  console.log(`✅ notifikations-ratchet: ingen nye hardkodede kald (${known} kendte i baselinen).`);
  return true;
}

function main() {
  if (process.argv.includes("--update-baseline")) {
    runNotificationRatchet();
    return;
  }

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

  if (!runNotificationRatchet()) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
