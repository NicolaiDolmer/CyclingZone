// #5978: anker for "farlig rytter i udbrud" (ejer-design 5/10: hoej risiko, hoej
// gevinst) paa Giro-feltet fra #6088 (anonymiseret: samme startliste, roller,
// holdordrer og evner, ingen navne eller id'er).
//
// Prod-etapen (bjergetape 6): klassementets nr. 8 sad i et udbrud paa otte, alle
// sendt af deres manager; forspringet voksede langt over hans afstand, og hver
// reaktion stoppede som "contained". Prod-etapens eget seed er saltet og kan ikke
// genskabes, saa ankeret koerer etapen over flere seeds med samme klassement foer
// etapen (etape 1-5 koert i raekkefoelge under orders_gc_v2, som i prod) og
// genskaber situationen: GC-nr. 8 og tre ryttere omkring nr. 21-24 faar en
// udbrudsordre, fire jaegere fylder op.
//
// Maaler pr. revision (runDangerousRiderLeash):
//  - escapedSeeds: seeds hvor GC-nr. 8 kom afsted (dannelsen).
//  - containedWhileIn: reaktioner der stoppede som "contained", mens han sad i
//    udbruddet og forspringet stadig var over hans afstand til holdets GC-rytter.
//  - maxLeadWhileIn: stoerste forspring (s) mens han sad i udbruddet.
//  - survivedWithHim: udbruddet holdt hjem med ham.
// scorecard (runScorecard): andel etaper med en farlig rytter (klassementets
// top 10) i udbruddet, og hvor ofte et saadant udbrud holder hjem, hele Giroen.
// READ-ONLY og deterministisk: ingen DB, kun fixturet. Tallene hoerer til
// balance-internals/ (hard rule 17), aldrig i repoet.
//
// Koer:
//   node backend/scripts/dev/dangerousRiderLeash5978.mjs [--seeds=6] [--mode=anchor|scorecard|both]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture } from "./giroCaptainTimeLoss6088.mjs";

export const ANCHOR_STAGE = 6;
/** Klassementspladserne i prod-udbruddet (nr. 8 er den farlige rytter). */
export const ANCHOR_GC_RANKS = Object.freeze([8, 21, 23, 24]);
export const DANGEROUS_RANK = 8;
const REVISIONS = ["orders_gc_v2", "orders_gc_v3"];

function entrantsOf(data, inRace) {
  const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  return data.entries.filter((e) => abilitiesById.has(e.rider_id) && (!inRace || inRace.has(e.rider_id))).map((e) => {
    const { rider_id: _r, ...abilities } = abilitiesById.get(e.rider_id);
    return { rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities };
  });
}

function stagesOf(data) {
  return data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
}

function simulate({ v4, data, orders, stageNumber, rules, entrants, gcStandings, seedTag }) {
  const stages = stagesOf(data);
  return v4.simulateStage({
    entrants, stageProfile: stages.find((p) => p.stage_number === stageNumber), seedString: `${data.race.id}:${stageNumber}:${seedTag}`, stageNumber,
    teamOrderRows: orders ?? data.orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null,
    rulesRevision: rules, gcStandings,
  }).v4Output;
}

/**
 * Klassementet foer hver etape: etaperne koert i raekkefoelge under `rules` med
 * ét fast seed. Map stage_number -> { standings, inRace }.
 */
