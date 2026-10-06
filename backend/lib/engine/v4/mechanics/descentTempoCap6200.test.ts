// backend/lib/engine/v4/mechanics/descentTempoCap6200.test.ts
// #6200 (ejerens regel, laast 5/10): under orders_gc_v3 maa en nedkoersel mod
// maal hoejst lukke finishDescentMaxSecondsPerKm pr. km og hoejst
// finishDescentMaxGapShare af hullet for nr. 10, maalt fra sidste top til maal.
//
// Fejlen: segmentLoop's gap-bogfoering (4a) lukkede hullet med tempo-tikket FOER
// nedkoerselshooket koerte, og hooksene regnede derefter loftet fra hullet EFTER
// tempo-tikket. Saa kunne tempo-tik + hooks tilsammen lukke mere end loftet.
// Rettelsen: paa nedkoerslen mod maal kan tempo-tikket kun aabne et hul.
//
// Testen koerer hele etapen gennem simulateStageV4 med alle live-hooks og
// maaler som scorecardet (scripts/dev/timeModel6199.mjs, descentFinaleStats):
// hullet ved toppen = rytterens gruppes gap i snapshottet ved sidste top,
// hullet ved maal = rytterens tid minus vinderens.
//
// Tolerance: TOLERANCE_SECONDS daekker afrunding, ikke motor-slaek. Gaps
// afrundes til 0,01 s i hvert led (round2 i mechanics/timeModel.ts), og
// resultat-tider kan afrundes til hele sekunder; 1 s er derfor den mindste
// tolerance der er robust over for afrunding paa baade top- og maal-siden.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { TIME_MODEL_V3_TUNING } from "./timeModel.ts";
import type { AbilityKey, Entrant, RiderRole, RouteV2, RulesRevision, Segment, StageInput, StageOutput } from "../types.ts";

const TOLERANCE_SECONDS = 1;

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** 8 hold a 5 ryttere med spredte evner (deterministisk), saa splits og nedkoerselsangreb opstaar. */
function field(): Entrant[] {
  const out: Entrant[] = [];
  for (let team = 0; team < 8; team++) {
    for (let r = 0; r < 5; r++) {
      const i = team * 5 + r;
      const abilities = {} as Record<AbilityKey, number>;
      ABILITY_KEYS.forEach((key, k) => {
        abilities[key] = 15 + ((i * 37 + k * 23 + team * 11) % 80);
      });
      const role: RiderRole = r === 0 ? "captain" : r === 4 ? "hunter" : "helper";
      out.push({ rider_id: `t${team}r${r}`, abilities, role, effort: "normal", condition: 1, team_id: `T${team}` });
    }
  }
  return out;
}

function climb(fromKm: number, toKm: number, category: "HC" | "1" | "2" | "3" | "4", gradient: number, topM: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category, avg_gradient: gradient, top_elevation_m: topM };
}

const LAST_CREST_KM = 125;
const DESCENT_KM = 25;

const ROUTE: RouteV2 = {
  distance_km: 150,
  profile_type: "mountain",
  finale_type: "descent",
  segments: [
    { kind: "flat", from_km: 0, to_km: 60 },
    climb(60, 72, "1", 7, 1700),
    { kind: "descent", from_km: 72, to_km: 85, technicality: 2 },
    { kind: "rolling", from_km: 85, to_km: 110 },
    climb(110, LAST_CREST_KM, "HC", 8, 2100),
    { kind: "descent", from_km: LAST_CREST_KM, to_km: LAST_CREST_KM + DESCENT_KM, technicality: 3 },
  ],
  weather: { kind: "sun", wind_exposure: 0.2 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 150 }],
};

function run(seed: string, revision: RulesRevision = "orders_gc_v3"): StageOutput {
  const input: StageInput = { route: ROUTE, startlist: field(), orders: [], seed, tuning: RACE_V4_TUNING, rules_revision: revision };
  return simulateStageV4(input);
}

/** Lukning fra sidste top til maal for ryttere i top 10 (som scorecardet) og for nr. 10 selv. */
function descentClosure(out: StageOutput) {
  const fin = out.results.filter((r) => r.status === "finished").sort((a, b) => a.rank - b.rank);
  const winT = fin[0].time_seconds;
  let snap = null as (typeof out.groupSnapshots)[number] | null;
  for (const s of out.groupSnapshots) if (s.km <= LAST_CREST_KM + 1e-6) snap = s;
  assert.ok(snap, "snapshot ved sidste top mangler");
  const frontGap = Math.min(...snap.groups.map((g) => g.gap_seconds));
  const crestGapOf = new Map<string, number>();
  for (const g of snap.groups) for (const id of g.rider_ids) crestGapOf.set(id, g.gap_seconds - frontGap);
  return fin.slice(0, 10).map((r) => {
    const crest = crestGapOf.get(r.rider_id) ?? 0;
    return { rank: r.rank, crest, closed: crest - (r.time_seconds - winT) };
  });
}

const SEEDS = Array.from({ length: 12 }, (_, i) => `6200-cap-${i}`);
const perKmCap = TIME_MODEL_V3_TUNING.finishDescentMaxSecondsPerKm * DESCENT_KM;
const share = TIME_MODEL_V3_TUNING.finishDescentMaxGapShare;

test("#6200 v3: nedkoersel mod maal lukker hoejst loftet pr. km og hoejst andelen af hullet for nr. 10 (og top 10)", () => {
  let measuredBehind = 0;
  for (const seed of SEEDS) {
    for (const row of descentClosure(run(seed))) {
      if (!(row.crest > 0)) continue;
      measuredBehind++;
      assert.ok(row.closed <= perKmCap + TOLERANCE_SECONDS, `${seed} nr. ${row.rank}: lukket ${row.closed} > loft pr. km`);
      assert.ok(row.closed <= share * row.crest + TOLERANCE_SECONDS, `${seed} nr. ${row.rank}: lukket ${row.closed} > andel af hul ${row.crest}`);
    }
  }
  // Ellers beviste testen intet: der skal vaere top-10-ryttere med hul ved toppen.
  assert.ok(measuredBehind > 0, "ingen top-10-rytter havde hul ved toppen");
});
