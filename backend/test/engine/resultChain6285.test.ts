// #6285 C: kontrakttest for hele kaeden motor -> bro -> race_results -> loebsfilm
// under den live revision (official_times_v3, #6452).
//
// Kaeden, som spillet koerer den:
//  - motoren (v4) skriver tidslinjen og gruppe-snapshots;
//  - broen (rankedFromV4Output, raceEngineV4Bridge.js) laver resultatlisten med
//    udbrudsstatus ud fra deriveParticipationHistory (raceParticipationHistory.ts);
//  - race_results' flag er raceSimulator.deriveBreakawayStatus(ranked);
//  - loebsfilmen er buildFilmTimeline (frontend/src/lib/stageTimelineFilm.js).
// Kontrakten (spilleren maa aldrig se to historier):
//  1. in_breakaway = medlem af morgenudbruddet (foerste breakaway_formed), og
//     filmen viser samme morgenudbrud.
//  2. indhentet kraever en ikke-udbryder: én foran i maal eller i samme gruppe
//     (gruppe-snapshot) paa et tidspunkt efter dannelsen. Filmen viser
//     indhentningen (breakaway_caught eller group_merged med rytteren).
//  3. faldet fra udbruddet kraever motorens breakaway_dropped for rytteren, eller
//     et uheld med tidstab (projektionens anden kilde til et fald), og filmen
//     viser det.
//  4. holdt hjem kraever at ingen ikke-udbryder kom i maal foran.
//  5. filmen viser de samme udbrudshaendelser som motoren skrev, minus de
//     samlinger der ikke var indhentninger (#6294 regroupCatches). Filmen faar
//     samme startliste som broen (#6400), saa den ikke skjuler rigtige indhentninger.
// Detektoren testes foerst syntetisk paa fejlens form; derefter er den en haard
// gate paa hele Giro-feltet, alle vejetaper, i raekkefoelge med klassement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStagesInOrder, sortedStages, splitEntrants } from "../../scripts/dev/lib/tourScorecard.mjs";
import { loadRaceEngineV4, rankedFromV4Output } from "../../lib/raceEngineV4Bridge.js";
import { deriveBreakawayStatus } from "../../lib/raceSimulator.js";
import { deriveParticipationHistory } from "../../lib/raceParticipationHistory.ts";
import { buildFilmTimeline } from "../../../frontend/src/lib/stageTimelineFilm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
// #6452: den live revision. official_times_v2 er frosset byte-identisk
// (officialTimesV2Frozen6200.test.ts), saa kaeden gates paa den nye.
const REVISION = "official_times_v3";
const SEEDS = 3;
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);
const BREAK_EVENT_TYPES = new Set(["breakaway_formed", "breakaway_caught", "breakaway_dropped", "breakaway_survived"]);

type Ev = { km?: number; type: string; params?: Record<string, any> };
const idsOf = (e: Ev | undefined): string[] => (Array.isArray(e?.params?.rider_ids) ? e!.params!.rider_ids : []);
const names = (e: Ev, id: string) => idsOf(e).includes(id);
const eventKey = (e: Ev) => `${e.type}:${[...idsOf(e)].sort().join(",")}`;
/** Kendt aaben (#6400): filmen viser faerre af motorens indhentninger end motoren skrev. */
const FILM_HIDES_CATCH = "film_hides_catch";

function multiset(events: Ev[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) if (BREAK_EVENT_TYPES.has(e.type)) m.set(eventKey(e), (m.get(eventKey(e)) ?? 0) + 1);
  return m;
}

/**
 * Brud paa kontrakten for én etape. `out` = motorens StageOutput, `events` =
 * den persisterede tidslinje (det filmen afspiller). Tom liste = én historie.
 */