export function standingsChain({ v4, data, lastStage, rules = "orders_gc_v2", seedTag = "gc5978" }) {
  const out = new Map();
  let inRace = new Set(data.entries.map((e) => e.rider_id));
  const gc = new Map([...inRace].map((id) => [id, 0]));
  for (let st = 1; st <= lastStage; st++) {
    const standings = st === 1 ? [] : [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
    out.set(st, { standings, inRace: new Set(inRace) });
    if (st === lastStage) break;
    const res = simulate({ v4, data, stageNumber: st, rules, entrants: entrantsOf(data, inRace), gcStandings: standings, seedTag });
    const fin = res.results.filter((r) => r.status === "finished");
    const bonus = new Map((res.passage_totals ?? []).map((t) => [t.rider_id, t.bonus_seconds ?? 0]));
    for (const r of fin) gc.set(r.rider_id, (gc.get(r.rider_id) ?? 0) + r.time_seconds - (bonus.get(r.rider_id) ?? 0));
    const finIds = new Set(fin.map((r) => r.rider_id));
    for (const id of [...gc.keys()]) if (!finIds.has(id)) gc.delete(id);
    inRace = finIds;
  }
  return out;
}

/**
 * Prod-situationen: GC-nr. 8 og nr. 21/23/24 faar en udbrudsordre fra deres
 * manager, fire jaegere fra andre hold fylder op. Kun de beroerte holds ordre
 * for etapen aendres (andre hold koerer fixturets ordre/rolle-standard).
 */
export function anchorOrders({ data, standings, stageNumber = ANCHOR_STAGE }) {
  const teamOf = new Map(data.entries.map((e) => [e.rider_id, e.team_id]));
  const roleOf = new Map(data.entries.map((e) => [e.rider_id, e.race_role]));
  const ranked = standings.map((s) => s.rider_id);
  const gcRiders = ANCHOR_GC_RANKS.map((rank) => ranked[rank - 1]).filter(Boolean);
  const used = new Set(gcRiders.map((id) => teamOf.get(id)));
  const fillers = [];
  // Fyld op med ryttere langt nede i klassementet (ingen GC-trussel), som i prod.
  for (const id of ranked.slice(Math.floor(ranked.length / 2))) {
    if (fillers.length >= 8 - gcRiders.length) break;
    const team = teamOf.get(id);
    if (used.has(team) || roleOf.get(id) === "captain" || roleOf.get(id) === "sprint_captain") continue;
    fillers.push(id);
    used.add(team);
  }
  const breakIds = new Set([...gcRiders, ...fillers]);
  const byTeam = new Map();
  for (const id of breakIds) byTeam.set(teamOf.get(id), [...(byTeam.get(teamOf.get(id)) ?? []), id]);
  const orders = data.orders.map((o) => {
    if (o.stage_number !== stageNumber || !byTeam.has(o.team_id)) return o;
    const ids = new Set(byTeam.get(o.team_id));
    const riders = o.riders.map((r) => ({ ...r, try_break: ids.has(r.rider_id) || r.try_break === true }));
    for (const id of ids) if (!riders.some((r) => r.rider_id === id)) riders.push({ rider_id: id, try_break: true, effort: "normal", leadout: false });
    return { ...o, riders };
  });
  for (const [teamId, ids] of byTeam) {
    if (orders.some((o) => o.stage_number === stageNumber && o.team_id === teamId)) continue;
    orders.push({ team_id: teamId, race_id: data.race.id, stage_number: stageNumber, breakaway_stance: "neutral", riders: ids.map((id) => ({ rider_id: id, try_break: true, effort: "normal", leadout: false })) });
  }
  return { orders, dangerousId: ranked[DANGEROUS_RANK - 1], breakIds: [...breakIds].sort() };
}

/** Gruppen med `riderId` i et snapshot (dagens udbrud har gruppe-art "breakaway"/"solo"). */
function leadOf(snapshot, riderId) {
  const group = snapshot.groups.find((g) => g.rider_ids.includes(riderId));
  if (!group || (group.kind !== "breakaway" && group.kind !== "solo")) return null;
  const behind = snapshot.groups.filter((g) => g.gap_seconds > group.gap_seconds && g.rider_ids.length >= 20);
  if (behind.length === 0) return null;
  return Math.min(...behind.map((g) => g.gap_seconds)) - group.gap_seconds;
}

/**
 * Ét forloeb: hvornaar sad den farlige rytter i udbruddet, hvor stort var
 * forspringet, og stoppede en reaktion som "contained" mens forspringet var over
 * hans afstand til holdets GC-rytter (den beskyttede rytter i eventet).
 */
export function analyzeAnchorRun(out, dangerousId, gapById, isRivalFor = () => true) {
  const snapshots = [...(out.groupSnapshots ?? [])].sort((a, b) => a.km - b.km);
  // Forspringet holdene besluttede ud fra: segmentets START (snapshottet foer
  // eventets km; eventet staar paa segmentets slut-km).
  const leadAt = (km) => {
    let hit = null;
    for (const s of snapshots) if (s.km < km - 1e-6) hit = s;
    return hit ? leadOf(hit, dangerousId) : null;
  };
  const events = out.timeline.events;
  const escaped = events.some((e) => e.type === "breakaway_formed" && (e.params?.rider_ids ?? []).includes(dangerousId));
  let maxLead = 0;
  for (const s of snapshots) {
    const lead = leadOf(s, dangerousId);
    if (lead !== null) maxLead = Math.max(maxLead, lead);
  }
  let containedWhileIn = 0;
  let stoppedWhileIn = 0;
  for (const e of events) {
    if (e.type !== "gc_reaction" || e.params?.status !== "stopped") continue;
    const lead = leadAt(e.km);
    if (lead === null) continue;
    stoppedWhileIn += 1;
    const protectedGap = gapById.get(e.params.protected_rider_id);
    const deficit = (gapById.get(dangerousId) ?? 0) - (protectedGap ?? 0);
    // Kun hold for hvem han er en reel rival bag deres GC-rytter (ellers er stoppet legitimt).
    if (e.params.reason === "contained" && protectedGap !== undefined && deficit > 0 && lead > deficit && isRivalFor(e.params.protected_rider_id)) containedWhileIn += 1;
  }
  const survived = events.some((e) => e.type === "breakaway_survived" && (e.params?.rider_ids ?? []).includes(dangerousId));
  const attempt = events.find((e) => e.type === "breakaway_attempt");
  return {
    escaped, attempted: (attempt?.params?.rider_ids ?? []).includes(dangerousId), maxLead, containedWhileIn, stoppedWhileIn, survived,
    stopReasons: events.filter((e) => e.type === "gc_reaction" && e.params?.status === "stopped").map((e) => e.params.reason),
  };
}

export function runDangerousRiderLeash({ v4, data, revisions = REVISIONS, seeds = 6, stageNumber = ANCHOR_STAGE, chain }) {
  const before = (chain ?? standingsChain({ v4, data, lastStage: stageNumber })).get(stageNumber);
  const ranked = before.standings.map((s) => s.rider_id);
  const best = before.standings[0]?.time ?? 0;
  const gapById = new Map(before.standings.map((s) => [s.rider_id, s.time - best]));
  const { orders, dangerousId, breakIds } = anchorOrders({ data, standings: before.standings, stageNumber });
  const entrants = entrantsOf(data, before.inRace);
  // Samme rival-maal som motoren (gcThreat: klatring/tempo/enkeltstart).
  const gcAbility = new Map(data.abilities.map((a) => [a.rider_id, (a.climbing + a.tempo + a.time_trial) / 3]));
  const isRivalFor = (protectedId) => (gcAbility.get(dangerousId) ?? 0) >= 0.92 * (gcAbility.get(protectedId) ?? Infinity);
  const result = { dangerousRank: ranked.indexOf(dangerousId) + 1, breakSize: breakIds.length };
  for (const rules of revisions) {
    const row = { attemptedSeeds: 0, escapedSeeds: 0, containedWhileIn: 0, stoppedWhileIn: 0, survivedWithHim: 0, maxLeadWhileIn: [], stopReasons: {} };
    for (let s = 1; s <= seeds; s++) {
      const out = simulate({ v4, data, orders, stageNumber, rules, entrants, gcStandings: before.standings, seedTag: `anchor5978-${s}` });
      const a = analyzeAnchorRun(out, dangerousId, gapById, isRivalFor);
      if (a.attempted) row.attemptedSeeds += 1;
      if (a.escaped) row.escapedSeeds += 1;
      row.containedWhileIn += a.containedWhileIn;
      row.stoppedWhileIn += a.stoppedWhileIn;
      if (a.survived) row.survivedWithHim += 1;
      if (a.escaped) row.maxLeadWhileIn.push(Math.round(a.maxLead));
      for (const r of a.stopReasons) row.stopReasons[r] = (row.stopReasons[r] ?? 0) + 1;
    }
    result[rules] = row;
  }
  return result;
}

/**
 * Hele Giroen (alle linjeloebsetaper efter etape 1), samme klassement foer hver
 * etape for begge revisioner. "Farlig" = klassementets top 10 foer etapen (prod-
 * maalingens definition); "holder hjem" = udbruddet overlever til maal med ham.
 */
export function runScorecard({ v4, data, revisions = REVISIONS, seeds = 4, chain }) {
  const stages = stagesOf(data).filter((p) => p.stage_number > 1 && !String(p.profile_type).startsWith("itt"));
  const lastStage = Math.max(...stages.map((p) => p.stage_number));
  const gcChain = chain ?? standingsChain({ v4, data, lastStage });
  const result = {};
  for (const rules of revisions) {
    const row = { stages: 0, withDangerous: 0, dangerousHeld: 0, breaks: 0, breaksHeld: 0 };
    for (const p of stages) {
      const before = gcChain.get(p.stage_number);
      const top10 = new Set(before.standings.slice(0, 10).map((s) => s.rider_id));
      const entrants = entrantsOf(data, before.inRace);
      for (let s = 1; s <= seeds; s++) {
        const out = simulate({ v4, data, stageNumber: p.stage_number, rules, entrants, gcStandings: before.standings, seedTag: `score5978-${s}` });
        const events = out.timeline.events;
        const formed = events.find((e) => e.type === "breakaway_formed");
        const survived = events.find((e) => e.type === "breakaway_survived" && e.params?.group_id === formed?.params?.group_id);
        row.stages += 1;
        if (formed) row.breaks += 1;
        if (survived) row.breaksHeld += 1;
        if (formed && formed.params.rider_ids.some((id) => top10.has(id))) {
          row.withDangerous += 1;
          if (survived && (survived.params?.rider_ids ?? []).some((id) => top10.has(id))) row.dangerousHeld += 1;
        }
      }
    }
    result[rules] = row;
  }
  return result;
}

/**
 * Endagsloeb (samme ruter koert som endagsloeb, ingen klassement): "farlig" =
 * en af feltets 10 bedste paa dagens rute (finalens evne-krav, samme vektor
 * som motoren). Maaler de samme to tal som runScorecard.
 */
export function runOneDayScorecard({ v4, data, revisions = REVISIONS, seeds = 3, demandFor }) {
  const stages = stagesOf(data).filter((p) => !String(p.profile_type).startsWith("itt"));
  const entrants = entrantsOf(data);
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  const result = {};
  for (const rules of revisions) {
    const row = { stages: 0, withDangerous: 0, dangerousHeld: 0, breaks: 0, breaksHeld: 0 };
    for (const p of stages) {
      const demand = demandFor(p);
      const score = (id) => Object.entries(demand).reduce((s, [k, w]) => s + w * Math.min(99, Math.max(0, abilitiesById.get(id)?.[k] ?? 0)) / 99, 0);
      const top10 = new Set(entrants.map((e) => e.rider_id).sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, 10));
      for (let s = 1; s <= seeds; s++) {
        const out = v4.simulateStage({
          entrants, stageProfile: p, seedString: `${data.race.id}:${p.stage_number}:oneday5978-${s}`, stageNumber: 1,
          teamOrderRows: [], isStageRace: false, raceStages: null, squad: data.race.squad ?? null, rulesRevision: rules, gcStandings: null,
        }).v4Output;
        const events = out.timeline.events;
        const formed = events.find((e) => e.type === "breakaway_formed");
        const survived = events.find((e) => e.type === "breakaway_survived" && e.params?.group_id === formed?.params?.group_id);
        row.stages += 1;
        if (formed) row.breaks += 1;
        if (survived) row.breaksHeld += 1;
        if (formed && formed.params.rider_ids.some((id) => top10.has(id))) {
          row.withDangerous += 1;
          if (survived && (survived.params?.rider_ids ?? []).some((id) => top10.has(id))) row.dangerousHeld += 1;
        }
      }
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
  const data = loadFixture();
  const mode = arg("mode", "both");
  const seeds = Number(arg("seeds", "6"));
  const out = {};
  const chain = standingsChain({ v4, data, lastStage: Math.max(...data.profiles.map((p) => p.stage_number)) });
  if (mode !== "scorecard") out.anchor = runDangerousRiderLeash({ v4, data, seeds, chain });
  if (mode !== "anchor") out.scorecard = runScorecard({ v4, data, seeds: Number(arg("scoreSeeds", "3")), chain });
  if (mode === "oneday" || mode === "both") {
    const { RACE_V4_TUNING } = await import("../../lib/engine/v4/tuning.ts");
    const { routeFromStageProfileRow } = await import("../../lib/engine/v4/adapters/routeAdapter.ts");
    const { fieldFinaleTypeBehindBreakaway } = await import("../../lib/engine/v4/finale.ts");
    const demandFor = (profile) => {
      const route = routeFromStageProfileRow(profile);
      const finale = route.finale_type === "breakaway" ? fieldFinaleTypeBehindBreakaway(route) : route.finale_type;
      return (finale && RACE_V4_TUNING.finale.demandVectorByFinaleType[finale]) || {};
    };
    out.oneDay = runOneDayScorecard({ v4, data, seeds: Number(arg("scoreSeeds", "3")), demandFor });
  }
  console.log(JSON.stringify(out, null, 2));
}
