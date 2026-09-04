// backend/lib/engine/v4/segmentLoop.load.test.ts
// Forward-guards for #4604's tre skala-fejl i belastnings-/tempo-modellen.
//
// Alle tre var samme fejlklasse: en ABSOLUT konstant maalt mod en RELATIV,
// evne-vaegtet stoerrelse. De blev foerst synlige mod den aegte S3-population
// (median-evne 11/99), ikke mod syntetiske fixtures med midt-skala-evner —
// derfor er guarden her formuleret som SKALA-INVARIANTER, ikke som forventede
// tal: en test der laaser et tal ville ikke have fanget nogen af de tre.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runSegmentLoop } from "./segmentLoop.ts";
import { tickPhysiology } from "./physiology.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, RouteV2, Segment, StageInput } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(level: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = level;
  return out;
}

function startlist(count: number, level: number, prefix = "r"): Entrant[] {
  return Array.from({ length: count }, (_, i) => ({
    rider_id: `${prefix}${String(i).padStart(3, "0")}`,
    abilities: abilities(level),
    role: "free_role" as const,
    effort: "normal" as const,
    condition: 1,
  }));
}

function climbSegment(fromKm: number, toKm: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category: "1", avg_gradient: 7, top_elevation_m: 1800 };
}

function flatSegment(fromKm: number, toKm: number): Segment {
  return { kind: "flat", from_km: fromKm, to_km: toKm };
}

function route(segments: Segment[], distanceKm: number): RouteV2 {
  return {
    distance_km: distanceKm,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments,
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm }],
  };
}

function stage(entrants: Entrant[], segments: Segment[], distanceKm: number, tuning = RACE_V4_TUNING): StageInput {
  return { route: route(segments, distanceKm), startlist: entrants, orders: [], seed: "4604-load-guard", tuning };
}

// Dagsform er en LEGITIM kilde til at en enkelt rytter falder af selv i et
// ensartet felt (en daarlig dag). Skala-invarianterne nedenfor handler om
// selve belastnings-modellen, saa de isolerer den ved at slaa dagsform fra.
const NO_DAYFORM = {
  ...RACE_V4_TUNING,
  dayform: { ...RACE_V4_TUNING.dayform, sd: 0, jourSansPBase: 0 },
};

// ── Fejl 1: kravet skal vaere RELATIVT til gruppens kollektive CP ────────────
// FOER: `demand = terrain.baseDemand[kind] * positionFactor` var absolut, saa
// 100 % af en prod-realistisk population (median-CP 0,097 paa climb mod et krav
// paa 0,720) laa over CP paa hvert eneste climb-segment. Hele W'-dimensionen
// var doed, og M2 splittede derfor hele feltet paa hver stigning.
//
// Invarianten: et ENSARTET felt (alle ryttere identiske) kan ikke kollektivt
// koere sig selv toemt — gruppens eget tempo ER dens baeredygtige tempo. Det
// skal gaelde ved ETHVERT evne-niveau, ogsaa det lave.
test("#4604 fejl 1: et ensartet felt toemmes ikke af sit eget tempo — ved alle evne-niveauer", () => {
  for (const level of [5, 11, 30, 60, 99]) {
    const entrants = startlist(40, level);
    const { state } = runSegmentLoop(stage(entrants, [climbSegment(0, 12)], 12, NO_DAYFORM));
    const emptied = Object.values(state.riders).filter((r) => r.wprime <= 0);
    assert.equal(
      emptied.length,
      0,
      `evne-niveau ${level}: ${emptied.length} af 40 identiske ryttere toemte W' paa deres EGET gruppetempo`,
    );
  }
});

// Samme invariant, set fra selektionen: et ensartet felt maa ikke splitte.
// Ingen rytter er svagere end nogen anden, saa der er intet at selektere paa.
test("#4604 fejl 1: et ensartet felt splitter ikke paa en stigning", () => {
  for (const level of [5, 11, 30, 99]) {
    const entrants = startlist(40, level);
    const { state } = runSegmentLoop(stage(entrants, [climbSegment(0, 12)], 12, NO_DAYFORM));
    assert.equal(state.groups.length, 1, `evne-niveau ${level}: feltet splittede i ${state.groups.length} grupper`);
  }
});

