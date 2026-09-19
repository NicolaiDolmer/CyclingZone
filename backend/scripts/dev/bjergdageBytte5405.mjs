#!/usr/bin/env node
// backend/scripts/dev/bjergdageBytte5405.mjs
//
// #5405 — READ-ONLY undersoegelse: kan hoej-bjergs-andelen (§6b `high_mountain`) i Division 2
// og 3 loeftes ved at BYTTE et bjergrigt etapeloeb fra Division 4's pulje med et ikke-bjergrigt
// loeb af samme klasse og etapeantal fra D3/D2?
//
// Scriptet SKRIVER ALDRIG. Det kalder materializeTierCalendars({ dryRun: true }) praecis som
// buildSeasonCalendar.js' toerkoersel, og koerer derefter hele scorecardet (samme kode som CI).
// Eneste variation mellem scenarier er `archetypeReservations` — den ENE parameter der i
// produktionen afgoer hvilken division der faar et givet bjergrigt etapeloeb (se
// tierRaceSelection.reserveArchetypes + cross-tier-dedup i buildTierMaterializationPlan).
//
// Brug:
//   infisical run --env=prod -- node scripts/dev/bjergdageBytte5405.mjs --season 4 --first-day 2026-09-28
//
// Output er JSON paa stdout (og en kort menneskelig opsummering paa stderr), saa rapport- og
// billed-generatoren kan laese det uden at parse fri tekst.

import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { TIER_ARCHETYPE_RESERVATIONS } from "../../lib/tierCalendarGuarantees.js";
import { resolveCalendarFrom, resolveSeasonWindow, SEASON_RACE_DAYS_DEFAULT } from "../../lib/calendarStartDate.js";
import { quotasForRaceDays, seasonUuid } from "../buildSeasonCalendar.js";
import { scoreCalendarPlan, alleBrud, scorecardGateGroups } from "../../lib/calendarScorecardReport.js";

const argv = process.argv.slice(2);
const argOf = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const seasonNumber = Number(argOf("--season", "4"));
const firstDay = argOf("--first-day", "2026-09-28");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (koer via infisical run --env=prod)");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const from = resolveCalendarFrom({ firstRaceDate: firstDay });
const firstRaceDay = new Date(from.getTime() + 86_400_000).toISOString().slice(0, 10);
const window = resolveSeasonWindow({ firstRaceDay, raceDays: SEASON_RACE_DAYS_DEFAULT[seasonNumber] ?? null });
const realDays = window.raceDays;
const quotas = quotasForRaceDays(realDays);

// Dyb klon + override af reservations-tabellen. Ingen mutation af den frosne original.
function reservationsWith(overrides = {}) {
  const out = {};
  for (const [tier, cfg] of Object.entries(TIER_ARCHETYPE_RESERVATIONS)) out[tier] = { ...cfg };
  for (const [tier, cfg] of Object.entries(overrides)) out[tier] = { ...(out[tier] ?? {}), ...cfg };
  return out;
}

const SCENARIER = [
  { id: "baseline", label: "Udgangspunkt (som S4 bygges i dag)", overrides: {} },
  { id: "K1", label: "K1: et bjergrigt etapeloeb flyttes fra D4 til D3", overrides: { 3: { summit_tour: 4 }, 4: { summit_tour: 1 } } },
  { id: "K2", label: "K2: to bjergrige etapeloeb flyttes fra D4 til D3", overrides: { 3: { summit_tour: 5 }, 4: { summit_tour: 0 } } },
  { id: "K3", label: "K3: et til D3 (fra D4) og et til D2 (fra D1's rest)", overrides: { 2: { summit_tour: 3 }, 3: { summit_tour: 4 }, 4: { summit_tour: 1 } } },
  { id: "K4", label: "K4: kun D2 loeftes, D3 og D4 roeres ikke", overrides: { 2: { summit_tour: 3 } } },
  { id: "K5", label: "K5: D3 +1 uden at D4 giver reservation fra sig", overrides: { 3: { summit_tour: 4 } } },
  { id: "K6", label: "K6: mountain_tour som ekstra kilde i D3", overrides: { 3: { summit_tour: 4, mountain_tour: 1 }, 4: { summit_tour: 1 } } },
];

