#!/usr/bin/env node
// check-secdef-revoke-lint.mjs — statisk vagt (#2858): enhver SECURITY DEFINER-
// funktion i en migrationsfil skal i SAMME fil revoke'e EXECUTE fra både `anon`
// og `authenticated`.
//
// ── Hvorfor ──────────────────────────────────────────────────────────────────
//
// Supabase' ALTER DEFAULT PRIVILEGES granter EXECUTE til anon + authenticated
// ved enhver funktions-oprettelse i public, og `REVOKE ALL ... FROM PUBLIC`
// fjerner IKKE de eksplicitte role-grants. En ny SECURITY DEFINER-funktion er
// derfor kaldbar over /rest/v1/rpc/<navn> med den publicerbare anon-nøgle, med
// mindre migrationen eksplicit revoke'r fra rollerne ved navn.
//
// #3765 er det dyre eksempel: migrationsforslaget til apply_race_results_batch
// skrev `REVOKE ALL ... FROM PUBLIC` + `GRANT ... TO service_role` og troede
// dermed den var lukket. Den var kaldbar af anon i ni dage, og funktionen
// sletter + indsætter i race_results.
//
// Dette lint fanger fejlen ved review-tid. Det kan pr. definition kun se filer —
// hånd-anvendt SQL fanges af scripts/security-grants.sql, der spørger databasen.
//
// ── Undtagelser ──────────────────────────────────────────────────────────────
//
// En funktion der BEVIDST skal være klient-kaldbar markeres i filen med:
//
//   -- secdef-lint: allow <funktionsnavn> (<begrundelse>)
//
// Begrundelsen er obligatorisk — det er den der gør undtagelsen reviewbar.
//
// ── Udvidelse #4870 (6/9): kommentarer tæller ikke, og en re-GRANT er et fund ─
//
// To huller lukket efter advisor-gennemgangen i #4870:
//
//  1. KOMMENTERET REVOKE talte som ægte REVOKE. Vagten samlede alle
//     `revoke ...;`-strenge i rå filtekst, så en REVOKE i en "Rollback:"-
//     kommentar — konventionen i næsten hver migration i database/ — kvitterede
//     for et hul der aldrig blev lukket. Målt eksempel:
//     database/2026-09-03-4649-founder-public.sql har PRÆCIS den form (den
//     kørende SQL har kun `GRANT ... TO authenticated;`; REVOKE'en står i
//     rollback-kommentaren) og passerede vagten. Filens tekst maskeres nu for
//     kommentarer (`--` og indlejrede `/* */`) FØR REVOKE/GRANT/CREATE-scanning.
//     Maskeringen bevarer længder, så al index-udregning er uændret; strenge og
//     dollar-quotede funktionskroppe maskeres ikke.
//
//  2. EN EFTERFØLGENDE `GRANT ... TO anon|authenticated` var usynlig. Det er
//     nøjagtig fælden #2327 beskrev: "CREATE OR REPLACE FUNCTION nulstiller ikke
//     grants — et efterfølgende GRANT-statement lægger dem bare oveni." En fil
//     kunne revoke'e korrekt og re-åbne funktionen tre linjer længere nede uden
//     at vagten sagde noget. En GRANT af EXECUTE til anon eller authenticated på
//     en SECURITY DEFINER-funktion i SAMME fil er nu et fund i sig selv —
//     undertrykt af den samme allow-markør, så bevidst klient-kaldbare
//     funktioner stadig kan skrives, bare synligt og med begrundelse.
//
// ── Hvorfor kun ændrede filer spærrer ────────────────────────────────────────
//
// Hele database/ har 27 historiske fund, men den LEVENDE database har kun to
// (målt 14/8 med scripts/security-grants.sql). De historiske filer er altså
// overvejende falske alarmer om faktisk tilstand — deres funktioner er enten
// låst siden, erstattet eller aldrig anvendt som skrevet. Et hårdt gate på hele
// mappen ville derfor være støj fra dag ét, og støj bliver slået fra.
//
// Arbejdsdelingen er i stedet:
//   - dette lint, kun på ÆNDREDE filer → spærrer nye fejl ved review-tid
//   - scripts/security-grants.sql, dagligt mod prod → fanger faktisk tilstand,
//     inklusive hånd-anvendt SQL som ingen fil nogensinde beskrev
//
// Brug:
//   node scripts/check-secdef-revoke-lint.mjs                 # hele database/
//   node scripts/check-secdef-revoke-lint.mjs --json          # maskinlæsbar
//   node scripts/check-secdef-revoke-lint.mjs a.sql b.sql     # kun disse filer (CI-gate)

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DB_DIR = join(REPO_ROOT, "database");

