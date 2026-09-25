#!/usr/bin/env node
// backend/scripts/v4EffortTwinMeasure.js
// #4914 (kalibreringspakken, M12 all_out + grupetto-tempo): MAALER hvad et
// indsatsvalg koster og koeber i v4, paa den PINNEDE population + de PINNEDE
// proxy-etaper (samme to filer som ankertabellen, RACE_ENGINE_RULES §7b), over
// 5 seeds.
//
// HVORFOR et eget script: ankertabellen koerer `orders=none` (alle paa
// 'normal'), og `--orders=ai` saetter aldrig all_out eller grupetto. Begge
// indsatsvalg er derfor USYNLIGE for alle 13 ankre — en aendring af dem kan
// hverken fælde eller bekraefte et anker. Dette script er den maaling der kan.
//
// To dele:
//
//   1. TVILLINGER (samme metode som PR #4909's tvillinge-maaling, nu paa de
//      pinnede filer): to IDENTISKE ryttere i SAMME loeb, kun indsatsvalget
//      adskiller dem. Hver etape koeres to gange med byttede rider_id'er, og
//      deltaerne midles — saa hverken rider_id-tie-breaket i finalen eller de
//      rider_id-noeglede rng-stroemme kan give et valg en skjult fordel.
//      Tvillingen klones fra feltets rytter ved en given percentil af ETAPENS
//      egen styrke (laengde-vaegtet CP over etapens segmenter).
//
//   2. GRUPETTO-SCENARIE (grupetto-tempo-kontakten, #4914 punkt 3): paa
//      bjerg-/hoejbjerg-etaper koerer den svageste andel af feltet grupetto,
//      som en manager ville saette sine ikke-klatrere. Maaler de ankre og den
//      hale-gate der kan se forskel paa de to tempo-modeller.
//
// KONTAKTERNE ligger i motorens egen tuning (deep-frosset ved import), saa en
// A/B koeres som to koersler med hver sin vaerdi paa disken — scriptet skriver
// de maalte tuning-vaerdier med i JSON'en, saa en maaling altid baerer sin egen
// variant (samme moenster som teamPlayAbMeasure.mjs).
//
// Usage:
//   node backend/scripts/v4EffortTwinMeasure.js [--label=A] [--seeds=s1,s2,s3,s4,s5] [--json=<fil>]
//     [--population=<fil>] [--out=<fil>] [--orders=none|ai] [--roles=free,team]
//     [--efforts=grupetto,save,normal,protect,all_out] [--profiles=flat,...] [--twins-only]
//
// #5580 (spec motor runde 2, M1 punkt 8): hele trappen (inkl. `protect` og
// `normal` som reference), tvillinger som hjaelper med kaptajn paa samme hold
// (`--roles=team`), og feltet med AI-roller/-ordrer (`--orders=ai`, samme vej
// som headToHeadV4.js). Output: pris (tid tabt) og gevinst (pladser vundet)
// pr. trin pr. terraen, plus hvilket trin der vinder hver celle.
//
// #5572: `--population=` maaler paa en anden population (side om side med den
// pinnede; default UAENDRET = POPULATION_FILE nedenfor). `--out=` er et alias
// for `--json=` (samme flagnavn som buildV4AnchorBaseline.mjs); `--json=`
// vinder hvis begge er givet. Koer fra repo-roden: `--population=` regnes fra
// roden (som POPULATION_FILE), `--json=`/`--out=` fra cwd (som hidtil).
//
// 100% READ-ONLY: laeser kun de pinnede JSON-filer. Skriver kun til --json.
// HARD RULE 17: tallene er motor-interne maalinger og hoerer i
// balance-internals/, ikke i PR-body/issue — kun anker-tal er offentlige.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stableSeed } from "../lib/raceSimulator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import {
  EFFORT_COST_EXTRA_TUNING,
  EFFORT_GAIN_EXTRA_TUNING,
  GROUP_TEMPO_EFFORT_EXTRA_TUNING,
  RACE_V4_TUNING,
} from "../lib/engine/v4/tuning.ts";
import { deriveCp } from "../lib/engine/v4/physiology.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { sampleField, median, mean } from "./lib/headToHeadStats.js";
import { scoreDescentVsSummitRatio, scoreFieldCohesion, scoreGapRealism } from "./lib/headToHeadAnchors.js";
import { evaluateTailGate, measureTailSpread } from "./v4TailSpread.js";
import { buildStageTeamOrders } from "./lib/headToHeadOrders.js";
import { buildRaceContexts } from "./headToHeadV4.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

