#!/usr/bin/env node
// backend/scripts/lintRiderTypeWrites.js
// ============================================================================
// Forward-guard for #3570/#3588 — den PERSISTEREDE ryttertype må kun komme fra
// `resolveRiderTypes` (backend/lib/riderTypes.js).
//
// BAGGRUND. Klassifikationen var et lukket kredsløb: `buildCapsForRider` former
// `ability_caps` ud fra den PERSISTEREDE type (dailyTrainingEngine, hvert tick),
// og `computeRiderTypes` udledte typen igen af netop de caps (riderValueRefresh,
// hver nat). Typen bekræftede bare sig selv — målt til fikspunkt gav det
// baroudeur 53,5 % / puncheur 0,2 % mod ejer-målene 11 % / 13 %. PR #3588 brød
// løkken ved at gøre `resolveRiderTypes(archetype_draw, caps, baseline)` til
// identitets-kilden: bærer rytteren et persisteret anlæg, ER det identiteten;
// er anlægget NULL, klassificeres han bit-identisk som før.
//
// #3588 rettede TO af TRE skrivestier. `runRiderTypesBackfill` (backfillCores.js)
// klassificerede stadig fra caps uden at læse `archetype_draw`, og den skriver
// primary_type/secondary_type for HELE peletonen (8.234 rækker, inkl. retired).
// Én kørsel af `node scripts/backfillRiderTypes.js` ville have nulstillet
// frysningen for alle ryttere, tavst. Denne guard findes for at det ikke kan ske
// en fjerde gang.
//
// HVAD DEN TJEKKER
//   1. INVENTAR: mængden af filer der BÅDE skriver til `riders` OG bygger et
//      objekt med `primary_type`/`secondary_type` som nøgle skal være præcis
//      TYPE_WRITE_FILES. En ny skrivesti dukker op som et ukendt filnavn.
//   2. KILDE: i produktions-koden (lib/ + routes/) må værdien af en
//      `primary_type:`/`secondary_type:`-nøgle ikke komme fra `computeRiderTypes`
//      — hverken direkte (`computeRiderTypes(...).primary.key`) eller via en
//      binding (`const { primary } = computeRiderTypes(...)` → `primary.key`).
//      Kun `resolveRiderTypes` er identitets-kilden.
//   3. ANKRE: de kendte identitets-kaldsteder skal fortsat kalde
//      `resolveRiderTypes`.
//
// OPT-OUT. En legitim klassifikation der ALDRIG persisteres (bootstrap til
// caps-formning, en accept-gate før insert, en read-only preview) markeres med
// en `// rider-type-write-ok: <begrundelse>`-kommentar på linjen over (eller på)
// nøglen. Markøren kræver en begrundelse — den er et dokumenteret valg, ikke en
// slukkeknap.
//
// SCOPE-GRÆNSE (dokumenteret, ikke et hul der skal "lukkes"): guarden er
// statisk og læser kun kildetekst. Den følger ikke en payload på tværs af
// moduler, og den kan ikke se en type der skrives via en dynamisk nøgle
// (`patch[col] = …`). Den dækker den konkrete fejlform #3588 efterlod — en
// klassifikator-afledt type i en skrivesti — plus enhver NY fil der begynder at
// skrive typen. Kombineret med `riderTypes.js`' topkommentar (diagnostik-scripts
// må frit kalde computeRiderTypes, de skriver intet) er det den relevante
// afgrænsning.
//
// Brug:
//   node scripts/lintRiderTypeWrites.js
//
// Exit-koder: 0 ingen fund · 1 mindst ét fund · 2 intern fejl.
//
// Refs #3570 #3588.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = resolve(__dirname, "..");

export const IDENTITY_FN = "resolveRiderTypes";
export const CLASSIFIER_FN = "computeRiderTypes";
export const OPT_OUT = "rider-type-write-ok";
export const TYPE_COLUMNS = Object.freeze(["primary_type", "secondary_type"]);

