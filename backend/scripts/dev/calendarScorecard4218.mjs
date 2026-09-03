#!/usr/bin/env node
// backend/scripts/dev/calendarScorecard4218.mjs
// #4218 — mål kalenderen mod ALLE reglerne i docs/CALENDAR_RULES.md.
// Defaultene peger paa den saeson der er ved at blive planlagt (S4 pr. 3/9, se nedenfor).
//
// EJER-KRAV 25/8: "før vi skriver til spillerne skal kalenderen testes og godkendes
// selvfølgelig. Tests i forhold til vores regler. Slutter det for tit nedad? Er der nok
// brostensløb. Hvor mange endagsløb er der, osv?"
//
// #4270: selve MÅLINGEN bor i lib/calendarScorecardReport.js, så CI-scriptet,
// buildSeasonCalendar.js's dry-run og DB-tilstanden nedenfor måler mod PRÆCIS samme
// tærskler. Dette script ejer DATAKILDERNE, S3-defaultene og CLI-kontrakten — aldrig
// en kopi af scoringen.
//
// TO DATAKILDER (#4573, samme mønster som raceRouteRealismScorecard.js fik i #4219 —
// "mål basen, ikke egen plan"), og de svarer IKKE på det samme spørgsmål:
//
//   --from-fixture (DEFAULT, uændret siden #4218): 100 % READ-ONLY og uden DB. Kører
//     den RENE buildTierMaterializationPlan mod lib/__fixtures__/racePoolCatalog.prod.json
//     (snapshot af prods race_pool) og genererer etape-profilerne ad SAMME seed-vej som
//     skrive-stien (seedRaceFor → generateRaceStageProfiles, #3347/#4104). Svarer på
//     "ville pakkeren give en lovlig kalender?". Ingen secrets, kan køre i CI.
//
//   --from-db --season <n>: læser den FAKTISK SKREVNE kalender (races +
//     race_stage_profiles + race_stage_schedule for sæsonen) og scorer DE rækker.
//     Svarer på "er den kalender der står i basen lovlig?" — fanger reparations-
//     scripts og ad-hoc-SQL som fixture-tilstanden aldrig kan se (#4155-klassen: et
//     script kan ændre den LIVE kalender uden at pakker-planen opdager det). Kræver
//     SUPABASE_URL + SUPABASE_SERVICE_KEY. ALDRIG writes. Mangler --season, prøver den
//     AKTIVE sæson (seasons.status='active') via samme lookup som cron-sweeps bruger.
//     Plan-interne invarianter (GT-rygrad/whitelist/dedup/overlap-cap) måles IKKE her —
//     de har allerede deres eget prod-niveau (calendarOverlapInvariant.js via
//     verify-invariants.js, se docs/CALENDAR_RULES.md §9c) og duplikeres bevidst ikke.
//
// De 22 nye katalog-løb (database/2026-08-25-4218-katalog-22-nye-loeb.sql) lægges oveni
// in-memory i fixture-tilstanden, så scorecardet kan køres FØR seed'en er applyet i prod.
// #4123: definitionen bor i scripts/dev/lib/s3OfflineCalendarPlan.mjs, så CI-invariant-
// testene og dette scorecard deler ÉN kopi af de 22 rækker.
//
// KØRSEL
//   cd backend && node scripts/dev/calendarScorecard4218.mjs
//   cd backend && node scripts/dev/calendarScorecard4218.mjs --json
//   cd backend && node scripts/dev/calendarScorecard4218.mjs --from-db --season 3
//   cd backend && node scripts/dev/calendarScorecard4218.mjs --from-db --season 3 --json
//
// EXIT-KODE: 0 = alle gates grønne, 1 = mindst ét brud, 2 = kunne ikke vurderes
// (manglende creds, sæson ikke fundet, DB-fejl — #2854-princippet: manglende evidens
// må aldrig ligne grønt). --from-fixture har aldrig exit 2, den er DB-fri.
//
// Refs #4270 #4218 #4217 #4215 #4573 #4176 #3327 #3328 #3469 #3295 #3326 #3371 #4075 #2276

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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
//   --first-day=YYYY-MM-DD   første løbsdag  (default: ejer-beslutningen for S3) — fixture
//   --days=N                 antal kalenderdage — fixture
//   --now=YYYY-MM-DD         hvad scriptet skal regne som "i dag" — fixture
//   --from-fixture           eksplicit fixture-tilstand (samme som ingen flag, #4573)
//   --from-db                læs den skrevne kalender fra DB (kræver env, læser aldrig andet)
//   --season=N               sæsonnummer for --from-db (default: den AKTIVE sæson)
//   --json                   maskinlæsbar rapport i stedet for tabellen
// EXIT-KODE er dét CI hænger på — se hovedet ovenfor.
// #4239: delt med de oevrige kalender-dev-scripts, saa der kun er een arg-parser at rette.
const arg = (name, fallback) => devArg(process.argv.slice(2), name, fallback);

