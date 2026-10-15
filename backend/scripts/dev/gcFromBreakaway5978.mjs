#!/usr/bin/env node
// backend/scripts/dev/gcFromBreakaway5978.mjs
// #5978 (ejer 15/10): "klassementet vindes fra udbrud". Maaler paa S5-etapeloebene
// (samme loeb, ruter og felt som s5MotorBench.mjs) to ting prod-gennemgangen 15/10
// fandt (docs/audits/2026-10-15-motor-gennemgang.md, fund 4):
//
//   1. gcWinnerInBreak: andel af etapeloebene hvor slutklassementets vinder sad i et
//      morgenudbrud paa mindst én etape ("member"), og hvor han sad i et udbrud der
//      holdt hjem ("held": breakaway_survived).
//   2. hunterVsCaptain: ryttere med middel klassementsevne (feltets GC-evne-rang
//      MID_RANKS) koert som udbrudsjaeger mod som kaptajn. Kontrolleret: samme ryttere
//      i to arme med byttede roller (arm "odd": ulige rang er jaeger, lige rang er
//      kaptajn; arm "even": omvendt), saa hver rytter maales i begge roller paa samme
//      ruter og seeds. Maal: andel der ender i klassementets top 10.
//
// Alle hold er AI-hold (M14-standardordrer), som i s5MotorBench: en jaeger forsoeger
// udbrud via sin rolles default, en kaptajn kun med ordre.
//
// HARD RULE 17: tallene skrives KUN til balance-internals/ (gitignoreret), aldrig i repoet.
//
// Koer (offline, ingen DB, intet netvaerk):
//   node backend/scripts/dev/gcFromBreakaway5978.mjs --revision=s5_profiles_v1 --out=balance-internals/5978/after.json
//   flag: --revision (default s5_profiles_v1)  --genSeeds (default 1)  --simSeeds (default 2)
//         --maxStages (default 99; spring loeb med flere etaper over)  --scope (gt|all, default all)
//
// Refs #5978

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import { buildS5BenchRaces, benchStageFatigues, loadBenchField } from "./s5MotorBench.mjs";
import { breakawaySets, runStagesInOrder, splitEntrants } from "./lib/tourScorecard.mjs";

/** Feltets GC-evne-rang (1 = bedst) der maales i hunterVsCaptain (prod-fundets 16-30). */
export const MID_RANKS = Object.freeze([16, 30]);
const GC_KEYS = ["climbing", "tempo", "time_trial"];
const TT_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

/** Samme GC-evne som gcThreat.ts: gennemsnit af klatring, tempo og tidskoersel. */
export function gcAbilityOf(abilities) {
  return GC_KEYS.reduce((s, k) => s + Math.max(0, Math.min(99, Number(abilities?.[k]) || 0)) / 99, 0) / GC_KEYS.length;
}

/** rider_id -> GC-evne-rang i feltet (1 = bedst; lige evne: rider_id). */
export function gcRankById(field) {
  const sorted = field.abilities.map((a) => ({ id: a.rider_id, g: gcAbilityOf(a) })).sort((a, b) => b.g - a.g || a.id.localeCompare(b.id));
  return new Map(sorted.map((r, i) => [r.id, i + 1]));
}

/** Feltet med roller for MID_RANKS-rytterne i armen ("odd"/"even"; "base" = uaendret). */
export function fieldForArm(field, arm, rankById = gcRankById(field)) {
  if (arm === "base") return field;
  const [lo, hi] = MID_RANKS;
  const entries = field.entries.map((e) => {
    const rank = rankById.get(e.rider_id);
    if (!(rank >= lo && rank <= hi)) return e;
    const hunter = (rank % 2 === 1) === (arm === "odd");
    return { ...e, race_role: hunter ? "hunter" : "captain" };
  });
  return { ...field, entries };
}

/** Et loebs maalinger for ét seed (ren). */
export function measureRace({ stageOutputs, finalGc, roleById, rankById }) {
  const member = new Set();
  const held = new Set();
  for (const { profile, out } of stageOutputs) {
    if (TT_PROFILES.has(profile.profile_type)) continue;
    const { formed } = breakawaySets(out);
    for (const id of formed) member.add(id);
    const events = out?.timeline?.events ?? [];
    for (const e of events) if (e.type === "breakaway_survived") for (const id of e.params?.rider_ids ?? []) if (formed.has(id)) held.add(id);
  }
  const winner = finalGc[0]?.rider_id ?? null;
  const top10 = new Set(finalGc.slice(0, 10).map((r) => r.rider_id));
  const [lo, hi] = MID_RANKS;
  const mid = [];
  for (const r of finalGc) {
    const rank = rankById.get(r.rider_id);
    if (!(rank >= lo && rank <= hi)) continue;
    mid.push({ role: roleById.get(r.rider_id) ?? null, top10: top10.has(r.rider_id), inBreak: member.has(r.rider_id) });
  }
  return { winnerInBreak: winner !== null && member.has(winner), winnerInHeldBreak: winner !== null && held.has(winner), mid };
}

