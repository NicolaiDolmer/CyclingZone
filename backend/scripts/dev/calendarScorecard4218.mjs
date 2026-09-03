#!/usr/bin/env node
// backend/scripts/dev/calendarScorecard4218.mjs
// #4218 — mål den PLANLAGTE S3-kalender mod ALLE reglerne i docs/CALENDAR_RULES.md.
//
// EJER-KRAV 25/8: "før vi skriver til spillerne skal kalenderen testes og godkendes
// selvfølgelig. Tests i forhold til vores regler. Slutter det for tit nedad? Er der nok
// brostensløb. Hvor mange endagsløb er der, osv?"
//
// TO TILSTANDE (#4573, samme mønster som raceRouteRealismScorecard.js fik i #4219 —
// "mål basen, ikke egen plan"), og de måler IKKE det samme:
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
// Refs #4218 #4217 #4215 #4573 #4176 #3327 #3328 #3469 #3295 #3326 #3371 #4075 #2276

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { arg as devArg } from "./lib/devCalendarArgs.mjs";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import {
  computeTierCoverageStats, detectCoverageViolations,
  TIER_ONE_DAY_SHARE_TARGET, TIER_ONE_DAY_SHARE_MIN, TIER_TERRAIN_FAMILY_MIN,
} from "../../lib/tierCalendarGuarantees.js";
import {
  computeCompositionStats, detectCompositionViolations,
  ACTIVE_TARGET, TIER_COMPOSITION_TOLERANCE_PP, CATEGORY_LABELS,
} from "../../lib/calendarCompositionTargets.js";
import { computeStageOrderStats, detectStageOrderViolations, STAGE_ORDER_TARGETS } from "../../lib/stageOrderMetrics.js";
import {
  computeFinaleStats, mergeFinaleStats, detectFinaleViolations,
  TERRAIN_FINALE_BANDS, OVERALL_FINALE_BAND, FINALE_CLASSES, CLASS_LABELS, MIN_SAMPLE,
} from "../../lib/stageFinaleMetrics.js";
import { detectEmptyCalendarDays } from "../../lib/calendarDailyCoverage.js";
import { augmentWithS3Additions } from "./lib/s3OfflineCalendarPlan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

// #4215: scriptet er en GATE, ikke kun en rapport. Parametre kan overstyres, så samme
// kode kan køre i CI (mod en fast fixture-dato), i sæsonskifte-preflighten (mod den
// kalender der er ved at blive skrevet) og i hånden.
//   --first-day=YYYY-MM-DD   første løbsdag  (default: ejer-beslutningen for S3) — fixture-tilstand
//   --days=N                 antal kalenderdage — fixture-tilstand
//   --now=YYYY-MM-DD         hvad scriptet skal regne som "i dag" — fixture-tilstand
//   --from-fixture           eksplicit fixture-tilstand (samme som ingen flag, #4573)
//   --from-db                læs den skrevne kalender fra DB (kræver env, læser ikke skriver)
//   --season=N               sæsonnummer for --from-db (default: den AKTIVE sæson)
//   --json                   maskinlæsbar rapport i stedet for tabellen
// #4239: delt med de oevrige kalender-dev-scripts, saa der kun er een arg-parser at rette.
const arg = (name, fallback) => devArg(process.argv.slice(2), name, fallback);

// Ejer-beslutning 25/8: fredag 28/8 → søndag 27/9 = 31 kalenderdage, løb hver dag.
const FIRST_RACE_DAY = arg("first-day", "2026-08-28");
const REAL_DAYS = Number(arg("days", "31"));
const LAST_RACE_DAY = new Date(
  Date.parse(`${FIRST_RACE_DAY}T00:00:00Z`) + (REAL_DAYS - 1) * 86_400_000
).toISOString().slice(0, 10);
// `now` injiceres, så scriptet er tidsuafhængigt (27/6-blitz-guarden afviser en
// første løbsdag der ikke er strengt i fremtiden — se raceCalendarLanePackerGtDayCap.test.js).
// Uden det ville CI begynde at fejle på selve dagen den hardkodede dato passeres.
const NOW = new Date(`${arg("now", "2026-08-25")}T12:00:00Z`);
const SEASON_UUID = "00000000-0000-0000-0000-000000000003";

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