// Mapper der scannes (relativt til backend/). scripts/ er med i INVENTAR-checket
// (en ops-CLI kan sagtens skrive typen) men holdes ude af KILDE-checket for de
// filer der ikke rører `riders` — se scope-grænsen ovenfor.
const SCAN_DIRS = Object.freeze(["lib", "routes", "scripts"]);
// lib/testdb er test-infrastruktur (bygger et PGlite-skema), ikke en skrivesti.
const IGNORED_DIR_SEGMENTS = Object.freeze(["node_modules", "lib/testdb"]);

// ---------------------------------------------------------------------------
// INVENTAR — de eneste filer der må BÅDE skrive `riders` OG bygge et objekt med
// primary_type/secondary_type. Hver post skal bære en begrundelse.
// ---------------------------------------------------------------------------
export const TYPE_WRITE_FILES = Object.freeze({
  "lib/backfillCores.js":
    "runRiderTypesBackfill (global type-backfill, hele peletonen) + deriveForRiderIds " +
    "(akademi-intake/re-derive). Begge persisterer typen og SKAL bruge resolveRiderTypes.",
  "lib/riderValueRefresh.js":
    "recomputeRiderValue/selectChangedValueUpdates — nattens type+værdi-sweep " +
    "(trainingSweep). Persisterer typen og bruger resolveRiderTypes.",
  "lib/starterSquadAllocator.js":
    "Accept-gate før insert (tier-loft) — spejler deriveForRiderIds' kæde. Typen " +
    "skrives IKKE herfra (deriveForRiderIds gør det), men gaten skal følge samme " +
    "identitets-kilde, ellers genopstår #2065-klassen.",
  "routes/api.js":
    "Læser og videresender riders.primary_type i API-svar (fx transfer-listen). " +
    "Ingen af rutens riders-writes rører type-kolonnerne.",
  "scripts/dev/repair3570Apply.mjs":
    "#3570-reparationen: engangs-frysningen af rytter-identiteten. Skriver " +
    "archetype_draw + primary_type + secondary_type i ÉN operation, hvor typen ER " +
    "det frosne anlæg — samme værdi resolveRiderTypes returnerer for det draw. " +
    "Klassifikatoren kaldes ikke; post-verify kontrollerer eksplicit at " +
    "resolveRiderTypes(draw, caps, baseline).primary matcher den skrevne type.",
  "scripts/dev/repairYouthOutliers2699.mjs":
    "#2699-nedjusteringen: LÆSER primary_type for at bruge den som anlæg og kalder " +
    "resolveRiderTypes for at vise den resulterende type i dry-run-rapporten. " +
    "Scriptets egen UPDATE rører kun stat_*-kolonnerne + archetype_draw — typen " +
    "persisteres udelukkende af deriveForRiderIds bagefter, altså gennem den " +
    "allerede-ankrede identitets-kilde.",
});

// ---------------------------------------------------------------------------
// ANKRE — kaldsteder der skal blive ved med at spørge identitets-kilden.
// ---------------------------------------------------------------------------
export const IDENTITY_ANCHORS = Object.freeze([
  { file: "lib/backfillCores.js", fn: "runRiderTypesBackfill" },
  { file: "lib/backfillCores.js", fn: "deriveForRiderIds" },
  { file: "lib/riderValueRefresh.js", fn: "recomputeRiderValue" },
]);

// ---------------------------------------------------------------------------
// Maskering: erstat kommentarer, string-literaler og regex-literaler med
// mellemrum (samme længde, newlines bevaret) så linjenumre holder og et
// `"id, primary_type"`-select aldrig forveksles med en objekt-nøgle.
// `${…}` i template-literaler bevares som kode.
// ---------------------------------------------------------------------------
const REGEX_PRECEDERS = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">", "\n",
]);

