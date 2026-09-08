#!/usr/bin/env node
// Tone-guard: døde produkttermer i spillervendt copy. Refs #5048.
//
// Reglen (docs/TONE_OF_VOICE.md §"Ord og termer", ejer-beslutning 8/9 2026):
// der findes ÉT betalt produkt, "CZ Pro", plus statussen "Founder". Tier-navnene
// fra Session B (19/5) er døde: Premium (som tier-navn), Pro Analyst, Patron.
// Dertil de gamle forbud: "Founder Supporter" som samlet navn og "free forever"
// som markedsførings-frase.
//
// Hvorfor en guard og ikke bare en regel: "Founder Supporter" lå live i
// spillervendt copy i fire dage uden at nogen så det
// (.claude/learnings/2026-09-07-founder-supporter-forbudt-term-live-i-4-dage.md).
// Samme fil foreslog præcis denne vagt. Den er bygget efter mønstret fra
// scripts/tone-check-em-dash.mjs og kører samme sted (npm run check:i18n).
//
// Scope:
//   1. frontend/public/locales/**/*.json + marketing/locales/**/*.json
//      (alle string-værdier rekursivt).
//   2. docs/TONE_OF_VOICE.md + docs/COMMS_PLAYBOOK.md (linje for linje).
//   3. frontend/src/data/patchNotes.js, men KUN patch notes med dato >= FREEZE_DATE.
//      Historikken indeholder legitime omtaler af de gamle tiers (fx v3.x's
//      4-tier-landingsside) og omskrives ikke bagud.
//
// Undtagelser:
//   a. Ordet "premium" som alment ord er TILLADT af tone-guiden ("OK på begge
//      sprog. Don't avoid it."). Kun tier-brugen fanges: "Premium tier",
//      "Premium monthly/annual/plan/badge" osv., plus en locale-værdi der er
//      præcis "Premium" under en nøgle der indeholder "tier".
//      Derfor rammer guarden ikke academy.json's "Sale premium" (salgspræmie).
//   b. Markdown-blokke mellem <!-- tone-check-terms:disable --> og
//      <!-- tone-check-terms:enable --> springes over. Bruges dér hvor en doc
//      SKAL nævne de forbudte termer for at forbyde dem.
//   c. EXEMPT_LOCALE_FILES: filer med kendt, endnu ikke ejer-godkendt drift.
//      Hver undtagelse har en grund og skal lukkes, ikke udvides.
//
// Brug:
//   node scripts/tone-check-terms.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const LOCALE_DIRS = ["frontend/public/locales", "marketing/locales"];
const DOC_FILES = ["docs/TONE_OF_VOICE.md", "docs/COMMS_PLAYBOOK.md"];
const PATCH_NOTES_FILE = "frontend/src/data/patchNotes.js";

// Patch notes fra og med denne dato er dækket. Ældre entries er historik.
const FREEZE_DATE = "2026-09-08";

// Kendte, endnu ikke ejer-godkendte forekomster. Tom liste er målet.
const EXEMPT_LOCALE_FILES = new Map([
  [
    "frontend/public/locales/en/founder.json",
    "Den gamle /founder-supporter-venteliste viser stadig 4-tier-kataloget " +
      "(Premium/Pro Analyst/Patron). Ruten er live i App.jsx. At rette copyen er " +
      "en spillervendt produktbeslutning der kræver ejer-go, ikke en tone-rettelse. " +
      "Se docs/COMMS_PLAYBOOK.md §8.1.",
  ],
  [
    "frontend/public/locales/da/founder.json",
    "Samme side, dansk. Se linjen ovenfor.",
  ],
]);

// Hvert mønster: navn + regex. Regex'erne er bevidst snævre, så et alment ord
// (fx "premium" om et begreb, eller "Sale premium" i akademiet) ikke fanges.
const PATTERNS = [
  { term: "Pro Analyst", re: /\bpro[ -]analyst\b/i },
  { term: "Patron (tier-navn)", re: /\bPatron\b/ },
  { term: "Founder Supporter", re: /\bfounder[ -]supporter\b/i },
  { term: "free forever", re: /\bfree[ -]forever\b/i },
  {
    // Bevidst versal-følsom: tone-guiden tillader "premium" med lille p som
    // alment ord ("a premium tier exists as an opt-in"). Det er den store P,
    // altså produktnavnet, der er dødt.
    term: "Premium som tier-navn",
    re: /\bPremium[ -](?:tier|tiers|monthly|annual|plan|plans|subscription|badge|member|membership)\b/,
  },
];

