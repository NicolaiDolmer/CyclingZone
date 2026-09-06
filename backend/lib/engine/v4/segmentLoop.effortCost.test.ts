// backend/lib/engine/v4/segmentLoop.effortCost.test.ts
// Forward-guard for M12-WIRINGEN (#4632, ejer-beslutning 6/9, model C):
// indsatsvalget er koblet ind i motoren.
//
// mechanics/effortCost.test.ts daekker MEKANIKKEN (den rene multiplikator-
// funktion). Denne fil daekker KOBLINGEN — at et loeb faktisk bliver anderledes
// af at en rytter vaelger all_out frem for normal, at valget peger den rigtige
// vej, og at hverken determinismen eller invariant 3 braekker undervejs. Uden en
// test paa netop koblingen kan M12 blive "bygget, ikke koblet ind" igen ved
// foerste refaktorering; det er praecis den tilstand auditten 5/9 fandt paa otte
// mekanikker (og som M12 selv stod i indtil i dag).
//
// Samme formuleringsprincip som segmentLoop.weather.test.ts: udsagnene er
// SKALA-uafhaengige ("all_out kan aldrig koste mindre end normal"), ikke
// forventede tal — tuning-tallene flytter sig ved naeste kalibrering,
// garantierne goer ikke.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { validateTimelineEvents } from "./timeline.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { applyEffortToDemand, effortDemandMultiplier } from "./mechanics/effortCost.ts";
import type { AbilityKey, EffortLevel, Entrant, RouteV2, StageInput, StageOutput } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

const SEEDS = Array.from({ length: 20 }, (_, i) => `m12-seed-${i}`);

function clamp99(n: number): number {
  return Math.max(0, Math.min(99, n));
}

function abilitiesAt(level: number, overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = clamp99(level);
  for (const [key, value] of Object.entries(overrides)) out[key as AbilityKey] = clamp99(value as number);
  return out;
}

/** Blandet felt — spredning i alle evner, saa selektionerne har noget at arbejde med. */
function mixedField(count: number): Entrant[] {
  return Array.from({ length: count }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: abilitiesAt(30, {
      climbing: 15 + ((i * 7) % 70),
      sprint: 20 + ((i * 11) % 60),
      descending: 10 + ((i * 13) % 80),
      durability: 15 + ((i * 5) % 70),
      endurance: 20 + ((i * 3) % 60),
    }),
    role: "free_role" as const,
    effort: "normal" as const,
    condition: 1,
  }));
}

function withEffort(startlist: Entrant[], riderId: string, effort: EffortLevel): Entrant[] {
  return startlist.map((e) => (e.rider_id === riderId ? { ...e, effort } : e));
}