function chainViolations({ out, events, distanceKm = null }: { out: any; events: Ev[]; distanceKm?: number | null }): string[] {
  const issues: string[] = [];
  const raw: Ev[] = out?.timeline?.events ?? [];
  const resultIds = (out?.results ?? []).map((r: any) => r.rider_id);
  const ranked = rankedFromV4Output(out, { rulesRevision: REVISION });
  const stored: Map<string, { in_breakaway: boolean; breakaway_caught: boolean; breakaway_dropped?: boolean | null }> = deriveBreakawayStatus(ranked);
  const morning = new Set(idsOf(raw.find((e) => e.type === "breakaway_formed")));
  const film = buildFilmTimeline({ events, distanceKm, timelineVersion: 2, startlist: resultIds });
  const filmEvents: Ev[] = film.events;
  const filmMorning = new Set(idsOf(filmEvents.find((e) => e.type === "breakaway_formed")));
  if ([...morning].sort().join() !== [...filmMorning].sort().join()) issues.push("film_formation");

  // 5. Filmen viser motorens udbrudshaendelser, minus regroups (#6294).
  const { regroupCatches } = deriveParticipationHistory(raw, resultIds);
  const engineShown = multiset(raw.filter((e) => !regroupCatches.has(e)));
  const filmShown = multiset(filmEvents);
  for (const key of new Set([...engineShown.keys(), ...filmShown.keys()])) {
    const engineCount = engineShown.get(key) ?? 0;
    const filmCount = filmShown.get(key) ?? 0;
    if (engineCount === filmCount) continue;
    // #6400: filmen skjuler en rigtig indhentning (dens regroup-filter kender ikke startlisten).
    issues.push(key.startsWith("breakaway_caught:") && filmCount < engineCount ? FILM_HIDES_CATCH : `film_events ${key.split(":")[0]}`);
  }

  const rankOf = new Map(ranked.map((r: any) => [r.rider_id, r.rank]));
  const bestNonEscapee = Math.min(Infinity, ...ranked.filter((r: any) => !morning.has(r.rider_id)).map((r: any) => r.rank));
  const everWithNonEscapee = (id: string) => (out?.groupSnapshots ?? []).some((s: any) => ((s.groups ?? []).find((g: any) => (g.rider_ids ?? []).includes(id))?.rider_ids ?? []).some((x: string) => !morning.has(x)));
  const filmShows = (id: string, types: string[], incidentToo = false) => filmEvents.some((e) => (types.includes(e.type) && names(e, id)) || (incidentToo && e.type === "incident" && e.params?.rider_id === id && e.params?.outcome === "time_loss"));

  for (const [id, f] of stored) {
    // 1. Maerket foelger morgenudbruddet.
    if (f.in_breakaway !== morning.has(id)) issues.push(`in_breakaway ${id}`);
    if (!f.in_breakaway) continue;
    const nonEscapeeAhead = (rankOf.get(id) ?? Infinity) > bestNonEscapee;
    if (f.breakaway_caught) {
      // 2. Indhentet af nogen: en ikke-udbryder foran eller i hans gruppe.
      if (!nonEscapeeAhead && !everWithNonEscapee(id)) issues.push(`caught_without_bunch ${id}`);
      if (!filmShows(id, ["breakaway_caught", "group_merged"])) issues.push(`caught_not_in_film ${id}`);
    } else if (f.breakaway_dropped === true) {
      // 3. Faldet fra: motorens eget fald eller et uheld med tidstab.
      const engineSaysSo = raw.some((e) => (e.type === "breakaway_dropped" && names(e, id)) || (e.type === "incident" && e.params?.rider_id === id && e.params?.outcome === "time_loss"));
      if (!engineSaysSo) issues.push(`dropped_without_event ${id}`);
      if (!filmShows(id, ["breakaway_dropped"], true)) issues.push(`dropped_not_in_film ${id}`);
    } else if (f.breakaway_dropped === false && nonEscapeeAhead) {
      // 4. Holdt hjem: ingen ikke-udbryder foran.
      issues.push(`survived_behind_bunch ${id}`);
    }
  }
  return issues;
}

// ── Syntetisk: detektoren slaar ud paa fejlens form ──────────────────────────

function synthetic({ events, times, snapshots = [] }: { events: Ev[]; times: Array<[string, number]>; snapshots?: any[] }) {
  const results = times.map(([rider_id, time_seconds], i) => ({ rider_id, rank: i + 1, time_seconds, status: "finished" }));
  const all: Ev[] = [{ km: 0, type: "stage_start", params: { profile_type: "hilly", distance_km: 150 } }, ...events, { km: 150, type: "finish", params: { top: [{ rider_id: results[0].rider_id }] } }];
  return { results, timeline: { events: all }, groupSnapshots: snapshots };
}

const formed: Ev = { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2"], drops_reported: true } };

test("#6285-C detektoren: én historie giver ingen brud", () => {
  const out = synthetic({
    events: [formed, { km: 140, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } }, { km: 140, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["b1", "b2"] } }],
    times: [["p1", 15000], ["b1", 15000], ["p2", 15000], ["b2", 15010]],
  });
  assert.deepEqual(chainViolations({ out, events: out.timeline.events }), []);
});

test("#6285-C detektoren: filmen uden motorens indhentning er to historier", () => {
  const caught: Ev = { km: 140, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["b1", "b2"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } };
  const out = synthetic({ events: [formed, caught], times: [["p1", 15000], ["b1", 15000], ["b2", 15010]] });
  // Den persisterede tidslinje mangler indhentningen.
  const issues = chainViolations({ out, events: out.timeline.events.filter((e: Ev) => e !== caught) });
  assert.ok(issues.includes(FILM_HIDES_CATCH), issues.join("; "));
  assert.ok(issues.includes("caught_not_in_film b1"), issues.join("; "));
});

