#!/usr/bin/env node
// backend/scripts/dev/calendarScorecard4218.mjs
// #4218 — mål den PLANLAGTE S3-kalender mod ALLE reglerne i docs/CALENDAR_RULES.md.
//
// EJER-KRAV 25/8: "før vi skriver til spillerne skal kalenderen testes og godkendes
// selvfølgelig. Tests i forhold til vores regler. Slutter det for tit nedad? Er der nok
// brostensløb. Hvor mange endagsløb er der, osv?"
//
// 100 % READ-ONLY og uden DB: kører den RENE buildTierMaterializationPlan mod
// lib/__fixtures__/racePoolCatalog.prod.json (snapshot af prods race_pool) og genererer
// etape-profilerne ad SAMME seed-vej som skrive-stien (seedRaceFor → generateRaceStageProfiles,
// #3347/#4104). Tallene beskriver derfor det parcours der VILLE blive skrevet — ikke et nyt træk.
//
// De 22 nye katalog-løb (database/2026-08-25-4218-katalog-22-nye-loeb.sql) lægges oveni
// in-memory, så scorecardet kan køres FØR seed'en er applyet i prod.
//
// #4270: selve MÅLINGEN bor nu i lib/calendarScorecardReport.js, så scripts/buildSeasonCalendar.js's
// dry-run kan score den kalender der faktisk ville blive skrevet mod PRÆCIS samme tærskler.
// Dette script ejer stadig fixture-indlæsningen, S3-defaultene og CLI-kontrakten.
//
// KØRSEL
//   cd backend && node scripts/dev/calendarScorecard4218.mjs
//   cd backend && node scripts/dev/calendarScorecard4218.mjs --json
//
// Refs #4270 #4218 #4217 #4176 #3327 #3328 #3469 #3295 #3326 #3371 #4075 #2276

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { arg as devArg } from "./lib/devCalendarArgs.mjs";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import { scoreCalendarPlan, formatScorecard } from "../../lib/calendarScorecardReport.js";
import { augmentWithS3Additions } from "./lib/s3OfflineCalendarPlan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

// #4215: scriptet er en GATE, ikke kun en rapport. Parametre kan overstyres, så samme
// kode kan køre i CI (mod en fast fixture-dato), i sæsonskifte-preflighten (mod den
// kalender der er ved at blive skrevet) og i hånden.
//   --first-day=YYYY-MM-DD   første løbsdag  (default: ejer-beslutningen for S3)
//   --days=N                 antal kalenderdage
//   --now=YYYY-MM-DD         hvad scriptet skal regne som "i dag"
//   --json                   maskinlæsbar rapport i stedet for tabellen
// EXIT-KODE: 0 = alle gates grønne, 1 = mindst ét brud. Det er dét CI hænger på.
// #4239: delt med de oevrige kalender-dev-scripts, saa der kun er een arg-parser at rette.
const arg = (name, fallback) => devArg(process.argv.slice(2), name, fallback);

// Ejer-beslutning 25/8: fredag 28/8 → søndag 27/9 = 31 kalenderdage, løb hver dag.
const FIRST_RACE_DAY = arg("first-day", "2026-08-28");
const REAL_DAYS = Number(arg("days", "31"));
// `now` injiceres, så scriptet er tidsuafhængigt (27/6-blitz-guarden afviser en
// første løbsdag der ikke er strengt i fremtiden — se raceCalendarLanePackerGtDayCap.test.js).
// Uden det ville CI begynde at fejle på selve dagen den hardkodede dato passeres.
const NOW = new Date(`${arg("now", "2026-08-25")}T12:00:00Z`);
const SEASON_UUID = "00000000-0000-0000-0000-000000000003";

// De 22 nye løb fra database/2026-08-25-4218-katalog-22-nye-loeb.sql.
// #4123: flyttet til scripts/dev/lib/s3OfflineCalendarPlan.mjs, så CI-invariant-testene
// og dette scorecard deler ÉN definition i stedet for to kopier der kan drifte fra
// hinanden. Samme 22 rækker, uændrede — se den fil for baggrunden.

function main() {
  const asJson = process.argv.includes("--json");
  const { pools, catalog: baseCatalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { catalog, kollisioner } = augmentWithS3Additions(baseCatalog);

  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, from, realDays: REAL_DAYS, quotas, baseSeed: 1,
  });

  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));

  // Samme seed-vej som skrive-stien (#3347/#4104): race_class SKAL med, ellers
  // prissættes monumenterne på terrænbåndet i stedet for klassebåndet.
  const profilesByTier = new Map();
  for (const plan of tierPlans) {
    const pool = (plan.pools ?? [])[0] ?? { raceRows: [] };
    const byRace = new Map();
    for (const r of pool.raceRows ?? []) {
      byRace.set(r.pool_race_id, generateRaceStageProfiles({
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
        race_class: r.race_class ?? null,
        season_id: SEASON_UUID, season_variant: 0,
      }));
    }
    profilesByTier.set(plan.tier, byRace);
  }

  const rapport = scoreCalendarPlan({
    tierPlans, profilesByTier, archetypeByPoolRace,
    firstRaceDay: FIRST_RACE_DAY, realDays: REAL_DAYS, kollisioner,
  });

  // Samme dom i begge udgaver — ellers ville --json altid exit'e 0 og gøre gaten
  // usynligt grøn for enhver der bruger den maskinlæsbare sti.
  if (asJson) {
    console.log(JSON.stringify(rapport, null, 2));
    return rapport.ok;
  }

  const katalogLinje = `Katalog: ${baseCatalog.length} + ${catalog.length - baseCatalog.length} nye = ${catalog.length} løb`;
  for (const line of formatScorecard(rapport, { heading: "S3-KALENDER SCORECARD", katalogLinje })) {
    console.log(line);
  }
  return rapport.ok;
}

// #4215: exit 1 ved brud. UDEN den er scriptet kun en rapport nogen skal huske at
// læse — og præcis dét var problemet: reglerne fandtes, men intet stoppede en kalender
// der brød dem (#4155 brød TIER_OVERLAP_CAP i alle fire divisioner uopdaget).
const groent = main();
if (!groent) process.exitCode = 1;
