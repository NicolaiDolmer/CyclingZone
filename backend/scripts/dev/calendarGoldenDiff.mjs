#!/usr/bin/env node
// backend/scripts/dev/calendarGoldenDiff.mjs
// ============================================================
// #4123 — den gyldne kalender-diff, kørt I HÅNDEN FØR en sæson genereres.
//
// HVAD DEN ER. CI's lib/calendarGoldenSnapshot.test.js svarer ja/nej: "matcher den
// offline kalender den committede gyldne fil?". Dette script svarer på det spørgsmål et
// menneske faktisk skal have svar på inden §2c's ENE regenerering:
//
//   · hvad ændrede sig, pr. division — løb, etaper, antal berørte dage
//   · hvad ændrede sig, pr. løbstype — endagsløb / etapeløb / Grand Tour
//   · hvilke dage ændrede form, og hvilke etaper kom til / faldt væk
//   · brød noget en HÅRD invariant (to GT'er samme dag, GT-loft, GT-spænd,
//     kronologi, tom kalenderdag) — jf. docs/CALENDAR_RULES.md §2/§3/§7
//
// KØRER 100 % OFFLINE. Kataloget er lib/__fixtures__/racePoolCatalog.prod.json (#4121),
// og planen bygges med præcis samme parametre som prod-dry-runnen via
// scripts/dev/lib/s3OfflineCalendarPlan.mjs. Ingen credentials, ingen DB, intet ur —
// den kan køres af hvem som helst, når som helst, uden risiko for at røre prod.
//
// BRUG (fra backend/):
//   node scripts/dev/calendarGoldenDiff.mjs                 # rapport + hård dom
//   node scripts/dev/calendarGoldenDiff.mjs --json          # maskinlæsbar
//   node scripts/dev/calendarGoldenDiff.mjs --fail-on-diff  # også exit 1 ved ren diff
//   node scripts/dev/calendarGoldenDiff.mjs --golden <fil>  # diff mod en anden snapshot
//   node scripts/dev/calendarGoldenDiff.mjs --candidate <fil>  # og/eller en anden kandidat
//   node scripts/dev/calendarGoldenDiff.mjs --profile-model s5 # #6367: S5-sektionen DØMMER
//   node scripts/dev/calendarGoldenDiff.mjs --motor-bench <fil> # #6367: rigtig motor-bench til del (4)
//
// #6367 — S5 BENCHMARK-SEKTIONEN. Rapporten slutter med S5 benchmark-gaten
// (lib/s5BenchmarkGate.js) målt på den offline kalenders etaper: type == B+, matrix,
// Grand Tour-kvoter + ugestruktur, afslutnings-andele og motor-gab mod rigtige Grand Tours.
// Med v5 (default) er sektionen MÅLT, IKKE DØMT: den viser hvor langt v5 er fra S5, uden at
// vælte placerings-gaten. Med --profile-model s5 dømmer den, og rød giver exit 1.
//
// EXIT-KODER. 1 = mindst én HÅRD invariant er brudt (eller --fail-on-diff og diffen er
// ikke tom). 0 = ingen hårde brud. En ren diff ALENE er ikke en fejl: den kan være en
// tilsigtet ændring der mangler en `refreshCalendarGoldenSnapshot.mjs`-kørsel. Det er
// netop dét skel scriptet findes for at gøre synligt — CI-gaten dømmer diffen, mennesket
// dømmer meningen.
//
// Refs #4123 #4121 #4571 #4270
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildCalendarGoldenSnapshot } from "./lib/calendarGoldenSnapshotBuilder.mjs";
import {
  detectHardInvariantBreaches, summarizeGoldenDiff, formatGoldenDiffReport,
} from "./lib/calendarGoldenDiffReport.mjs";
import { buildS3OfflineCalendarPlan, FIXTURE_PATH } from "./lib/s3OfflineCalendarPlan.mjs";
import { generateRaceStageProfiles, balanceFinaleQuotas } from "../../lib/raceStageProfileGenerator.js";
import {
  evaluateS5BenchmarkGate, loadS5Benchmark, loadMotorGapFile, S5_PROFILE_MODEL,
} from "../../lib/s5BenchmarkGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GOLDEN_PATH = join(__dirname, "..", "..", "lib", "__fixtures__", "calendarGoldenSnapshot.s3.json");

/**
 * #6367: den offline kalenders loeb MED etapeprofiler, til S5 benchmark-sektionen.
 * Samme plan som den gyldne snapshot (s3OfflineCalendarPlan.mjs), een repraesentativ
 * pulje pr. division, samme seed-form som materializeren. v5 faar kvote-fordelte finaler
 * (balanceFinaleQuotas) som i prod; S5-modellen vaelger selv inden for matrixen.
 *
 * Kender generatoren ikke `profileModel` endnu (#6359), ignoreres den, og sektionen maaler
 * v5 - hvilket er rigtigt, for det er den kode der ville koere.
 */