// #4270 (ejer-beslutning 3/9): defaultene foelger den saeson der er ved at blive PLANLAGT,
// ikke den der allerede koerer. S3's kalender er skrevet og laast (§2c), saa et scorecard
// mod S3's vindue maaler en kalender ingen kan aendre. S4 = mandag 28/9 → soendag 25/10 =
// 28 kalenderdage, loeb hver dag (docs/CALENDAR_RULES.md §2).
//
// Skiftet er ikke kosmetisk: D4's density 2 → 3 goer S3's 31-dages vindue UMULIGT for D4
// (kvote 3 × 31 = 93 mod et katalog-loft paa 96 i D4's klasse-vindue), saa scorecardet ville
// maale tomme kalenderdage der kun findes fordi vi holdt et gammelt vindue fast.
// Tidligere default (S3, ejer-beslutning 25/8): first-day 2026-08-28, days 31, now 2026-08-25.
const FIRST_RACE_DAY = arg("first-day", "2026-09-28");
const REAL_DAYS = Number(arg("days", "28"));
// `now` injiceres, så scriptet er tidsuafhængigt (27/6-blitz-guarden afviser en
// første løbsdag der ikke er strengt i fremtiden — se raceCalendarLanePackerGtDayCap.test.js).
// Uden det ville CI begynde at fejle på selve dagen den hardkodede dato passeres.
const NOW = new Date(`${arg("now", "2026-09-03")}T12:00:00Z`);
const SEASON_UUID = "00000000-0000-0000-0000-000000000004";

// ---------------------------------------------------------------------------
// #4573: mode-parsing som REN funktion, testet uden DB (parseren er det scriptet
// afgør sit blast radius med — en fejlparset "hvilken sæson måler jeg?" er en
// alvorligere fejl end en fejlmålt regel, den er en STILLE fejlmålt regel).
// ---------------------------------------------------------------------------
export function resolveMode(argv = process.argv.slice(2)) {
  const fromDb = argv.includes("--from-db");
  const fromFixture = argv.includes("--from-fixture");
  if (fromDb && fromFixture) {
    throw new Error("--from-fixture og --from-db udelukker hinanden — vælg én tilstand.");
  }
  const seasonRaw = devArg(argv, "season", null);
  let season = null;
  if (seasonRaw != null) {
    season = Number(seasonRaw);
    if (!Number.isInteger(season) || season <= 0) {
      throw new Error(`--season skal være et positivt heltal, fik "${seasonRaw}".`);
    }
  }
  if (!fromDb && season != null) {
    throw new Error("--season giver kun mening sammen med --from-db.");
  }
  return { mode: fromDb ? "db" : "fixture", season, asJson: argv.includes("--json") };
}

// ---------------------------------------------------------------------------
// Fixture-kilden: uændret logik fra #4218/#4270 — pakkerens tierPlans + profilerne
// fra SAMME seed-vej som skrive-stien, videregivet råt til scoreCalendarPlan.
// ---------------------------------------------------------------------------
export function loadFixtureCalendar() {
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

  return {
    tierPlans, profilesByTier, archetypeByPoolRace, kollisioner,
    firstRaceDay: FIRST_RACE_DAY, realDays: REAL_DAYS,
    katalogLinje: `Katalog: ${baseCatalog.length} + ${catalog.length - baseCatalog.length} nye = ${catalog.length} løb`,
  };
}

