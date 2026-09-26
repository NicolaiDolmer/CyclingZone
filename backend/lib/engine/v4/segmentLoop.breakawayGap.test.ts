// backend/lib/engine/v4/segmentLoop.breakawayGap.test.ts
// #5812 (a): et udbrud paa en flad etape skal kunne BYGGE et forspring.
//
// Foer rettelsen startede udbruddet med sin hovedstart og mistede den straks:
// tempo-modellen giver et stort felt mere lae end en lille gruppe, og M5 kunne
// kun lukke huller, aldrig aabne dem. Forspringet naaede derfor aldrig mere end
// hovedstarten og blev hentet efter faa segmenter — og der var 0 udbrudssejre
// paa fladt. Nu "lader feltet det gaa": hullet vokser i en fase efter
// dannelsen, og foerst derefter begynder jagten. M5 ejer hullet mellem udbrud
// og jagtgruppe alene (segmentLoop nulstiller tempo-driften mellem dem paa
// fladt/rullende/nedkoersel).
//
// Testen koerer den AEGTE segment-loop med M5's eget hook paa et realistisk
// stort felt (ca. 180) og en flad 180 km-etape i 20 km-segmenter — praecis den
// form routeAdapter nu giver en flad S4-etape.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MECHANIC_HOOKS, runSegmentLoop } from "./segmentLoop.ts";
import { breakawayHook } from "./mechanics/breakaway.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, RouteV2, StageInput } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** Deterministisk felt med spredning i evnerne (ingen rng — ren index-aritmetik). */
function field(size: number): Entrant[] {
  const out: Entrant[] = [];
  for (let i = 0; i < size; i++) {
    const abilities = {} as Record<AbilityKey, number>;
    ABILITY_KEYS.forEach((key, k) => {
      abilities[key] = 30 + ((i * 7 + k * 13) % 41);
    });
    out.push({
      rider_id: `r${String(i).padStart(3, "0")}`,
      abilities,
      role: "free_role",
      effort: "normal",
      condition: 1,
    });
  }
  return out;
}

function flatRoute(distanceKm: number, segmentKm: number): RouteV2 {
  const segments: RouteV2["segments"] = [];
  for (let from = 0; from < distanceKm; from += segmentKm) {
    segments.push({ kind: "flat", from_km: from, to_km: Math.min(distanceKm, from + segmentKm) });
  }
  return {
    distance_km: distanceKm,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments,
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Finish", km: distanceKm }],
  };
}

function run(seed: string) {
  const input: StageInput = {
    route: flatRoute(180, 20),
    startlist: field(180),
    orders: [],
    seed,
    tuning: RACE_V4_TUNING,
  };
  return runSegmentLoop(input, { ...DEFAULT_MECHANIC_HOOKS, breakaway: breakawayHook });
}

/** Udbruddets forspring paa jagtgruppen ved hver segmentgraense (null = intet udbrud foran). */
function separations(result: ReturnType<typeof run>): Array<{ km: number; gap: number | null }> {
  return result.groupSnapshots.map((snap) => {
    const breakaway = snap.groups.find((g) => g.kind === "breakaway");
    const chase = [...snap.groups]
      .filter((g) => g.kind !== "breakaway")
      .sort((a, b) => b.rider_ids.length - a.rider_ids.length)[0];
    if (!breakaway || !chase) return { km: snap.km, gap: null };
    return { km: snap.km, gap: chase.gap_seconds - breakaway.gap_seconds };
  });
}

test("#5812 et udbrud paa en flad 180 km-etape bygger et forspring paa flere minutter, foer jagten tager det", () => {
  let formedRaces = 0;
  for (const seed of ["gap-1", "gap-2", "gap-3", "gap-4", "gap-5"]) {
    const result = run(seed);
    const formed = result.timeline.find((e) => e.type === "breakaway_formed");
    if (!formed) continue;
    formedRaces++;
    assert.ok(formed.km <= 30, `seed ${seed}: udbruddet dannes for sent (km ${formed.km})`);

    const series = separations(result);
    const maxGap = Math.max(...series.map((s) => s.gap ?? 0));
    assert.ok(maxGap >= 120, `seed ${seed}: forspringet naaede kun ${maxGap.toFixed(0)} s (skal op paa et par minutter)`);

    // Jagten henter det ikke tidligt: foer rettelsen var det hentet km 40.
    const caught = result.timeline.find((e) => e.type === "breakaway_caught");
    if (caught) assert.ok(caught.km >= 80, `seed ${seed}: udbruddet hentet allerede km ${caught.km}`);
  }
  assert.ok(formedRaces >= 3, "et felt paa 180 skal danne et udbrud paa de fleste seeds");
});

test("#5812 forspringet vokser foerst og falder bagefter (lad gaa, saa jagt) — aldrig negativt", () => {
  const series = separations(run("shape-1")).filter((s) => s.gap !== null) as Array<{ km: number; gap: number }>;
  assert.ok(series.length >= 3, "udbruddet skal leve over flere segmenter");
  const peakIndex = series.reduce((best, s, i) => (s.gap > series[best].gap ? i : best), 0);
  assert.ok(peakIndex > 0, "forspringet skal vokse efter dannelsen");
  for (const s of series) assert.ok(s.gap >= 0, `forspringet maa aldrig blive negativt (km ${s.km})`);
  // Efter toppen falder det (jagten er i gang) — ingen ny vaekst efter jagten er startet.
  for (let i = peakIndex + 1; i < series.length; i++) {
    assert.ok(series[i].gap <= series[i - 1].gap + 1e-9, `km ${series[i].km}: forspringet voksede igen efter jagten startede`);
  }
});
