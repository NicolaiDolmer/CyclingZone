#!/usr/bin/env node
// #5508 · Klassifikator for de staaende merge-regler (AGENTS.md hard rule 35,
// ejer 22/9 + 24/9). KUN information: scripts/merge-queue.ps1 printer kategorien
// i oversigten, og merge-adfaerden aendres ikke af den.
//
// Kategorier (maa merges uden ejerens ordrette "merge" naar CI er groen, et
// uafhaengigt read-only diff-tjek er rent og CodeRabbit ikke har blokerende fund):
//   (a) brand-fejlrettelse uden ny spillertekst, hvor fejlen og effekten er
//       maalt i prod foer og efter
//   (b) motor-PR bag slukket race_engine_v4 (kun backend/lib/engine/v4);
//       #5580/#5581 (indsats/realisme-gate med ejerens maaltal) er undtaget
//   (c) Dependabot patch/minor · docs uden spillertekst · CI/hooks/test-only
//   (d) additive, idempotente migrationer (+ docs/CI/test), ejer-valg B 4/11
//       (#7578): flag-seed 'off' med ON CONFLICT DO NOTHING, nullable
//       ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS. Afgoeres af
//       SQL-indholdet (analyzeMigrationSql); ukendt eller manglende SQL = ejer-go.
// Alt andet: "kraever ejer-go" med den foerste grund (UI, spillertekst,
// spillervendte tal, ikke-additive migrationer, flag-flips, prod-skrivninger, og
// fra 4/10 release-tjek/deploy/overvaagning). Ejer-go er klaebende pr. PR
// (OWNER_GO_MARKER).
//
// Input er labels + filstier + titel + body (+ author) + migrationernes SQL
// (`migrationSql: { [sti]: tekst }`). Alt herunder er rent; gh-kaldene ligger
// kun i fetchPrFromGh/fetchMigrationSql og main() nederst.
//
//   node scripts/merge-queue-classify.mjs --pr 5654 [--repo owner/name] [--json]
//   node scripts/merge-queue-classify.mjs --input pr.json [--json]   # uden gh
//
// Tests: node --test scripts/merge-queue-classify.test.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "NicolaiDolmer/CyclingZone";

export const CATEGORY = Object.freeze({
  A_BRAND_FIX: "a",
  B_ENGINE_V4: "b",
  C_SAFE: "c",
  D_ADDITIVE_MIGRATION: "d",
  OWNER: "ejer-go",
});

export const CATEGORY_LABEL = Object.freeze({
  a: "(a) brand-fejlrettelse uden ny spillertekst",
  b: "(b) motor bag slukket race_engine_v4",
  c: "(c) Dependabot/docs/CI-hooks-test",
  d: "(d) additiv, idempotent migration",
  "ejer-go": "kraever ejer-go",
});

/** PR'er hard rule 35 (b) eksplicit undtager: ejerens realisme-maaltal. */
export const ENGINE_EXCEPTION_ISSUES = Object.freeze([5580, 5581]);

// ── Filsti-klasser ─────────────────────────────────────────────────────────

