// #6285: tre motor-tests der fanger SPILLERVENDTE fejl foer spillerne goer.
//
// Hver test har to lag:
//  1. Detektoren (samme funktion som Tour-scorecardet i
//     scripts/dev/lib/tourScorecard.mjs) skal slaa ud paa fejlens kendte form,
//     bygget syntetisk efter prod-symptomet. Det lag er altid en gate.
//  2. Motoren koeres deterministisk paa det anonymiserede Giro-felt
//     (scripts/baselines/giro-field-6088-2026-10-02.json: rigtige roller,
//     holdordrer, evner og etaper, ingen navne eller id'er) under hver
//     revision, og fejlen maa ikke optraede. En revision hvor fejlen er KENDT
//     og aaben, staar i KNOWN_OPEN og koeres som `todo` (rapporteres, blokerer
//     ikke CI). Alle andre revisioner er en haard gate: en regression dér
//     faelder backend-suiten (npm test i CI).
//
// Fjern en linje fra KNOWN_OPEN naar fejlen er rettet i den revision, saa
// gaten bliver haard. Taersklerne her er detektorernes definitioner af
// fejlen ("med minutter", "paa loftet", "modsiger"), ikke motor-tuning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  breakawayWin,
  clampedAtCap,
  entrantsFromData,
  labelContradictions,
  profileClass,
  STAGE_GAP_CAP_SECONDS,
} from "../../scripts/dev/lib/tourScorecard.mjs";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const stages: any[] = data.profiles.slice().sort((a: any, b: any) => a.stage_number - b.stage_number);
const roadStages = stages.filter((p) => !["itt", "itt_hilly", "ttt"].includes(p.profile_type));
const entrants = entrantsFromData(data);
const SEEDS = 3;

/** Prod-revisionen, Tour-revisionen og den officielle tidsmodel (#6284). */
const REVISIONS = ["orders_gc_v2", "orders_gc_v3", "official_times_v1"] as const;
type Revision = (typeof REVISIONS)[number];
type Check = "flatBreakawayMinutes" | "capClump" | "labelContradiction";

/** Kendte, aabne fejl pr. revision (maalt 8/10 paa fixturet). */
const KNOWN_OPEN: Record<Check, Partial<Record<Revision, string>>> = {
  flatBreakawayMinutes: {
    orders_gc_v2: "aaben (#6285): flad udbrudssejr med minutter",
    orders_gc_v3: "aaben (#6285): flad udbrudssejr med minutter",
    official_times_v1: "aaben (#6285): flad udbrudssejr med minutter",
  },
  capClump: {
    orders_gc_v2: "aaben (#6199/#6284): resultatlisten clamper til 30:00",
    orders_gc_v3: "aaben (#6199/#6284): resultatlisten clamper til 30:00",
  },
  labelContradiction: {
    orders_gc_v2: "aaben (#6294): breakaway_win modsiger udbrudsmaerket",
    official_times_v1: "aaben (#6294): breakaway_win modsiger udbrudsmaerket",
  },
};

const v4 = await loadRaceEngineV4();

function runStage(profile: any, revision: Revision, seed: number) {
  return v4.simulateStage({
    entrants, stageProfile: profile, seedString: `race-6285:${profile.stage_number}:gate${seed}`, stageNumber: profile.stage_number,
    teamOrderRows: data.orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null,
    rulesRevision: revision, gcStandings: [],
  });
}

function sweep(revision: Revision, profiles: any[], find: (res: any, profile: any) => string | null): string[] {
  const hits: string[] = [];
  for (const profile of profiles) {
    for (let s = 1; s <= SEEDS; s++) {
      const hit = find(runStage(profile, revision, s), profile);
      if (hit) hits.push(`etape ${profile.stage_number} seed ${s}: ${hit}`);
    }
  }
  return hits;
}

function revisionCase(check: Check, revision: Revision) {
  const todo = KNOWN_OPEN[check][revision];
  return todo ? { todo } : {};
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

/** "Med minutter" = mindst 2:00 foran feltet. */
const BREAKAWAY_MINUTES_SECONDS = 120;

test("#6285-1 detektoren fanger en flad udbrudssejr med minutter og lader en indhentet ude", () => {
  const won = breakawayWin(syntheticOut({ times: fieldTimes(150), formed: ["b1", "b2", "b3", "b4"] }));
  assert.equal(won.won, true);
  assert.ok(won.margin! >= BREAKAWAY_MINUTES_SECONDS, `margin ${won.margin}`);
  const caughtOut = syntheticOut({ times: [["b1", 15000], ...fieldTimes(0).slice(4)], formed: ["b1", "b2", "b3", "b4"], caught: ["b1", "b2", "b3", "b4"] });
  assert.equal(breakawayWin(caughtOut).won, false);
  assert.equal(profileClass("flat"), "flat");
});

for (const revision of REVISIONS) {
  test(`#6285-1 ${revision}: intet udbrud vinder en flad etape med minutter`, revisionCase("flatBreakawayMinutes", revision), () => {
    const flat = roadStages.filter((p) => profileClass(p.profile_type) === "flat");
    assert.ok(flat.length >= 2, "fixturet skal have flade etaper");
    const hits = sweep(revision, flat, (res) => {
      const bw = breakawayWin(res.v4Output);
      return bw.won && (bw.margin ?? 0) >= BREAKAWAY_MINUTES_SECONDS ? `udbruddet vandt med ${Math.round(bw.margin!)} s` : null;
    });
    assert.deepEqual(hits, []);
  });
}

// ── 2. +30:00-klumper ────────────────────────────────────────────────────────

test("#6285-2 detektoren fanger ryttere der clampes til 30:00 og ignorerer aegte tider", () => {
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
});

for (const revision of REVISIONS) {
  test(`#6285-2 ${revision}: ingen ryttere staar paa 30:00-loftet med en laengere raa tid`, revisionCase("capClump", revision), () => {
    const hits = sweep(revision, roadStages, (res) => {
      const n = clampedAtCap(res.ranked, res.v4Output);
      return n ? `${n} ryttere clampet til 30:00` : null;
    });
    assert.deepEqual(hits, []);
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
    const hits = sweep(revision, roadStages, (res) => {
      const issues = labelContradictions(res.ranked, res.v4Output);
      return issues.length ? issues.map((i: any) => i.kind).join("+") : null;
    });
    assert.deepEqual(hits, []);
  });
}
