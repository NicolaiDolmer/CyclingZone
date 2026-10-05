// #6187: anker for "et hold jagter aldrig sine egne" paa Giro-etapen hvor fejlen
// blev set i prod (bjergetape 7 i det anonymiserede Giro-felt fra #6088:
// samme startliste, roller, holdordrer og evner, ingen navne eller id'er).
//
// Prod-etapens eget seed er saltet og kan ikke genskabes, saa ankeret koerer
// etapen over flere seeds med samme klassement foer etapen (etape 1-6 koert i
// raekkefoelge under orders_gc_v2, som i prod) og maaler, pr. revision:
//  - violations: et hold jager sine egne (se ownChaseViolations).
//  - teamViolations: det samme for prod-holdet (Hold A, fixture-alias).
//  - ownRidersAhead: antal "own_riders_ahead"-linjer og hoejst antal pr. hold.
// READ-ONLY og deterministisk: ingen DB, kun fixturet.
//
// Koer:
//   node backend/scripts/dev/ownRiderAhead6187.mjs [--seeds=8] [--rules=orders_gc_v2,orders_gc_v3] [--scenario=prod|fixture]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture } from "./giroCaptainTimeLoss6088.mjs";

/** Prod-etapen (etape 7) og prod-holdet i det anonymiserede #6088-felt. */
export const ANCHOR_STAGE = 7;
export const ANCHOR_TEAM = "t11";

function entrantsOf(data, inRace) {
  const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  return data.entries.filter((e) => abilitiesById.has(e.rider_id) && (!inRace || inRace.has(e.rider_id))).map((e) => {
    const { rider_id: _r, ...abilities } = abilitiesById.get(e.rider_id);
    return { rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities };
  });
}

function simulate({ v4, data, stageNumber, rules, entrants, gcStandings, seedTag }) {
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
  const profile = stages.find((p) => p.stage_number === stageNumber);
  return v4.simulateStage({
    entrants, stageProfile: profile, seedString: `${data.race.id}:${stageNumber}:${seedTag}`, stageNumber,
    teamOrderRows: data.orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null,
    rulesRevision: rules, gcStandings,
  }).v4Output;
}

/**
 * Klassementet foer etape `stageNumber`: etape 1..N-1 koert i raekkefoelge
 * under `rules` med ét fast seed (som giroCaptainTimeLoss6088's chain-tilstand).
 */