export function maskNonCode(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const prevMeaningful = (idx) => {
    for (let k = idx - 1; k >= 0; k--) {
      if (src[k] === " " || src[k] === "\t" || src[k] === "\r") continue;
      return src[k];
    }
    return "\n";
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c || src[j] === "\n") break;
        j++;
      }
      const stop = Math.min(j + 1, n);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let segStart = i;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`") { j++; break; }
        if (src[j] === "$" && src[j + 1] === "{") {
          blank(segStart, j);
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            k++;
          }
          j = k;
          segStart = k;
          continue;
        }
        j++;
      }
      blank(segStart, j);
      i = j;
      continue;
    }
    if (c === "/" && REGEX_PRECEDERS.has(prevMeaningful(i))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "\n") break;
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) { j++; closed = true; break; }
        j++;
      }
      if (closed) {
        blank(i, j);
        i = j;
        continue;
      }
    }
    i++;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Kildeanalyse
// ---------------------------------------------------------------------------
const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";

/**
 * `supabase.from("riders").update|insert|upsert(` — matches på RÅ kilde (tabel-
 * navnet er en string-literal og derfor maskeret væk i den maskerede tekst).
 * `.test.js`-filer scannes ikke, så en fixture kan ikke forurene inventaret.
 */
export function findRidersWrites(rawSource) {
  const re = /from\(\s*["']riders["']\s*\)[\s\S]{0,80}?\.(update|insert|upsert)\s*\(/g;
  const hits = [];
  let m;
  while ((m = re.exec(rawSource)) !== null) hits.push({ index: m.index, op: m[1] });
  return hits;
}

/** Objekt-literal-nøgler `primary_type:` / `secondary_type:` i maskeret kode. */
export function findTypeKeySites(masked) {
  const re = new RegExp(
    `(^|[\\s{,(])["']?(${TYPE_COLUMNS.join("|")})["']?\\s*:`,
    "g"
  );
  const sites = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    const keyStart = m.index + m[1].length;
    const valueStart = m.index + m[0].length;
    sites.push({ column: m[2], keyStart, valueStart, value: valueExpression(masked, valueStart) });
  }
  return sites;
}

/** Værdi-udtrykket fra `valueStart` frem til næste komma/lukkeklamme på dybde 0. */
export function valueExpression(masked, valueStart) {
  let depth = 0;
  let i = valueStart;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) break;
  }
  return masked.slice(valueStart, i);
}

/**
 * Bindinger hvis initializer kalder en af de to klassifikatorer.
 * Dækker `const { primary, secondary } = X(...)`, `const { primary: p } = X(...)`
 * og `const t = X(...)` / `const k = X(...).primary.key`.
 */
export function findClassifierBindings(masked) {
  const re = new RegExp(
    `\\b(?:const|let|var)\\s+(\\{[^}]*\\}|${IDENT})\\s*=\\s*([^;\\n]*)`,
    "g"
  );
  const bindings = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    const init = m[2];
    const usesIdentity = init.includes(`${IDENTITY_FN}(`);
    const usesClassifier = init.includes(`${CLASSIFIER_FN}(`);
    if (!usesIdentity && !usesClassifier) continue;
    const source = usesIdentity ? IDENTITY_FN : CLASSIFIER_FN;
    const target = m[1];
    const names = target.startsWith("{")
      ? target
        .slice(1, -1)
        .split(",")
        .map((part) => part.split(":").pop().trim().replace(/^\.\.\./, ""))
        .filter((name) => new RegExp(`^${IDENT}$`).test(name))
      : [target];
    for (const name of names) bindings.push({ name, source, index: m.index });
  }
  return bindings;
}

/** Identifikatorer i et udtryk — property-navne efter `.` tælles ikke med. */
export function rootIdentifiers(expr) {
  const re = new RegExp(`(\\.?)(${IDENT})`, "g");
  const names = new Set();
  let m;
  while ((m = re.exec(expr)) !== null) {
    if (m[1] === ".") continue;
    names.add(m[2]);
  }
  return names;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/**
 * Det objekt-literal nøglen står i: fra den `{` der omslutter den, til dens
 * matchende `}`. Bruges så ÉN opt-out-markør dækker hele literalen (et objekt
 * med både primary_type og secondary_type skal ikke markeres to gange).
 */
export function enclosingObjectRange(masked, keyStart) {
  let depth = 0;
  let open = -1;
  for (let i = keyStart - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === "}" || c === ")" || c === "]") depth++;
    else if (c === "{" || c === "(" || c === "[") {
      if (depth === 0) { open = c === "{" ? i : -1; break; }
      depth--;
    }
  }
  if (open === -1) return null;
  depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth === 0) return { open, close: i };
    }
  }
  return null;
}

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/** Markøren i den sammenhængende kommentar-blok umiddelbart over `line`. */
function markerInCommentBlockAbove(rawLines, line) {
  for (let l = line - 1; l >= 1; l--) {
    const text = rawLines[l - 1] || "";
    if (!COMMENT_LINE.test(text)) return false;
    if (text.includes(OPT_OUT)) return true;
  }
  return false;
}

