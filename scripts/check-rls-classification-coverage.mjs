#!/usr/bin/env node
// scripts/check-rls-classification-coverage.mjs
// ============================================================
// Forward-guard: hver tabel der NÆVNES i RLS-klassificeringens grant-tabel
// SKAL også have sin egen klassificerings-overskrift i samme dokument.
//
// Fejlklassen den forebygger (#4440): PR #4439 klassificerede 9 tabeller
// enkeltvis, samlede 66 backup-tabeller i én vurdering - og LISTEDE så 26
// driftstabeller uden at klassificere nogen af dem. Listen så komplet ud.
// Dokumentet sagde "101 tabeller", regnestykket gik op, og alligevel stod 26
// af dem uden en eneste linje om hvem der tilgår dem. Det tog et selvstændigt
// issue at opdage, fordi INTET kobler "tabellen er nævnt" til "tabellen er
// klassificeret". Uden en mekanisk kobling gentager det sig næste gang
// advisor-tallet vokser: nye tabelnavne bliver føjet til oversigten, og den
// enkeltvise gennemgang glider bagud uden at nogen kan se det.
//
// Guarden læser docs/decisions/rls-no-policy-classification.md og kræver:
//   1. Hvert tabelnavn i grant-mønster-tabellen har en `#### `<navn>`` -sektion.
//   2. Hver sådan sektion har mindst én fil:linje-reference ELLER en eksplicit
//      konstatering af at ingen kodesti rører tabellen - begrundelses-kravet
//      fra #528/#4440. En overskrift uden evidens er ikke en klassificering.
//   3. Bucket-regnskabet summer: de tre bucket-tal skal give totalen.
//
// Guarden validerer dokumentets INTERNE konsistens, ikke prod. Den kan derfor
// køre i CI uden DB-adgang. Live-tallet (hvor mange tabeller advisoren faktisk
// rapporterer) hører til security-grants-audit.yml's live-job og til en
// manuel remåling - se "When to re-evaluate" i selve ADR'en.
//
// Usage:
//   node scripts/check-rls-classification-coverage.mjs
//   node scripts/check-rls-classification-coverage.mjs path/to/other.md
//   npm run lint:rls-classification
//
// Exit codes:
//   0 - dokumentet er internt konsistent
//   1 - mindst én nævnt tabel er uklassificeret, ubegrundet, eller summen brister
//   2 - intern fejl (fil mangler, forventet sektion ikke fundet)
//
// Refs #4440 #528.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_DOC = "docs/decisions/rls-no-policy-classification.md";

// Overskriften på grant-mønster-tabellen findes ikke ved fast linjenummer, for
// dokumentet redigeres løbende. Vi finder markdown-tabellen på dens
// kolonneoverskrift i stedet, så guarden overlever omrokeringer.
const GRANT_TABLE_HEADER = /^\|\s*Grant-mønster[^|]*\|\s*Antal\s*\|\s*Tabeller\s*\|/;
const SUM_ROW = /^\|\s*\*\*Sum\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/;
const BUCKET_ROW = /^\|\s*(?!\*\*Sum\*\*)([^|]+?)\s*\|\s*(\d+)\s*\|/;

// En klassificering skal pege på hvem der tilgår tabellen. Enten en konkret
// fil:linje, eller den eksplicitte modsatte konstatering.
const FILE_LINE_REF = /[\w./-]+\.(?:js|jsx|mjs|cjs|ts|tsx|sql):\d+/;
const NO_CODE_PATH = /ingen (?:forekomst|kodesti|klientkode)|læses ikke af nogen kodesti/i;

/** Alle `\`tabelnavn\``-forekomster i en tabelcelle. */
function tableNamesInCell(cell) {
  return [...cell.matchAll(/`([a-z_][a-z0-9_]*)`/g)].map((m) => m[1]);
}

/**
 * Deler dokumentet op i `#### `<navn>`` -sektioner.
 * Returnerer Map(tabelnavn -> sektionens brødtekst).
 */
function parseClassificationSections(lines) {
  const sections = new Map();
  let current = null;
  let buffer = [];
  for (const line of lines) {
    const heading = line.match(/^####\s+`([a-z_][a-z0-9_]*)`/);
    if (heading) {
      if (current) sections.set(current, buffer.join("\n"));
      current = heading[1];
      buffer = [];
      continue;
    }
    // En ny sektion på et højere niveau afslutter den nuværende.
    if (current && /^#{1,3}\s/.test(line)) {
      sections.set(current, buffer.join("\n"));
      current = null;
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) sections.set(current, buffer.join("\n"));
  return sections;
}

/** Læser grant-mønster-tabellen: alle nævnte tabelnavne + bucket-tal. */
function parseGrantTable(lines) {
  const start = lines.findIndex((l) => GRANT_TABLE_HEADER.test(l));
  if (start === -1) {
    throw new Error(
      `grant-mønster-tabellen blev ikke fundet (forventet kolonneoverskrift "| Grant-mønster ... | Antal | Tabeller |"). ` +
        `Er dokumentets struktur ændret, så skal denne guard opdateres med.`,
    );
  }
  const buckets = [];
  // +2: spring kolonneoverskrift og markdown-separatorlinjen over.
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 3) break;
    const count = Number.parseInt(cells[1].trim(), 10);
    if (Number.isNaN(count)) break;
    buckets.push({ label: cells[0].trim(), count, names: tableNamesInCell(cells[2]) });
  }
  return { named: buckets.flatMap((b) => b.names), buckets };
}