const pct = (n) => `${(n * 100).toFixed(1)} %`;
const ok = (b) => (b ? "OK " : "FEJL");

// ---------------------------------------------------------------------------
// Fixture-tilstand: uændret logik fra #4218, kun udtrukket fra main() så begge
// tilstande deler ÉN dømmende krop (computeTierReport) i stedet for to kopier
// der kan drifte fra hinanden (samme læring som #4123 for de 22 nye løb).
// ---------------------------------------------------------------------------
function loadFixtureTierData() {
  const { pools, catalog: baseCatalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { catalog, kollisioner } = augmentWithS3Additions(baseCatalog);

  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, from, realDays: REAL_DAYS, quotas, baseSeed: 1,
  });

  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));

  const tierData = tierPlans.map((plan) => {
    const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };

    // Samme seed-vej som skrive-stien (#3347/#4104): race_class SKAL med, ellers
    // prissættes monumenterne på terrænbåndet i stedet for klassebåndet.
    const profilesByPoolRaceId = new Map();
    for (const r of pool.raceRows ?? []) {
      profilesByPoolRaceId.set(r.pool_race_id, generateRaceStageProfiles({
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
        race_class: r.race_class ?? null,
        season_id: SEASON_UUID, season_variant: 0,
      }));
    }

    return {
      tier: plan.tier,
      raceRows: pool.raceRows ?? [],
      stageRows: pool.stageRows ?? [],
      profilesByPoolRaceId,
      planViolations: plan.calendarViolations ?? [],
      maxOverlap: plan.maxOverlap, overlapCap: plan.overlapCap,
      emptyDays: plan.emptyDays, daysWithoutDecisionCount: plan.daysWithoutDecisionCount,
    };
  });

  return { tierData, kollisioner, første: FIRST_RACE_DAY, sidste: LAST_RACE_DAY, kalenderdage: REAL_DAYS };
}

// ---------------------------------------------------------------------------
// #4573 DB-tilstand: læs races + race_stage_profiles + race_stage_schedule for
// sæsonen (READ-ONLY, ALDRIG writes) og gruppér pr. tier. Samme
// én-pulje-pr-tier-stikprøve som raceRouteRealismScorecard.js's collectSeasonTierRaces*:
// alle puljer i en tier har identisk løbssæt (tierCalendarMaterializer), så én
// repræsentativ division pr. tier er nok og undgår at tælle hvert løb 4× (D1-D4).
//
// Plan-interne invarianter (GT/whitelist/dedup/overlap-cap) rapporteres IKKE — de
// findes allerede som eget prod-niveau (calendarOverlapInvariant.js via
// verify-invariants.js) og skal ikke måles to gange af to forskellige regelsæt der
// kan komme ud af trit (se docs/CALENDAR_RULES.md §9c).
// ---------------------------------------------------------------------------
export async function loadDbTierData({ supabase, seasonNumber }) {
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

  const tierData = [...byTier.keys()].sort((a, b) => a - b).map((tier) => ({
    tier, ...byTier.get(tier),
    planViolations: [], maxOverlap: null, overlapCap: null, emptyDays: null, daysWithoutDecisionCount: null,
  }));

  return {
    tierData, kollisioner: [], unassessed,
    første: String(season.start_date).slice(0, 10),
    sidste: String(season.end_date).slice(0, 10),
    kalenderdage: null, seasonNumber: season.number,
  };
}

