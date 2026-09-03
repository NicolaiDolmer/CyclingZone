#!/usr/bin/env node
// #4123 — genopfrisker lib/__fixtures__/racePoolCatalog.prod.json fra prods
// race_pool + league_divisions. Lukker den navngivne reference fixturens egen "_note"
// har peget på siden #4121, uden at et script bag den fandtes.
//
// HVORFOR DEN FINDES. #4123's CI-invariant-tests og den gyldne kalender-snapshot
// (lib/calendarGoldenSnapshot.test.js) måler mod DENNE fixture. Rører kataloget sig i
// prod (nye løb tilføjet, gamle sat retired_at) uden at fixturen følger med, tester
// gaten en kalender der ikke længere findes — samme fejlklasse #4218/#4215 løb ind i, da
// racePoolCatalog.prod.json (taget 23/8) IKKE indeholdt de 22 løb
// database/2026-08-25-4218-katalog-22-nye-loeb.sql tilføjede to dage senere
// (håndteret separat, se scripts/dev/lib/s3OfflineCalendarPlan.mjs's katalog-udvidelse
// — DEN forsvinder ikke af at fixturen genopfriskes, den skal fjernes for hånd herfra
// den dag migrationen er indarbejdet i et nyt fixture-uddrag).
//
// 100 % READ-ONLY. Ingen writes, ingen mutationer, ingen migrationer. Kun SELECT mod
// race_pool, league_divisions og teams — samme forespørgsel-form som de to VERIFICEREDE,
// kørende read-only scorecards scripts/s3CalendarPackageScorecard.js's loadPoolsAndCatalog()
// og scripts/dryRunTierCalendarBalance.js bruger, ikke gættet nyt for lejligheden. Kolonner
// slået op i database/schema-snapshot.json før dette script blev skrevet.
//
// DETTE SCRIPT ER SKREVET, IKKE KØRT. Hard rule (spawn-prompt #4270): et script der
// rører prod — også read-only — køres af et menneske eller efter eksplicit ejer-go, ikke
// af en agent der bygger CI-forudsætninger. Kør det kun når kataloget faktisk har ændret
// sig, og commit den nye fixture-fil i en SEPARAT PR fra det der udløste behovet, så en
// eventuel drift i selve dump-logikken er let at se i sin egen diff.
//
//   infisical run --env=prod -- node backend/scripts/dev/dumpRacePoolFixture.mjs
//   infisical run --env=prod -- node backend/scripts/dev/dumpRacePoolFixture.mjs --check
//     (--check: dumper til stdout og sammenligner mod den committede fil, exit 1 ved diff,
//      skriver INTET — brug den til at opdage drift uden at committe en ny fixture)
//
// Refs #4123 #4121 #4218

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAllRows } from "../../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (kør via: infisical run --env=prod -- node ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const checkOnly = process.argv.includes("--check");

  // Samme forespørgsel-form som scripts/s3CalendarPackageScorecard.js'
  // loadPoolsAndCatalog() (#3546) og scripts/dryRunTierCalendarBalance.js — begge
  // VERIFICEREDE, kørende read-only prod-scripts, ikke gættet nyt for lejligheden.
  // retired_at IS NULL: pensionerede løb er usynlige for selektionen (#4075).
  const { data: divisions, error: dErr } = await sb.from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const { data: teams, error: tErr } = await sb.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  // fetchAllRows(buildQuery, pageSize): buildQuery tager INGEN argumenter og bygger selv
  // hele queryen. Scriptet kaldte den som fetchAllRows(sb, (query) => ...), altsaa med
  // klienten i buildQuery-pladsen, og doede paa "buildQuery is not a function" foerste gang
  // det faktisk blev koert (#4203, 3/9). Headeren siger det selv: "SKREVET, IKKE KOERT".
  const catalogRows = await fetchAllRows(() =>
    sb
      .from("race_pool")
      .select("id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text")
      .is("retired_at", null)
      .order("id", { ascending: true })
  );

  const isReal = (t) => t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
  const realByDiv = new Map();
  for (const t of teams ?? []) {
    if (isReal(t) && t.league_division_id != null) {
      realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) ?? 0) + 1);
    }
  }
  const pools = (divisions ?? []).map((d) => ({
    id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) ?? 0,
  }));

  const catalog = (catalogRows ?? []).map((r) => ({
    id: r.id,
    external_id: r.external_id,
    terrain_archetype: r.terrain_archetype,
    name: r.name,
    race_class: r.race_class,
    race_type: r.race_type,
    stages: r.stages,
    date_text: r.date_text,
  }));

  const out = {
    _note: "Snapshot af prod-kataloget, hentet read-only. Gør kalender-generatoren koerbar lokalt og i CI UDEN prod-credentials (#4103/#4121). Kilde: race_pool WHERE retired_at IS NULL + league_divisions. Opdateres naar kataloget aendres (scripts/dev/dumpRacePoolFixture.mjs).",
    hentet: new Date().toISOString().slice(0, 10),
    pools,
    catalog,
  };
  const json = `${JSON.stringify(out, null, 2)}\n`;

  if (checkOnly) {
    let gammel;
    try {
      gammel = readFileSync(FIXTURE_PATH, "utf8");
    } catch {
      console.error(`[FEJL] ${FIXTURE_PATH} findes ikke.`);
      process.exit(1);
    }
    // Sammenlign kun pools/catalog, ikke "hentet" (som altid vil afvige, dags dato).
    const gammelUdenDato = JSON.stringify({ ...JSON.parse(gammel), hentet: null });
    const nyUdenDato = JSON.stringify({ ...out, hentet: null });
    if (gammelUdenDato === nyUdenDato) {
      console.log("[ok] Fixturen matcher stadig prod-kataloget.");
      return;
    }
    console.error(`[FEJL] Fixturen er drevet fra prod: ${catalog.length} løb i prod mod ${JSON.parse(gammel).catalog.length} i fixturen.`);
    console.error("Kør uden --check for at genskrive filen, og commit den i sin egen PR.");
    process.exitCode = 1;
    return;
  }

  writeFileSync(FIXTURE_PATH, json, "utf8");
  console.log(`Skrevet: ${FIXTURE_PATH} (${catalog.length} løb, ${pools.length} puljer)`);
}

main().catch((err) => {
  console.error("[fatal]", err?.message ?? err);
  process.exit(1);
});
