// backend/lib/tierCalendarMaterializer.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec + ejer-billede): bind den rene pipeline
// sammen til en MATERIALISERINGS-PLAN pr. division (tier) og fan-out den IDENTISKE kalender til
// hver LIVE pulje ("Division 3 kører samme løb, parallelt i sine 4 puljer").
//
// Form (ejer-låst): hver division fylder en PRÆCIS game-day-kvote (140/112/84/56) med DE STØRSTE
// løb (prestige), pakket så HVER IRL-dag rammer præcis density (5/4/3/2) stage-events: Grand Tours
// komprimeret som spredt rygrad MED overlap, klassikere fylder op. Hver etape kører i sin banes
// faste tids-slot (div 3 = 12/15/18). Monumenter binding-fri (game_day i højt bånd).
//
// buildTierMaterializationPlan er REN (ingen DB) → testbar. materializeTierCalendars = I/O-wrapper.

import { poolHasCalendar } from "./divisionCalendarGenerator.js";
import { selectTierRaceSet, TIER_GAME_DAY_QUOTA, GRAND_TOUR_MIN_STAGES, TIER_CLASS_WHITELIST } from "./tierRaceSelection.js";
import { packLaneCalendar, MONUMENT_GAMEDAY_BASE } from "./raceCalendarLanePacker.js";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { generateRaceStageProfiles, GENERATOR_VERSION } from "./raceStageProfileGenerator.js";

export { MONUMENT_GAMEDAY_BASE, TIER_CLASS_WHITELIST };

const INSERT_BATCH = 500;

// Tæthed pr. division (= "løbsdage kørt om dagen", ejer-låst). quota = density × realDays.
export const TIER_DENSITY = Object.freeze({ 1: 5, 2: 4, 3: 3, 4: 2 });

// Overlap-cap pr. division (ejer-låst 2026-06-28): max antal FORSKELLIGE løb der må binde en rytter
// samtidig (= samtidige løb pr. in-game-dag). Div 1/2 = 3, Div 3/4 = 2. Adskilt fra tæthed: tætheden
// er pacing (etaper/IRL-dag), cap'en er binding-tryk (forskellige løb/game-dag).
export const TIER_OVERLAP_CAP = Object.freeze({ 1: 3, 2: 3, 3: 2, 4: 2 });

// Etape-tids-slots pr. division: bane k → slots[k] (ejer-låst: div 3 = 12/15/18). Antal slots =
// density, så en dag aldrig har flere etaper end slots.
export const TIER_STAGE_SLOTS = Object.freeze({
  1: ["11:00", "13:00", "15:00", "17:00", "19:00"],
  2: ["12:00", "14:00", "16:00", "18:00"],
  3: ["12:00", "15:00", "18:00"],
  4: ["12:00", "18:00"],
});

function isRealManagerRow(t) {
  return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
}
function editionYearFrom(startDate) {
  if (!startDate) return null;
  const y = Number.parseInt(String(startDate).slice(0, 4), 10);
  return Number.isFinite(y) && y >= 2000 && y <= 2099 ? y : null;
}