export function standingsBefore({ v4, data, stageNumber = ANCHOR_STAGE, rules = "orders_gc_v2" }) {
  let inRace = new Set(data.entries.map((e) => e.rider_id));
  const gc = new Map([...inRace].map((id) => [id, 0]));
  for (let st = 1; st < stageNumber; st++) {
    const standings = st === 1 ? [] : [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
    const out = simulate({ v4, data, stageNumber: st, rules, entrants: entrantsOf(data, inRace), gcStandings: standings, seedTag: "gc6187" });
    const fin = out.results.filter((r) => r.status === "finished");
    const bonus = new Map((out.passage_totals ?? []).map((t) => [t.rider_id, t.bonus_seconds ?? 0]));
    for (const r of fin) gc.set(r.rider_id, (gc.get(r.rider_id) ?? 0) + r.time_seconds - (bonus.get(r.rider_id) ?? 0));
    const finIds = new Set(fin.map((r) => r.rider_id));
    for (const id of [...gc.keys()]) if (!finIds.has(id)) gc.delete(id);
    inRace = finIds;
  }
  return [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
}

/**
 * Et hold der jager sine egne, i én etapes tidslinje:
 *  - en GC-reaktion starter med en af holdets egne paa trusselslisten (prod-
 *    symptomet: holdets to udbrydere stod paa listen);
 *  - et udbrud hentes med holdet blandt de jagende hold, mens en af holdets
 *    egne sidder i udbruddet.
 * En reaktion mod en ANDEN gruppe (uden egne) er lovlig og taelles ikke.
 */
export function ownChaseViolations(events, teamByRider) {
  const out = [];
  for (const e of events) {
    const p = e.params ?? {};
    if (e.type === "gc_reaction" && p.status === "started") {
      const own = (p.rider_ids ?? []).filter((id) => teamByRider.get(id) === p.team_id);
      if (own.length) out.push({ km: e.km, kind: "gc_reaction", team_id: p.team_id, own });
    }
    if (e.type === "breakaway_caught") {
      for (const teamId of p.chasing_team_ids ?? []) {
        const own = (p.rider_ids ?? []).filter((id) => teamByRider.get(id) === teamId);
        if (own.length) out.push({ km: e.km, kind: "chase", team_id: teamId, own });
      }
    }
  }
  return out;
}

/**
 * Prod-situationen paa etapen: Hold A koerer neutralt med to holdkammerater i
 * udbruddet, mens holdets bedste mand i klassementet sidder bag dem. Fixturets
 * ordrer er fra foer loebet (Hold A stod paa "jagt" uden udbrudsforsoeg), og
 * klassementet er simuleret, saa situationen genskabes paa Hold A's to bedst
 * placerede ryttere efter kaptajnen (i prod: holdets nr. 5 og nr. 11 foran
 * holdets nr. 2). Kun Hold A's ordre for etapen aendres.
 */
export function prodSituationOrders({ data, standings, stageNumber = ANCHOR_STAGE, team = ANCHOR_TEAM }) {
  const teamOf = new Map(data.entries.map((e) => [e.rider_id, e.team_id]));
  const own = standings.map((s) => s.rider_id).filter((id) => teamOf.get(id) === team);
  const breakIds = new Set(own.slice(1, 3));
  return data.orders.map((o) => (o.team_id !== team || o.stage_number !== stageNumber ? o : {
    ...o,
    breakaway_stance: "neutral",
    riders: o.riders.map((r) => ({ ...r, try_break: breakIds.has(r.rider_id) })),
  }));
}

/**
 * Prod-symptomet for ét hold: holdet starter en GC-reaktion mod morgenudbruddet
 * (truslen sidder i det), mens en af holdets egne ogsaa sidder i det. Udbruddets
 * sammensaetning laeses af gruppe-snapshottet ved reaktionens km (udbruddet
 * beholder sit gruppe-id hele dagen).
 */
export function teamChasesOwnBreakaway(events, groupSnapshots, teamByRider, team) {
  const formed = events.find((e) => e.type === "breakaway_formed");
  if (!formed) return [];
  const groupId = formed.params.group_id;
  const snapshots = [...(groupSnapshots ?? [])].sort((a, b) => a.km - b.km);
  const membersAt = (km) => {
    let hit = null;
    for (const s of snapshots) if (s.km <= km + 1e-6) hit = s;
    return hit ? hit.groups.find((g) => g.group_id === groupId)?.rider_ids ?? [] : formed.params.rider_ids ?? [];
  };
  return events
    .filter((e) => e.type === "gc_reaction" && e.params?.status === "started" && e.params.team_id === team)
    .filter((e) => {
      const members = membersAt(e.km);
      return members.some((id) => teamByRider.get(id) === team) && (e.params.rider_ids ?? []).some((id) => members.includes(id));
    })
    .map((e) => e.km);
}

/**
 * Etape `stageNumber` over `seeds` seeds under hver revision, med samme
 * klassement foer etapen. `scenario`: "fixture" (ordrerne som i fixturet) eller
 * "prod" (prodSituationOrders).
 */
export function runOwnRiderAhead({ v4, data, revisions = ["orders_gc_v2", "orders_gc_v3"], seeds = 8, stageNumber = ANCHOR_STAGE, team = ANCHOR_TEAM, scenario = "prod" }) {
  const standings = standingsBefore({ v4, data, stageNumber });
  const inRace = new Set(standings.map((s) => s.rider_id));
  const entrants = entrantsOf(data, inRace);
  const teamByRider = new Map(entrants.map((e) => [e.rider_id, e.team_id]));
  const stageData = scenario === "prod" ? { ...data, orders: prodSituationOrders({ data, standings, stageNumber, team }) } : data;
  const result = {};
  for (const rules of revisions) {
    const row = { violations: 0, teamViolations: 0, teamChasesOwnBreakaway: 0, teamOwnInBreakSeeds: 0, ownRidersAhead: 0, teamLines: {}, maxOwnRidersAheadPerTeam: 0, seeds: [] };
    for (let s = 1; s <= seeds; s++) {
      const out = simulate({ v4, data: stageData, stageNumber, rules, entrants, gcStandings: standings, seedTag: `anchor${s}` });
      const events = out.timeline.events;
      const v = ownChaseViolations(events, teamByRider);
      const formed = events.filter((e) => e.type === "breakaway_formed").flatMap((e) => e.params?.rider_ids ?? []);
      const lines = events.filter((e) => e.type === "own_riders_ahead");
      const perTeam = new Map();
      for (const l of lines) perTeam.set(l.params.team_id, (perTeam.get(l.params.team_id) ?? 0) + 1);
      row.violations += v.length;
      row.teamViolations += v.filter((x) => x.team_id === team).length;
      row.teamChasesOwnBreakaway += teamChasesOwnBreakaway(events, out.groupSnapshots, teamByRider, team).length;
      if (formed.some((id) => teamByRider.get(id) === team)) row.teamOwnInBreakSeeds += 1;
      row.ownRidersAhead += lines.length;
      for (const l of lines.filter((x) => x.params.team_id === team)) row.teamLines[l.params.reason] = (row.teamLines[l.params.reason] ?? 0) + 1;
      row.maxOwnRidersAheadPerTeam = Math.max(row.maxOwnRidersAheadPerTeam, ...perTeam.values(), 0);
      row.seeds.push({ seed: s, violations: v.length, team: v.filter((x) => x.team_id === team).length, lines: lines.length });
    }
    result[rules] = row;
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
  };
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const result = runOwnRiderAhead({ v4, data: loadFixture(), seeds: Number(arg("seeds", "8")), revisions: arg("rules", "orders_gc_v2,orders_gc_v3").split(","), scenario: arg("scenario", "prod") });
  for (const row of Object.values(result)) delete row.seeds;
  console.log(JSON.stringify(result, null, 2));
}