const TEST_FILE_RE = /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)tests?\/|\/e2e\//;
const DOCS_RE = /^(docs\/|\.claude\/learnings\/|[^/]+\.md$|superpowers\/)/i;
const CI_HOOKS_RE = /^(\.github\/|scripts\/hooks\/|\.githooks\/|\.coderabbit\.yaml$|\.pre-commit-config\.yaml$)/;
const ENGINE_V4_RE = /^backend\/lib\/engine\/v4\//;
const MIGRATION_RE = /^database\/.*\.sql$/i;
const LOCKFILE_RE = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const FRONTEND_UI_RE = /^frontend\/(src|index\.html|public\/(?!locales\/))/;
const PLAYER_TEXT_RE = /^(frontend\/public\/locales\/|backend\/locales\/|frontend\/src\/data\/patchNotes\.js$|frontend\/src\/pages\/(PatchNotesPage|PrivacyPolicyPage|TermsPage|TermsPageEn)\.jsx$|frontend\/index\.html$|docs\/TONE_OF_VOICE\.md$)/;
const PLAYER_NUMBER_FILE_RE = /^backend\/lib\/(economy|salary|prize|sponsor|training|dailyTraining|raceDayYield|riderProgression|riderCondition|weights\/|balance)/i;
const FLAG_FLIP_RE = /(flip|taend|tænd|slaa .* til|slå .* til|enable|turn(s|ed)? on)\b/i;
const FLAG_FILE_RE = /(app_config|feature[-_ ]?flag|stageFlagCatalog)/i;
// Release-tjek, deploy og overvaagning er ejerens (hard rule 35, ejer 4/10): #6135
// aendrede baade deploy-verify og hvad uptime-monitoren paa /health ser. Gaelder
// ogsaa merge-reglernes egen klassifikator. Rene testfiler er undtaget.
const RELEASE_OPS_RE = /^(\.github\/workflows\/(deploy-verify|auto-migrate|auto-merge|dependabot-auto-merge|railway-log-watch|supabase-log-watch|drift-monitor|db-health)\.ya?ml$|backend\/railway\.json$|(frontend\/)?vercel\.json$|backend\/instrument\.mjs$|backend\/lib\/(healthRoutes|sentry|stallWatchdog|raceFinalizeWatch|opsAlert)[^/]*$|backend\/scripts\/checkBackendReadiness\.[jt]s$|scripts\/(verify-deploy\.ps1|merge-queue[^/]*)$)/;
const PROD_WRITE_RE =/(^|\s)(--execute|--apply)(\s|$)|\b(OWNER_GO=1|backfill|prod-skrivning|prod write)\b/i;

export const isTestFile = (p) => TEST_FILE_RE.test(p);
export const isDocsFile = (p) => DOCS_RE.test(p);
export const isCiOrHooksFile = (p) => CI_HOOKS_RE.test(p);
export const isEngineV4File = (p) => ENGINE_V4_RE.test(p);
export const isMigrationFile = (p) => MIGRATION_RE.test(p);
export const isPlayerTextFile = (p) => PLAYER_TEXT_RE.test(p);
export const isFrontendUiFile = (p) => FRONTEND_UI_RE.test(p) && !isTestFile(p) && !isPlayerTextFile(p);
export const isLockfile = (p) => LOCKFILE_RE.test(p);
export const isPlayerNumberFile = (p) => PLAYER_NUMBER_FILE_RE.test(p) && !isTestFile(p);
export const isReleaseOpsFile = (p) => RELEASE_OPS_RE.test(p) && !isTestFile(p);

// ── Hjaelpere ──────────────────────────────────────────────────────────────

function labelNames(labels) {
  return (labels ?? []).map((l) => (typeof l === "string" ? l : l?.name ?? "")).map((s) => s.toLowerCase()).filter(Boolean);
}

function filePaths(files) {
  return (files ?? []).map((f) => (typeof f === "string" ? f : f?.path ?? f?.filename ?? "")).filter(Boolean);
}

function authorLogin(author) {
  if (!author) return "";
  return String(typeof author === "string" ? author : author.login ?? "").toLowerCase();
}

