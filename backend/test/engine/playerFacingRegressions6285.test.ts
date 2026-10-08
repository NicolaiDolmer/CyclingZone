// #6285: tre motor-tests der fanger SPILLERVENDTE fejl foer spillerne goer.
//
// Hver test har to lag:
//  1. Detektoren (samme funktion som Tour-scorecardet i
//     scripts/dev/lib/tourScorecard.mjs) skal slaa ud paa fejlens kendte form,
//     bygget syntetisk efter prod-symptomet. Det lag er altid en gate.
//  2. Motoren koeres deterministisk paa det anonymiserede Giro-felt
//     (scripts/baselines/giro-field-6088-2026-10-02.json: rigtige roller,
//     holdordrer, evner og etaper, ingen navne eller id'er) under hver
//     revision, ALLE etaper i raekkefoelge med klassementet akkumuleret som i
//     spillet (runStagesInOrder: fra etape 2 faar motoren klassementet foer
//     etapen, saa orders_gc's klassementslogik koeres). Fejlen maa ikke
//     optraede. En revision hvor fejlen er KENDT og aaben, staar i
//     KNOWN_OPEN_GATES (delt med scorecardet, som aldrig taeller den som groen)
//     og koeres som `todo` (rapporteres, blokerer ikke CI). Alle andre
//     kombinationer er en haard gate: en regression dér faelder backend-suiten
//     (npm test i CI).
//
// Fjern en linje fra KNOWN_OPEN_GATES naar fejlen er rettet i den revision, saa
// gaten bliver haard. Taersklerne er detektorernes definitioner af fejlen ("med
// minutter", "liste-gab != raa tid", "modsiger"), ikke motor-tuning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  breakawayWin,
  clampedAtCap,
  FLAT_BREAKAWAY_MINUTES_SECONDS,
  flatBreakawayWinWithMinutes,
  gateStatus,
  KNOWN_OPEN_GATES,
  labelContradictions,
  overCapRaw,
  runStagesInOrder,
  sortedStages,
  splitEntrants,
  STAGE_GAP_CAP_SECONDS,
} from "../../scripts/dev/lib/tourScorecard.mjs";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const stages: any[] = sortedStages(data);
const { entrants, droppedWithoutAbilities } = splitEntrants(data);
const SEEDS = 3;
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);

/** Prod-revisionen, Tour-revisionen og den officielle tidsmodel (#6284). */
const REVISIONS = ["orders_gc_v2", "orders_gc_v3", "official_times_v1"] as const;
type Revision = (typeof REVISIONS)[number];
type Check = keyof typeof KNOWN_OPEN_GATES;

const v4 = await loadRaceEngineV4();

/** Det de tre gates skal bruge fra én etape (hele broens svar gemmes ikke). */
type StageHit = {
  stage: number;
  seed: number;
  road: boolean;
  gcStatus: string | null;
  flatMinutes: number | null;
  clamped: number;
  overCap: number;
  labels: string[];
};

const tourCache = new Map<Revision, StageHit[]>();

/** Hele loebet x SEEDS under revisionen, klassementet akkumuleret som i spillet (memoiseret pr. revision). */
function tourHits(revision: Revision): StageHit[] {
  const cached = tourCache.get(revision);
  if (cached) return cached;
  const hits: StageHit[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({
      v4, data, revision, seedTag: `gate${seed}`, stages, entrants,
      onStage: ({ profile, res }: any) => {
        const road = !TIME_TRIALS.has(profile.profile_type);
        const flat = flatBreakawayWinWithMinutes(res.v4Output, profile);
        const gc = (res.v4Output.timeline?.events ?? []).find((e: any) => e.type === "gc_context");
        hits.push({
          stage: profile.stage_number,
          seed,
          road,
          gcStatus: gc?.params?.status ?? null,
          flatMinutes: flat.hit ? Math.round(flat.margin ?? 0) : null,
          clamped: road ? clampedAtCap(res.ranked, res.v4Output) : 0,
          overCap: road ? overCapRaw(res.v4Output) : 0,
          labels: road ? labelContradictions(res.ranked, res.v4Output).map((i: any) => i.kind) : [],
        });
      },
    });
  }
  tourCache.set(revision, hits);
  return hits;
}

