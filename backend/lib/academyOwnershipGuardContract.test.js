// Forward-guard mod #4213-bug-klassen: ejerskabs-guarden i
// finalize_academy_acquisition bliver løsnet igen af en fremtidig migration.
//
// BAGGRUNDEN. Guarden på rider-update'en var oprindeligt
//     AND (team_id IS NULL OR is_academy = false)
// `is_academy = false`-grenen var tænkt til at et hold kunne flytte sin EGEN
// seniorrytter ind i sit EGET akademi — men den var ikke bundet til holdet.
// Konsekvens: en manager der accepterede et akademitilbud på en rytter der i
// mellemtiden var ejet af et ANDET hold, tog rytteren direkte: uden handel,
// uden betaling til sælgeren og uden ejerskabslog. Målt i prod 25/8: 438
// levende tilbud pegede på ryttere ejet af AI-hold, alle synlige for
// menneskehold. Lukket af 2026-08-28-4213-migrationen med
//     AND (team_id IS NULL OR (team_id = p_team_id AND is_academy = false))
// plus den nye afvisningskode 'rider_owned'.
//
// HVORFOR EN TEST. Funktionen vedligeholdes med CREATE OR REPLACE i nye
// migrationer (2026-06-20 → 2026-07-11 → 2026-07-12 → 2026-07-25 → 2026-08-28
// → 2026-08-31 …). Hver af dem kopierer hele funktionskroppen. Kopieres en
// ældre krop ind, forsvinder guarden lydløst: unit-testene kører mod en
// mock-supabase uden den ægte SQL, og prod er igen åben. Denne test ankrer på
// den SIDSTE definition i database/ (auto-migrate.yml applier filerne i
// `LC_ALL=C sort`-orden, så den sidste fil vinder) og fejler hvis den løse
// form er tilbage.
//
// INVARIANTER (det vi tester):
//   1. Den EFFEKTIVE definition af finalize_academy_acquisition er team-bundet
//      og har 'rider_owned'-koden. Den løse form findes ikke i den.
//   2. Ejerskabs-afvisningen sker FØR debit'en — en afvist optagelse må aldrig
//      koste penge (det omvendte tab af #4213).
//   3. Trigger'en trg_guard_academy_offer_ownership (#4383, bagfra-værnet på
//      enhver skrivevej til riders.team_id) er stadig oprettet af den sidste
//      migration der rører den, som BEFORE UPDATE OF team_id.
//   4. Den spillervendte sti overlever: api.js oversætter 'rider_owned' til en
//      409 (forventet bruger-tilstand, ikke en 500 i Sentry), og beskeden
//      findes på både EN og DA.
//
// AFGRÆNSNING: dette er en TEKST-kontrakt på repoets migrationer, ikke en
// prod-verifikation. Den fanger drift i det vi shipper; den kan ikke se om
// nogen har kørt en ad-hoc CREATE OR REPLACE direkte mod databasen. Post-verify
// mod prod står i #4213's tråd (29/8 + 7/9).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const databaseDir = join(repoRoot, "database");