function issueRefs(text) {
  return [...String(text ?? "").matchAll(/#(\d{3,5})\b/g)].map((m) => Number(m[1]));
}

/** Dependabot-titel: "chore(deps): bump x from 1.2.3 to 1.3.0" -> patch/minor/major/null. */
export function semverBumpKind(title) {
  const m = /from\s+v?(\d+)\.(\d+)\.(\d+)[^\s]*\s+to\s+v?(\d+)\.(\d+)\.(\d+)/i.exec(String(title ?? ""));
  if (!m) return null;
  const [fromMajor, fromMinor] = [Number(m[1]), Number(m[2])];
  const [toMajor, toMinor] = [Number(m[4]), Number(m[5])];
  if (toMajor !== fromMajor) return "major";
  if (toMinor !== fromMinor) return "minor";
  return "patch";
}

/**
 * "fejlen og effekten maalt i prod foer og efter" (hard rule 35 (a), strammet 4/10).
 * Kraever en egen sektion `## Fejlens effekt i prod` med en ikke-tom `Før:`- og
 * `Efter:`-linje. Et loest "maalt i prod" et sted i teksten taeller ikke laengere:
 * #6135 skiftede kategori alene fordi en saetning blev omformuleret. Om tallene
 * maaler selve fejlen (ikke en endpoint- eller tekstform) vurderer diff-tjekket.
 */
export const PROD_EFFECT_HEADING_RE = /^#{2,4}\s*(fejlens effekt i prod|fault effect in prod)\s*$/im;

export function hasProdMeasurement(body) {
  const text = String(body ?? "");
  const heading = PROD_EFFECT_HEADING_RE.exec(text);
  if (!heading) return false;
  const section = text.slice(heading.index + heading[0].length).split(/^#{1,4}\s/m)[0];
  const line = (re) => section.split(/\r?\n/).some((l) => re.test(l));
  return line(/^\s*[-*]?\s*(f(oe|ø|o)r|before)\s*:\s*\S/i) && line(/^\s*[-*]?\s*(efter|after)\s*:\s*\S/i);
}

// Markoer som merge-queue.ps1 skriver paa PR'en foerste gang den klassificeres
// ejer-go. Klaebende: en senere omformulering af body kan ikke loefte PR'en ud af
// ejer-go (hard rule 35, ejer 4/10). Kun ejerens ordrette "merge" loefter den.
export const OWNER_GO_MARKER = "<!-- merge-queue-category: ejer-go -->";

export function hasOwnerGoMarker(comments) {
  return (comments ?? []).some((c) => String(typeof c === "string" ? c : c?.body ?? "").includes(OWNER_GO_MARKER));
}

// ── Migrationer: additiv og idempotent? (ejer-valg B 4/11, #7578) ─────────
//
// Fail-closed: hver saetning skal matche en kendt additiv, idempotent form.
// Alt andet, ogsaa SQL vi ikke kan laese, er ejer-go. Kommentarer og
// streng-literaler fjernes foerst, saa "DROP" i en kommentar eller en
// beskrivelse ikke taeller, og "drop" i selve koden altid gør.

/**
 * Deler SQL i saetninger. Kommentarer fjernes; streng- og dollar-literaler
 * erstattes af `'§n'`, og deres indhold gemmes i `literals[n]`.
 * Returnerer null ved uafsluttet kommentar/streng (= ukendt SQL).
 * @param {string} sql
 * @returns {Array<{code: string, literals: string[]}>|null}
 */
export function splitSqlStatements(sql) {
  const src = String(sql ?? "");
  const out = [];
  let code = "";
  let literals = [];
  const flush = () => {
    const c = code.replace(/\s+/g, " ").trim();
    if (c) out.push({ code: c, literals });
    code = "";
    literals = [];
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === "-" && nx === "-") {
      const j = src.indexOf("\n", i);
      i = j < 0 ? src.length : j;
      code += " ";
      continue;
    }
    if (ch === "/" && nx === "*") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; }
        else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      if (depth) return null;
      code += " ";
      continue;
    }
    if (ch === "'") {
      // E'...' tillader backslash-escapes; ellers er '' det eneste escape.
      const escapes = /(^|[^A-Za-z0-9_$])[eE]$/.test(code);
      let j = i + 1;
      let val = "";
      for (;;) {
        if (j >= src.length) return null;
        const c = src[j];
        if (escapes && c === "\\") { val += src[j + 1] ?? ""; j += 2; continue; }
        if (c === "'") {
          if (src[j + 1] === "'") { val += "'"; j += 2; continue; }
          j++;
          break;
        }
        val += c;
        j++;
      }
      literals.push(val);
      code += `'§${literals.length - 1}'`;
      i = j;
      continue;
    }
    if (ch === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) return null;
      code += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "$" && !/[A-Za-z0-9_$]$/.test(code)) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      if (tag) {
        const j = src.indexOf(tag[0], i + tag[0].length);
        if (j < 0) return null;
        literals.push(src.slice(i + tag[0].length, j));
        code += `'§${literals.length - 1}'`;
        i = j + tag[0].length;
        continue;
      }
    }
    if (ch === ";") { flush(); i++; continue; }
    code += ch;
    i++;
  }
  flush();
  return out;
}