// Tael hoej-bjerg-etaper pr. loeb ud fra de genererede profiler.
function raceBreakdown(tierPlan, profiles, archetypeByPoolRace) {
  const pool = (tierPlan.pools ?? [])[0] ?? { raceRows: [] };
  return (pool.raceRows ?? []).map((r) => {
    const stages = profiles.get(r.pool_race_id) ?? [];
    const counts = {};
    for (const st of stages) {
      const pt = st?.profile_type ?? st?.stage_type ?? "?";
      counts[pt] = (counts[pt] ?? 0) + 1;
    }
    return {
      name: r.name,
      race_type: r.race_type,
      archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
      stages: stages.length,
      high_mountain: counts.high_mountain ?? 0,
      mountain: counts.mountain ?? 0,
    };
  });
}

async function runScenario(scen) {
  const plan = await materializeTierCalendars({
    supabase, seasonId: seasonUuid(seasonNumber), seasonStartDate: firstRaceDay, from,
    dryRun: true, log: () => {}, realDays, quotas,
    useUniformTierTilt: false,
    archetypeReservations: reservationsWith(scen.overrides),
  });
  const planTiers = plan.planTiers ?? [];
  const profilesByTier = new Map(planTiers.map((t) => [t.tier, t.profilesByPoolRaceId ?? new Map()]));
  const rapport = scoreCalendarPlan({
    tierPlans: planTiers, profilesByTier,
    archetypeByPoolRace: plan.archetypeByPoolRace ?? new Map(),
    firstRaceDay, realDays,
  });
  const gates = scorecardGateGroups(rapport);
  const brud = alleBrud(rapport);

  const tiers = {};
  for (const t of rapport.tiers ?? []) {
    const hm = t.uniform
      ? { antal: t.uniform.counts?.high_mountain ?? 0, pct: t.uniform.pct?.high_mountain ?? 0, raceDays: t.uniform.raceDays ?? 0 }
      : null;
    tiers[t.tier] = {
      loeb: t.løb, etaper: t.etaper, quota: t.quota, totalGameDays: t.totalGameDays, quotaHit: t.quotaHit,
      uniform: t.uniform ?? null,
      uniformViol: t.uniformViol ?? [],
      compositionViol: t.compositionViol ?? [],
      compositionStrictViol: t.compositionStrictViol ?? [],
      coverageViol: t.coverageViol ?? [],
      terrainBandViol: t.terrainBandViol ?? [],
      orderViol: t.orderViol ?? [],
      finaleViol: t.finaleViol ?? [],
      planViolations: t.planViolations ?? [],
      quotaViol: t.quotaViol ?? [],
      monumentGtViol: t.monumentGtViol ?? [],
      minOverlapViol: t.minOverlapViol ?? [],
      gameDayOverlap: t.gameDayOverlap ?? null,
      coverage: t.coverage ?? null,
      composition: t.composition ?? null,
      high_mountain: hm,
    };
  }

  const races = {};
  for (const tp of planTiers) {
    races[tp.tier] = raceBreakdown(tp, profilesByTier.get(tp.tier) ?? new Map(), plan.archetypeByPoolRace ?? new Map());
  }

  return {
    id: scen.id, label: scen.label, overrides: scen.overrides,
    tiers, races,
    saeson: rapport.saeson ?? rapport.season ?? null,
    gates: {
      blocking: gates.blocking ?? [], applyBlocking: gates.applyBlocking ?? [],
      finaleDrift: gates.finaleDrift ?? [], uniformDrift: gates.uniformDrift ?? [],
    },
    brudAntal: Array.isArray(brud) ? brud.length : null,
    brud: Array.isArray(brud) ? brud : [],
  };
}

const resultater = [];
for (const scen of SCENARIER) {
  process.stderr.write(`[${scen.id}] ${scen.label} ...\n`);
  try {
    const res = await runScenario(scen);
    resultater.push(res);
    const linje = [1, 2, 3, 4].map((t) => {
      const u = res.tiers[t]?.high_mountain;
      return u ? `D${t} ${u.pct.toFixed(1)}% (${u.antal}/${u.raceDays})` : `D${t} -`;
    }).join(" · ");
    process.stderr.write(`   ${linje} · blokerende ${res.gates.blocking.length} · apply-blokerende ${res.gates.applyBlocking.length}\n`);
  } catch (err) {
    process.stderr.write(`   FEJL: ${err.message}\n`);
    resultater.push({ id: scen.id, label: scen.label, overrides: scen.overrides, fejl: String(err.message) });
  }
}

console.log(JSON.stringify({ seasonNumber, firstRaceDay, realDays, quotas, resultater }, null, 2));