const POPULATION_FILE = "backend/scripts/baselines/population-snapshot-2026-09-07.json";
const STAGES_FILE = "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json";
export const DEFAULT_SEEDS = Object.freeze(["s1", "s2", "s3", "s4", "s5"]);
// Hale-gaten er ejer-laast paa 3 seeds (§9 raekke 13) — domme gives paa dem.
export const TAIL_GATE_SEEDS = Object.freeze(["s1", "s2", "s3"]);
const FIELD_SIZE = 180;

/** Tvillingens niveau: percentil af feltet paa etapens egen styrke. */
export const TWIN_LEVELS = Object.freeze({ mid: 0.5, strong: 0.9, top: 0.99 });
// `save` er med som KONTROL for grupetto: vinder en grupetto-tvilling fordi
// normal-tvillingen braender ud, giver save (v3-kalibreret) samme beskyttelse,
// og fundet handler om kollaps-modellen, ikke om grupetto (PR #4909 tvivlspunkt 2).
//
// #5580 (spec motor runde 2, M1 punkt 8): hele trappen maales. `protect` er
// nyt (holdarbejdet, "arbejd eller angrib"), og `normal` er med som REFERENCE:
// normal mod normal skal give et delta paa praecis 0 (en sanity-kontrol af
// selve tvillinge-metoden, ikke et valg der kan vinde).
export const TWIN_EFFORTS = Object.freeze(["grupetto", "save", "normal", "protect", "all_out"]);

/**
 * #5580: hvordan tvillingerne stilles op.
 *   - `free`: begge tvillinger koerer `free_role` uden hold (den oprindelige
 *     maaling, bevaret uaendret).
 *   - `team`: hver tvilling er HJAELPER paa sit eget hold med en kaptajn der
 *     er en identisk klon (samme evner, `normal`). Saa ser maalingen baade
 *     hjaelperens pris og kaptajnens gevinst (M16 holdspil + supportShare-
 *     hullet), som `free` er blind for.
 */
export const TWIN_ROLE_MODES = Object.freeze(["free", "team"]);

/** --orders-tilstande, samme to som headToHeadV4.js. */
export const TWIN_ORDER_MODES = Object.freeze(["none", "ai"]);

/** Grupetto-scenariet: hvilke profiler, og hvor stor en andel af feltet. */
export const GRUPETTO_SCENARIO = Object.freeze({ profiles: ["mountain", "high_mountain"], fieldShare: 0.3 });

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function readJson(relPath) {
  // resolve (ikke join): en absolut --population= skal virke som den er.
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relPath), "utf8"));
}

/**
 * Etapens egen styrke for en rytter: CP pr. segment-terraen, vaegtet med
 * segmentets laengde. Ren funktion — ingen rng, ingen state.
 */
export function stageStrength(abilities, route, tuning = RACE_V4_TUNING) {
  let total = 0;
  let km = 0;
  for (const seg of route.segments ?? []) {
    const len = Math.max(0, seg.to_km - seg.from_km);
    total += deriveCp(abilities, seg.kind, tuning.physiology.cpWeights) * len;
    km += len;
  }
  return km > 0 ? total / km : 0;
}

function fieldFor(seed, stageRow, population) {
  const stageSeedStr = `${seed}:${stageRow.stage_number ?? 1}`;
  const rng = makeRng(stableSeed(`${stageSeedStr}:field`));
  return { stageSeedStr, riders: sampleField(rng, population.riders, FIELD_SIZE) };
}

/**
 * Feltets startliste. `orders=none`: alle `free_role` + `normal` (uaendret).
 * `orders=ai` (#5580): roller, indsats og hold-id fra AI-ordrerne, praecis som
 * headToHeadV4.js's `--orders=ai` (samme `buildStageTeamOrders`).
 */
