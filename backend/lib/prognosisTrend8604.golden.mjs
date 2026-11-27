// #8604 Frossen golden for trend-prognosens kontakt (#7587).
//
// Kører læsestiens fire indgange (estimates, projektion, akademi, scouting-rapport) mod
// en fast verden for hver kontakt-værdi og giver ét sha256-digest pr. værdi. Filen
// importerer KUN moduler, der findes på merge-basen, så samme generator kan køres i en
// read-only checkout af basen. Fixturen (digest fra basen) står i prognosisTrend8604.test.js
// og genereres aldrig med den nye kode.
//
// Kørsel: node backend/lib/prognosisTrend8604.golden.mjs  → JSON { <stage>: <digest> }
//
// Verdenen indeholder rækker i rider_prognosis_trend for egne ryttere: med kontakten
// manglende, "off" eller "beta" må de aldrig nå svaret.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { clearFlagStageCache } from "./featureStage.js";
import {
  buildAcademyFromViews, buildEstimatesFromViews, buildProjectionFromView, buildScoutingReportFromView,
} from "./potentialEstimateRead.js";

export const GOLDEN_FLAG_KEY = "prognosis_trend_8604";
export const GOLDEN_STAGES = Object.freeze(["missing", "off", "beta"]);
export const GOLDEN_TEAM = "team-own";
const OTHER_TEAM = "team-other";
export const GOLDEN_CLOCK = new Date("2026-11-27T10:00:00Z");

const abilitiesAt = (rating, over = {}) => ({ ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((key) => [key, rating])), ...over });

const estimate = (riderId, value, certainty = "fair") => ({
  rider_id: riderId, team_id: GOLDEN_TEAM, value, certainty, previous_value: null, previous_certainty: null, changed_at: null,
});

export function goldenTables(stage) {
  const riders = [
    { id: "young", team_id: GOLDEN_TEAM, is_academy: false, birthdate: "2005-03-14", primary_type: "climber", secondary_type: "gc", best_role_rating: 55, potentiale: 4 },
    { id: "prime", team_id: GOLDEN_TEAM, is_academy: false, birthdate: "1999-07-01", primary_type: "sprinter", secondary_type: null, best_role_rating: 70, potentiale: 3 },
    { id: "veteran", team_id: GOLDEN_TEAM, is_academy: false, birthdate: "1991-01-20", primary_type: "rouleur", secondary_type: null, best_role_rating: 72, potentiale: 3 },
    { id: "youth", team_id: GOLDEN_TEAM, is_academy: true, birthdate: "2009-05-05", primary_type: "puncheur", secondary_type: null, best_role_rating: 30, potentiale: 5 },
    { id: "noest", team_id: GOLDEN_TEAM, is_academy: false, birthdate: "2003-09-09", primary_type: "tt", secondary_type: null, best_role_rating: 50, potentiale: 3 },
    { id: "rival", team_id: OTHER_TEAM, is_academy: false, birthdate: "2002-02-02", primary_type: "climber", secondary_type: null, best_role_rating: 64, potentiale: 4 },
  ];
  const abilities = [
    { rider_id: "young", ...abilitiesAt(55, { climbing: 62 }) },
    { rider_id: "prime", ...abilitiesAt(70, { sprint: 76 }) },
    { rider_id: "veteran", ...abilitiesAt(72) },
    { rider_id: "youth", ...abilitiesAt(30) },
    { rider_id: "noest", ...abilitiesAt(50) },
    { rider_id: "rival", ...abilitiesAt(64) },
  ];
  const history = [];
  for (const [riderId, base] of [["young", 52], ["prime", 69], ["veteran", 73]]) {
    for (const [date, step] of [["2026-10-01", 0], ["2026-10-20", 1], ["2026-11-05", 2], ["2026-11-20", 3]]) {
      history.push({ id: `${riderId}-${date}`, rider_id: riderId, snapshot_date: date, season_number: 6, source: "calendar", abilities: abilitiesAt(base + step) });
    }
  }
  const ticks = [];
  for (let d = 1; d <= 3; d++) {
    ticks.push({ rider_id: "youth", team_id: GOLDEN_TEAM, season_id: "s6", game_day: d, tick_date: `2026-11-2${d}`, settled_at: "2026-11-27T00:00:00Z", report: {} });
  }
  const appConfig = stage === "missing" ? [] : [{ key: GOLDEN_FLAG_KEY, value: stage }];
  return {
    riders,
    rider_potential_estimates: [estimate("young", 74), estimate("prime", 76, "sure"), estimate("veteran", 74, "sure"), estimate("rival", 70)],
    rider_derived_abilities: abilities,
    rider_derived_ability_history: history,
    rider_ability_race_day_history: [],
    training_rider_ticks: ticks,
    seasons: [{ id: "s6", number: 6, status: "active" }, { id: "s5", number: 5, status: "completed" }],
    teams: [{ id: GOLDEN_TEAM, is_ai: false }, { id: OTHER_TEAM, is_ai: false }],
    app_config: appConfig,
    // Trend-rækker, som slukket aldrig må nå svaret.
    rider_prognosis_trend: ["young", "prime", "veteran", "youth", "noest"].map((riderId, i) => ({
      rider_id: riderId, team_id: GOLDEN_TEAM, value: 81 + i, learning: i % 2 === 0, horizon: riderId === "veteran" ? "year" : "top",
    })),
  };
}

