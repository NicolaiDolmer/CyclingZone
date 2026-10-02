// #6088: anker for GC-kaptajnernes tidstab i et RIGTIGT felt (anonymiseret
// udsnit af et etapeloebs startliste, roller, holdordrer, evner og etaper).
//
// Maaler kaptajnernes tidstab til etapevinderen paa de kuperede/bjerg-etaper
// under en regel-revision. To tilstande:
//  - chain: etape 1..N koeres i raekkefoelge, og GC akkumuleres, saa hver
//    etape faar GC-standings som i prod (GC-reaktionen er i spil fra etape 2).
//  - single: hver etape koeres alene uden GC-standings (som dryRunUpcomingStage).
// READ-ONLY og deterministisk: ingen DB, kun fixturet.
//
// Koer:
//   node backend/scripts/dev/giroCaptainTimeLoss6088.mjs [--rules=orders_gc_v1] [--seeds=5] [--mode=chain|single] [--fixture=<fil>]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = path.join(here, "..", "baselines", "giro-field-6088-2026-10-02.json");
/** Etaperne med stigninger i fixturet (kuperet/bjerg/hoejt bjerg). */
export const CLIMB_PROFILES = Object.freeze(["hilly", "mountain", "high_mountain"]);
const LEADERS = new Set(["captain", "sprint_captain", "helper"]);

export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function loadFixture(file = DEFAULT_FIXTURE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function entrantsOf(data) {
  const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  return data.entries.filter((e) => abilitiesById.has(e.rider_id)).map((e) => {
    const { rider_id: _r, ...abilities } = abilitiesById.get(e.rider_id);
    return { rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities };
  });
}

/**
 * Pr. maalt etape: median over seeds af kaptajnernes median-tidstab (s) til
 * etapevinderen, plus antal rolle-brud (leder i udbruddet uden "Forsoeg udbrud").
 * @returns {{ stages: Array<{stage:number, profile:string, captainMedianGap:number, violators:number}>, meanOfStageMedians:number }}
 */
export function runCaptainTimeLoss({ v4, data, rules, seeds = 5, mode = "chain" }) {
  const all = entrantsOf(data);
  const roleById = new Map(all.map((e) => [e.rider_id, e.race_role]));
  const aiById = new Map(all.map((e) => [e.rider_id, e.team_is_ai === true]));
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
  const targets = stages.filter((p) => CLIMB_PROFILES.includes(p.profile_type)).map((p) => p.stage_number);
  const maxTarget = Math.max(...targets);
  const per = new Map(targets.map((t) => [t, { gaps: [], violators: 0 }]));
  const tryBreak = new Map();
  for (const o of data.orders) for (const r of o.riders || []) tryBreak.set(`${o.stage_number}:${r.rider_id}`, r.try_break === true);

  for (let s = 1; s <= seeds; s++) {
    let inRace = new Set(all.map((e) => e.rider_id));
    const gc = new Map([...inRace].map((id) => [id, 0]));
    for (const profile of stages) {
      const st = profile.stage_number;
      if (st > maxTarget) break;
      if (mode === "single" && !per.has(st)) continue;
      const entrants = all.filter((e) => inRace.has(e.rider_id));
      const standings = mode === "single" ? null
        : st === 1 ? []
        : [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
      const res = v4.simulateStage({
        entrants, stageProfile: profile, seedString: `${data.race.id}:${st}:anchor${s}`, stageNumber: st,
        teamOrderRows: data.orders, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null,
        rulesRevision: rules, gcStandings: standings,
      });
      const out = res.v4Output;
      const fin = out.results.filter((r) => r.status === "finished");
      if (per.has(st)) {
        const winT = Math.min(...fin.map((r) => r.time_seconds));
        const caps = fin.filter((r) => roleById.get(r.rider_id) === "captain").map((r) => r.time_seconds - winT);
        const bucket = per.get(st);
        bucket.gaps.push(median(caps));
        const formed = out.timeline.events.filter((e) => e.type === "breakaway_formed").flatMap((e) => e.params.rider_ids || []);
        // #6097: under orders_gc_v2 sender AI-hold selv en hjaelper i udbrud (M14). Rolle-reglen gaelder spillernes ryttere.
        bucket.violators += formed.filter((id) => !aiById.get(id) && LEADERS.has(roleById.get(id)) && tryBreak.get(`${st}:${id}`) !== true).length;
      }
      if (mode === "single") continue;
      const bonus = new Map((out.passage_totals ?? []).map((t) => [t.rider_id, t.bonus_seconds ?? 0]));
      for (const r of fin) gc.set(r.rider_id, (gc.get(r.rider_id) ?? 0) + r.time_seconds - (bonus.get(r.rider_id) ?? 0));
      const finIds = new Set(fin.map((r) => r.rider_id));
      for (const id of [...gc.keys()]) if (!finIds.has(id)) gc.delete(id);
      inRace = finIds;
    }
  }
  const rows = targets.map((st) => ({
    stage: st,
    profile: stages.find((p) => p.stage_number === st).profile_type,
    captainMedianGap: median(per.get(st).gaps),
    violators: per.get(st).violators,
  }));
  const meanOfStageMedians = rows.reduce((a, r) => a + r.captainMedianGap, 0) / rows.length;
  return { stages: rows, meanOfStageMedians };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
  };
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const data = loadFixture(arg("fixture", DEFAULT_FIXTURE));
  const result = runCaptainTimeLoss({ v4, data, rules: arg("rules", "orders_gc_v1"), seeds: Number(arg("seeds", "5")), mode: arg("mode", "chain") });
  console.log(JSON.stringify(result, null, 2));
}