function baseEntrants(fieldRiders, roles = null, effortByRider = null) {
  const teamByRider = new Map(fieldRiders.map((r) => [r.id, r.team_id ?? null]));
  const rows = fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  if (!roles) return entrantsFromAbilitiesRows(rows, () => ({ role: "free_role", effort: "normal", condition: 1 }));
  return entrantsFromAbilitiesRows(rows, (riderId) => ({
    role: roles.get(riderId) ?? "free_role",
    effort: effortByRider?.get(riderId) ?? "normal",
    condition: 1,
    teamId: teamByRider.get(riderId) ?? null,
  }));
}

/**
 * Startliste med to tvillinger klonet fra rytteren ved `percentile` af feltets
 * etape-styrke. Den klonede rytter og hans naermeste naboer i styrke tages ud,
 * saa feltstoerrelsen er uaendret. `swap` bytter hvilket rider_id der faar
 * indsatsvalget.
 *
 * `roleMode = "team"` (#5580): hver tvilling er hjaelper paa sit eget hold
 * (`twin-team-1`/`twin-team-2`) med en identisk kaptajn-klon paa `normal`.
 * Kaptajnerne foelger tvillingernes id-bytte, saa kaptajnen for indsats-
 * tvillingen altid returneres som `capX`.
 */
export function twinStartlist(entrants, route, percentile, effort, swap, roleMode = "free") {
  const ranked = [...entrants].sort(
    (a, b) => stageStrength(a.abilities, route) - stageStrength(b.abilities, route) || a.rider_id.localeCompare(b.rider_id),
  );
  const idx = Math.min(ranked.length - 1, Math.max(0, Math.floor(percentile * (ranked.length - 1))));
  const chosen = ranked[idx];
  const withTeam = roleMode === "team";
  // Naboer i styrke der tages ud: 1 i free (to tvillinger ind, to ud), 3 i team
  // (to tvillinger + to kaptajner ind, fire ud).
  const dropCount = withTeam ? 4 : 2;
  const order = [idx];
  for (let step = 1; order.length < dropCount && step < ranked.length; step++) {
    if (idx - step >= 0) order.push(idx - step);
    if (order.length < dropCount && idx + step < ranked.length) order.push(idx + step);
  }
  const drop = new Set(order.map((i) => ranked[i].rider_id));
  const idX = swap ? "twin-2" : "twin-1";
  const idN = swap ? "twin-1" : "twin-2";
  const teamOf = (id) => (id === "twin-1" ? "twin-team-1" : "twin-team-2");
  const capOf = (id) => (id === "twin-1" ? "twin-cap-1" : "twin-cap-2");
  const clone = (rider_id, eff, role = "free_role", team_id = null) => ({
    ...chosen,
    rider_id,
    effort: eff,
    role,
    team_id,
  });
  const twins = withTeam
    ? [
        clone(idX, effort, "helper", teamOf(idX)),
        clone(idN, "normal", "helper", teamOf(idN)),
        clone(capOf(idX), "normal", "captain", teamOf(idX)),
        clone(capOf(idN), "normal", "captain", teamOf(idN)),
      ]
    : [clone(idX, effort), clone(idN, "normal")];
  return {
    startlist: [...entrants.filter((e) => !drop.has(e.rider_id)), ...twins],
    idX,
    idN,
    capX: withTeam ? capOf(idX) : null,
    capN: withTeam ? capOf(idN) : null,
  };
}

function riderOutcome(output, riderId) {
  const result = output.results.find((r) => r.rider_id === riderId);
  const load = output.loads.find((l) => l.rider_id === riderId);
  return {
    rank: result?.rank ?? null,
    time: result?.time_seconds ?? null,
    status: result?.status ?? null,
    secondsOverCp: load?.seconds_over_cp ?? 0,
    workNorm: load?.work_norm ?? 0,
  };
}

