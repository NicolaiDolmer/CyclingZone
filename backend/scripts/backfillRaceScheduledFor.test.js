import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_SLOTS_CET,
  STAGES_PER_DAY,
  planRaceSchedules,
} from "./backfillRaceScheduledFor.js";
import {
  raceTimeWindow,
  windowsOverlap,
  raceBindingWindow,
  peakConcurrentStageRaces,
} from "../lib/raceBinding.js";

// Tæt-pakket cadence (#cadence-launch-fix): STAGES_PER_DAY etaper pr. dag på tværs af
// HELE pulje-kalenderen, så en 60-etape-sæson afvikles i ~30 dage (~4 uger) i stedet
// for dødt langsomt. Hvert løbs etaper er konsekutive; løb pakkes tæt (intet dag-spild).
// Faste danske slots (12:30/15:00/...); slot = etape-position på dagen.

const RACES = [
  { id: "rB", name: "Beta GP", stages: 1 },
  { id: "rA", name: "Alfa Tour", stages: 3 },
  { id: "rC", name: "Charlie Klassiker", stages: 2 },
];

// 2026-06-20 → "i morgen" = 21/6.
const FROM = new Date("2026-06-20T10:00:00Z");

test("STAGE_SLOTS_CET: faste, stigende dagslots", () => {
  assert.ok(Array.isArray(STAGE_SLOTS_CET) && STAGE_SLOTS_CET.length >= STAGES_PER_DAY);
  for (const s of STAGE_SLOTS_CET) assert.match(s, /^\d{2}:\d{2}$/);
});

test("STAGES_PER_DAY = 2 (launch-cadence: ~4-ugers sæson for 60-etape-kalender)", () => {
  assert.equal(STAGES_PER_DAY, 2);
});

// 5/dag-infrastruktur (#1712): der skal være 5 slots så en division kan afvikle 5
// etaper/dag. 09:00 ligger SIDST i arrayet (= spor 4) for at bevare bagudkompatibilitet:
// spor 0-3 forbliver 12:30/15:00/18:00/21:00, så eksisterende kalendre (tracks<=4) er
// uændrede. Kronologisk på dagen er rækkefølgen stadig 09:00 < 12:30 < ... < 21:00.
test("STAGE_SLOTS_CET har 5 slots (5/dag-kapacitet)", () => {
  assert.equal(STAGE_SLOTS_CET.length, 5);
});

test("planRaceSchedules: tracks=5 lægger 5 endagsløb på SAMME dag i 5 distinkte slots (ingen wraparound)", () => {
  const races = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, stages: 1 }));
  const { stageRows } = planRaceSchedules({ races, from: new Date("2026-07-01T00:00:00Z"), tracks: 5 });
  const dates = new Set(stageRows.map((s) => s.scheduled_at.slice(0, 10)));
  assert.equal(dates.size, 1, "alle 5 løb på samme dag (5 parallelle spor)");
  const times = new Set(stageRows.map((s) => s.scheduled_at));
  assert.equal(times.size, 5, "5 distinkte etape-tider — ingen duplikat-slot");
});

test("planRaceSchedules: tracks > slots kaster (ingen stille wraparound)", () => {
  const races = [{ id: "r1", name: "R1", stages: 1 }];
  assert.throws(() => planRaceSchedules({ races, from: new Date("2026-07-01T00:00:00Z"), tracks: 6 }), /tracks/);
});

test("planRaceSchedules: 2 spor → 2 etaper/dag total", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  // 2 spor × 1 etape/dag = 2 etaper/dag total. 6 etaper → 3 dage.
  const byDay = {};
  for (const r of stageRows) {
    const d = new Date(r.scheduled_at).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  assert.equal(Object.keys(byDay).length, 3, "6 etaper / 2 spor = 3 dage");
  assert.deepEqual(Object.values(byDay), [2, 2, 2], "2 etaper pr. dag (2 spor)");
});

test("planRaceSchedules: scheduled_for sorteret på name (Alfa, Beta, Charlie)", () => {
  const { raceUpdates } = planRaceSchedules({ races: RACES, from: FROM });
  assert.deepEqual(raceUpdates.map((r) => r.id), ["rA", "rB", "rC"]);
});