/** Fake-klient: projicerer kolonnerne og understøtter læsestiens filtre. */
export function goldenSupabase(tables) {
  const reads = [];
  return {
    reads,
    from(table) {
      const filters = [];
      let columns = "*";
      const project = (row) => (columns === "*"
        ? row
        : Object.fromEntries(columns.split(",").map((c) => c.trim()).filter(Boolean).map((c) => [c, row[c]])));
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row))).map(project);
      const query = {
        select(selected) { columns = selected; reads.push({ table, columns: selected }); return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        gt(column, value) { filters.push((row) => row[column] > value); return query; },
        gte(column, value) { filters.push((row) => row[column] >= value); return query; },
        lt(column, value) { filters.push((row) => row[column] < value); return query; },
        not(column, op, value) { filters.push((row) => !(op === "is" && value === null ? row[column] == null : row[column] === value)); return query; },
        order() { return query; },
        range: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
}

async function runSurfaces(supabase) {
  const ids = ["young", "prime", "veteran", "youth", "noest", "rival"];
  const riders = goldenTables("missing").riders;
  const byId = new Map(riders.map((rider) => [rider.id, rider]));
  const out = {};
  out.estimates = await buildEstimatesFromViews(supabase, { teamId: GOLDEN_TEAM, riderIds: ids, clock: GOLDEN_CLOCK });
  out.projection = {};
  for (const id of ids) {
    out.projection[id] = await buildProjectionFromView(supabase, {
      teamId: GOLDEN_TEAM, rider: byId.get(id), own: byId.get(id).team_id === GOLDEN_TEAM, level: 3, maxLevel: 3, age: 24, clock: GOLDEN_CLOCK,
    });
  }
  out.academy = await buildAcademyFromViews(supabase, {
    teamId: GOLDEN_TEAM, roster: [{ id: "youth", name: "Y" }], intake: [{ riderId: "rival" }], clock: GOLDEN_CLOCK,
  });
  out.report = {};
  for (const id of ["young", "veteran", "rival"]) {
    const rider = byId.get(id);
    const own = rider.team_id === GOLDEN_TEAM;
    out.report[id] = await buildScoutingReportFromView(supabase, {
      teamId: GOLDEN_TEAM, rider, own, level: own ? 3 : 0, maxLevel: 3, looks: 1, age: 24, scout: null,
      generatedAt: GOLDEN_CLOCK.toISOString(), bandScout: null, loadDevelopmentXp: null, clock: GOLDEN_CLOCK,
    });
  }
  return out;
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Svarene for én kontakt-værdi ("missing" = ingen række i app_config). */
export async function goldenSurfaces(stage) {
  clearFlagStageCache();
  const supabase = goldenSupabase(goldenTables(stage));
  return runSurfaces(supabase);
}

export async function goldenDigests(stages = GOLDEN_STAGES) {
  const out = {};
  for (const stage of stages) out[stage] = digest(await goldenSurfaces(stage));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(JSON.stringify(await goldenDigests(), null, 2));
}