/** Én tvillinge-maaling: to koersler med byttede id'er, deltaer midlet. */
function measureTwinPair({ entrants, route, stageSeedStr, percentile, effort, roleMode = "free", orders = [] }) {
  const deltas = [];
  for (const swap of [false, true]) {
    const { startlist, idX, idN, capX, capN } = twinStartlist(entrants, route, percentile, effort, swap, roleMode);
    const output = simulateStageV4({ route, startlist, orders, seed: stageSeedStr, tuning: RACE_V4_TUNING });
    const x = riderOutcome(output, idX);
    const n = riderOutcome(output, idN);
    const cx = capX ? riderOutcome(output, capX) : null;
    const cn = capN ? riderOutcome(output, capN) : null;
    deltas.push({ x, n, cx, cn, winnerTime: Math.min(...output.results.map((r) => r.time_seconds)) });
  }
  const avg = (fn) => (fn(deltas[0]) + fn(deltas[1])) / 2;
  const hasCaptain = deltas.every((d) => d.cx && d.cn);
  return {
    // #5580: kaptajnens plads-delta (kun roleMode "team"): + = kaptajnen for
    // indsats-tvillingen sluttede daarligere end kaptajnen for normal-tvillingen.
    captainRankDelta: hasCaptain ? avg((d) => d.cx.rank - d.cn.rank) : null,
    rankDelta: avg((d) => d.x.rank - d.n.rank),
    timeDelta: avg((d) => d.x.time - d.n.time),
    xSecondsOverCp: avg((d) => d.x.secondsOverCp),
    nSecondsOverCp: avg((d) => d.n.secondsOverCp),
    workDelta: avg((d) => d.x.workNorm - d.n.workNorm),
    xWins: deltas.filter((d) => d.x.rank === 1).length / 2,
    xTop10: deltas.filter((d) => d.x.rank <= 10).length / 2,
    xOtl: deltas.filter((d) => d.x.status === "otl").length / 2,
    nOtl: deltas.filter((d) => d.n.status === "otl").length / 2,
    xGapPct: avg((d) => (d.winnerTime > 0 ? ((d.x.time - d.winnerTime) / d.winnerTime) * 100 : 0)),
  };
}