// ---------------------------------------------------------------------------
// Fælles dømmende krop — kaldes af BEGGE tilstande med samme inputform. Ren
// funktion (intet fil-/DB-kald), så den kan enhedstestes uafhængigt af tilstand.
// ---------------------------------------------------------------------------
export function computeTierReport({ tier, raceRows, stageRows, profilesByPoolRaceId, planViolations = [], maxOverlap = null, overlapCap = null, emptyDays = null, daysWithoutDecisionCount = null }) {
  const målbare = raceRows.map((r) => ({
    name: r.name,
    race_type: r.race_type,
    terrain_archetype: r.terrain_archetype ?? null,
    stages: profilesByPoolRaceId.get(r.pool_race_id) ?? [],
  }));

  const coverage = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const coverageViol = detectCoverageViolations({ tier, stats: coverage });
  const composition = computeCompositionStats(målbare);
  const compositionRes = detectCompositionViolations({
    stats: composition, label: `tier ${tier}`,
    tolerancePp: TIER_COMPOSITION_TOLERANCE_PP[tier],
  });
  const compositionViol = compositionRes.violations ?? [];
  const order = computeStageOrderStats(målbare);
  const orderViol = detectStageOrderViolations({ stats: order, label: `tier ${tier}` });

  let descent = 0, etaper = 0;
  const finaler = new Map();
  for (const r of målbare) {
    for (const st of r.stages ?? []) {
      etaper += 1;
      const f = st.finale_type ?? "?";
      finaler.set(f, (finaler.get(f) ?? 0) + 1);
      if (f === "descent") descent += 1;
    }
  }
  const finale = computeFinaleStats(målbare);
  const finaleViol = detectFinaleViolations({ stats: finale, label: `tier ${tier}`, strict: false });
  const finaleRaw = detectFinaleViolations({ stats: finale, label: `tier ${tier}`, strict: true });

  return {
    tier,
    løb: raceRows.length,
    etaper,
    løbsdage: new Set(stageRows.map((s) => s.game_day)).size,
    kalenderdage: new Set(stageRows.map((s) => String(s.scheduled_at).slice(0, 10))).size,
    planViolations, maxOverlap, overlapCap, tommeLøbsdage: emptyDays, dageUdenAfgørelse: daysWithoutDecisionCount,
    coverage, coverageViol, composition, compositionViol, order, orderViol,
    finale, finaleViol, finaleRaw,
    descent, descentAndel: etaper ? descent / etaper : 0,
    finaler: Object.fromEntries([...finaler.entries()].sort((a, b) => b[1] - a[1])),
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
      loaded = await loadDbTierData({ supabase, seasonNumber: season });
    } catch (e) {
      console.error(`KUNNE IKKE VURDERES — ${e.message}`);
      process.exitCode = 2;
      return;
    }
  } else {
    loaded = loadFixtureTierData();
  }

  const { tierData, kollisioner, første, sidste, kalenderdage, unassessed = [], seasonNumber } = loaded;

  const rapport = { tilstand: mode, første, sidste, kalenderdage, kollisioner, unassessed, tiers: [] };
  const stageDays = [];
  for (const td of tierData) {
    rapport.tiers.push(computeTierReport(td));
    for (const s of td.stageRows) stageDays.push({ division: td.tier, date: String(s.scheduled_at).slice(0, 10) });
  }

  const dækning = detectEmptyCalendarDays({
    stageDays, from: første, to: sidste, divisions: tierData.map((t) => t.tier),
  });
  rapport.dækning = { ok: dækning.ok, violations: dækning.violations };

  rapport.sæsonFinale = mergeFinaleStats(rapport.tiers.map((t) => t.finale));
  rapport.sæsonFinaleViol = detectFinaleViolations({ stats: rapport.sæsonFinale, label: "sæson", strict: true });

  const bruddene = rapport.tiers.reduce((n, t) =>
    n + t.planViolations.length + t.coverageViol.length + t.compositionViol.length + t.orderViol.length
      + t.finaleViol.length, 0) + rapport.sæsonFinaleViol.length;
  // #2854: rækker der ikke kunne vurderes (kalenderen skrevet, profilerne ikke) må
  // aldrig ligne et grønt scorecard på tomt grundlag — de tæller ikke som "brud" (det
  // er en anden fejlklasse), men gøre gaten grøn er heller ikke retvisende.
  const grønt = bruddene === 0 && dækning.ok && !kollisioner.length && !unassessed.length;

  if (asJson) {
    console.log(JSON.stringify({ ...rapport, seasonNumber, regelbrud: bruddene, ok: grønt }, null, 2));
    process.exitCode = grønt ? 0 : 1;
    return;
  }

  const modeLabel = mode === "db" ? `MOD DB — sæson ${seasonNumber} (races + race_stage_profiles, den skrevne kalender)` : "fixture — pakkerens output";
  console.log(`\nKALENDER SCORECARD (${modeLabel}) — ${første} til ${sidste}${kalenderdage ? ` (${kalenderdage} kalenderdage)` : ""}`);
  if (mode === "fixture") {
    console.log(`Navnekollisioner: ${kollisioner.length ? kollisioner.join(", ") : "ingen"}`);
  }
  if (unassessed.length) {
    console.log(`\n⚠ KUNNE IKKE VURDERES (${unassessed.length}) — kalenderen er skrevet, profilerne er ikke:`);
    for (const u of unassessed) console.log(`     · ${u}`);
  }
  console.log("");

  console.log(`${ok(dækning.ok)} LØB HVER KALENDERDAG (#4218)`);
  for (const v of dækning.violations) console.log(`     ${v}`);

  for (const t of rapport.tiers) {
    console.log(`\n${"─".repeat(72)}\nDIVISION ${t.tier} — ${t.løb} løb, ${t.etaper} etaper, ${t.løbsdage} løbsdage, ${t.kalenderdage} kalenderdage`);

    const share = t.coverage?.oneDayShare ?? 0;
    const målShare = TIER_ONE_DAY_SHARE_TARGET[t.tier], minShare = TIER_ONE_DAY_SHARE_MIN[t.tier];
    console.log(`  ${ok(share >= minShare)} Endagsløb: ${t.coverage?.oneDayRaces ?? "?"} af ${t.løb} = ${pct(share)} (mål ${pct(målShare)}, min ${pct(minShare)})`);

    const fam = t.coverage?.familyCounts ?? {};
    const gulve = TIER_TERRAIN_FAMILY_MIN[t.tier] ?? {};
    const famLinje = Object.keys(gulve).map((f) => {
      const har = fam[f] ?? 0, skal = gulve[f];
      return `${f} ${har}/${skal}${har < skal ? " ✗" : ""}`;
    }).join(" · ");
    console.log(`  ${ok(!Object.keys(gulve).some((f) => (fam[f] ?? 0) < gulve[f]))} Terræn-gulve: ${famLinje}`);

    const c = t.composition?.pct ?? {};
    const komp = Object.keys(ACTIVE_TARGET).filter((k) => ACTIVE_TARGET[k] > 0).map((k) => {
      const har = Number(c[k] ?? 0), mål = ACTIVE_TARGET[k];
      const af = Math.abs(har - mål);
      return `${CATEGORY_LABELS[k] ?? k} ${har.toFixed(0)}/${mål}${af > TIER_COMPOSITION_TOLERANCE_PP[t.tier] ? " ✗" : ""}`;
    }).join(" · ");
    console.log(`  ${ok(t.compositionViol.length === 0)} Komposition (±${TIER_COMPOSITION_TOLERANCE_PP[t.tier]} pp): ${komp}`);

    const finishMountain = t.order?.mountainFinishPct;
    if (Number.isFinite(finishMountain)) {
      console.log(`  ${ok(finishMountain <= STAGE_ORDER_TARGETS.mountain_finish_max_pct)} Etapeløb der slutter på bjerg: ${finishMountain.toFixed(1)} % (maks ${STAGE_ORDER_TARGETS.mountain_finish_max_pct} %) · flad slutning ${(t.order?.flatFinishPct ?? 0).toFixed(1)} % · ITT-slutning ${(t.order?.ittFinishPct ?? 0).toFixed(1)} %`);
    }
    console.log(`  ${ok(t.finaleViol.length === 0)} Finale-bånd pr. terræn (#4272) — slutter nedad i alt: ${t.descent} af ${t.etaper} = ${pct(t.descentAndel)}`);
    for (const p of Object.keys(TERRAIN_FINALE_BANDS)) {
      const slot = t.finale.byProfile?.[p];
      if (!slot?.total) continue;
      const bands = TERRAIN_FINALE_BANDS[p];
      const celler = FINALE_CLASSES
        .filter((c) => bands[c] || slot.pct[c] > 0)
        .map((c) => {
          const [lo, hi] = bands[c] ?? [0, 0];
          const got = slot.pct[c];
          return `${CLASS_LABELS[c]} ${got.toFixed(0)}%${got < lo || got > hi ? `✗[${lo}-${hi}]` : ""}`;
        });
      const lille = slot.total < MIN_SAMPLE ? " (n<min, kun rapport)" : "";
      console.log(`      ${p.padEnd(14)} n=${String(slot.total).padStart(3)}  ${celler.join(" · ")}${lille}`);
    }
    const o = t.finale.overall;
    console.log(`      ${"SAMLET".padEnd(14)} n=${String(t.finale.total).padStart(3)}  ` +
      Object.entries(OVERALL_FINALE_BAND).map(([c, [lo, hi]]) => {
        const got = o.pct[c];
        return `${CLASS_LABELS[c]} ${got.toFixed(1)}%${got < lo || got > hi ? `✗[${lo}-${hi}]` : ""}`;
      }).join(" · ") + ` · ${CLASS_LABELS.tt} ${o.pct.tt.toFixed(1)}%`);
    if (t.finaleRaw.length && !t.finaleViol.length) {
      console.log(`      (${t.finaleRaw.length} afvigelse(r) fra det rå bånd bæres af stikprøve-tillægget — se ✗)`);
    }

    if (mode === "fixture") {
      console.log(`  ${ok((t.maxOverlap ?? 0) <= (t.overlapCap ?? 99))} Samtidige løb pr. løbsdag: maks ${t.maxOverlap} (cap ${t.overlapCap})`);
      console.log(`  ${ok((t.planViolations?.length ?? 0) === 0)} Plan-invarianter (GT, monument, whitelist, dedup): ${t.planViolations.length} brud`);
      for (const v of t.planViolations.slice(0, 5)) console.log(`     ${v}`);
    } else {
      console.log(`  · Overlap-cap + plan-invarianter: IKKE målt her — dækkes af verify-invariants.js / calendarOverlapInvariant.js (§9c)`);
    }
    for (const v of [...t.coverageViol, ...t.compositionViol, ...t.orderViol, ...t.finaleViol].slice(0, 8)) console.log(`     ! ${v}`);
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`${ok(rapport.sæsonFinaleViol.length === 0)} SÆSON-AGGREGAT, finale-bånd uden stikprøve-tillæg (${rapport.sæsonFinale.total} etaper)`);
  for (const v of rapport.sæsonFinaleViol) console.log(`     ! ${v}`);
  console.log(`SAMLET: ${bruddene} regelbrud · dækning ${dækning.ok ? "OK" : "HULLER"} · ${kollisioner.length} navnekollisioner${unassessed.length ? ` · ${unassessed.length} kunne ikke vurderes` : ""}`);
  console.log(grønt
    ? "Kalenderen overholder alle gates i docs/CALENDAR_RULES.md.\n"
    : "Se linjerne markeret FEJL / ! ovenfor.\n");
  process.exitCode = grønt ? 0 : 1;
}

// #4215: exit 1 ved brud, exit 2 ved "kunne ikke vurderes". UDEN dette er scriptet kun
// en rapport nogen skal huske at læse — og præcis dét var problemet: reglerne fandtes,
// men intet stoppede en kalender der brød dem (#4155 brød TIER_OVERLAP_CAP i alle fire
// divisioner uopdaget).
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}