/**
 * Opt-out gælder hvis markøren står på nøglens linje, i kommentar-blokken lige
 * over den, eller et vilkårligt sted i det omsluttende objekt-literal (inkl.
 * kommentar-blokken over dets `{`). Én markør dækker dermed en hel literal —
 * et objekt med både primary_type og secondary_type skal ikke markeres to gange.
 */
function hasOptOut(rawLines, line, objectLines) {
  if ((rawLines[line - 1] || "").includes(OPT_OUT)) return true;
  if (markerInCommentBlockAbove(rawLines, line)) return true;
  if (objectLines) {
    if (markerInCommentBlockAbove(rawLines, objectLines.open)) return true;
    for (let l = objectLines.open; l <= objectLines.close; l++) {
      if ((rawLines[l - 1] || "").includes(OPT_OUT)) return true;
    }
  }
  return false;
}

/**
 * KILDE-checket for én fil. Returnerer fund: en type-nøgle hvis værdi stammer
 * fra `computeRiderTypes` (direkte eller via nærmeste forudgående binding) og
 * som ikke bærer en opt-out-markør.
 */
export function findClassifierDerivedTypeWrites(rawSource, file) {
  const masked = maskNonCode(rawSource);
  const rawLines = rawSource.split("\n");
  const bindings = findClassifierBindings(masked);
  const findings = [];

  for (const site of findTypeKeySites(masked)) {
    let reason = null;
    if (site.value.includes(`${CLASSIFIER_FN}(`)) {
      reason = `${CLASSIFIER_FN}() kaldt direkte i værdien`;
    } else if (!site.value.includes(`${IDENTITY_FN}(`)) {
      for (const name of rootIdentifiers(site.value)) {
        const nearest = bindings
          .filter((b) => b.name === name && b.index < site.keyStart)
          .sort((a, b) => b.index - a.index)[0];
        if (nearest && nearest.source === CLASSIFIER_FN) {
          reason = `\`${name}\` er bundet fra ${CLASSIFIER_FN}()`;
          break;
        }
      }
    }
    if (!reason) continue;
    const line = lineOf(rawSource, site.keyStart);
    const range = enclosingObjectRange(masked, site.keyStart);
    const objectLines = range
      ? { open: lineOf(rawSource, range.open), close: lineOf(rawSource, range.close) }
      : null;
    if (hasOptOut(rawLines, line, objectLines)) continue;
    findings.push({ file, line, column: site.column, reason });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Fil-indsamling
// ---------------------------------------------------------------------------
/** Normalisér til posix-relativ sti (allowlist-nøglerne er posix). */
export function relKey(root, abs) {
  return relative(root, abs).split("\\").join("/");
}

export function collectSourceFiles(root = BACKEND_ROOT, dirs = SCAN_DIRS) {
  const out = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      const rel = relKey(root, child);
      if (IGNORED_DIR_SEGMENTS.some((seg) => rel === seg || rel.startsWith(`${seg}/`))) continue;
      if (entry.isDirectory()) walk(child);
      else if (/\.(js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".test.js")) out.push(child);
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.sort();
}

// ---------------------------------------------------------------------------
// Samlet scan
// ---------------------------------------------------------------------------
export function scanBackend(root = BACKEND_ROOT, {
  anchors = IDENTITY_ANCHORS,
  allowlist = TYPE_WRITE_FILES,
} = {}) {
  const files = collectSourceFiles(root);
  const inventory = [];
  const sourceFindings = [];
  const anchorFindings = [];

  for (const abs of files) {
    const key = relKey(root, abs);
    const raw = readFileSync(abs, "utf8");
    if (!raw.includes("primary_type") && !raw.includes("secondary_type")) continue;
    const masked = maskNonCode(raw);
    const typeKeys = findTypeKeySites(masked);
    const writes = findRidersWrites(raw);
    if (typeKeys.length > 0 && writes.length > 0) inventory.push(key);
    // KILDE-checket kører på al produktions-kode (lib/ + routes/) samt enhver
    // fil der rører `riders` — dvs. præcis dér hvor en type kan blive persisteret.
    const isProduction = key.startsWith("lib/") || key.startsWith("routes/");
    if (isProduction || writes.length > 0) {
      sourceFindings.push(...findClassifierDerivedTypeWrites(raw, key));
    }
  }

  for (const anchor of anchors) {
    const raw = readFileSync(join(root, anchor.file), "utf8");
    const masked = maskNonCode(raw);
    const body = functionBody(masked, anchor.fn);
    if (body == null) {
      anchorFindings.push({ ...anchor, problem: "funktionen findes ikke længere" });
    } else if (!body.includes(`${IDENTITY_FN}(`)) {
      anchorFindings.push({ ...anchor, problem: `kalder ikke ${IDENTITY_FN}()` });
    }
  }

  const known = new Set(Object.keys(allowlist));
  const unknownWriters = inventory.filter((f) => !known.has(f));
  const staleAllowlist = [...known].filter((f) => !inventory.includes(f));

  return { inventory, unknownWriters, staleAllowlist, sourceFindings, anchorFindings };
}

/**
 * Krop af en navngiven funktion. Parameterlisten springes over med balancerede
 * parenteser FØRST — ellers rammer en destruktureret parameter (`{ dryRun = true }`,
 * som alle backfill-kernerne bruger) som "kroppen".
 */
export function functionBody(masked, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(|\\b${name}\\s*=\\s*(?:async\\s*)?\\(`);
  const m = re.exec(masked);
  if (!m) return null;
  const paramOpen = masked.indexOf("(", m.index);
  if (paramOpen === -1) return null;
  let depth = 0;
  let paramClose = -1;
  for (let i = paramOpen; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") {
      depth--;
      if (depth === 0) { paramClose = i; break; }
    }
  }
  if (paramClose === -1) return null;
  const open = masked.indexOf("{", paramClose);
  if (open === -1) return null;
  depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function isMain() {
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

function main() {
  const res = scanBackend();
  let failed = false;

  for (const f of res.sourceFindings) {
    process.stderr.write(
      `${f.file}:${f.line}: ${f.column} bygges fra klassifikatoren — ${f.reason}\n`
    );
    failed = true;
  }
  for (const f of res.unknownWriters) {
    process.stderr.write(
      `${f}: ny fil skriver til riders OG bygger et objekt med primary_type/secondary_type\n`
    );
    failed = true;
  }
  for (const f of res.staleAllowlist) {
    process.stderr.write(
      `${f}: står i TYPE_WRITE_FILES men er ikke længere en type-skrivesti (fjern posten)\n`
    );
    failed = true;
  }
  for (const a of res.anchorFindings) {
    process.stderr.write(`${a.file}: ${a.fn} — ${a.problem}\n`);
    failed = true;
  }

  if (failed) {
    process.stderr.write(`
🔴 Rider-type-write guard blokerede.

Den PERSISTEREDE ryttertype har ÉN kilde: resolveRiderTypes(archetype_draw,
caps, baseline) i backend/lib/riderTypes.js. computeRiderTypes gætter typen ud
fra de caps som typen selv formede — det var den løkke #3570/#3588 brød, og en
skrivesti der omgår resolveRiderTypes nulstiller frysningen for hele peletonen.

Ret det: kald resolveRiderTypes og hav archetype_draw med i selectet.
Er klassifikationen bevidst IKKE persisteret (bootstrap til caps-formning,
accept-gate før insert, read-only preview)? Sæt
\`// ${OPT_OUT}: <begrundelse>\` på linjen over.

Refs #3570 #3588.
`);
    process.exit(1);
  }

  process.stdout.write(
    `✅ Rider-type-write guard: ${res.inventory.length} skrivesti-fil(er) kendt ` +
      `(${res.inventory.join(", ")}), ingen klassifikator-afledte type-writes.\n`
  );
}

if (isMain()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`lintRiderTypeWrites: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