const CREATE_FN =
  /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:([a-z0-9_]+)\.)?([a-z0-9_]+)\s*\(/gi;
// Begrundelsen skal holde sig på én linje og indeholde mindst ét rigtigt tegn.
// `\S` duer ikke som "rigtigt tegn": `)` er også non-whitespace, så en tom
// `()` kunne æde sig frem til næste `)` længere nede i filen og fremstå udfyldt.
const ALLOW_MARKER = /--\s*secdef-lint:\s*allow\s+([a-z0-9_]+)\s*\(([^)\n]*[^)\s\n][^)\n]*)\)/gi;

const DOLLAR_TAG = /^\$[a-z0-9_]*\$/i;

function endOfSingleQuoted(sql, start) {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      // '' er et escapet apostrof inde i strengen, ikke en afslutning.
      if (sql[i + 1] === "'") { i += 2; continue; }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

/**
 * Erstat alt kommentar-indhold med mellemrum (newlines bevares), så en REVOKE
 * eller GRANT i en rollback-kommentar ikke tælles som virkende SQL. Længden er
 * uændret, så index-baseret afgrænsning af funktionskroppe er upåvirket.
 * Strenge og dollar-quotede kroppe springes over — et `--` derinde er data.
 */
export function maskComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    if (two === "/*") {
      // Postgres tillader indlejrede blokkommentarer.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        const pair = sql.slice(j, j + 2);
        if (pair === "/*") { depth++; j += 2; }
        else if (pair === "*/") { depth--; j += 2; }
        else j++;
      }
      out += sql.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
      continue;
    }
    if (sql[i] === "'") {
      const j = endOfSingleQuoted(sql, i);
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    const tag = DOLLAR_TAG.exec(sql.slice(i))?.[0];
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      const j = close === -1 ? sql.length : close + tag.length;
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/**
 * Find dollar-quote-kroppen der hører til en CREATE FUNCTION, så vi kan afgrænse
 * præcis hvilken tekst der tilhører netop den funktion. Uden det ville en
 * SECURITY DEFINER i funktion nr. 2 smitte af på funktion nr. 1.
 */
function bodyEndIndex(sql, fromIndex) {
  const tagMatch = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(sql.slice(fromIndex));
  if (!tagMatch) return -1;
  const tagStart = fromIndex + tagMatch.index + tagMatch[0].length;
  const close = sql.indexOf(tagMatch[1], tagStart);
  return close === -1 ? -1 : close + tagMatch[1].length;
}

export function analyzeSql(rawSql) {
  const allowed = new Map();
  // Allow-markøren ER en kommentar og læses derfor i den RÅ tekst.
  for (const m of rawSql.matchAll(ALLOW_MARKER)) allowed.set(m[1].toLowerCase(), m[2].trim());

  // Alt andet læses i den maskerede tekst: kun SQL der faktisk kører må tælle.
  const sql = maskComments(rawSql);

  // Alle REVOKE/GRANT-sætninger i filen, uanset placering. De står typisk EFTER
  // funktionskroppene, så de kan ikke associeres via tekstregion — vi matcher i
  // stedet på funktionsnavn nævnt i selve sætningen.
  const revokes = [...sql.matchAll(/\brevoke\b[\s\S]*?;/gi)].map((m) => m[0].toLowerCase());
  const grants = [...sql.matchAll(/\bgrant\b[\s\S]*?;/gi)].map((m) => m[0].toLowerCase());

  const findings = [];
  const secdefFunctions = [];

  for (const m of sql.matchAll(CREATE_FN)) {
    const [schema, name] = [m[1]?.toLowerCase(), m[2].toLowerCase()];
    // Kun public — funktioner i auth/storage/extensions ejes ikke af os.
    if (schema && schema !== "public") continue;

    const end = bodyEndIndex(sql, m.index);
    const region = end === -1 ? sql.slice(m.index) : sql.slice(m.index, end);
    if (!/\bsecurity\s+definer\b/i.test(region)) continue;

    secdefFunctions.push(name);
    if (allowed.has(name)) continue;

    const mentioning = revokes.filter((r) => r.includes(name));
    const missingRevokeFor = ["anon", "authenticated"].filter(
      (role) => !mentioning.some((r) => new RegExp(`\\b${role}\\b`).test(r)),
    );
    // Rollen skal stå EFTER `TO`, ellers ville en funktion med "anon" i navnet
    // (eller en revoke-agtig formulering) tælle som en grant.
    const granting = grants.filter((g) => g.includes(name) && /\bexecute\b/.test(g));
    const grantedTo = ["anon", "authenticated"].filter((role) =>
      granting.some((g) => new RegExp(`\\bto\\b[\\s\\S]*\\b${role}\\b`).test(g)),
    );

    if (missingRevokeFor.length || grantedTo.length) {
      findings.push({
        function: name,
        missingRevokeFor,
        ...(grantedTo.length ? { grantedTo } : {}),
      });
    }
  }

  return { secdefFunctions, allowed: [...allowed.keys()], findings };
}

async function sqlFilesIn(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sqlFilesIn(path)));
    else if (entry.name.endsWith(".sql")) out.push(path);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonOut = argv.includes("--json");
  const explicit = argv.filter((a) => !a.startsWith("--") && a.endsWith(".sql"));
  const files = explicit.length
    ? explicit.map((f) => resolve(REPO_ROOT, f)).sort()
    : (await sqlFilesIn(DB_DIR)).sort();

  if (explicit.length === 0 && !jsonOut) {
    console.log("ℹ️  Gennemgår HELE database/ (rapport-tilstand). CI spærrer kun på ændrede filer.");
  }
  const report = [];

  for (const file of files) {
    const sql = await readFile(file, "utf8");
    const { findings } = analyzeSql(sql);
    for (const f of findings) report.push({ file: relative(REPO_ROOT, file), ...f });
  }

  if (jsonOut) {
    console.log(JSON.stringify({ finding_count: report.length, findings: report }, null, 2));
  } else if (report.length === 0) {
    console.log(`✅ secdef-grant-lint: ${files.length} SQL-fil(er) gennemgået, ingen fund.`);
  } else {
    console.error(`❌ secdef-grant-lint: ${report.length} SECURITY DEFINER-funktion(er) åben for klient-roller.\n`);
    for (const f of report) {
      console.error(`  ${f.file}`);
      if (f.missingRevokeFor.length) {
        console.error(`    ${f.function}() — mangler REVOKE EXECUTE FROM ${f.missingRevokeFor.join(", ")}`);
        console.error(
          `    Fix: REVOKE EXECUTE ON FUNCTION public.${f.function}(<args>) FROM ${f.missingRevokeFor.join(", ")};`,
        );
        console.error("    (En REVOKE i en rollback-KOMMENTAR tæller ikke — kun SQL der kører.)");
      }
      if (f.grantedTo?.length) {
        console.error(`    ${f.function}() — GRANT EXECUTE ... TO ${f.grantedTo.join(", ")} i samme fil`);
        console.error(
          "    Fix: fjern grant'en (backend kalder med service_role), eller gør eksponeringen eksplicit:",
        );
      }
      console.error(
        `    Bevidst klient-kaldbar? Skriv: -- secdef-lint: allow ${f.function} (begrundelse)\n`,
      );
    }
    console.error("Baggrund: #2858 (klassen) · #3765 (hændelsen der kostede 9 dages eksponering).");
  }

  process.exit(report.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-secdef-revoke-lint.mjs")) {
  await main();
}