// ---------------------------------------------------------------------------
// #4573 DB-kilden: læs races + race_stage_profiles + race_stage_schedule for
// sæsonen (READ-ONLY, ALDRIG writes) og pak rækkerne til PRÆCIS den tierPlan-form
// scoreCalendarPlan allerede tager. Derfor findes der ingen anden scoringskode her:
// begge tilstande ender i lib/calendarScorecardReport.js.
//
// Samme én-pulje-pr-tier-stikprøve som raceRouteRealismScorecard.js's
// collectSeasonTierRaces*: alle puljer i en tier har identisk løbssæt
// (tierCalendarMaterializer), så én repræsentativ division pr. tier er nok og undgår
// at tælle hvert løb 4× (D1-D4).
//
// Plan-interne felter (calendarViolations/maxOverlap/overlapCap/emptyDays) sættes
// bevidst til null: de kan ikke udledes af de skrevne rækker, og de har allerede eget
// prod-niveau (calendarOverlapInvariant.js via verify-invariants.js). `tilstand: "db"`
// får rapporten til at SIGE det i stedet for at printe et falsk grønt flueben.
// ---------------------------------------------------------------------------
export async function loadDbCalendar({ supabase, seasonNumber }) {
  const { fetchAllRows } = await import("../../lib/supabasePagination.js");

  let season;
  if (seasonNumber != null) {
    const { data, error } = await supabase.from("seasons").select("id, number, start_date, end_date").eq("number", seasonNumber).maybeSingle();
    if (error) throw new Error(`seasons: ${error.message}`);
    season = data;
  } else {
    const { loadSingleActiveSeason } = await import("../../lib/activeSeasonLookup.js");
    season = await loadSingleActiveSeason(supabase, { select: "id, number, start_date, end_date", tag: "calendar-scorecard-4573" });
  }
  if (!season) throw new Error(seasonNumber != null ? `Sæson ${seasonNumber} ikke fundet.` : "Ingen aktiv sæson fundet (seasons.status='active').");

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  if (!divisions.length) throw new Error("Ingen league_divisions fundet.");
  const tierByDiv = new Map(divisions.map((d) => [d.id, d.tier]));
  // Én pulje pr. tier (laveste div-id) — samme stikprøve-mønster som #4219.
  const samplePools = new Set();
  const onePoolByTier = new Map();
  for (const d of [...divisions].sort((a, b) => a.id - b.id)) {
    if (!onePoolByTier.has(d.tier)) { onePoolByTier.set(d.tier, d.id); samplePools.add(d.id); }
  }

  const allRaces = await fetchAllRows(() =>
    supabase.from("races").select("id, name, race_type, race_class, stages, pool_race_id, league_division_id").eq("season_id", season.id).order("id"));
  const races = allRaces.filter((r) => samplePools.has(r.league_division_id));
  if (!races.length) throw new Error(`Sæson ${season.number}: ingen løb fundet i de stikprøvede divisioner — kalenderen er endnu ikke skrevet.`);
  const raceIds = new Set(races.map((r) => r.id));

  // #4290-læring (raceRouteRealismScorecard.js): fetchAllRows ELLER filtrér EFTER
  // hentning — et race_id-filter med hundredvis af rækker rammer PostgREST's
  // URL-længdegrænse før 1000-rows-loftet. Samme risiko her: S3 har 1.239 etaper.
  const allProfiles = await fetchAllRows(() =>
    supabase.from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, distance_km, elevation_gain_m, climbs, sprints")
      .order("race_id").order("stage_number"));
  const profilesByRaceId = new Map();
  for (const p of allProfiles) {
    if (!raceIds.has(p.race_id)) continue;
    if (!profilesByRaceId.has(p.race_id)) profilesByRaceId.set(p.race_id, []);
    profilesByRaceId.get(p.race_id).push(p);
  }
  for (const list of profilesByRaceId.values()) list.sort((a, b) => a.stage_number - b.stage_number);

  const allSchedule = await fetchAllRows(() =>
    supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at, game_day").order("race_id").order("stage_number"));
  const scheduleByRaceId = new Map();
  for (const s of allSchedule) {
    if (!raceIds.has(s.race_id)) continue;
    if (!scheduleByRaceId.has(s.race_id)) scheduleByRaceId.set(s.race_id, []);
    scheduleByRaceId.get(s.race_id).push(s);
  }

  const byTier = new Map();
  const unassessed = [];
  for (const r of races) {
    const tier = tierByDiv.get(r.league_division_id);
    if (!byTier.has(tier)) byTier.set(tier, { raceRows: [], stageRows: [], profilesByPoolRaceId: new Map() });
    const bucket = byTier.get(tier);
    const profiles = profilesByRaceId.get(r.id) ?? [];
    // #2854-princippet: et løb uden profil-rækker er IKKE nul etaper. Det er fravær
    // af evidens (kalenderen er skrevet, profilerne er ikke) — bogføres, tælles ikke
    // som et lovligt endagsløb.
    if (!profiles.length) { unassessed.push(`${r.name ?? r.id} (tier ${tier}): ingen race_stage_profiles-rækker`); continue; }
    // Genbrug pool_race_id som nøgle, så computeTierCoverageStats (som slår op på
    // r.pool_race_id) virker uændret i begge tilstande.
    bucket.raceRows.push(r);
    bucket.profilesByPoolRaceId.set(r.pool_race_id, profiles);
    for (const s of scheduleByRaceId.get(r.id) ?? []) bucket.stageRows.push(s);
  }

  const tierPlans = [];
  const profilesByTier = new Map();
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const bucket = byTier.get(tier);
    tierPlans.push({
      tier,
      pools: [{ raceRows: bucket.raceRows, stageRows: bucket.stageRows }],
      quota: null, totalGameDays: null, quotaHit: null, shortfall: 0,
      calendarViolations: [], maxOverlap: null, overlapCap: null,
      emptyDays: null, daysWithoutDecisionCount: null,
    });
    profilesByTier.set(tier, bucket.profilesByPoolRaceId);
  }

  const firstRaceDay = String(season.start_date).slice(0, 10);
  const lastRaceDay = String(season.end_date).slice(0, 10);
  // scoreCalendarPlan udleder sidste dag af (firstRaceDay + realDays - 1); sæsonens
  // egne datoer er sandheden her, så længden regnes tilbage fra dem i stedet for at
  // arve S3's 31 som konstant (§1b's tre uenige kvote-tal kom af præcis dét).
  const realDays = Math.round(
    (Date.parse(`${lastRaceDay}T12:00:00Z`) - Date.parse(`${firstRaceDay}T12:00:00Z`)) / 86_400_000
  ) + 1;

  return {
    tierPlans, profilesByTier,
    // terrain_archetype bor på race_pool, ikke på races. Feltet indgår hverken i en dom
    // eller i den printede rapport (kun stageOrderMetrics' archetypeCounts), så DB-stien
    // henter det ikke og køber sig fri af en ekstra query og dens fejl-flade.
    archetypeByPoolRace: new Map(),
    kollisioner: [], unassessed,
    firstRaceDay, realDays, seasonNumber: season.number,
  };
}