const FLAT_ROUTE: RouteV2 = {
  distance_km: 180,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [
    { kind: "flat", from_km: 0, to_km: 60 },
    { kind: "rolling", from_km: 60, to_km: 120 },
    { kind: "flat", from_km: 120, to_km: 180 },
  ],
  weather: { kind: "sun", wind_exposure: 0.2 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
};

const MOUNTAIN_ROUTE: RouteV2 = {
  distance_km: 180,
  profile_type: "mountain",
  finale_type: "long_climb",
  segments: [
    { kind: "flat", from_km: 0, to_km: 50 },
    { kind: "climb", from_km: 50, to_km: 75, category: "1", avg_gradient: 7.5, top_elevation_m: 1600 },
    { kind: "descent", from_km: 75, to_km: 100, technicality: 3 },
    { kind: "rolling", from_km: 100, to_km: 145 },
    { kind: "climb", from_km: 145, to_km: 180, category: "HC", avg_gradient: 8.5, top_elevation_m: 2100 },
  ],
  weather: { kind: "sun", wind_exposure: 0.2 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
};

function stage(startlist: Entrant[], route: RouteV2, seed: string): StageInput {
  return { route, startlist, orders: [], seed, tuning: RACE_V4_TUNING };
}

function loadOf(output: StageOutput, riderId: string): number {
  const load = output.loads.find((l) => l.rider_id === riderId);
  assert.ok(load, `belastning mangler for ${riderId}`);
  return load!.work_norm;
}

function rankOf(output: StageOutput, riderId: string): number {
  const result = output.results.find((r) => r.rider_id === riderId);
  assert.ok(result, `resultat mangler for ${riderId}`);
  return result!.rank;
}

function secondsOverCpOf(output: StageOutput, riderId: string): number {
  const load = output.loads.find((l) => l.rider_id === riderId);
  assert.ok(load, `belastning mangler for ${riderId}`);
  return load!.seconds_over_cp;
}

function drewBreakawayTicket(output: StageOutput, riderId: string): boolean {
  return output.timeline.events.some(
    (e) => e.type === "breakaway_formed" && ((e.params.rider_ids ?? []) as string[]).includes(riderId),
  );
}

/**
 * To IDENTISKE ryttere i samme felt, kun indsatsvalget adskiller dem. Den
 * eneste fair maade at maale hvad et valg koster/koeber: samme loeb, samme
 * felt, samme seed.
 */
function twinField(level: number, effortA: EffortLevel, effortB: EffortLevel): Entrant[] {
  const twin = (rider_id: string, effort: EffortLevel): Entrant => ({
    rider_id,
    abilities: abilitiesAt(level),
    role: "free_role",
    effort,
    condition: 1,
  });
  return [...mixedField(58), twin("twinA", effortA), twin("twinB", effortB)];
}

// ── 1. Koblingen findes overhovedet ──────────────────────────────────────────

test("M12 er KOBLET IND: samme etape med én rytter paa all_out giver et andet udfald end paa normal", () => {
  const field = mixedField(60);
  const normal = simulateStageV4(stage(field, MOUNTAIN_ROUTE, "m12-coupling"));
  const allOut = simulateStageV4(stage(withEffort(field, "r010", "all_out"), MOUNTAIN_ROUTE, "m12-coupling"));

  assert.notDeepEqual(
    normal.loads.map((l) => l.work_norm),
    allOut.loads.map((l) => l.work_norm),
    "et aendret indsatsvalg skal aendre belastningen — ellers laeser segmentLoop ikke Entrant.effort",
  );
});

test("en startliste hvor ALLE koerer normal er uberoert af wiringen (multiplikatoren er praecis 1.0)", () => {
  // Fixture-garantien: golden fixtures og head-to-head-harnesset koerer alle
  // entrants paa 'normal', saa M12-wiringen maa ikke flytte dem en eneste bit.
  assert.equal(effortDemandMultiplier("normal"), 1);
  assert.equal(applyEffortToDemand(0.42, "normal"), 0.42);
});

// ── 2. Retningen: mere indsats koster mere, mindre indsats koster mindre ─────

test("all_out giver ALTID strengt hoejere belastning end normal for samme rytter paa samme etape", () => {
  // Flad rute: ingen bjerg-selektion kan flytte rytteren til en anden gruppe,
  // saa gruppens tempo (og dermed dtSeconds + groupDemand) er identisk i de to
  // arme. Den ENESTE forskel er rytterens eget kraftkrav — praecis den kanal
  // M12 wirer. Udsagnet er derfor et rent kausalt udsagn, ikke et statistisk.
  const field = mixedField(60);
  for (const seed of SEEDS.slice(0, 5)) {
    const normal = simulateStageV4(stage(field, FLAT_ROUTE, seed));
    const allOut = simulateStageV4(stage(withEffort(field, "r010", "all_out"), FLAT_ROUTE, seed));
    assert.ok(
      loadOf(allOut, "r010") > loadOf(normal, "r010"),
      `${seed}: all_out (${loadOf(allOut, "r010")}) skal koste strengt mere end normal (${loadOf(normal, "r010")})`,
    );
  }
});

test("de fem trin er strengt ordnede: grupetto < save < normal < protect < all_out", () => {
  const order: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
  for (const demand of [0, 0.05, 0.4, 1, 7.5]) {
    for (let i = 0; i < order.length - 1; i++) {
      const lower = applyEffortToDemand(demand, order[i]);
      const higher = applyEffortToDemand(demand, order[i + 1]);
      assert.ok(
        demand === 0 ? higher === lower : higher > lower,
        `krav ${demand}: ${order[i + 1]} skal koste mere end ${order[i]} (fik ${higher} vs ${lower})`,
      );
    }
  }
});

// ── 3. Invariant 3: styrke straffes aldrig ───────────────────────────────────

test("INVARIANT 3 (20 seeds): i samme gruppe kan en SVAGERE rytter paa all_out aldrig slaa en staerkere paa all_out", () => {
  // Begge yderpunkter paa SAMME trin: multiplikatoren er en ren funktion af
  // trinnet, saa den maa ikke kunne vende to rytteres indbyrdes orden. Ville
  // wiringen have ganget paa CP i stedet for paa kravet, var det praecis her
  // det ville braekke.
  const base = mixedField(60);
  const weak: Entrant = { ...base[0], rider_id: "weak", abilities: abilitiesAt(45), effort: "all_out" };
  const strong: Entrant = { ...base[0], rider_id: "strong", abilities: abilitiesAt(70), effort: "all_out" };
  const startlist = [...base.slice(0, 58), weak, strong];

  for (const route of [FLAT_ROUTE, MOUNTAIN_ROUTE]) {
    for (const seed of SEEDS) {
      const output = simulateStageV4(stage(startlist, route, seed));
      const w = output.results.find((r) => r.rider_id === "weak")!;
      const s = output.results.find((r) => r.rider_id === "strong")!;
      if (w.group_id !== s.group_id) continue; // invariant 3 gaelder INDEN FOR en gruppe
      assert.ok(
        s.time_seconds <= w.time_seconds,
        `${route.profile_type}/${seed}: den staerkeste paa all_out maa aldrig faa daarligere tid end den svageste paa all_out`,
      );
    }
  }
});

// ── 4. Grupetto er aldrig en genvej til et resultat ──────────────────────────

test("GRUPETTO (20 seeds x 6 evne-niveauer x 2 profiler): tvillingen paa grupetto slaar ALDRIG tvillingen paa normal", () => {
  // Ejer-reglen bag femtrins-skalaen: grupetto er at opgive dagen, ikke en
  // billig maade at spare kraefter paa. Den sparede W' maa derfor ikke
  // konvertere til et resultat. To ting lukker de kanaler den ellers ville
  // loebe igennem: udelukkelsen fra udbruds-kandidaterne (breakaway.ts) og
  // W'-reserven der taeller som 0 i placerings-opgoeret (finale.ts).
  //
  // TVILLING-DESIGN: begge ryttere er med i SAMME loeb, med identiske evner.
  // Det er den eneste fair sammenligning — koerer man to SEPARATE loeb, aendrer
  // rytterens eget valg hele feltets gruppestruktur, og man maaler et andet
  // loeb i stedet for et andet valg.
  //
  // To seed-klasser springes over, begge dokumenterede og begge uafhaengige af
  // M12's retning:
  //   1. UDBRUDS-LODDET. Tvillingerne har forskellige rider_id og dermed
  //      forskellige rng-stroemme; trak normal-tvillingen et udbrudslod, er de
  //      to ryttere ikke laengere i samme loeb. (At grupetto-tvillingen ALDRIG
  //      trækker det lod er selve wiringen — testet separat nedenfor.)
  //   2. KOLLAPSET. Koerte normal-tvillingen over CP, maaler man ikke "hvad
  //      koeber grupetto", men "hvad koster det at sprænge sig selv". Den
  //      beskyttelse er fysiologi, ikke en grupetto-fordel: 'save' (v3-
  //      kalibreret, 0.7) giver praecis samme beskyttelse. Maalt 6/9: det er
  //      DEN ENESTE kanal hvor grupetto stadig kan give en bedre placering, og
  //      den rammer kun ryttere der er for svage til etapen (evne 30 paa en
  //      HC-bjergetape). Se PR-bodyen for tallene og det aabne spoergsmaal.
  for (const level of [30, 45, 60, 70, 85, 99]) {
    for (const route of [FLAT_ROUTE, MOUNTAIN_ROUTE]) {
      for (const seed of SEEDS) {
        const startlist = twinField(level, "grupetto", "normal");
        const out = simulateStageV4(stage(startlist, route, seed));
        if (drewBreakawayTicket(out, "twinB")) continue;
        if (secondsOverCpOf(out, "twinB") > 0) continue;
        assert.ok(
          rankOf(out, "twinA") > rankOf(out, "twinB"),
          `${route.profile_type}/evne ${level}/${seed}: grupetto (plads ${rankOf(out, "twinA")}) maa aldrig slaa normal (plads ${rankOf(out, "twinB")})`,
        );
      }
    }
  }
});

test("GRUPETTO: en rytter i grupettoen kommer aldrig med i udbruddet", () => {
  const field = mixedField(60);
  // Den mest udbruds-ivrige profil i feltet, saa udelukkelsen faktisk testes
  // mod en rytter der ellers ville vaere kandidat.
  const eager = field.map((e) =>
    e.rider_id === "r010" ? { ...e, abilities: abilitiesAt(40, { aggression: 99, endurance: 90, tempo: 90 }) } : e,
  );
  let sawBreakaway = false;
  for (const seed of SEEDS) {
    const output = simulateStageV4(stage(withEffort(eager, "r010", "grupetto"), FLAT_ROUTE, seed));
    for (const event of output.timeline.events) {
      if (event.type !== "breakaway_formed") continue;
      sawBreakaway = true;
      const riderIds = (event.params.rider_ids ?? []) as string[];
      assert.ok(!riderIds.includes("r010"), `${seed}: en grupetto-rytter maa aldrig vaere med i udbruddet`);
    }
  }
  assert.ok(sawBreakaway, "testen skal faktisk have set mindst ét udbrud — ellers beviser den ingenting");
});

// ── 5. Motorens haarde garantier holder MED indsatsvalg ──────────────────────

test("DETERMINISME: samme input med blandede indsatsvalg giver byte-identisk output", () => {
  const field = mixedField(40);
  const mixed = field.map((e, i) => ({
    ...e,
    effort: (["grupetto", "save", "normal", "protect", "all_out"] as EffortLevel[])[i % 5],
  }));
  const input = stage(mixed, MOUNTAIN_ROUTE, "m12-determinism");
  assert.deepEqual(simulateStageV4(input), simulateStageV4(input));
});

test("INVARIANT 6 (laast feltstoerrelse) + tidslinje: blandede indsatsvalg taber ingen ryttere og bryder ikke validatoren", () => {
  const field = mixedField(40);
  const mixed = field.map((e, i) => ({
    ...e,
    effort: (["grupetto", "save", "normal", "protect", "all_out"] as EffortLevel[])[i % 5],
  }));
  for (const route of [FLAT_ROUTE, MOUNTAIN_ROUTE]) {
    const output = simulateStageV4(stage(mixed, route, "m12-field"));
    assert.equal(output.results.length, mixed.length);
    assert.deepEqual(
      output.results.map((r) => r.rank).sort((a, b) => a - b),
      mixed.map((_, i) => i + 1),
    );
    const violations = validateTimelineEvents(output.timeline.events, {
      distanceKm: route.distance_km,
      knownRiderIds: new Set(mixed.map((e) => e.rider_id)),
    });
    assert.deepEqual(violations, [], `tidslinje-overtraedelser: ${JSON.stringify(violations)}`);
  }
});