// #2251 kalender-invarianter (defense-in-depth oven på selectTierRaceSet's GT-gate):
// (1) GT'er (≥ minStages etaper) må ALDRIG optræde i tier > 1 — spec'ens GT-rygrad hører
//     til Division 1 (to samtidige 21-etapers GT'er i tier 4 kollapsede lav-divisionernes
//     startfelter 5-10/7).
// (2) GT-rygraden må ikke overlappe sig selv (spec: "GT'er lægges spredt og IKKE
//     overlappende hinanden") — målt på game-day-spans.
// Ren + deterministisk; materializeTierCalendars nægter at APPLY'e en tier med brud.
export function detectCalendarViolations({
  tier, placements = [], minStages = GRAND_TOUR_MIN_STAGES,
  catalogById = new Map(), classWhitelist = TIER_CLASS_WHITELIST, usedRaceNamesBeforeTier = new Set(),
} = {}) {
  const violations = [];
  const gtSpans = placements
    .filter((pl) => (pl.stages ?? 1) >= minStages && pl.stagesPlaced?.length)
    .map((pl) => ({
      id: pl.id,
      start: Math.min(...pl.stagesPlaced.map((s) => s.game_day)),
      end: Math.max(...pl.stagesPlaced.map((s) => s.game_day)),
    }));
  if (tier > 1 && gtSpans.length) {
    violations.push(`tier ${tier}: ${gtSpans.length} grand tour(s) in plan — grand tours are only allowed in tier 1 (#2251)`);
  }
  for (let i = 0; i < gtSpans.length; i++) {
    for (let j = i + 1; j < gtSpans.length; j++) {
      const a = gtSpans[i], b = gtSpans[j];
      if (a.start <= b.end && b.start <= a.end) {
        violations.push(`tier ${tier}: grand tour overlap ${a.id} (gd ${a.start}-${a.end}) x ${b.id} (gd ${b.start}-${b.end})`);
      }
    }
  }

  // #2276 invariant 1: klasse-whitelist pr. tier (kaskade) — tier 2+ må ALDRIG få
  // Monuments/GrandTour/OtherWorldTourA, kun de næste klasser nedad.
  const allowed = classWhitelist?.[tier];
  if (Array.isArray(allowed)) {
    const allowedSet = new Set(allowed);
    for (const pl of placements) {
      const cat = catalogById.get(pl.id) || {};
      const raceClass = cat.race_class ?? pl.race_class ?? null;
      if (raceClass != null && !allowedSet.has(raceClass)) {
        violations.push(`tier ${tier}: race ${pl.id} (${cat.name ?? "?"}) has class "${raceClass}" outside whitelist [${allowed.join(", ")}] (#2276)`);
      }
    }
  }

  // #2276 invariant 2: cross-tier dedup — samme løbsnavn må ikke optræde i to tiers i
  // samme sæson. usedRaceNamesBeforeTier = navne allerede brugt af HØJERE tiers i samme plan.
  for (const pl of placements) {
    const cat = catalogById.get(pl.id) || {};
    const name = cat.name ?? pl.name ?? null;
    if (name != null && usedRaceNamesBeforeTier.has(name)) {
      violations.push(`tier ${tier}: race name "${name}" (${pl.id}) already used in a higher tier this season (#2276 cross-tier dedup)`);
    }
  }

  return violations;
}

// #2276 invariant 3: alle puljer i en division skal få IDENTISK kalender (navn, game_day,
// stages)-signatur. Ren assertion-helper — kastes af buildTierMaterializationPlan hvis en
// tier-plans puljer nogensinde afviger (defense-in-depth: poolPlans deles i dag fra samme
// `packed.placements`, så dette bør altid holde — regressions-fanger).
export function detectPoolSignatureMismatch({ tier, pools = [] } = {}) {
  if (pools.length < 2) return [];
  const signatureOf = (pool) => pool.raceRows
    .map((r) => `${r.pool_race_id}:${r.name}:${r.game_day_start}:${r.stages}`)
    .sort()
    .join("|");
  const base = signatureOf(pools[0]);
  const violations = [];
  for (const pool of pools.slice(1)) {
    if (signatureOf(pool) !== base) {
      violations.push(`tier ${tier}: pool ${pool.leagueDivisionId} calendar signature diverges from pool ${pools[0].leagueDivisionId} (#2276 identical-pools invariant)`);
    }
  }
  return violations;
}

/**
 * @param {{ pools, catalog, from?, realDays?, quotas?, density?, slots?, baseSeed? }} args
 * @returns {{ tierPlans: Array<object> }}
 */
