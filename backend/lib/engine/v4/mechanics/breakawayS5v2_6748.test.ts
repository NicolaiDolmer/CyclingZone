// backend/lib/engine/v4/mechanics/breakawayS5v2_6748.test.ts
// #6748 (KUN s5_profiles_v2, slukket): opfoelgningen paa S5's nye udbrud og maerkning.
//   1. Paa S5's syntetiske foerste-etape-klassement udelukker et nyt udbrud feltets
//      bedste paa klassementsevne (gcThreat.s5ReformationExcludedRiders).
//   2. Et nyt udbrud kraever en rigtig indhentning: udbruddet skal vaere slaaet
//      sammen med ryttere uden for det (breakaway.s5BreakMergedWithField).
//   5. Vinderen fra et stykke af udbruddet: motorens udbrudsdom og vinderens
//      udfald paa stregen er den samme dom (chaseGroup.isS5V2BreakawayWin,
//      withWinnerEscapeOutcome); maaleskemaets caught_but_solo antager ikke
//      trin-modellen under v2.
// s5_profiles_v1 og aeldre er uroerte: udeladt flag/option = den gamle vej.
// Strukturelle invarianter, ingen kalibrerede tal (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RACE_V4_TUNING } from "../tuning.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { breakawayHook, s5BreakMergedWithField, S5_REFORMATION_TUNING } from "./breakaway.ts";
import { s5ReformationExcludedRiders } from "./gcThreat.ts";
import { isMorningRegroupCatch, isS5V2BreakawayWin, noteFormationRiders, withWinnerEscapeOutcome } from "./chaseGroup.ts";
import { isBreakawayWin, type FinaleGroupTrace } from "../groups.ts";
import { deriveParticipationHistory, settleBreakawayOutcome } from "../../../raceParticipationHistory.ts";
import { loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { labelContradictions, runStagesInOrder, sortedStages, splitEntrants } from "../../../../scripts/dev/lib/tourScorecard.mjs";
import type { AbilityKey, EngineState, Entrant, GcContext, RaceGroup, RiderState, RouteV2, SegmentHookContext, TimelineEvent } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function entrant(id: string, team: string, level: number): Entrant {
  return { rider_id: id, abilities: Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>, role: "helper", effort: "normal", condition: 1, team_id: team };
}

// ── Punkt 1: foerste etape ───────────────────────────────────────────────────

/** Feltet: tre staerke klassementsryttere, resten jaevnt svagere. */
function firstStageField(): Record<string, Entrant> {
  const out: Record<string, Entrant> = { s1: entrant("s1", "A", 90), s2: entrant("s2", "B", 88), s3: entrant("s3", "C", 86) };
  for (let i = 0; i < 30; i++) out[`f${i}`] = entrant(`f${i}`, `F${i % 6}`, 40);
  return out;
}
/** Som broens withS5ThreatModel bygger det: alle paa rang 1. */
function syntheticFirstStage(ids: string[]): GcContext {
  return { status: "standings", stage_number: 1, leader_id: null, standings: ids.map((id) => ({ rider_id: id, rank: 1, gap_seconds: 0 })), first_stage: true } as GcContext;
}

test("#6748 punkt 1: v1 udelukker ingen paa det syntetiske foerste-etape-klassement (uaendret)", () => {
  const entrants = firstStageField();
  assert.equal(s5ReformationExcludedRiders(syntheticFirstStage(Object.keys(entrants)), entrants, 2).size, 0);
});

test("#6748 punkt 1: v2 udelukker feltets bedste paa klassementsevne paa foerste etape", () => {
  const entrants = firstStageField();
  const out = s5ReformationExcludedRiders(syntheticFirstStage(Object.keys(entrants)), entrants, 2, { abilityOnFirstStage: true });
  assert.ok(out.has("s1") && out.has("s2"), "de to bedste er udelukket");
  assert.ok(out.has("s3"), "en der er staerk nok til at vaere farlig for dem, er ogsaa udelukket");
  assert.equal([...out].some((id) => id.startsWith("f")), false, "de svage er ikke udelukket");
});

test("#6748 punkt 1: v2 rangerer kun blandt de koerende", () => {
  // x er langt den staerkeste, men udgaaet; y er den bedste koerende.
  const entrants: Record<string, Entrant> = { x: entrant("x", "A", 99), y: entrant("y", "B", 10) };
  for (let i = 0; i < 10; i++) entrants[`f${i}`] = entrant(`f${i}`, "C", 5);
  const gc = syntheticFirstStage(Object.keys(entrants));
  assert.equal(s5ReformationExcludedRiders(gc, entrants, 1, { abilityOnFirstStage: true }).has("y"), false, "med x i feltet er y ikke blandt de forreste");
  const racing = new Set(Object.keys(entrants).filter((id) => id !== "x"));
  assert.ok(s5ReformationExcludedRiders(gc, entrants, 1, { abilityOnFirstStage: true, racingRiderIds: racing }).has("y"), "en udgaaet rytter optager ingen plads");
});

test("#6748 punkt 1: et rigtigt klassement giver samme udelukkelse med og uden v2-optionen", () => {
  const entrants = firstStageField();
  const gc: GcContext = { status: "standings", stage_number: 3, leader_id: "f0", standings: Object.keys(entrants).map((id, i) => ({ rider_id: id, rank: i + 1, gap_seconds: i })) };
  assert.deepEqual([...s5ReformationExcludedRiders(gc, entrants, 5, { abilityOnFirstStage: true })].sort(), [...s5ReformationExcludedRiders(gc, entrants, 5)].sort());
});

// ── Punkt 2: rigtig indhentning ──────────────────────────────────────────────

const FLAT: RouteV2 = {
  distance_km: 100, profile_type: "flat", finale_type: "bunch_sprint",
  segments: Array.from({ length: 10 }, (_, i) => ({ kind: "flat" as const, from_km: i * 10, to_km: (i + 1) * 10 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};
function riderState(id: string, group: string): RiderState {
  return { rider_id: id, group_id: group, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}
/**
 * Udbruddet (e0, e1) er forsvundet som udbrudsgruppe. `lastAlone`: e1 sidder for
 * sig selv (et uheld/split flyttede ham), ellers er han slaaet sammen med feltet.
 * e0 blev sat af tidligere og koerer i feltet.
 */
function vanishedBreak(lastAlone: boolean): { state: EngineState; entrants: Record<string, Entrant> } {
  const entrants: Record<string, Entrant> = {};
  for (let i = 0; i < 40; i++) entrants[`p${i}`] = entrant(`p${i}`, `T${i % 8}`, 50 + (i % 7));
  entrants.e0 = entrant("e0", "T0", 60);
  entrants.e1 = entrant("e1", "T1", 60);
  const field = [...Object.keys(entrants).filter((id) => id.startsWith("p")), "e0"];
  const groups: RaceGroup[] = lastAlone
    ? [{ id: "peloton-0", kind: "peloton", rider_ids: field, gap_seconds: 0, cohesion: 1 },
      { id: "chase-2000", kind: "chase", origin: "breakaway", rider_ids: ["e1"], gap_seconds: 30, cohesion: 1 }]
    : [{ id: "peloton-0", kind: "peloton", rider_ids: [...field, "e1"], gap_seconds: 0, cohesion: 1 }];
  const riders: Record<string, RiderState> = {};
  for (const g of groups) for (const id of g.rider_ids) riders[id] = riderState(id, g.id);
  return { state: { km: 20, groups, riders, virtual_gc: {}, s5_last_break_rider_ids: ["e0", "e1"], breakaway_dropped_ids: ["e0"] }, entrants };
}
function s5Ctx(entrants: Record<string, Entrant>, v2: boolean): SegmentHookContext {
  const segmentIndex = 2;
  const base = makeHookCtx({ segment: FLAT.segments[segmentIndex], segmentIndex, route: FLAT, entrants, tuning: RACE_V4_TUNING });
  return { ...base, rulesRevision: "orders_gc_v1", ordersGcV3: true, s5ProfilesV1: true, ...(v2 ? { s5ProfilesV2: true as const } : {}) };
}

test("#6748 punkt 2: bevis paa indhentning = en udbryder fra udbruddet i samme gruppe som en ikke-udbryder", () => {
  assert.equal(s5BreakMergedWithField(vanishedBreak(false).state, ["e0", "e1"]), true, "slaaet sammen med feltet");
  assert.equal(s5BreakMergedWithField(vanishedBreak(true).state, ["e0", "e1"]), false, "alene efter et uheld/split; en tidligere afsat rytter i feltet taeller ikke");
});

test("#6748 punkt 2: v1 forsoeger et nyt udbrud ogsaa naar udbruddet blot forsvandt (uaendret)", () => {
  const { state, entrants } = vanishedBreak(true);
  assert.equal(breakawayHook(state, s5Ctx(entrants, false)).state.breakaway_reformations, 1);
});

test("#6748 punkt 2: v2 venter paa en rigtig indhentning, og forsoeger saa", () => {
  const alone = vanishedBreak(true);
  assert.equal(breakawayHook(alone.state, s5Ctx(alone.entrants, true)).state.breakaway_reformations, undefined, "ingen indhentning, intet nyt udbrud");
  const merged = vanishedBreak(false);
  assert.equal(breakawayHook(merged.state, s5Ctx(merged.entrants, true)).state.breakaway_reformations, 1, "feltet har ham: nyt udbrud forsoeges");
});

// ── Punkt 5: vinderen fra et stykke af udbruddet ─────────────────────────────

const g = (id: string, kind: RaceGroup["kind"], rider_ids: string[], origin?: RaceGroup["origin"]): RaceGroup => ({ id, kind, rider_ids, gap_seconds: 0, cohesion: 1, ...(origin ? { origin } : {}) });

/** Udbruddet (e0) foran, et afsat stykke (w, e2) bag det, feltet bagved. */
function pieceTrace(finaleBuilt: RaceGroup[] | null): FinaleGroupTrace {
  const pre = [g("breakaway-0", "breakaway", ["e0"], "breakaway"), g("chase-1000", "chase", ["w", "e2"], "breakaway"), g("peloton-0", "peloton", ["p1", "p2"])];
  return { entryGroups: pre, preFinaleGroups: pre, postFinaleGroups: finaleBuilt ?? pre };
}

test("#6748 punkt 5: sejr fra et stykke af udbruddet er en udbrudssejr under v2 (v1-dommen uaendret)", () => {
  const trace = pieceTrace(null);
  assert.equal(isBreakawayWin(trace, "w"), false, "v1's dom kraever udbrudsgruppens art");
  assert.equal(isS5V2BreakawayWin(trace, "w"), true);
  const escapeesOnly = pieceTrace([g("finale-1", "solo", ["w"]), g("finale-2", "chase", ["e2", "e0"]), g("peloton-0", "peloton", ["p1", "p2"])]);
  assert.equal(isS5V2BreakawayWin(escapeesOnly, "w"), true, "finalens opgoer kun mellem udbrydere");
  const mixed = pieceTrace([g("finale-1", "solo", ["w"]), g("finale-2", "chase", ["e2", "p1"]), g("peloton-0", "peloton", ["p2"])]);
  assert.equal(isS5V2BreakawayWin(mixed, "w"), false, "finalen tog feltet med i opgoeret");
  assert.equal(isS5V2BreakawayWin(trace, "p1"), false, "en rytter fra feltet");
});

test("#6748 punkt 5: v2-dommen er sand overalt hvor v1-dommen er sand", () => {
  const pre = [g("breakaway-0", "breakaway", ["w", "e0"], "breakaway"), g("peloton-0", "peloton", ["p1"])];
  for (const post of [pre, [g("finale-1", "solo", ["w"]), g("finale-2", "chase", ["e0"]), g("peloton-0", "peloton", ["p1"])]]) {
    const trace = { entryGroups: pre, preFinaleGroups: pre, postFinaleGroups: post };
    assert.equal(isBreakawayWin(trace, "w"), true);
    assert.equal(isS5V2BreakawayWin(trace, "w"), true);
  }
});

const DROP_EVENTS: TimelineEvent[] = [
  { km: 0, type: "stage_start", params: {} },
  { km: 10, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["w", "e0", "e2"], drops_reported: true } },
  { km: 90, type: "breakaway_dropped", params: { group_id: "chase-1000", from_group_id: "breakaway-0", rider_ids: ["e2", "w"] } },
];

test("#6748 punkt 5: vinderen fra stykket faar sit eget udfald, og maerket er motorens dom", () => {
  const trace = pieceTrace(null);
  for (const win of [true, false]) {
    const events = withWinnerEscapeOutcome(DROP_EVENTS, { trace, winnerId: "w", breakawayWin: win, km: 100 });
    const added = events.slice(DROP_EVENTS.length);
    assert.deepEqual(added, [{ km: 100, type: win ? "breakaway_survived" : "breakaway_caught", params: { group_id: "chase-1000", rider_ids: ["w"] } }]);
    const history = deriveParticipationHistory([...events, { km: 100, type: "finish", params: {} }], ["w", "e0", "e2", "p1", "p2"]);
    const w = history.riders.get("w");
    assert.equal(w?.dropped, false, "ikke laengere 'sat af' i det raa maerke");
    // Vinderen: ingen ikke-udbryder foran ham paa stregen.
    assert.equal(settleBreakawayOutcome(w, false), win ? "survived" : "caught", "maal-afgoerelsen siger det samme som motorens dom");
  }
});

test("#6748 punkt 5: intet ekstra udfald naar vinderen allerede er navngivet, eller ikke var i udbruddet", () => {
  const trace = pieceTrace(null);
  const named = [...DROP_EVENTS, { km: 100, type: "breakaway_survived", params: { group_id: "chase-1000", rider_ids: ["w"] } } as TimelineEvent];
  assert.deepEqual(withWinnerEscapeOutcome(named, { trace, winnerId: "w", breakawayWin: true, km: 100 }), named);
  assert.deepEqual(withWinnerEscapeOutcome(DROP_EVENTS, { trace, winnerId: "p1", breakawayWin: false, km: 100 }), DROP_EVENTS);
  assert.deepEqual(withWinnerEscapeOutcome(DROP_EVENTS, { trace: null, winnerId: "w", breakawayWin: false, km: 100 }), DROP_EVENTS);
});

test("#6748 punkt 5: caught_but_solo antager kun trin-modellen uden for v2; uenig dom maales altid", () => {
  const out = { results: [{ rider_id: "w", status: "finished", time_seconds: 1000 }, { rider_id: "p1", status: "finished", time_seconds: 1000 + 600 }] };
  const caught = [{ rider_id: "w", breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: true } }];
  assert.deepEqual(labelContradictions(caught, out).map((c: { kind: string }) => c.kind), ["caught_but_solo"]);
  assert.deepEqual(labelContradictions(caught, out, { stepModel: false }), []);
  const disagree = [{ rider_id: "w", breakaway_win: false, breakaway_status: { in_breakaway: true, breakaway_caught: false } }];
  assert.deepEqual(labelContradictions(disagree, out, { stepModel: false }).map((c: { kind: string }) => c.kind), ["win_flag_vs_label"]);
});

// ── Punkt 6 i motoren: filmens sammenlaegnings-filter (segmentLoop) ──────────

test("#6748 punkt 6: motorens filter ser den aktive formation; det hentede udbrud der henter det nye, er en indhentning", () => {
  const formedA: TimelineEvent = { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a1", "a2"] } };
  const formedB = (separate: boolean): TimelineEvent => ({ km: 23, type: "breakaway_formed", params: { group_id: "breakaway-1500", rider_ids: ["b1", "b2"], reformation: true, ...(separate ? { separate_formation: true } : {}) } });
  const caught: TimelineEvent = { km: 120, type: "breakaway_caught", params: { group_id: "breakaway-1500", rider_ids: ["b1", "b2"], chase_group_id: "chase-9000" } };
  const groups = [g("chase-9000", "chase", ["a1", "a2", "b1", "b2"]), g("peloton-0", "peloton", ["p1"])];
  const formationAfter = (separate: boolean) => {
    const set = new Set<string>();
    for (const e of [formedA, formedB(separate)]) noteFormationRiders(set, e);
    return set;
  };
  assert.deepEqual([...formationAfter(false)].sort(), ["a1", "a2", "b1", "b2"], "uden maerket: begge udbrud (v1, uaendret)");
  assert.equal(isMorningRegroupCatch(caught, groups, formationAfter(false)), true, "v1 laeser det som en sammenlaegning");
  assert.deepEqual([...formationAfter(true)].sort(), ["b1", "b2"], "med maerket: kun det nye udbrud");
  assert.equal(isMorningRegroupCatch(caught, groups, formationAfter(true)), false, "v2: en indhentning, som filmen viser");
});

// ── Rigtig motor paa Giro-feltet ─────────────────────────────────────────────

const GIRO = JSON.parse(readFileSync(new URL("../../../../scripts/baselines/giro-field-6088-2026-10-02.json", import.meta.url), "utf8"));

test("#6748 rigtig motor: under v2 er vinderens maerke og udbrudsdommen den samme dom; nyt udbrud er sin egen formation", async () => {
  const v4 = await loadRaceEngineV4();
  const { entrants } = splitEntrants(GIRO);
  const stages = sortedStages(GIRO);
  let reformations = 0;
  for (const seedTag of ["s6748-1", "s6748-2"]) {
    runStagesInOrder({
      v4, data: GIRO, revision: "s5_profiles_v2", seedTag, stages, entrants,
      onStage: ({ profile, res }: any) => {
        const events = res.v4Output.timeline?.events ?? [];
        for (const e of events) if (e.type === "breakaway_formed" && e.params.reformation === true) {
          reformations++;
          assert.equal(e.params.separate_formation, true, `etape ${profile.stage_number}: nyt udbrud uden formationsmaerket`);
        }
        const w = res.ranked[0];
        if (typeof w?.breakaway_win !== "boolean" || w.breakaway_status?.in_breakaway !== true) return;
        const s = w.breakaway_status;
        const outcome = settleBreakawayOutcome({ morning: true, caught: s.breakaway_caught === true, survived: s.breakaway_caught === false, dropped: s.breakaway_dropped === true, swallowed: s.breakaway_swallowed === true }, false);
        assert.equal(outcome === "survived", w.breakaway_win, `etape ${profile.stage_number} (${seedTag}): maerket og dommen er uenige`);
      },
    } as Parameters<typeof runStagesInOrder>[0]);
  }
  assert.ok(reformations >= 1, "feltet giver mindst ét nyt udbrud at maale paa");
});

test("#6748 rigtig motor: et nyt udbrud paa foerste etape rummer under v2 ingen af feltets bedste paa klassementsevne", async () => {
  const v4 = await loadRaceEngineV4();
  const { entrants } = splitEntrants(GIRO);
  // Foerste og anden vejetape som et loeb for sig: den foerste har S5's syntetiske klassement.
  const stages = sortedStages(GIRO).filter((s: { profile_type: string }) => s.profile_type !== "itt" && s.profile_type !== "ttt").slice(0, 2);
  // Kun evnerne bruges (gcAbility); maaleskemaets raekker er ikke fulde Entrants.
  const byId = Object.fromEntries(entrants.map((e: { rider_id: string }) => [e.rider_id, e])) as unknown as Record<string, Entrant>;
  const top = s5ReformationExcludedRiders(syntheticFirstStage(Object.keys(byId)), byId, S5_REFORMATION_TUNING.excludeGcRankAtMost, { abilityOnFirstStage: true });
  let seen = 0;
  for (const seedTag of ["a1", "a2", "a3", "a4", "a5", "a6"]) {
    runStagesInOrder({
      v4, data: GIRO, revision: "s5_profiles_v2", seedTag, stages, entrants,
      onStage: ({ index, res }: any) => {
        if (index !== 0) return;
        for (const e of res.v4Output.timeline?.events ?? []) if (e.type === "breakaway_formed" && e.params.reformation === true) {
          seen++;
          assert.deepEqual((e.params.rider_ids as string[]).filter((id) => top.has(id)), [], `${seedTag}: en af feltets bedste kom med i det nye udbrud`);
        }
      },
    } as Parameters<typeof runStagesInOrder>[0]);
  }
  assert.ok(seen >= 1, "mindst ét nyt udbrud paa foerste etape at maale paa");
});