export function buildOfflineS5GateRaces({ profileModel = "v5" } = {}) {
  const { tierPlans } = buildS3OfflineCalendarPlan();
  const { catalog } = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const catById = new Map(catalog.map((c) => [c.id, c]));
  const races = [];
  for (const plan of tierPlans) {
    const rows = plan.pools?.[0]?.raceRows ?? [];
    const seeds = rows.map((r) => {
      const c = catById.get(r.pool_race_id) ?? {};
      return {
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: c.external_id ?? null, terrain_archetype: c.terrain_archetype ?? null,
        race_class: r.race_class ?? null, season_id: "golden-offline", season_variant: 0,
      };
    });
    let generated = seeds.map((s) => generateRaceStageProfiles(s, { profileModel }));
    if (profileModel !== S5_PROFILE_MODEL) generated = balanceFinaleQuotas(generated);
    seeds.forEach((s, i) => races.push({ pool_race_id: s.id, name: s.name, race_type: s.race_type, race_class: s.race_class, terrain_archetype: s.terrain_archetype, stages: generated[i] }));
  }
  return races;
}

/**
 * Kører hele diffen mod to snapshots. Ren i forhold til filsystemet — kalderen leverer
 * begge sider, så en test kan injicere en snapshot med en bevidst afvigelse.
 *
 * #6367: `s5Benchmark` = { result, judged } fra evaluateS5BenchmarkGate. Sektionen vises
 * altid naar den er med; den DOEMMER (exit 1 ved roed) kun naar `judged` er sand, dvs. naar
 * kalenderen er genereret med S5-modellen. Placeringen (golden-diffen) og terraenet
 * (benchmarken) er to forskellige spoergsmaal: en v5-kalender er korrekt placeret og
 * samtidig roed mod benchmarken, og det skal kunne laeses uden at CI-gaten falder.
 *
 * @param {{gylden: object, ny: object, failOnDiff?: boolean, s5Benchmark?: {result: object, judged: boolean}|null}} args
 * @returns {{diff: object, hårdeBrud: string[], exitCode: number, rapport: string}}
 */
export function runGoldenDiff({ gylden, ny, failOnDiff = false, s5Benchmark = null } = {}) {
  const diff = summarizeGoldenDiff(gylden, ny);
  const hårdeBrud = detectHardInvariantBreaches(ny);
  const s5Rød = Boolean(s5Benchmark?.judged && s5Benchmark?.result && !s5Benchmark.result.green);
  const exitCode = hårdeBrud.length > 0 || (failOnDiff && !diff.uændret) || s5Rød ? 1 : 0;
  return { diff, hårdeBrud, exitCode, rapport: formatGoldenDiffReport(diff, hårdeBrud, { s5Benchmark }) };
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

// Samme idiom som scripts/dev/calendarScorecard4218.mjs — resolve() på begge sider, så
// Windows-stier (backslashes, drev-bogstav) ikke giver en falsk negativ.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const goldenPath = argOf("--golden") ?? DEFAULT_GOLDEN_PATH;
  const candidatePath = argOf("--candidate");
  const failOnDiff = process.argv.includes("--fail-on-diff");
  const asJson = process.argv.includes("--json");
  // #6367: hvilken profil-model den offline kalenders etaper genereres med til S5
  // benchmark-sektionen. v5 (default) = maalt, ikke doemt; s5 = doemt (exit 1 ved roed).
  const profileModel = argOf("--profile-model") ?? "v5";
  if (!["v5", S5_PROFILE_MODEL].includes(profileModel)) {
    console.error(`--profile-model: "${profileModel}" er hverken v5 eller s5`); process.exit(2);
  }
  const motorPath = argOf("--motor-bench");

  const gylden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const ny = candidatePath ? JSON.parse(readFileSync(candidatePath, "utf8")) : buildCalendarGoldenSnapshot();
  const s5Benchmark = {
    judged: profileModel === S5_PROFILE_MODEL,
    result: evaluateS5BenchmarkGate({
      races: buildOfflineS5GateRaces({ profileModel }),
      benchmark: loadS5Benchmark(),
      motor: motorPath ? loadMotorGapFile(resolve(motorPath)) : loadMotorGapFile(),
    }),
  };

  const { diff, hårdeBrud, exitCode, rapport } = runGoldenDiff({ gylden, ny, failOnDiff, s5Benchmark });

  if (asJson) {
    console.log(JSON.stringify({ diff, hårdeBrud, exitCode, s5Benchmark: { judged: s5Benchmark.judged, green: s5Benchmark.result.green, blocking: s5Benchmark.result.blocking } }, null, 2));
  } else {
    console.log(rapport);
    console.log("");
    if (s5Benchmark.judged && !s5Benchmark.result.green) {
      console.log("❌ S5 BENCHMARK-GATEN ER RØD — S5-kalenderen må IKKE genereres på denne kode (#6367).");
    }
    if (hårdeBrud.length > 0) {
      console.log("❌ HÅRDE INVARIANTER BRUDT — kalenderen må IKKE genereres på denne kode.");
    } else if (!diff.uændret) {
      console.log("⚠ Kalenderen er ÆNDRET mod den gyldne snapshot.");
      console.log("  Tilsigtet? Kør `node scripts/dev/refreshCalendarGoldenSnapshot.mjs` og commit i SAMME PR.");
      console.log("  Ikke tilsigtet? Det er en regression i pakkeren/generatoren — ret koden.");
    } else {
      console.log("✅ Kalenderen er identisk med den gyldne snapshot, og ingen hård invariant er brudt.");
    }
  }

  process.exit(exitCode);
}