export function buildTierMaterializationPlan({
  pools = [],
  catalog = [],
  from = new Date(),
  realDays = 28,
  quotas = TIER_GAME_DAY_QUOTA,
  density = TIER_DENSITY,
  overlapCaps = TIER_OVERLAP_CAP,
  slots = TIER_STAGE_SLOTS,
  baseSeed = 1,
  forceTiers = [],
  classWhitelist = TIER_CLASS_WHITELIST,
  // #2276: navne allerede brugt af ANDRE tiers før dette kald (fx allerede-materialiserede
  // races i DB for tier 1-3, når tier 4 aktiveres i et separat reconcile-kald der ikke ser
  // de andre tiers' selection i hukommelsen). Seedes af materializeTierCalendars.
  usedRaceNames = new Set(),
} = {}) {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const forced = new Set(forceTiers);

  const liveByTier = new Map();
  for (const p of pools) {
    if (!poolHasCalendar(p.tier, p.realManagerCount) && !forced.has(p.tier)) continue;
    if (!liveByTier.has(p.tier)) liveByTier.set(p.tier, []);
    liveByTier.get(p.tier).push(p);
  }

  // Cross-tier dedup: øverste tier vælger først (de største løb), lavere fra resten.
  // usedRaceIds/usedRaceNamesRunning seedes med input (fx allerede-materialiserede tiers i DB)
  // så et enkelt-tier-kald (reconcilePoolCalendarOnActivation) ikke kan gense en navn/id der
  // allerede kører i en anden tier den samme sæson (#2276).
  const usedRaceIds = new Set();
  const usedRaceNamesRunning = new Set(usedRaceNames);
  const tierPlans = [];
  for (const [tier, tierPools] of [...liveByTier.entries()].sort((a, b) => a[0] - b[0])) {
    let availableCatalog = usedRaceIds.size ? catalog.filter((c) => !usedRaceIds.has(c.id)) : catalog;
    if (usedRaceNamesRunning.size) {
      availableCatalog = availableCatalog.filter((c) => !usedRaceNamesRunning.has(c.name));
    }
    const quota = quotas[tier] ?? 0;
    const dens = density[tier] ?? 1;
    const cap = overlapCaps[tier] ?? 2;
    const tierSlots = slots[tier] ?? slots[3];
    const usedRaceNamesBeforeTier = new Set(usedRaceNamesRunning);

    // #2251: GT'er (≥15 etaper) er KUN tilladt i tier 1 (spec'ens GT-rygrad).
    // #2276: klasse-whitelist pr. tier (Monuments/GrandTour/OtherWorldTourA kun tier 1).
    const sel = selectTierRaceSet({
      catalog: availableCatalog, quota, seed: (baseSeed ^ tier) >>> 0,
      allowGrandTours: tier === 1, allowedClasses: classWhitelist?.[tier] ?? null,
    });
    for (const r of sel.stageRaces) { usedRaceIds.add(r.id); if (r.name != null) usedRaceNamesRunning.add(r.name); }
    for (const r of sel.oneDayRaces) { usedRaceIds.add(r.id); if (r.name != null) usedRaceNamesRunning.add(r.name); }

    const packed = packLaneCalendar({ stageRaces: sel.stageRaces, oneDayRaces: sel.oneDayRaces, density: dens, days: realDays, overlapCap: cap, spineMinStages: GRAND_TOUR_MIN_STAGES });
    const { raceUpdates, stageRows } = buildScheduleRows({ placements: packed.placements, from, slots: tierSlots });

    const scheduledForById = new Map(raceUpdates.map((u) => [u.id, u.scheduled_for]));
    // game_day_start = løbets første IRL-dag (real_day), IKKE binding-nøglen (monumenter har bånd).
    const gameDayStartById = new Map();
    for (const pl of packed.placements) gameDayStartById.set(pl.id, Math.min(...pl.stagesPlaced.map((s) => s.real_day)));

    const poolPlans = tierPools.slice().sort((a, b) => a.id - b.id).map((pool) => {
      const raceRows = packed.placements.map((pl) => {
        const cat = catalogById.get(pl.id) || {};
        return {
          pool_race_id: pl.id,
          name: cat.name ?? null,
          race_class: cat.race_class ?? pl.race_class ?? null,
          race_type: cat.race_type ?? (pl.type === "single" ? "single" : "stage_race"),
          stages: pl.stages,
          game_day_start: gameDayStartById.get(pl.id),
          scheduled_for: scheduledForById.get(pl.id) ?? null,
        };
      });
      const poolStageRows = stageRows.map((s) => ({ pool_race_id: s.race_id, stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day }));
      return { leagueDivisionId: pool.id, tier, raceRows, stageRows: poolStageRows };
    });

    const calendarViolations = [
      ...detectCalendarViolations({ tier, placements: packed.placements, catalogById, classWhitelist, usedRaceNamesBeforeTier }),
      ...detectPoolSignatureMismatch({ tier, pools: poolPlans }),
    ];

    tierPlans.push({
      tier, quota, density: dens, overlapCap: cap, calendarViolations,
      totalGameDays: sel.totalGameDays, quotaHit: sel.quotaHit, shortfall: sel.shortfall,
      raceCount: packed.placements.length,
      load: packed.load, emptyDays: packed.emptyDays, underfilledDays: packed.underfilledDays,
      overlapDays: packed.overlapDays, maxOverlap: packed.maxOverlap,
      overlapHistogram: packed.overlapHistogram, timelineLength: packed.timelineLength,
      straddleGameDays: packed.straddleGameDays,
      unplacedStages: packed.unplaced.length, unplacedSingles: packed.leftoverSingles.length,
      pools: poolPlans,
    });
  }

  return { tierPlans };
}