/** Læser "Samlet regnskab"-tabellen: bucket-rækker + sum-række. */
function parseLedger(lines) {
  const sumIndex = lines.findIndex((l) => SUM_ROW.test(l));
  if (sumIndex === -1) {
    throw new Error(
      `sum-rækken i "Samlet regnskab" blev ikke fundet (forventet "| **Sum** | **<tal>** | ..."). ` +
        `Er dokumentets struktur ændret, så skal denne guard opdateres med.`,
    );
  }
  const total = Number.parseInt(lines[sumIndex].match(SUM_ROW)[1], 10);
  const parts = [];
  for (let i = sumIndex - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("|")) break;
    const m = line.match(BUCKET_ROW);
    if (!m) continue;
    const count = Number.parseInt(m[2], 10);
    if (Number.isNaN(count)) continue;
    parts.unshift({ label: m[1].trim(), count });
  }
  return { total, parts };
}

export function checkDocument(text) {
  const lines = text.split(/\r?\n/);
  const { named, buckets } = parseGrantTable(lines);
  const sections = parseClassificationSections(lines);
  const ledger = parseLedger(lines);

  const findings = [];

  const unique = [...new Set(named)];
  for (const table of unique) {
    const body = sections.get(table);
    if (body === undefined) {
      findings.push(
        `\`${table}\` er nævnt i grant-tabellen, men har ingen "#### \`${table}\`"-sektion - nævnt, ikke klassificeret.`,
      );
      continue;
    }
    if (!FILE_LINE_REF.test(body) && !NO_CODE_PATH.test(body)) {
      findings.push(
        `\`${table}\` har en sektion uden begrundelse - hverken en fil:linje-reference eller en eksplicit konstatering af at ingen kodesti rører den.`,
      );
    }
  }

  // Antallet i hver grant-bucket skal svare til de tabeller der faktisk står i cellen.
  for (const bucket of buckets) {
    if (bucket.names.length !== bucket.count) {
      findings.push(
        `Grant-bucket "${bucket.label}" siger ${bucket.count} tabeller, men cellen nævner ${bucket.names.length}.`,
      );
    }
  }

  // Samme tabel må ikke stå i to grant-buckets - den har ét grant-mønster.
  const seen = new Set();
  for (const table of named) {
    if (seen.has(table)) {
      findings.push(`\`${table}\` står i mere end én grant-bucket - en tabel har ét grant-mønster.`);
    }
    seen.add(table);
  }

  const ledgerSum = ledger.parts.reduce((acc, p) => acc + p.count, 0);
  if (ledgerSum !== ledger.total) {
    findings.push(
      `"Samlet regnskab" summer ikke: ${ledger.parts.map((p) => p.count).join(" + ")} = ${ledgerSum}, men sum-rækken siger ${ledger.total}.`,
    );
  }

  return { findings, tablesChecked: unique.length, total: ledger.total };
}

function isMain() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

function run() {
  const target = process.argv[2] || DEFAULT_DOC;
  let text;
  try {
    text = readFileSync(target, "utf8");
  } catch (err) {
    process.stderr.write(`check-rls-classification-coverage: kan ikke læse ${target}: ${err.message}\n`);
    process.exit(2);
  }

  const { findings, tablesChecked, total } = checkDocument(text);

  if (findings.length > 0) {
    console.error(`\n❌ RLS-klassificering: ${findings.length} problem(er) i ${target}\n`);
    for (const f of findings) console.error(`  - ${f}`);
    console.error(`
Hvorfor det spærrer:

En tabel der er NÆVNT i klassificeringen uden at være klassificeret ligner
færdigt arbejde og er det ikke. Præcis den fælde kostede #4440: 26 tabeller
stod listet i dokumentet, regnestykket gik op, og ingen af dem havde en linje
om hvem der tilgår dem.

Fix: giv hver nævnt tabel sin egen "#### \`tabelnavn\` - <kategori>"-sektion med
mindst én fil:linje-reference for hvem der læser/skriver den, eller en
eksplicit konstatering af at ingen kodesti rører den.

Refs #4440 #528.
`);
    process.exit(1);
  }

  console.log(
    `\n✅ RLS-klassificering: ${tablesChecked} nævnte tabeller er alle klassificeret og begrundet, regnskabet summer til ${total}.`,
  );
  process.exit(0);
}

if (isMain()) {
  try {
    run();
  } catch (err) {
    process.stderr.write(`check-rls-classification-coverage: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}