test("planRaceSchedules: et løbs etaper er konsekutive, 1 etape/dag i sit spor", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  const alfa = stageRows.filter((r) => r.race_id === "rA").sort((a, b) => a.stage_number - b.stage_number);
  assert.deepEqual(alfa.map((r) => r.stage_number), [1, 2, 3]);
  // Spor-model: Alfa (3 etaper) ligger i ÉT spor → 1 etape/dag over 3 på hinanden følgende dage.
  const alfaDays = alfa.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10));
  assert.deepEqual(alfaDays, ["2026-06-21", "2026-06-22", "2026-06-23"]);
});

test("planRaceSchedules: to løb i forskellige spor kører samme dag, forskellige slots", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  // Dag 21/6: Alfa etape 1 (spor 0 → 12:30) + Beta etape 1 (spor 1 → 15:00).
  const day1 = stageRows.filter((r) => new Date(r.scheduled_at).toISOString().slice(0, 10) === "2026-06-21");
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
  const slots = day1.map((r) => hhmm(r.scheduled_at)).sort();
  assert.deepEqual(slots, ["12:30", "15:00"], "to forskellige slots samme dag");
  const races = new Set(day1.map((r) => r.race_id));
  assert.equal(races.size, 2, "to FORSKELLIGE løb samme dag (overlap)");
});

test("planRaceSchedules: stage race binder hen over et nabospor-løb (ægte overlap)", () => {
  // Et langt stage race (spor 0) + flere korte løb (spor 1) → vinduerne overlapper.
  const races = [
    { id: "tour", name: "AAA Grand Tour", stages: 7 },
    { id: "k1", name: "BBB Klassiker 1", stages: 1 },
    { id: "k2", name: "CCC Klassiker 2", stages: 1 },
    { id: "k3", name: "DDD Klassiker 3", stages: 1 },
  ];
  const { stageRows } = planRaceSchedules({ races, from: FROM });
  const winFor = (raceId) => raceTimeWindow(stageRows.filter((r) => r.race_id === raceId));
  const tourWin = winFor("tour");
  // Mindst ét kort løb skal have sit vindue inde i grand tour'ets span → binding aktiv.
  const overlaps = ["k1", "k2", "k3"].filter((id) => windowsOverlap(tourWin, winFor(id)));
  assert.ok(overlaps.length >= 1, `grand tour skal overlappe mindst ét nabospor-løb (fik ${overlaps.length})`);
});

test("planRaceSchedules: spor balanceres — spor-længderne afviger højst ét løbs etaper", () => {
  // 10 single-løb + 1 stage race → greedy skal holde sporene nogenlunde lige lange.
  const races = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Race ${String(i).padStart(2, "0")}`, stages: 1 })),
    { id: "sr", name: "ZZZ Stage Race", stages: 5 },
  ];
  const { stageRows } = planRaceSchedules({ races, from: FROM });
  // Sidste etape-dag pr. spor (slot) → spor-længder.
  const lastDayBySlot = {};
  for (const r of stageRows) {
    const t = new Date(r.scheduled_at);
    const slot = t.toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
    const day = t.toISOString().slice(0, 10);
    if (!lastDayBySlot[slot] || day > lastDayBySlot[slot]) lastDayBySlot[slot] = day;
  }
  const days = Object.values(lastDayBySlot).map((d) => Date.parse(d));
  const spreadDays = (Math.max(...days) - Math.min(...days)) / 86400000;
  assert.ok(spreadDays <= 5, `spor-længde-spredning ${spreadDays} dage skal være ≤ største løbs etape-antal (5)`);
});

test("planRaceSchedules: tracks=1 → ren sekventiel stream (1 etape/dag, ét slot)", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM, tracks: 1 });
  // Alle 6 etaper på ét spor/slot, 1 pr. dag over 6 dage (backward-compat escape hatch).
  const byDay = {};
  const slots = new Set();
  for (const r of stageRows) {
    const t = new Date(r.scheduled_at);
    const day = t.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    slots.add(t.toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" }));
  }
  assert.equal(Object.keys(byDay).length, 6, "6 etaper / 1 spor = 6 dage");
  assert.deepEqual(Object.values(byDay), [1, 1, 1, 1, 1, 1], "1 etape/dag");
  assert.deepEqual([...slots], ["12:30"], "kun ét slot bruges (spor 0)");
});

test("planRaceSchedules: 30 single-etape-løb → 15 dage (balanceret 2-spors-fordeling)", () => {
  // 30 single-løb fordeles 15/15 på de 2 spor → 15 dage. (Gælder balancerede single-løb;
  // ét enkelt 30-etape-løb ville tage 30 dage, da etaper i samme løb ikke kan paralleliseres.)
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Race ${String(i).padStart(2, "0")}`, stages: 1 }));
  const { stageRows } = planRaceSchedules({ races: many, from: FROM });
  const days = new Set(stageRows.map((r) => new Date(r.scheduled_at).toISOString().slice(0, 10)));
  assert.equal(days.size, 15, "15 løb pr. spor × 1 etape/dag = 15 dage");
});