/** Deler paa et skilletegn uden for parenteser (literaler er allerede erstattet). */
function splitTopLevel(text, sep = ",") {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = `${IDENT}(?:\\.${IDENT})?`;

// Moenstre der altid er ejerens, uanset form (soeges i koden uden kommentarer
// og literaler). Rækkefølgen giver den mest sigende grund.
const DESTRUCTIVE_SQL = [
  [/\bDROP\b/i, "DROP"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bDELETE\b/i, "DELETE"],
  [/\bUPDATE\b/i, "UPDATE af data"],
  [/\b(GRANT|REVOKE)\b/i, "GRANT/REVOKE"],
  [/\bPOLICY\b|\bROW LEVEL SECURITY\b/i, "RLS/policy"],
  [/\bRENAME\b/i, "RENAME"],
];

// Flag-tabellen: kun en seed med vaerdien off/false er additiv. Alle andre
// INSERTs kan vaere spillervendt indhold (roadmap, kendte fejl, katalog).
const FLAG_SEED_RE = new RegExp(
  String.raw`^INSERT INTO (?:public\.)?"?app_config"? \(([^()]*)\) VALUES (.+?) ON CONFLICT(?: ?\([^()]*\))? DO NOTHING$`,
  "i",
);
const FLAG_OFF_VALUE_RE = /^\s*("off"|false)\s*$/i;

function checkFlagSeed(stmt) {
  const m = FLAG_SEED_RE.exec(stmt.code);
  if (!m) {
    if (/^INSERT INTO (?:public\.)?"?app_config"?\b/i.test(stmt.code) && !/\bON CONFLICT\b.*\bDO NOTHING$/i.test(stmt.code)) {
      return "flag-INSERT uden ON CONFLICT DO NOTHING (ikke idempotent)";
    }
    return "INSERT uden for en flag-seed i app_config (data kan vaere spillervendt)";
  }
  const cols = m[1].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
  const valueIdx = cols.indexOf("value");
  if (valueIdx < 0) return "flag-seed uden value-kolonne";
  const tuples = splitTopLevel(m[2]);
  for (const tuple of tuples) {
    const inner = /^\((.*)\)$/.exec(tuple);
    if (!inner) return "flag-seed med ukendt VALUES-form";
    const items = splitTopLevel(inner[1]);
    if (items.length !== cols.length) return "flag-seed med ukendt VALUES-form";
    const lit = /^'§(\d+)'(?:::jsonb)?$/i.exec(items[valueIdx]);
    if (!lit || !FLAG_OFF_VALUE_RE.test(stmt.literals[Number(lit[1])] ?? "")) {
      return "flag-seed med en vaerdi der ikke er off (flag-flip)";
    }
  }
  return null;
}

const ADD_COLUMN_RE = new RegExp(`^ADD COLUMN IF NOT EXISTS ${IDENT} (.+)$`, "i");
const COLUMN_FORBIDDEN_RE = /\bNOT NULL\b|\bREFERENCES\b|\bCHECK\b|\bUNIQUE\b|\bPRIMARY KEY\b|\bGENERATED\b|\bCONSTRAINT\b/i;

function checkAlterTable(stmt) {
  const m = new RegExp(`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${QUALIFIED} (.+)$`, "i").exec(stmt.code);
  if (!m) return "ALTER der aendrer eksisterende";
  for (const action of splitTopLevel(m[1])) {
    if (/^ADD COLUMN\b/i.test(action) && !/^ADD COLUMN IF NOT EXISTS\b/i.test(action)) {
      return "ADD COLUMN uden IF NOT EXISTS (ikke idempotent)";
    }
    const col = ADD_COLUMN_RE.exec(action);
    if (!col) return "ALTER der aendrer eksisterende";
    if (COLUMN_FORBIDDEN_RE.test(col[1])) return "ny kolonne med NOT NULL/constraint (kun nullable er additiv)";
  }
  return null;
}

/** Én saetning: null = additiv og idempotent, ellers grunden. */
function checkStatement(stmt) {
  const c = stmt.code;
  if (/^(BEGIN|COMMIT|END|START TRANSACTION)( (TRANSACTION|WORK))?$/i.test(c)) return null;
  if (/^SET (LOCAL )?(lock_timeout|statement_timeout) ?(=|TO) ?('§\d+'|\d+)$/i.test(c)) return null;
  if (/^NOTIFY pgrst ?, ?'§\d+'$/i.test(c)) return null;
  if (/^COMMENT ON (TABLE|COLUMN|INDEX) \S+ IS '§\d+'$/i.test(c)) return null;
  if (/^CREATE (UNIQUE )?INDEX\b/i.test(c)) {
    if (/^CREATE UNIQUE\b/i.test(c)) return "UNIQUE-indeks (kan afvise eksisterende/nye raekker)";
    if (/^CREATE INDEX (CONCURRENTLY )?IF NOT EXISTS\b/i.test(c)) return null;
    return "CREATE INDEX uden IF NOT EXISTS (ikke idempotent)";
  }
  if (/^ALTER TABLE\b/i.test(c)) return checkAlterTable(stmt);
  if (/^INSERT\b/i.test(c)) return checkFlagSeed(stmt);
  if (/^CREATE (UNLOGGED )?TABLE\b/i.test(c)) return "ny tabel: grants/RLS er ejerens (DATA_API_GRANTS.md)";
  if (/^CREATE (OR REPLACE )?(FUNCTION|PROCEDURE|TRIGGER|VIEW|MATERIALIZED VIEW|RULE)\b/i.test(c)) {
    return "funktion/trigger/view aendrer adfaerd";
  }
  if (/^ALTER\b/i.test(c)) return "ALTER der aendrer eksisterende";
  return `ukendt SQL-saetning: ${c.slice(0, 40)}`;
}

/**
 * Er migrationen additiv, idempotent og ikke-destruktiv (hard rule 35 (d), #7578)?
 * Fail-closed: tom, ulaeselig eller ukendt SQL er ikke additiv.
 * @param {string} sql
 * @returns {{additive: boolean, reason: string}}
 */
export function analyzeMigrationSql(sql) {
  const statements = splitSqlStatements(sql);
  if (!statements) return { additive: false, reason: "ulaeselig SQL (uafsluttet kommentar/streng)" };
  if (!statements.length) return { additive: false, reason: "tom SQL" };
  const allCode = statements.map((s) => s.code).join(" ; ");
  for (const [re, reason] of DESTRUCTIVE_SQL) {
    if (re.test(allCode)) return { additive: false, reason };
  }
  for (const stmt of statements) {
    const reason = checkStatement(stmt);
    if (reason) return { additive: false, reason };
  }
  return { additive: true, reason: `additiv og idempotent (${statements.length} saetninger)` };
}

function migrationVerdict(path, pr) {
  const entry = (pr?.files ?? []).find((f) => typeof f === "object" && (f?.path ?? f?.filename) === path);
  if (Number(entry?.deletions) > 0) return { additive: false, reason: "eksisterende migration aendret" };
  const sql = pr?.migrationSql?.[path];
  if (typeof sql !== "string") return { additive: false, reason: "SQL ikke hentet" };
  return analyzeMigrationSql(sql);
}

// ── Klassifikationen ───────────────────────────────────────────────────────

/**
 * @param {object} pr
 * @param {string} pr.title
 * @param {string} [pr.body]
 * @param {Array<string|{name:string}>} [pr.labels]
 * @param {Array<string|{path:string}|{filename:string}>} [pr.files]
 * @param {string|{login:string}} [pr.author]
 * @param {number} [pr.number]
 * @param {Record<string, string>} [pr.migrationSql] database/*.sql -> indhold paa head
 * @returns {{category: 'a'|'b'|'c'|'d'|'ejer-go', label: string, reason: string, ownerGo: boolean}}
 */
export function classifyPr(pr) {
  const title = String(pr?.title ?? "");
  const body = String(pr?.body ?? "");
  const labels = labelNames(pr?.labels);
  const files = filePaths(pr?.files);
  const author = authorLogin(pr?.author);
  const text = `${title}\n${body}`;
  const refs = new Set([...issueRefs(text), ...(pr?.number ? [Number(pr.number)] : [])]);

  const done = (category, reason) => ({
    category,
    label: CATEGORY_LABEL[category],
    reason,
    ownerGo: category === CATEGORY.OWNER,
  });

  if (!files.length) return done(CATEGORY.OWNER, "ingen filliste (kan ikke klassificere)");

  // 0) Klaebende ejer-go: en gang ejer-go, altid ejer-go for denne PR.
  if (hasOwnerGoMarker(pr?.comments)) return done(CATEGORY.OWNER, "klaebende: tidligere klassificeret ejer-go (omformulering loefter ikke)");

  // 1) Ejerens roede linjer FOERST: findes en af dem, er intet andet relevant.
  //    Migrationer: kun additive, idempotente slipper forbi (ejer-valg B 4/11, #7578).
  const migrations = files.filter(isMigrationFile);
  for (const m of migrations) {
    const verdict = migrationVerdict(m, pr);
    if (!verdict.additive) return done(CATEGORY.OWNER, `migration: ${m} (${verdict.reason})`);
  }
  if (labels.includes("flag-flip")) return done(CATEGORY.OWNER, "label flag-flip");
  const flagFiles = files.filter((f) => FLAG_FILE_RE.test(f) && !isTestFile(f) && !isDocsFile(f));
  if (flagFiles.length && FLAG_FLIP_RE.test(title)) return done(CATEGORY.OWNER, `flag-flip: ${flagFiles[0]}`);
  if (labels.includes("risk:high")) return done(CATEGORY.OWNER, "label risk:high");
  if (PROD_WRITE_RE.test(title)) return done(CATEGORY.OWNER, "prod-skrivning i titlen");
  const playerText = files.filter(isPlayerTextFile);
  if (playerText.length) return done(CATEGORY.OWNER, `spillertekst: ${playerText[0]}`);
  const ui = files.filter(isFrontendUiFile);
  if (ui.length) return done(CATEGORY.OWNER, `UI: ${ui[0]}`);
  const releaseOps = files.filter(isReleaseOpsFile);
  if (releaseOps.length) return done(CATEGORY.OWNER, `release/deploy/overvaagning: ${releaseOps[0]}`);

  // 2) (c) Dependabot patch/minor.
  const isDependabot = author.startsWith("dependabot") || labels.includes("dependencies");
  if (isDependabot) {
    const kind = semverBumpKind(title);
    const onlyPackageFiles = files.every(isLockfile);
    if (onlyPackageFiles && (kind === "patch" || kind === "minor")) {
      return done(CATEGORY.C_SAFE, `Dependabot ${kind}`);
    }
    return done(CATEGORY.OWNER, kind === "major" ? "Dependabot major" : "Dependabot: ukendt bump eller filer ud over package*.json");
  }

  // 3) (c) docs uden spillertekst · CI/hooks/test-only (kombinationer taeller ogsaa).
  //    (d) det samme + additive migrationer (alle er tjekket i trin 1).
  const nonDocsCiTest = files.filter((f) => !isDocsFile(f) && !isCiOrHooksFile(f) && !isTestFile(f) && !isMigrationFile(f));
  if (!nonDocsCiTest.length) {
    const kinds = [];
    if (migrations.length) kinds.push(`additiv migration: ${migrations.join(", ")}`);
    if (files.some(isDocsFile)) kinds.push("docs uden spillertekst");
    if (files.some(isCiOrHooksFile)) kinds.push("CI/hooks");
    if (files.some(isTestFile)) kinds.push("test-only");
    return done(migrations.length ? CATEGORY.D_ADDITIVE_MIGRATION : CATEGORY.C_SAFE, kinds.join(" + "));
  }
  // Additiv migration sammen med kode: kun den rene form er (d); resten vurderer ejeren.
  if (migrations.length) return done(CATEGORY.OWNER, `additiv migration sammen med kode: ${nonDocsCiTest[0]}`);

  // 4) (b) motor bag slukket race_engine_v4: alle kode-filer under engine/v4.
  const codeFiles = files.filter((f) => !isDocsFile(f) && !isCiOrHooksFile(f) && !isTestFile(f));
  if (codeFiles.length && codeFiles.every(isEngineV4File)) {
    const excepted = ENGINE_EXCEPTION_ISSUES.filter((n) => refs.has(n));
    if (excepted.length) return done(CATEGORY.OWNER, `motor-PR undtaget af hard rule 35 (b): #${excepted[0]} (ejerens maaltal)`);
    return done(CATEGORY.B_ENGINE_V4, `kun backend/lib/engine/v4 (${codeFiles.length} filer)`);
  }

  // 5) (a) brand-fejlrettelse uden ny spillertekst, maalt i prod foer og efter.
  const looksLikeFix = /^(fix|hotfix)(\(|:|!)/i.test(title) || labels.includes("type:bug") || labels.includes("brand");
  if (looksLikeFix) {
    const numberFiles = codeFiles.filter(isPlayerNumberFile);
    if (numberFiles.length) return done(CATEGORY.OWNER, `spillervendte tal: ${numberFiles[0]}`);
    if (!hasProdMeasurement(body)) return done(CATEGORY.OWNER, "fejlrettelse uden prod-maaling foer/efter i body");
    return done(CATEGORY.A_BRAND_FIX, "fix uden spillertekst, prod-maaling i body");
  }

  const first = codeFiles[0] ?? files[0];
  return done(CATEGORY.OWNER, `kode uden for kategorierne: ${first}`);
}

/** Én linje til merge-queue.ps1's oversigt. */
export function formatClassification(result) {
  const tag = result.ownerGo ? "EJER-GO" : `KATEGORI ${result.category}`;
  return `${tag}: ${result.label} [${result.reason}]`;
}

// ── CLI ────────────────────────────────────────────────────────────────────

export function parseCliArgs(argv) {
  const out = { pr: null, repo: DEFAULT_REPO, input: null, json: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === "--pr") out.pr = Number(args.shift());
    else if (a === "--repo") out.repo = args.shift();
    else if (a === "--input") out.input = args.shift();
    else if (a === "--json") out.json = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  if (out.pr === null && !out.input) throw new Error("Angiv --pr <N> eller --input <fil.json>.");
  if (out.pr !== null && (!Number.isInteger(out.pr) || out.pr <= 0)) throw new Error("--pr skal vaere et positivt tal.");
  return out;
}

export function fetchPrFromGh(pr, repo, runGh = defaultRunGh) {
  const json = runGh(["pr", "view", String(pr), "--repo", repo, "--json", "number,title,body,labels,files,author,comments,headRefOid"]);
  return JSON.parse(json);
}

/**
 * Henter migrationernes SQL paa PR'ens head-commit (#7578). En fil der ikke kan
 * hentes (slettet, net, rettigheder) udelades, og classifyPr goer den til ejer-go.
 * @returns {Record<string, string>}
 */
export function fetchMigrationSql(pr, repo, runGh = defaultRunGh) {
  const out = {};
  const ref = String(pr?.headRefOid ?? "");
  if (!/^[0-9a-f]{7,40}$/i.test(ref)) return out;
  for (const path of filePaths(pr?.files).filter(isMigrationFile)) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    try {
      out[path] = runGh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${encoded}?ref=${ref}`]);
    } catch {
      // Udeladt = "SQL ikke hentet" = ejer-go (fail-closed).
    }
  }
  return out;
}

function defaultRunGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
}

export function main(argv = process.argv.slice(2)) {
  const cli = parseCliArgs(argv);
  const pr = cli.input ? JSON.parse(readFileSync(cli.input, "utf8")) : fetchPrFromGh(cli.pr, cli.repo);
  if (!cli.input) pr.migrationSql = fetchMigrationSql(pr, cli.repo);
  const result = classifyPr(pr);
  process.stdout.write(cli.json ? `${JSON.stringify({ number: pr.number ?? cli.pr, ...result })}\n` : `${formatClassification(result)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`merge-queue-classify: ${err.message}\n`);
    process.exitCode = 1;
  }
}