const DISABLE_MARKER = "tone-check-terms:disable";
const ENABLE_MARKER = "tone-check-terms:enable";

function matchTerms(text) {
  if (typeof text !== "string") return [];
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.term);
}

// ---------- 1. Locale-JSON ----------

function walkJson(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (f.endsWith(".json")) out.push(p);
  }
  return out;
}

function checkValue(value, path, file, violations) {
  if (typeof value === "string") {
    const terms = matchTerms(value);
    // Tier-navnet "Premium" står ofte alene som label under en tier-nøgle.
    if (value.trim() === "Premium" && /tier/i.test(path)) {
      terms.push("Premium som tier-navn");
    }
    for (const term of terms) {
      violations.push(
        `${file} → ${path}: ${term} · ${JSON.stringify(value.slice(0, 80))}`,
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkValue(v, `${path}[${i}]`, file, violations));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      checkValue(v, path ? `${path}.${k}` : k, file, violations);
    }
  }
}

export function findLocaleTermViolations(value, file) {
  const violations = [];
  checkValue(value, "", file, violations);
  return violations;
}

// ---------- 2. Docs (linjer, med disable-blokke) ----------

export function findDocTermViolations(source, file) {
  const violations = [];
  let disabled = false;
  source.split("\n").forEach((line, i) => {
    if (line.includes(DISABLE_MARKER)) {
      disabled = true;
      return;
    }
    if (line.includes(ENABLE_MARKER)) {
      disabled = false;
      return;
    }
    if (disabled) return;
    for (const term of matchTerms(line)) {
      violations.push(`${file}:${i + 1}: ${term} · ${line.trim().slice(0, 80)}`);
    }
  });
  return violations;
}

// ---------- 3. Patch notes (kun nye entries) ----------

export function findPatchNotesTermViolations(patches, file, freezeDate) {
  const violations = [];
  for (const patch of patches ?? []) {
    if (!patch?.date || patch.date < freezeDate) continue;
    checkValue(
      patch,
      `v${patch.version ?? "?"}`,
      file,
      violations,
    );
  }
  return violations;
}

// ---------- Resultat ----------

async function runTermCheck() {
  const violations = [];
  const skipped = [];

  for (const dir of LOCALE_DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of walkJson(abs)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const exemptReason = EXEMPT_LOCALE_FILES.get(rel);
      if (exemptReason) {
        skipped.push(`${rel}: ${exemptReason}`);
        continue;
      }
      violations.push(
        ...findLocaleTermViolations(JSON.parse(readFileSync(file, "utf8")), rel),
      );
    }
  }

  for (const relFile of DOC_FILES) {
    const abs = join(ROOT, relFile);
    if (!existsSync(abs)) continue;
    violations.push(
      ...findDocTermViolations(readFileSync(abs, "utf8"), relFile),
    );
  }

  const { PATCHES } = await import(
    pathToFileURL(join(ROOT, PATCH_NOTES_FILE)).href
  );
  violations.push(
    ...findPatchNotesTermViolations(PATCHES, PATCH_NOTES_FILE, FREEZE_DATE),
  );

  if (violations.length) {
    console.error(
      `tone-check-terms: ${violations.length} fund af døde produkttermer i spillervendt copy:\n`,
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      "\nRegel: docs/TONE_OF_VOICE.md §Ord og termer. Der findes ét betalt produkt," +
        "\n'CZ Pro', plus statussen 'Founder'. Skal en doc nævne en forbudt term for at" +
        "\nforbyde den, så pak afsnittet ind i <!-- tone-check-terms:disable/enable -->.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "tone-check-terms: OK, ingen døde produkttermer i spillervendt copy (locales + tone-docs + nye patch notes).",
  );
  for (const s of skipped) console.log(`  undtaget: ${s}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runTermCheck();
}