test("#6285-C detektoren: faldet fra uden motorens fald eller et uheld er et brud", () => {
  // Projektionen (uden drops_reported) laeser et split som et fald; motoren skrev intet fald.
  const noEngineDrops: Ev = { ...formed, params: { ...formed.params, drops_reported: false } };
  const out = synthetic({
    events: [noEngineDrops, { km: 90, type: "peloton_splits", params: { group_id: "solo-1", source_group_id: "breakaway-0", rider_ids: ["b2"] } }, { km: 150, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: ["b1"] } }],
    times: [["b1", 15000], ["p1", 15100], ["b2", 15200]],
  });
  const issues = chainViolations({ out, events: out.timeline.events });
  assert.ok(issues.includes("dropped_without_event b2"), issues.join("; "));
  assert.ok(issues.includes("dropped_not_in_film b2"), issues.join("; "));
  // Et uheld med tidstab er en lovlig grund, og filmen viser det.
  const crash: Ev = { km: 90, type: "incident", params: { rider_id: "b2", kind: "mechanical", outcome: "time_loss", time_loss_seconds: 60, severity: null } };
  const withCrash = synthetic({ events: [noEngineDrops, crash, { km: 150, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: ["b1"] } }], times: [["b1", 15000], ["p1", 15100], ["b2", 15200]] });
  assert.deepEqual(chainViolations({ out: withCrash, events: withCrash.timeline.events }).filter((i) => i.includes("b2")), []);
});

test("#6285-C detektoren: indhentet uden en eneste ikke-udbryder er et brud", () => {
  // Udbryderne samles indbyrdes, men et (forkert) breakaway_caught uden jagtgruppe naevner b1.
  const out = synthetic({
    events: [formed, { km: 140, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["b1"] } }],
    times: [["b1", 15000], ["b2", 15005], ["p1", 15100]],
    snapshots: [{ km: 140, groups: [{ group_id: "breakaway-0", kind: "breakaway", rider_ids: ["b1", "b2"], gap_seconds: 0 }, { group_id: "peloton-0", kind: "peloton", rider_ids: ["p1"], gap_seconds: 100 }] }],
  });
  assert.ok(chainViolations({ out, events: out.timeline.events }).includes("caught_without_bunch b1"));
});

// ── Live: hele Giro-feltet under official_times_v3 ───────────────────────────

const v4 = await loadRaceEngineV4();
const stages: any[] = sortedStages(data);
const { entrants } = splitEntrants(data);
const live: Array<{ where: string; issues: string[]; caught: number; survived: number; dropEvents: number; timeline: boolean }> = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  runStagesInOrder({
    v4, data, revision: REVISION, seedTag: `chain6285-${seed}`, stages, entrants,
    onStage: ({ profile, res }: any) => {
      if (TIME_TRIALS.has(profile.profile_type)) return;
      const stored = [...deriveBreakawayStatus(res.ranked).values()] as any[];
      live.push({
        where: `etape ${profile.stage_number} seed ${seed}`,
        issues: res.timeline ? chainViolations({ out: res.v4Output, events: res.timeline.events, distanceKm: profile.distance_km }) : [],
        caught: stored.filter((f) => f.in_breakaway && f.breakaway_caught).length,
        survived: stored.filter((f) => f.in_breakaway && !f.breakaway_caught && f.breakaway_dropped === false).length,
        dropEvents: (res.v4Output.timeline?.events ?? []).filter((e: Ev) => e.type === "breakaway_dropped").length,
        timeline: Boolean(res.timeline),
      });
    },
  });
}

test(`#6285-C ${REVISION}: forudsaetninger: loebsfilm pr. vejetape og alle tre udfald at maale paa`, () => {
  // Forudsaetning: hver vejetape har en persisteret tidslinje, og kaeden har alle tre udfald at maale paa.
  assert.deepEqual(live.filter((s) => !s.timeline).map((s) => s.where), [], "hver vejetape skal have en loebsfilm");
  assert.ok(live.some((s) => s.caught > 0), "mindst én indhentet udbryder");
  assert.ok(live.some((s) => s.survived > 0), "mindst én udbryder der holdt hjem");
  assert.ok(live.some((s) => s.dropEvents > 0), "motoren skal melde mindst ét fald fra udbruddet");
});

const hardIssues = (s: (typeof live)[number]) => s.issues.filter((i) => i !== FILM_HIDES_CATCH);

test(`#6285-C ${REVISION}: motor, resultatliste og loebsfilm fortaeller samme udbrudshistorie`, () => {
  assert.deepEqual(live.filter((s) => hardIssues(s).length).map((s) => `${s.where}: ${hardIssues(s).join("; ")}`), []);
});

// Haard gate (#6400): filmen faar samme startliste som broen.
test(`#6285-C ${REVISION}: filmen skjuler ingen af motorens indhentninger`, () => {
  assert.deepEqual(live.filter((s) => s.issues.includes(FILM_HIDES_CATCH)).map((s) => s.where), []);
});