test("planRaceSchedules: én stage-row pr. etape med fast CET-slot", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  assert.equal(stageRows.length, 6); // 1 + 3 + 2
  for (const r of stageRows) assert.match(new Date(r.scheduled_at).toISOString(), /T\d{2}:\d{2}/);
});

test("planRaceSchedules: scheduled_at er gyldige fremtidige tidsstempler i UTC", () => {
  const { stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  for (const r of stageRows) {
    const t = new Date(r.scheduled_at);
    assert.ok(!Number.isNaN(t.getTime()), `ugyldig dato: ${r.scheduled_at}`);
    assert.ok(t.getTime() > FROM.getTime(), "etape-tid skal ligge efter from");
  }
});

test("planRaceSchedules: deterministisk — samme input → identisk output", () => {
  const a = planRaceSchedules({ races: RACES, from: FROM });
  const b = planRaceSchedules({ races: RACES, from: FROM });
  assert.deepEqual(a, b);
});

test("planRaceSchedules: stage 1's scheduled_at matcher løbets scheduled_for", () => {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: RACES, from: FROM });
  for (const ru of raceUpdates) {
    const stage1 = stageRows.find((r) => r.race_id === ru.id && r.stage_number === 1);
    assert.equal(stage1.scheduled_at, ru.scheduled_for, `stage 1 != scheduled_for for ${ru.id}`);
  }
});

test("planRaceSchedules: tomt løb-input → tomme planer", () => {
  const { raceUpdates, stageRows } = planRaceSchedules({ races: [], from: FROM });
  assert.deepEqual(raceUpdates, []);
  assert.deepEqual(stageRows, []);
});

// ── Kapacitets-bevidst tildeling (#1856): max N samtidige etapeløb pr. division ──
// Ejer-beslutning: højst 2 samtidige etapeløb pr. division; endagsløb fylder de øvrige
// daglige slots (op til 5 etaper/dag i alt). stageRaceTracks sætter etape-spor-loftet.

// Blanding: 4 etapeløb à 7 etaper + 6 endagsløb. tracks=5, stageRaceTracks=2.
const MIXED = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `tour${i}`, name: `Tour ${String(i).padStart(2, "0")}`, stages: 7 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `one${i}`, name: `One Day ${String(i).padStart(2, "0")}`, stages: 1 })),
];

test("planRaceSchedules: stageRaceTracks=2 holder højst 2 samtidige etapeløb pr. division", () => {
  const { stageRows } = planRaceSchedules({ races: MIXED, from: FROM, tracks: 5, stageRaceTracks: 2 });
  const DIV = "div-X";
  // Byg pr. race et binding-vindue (CET-dag-ordinaler) fra dens stageRows; alle races i
  // samme division så peakConcurrentStageRaces ser dem som konkurrerende.
  const list = MIXED.map((race) => {
    const rows = stageRows.filter((r) => r.race_id === race.id);
    return {
      league_division_id: DIV,
      race_type: race.stages > 1 ? "stage_race" : "one_day",
      window: raceBindingWindow(rows),
    };
  });
  const peak = peakConcurrentStageRaces(list, { divisionId: DIV });
  assert.ok(peak <= 2, `samtidige etapeløb skal være ≤ 2 (fik ${peak})`);
});