// ── Fejl 2: W' skal have en tidskonstant ────────────────────────────────────
// FOER: `wprime -= (demand - cp) * dt` med begge sider normaliseret 0-1 gav en
// implicit tidskonstant paa 1 SEKUND — en median-reserve (W'max 0,119) toemtes
// paa 0,1-0,5 s. Genopladnings-grenen havde derimod sin egen eksplicitte rate.
test("#4604 fejl 2: W'-taering har en tidskonstant, ikke ét sekund", () => {
  const wprimeMax = 0.12; // prod-median (5.938 ryttere, maalt 2/9)
  const overshoot = 0.1; // realistisk overskud over CP
  const oneMinute = tickPhysiology({
    cp: 0.3,
    wprimeMax,
    wprime: wprimeMax,
    demand: 0.3 + overshoot,
    dtSeconds: 60,
    rechargeRate: 0.0006,
  });
  assert.ok(
    oneMinute.wprime > 0,
    `et minut over CP toemte hele reserven (W'=${oneMinute.wprime}) — tidskonstanten mangler`,
  );

  // Reserven SKAL stadig kunne toemmes; en uendelig reserve er lige saa forkert.
  const oneHour = tickPhysiology({
    cp: 0.3,
    wprimeMax,
    wprime: wprimeMax,
    demand: 0.3 + overshoot,
    dtSeconds: 3600,
    rechargeRate: 0.0006,
  });
  assert.equal(oneHour.wprime, 0, "en time over CP skal toemme reserven");
});

test("#4604 fejl 2: taeringen er monoton i overskud og i tid", () => {
  const base = { cp: 0.3, wprimeMax: 0.12, wprime: 0.12, rechargeRate: 0.0006 };
  const small = tickPhysiology({ ...base, demand: 0.35, dtSeconds: 300 });
  const large = tickPhysiology({ ...base, demand: 0.5, dtSeconds: 300 });
  assert.ok(large.wprime < small.wprime, "stoerre overskud skal taere mere");
  const shorter = tickPhysiology({ ...base, demand: 0.4, dtSeconds: 100 });
  const longer = tickPhysiology({ ...base, demand: 0.4, dtSeconds: 300 });
  assert.ok(longer.wprime < shorter.wprime, "laengere tid over CP skal taere mere");
});

// ── Fejl 3: relae-effekt — en solo-rytter er ikke hurtigere end en gruppe ────
// FOER: `collectiveCp` er gennemsnittet af de staerkeste `frontFraction`, saa
// den blev MEKANISK hoejere jo mindre gruppen var. En solo-rytter fik gruppens
// hoejeste CP som kollektivt tempo og koerte derfor hurtigere end enhver
// forfoelgende gruppe — bagvendt, og kilden til 85 % af bjerg-gappet.
test("#4604 fejl 3: en solo-rytter er aldrig hurtigere end en gruppe af sin egen slags", () => {
  // Samme rytter-niveau, samme rute — kun feltstoerrelsen aendres. Den ene
  // rytter koerer alene; de tyve roterer. Ingen af dem har en fordel i evner.
  const flat = flatSegment(0, 40);

  for (const level of [11, 40, 80]) {
    const soloRun = runSegmentLoop(stage(startlist(1, level), [flat], 40));
    const groupRun = runSegmentLoop(stage(startlist(20, level), [flat], 40));
    const soloTime = Object.values(soloRun.state.riders)[0].time_seconds;
    const groupTime = Object.values(groupRun.state.riders)[0].time_seconds;
    assert.ok(
      soloTime >= groupTime,
      `evne-niveau ${level}: solo-rytteren brugte ${soloTime}s mod gruppens ${groupTime}s — solo maa aldrig vaere hurtigere`,
    );
  }
});

test("#4604 fejl 3: relae-gevinsten er stoerst hvor laeet er mest vaerd", () => {
  // work.draftFactor siger flat 0,55 (stor laegevinst) mod climb 0,9 (lille).
  // Relae-effekten paa gruppetempoet skal foelge samme ordning.
  const mk = (kind: "flat" | "climb"): Segment =>
    kind === "climb" ? climbSegment(0, 30) : flatSegment(0, 30);

  const rel = (kind: "flat" | "climb") => {
    const solo = Object.values(runSegmentLoop(stage(startlist(1, 40), [mk(kind)], 30)).state.riders)[0].time_seconds;
    const group = Object.values(runSegmentLoop(stage(startlist(20, 40), [mk(kind)], 30)).state.riders)[0].time_seconds;
    return solo / group;
  };

  assert.ok(
    rel("flat") > rel("climb"),
    `relae-gevinsten skal vaere stoerre paa flat (${rel("flat")}) end paa climb (${rel("climb")})`,
  );
});

// ── Determinisme holder for alle tre aendringer ─────────────────────────────
test("#4604: belastnings-modellen er fortsat deterministisk", () => {
  const input = stage(startlist(30, 25), [climbSegment(0, 10), climbSegment(10, 20)], 20);
  assert.deepEqual(runSegmentLoop(input), runSegmentLoop(input));
});