/** Reducerer tvillinge-maalinger til én raekke pr. (valg, niveau, profil). */
export function summarizeTwins(samples) {
  const groups = new Map();
  for (const s of samples) {
    const key = `${s.effort}|${s.level}|${s.profileType}|${s.roleMode ?? "free"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const [effort, level, profileType, roleMode] = key.split("|");
    const rankDeltas = list.map((s) => s.rankDelta);
    const captainDeltas = list.map((s) => s.captainRankDelta).filter((v) => Number.isFinite(v));
    rows.push({
      effort,
      level,
      profileType,
      roleMode,
      n: list.length,
      medianCaptainRankDelta: captainDeltas.length ? median(captainDeltas) : null,
      meanCaptainRankDelta: captainDeltas.length ? mean(captainDeltas) : null,
      meanRankDelta: mean(rankDeltas),
      medianRankDelta: median(rankDeltas),
      shareWorse: list.filter((s) => s.rankDelta > 0).length / list.length,
      shareBetter: list.filter((s) => s.rankDelta < 0).length / list.length,
      medianTimeDelta: median(list.map((s) => s.timeDelta)),
      medianXSecondsOverCp: median(list.map((s) => s.xSecondsOverCp)),
      shareXOverCp: list.filter((s) => s.xSecondsOverCp > 0).length / list.length,
      medianWorkDelta: median(list.map((s) => s.workDelta)),
      xWins: list.reduce((a, s) => a + s.xWins, 0),
      xTop10: list.reduce((a, s) => a + s.xTop10, 0),
      xOtl: list.reduce((a, s) => a + s.xOtl, 0),
      nOtl: list.reduce((a, s) => a + s.nOtl, 0),
      medianXGapPct: median(list.map((s) => s.xGapPct)),
    });
  }
  const sortKey = (r) => `${r.roleMode}|${r.effort}|${r.level}|${r.profileType}`;
  return rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

/**
 * #5580: hvilket trin "vinder" pr. (rolle-tilstand, niveau, profil): det trin
 * med den laveste median-plads-delta mod normal (normal selv er 0). Svaret paa
 * spoergsmaalet "dominerer `save` stadig?" uden at laese hele tabellen.
 */
export function bestEffortByCell(rows) {
  const cells = new Map();
  for (const r of rows) {
    const key = `${r.roleMode}|${r.level}|${r.profileType}`;
    const cur = cells.get(key);
    if (!cur || r.medianRankDelta < cur.medianRankDelta) cells.set(key, { effort: r.effort, medianRankDelta: r.medianRankDelta });
  }
  return [...cells.entries()]
    .map(([key, v]) => {
      const [roleMode, level, profileType] = key.split("|");
      return { roleMode, level, profileType, best: v.effort };
    })
    .sort((a, b) => `${a.roleMode}|${a.level}|${a.profileType}`.localeCompare(`${b.roleMode}|${b.level}|${b.profileType}`));
}

export function runTwins({
  population,
  stages,
  seeds,
  efforts = TWIN_EFFORTS,
  roleModes = ["free"],
  orderMode = "none",
  buildOrders = buildStageTeamOrders,
}) {
  if (!TWIN_ORDER_MODES.includes(orderMode)) {
    throw new Error(`ukendt --orders-tilstand "${orderMode}" (gyldige: ${TWIN_ORDER_MODES.join(", ")})`);
  }
  const raceContexts = orderMode === "ai" ? buildRaceContexts(stages) : new Map();
  const samples = [];
  for (const seed of seeds) {
    for (const stageRow of stages) {
      const route = routeFromStageProfileRow(stageRow);
      const { stageSeedStr, riders } = fieldFor(seed, stageRow, population);
      let orders = [];
      let entrants;
      if (orderMode === "ai") {
        const built = buildOrders({ riders, route, race: raceContexts.get(stageRow) });
        orders = built.orders;
        entrants = baseEntrants(riders, built.roles, built.effortByRider);
      } else {
        entrants = baseEntrants(riders);
      }
      for (const roleMode of roleModes) {
        for (const [level, percentile] of Object.entries(TWIN_LEVELS)) {
          for (const effort of efforts) {
            samples.push({
              seed,
              stageNumber: stageRow.stage_number,
              profileType: stageRow.profile_type ?? "?",
              level,
              effort,
              roleMode,
              ...measureTwinPair({ entrants, route, stageSeedStr, percentile, effort, roleMode, orders }),
            });
          }
        }
      }
    }
  }
  return summarizeTwins(samples);
}

/**
 * Grupetto-scenariet: paa de udvalgte profiler koerer den svageste andel af
 * feltet (paa etapens egen styrke) grupetto. Alle andre etaper koeres som i
 * ankertabellen. Returnerer anker-raekker (v4-siden) + hale + tidsgraense.
 */
export function runGrupettoScenario({ population, stages, seeds }) {
  const rows = [];
  const tail = [];
  let grupettoRiders = 0;
  let grupettoOtl = 0;
  let grupettoLastGroup = 0;
  for (const seed of seeds) {
    for (const stageRow of stages) {
      const route = routeFromStageProfileRow(stageRow);
      const { stageSeedStr, riders } = fieldFor(seed, stageRow, population);
      let entrants = baseEntrants(riders);
      const applies = GRUPETTO_SCENARIO.profiles.includes(route.profile_type);
      const grupettoIds = new Set();
      if (applies) {
        const ranked = [...entrants].sort(
          (a, b) => stageStrength(a.abilities, route) - stageStrength(b.abilities, route) || a.rider_id.localeCompare(b.rider_id),
        );
        for (const e of ranked.slice(0, Math.floor(ranked.length * GRUPETTO_SCENARIO.fieldShare))) grupettoIds.add(e.rider_id);
        entrants = entrants.map((e) => (grupettoIds.has(e.rider_id) ? { ...e, effort: "grupetto" } : e));
      }
      const output = simulateStageV4({ route, startlist: entrants, orders: [], seed: stageSeedStr, tuning: RACE_V4_TUNING });
      rows.push({ raw: { route, v3Output: { ranked: [] }, v4Output: output } });
      if (TAIL_GATE_SEEDS.includes(seed)) {
        tail.push({ seed, profileType: stageRow.profile_type ?? "?", ...measureTailSpread(output) });
      }
      if (applies) {
        const lastTime = Math.max(...output.results.filter((r) => r.status !== "abandoned").map((r) => r.time_seconds));
        for (const r of output.results) {
          if (!grupettoIds.has(r.rider_id)) continue;
          grupettoRiders += 1;
          if (r.status === "otl") grupettoOtl += 1;
          if (r.time_seconds === lastTime) grupettoLastGroup += 1;
        }
      }
    }
  }
  const anchors = [scoreFieldCohesion(rows), scoreDescentVsSummitRatio(rows), scoreGapRealism(rows)[0]].map((a) => ({
    id: a.id,
    label: a.label,
    band: a.bandLabel,
    value: a.v4.value,
    verdict: a.v4.verdict,
    n: a.v4.sampleCount,
  }));
  const mountainTail = tail.filter((t) => GRUPETTO_SCENARIO.profiles.includes(t.profileType));
  return {
    anchors,
    tailGate: evaluateTailGate(tail),
    mountainOtlRiders: mountainTail.reduce((a, t) => a + t.otlCount, 0),
    mountainRescuedRiders: mountainTail.reduce((a, t) => a + t.rescuedCount, 0),
    grupettoRiders,
    grupettoOtlShare: grupettoRiders > 0 ? grupettoOtl / grupettoRiders : null,
    grupettoInLastGroupShare: grupettoRiders > 0 ? grupettoLastGroup / grupettoRiders : null,
  };
}

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}

export function formatReport(result) {
  const lines = [];
  lines.push(`# v4EffortTwinMeasure — ${result.label ?? "-"} (${result.generated_at})`);
  // #5580: all_out-tabellen er pr. SEGMENT-terraen nu; aeldre JSON'er baerer
  // den gamle profil-noegle, saa begge laeses.
  const allOutTable = result.effort_cost_tuning.demandMultiplierAllOutBySegmentKind
    ?? result.effort_cost_tuning.demandMultiplierAllOutByProfile
    ?? {};
  lines.push(`Tuning: grupetto-tempo-model ${result.group_tempo_tuning.model} (faktor ${result.group_tempo_tuning.grupettoTempoFactor}), all_out-terraentabel ${JSON.stringify(allOutTable)}`);
  lines.push(`Seeds: ${result.seeds.join(", ")} · felt ${result.field_size} · orders=${result.order_mode ?? "none"} · roller=${(result.role_modes ?? ["free"]).join(",")}`);
  lines.push("");
  lines.push("## Tvillinger (valg vs. normal, samme loeb; + = daarligere)");
  lines.push("roller\tvalg\tniveau\tprofil\tn\tmiddel-plads\tmedian-plads\tandel-daarligere\tandel-bedre\tmedian-tid-s\tmedian-sek-over-CP\tandel-over-CP\tmedian-work\tsejre\ttop10\tOTL(valg/normal)\tmedian-gab-%\tkaptajn-median-plads");
  for (const r of result.twins) {
    lines.push([
      r.roleMode ?? "free", r.effort, r.level, r.profileType, r.n, fmt(r.meanRankDelta), fmt(r.medianRankDelta), fmt(r.shareWorse), fmt(r.shareBetter),
      fmt(r.medianTimeDelta, 1), fmt(r.medianXSecondsOverCp, 0), fmt(r.shareXOverCp), fmt(r.medianWorkDelta, 0),
      r.xWins, r.xTop10, `${r.xOtl}/${r.nOtl}`, fmt(r.medianXGapPct), fmt(r.medianCaptainRankDelta),
    ].join("\t"));
  }
  lines.push("");
  lines.push("## Bedste trin pr. celle (laveste median-plads mod normal)");
  for (const c of bestEffortByCell(result.twins)) lines.push(`${c.roleMode}\t${c.level}\t${c.profileType}\t${c.best}`);
  lines.push("");
  const g = result.grupetto_scenario;
  if (!g) return lines.join("\n");
  lines.push(`## Grupetto-scenarie (${GRUPETTO_SCENARIO.fieldShare * 100} % svageste paa ${GRUPETTO_SCENARIO.profiles.join("/")} koerer grupetto)`);
  for (const a of g.anchors) lines.push(`${a.label}: ${fmt(a.value, 3)} [${a.verdict}] (baand ${a.band}, n=${a.n})`);
  lines.push(`Hale-gate (seeds ${TAIL_GATE_SEEDS.join(",")}): ${g.tailGate.allPass ? "PASS" : "FAIL"}`);
  for (const row of g.tailGate.rows ?? []) {
    if (!row.gated) continue;
    lines.push(`  ${row.profileType}\tren p90 ${fmt(row.value)} %\t${row.band[0]}-${row.band[1]} %\t${row.status}`);
  }
  lines.push(`Bjerg/hoejbjerg OTL-ryttere: ${g.mountainOtlRiders} · reddet af grupetto-reglen: ${g.mountainRescuedRiders}`);
  lines.push(`Grupetto-ryttere: ${g.grupettoRiders} · OTL-andel ${fmt(g.grupettoOtlShare, 3)} · i sidste maalgruppe ${fmt(g.grupettoInLastGroupShare, 3)}`);
  return lines.join("\n");
}

function main() {
  const seeds = (argValue("seeds") ?? DEFAULT_SEEDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const populationFile = argValue("population") ?? POPULATION_FILE;
  const population = readJson(populationFile);
  const stagesFile = readJson(STAGES_FILE);
  const allStages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  // --profiles=flat,rolling: kun de etapetyper (hurtig kalibrerings-sweep).
  // Grupetto-scenariet koeres altid paa ALLE etaper — dets ankre og hale-gate
  // er kun meningsfulde paa hele den pinnede kalender.
  const profileFilter = argValue("profiles")?.split(",").map((p) => p.trim()).filter(Boolean) ?? null;
  const stages = profileFilter ? allStages.filter((s) => profileFilter.includes(s.profile_type)) : allStages;
  const skipScenario = process.argv.includes("--twins-only");
  // #5580: --orders=none|ai (som headToHeadV4.js), --roles=free,team og
  // --efforts=<liste> (default hele trappen).
  const orderMode = argValue("orders", "none");
  const roleModes = (argValue("roles") ?? "free,team").split(",").map((s) => s.trim()).filter(Boolean);
  for (const m of roleModes) {
    if (!TWIN_ROLE_MODES.includes(m)) throw new Error(`ukendt --roles "${m}" (gyldige: ${TWIN_ROLE_MODES.join(", ")})`);
  }
  const efforts = (argValue("efforts") ?? TWIN_EFFORTS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const e of efforts) {
    if (!TWIN_EFFORTS.includes(e)) throw new Error(`ukendt --efforts "${e}" (gyldige: ${TWIN_EFFORTS.join(", ")})`);
  }
  const result = {
    schema_version: 2,
    label: argValue("label"),
    generated_at: new Date().toISOString(),
    population_file: populationFile,
    stages_file: STAGES_FILE,
    seeds,
    field_size: FIELD_SIZE,
    order_mode: orderMode,
    role_modes: roleModes,
    effort_cost_tuning: JSON.parse(JSON.stringify(EFFORT_COST_EXTRA_TUNING)),
    effort_gain_tuning: JSON.parse(JSON.stringify(EFFORT_GAIN_EXTRA_TUNING)),
    group_tempo_tuning: JSON.parse(JSON.stringify(GROUP_TEMPO_EFFORT_EXTRA_TUNING)),
    twins: runTwins({ population, stages, seeds, efforts, roleModes, orderMode }),
    grupetto_scenario: skipScenario ? null : runGrupettoScenario({ population, stages: allStages, seeds }),
  };
  console.log(formatReport(result));
  const jsonPath = argValue("json") ?? argValue("out");
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\nJSON skrevet: ${jsonPath}`);
  }
}

if (process.argv[1]?.endsWith("v4EffortTwinMeasure.js")) main();