async function main() {
  let mode, season, asJson;
  try {
    ({ mode, season, asJson } = resolveMode());
  } catch (e) {
    console.error(`Ugyldige flag — ${e.message}`);
    process.exitCode = 1;
    return;
  }

  let loaded;
  if (mode === "db") {
    // dotenv FØR vi læser process.env: i CI kommer creds fra secrets (allerede i env),
    // men i hånden (som ejer-kørslen mod prod, #4573-PR-body) ligger de kun i
    // backend/.env — læses den for sent, rapporterer scriptet fejlagtigt "mangler".
    const dotenv = (await import("dotenv")).default;
    dotenv.config({ path: join(__dirname, "..", "..", ".env"), quiet: true });
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error("KUNNE IKKE VURDERES — SUPABASE_URL/SUPABASE_SERVICE_KEY mangler (--from-db kræver læse-adgang).");
      process.exitCode = 2;
      return;
    }
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    try {
      loaded = await loadDbCalendar({ supabase, seasonNumber: season });
    } catch (e) {
      console.error(`KUNNE IKKE VURDERES — ${e.message}`);
      process.exitCode = 2;
      return;
    }
  } else {
    loaded = loadFixtureCalendar();
  }

  // ÉN scoringsvej for begge kilder (#4270). Alt hvad kilderne må bestemme er HVILKE
  // rækker der måles — aldrig hvordan de dømmes.
  const rapport = scoreCalendarPlan({
    tierPlans: loaded.tierPlans,
    profilesByTier: loaded.profilesByTier,
    archetypeByPoolRace: loaded.archetypeByPoolRace,
    firstRaceDay: loaded.firstRaceDay,
    realDays: loaded.realDays,
    kollisioner: loaded.kollisioner,
    tilstand: mode === "db" ? "db" : "plan",
    unassessed: loaded.unassessed ?? [],
  });
  if (mode === "db") rapport.seasonNumber = loaded.seasonNumber;

  // Samme dom i begge udgaver — ellers ville --json altid exit'e 0 og gøre gaten
  // usynligt grøn for enhver der bruger den maskinlæsbare sti.
  if (asJson) {
    console.log(JSON.stringify(rapport, null, 2));
    return rapport.ok;
  }

  const heading = mode === "db"
    ? `KALENDER-SCORECARD MOD DB — sæson ${loaded.seasonNumber} (races + race_stage_profiles, den skrevne kalender)`
    : "S3-KALENDER SCORECARD";
  for (const line of formatScorecard(rapport, { heading, katalogLinje: loaded.katalogLinje ?? null })) {
    console.log(line);
  }
  return rapport.ok;
}

// #4215: exit 1 ved brud, exit 2 ved "kunne ikke vurderes" (sat i main). UDEN dette er
// scriptet kun en rapport nogen skal huske at læse — og præcis dét var problemet:
// reglerne fandtes, men intet stoppede en kalender der brød dem (#4155 brød
// TIER_OVERLAP_CAP i alle fire divisioner uopdaget).
// #4573: guarden er nødvendig fordi testfilen IMPORTERER modulet — uden den ville
// hver import køre hele scorecardet (og i db-tilstand ramme DB'en).
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const groent = await main();
  // `groent === undefined` betyder at main() allerede har sat exit 1/2 selv.
  if (groent === false) process.exitCode = 1;
}