const where = (h: StageHit) => `etape ${h.stage} seed ${h.seed}`;

function revisionCase(check: Check, revision: Revision) {
  return gateStatus(check, revision) === "todo" ? { todo: (KNOWN_OPEN_GATES[check] as Record<string, string>)[revision] } : {};
}

// ── Forudsaetninger: feltet er helt, og klassementet naar motoren ────────────

test("#6285 fixturet: hele startlisten har evner (ingen ryttere smides stille ud)", () => {
  assert.equal(droppedWithoutAbilities, 0);
  const partial = splitEntrants({ ...data, abilities: data.abilities.slice(1) });
  assert.equal(partial.droppedWithoutAbilities, 1, "en rytter uden evner skal taelles, ikke forsvinde");
});

for (const revision of REVISIONS) {
  test(`#6285 ${revision}: motor-gates koeres med klassementet fra etape 2 (ikke first_stage paa alle etaper)`, () => {
    const after1 = tourHits(revision).filter((h) => h.road && h.stage !== stages[0].stage_number && h.gcStatus !== null);
    assert.ok(after1.length > 0, "vejetaperne efter etape 1 skal melde klassementsstatus");
    assert.deepEqual(after1.filter((h) => h.gcStatus !== "standings").map((h) => `${where(h)}: ${h.gcStatus}`), []);
  });
}

// ── Syntetiske udfald (fejlens form fra prod) ───────────────────────────────

function finished(times: Array<[string, number]>) {
  return times.map(([rider_id, time_seconds], i) => ({ rider_id, rank: i + 1, time_seconds, status: "finished" }));
}

function syntheticOut({ times, formed = [], caught = [] }: { times: Array<[string, number]>; formed?: string[]; caught?: string[] }) {
  const events: any[] = [];
  if (formed.length) events.push({ km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: formed } });
  if (caught.length) events.push({ km: 150, type: "breakaway_caught", params: { rider_ids: caught } });
  return { results: finished(times), timeline: { events }, groupSnapshots: [] };
}

/** Et realistisk felt: 4 udbrydere og 40 ryttere i feltet paa samme tid. */
function fieldTimes(breakLead: number): Array<[string, number]> {
  const out: Array<[string, number]> = [["b1", 15000], ["b2", 15000], ["b3", 15002], ["b4", 15004]];
  for (let i = 0; i < 40; i++) out.push([`p${i}`, 15000 + breakLead]);
  return out;
}

// ── 1. Udbrud der vinder med minutter mod et realistisk felt ────────────────

test("#6285-1 detektoren fanger en flad udbrudssejr med minutter og lader en indhentet, en med sekunder og en kuperet ude", () => {
  const formed = ["b1", "b2", "b3", "b4"];
  const flat = { profile_type: "flat" };
  const won = flatBreakawayWinWithMinutes(syntheticOut({ times: fieldTimes(FLAT_BREAKAWAY_MINUTES_SECONDS + 30), formed }), flat);
  assert.equal(won.hit, true);
  assert.ok(won.margin! >= FLAT_BREAKAWAY_MINUTES_SECONDS, `margin ${won.margin}`);
  assert.equal(flatBreakawayWinWithMinutes(syntheticOut({ times: fieldTimes(20), formed }), flat).hit, false, "sekunder er ikke minutter");
  assert.equal(flatBreakawayWinWithMinutes(syntheticOut({ times: fieldTimes(FLAT_BREAKAWAY_MINUTES_SECONDS + 30), formed }), { profile_type: "hilly" }).hit, false, "kun flade etaper");
  const caughtOut = syntheticOut({ times: [["b1", 15000], ...fieldTimes(0).slice(4)], formed, caught: formed });
  assert.equal(breakawayWin(caughtOut).won, false);
  assert.equal(flatBreakawayWinWithMinutes(caughtOut, flat).hit, false);
});