export async function runGcFromBreakaway({ revision = "s5_profiles_v1", genSeeds = 1, simSeeds = 2, maxStages = 99, scope = "all", arms = ["base", "odd", "even"], v4 = null } = {}) {
  const engine = v4 ?? await loadRaceEngineV4();
  const baseField = loadBenchField();
  const rankById = gcRankById(baseField);
  const races = buildS5BenchRaces({ genSeeds, scope }).filter((r) => r.stages.length > 1 && r.stages.length <= maxStages);
  const rows = [];
  for (const arm of arms) {
    const field = fieldForArm(baseField, arm, rankById);
    const roleById = new Map(field.entries.map((e) => [e.rider_id, e.race_role]));
    for (const { seasonId, race, stages, grandTour } of races) {
      const raceId = `${race.id}:${seasonId}`;
      const profiles = stages.map((p) => ({ ...p, race_id: raceId }));
      const data = { ...field, race: { ...field.race, id: raceId, stages: profiles.length }, profiles };
      const { stagesSorted, fatigueById } = benchStageFatigues(data, revision);
      for (let seed = 1; seed <= simSeeds; seed++) {
        const entrants = splitEntrants(data).entrants;
        const enterStage = (i) => { for (const e of entrants) e.fatigue = fatigueById.get(e.rider_id)[i]; };
        enterStage(0);
        const stageOutputs = [];
        const finalGc = runStagesInOrder({
          v4: engine, data, revision, seedTag: `gc5978-${seed}`, stages: stagesSorted, entrants,
          onStage: ({ profile, index, res }) => {
            stageOutputs.push({ profile, out: { timeline: { events: (res.v4Output?.timeline?.events ?? []).filter((e) => e.type === "breakaway_formed" || e.type === "breakaway_survived") } } });
            if (index + 1 < stagesSorted.length) enterStage(index + 1);
          },
        });
        rows.push({ arm, seasonId, raceId: race.id, stages: stages.length, grandTour, seed, ...measureRace({ stageOutputs, finalGc, roleById, rankById }) });
      }
    }
  }
  return rows;
}

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

export function summarize(rows) {
  const out = {};
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    const rs = rows.filter((r) => r.arm === arm);
    const mid = rs.flatMap((r) => r.mid);
    const byRole = {};
    for (const role of ["hunter", "captain"]) {
      const m = mid.filter((x) => x.role === role);
      byRole[role] = { n: m.length, top10Pct: pct(m.filter((x) => x.top10).length, m.length), inBreakPct: pct(m.filter((x) => x.inBreak).length, m.length) };
    }
    out[arm] = {
      races: rs.length,
      gcWinnerInBreakPct: pct(rs.filter((r) => r.winnerInBreak).length, rs.length),
      gcWinnerInHeldBreakPct: pct(rs.filter((r) => r.winnerInHeldBreak).length, rs.length),
      midRanks: byRole,
    };
  }
  const swap = rows.filter((r) => r.arm === "odd" || r.arm === "even");
  if (swap.length) {
    const mid = swap.flatMap((r) => r.mid);
    const h = mid.filter((x) => x.role === "hunter");
    const c = mid.filter((x) => x.role === "captain");
    out.swapped = { hunterTop10Pct: pct(h.filter((x) => x.top10).length, h.length), captainTop10Pct: pct(c.filter((x) => x.top10).length, c.length), n: h.length + c.length,
      gcWinnerInBreakPct: pct(swap.filter((r) => r.winnerInBreak).length, swap.length) };
  }
  return out;
}

function parseArgs(argv) {
  const a = Object.fromEntries(argv.filter((x) => x.startsWith("--")).map((x) => { const [k, v] = x.slice(2).split("="); return [k, v ?? "true"]; }));
  return {
    revision: a.revision ?? "s5_profiles_v1",
    genSeeds: Number(a.genSeeds ?? 1),
    simSeeds: Number(a.simSeeds ?? 2),
    maxStages: Number(a.maxStages ?? 99),
    scope: a.scope ?? "all",
    arms: (a.arms ?? "base,odd,even").split(","),
    out: a.out ?? null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const rows = await runGcFromBreakaway(args);
  const summary = { config: { ...args, out: undefined }, seconds: Math.round((Date.now() - t0) / 1000), summary: summarize(rows) };
  if (args.out) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, "..", "..", "..", args.out);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...summary, rows }, null, 2));
    console.log(`skrevet: ${args.out} (${rows.length} loeb-seeds, ${summary.seconds} s)`);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}