test("planRaceSchedules: endagsløb i bageste spor (slots[2..4]), etapeløb i slots[0..1]", () => {
  const { stageRows } = planRaceSchedules({ races: MIXED, from: FROM, tracks: 5, stageRaceTracks: 2 });
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit" });
  const stageSlots = STAGE_SLOTS_CET.slice(0, 2); // ["12:30","15:00"]
  const oneDaySlots = STAGE_SLOTS_CET.slice(2, 5); // ["18:00","21:00","09:00"]

  const stageRaceIds = new Set(MIXED.filter((r) => r.stages > 1).map((r) => r.id));
  const oneDayIds = new Set(MIXED.filter((r) => r.stages === 1).map((r) => r.id));

  for (const r of stageRows) {
    const slot = hhmm(r.scheduled_at);
    if (stageRaceIds.has(r.race_id)) {
      assert.ok(stageSlots.includes(slot), `etapeløb ${r.race_id} skal ligge i forreste spor, fik slot ${slot}`);
    } else if (oneDayIds.has(r.race_id)) {
      assert.ok(oneDaySlots.includes(slot), `endagsløb ${r.race_id} skal ligge i bageste spor, fik slot ${slot}`);
    }
  }
});

test("planRaceSchedules: begge typer planlægges fra dag 1 (kører parallelt)", () => {
  const { stageRows } = planRaceSchedules({ races: MIXED, from: FROM, tracks: 5, stageRaceTracks: 2 });
  // Dag 1 (21/6) skal have BÅDE etapeløb-etaper og endagsløb → op til tracks etaper/dag.
  const day1 = stageRows.filter((r) => new Date(r.scheduled_at).toISOString().slice(0, 10) === "2026-06-21");
  const day1Races = new Set(day1.map((r) => r.race_id));
  const stageRaceIds = new Set(MIXED.filter((r) => r.stages > 1).map((r) => r.id));
  const oneDayIds = new Set(MIXED.filter((r) => r.stages === 1).map((r) => r.id));
  assert.ok([...day1Races].some((id) => stageRaceIds.has(id)), "mindst ét etapeløb dag 1");
  assert.ok([...day1Races].some((id) => oneDayIds.has(id)), "mindst ét endagsløb dag 1");
});

test("planRaceSchedules: stageRaceTracks kræver < tracks (mindst ét endagsløb-spor)", () => {
  assert.throws(
    () => planRaceSchedules({ races: MIXED, from: FROM, tracks: 2, stageRaceTracks: 2 }),
    /stageRaceTracks/,
  );
});

test("planRaceSchedules: stageRaceTracks kræver tracks <= slots.length", () => {
  assert.throws(
    () => planRaceSchedules({ races: MIXED, from: FROM, tracks: 6, stageRaceTracks: 2 }),
    /tracks/,
  );
});

test("planRaceSchedules: stageRaceTracks=2 er deterministisk (dry-run == apply)", () => {
  const a = planRaceSchedules({ races: MIXED, from: FROM, tracks: 5, stageRaceTracks: 2 });
  const b = planRaceSchedules({ races: MIXED, from: FROM, tracks: 5, stageRaceTracks: 2 });
  assert.deepEqual(a, b);
});

test("planRaceSchedules: default (stageRaceTracks=null) er uændret — 2 spor → 2 etaper/dag", () => {
  // Genbrug det eksisterende default-scenarie: stageRaceTracks=null skal give NØJAGTIG
  // samme output som uden parameteren overhovedet.
  const withNull = planRaceSchedules({ races: RACES, from: FROM, stageRaceTracks: null });
  const without = planRaceSchedules({ races: RACES, from: FROM });
  assert.deepEqual(withNull, without);
  // Og det matcher den oprindelige 2-spors-forventning: 6 etaper / 2 spor = 3 dage.
  const byDay = {};
  for (const r of withNull.stageRows) {
    const d = new Date(r.scheduled_at).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  assert.deepEqual(Object.values(byDay), [2, 2, 2]);
});