for (const revision of REVISIONS) {
  test(`#6285-1 ${revision}: intet udbrud vinder en flad etape med minutter`, revisionCase("flatBreakawayMinutes", revision), () => {
    const flatStages = stages.filter((p) => p.profile_type === "flat");
    assert.ok(flatStages.length >= 2, "fixturet skal have flade etaper");
    const hits = tourHits(revision).filter((h) => h.flatMinutes !== null).map((h) => `${where(h)}: udbruddet vandt med ${h.flatMinutes} s`);
    assert.deepEqual(hits, []);
  });
}

// ── 2. +30:00-klumper ────────────────────────────────────────────────────────

test("#6285-2 detektoren fanger liste-gab der ikke er den raa tid over loftet, ogsaa et andet loft end 30:00", () => {
  const out = syntheticOut({ times: [["w", 18000], ["a", 18000 + 1500], ["b", 18000 + 2400], ["c", 18000 + 2700]] });
  const clamped = [
    { rider_id: "w", rank: 1, stageGap: 0 },
    { rider_id: "a", rank: 2, stageGap: 1500 },
    { rider_id: "b", rank: 3, stageGap: STAGE_GAP_CAP_SECONDS },
    { rider_id: "c", rank: 4, stageGap: STAGE_GAP_CAP_SECONDS },
  ];
  assert.equal(clampedAtCap(clamped, out), 2);
  const official = clamped.map((r, i) => ({ ...r, stageGap: [0, 1500, 2400, 2700][i] }));
  assert.equal(clampedAtCap(official, out), 0);
  // Et nyt, hoejere loft (fx 40:00) er samme fejl: listen lyver om rytter c.
  const otherCap = official.map((r) => ({ ...r, stageGap: Math.min(r.stageGap, 2500) }));
  assert.equal(clampedAtCap(otherCap, out), 1);
  assert.equal(overCapRaw(out), 2);
});

for (const revision of REVISIONS) {
  test(`#6285-2 ${revision}: resultatlistens gab er den raa tid, ogsaa over 30:00`, revisionCase("capClump", revision), () => {
    const hits = tourHits(revision).filter((h) => h.road);
    // Ikke-tom forudsaetning: uden ryttere over loftet kunne gaten aldrig slaa ud.
    assert.ok(hits.reduce((a, h) => a + h.overCap, 0) > 0, "fixturet skal give ryttere med raa gab over 30:00");
    assert.deepEqual(hits.filter((h) => h.clamped > 0).map((h) => `${where(h)}: ${h.clamped} ryttere med liste-gab != raa tid`), []);
  });
}

// ── 3. Maerke der modsiger resultatet ────────────────────────────────────────

test("#6285-3 detektoren fanger 'indhentet men vandt alene' og en modstridende udbrudsdom", () => {
  // #6294: vinderen staar som i udbrud og indhentet, men vandt alene med 1:20.
  const out = syntheticOut({ times: [["w", 15000], ["x", 15080], ["y", 15080]], formed: ["w"], caught: ["w"] });
  const caughtSolo = [{ rider_id: "w", rank: 1, stageGap: 0, breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: true } }];
  assert.deepEqual(labelContradictions(caughtSolo, out).map((i: any) => i.kind), ["caught_but_solo"]);
  // Motoren siger "udbruddet vandt ikke", men vinderen sad i det og blev aldrig indhentet.
  const flagMismatch = [{ rider_id: "w", rank: 1, stageGap: 0, breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: null } }];
  assert.deepEqual(labelContradictions(flagMismatch, syntheticOut({ times: [["w", 15000], ["x", 15000]] })).map((i: any) => i.kind), ["win_flag_vs_label"]);
  // Konsistent: indhentet og vandt spurten paa samme tid.
  const consistent = [{ rider_id: "w", rank: 1, stageGap: 0, breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: true } }];
  assert.deepEqual(labelContradictions(consistent, syntheticOut({ times: [["w", 15000], ["x", 15000]] })), []);
});

for (const revision of REVISIONS) {
  test(`#6285-3 ${revision}: vinderens udbrudsmaerke stemmer med resultatet`, revisionCase("labelContradiction", revision), () => {
    const hits = tourHits(revision).filter((h) => h.labels.length).map((h) => `${where(h)}: ${h.labels.join("+")}`);
    assert.deepEqual(hits, []);
  });
}