/** Migrations-filer i den orden auto-migrate.yml applier dem (LC_ALL=C sort). */
function migrationFilesInApplyOrder() {
  return readdirSync(databaseDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Udtræk kroppen af den SIDSTE `CREATE OR REPLACE FUNCTION <name>` i database/.
 * Returnerer { file, body } — body er teksten fra CREATE til og med `$$`-enden.
 */
function lastFunctionDefinition(functionName) {
  const marker = `CREATE OR REPLACE FUNCTION ${functionName}`;
  let found = null;
  for (const file of migrationFilesInApplyOrder()) {
    const sql = readFileSync(join(databaseDir, file), "utf8");
    const start = sql.lastIndexOf(marker);
    if (start === -1) continue;
    // Kroppen er $$-quotet. Find åbnings-$$ efter CREATE og den næste $$ efter den.
    const openDollar = sql.indexOf("$$", start);
    assert.notEqual(openDollar, -1, `${file}: fandt ingen $$-krop til ${functionName}`);
    const closeDollar = sql.indexOf("$$", openDollar + 2);
    assert.notEqual(closeDollar, -1, `${file}: uafsluttet $$-krop i ${functionName}`);
    found = { file, body: sql.slice(start, closeDollar + 2) };
  }
  return found;
}

/** Normalisér whitespace så en reformateret SQL-linje ikke giver falsk fejl. */
function squash(text) {
  return text.replace(/\s+/g, " ");
}

test("#4213: den effektive finalize_academy_acquisition er TEAM-BUNDET og har rider_owned", () => {
  const def = lastFunctionDefinition("finalize_academy_acquisition");
  assert.ok(def, "fandt ingen CREATE OR REPLACE FUNCTION finalize_academy_acquisition i database/*.sql");

  const body = squash(def.body);

  // Den stramme guard SKAL være der.
  assert.ok(
    body.includes("(team_id IS NULL OR (team_id = p_team_id AND is_academy = false))"),
    `${def.file}: ejerskabs-guarden er ikke team-bundet. Forventede ` +
      "'(team_id IS NULL OR (team_id = p_team_id AND is_academy = false))' i rider-update'ens WHERE. " +
      "Kopierede du en ældre funktionskrop ind? Se #4213.",
  );

  // Den LØSE form må ikke være tilbage. Bemærk at den stramme form indeholder
  // 'team_id IS NULL OR' som delstreng, så vi matcher på den fulde løse form.
  assert.ok(
    !body.includes("(team_id IS NULL OR is_academy = false)"),
    `${def.file}: den LØSE guard '(team_id IS NULL OR is_academy = false)' er tilbage. ` +
      "Den lader en manager tage en rytter der er ejet af et andet hold. Se #4213.",
  );

  // Afvisningskoden backend'en oversætter til en præcis spillerbesked.
  assert.ok(
    body.includes("'rider_owned'"),
    `${def.file}: afvisningskoden 'rider_owned' mangler. signAcademyCandidate + api.js afhænger af den.`,
  );
});

test("#4213: ejerskabs-afvisningen sker FØR debit'en — en afvist optagelse koster ikke penge", () => {
  const def = lastFunctionDefinition("finalize_academy_acquisition");
  assert.ok(def, "fandt ingen definition af finalize_academy_acquisition");

  const body = squash(def.body);
  const guardIdx = body.indexOf("(team_id IS NULL OR (team_id = p_team_id AND is_academy = false))");
  const riderOwnedIdx = body.indexOf("'rider_owned'");
  const debitIdx = body.indexOf("SET balance = balance - p_price");

  assert.notEqual(debitIdx, -1, `${def.file}: fandt ingen debit-linje at ordne guarden imod`);
  assert.ok(guardIdx !== -1 && riderOwnedIdx !== -1, `${def.file}: guard/rider_owned mangler`);
  assert.ok(
    guardIdx < debitIdx,
    `${def.file}: rider-update'ens ejerskabs-guard står EFTER balance-debit'en — ` +
      "en afvist optagelse ville koste penge uden at give rytteren.",
  );
  assert.ok(
    riderOwnedIdx < debitIdx,
    `${def.file}: 'rider_owned'-returen står EFTER balance-debit'en — samme tab som ovenfor.`,
  );
});

test("#4213/#4383: trigger'en trg_guard_academy_offer_ownership er stadig BEFORE UPDATE OF team_id på riders", () => {
  const files = migrationFilesInApplyOrder();
  let lastCreate = null;
  for (const file of files) {
    const sql = readFileSync(join(databaseDir, file), "utf8");
    if (!sql.includes("CREATE TRIGGER trg_guard_academy_offer_ownership")) continue;
    const start = sql.indexOf("CREATE TRIGGER trg_guard_academy_offer_ownership");
    lastCreate = { file, stmt: squash(sql.slice(start, start + 400)) };
  }

  assert.ok(
    lastCreate,
    "fandt ingen CREATE TRIGGER trg_guard_academy_offer_ownership i database/*.sql — " +
      "bagfra-værnet mod #4213 er væk. Se #4383.",
  );
  assert.ok(
    /BEFORE UPDATE OF team_id ON riders/i.test(lastCreate.stmt),
    `${lastCreate.file}: trigger'en er ikke længere BEFORE UPDATE OF team_id ON riders — ` +
      "så en rå bulk-UPDATE af ejerskab kan igen løbe forbi et levende akademitilbud.",
  );
  assert.ok(
    /EXECUTE FUNCTION guard_academy_offer_ownership\(\)/i.test(lastCreate.stmt),
    `${lastCreate.file}: trigger'en peger ikke på guard_academy_offer_ownership().`,
  );
});

test("#4213: den spillervendte sti overlever — api.js svarer 409 på rider_owned, og beskeden findes EN+DA", () => {
  const api = readFileSync(join(repoRoot, "backend", "routes", "api.js"), "utf8");
  assert.ok(
    /rider_owned["']\)\s*return res\.status\(409\)/.test(squash(api).replace(/\s+/g, "")) ||
      /if \(msg === "rider_owned"\) return res\.status\(409\)/.test(api),
    "backend/routes/api.js: /academy/sign oversætter ikke længere 'rider_owned' til 409. " +
      "Uden den bliver en forventet bruger-tilstand til en 500 i Sentry. Se #4213.",
  );

  for (const locale of ["en", "da"]) {
    const file = join(repoRoot, "frontend", "public", "locales", locale, "academy.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    const flat = JSON.stringify(json);
    assert.ok(
      flat.includes("riderOwned"),
      `${locale}/academy.json: nøglen 'riderOwned' mangler — spilleren får en rå fejlkode ` +
        "i stedet for en forklaring når et tilbud peger på en rytter der lige nu er ejet. Se #4213.",
    );
  }
});