/**
 * I/O-wrapper: byg planen mod live data og (apply) skriv den pr. pulje. dryRun=true → ingen writes.
 * Kræver at season-løb er ryddet først for en ren rebuild.
 */
export async function materializeTierCalendars({
  supabase, seasonId, seasonStartDate = null, from = new Date(),
  baseSeed = 1, tiers = null, forceTiers = [], dryRun = true, log = () => {},
  realDays = 28, quotas = TIER_GAME_DAY_QUOTA,
} = {}) {
  const editionYear = editionYearFrom(seasonStartDate);

  const { data: divisions, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const { data: teams, error: tErr } = await supabase.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const realByDiv = new Map();
  for (const t of teams || []) if (isRealManagerRow(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
  const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

  const { data: catalog, error: cErr } = await supabase.from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages");
  if (cErr) throw new Error(`race_pool: ${cErr.message}`);
  // Seed-nøgle pr. katalog-løb: external_id binder parcours til løbets VIRKELIGE
  // identitet (identisk parcours i en divisions puljer); terrain_archetype driver
  // terrænfordelingen (jf. raceStageProfileGenerator.js).
  const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));

  const { data: existing, error: exErr } = await supabase.from("races").select("league_division_id, pool_race_id, name").eq("season_id", seasonId);
  if (exErr) throw new Error(`races (existing): ${exErr.message}`);
  const existingKey = new Set((existing || []).map((r) => `${r.league_division_id}:${r.pool_race_id}`));

  // #2276: navne allerede materialiseret i ANDRE tiers denne sæson — sikrer cross-tier
  // dedup selv når kun ÉN tier materialiseres i dette kald (reconcilePoolCalendarOnActivation
  // aktiverer typisk kun én pulje/tier ad gangen, uden de andre tiers' selection i hukommelsen).
  const tierByDivisionId = new Map(pools.map((p) => [p.id, p.tier]));
  const targetTiers = new Set(tiers && tiers.length ? tiers : pools.map((p) => p.tier));
  const usedRaceNames = new Set(
    (existing || [])
      .filter((r) => r.name != null && !targetTiers.has(tierByDivisionId.get(r.league_division_id)))
      .map((r) => r.name)
  );

  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog: catalog || [], from, baseSeed, forceTiers, realDays, quotas, usedRaceNames });
  const summary = { dryRun, editionYear, racesInserted: 0, stageProfiles: 0, stageSchedules: 0, tiers: [] };

  for (const tierPlan of tierPlans) {
    if (tiers && !tiers.includes(tierPlan.tier)) continue;
    // #2251: nægt at APPLY'e en plan med kalender-invariant-brud (GT i tier >1 /
    // GT-rygrad-overlap). dryRun må gerne rapportere planen, så bruddene kan inspiceres.
    if (!dryRun && tierPlan.calendarViolations?.length) {
      throw new Error(`calendar invariant violated (apply refused): ${tierPlan.calendarViolations.join(" · ")}`);
    }
    const tLine = {
      tier: tierPlan.tier, quota: tierPlan.quota, totalGameDays: tierPlan.totalGameDays, quotaHit: tierPlan.quotaHit,
      shortfall: tierPlan.shortfall, emptyDays: tierPlan.emptyDays, overlapDays: tierPlan.overlapDays,
      unplacedStages: tierPlan.unplacedStages, unplacedSingles: tierPlan.unplacedSingles,
      calendarViolations: tierPlan.calendarViolations ?? [], pools: [],
    };
    for (const poolPlan of tierPlan.pools) {
      const fresh = poolPlan.raceRows.filter((r) => !existingKey.has(`${poolPlan.leagueDivisionId}:${r.pool_race_id}`));
      const pLine = { pool_id: poolPlan.leagueDivisionId, selected: poolPlan.raceRows.length, fresh: fresh.length, inserted: 0 };
      if (dryRun || fresh.length === 0) { tLine.pools.push(pLine); continue; }

      const toInsert = fresh.map((r) => ({
        season_id: seasonId, league_division_id: poolPlan.leagueDivisionId, pool_race_id: r.pool_race_id,
        name: r.name, race_class: r.race_class, race_type: r.race_type, stages: r.stages,
        edition_year: editionYear, status: "scheduled", game_day_start: r.game_day_start, scheduled_for: r.scheduled_for,
      }));
      const inserted = [];
      for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
        const { data, error } = await supabase.from("races").insert(toInsert.slice(i, i + INSERT_BATCH)).select("id, pool_race_id, name, race_type, stages");
        if (error) throw new Error(`races insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
        inserted.push(...(data || []));
      }
      summary.racesInserted += inserted.length;
      const idByPoolRace = new Map(inserted.map((x) => [x.pool_race_id, x.id]));

      const profileRows = [];
      for (const race of inserted) {
        // external_id (samme parcours i alle puljer) + terrain_archetype (terrænkarakter)
        // + season_id (variation pr. sæson) fra konteksten.
        const seedRace = { ...race, external_id: externalIdByPoolRace.get(race.pool_race_id) ?? null, terrain_archetype: archetypeByPoolRace.get(race.pool_race_id) ?? null, season_id: seasonId };
        for (const p of generateRaceStageProfiles(seedRace)) {
          profileRows.push({ race_id: race.id, stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, demand_vector: p.demand_vector, generator_version: GENERATOR_VERSION, is_manual: false });
        }
      }
      for (let i = 0; i < profileRows.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("race_stage_profiles").insert(profileRows.slice(i, i + INSERT_BATCH));
        if (error) throw new Error(`race_stage_profiles insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
      }
      summary.stageProfiles += profileRows.length;

      const schedRows = poolPlan.stageRows
        .filter((s) => idByPoolRace.has(s.pool_race_id))
        .map((s) => ({ race_id: idByPoolRace.get(s.pool_race_id), stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day }));
      for (let i = 0; i < schedRows.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("race_stage_schedule").insert(schedRows.slice(i, i + INSERT_BATCH));
        if (error) throw new Error(`race_stage_schedule insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
      }
      summary.stageSchedules += schedRows.length;

      pLine.inserted = inserted.length;
      tLine.pools.push(pLine);
      log(`  pulje ${poolPlan.leagueDivisionId} (tier ${tierPlan.tier}): +${inserted.length} løb · ${profileRows.length} profiler · ${schedRows.length} etape-tider`);
    }
    summary.tiers.push(tLine);
  }
  return summary;
}

/**
 * Forward-guard (#2149, jf. .claude/learnings/2026-07-03-ghost-tier4-calendar-cleanup.md):
 * når signup-allokeringen aktiverer en SOVENDE pulje (første ægte manager i en tier 3/4-pulje),
 * bliver poolHasCalendar true — men intet materialiserede historisk kalenderen (kun manuel/
 * seasonTransition-kørsel). Denne reconcile lukker hullet idempotent:
 * - No-op hvis puljen allerede har løb i den aktive sæson (det normale for tier 1/2 + allerede
 *   aktive puljer) — billigt precheck før den tunge materialisering.
 * - Ellers materialiseres KUN den ramte puljes tier (tiers=[tier], ALDRIG forceTiers), fra
 *   næste dags UTC-midnat, så dagens allerede-planlagte afvikling ikke forstyrres.
 * - materializeTierCalendars gater selv på poolHasCalendar + dedup'er mod eksisterende løb,
 *   så et dobbelt-kald (samtidige signups) er harmløst.
 * - Horisonten AFKORTES til de-facto sæson-slut (sidste planlagte etape i den aktive sæson),
 *   så en midt-sæson-aktiveret pulje slutter sin kalender SAMME dag som alle andre divisioner
 *   (ejer-krav 4/7: div 4 — A endte 2/8 mens div 1-3 endte 26/7). Uden eksisterende løb i
 *   sæsonen (helt frisk sæson) bruges materializerens fulde default-horisont.
 */
export async function reconcilePoolCalendarOnActivation({
  supabase, poolId, now = new Date(), materialize = materializeTierCalendars, log = () => {},
} = {}) {
  if (poolId == null) return { skipped: "no-pool" };

  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) return { skipped: "no-active-season" };

  const { data: existingRaces, error: rErr } = await supabase
    .from("races").select("id").eq("season_id", season.id).eq("league_division_id", poolId);
  if (rErr) throw new Error(`races (precheck): ${rErr.message}`);
  if ((existingRaces || []).length > 0) return { skipped: "has-calendar", races: existingRaces.length };

  const { data: division, error: dErr } = await supabase
    .from("league_divisions").select("id, tier").eq("id", poolId).maybeSingle();
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  if (!division) return { skipped: "unknown-pool" };

  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  // De-facto sæson-slut = sidste planlagte etape på tværs af HELE den aktive sæson.
  // Findes den, afkortes horisonten (realDays + kvote = density × dage), så puljens
  // kalender slutter samme dag som de øvrige divisioner. Etaper lægges på from+1..from+realDays.
  const horizon = {};
  const { data: seasonRaces, error: allErr } = await supabase.from("races").select("id").eq("season_id", season.id);
  if (allErr) throw new Error(`races (season horizon): ${allErr.message}`);
  const seasonRaceIds = (seasonRaces || []).map((r) => r.id);
  if (seasonRaceIds.length) {
    const { data: sched, error: schErr } = await supabase
      .from("race_stage_schedule").select("scheduled_at").in("race_id", seasonRaceIds);
    if (schErr) throw new Error(`race_stage_schedule (season horizon): ${schErr.message}`);
    let maxAt = null;
    for (const s of sched || []) {
      const t = Date.parse(s.scheduled_at);
      if (Number.isFinite(t) && (maxAt == null || t > maxAt)) maxAt = t;
    }
    if (maxAt != null) {
      const end = new Date(maxAt);
      const endDayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      const realDays = Math.floor((endDayUtc - from.getTime()) / 86_400_000);
      if (realDays < 1) return { skipped: "season-ending", seasonEnd: end.toISOString() };
      horizon.realDays = realDays;
      // #2251 rod-årsag: denne override erstattede HELE kvote-tabellen med kun den
      // aktiverede tiers kvote → tier 1-3 fik kvote 0 i plan-genberegningen → deres
      // selection blev tom → cross-tier dedup så INGEN optagne løb → tier 4 valgte frit
      // fra hele kataloget (prestige-først = Grand Tours). Merge oven på defaults, så
      // de højere tiers' (ikke-appliede) selections stadig optager deres løb i dedup'en.
      horizon.quotas = { ...TIER_GAME_DAY_QUOTA, [division.tier]: (TIER_DENSITY[division.tier] ?? 1) * realDays };
    }
  }

  const summary = await materialize({
    supabase, seasonId: season.id, seasonStartDate: season.start_date ?? null,
    from, tiers: [division.tier], dryRun: false, log, ...horizon,
  });
  return { skipped: null, poolId, tier: division.tier, from: from.toISOString(), realDays: horizon.realDays ?? null, ...summary };
}
