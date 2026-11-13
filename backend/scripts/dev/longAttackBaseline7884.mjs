#!/usr/bin/env node
// backend/scripts/dev/longAttackBaseline7884.mjs
// #7884 trin 0 (langt angreb): det maalte udgangspunkt paa motoren i dag. KUN maaling,
// ingen motor-aendring, ingen kontakt, ingen spillertekst. Spec:
// docs/superpowers/specs/2026-11-12-7884-langt-angreb-design.md, afsnit 5.
//
//   B2   Andel etaper vundet fra et frem-split paa sidste stigning, pr. etapetype.
//        Frem-split = motorens split hvor en gruppe gaar FREM (negativt hul) paa et segment
//        inden for etapens sidste stigning (fod til top, ogsaa en topankomst).
//   B6   Sene soloangreb (finale_attack, kind late_attack): hvor ofte, og hvor ofte de
//        holder (angriberen vinder; angriberen er foran alle uden for morgenudbruddet).
//   B10  Motorens tid pr. etape: median og p95, samlet, pr. etapetype og pr. loebsgruppe.
//        Maalt som vaegtid mellem to etaper i runStagesInOrder (simulering + klassement).
//   B11  Gemte planer i race_team_orders.riders med et angrebsled: hvor mange, paa hvilket
//        punkt (start, sidste km, stigningstop: sidste eller tidligere, sat) og for hvilken
//        rolle. ÉN SELECT, kun laesning (--print-b11-sql); resultatet opsummeres med
//        --b11-from=<json med raekkerne>. Kolonner fra database/schema-snapshot.json.
//
// B2/B6/B10 koerer paa S5-benchens loeb (s5MotorBench.mjs: buildS5BenchRaces, det
// anonymiserede Giro-felt, etapeloeb med akkumuleret traethed som benchen), offline. Benchens
// felt er lutter AI-hold; --from-dir koerer i stedet en prod-eksport med spillernes egne ordrer
// (frem-splittet kommer kun fra "alt ud", saa B2 skal ogsaa maales dér).
//
// HARD RULE 17: maalte tal skrives KUN til balance-internals/ (gitignoreret). Offline for
// B2/B6/B10; B11 laeser prod med én SELECT og skriver aldrig.
//
// Koer (fra repo-roden):
//   node backend/scripts/dev/longAttackBaseline7884.mjs --bench --out=balance-internals/7884/<dato> [--scope=all] [--sim-seeds=3] [--gen-seeds=3] [--limit=<n loeb>] [--revision=s5_profiles_v3]
//   node backend/scripts/dev/longAttackBaseline7884.mjs --from-dir=<eksport>/races --out=balance-internals/7884/<dato> [--groups=one_day:20,...] [--sim-seeds=1]
//   node backend/scripts/dev/longAttackBaseline7884.mjs --print-b11-sql
//   node backend/scripts/dev/longAttackBaseline7884.mjs --b11-from=<rows.json> --out=balance-internals/7884/<dato>
//
// Refs #7884 #8045 #6368 #7280

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");

/** Stigningskategorierne motoren og etapeplanen regner med. */
const CATEGORIES = new Set(["HC", "1", "2", "3", "4"]);
const TT = new Set(["itt", "itt_hilly", "ttt"]);
/** Afrunding i motorens event-km (round2) maa ikke smide et split ud af stigningen. */
export const KM_EPS = 0.05;

// ── Rene hjaelpere ──────────────────────────────────────────────────────────

/** Kvantil (lineaer interpolation), null uden tal. */
export function quantile(xs, p) {
  const s = xs.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const share = (k, n) => (n > 0 ? k / n : null);

/**
 * Etapens sidste stigning som [fod, top] i km (ren). Alle kategoriserede stigninger med en
 * top paa ruten, ogsaa en topankomst (den er ikke paa etapeplanens liste, men er et sted
 * motoren kan splitte). Foden er top minus laengde, som segmentbyggeren (routeSegments.js).
 */
export function lastClimbWindow(profile) {
  const distance = Number(profile?.distance_km);
  const climbs = (Array.isArray(profile?.climbs) ? profile.climbs : [])
    .map((c) => ({ crest: Number(c?.crest_km ?? c?.km), length: Number(c?.length_km), category: String(c?.category ?? "") }))
    .filter((c) => Number.isFinite(c.crest) && c.crest > 0 && (!Number.isFinite(distance) || c.crest <= distance + KM_EPS) && CATEGORIES.has(c.category));
  if (!climbs.length) return null;
  const last = climbs.reduce((a, b) => (b.crest > a.crest ? b : a));
  const length = Number.isFinite(last.length) && last.length > 0 ? last.length : 0;
  return { foot: Math.max(0, last.crest - length), crest: last.crest };
}

/** Frem-split inden for vinduet: peloton_splits med negativt hul (ren). Returnerer rytter-id'erne. */
export function forwardSplitRiders(events, window) {
  const ids = new Set();
  if (!window) return ids;
  for (const e of events ?? []) {
    if (e?.type !== "peloton_splits") continue;
    const km = Number(e.km);
    const gap = Number(e.params?.gap_seconds);
    if (!(gap < 0)) continue;
    if (!(km >= window.foot - KM_EPS && km <= window.crest + KM_EPS)) continue;
    for (const id of e.params?.rider_ids ?? []) ids.add(String(id));
  }
  return ids;
}

/** De sene soloangreb paa etapen (ren). */
export function lateAttacksOf(events) {
  return (events ?? []).filter((e) => e?.type === "finale_attack" && e.params?.kind === "late_attack").map((e) => ({ riderId: String(e.params.rider_id), km: Number(e.km) }));
}

/** Etapens vinder: hurtigste faerdige rytter, uafgjort paa rank (ren). */
export function winnerOf(results) {
  const fin = (results ?? []).filter((r) => r.status === "finished").slice().sort((a, b) => a.time_seconds - b.time_seconds || (a.rank ?? 0) - (b.rank ?? 0));
  return fin[0] ? { riderId: String(fin[0].rider_id), time: fin[0].time_seconds } : null;
}

/**
 * Én etapes maalinger (ren). `out` er motorens v4Output, `breakIds` morgenudbruddets ryttere,
 * `ms` motorens tid paa etapen. Ingen tal fra motoren i koden; kun flag og tid.
 */
export function measureStage7884({ profile, out, breakIds = new Set(), ms = null }) {
  const pt = profile?.profile_type ?? null;
  const tt = TT.has(pt);
  const events = out?.timeline?.events ?? [];
  const window = tt ? null : lastClimbWindow(profile);
  const fwd = forwardSplitRiders(events, window);
  const winner = winnerOf(out?.results);
  const late = lateAttacksOf(events);
  const fin = new Map((out?.results ?? []).filter((r) => r.status === "finished").map((r) => [String(r.rider_id), Number(r.time_seconds)]));
  const attacker = late[0]?.riderId ?? null;
  let ahead = false;
  if (attacker && fin.has(attacker)) {
    const t = fin.get(attacker);
    ahead = [...fin].every(([id, ti]) => id === attacker || breakIds.has(id) || ti > t);
  }
  // B4: motorens sejrstype (engine/v4/winType.ts), som maal-hændelsen bærer den.
  const finish = events.find((e) => e?.type === "finish");
  return {
    profile_type: pt,
    tt,
    winType: finish?.params?.win_type ?? null,
    hasClimb: Boolean(window),
    forwardSplit: fwd.size > 0,
    wonFromForwardSplit: Boolean(winner && fwd.has(winner.riderId)),
    lateAttack: late.length > 0,
    lateAttackHeldWin: Boolean(attacker && winner && winner.riderId === attacker),
    lateAttackHeldAhead: ahead,
    ms: Number.isFinite(ms) ? ms : null,
  };
}

const timeStats = (ms) => ({ n: ms.length, median: quantile(ms, 0.5), p95: quantile(ms, 0.95), max: ms.length ? Math.max(...ms) : null });

function groupRows(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

/** B2 for et saet etaper (ren): kun vejetaper med en stigning taeller i naevneren. */
export function b2Of(rows) {
  const climbing = rows.filter((r) => !r.tt && r.hasClimb);
  const split = climbing.filter((r) => r.forwardSplit);
  const won = climbing.filter((r) => r.wonFromForwardSplit);
  return { stages: climbing.length, withForwardSplit: split.length, wonFromForwardSplit: won.length, shareWon: share(won.length, climbing.length), shareSplit: share(split.length, climbing.length), wonGivenSplit: share(won.length, split.length) };
}

/** B6 for et saet etaper (ren). */
export function b6Of(rows) {
  const road = rows.filter((r) => !r.tt);
  const att = road.filter((r) => r.lateAttack);
  const win = att.filter((r) => r.lateAttackHeldWin).length;
  const ahead = att.filter((r) => r.lateAttackHeldAhead).length;
  return { stages: road.length, attacks: att.length, shareStagesWithAttack: share(att.length, road.length), heldWin: win, heldAhead: ahead, shareHeldWin: share(win, att.length), shareHeldAhead: share(ahead, att.length) };
}

/** B4: antal etaper pr. sejrstype (ren); etaper uden sejrstype taelles som "ukendt". */
export function winTypesOf(rows) {
  const out = {};
  for (const r of rows) {
    const k = r.winType ?? "ukendt";
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** B2, B4, B6 og B10 samlet og opdelt (ren). `group` paa raekken er loebsgruppen. */
export function summarize7884(rows) {
  const ms = (rs) => rs.map((r) => r.ms).filter((v) => Number.isFinite(v));
  return {
    n: rows.length,
    b2: { all: b2Of(rows), byProfile: Object.fromEntries(groupRows(rows, (r) => r.profile_type).map(([k, v]) => [k, b2Of(v)])), byGroup: Object.fromEntries(groupRows(rows, (r) => r.group).map(([k, v]) => [k, b2Of(v)])) },
    b6: { all: b6Of(rows), byProfile: Object.fromEntries(groupRows(rows, (r) => r.profile_type).map(([k, v]) => [k, b6Of(v)])), byGroup: Object.fromEntries(groupRows(rows, (r) => r.group).map(([k, v]) => [k, b6Of(v)])) },
    b4: { all: winTypesOf(rows), byProfile: Object.fromEntries(groupRows(rows, (r) => r.profile_type).map(([k, v]) => [k, winTypesOf(v)])), byGroup: Object.fromEntries(groupRows(rows, (r) => r.group).map(([k, v]) => [k, winTypesOf(v)])) },
    b10: { all: timeStats(ms(rows)), byProfile: Object.fromEntries(groupRows(rows, (r) => r.profile_type).map(([k, v]) => [k, timeStats(ms(v))])), byGroup: Object.fromEntries(groupRows(rows, (r) => r.group).map(([k, v]) => [k, timeStats(ms(v))])) },
  };
}

/** Loebsgruppen for et bench-loeb (ren, samme inddeling som #7266; benchen er kun seniorer). */
export function benchRaceGroup(race, stageCount) {
  if (race?.race_class === "GiroVuelta" || race?.race_class === "TourFrance") return "gt";
  if (race?.race_class === "Monuments") return "monument";
  return stageCount > 1 ? "short_stage" : "one_day";
}

// ── B11: gemte planer med et angrebsled (én SELECT, kun laesning) ───────────

/**
 * Én SELECT (kun laesning). Kolonner: race_team_orders(race_id, stage_number, team_id, riders),
 * races(id, status, stages_completed), race_stage_profiles(race_id, stage_number, distance_km,
 * climbs), race_stage_roles(race_id, stage_number, rider_id, race_role), race_entries(race_id,
 * rider_id, race_role). "Sidste stigning" er den sidste paa etapeplanens liste
 * (stagePlanClimbsFromRaw: kategoriseret, ikke topankomst, top foer maal).
 * stage_state: done = etapen er koert, pending = koeres endnu (dem en ny regel rammer).
 * Raekketyper: all_plans (alle gemte planer), attack_plans (planer med mindst ét angrebsled),
 * attack_legs (angrebsled pr. punkt og rolle).
 */
export const B11_SQL = `
WITH plans AS (
  SELECT o.race_id, o.stage_number, o.team_id, rd->>'rider_id' AS rider_id, rd->'plan' AS plan
  FROM race_team_orders o
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.riders) = 'array' THEN o.riders ELSE '[]'::jsonb END) AS rd
  WHERE jsonb_typeof(rd->'plan') = 'array' AND jsonb_array_length(rd->'plan') > 0
),
staged AS (
  SELECT p.*, CASE WHEN r.status = 'completed' OR p.stage_number <= COALESCE(r.stages_completed, 0) THEN 'done' ELSE 'pending' END AS stage_state
  FROM plans p JOIN races r ON r.id = p.race_id
),
legs AS (
  SELECT s.race_id, s.stage_number, s.team_id, s.rider_id, s.stage_state, l.leg
  FROM staged s CROSS JOIN LATERAL jsonb_array_elements(s.plan) AS l(leg)
  WHERE l.leg->>'task' = 'attack'
),
attack_legs AS (
  SELECT lg.stage_state,
    COALESCE(rsr.race_role, re.race_role, 'unknown') AS role,
    COALESCE(lg.leg->'from'->>'at', 'start') AS at,
    CASE WHEN lg.leg->'from'->>'at' = 'kom' THEN
      CASE WHEN lc.last_kom_index IS NULL THEN 'unknown'
           WHEN lg.leg->'from'->>'kom_index' = lc.last_kom_index::text THEN 'last'
           ELSE 'earlier' END
    END AS kom_pos
  FROM legs lg
  LEFT JOIN LATERAL (
    SELECT (c.ord - 1) AS last_kom_index
    FROM race_stage_profiles sp
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(sp.climbs) = 'array' THEN sp.climbs ELSE '[]'::jsonb END) WITH ORDINALITY AS c(cl, ord)
    WHERE sp.race_id = lg.race_id AND sp.stage_number = lg.stage_number
      AND c.cl->>'category' IN ('HC', '1', '2', '3', '4')
      AND COALESCE(c.cl->>'summit_finish', 'false') <> 'true'
      AND COALESCE(c.cl->>'crest_km', c.cl->>'km') ~ '^[0-9]+(\\.[0-9]+)?$'
      AND COALESCE(c.cl->>'crest_km', c.cl->>'km')::numeric > 0
      AND COALESCE(c.cl->>'crest_km', c.cl->>'km')::numeric < sp.distance_km
    ORDER BY COALESCE(c.cl->>'crest_km', c.cl->>'km')::numeric DESC, c.ord DESC
    LIMIT 1
  ) lc ON true
  LEFT JOIN race_stage_roles rsr ON rsr.race_id = lg.race_id AND rsr.stage_number = lg.stage_number AND rsr.rider_id::text = lg.rider_id
  LEFT JOIN race_entries re ON re.race_id = lg.race_id AND re.rider_id::text = lg.rider_id
)
SELECT 'all_plans' AS kind, stage_state, NULL::text AS role, NULL::text AS at, NULL::text AS kom_pos, count(*)::int AS n
FROM staged GROUP BY stage_state
UNION ALL
SELECT 'attack_plans', stage_state, NULL, NULL, NULL, count(DISTINCT (race_id, stage_number, team_id, rider_id))::int
FROM legs GROUP BY stage_state
UNION ALL
SELECT 'attack_legs', stage_state, role, at, kom_pos, count(*)::int
FROM attack_legs GROUP BY stage_state, role, at, kom_pos
ORDER BY 1, 2, 3, 4, 5;
`.trim();

/** B11-raekkerne opsummeret (ren). Andele pr. etapetilstand; led pr. punkt og rolle. */
export function summarizeB11(rows) {
  const states = ["done", "pending"];
  const n = (kind, state) => (rows ?? []).filter((r) => r.kind === kind && r.stage_state === state).reduce((s, r) => s + Number(r.n || 0), 0);
  const out = { byState: {}, legsByPoint: {}, legsByRole: {} };
  for (const st of states) {
    const all = n("all_plans", st);
    const att = n("attack_plans", st);
    out.byState[st] = { plans: all, plansWithAttack: att, shareWithAttack: share(att, all) };
  }
  for (const r of (rows ?? []).filter((x) => x.kind === "attack_legs")) {
    const point = r.at === "kom" ? `kom_${r.kom_pos ?? "unknown"}` : r.at ?? "start";
    out.legsByPoint[point] ??= { done: 0, pending: 0 };
    out.legsByPoint[point][r.stage_state] = (out.legsByPoint[point][r.stage_state] ?? 0) + Number(r.n || 0);
    const role = r.role ?? "unknown";
    out.legsByRole[role] ??= { done: 0, pending: 0 };
    out.legsByRole[role][r.stage_state] = (out.legsByRole[role][r.stage_state] ?? 0) + Number(r.n || 0);
  }
  return out;
}

// ── Markdown (privat: tal) ──────────────────────────────────────────────────

const pct = (x) => (x == null ? "-" : `${Math.round(x * 1000) / 10} %`);
const sec = (x) => (x == null ? "-" : `${Math.round(x) / 1000} s`);

export function renderBenchMarkdown(sum, config) {
  const src = config.scope === "export" ? "prod-eksporten (rigtige felter og ordrer)" : "S5-benchen (AI-felt)";
  const L = [`# #7884 trin 0: B2, B6, B10 paa ${src} (PRIVAT, hard rule 17)`, "", `Revision ${config.revision} · scope ${config.scope} · ${config.genSeeds} saeson-traek · ${config.simSeeds} motor-seeds · ${config.races} loeb · ${sum.n} etape-koersler`, ""];
  L.push("## B2: etaper vundet fra et frem-split paa sidste stigning", "", "| gruppe | etaper m. stigning | frem-split | vundet derfra | andel vundet | andel m. split | vundet givet split |", "|---|---|---|---|---|---|---|");
  const b2 = (k, x) => L.push(`| ${k} | ${x.stages} | ${x.withForwardSplit} | ${x.wonFromForwardSplit} | ${pct(x.shareWon)} | ${pct(x.shareSplit)} | ${pct(x.wonGivenSplit)} |`);
  b2("alle", sum.b2.all);
  for (const [k, x] of Object.entries(sum.b2.byProfile)) b2(`type ${k}`, x);
  for (const [k, x] of Object.entries(sum.b2.byGroup)) b2(`loebsgruppe ${k}`, x);
  L.push("", "## B6: sene soloangreb", "", "| gruppe | vejetaper | angreb | andel etaper | holdt (vandt) | holdt (foran alle uden for udbruddet) |", "|---|---|---|---|---|---|");
  const b6 = (k, x) => L.push(`| ${k} | ${x.stages} | ${x.attacks} | ${pct(x.shareStagesWithAttack)} | ${x.heldWin} (${pct(x.shareHeldWin)}) | ${x.heldAhead} (${pct(x.shareHeldAhead)}) |`);
  b6("alle", sum.b6.all);
  for (const [k, x] of Object.entries(sum.b6.byProfile)) b6(`type ${k}`, x);
  for (const [k, x] of Object.entries(sum.b6.byGroup)) b6(`loebsgruppe ${k}`, x);
  L.push("", "## B4: sejrstyper (antal etaper)", "", "| gruppe | sejrstyper |", "|---|---|");
  const b4 = (k, x) => L.push(`| ${k} | ${Object.entries(x).map(([t, c]) => `${t} ${c}`).join(", ")} |`);
  b4("alle", sum.b4.all);
  for (const [k, x] of Object.entries(sum.b4.byProfile)) b4(`type ${k}`, x);
  for (const [k, x] of Object.entries(sum.b4.byGroup)) b4(`loebsgruppe ${k}`, x);
  L.push("", "## B10: motorens tid pr. etape (simulering + klassement)", "", "| gruppe | n | median | p95 | max |", "|---|---|---|---|---|");
  const b10 = (k, x) => L.push(`| ${k} | ${x.n} | ${sec(x.median)} | ${sec(x.p95)} | ${sec(x.max)} |`);
  b10("alle", sum.b10.all);
  for (const [k, x] of Object.entries(sum.b10.byProfile)) b10(`type ${k}`, x);
  for (const [k, x] of Object.entries(sum.b10.byGroup)) b10(`loebsgruppe ${k}`, x);
  return L.join("\n");
}

export function renderB11Markdown(sum) {
  const L = ["# #7884 trin 0: B11 gemte planer med et angrebsled (PRIVAT)", "", "| etaper | planer | med angrebsled | andel |", "|---|---|---|---|"];
  for (const [st, x] of Object.entries(sum.byState)) L.push(`| ${st} | ${x.plans} | ${x.plansWithAttack} | ${pct(x.shareWithAttack)} |`);
  L.push("", "## Angrebsled pr. punkt", "", "| punkt | koert | ikke koert endnu |", "|---|---|---|");
  for (const [p, x] of Object.entries(sum.legsByPoint)) L.push(`| ${p} | ${x.done ?? 0} | ${x.pending ?? 0} |`);
  L.push("", "## Angrebsled pr. rolle", "", "| rolle | koert | ikke koert endnu |", "|---|---|---|");
  for (const [p, x] of Object.entries(sum.legsByRole)) L.push(`| ${p} | ${x.done ?? 0} | ${x.pending ?? 0} |`);
  return L.join("\n");
}

// ── Koersel ─────────────────────────────────────────────────────────────────

/** Hard rule 17: maalte tal kun under en balance-internals-mappe. */
export function assertPrivateOut(dir) {
  if (!path.resolve(dir).split(/[\\/]+/).includes("balance-internals")) throw new Error(`--out skal ligge under balance-internals/ (hard rule 17): ${dir}`);
  return dir;
}

/** B2/B6/B10 paa S5-benchens loeb. Samme loebsraekkefoelge og traethed som s5MotorBench. */
export async function runBench7884({ scope = "all", simSeeds, genSeeds, revision, limit = null, now = () => performance.now() } = {}) {
  const { buildS5BenchRaces, loadBenchField, benchStageFatigues, S5_MOTOR_BENCH_CONFIG } = await import("./s5MotorBench.mjs");
  const { runStagesInOrder, splitEntrants } = await import("./lib/tourScorecard.mjs");
  const { loadRaceEngineV4, breakawayRiderIdsFromSnapshots } = await import("../../lib/raceEngineV4Bridge.js");
  const cfg = { scope, simSeeds: simSeeds ?? S5_MOTOR_BENCH_CONFIG.simSeeds, genSeeds: genSeeds ?? S5_MOTOR_BENCH_CONFIG.genSeeds, revision: revision ?? S5_MOTOR_BENCH_CONFIG.revision };
  const v4 = await loadRaceEngineV4();
  const field = loadBenchField();
  let races = buildS5BenchRaces({ scope, genSeeds: cfg.genSeeds });
  if (limit) races = races.slice(0, limit);
  const rows = [];
  for (const { seasonId, race, stages, grandTour } of races) {
    const raceId = `${race.id}:${seasonId}`;
    const profiles = stages.map((p) => ({ ...p, race_id: raceId }));
    const data = { ...field, race: { ...field.race, id: raceId, stages: profiles.length }, profiles };
    const { stagesSorted, fatigueById } = benchStageFatigues(data, cfg.revision);
    const group = benchRaceGroup(race, stagesSorted.length);
    for (let seed = 1; seed <= cfg.simSeeds; seed++) {
      const entrants = splitEntrants(data).entrants;
      const enterStage = (i) => { for (const e of entrants) e.fatigue = fatigueById.get(e.rider_id)[i]; };
      enterStage(0);
      let tPrev = now();
      runStagesInOrder({
        v4, data, revision: cfg.revision, seedTag: `s5bench-${seed}`, stages: stagesSorted, entrants,
        onStage: ({ profile, index, res }) => {
          const ms = now() - tPrev;
          const out = res.v4Output;
          const breakIds = new Set([...breakawayRiderIdsFromSnapshots(out?.groupSnapshots ?? [])].map(String));
          rows.push({ seasonId, raceId: race.id, group, grandTour, simSeed: seed, stage_number: profile.stage_number, ...measureStage7884({ profile, out, breakIds, ms }) });
          if (index + 1 < stagesSorted.length) enterStage(index + 1);
          tPrev = now();
        },
      });
    }
  }
  return { config: { ...cfg, races: races.length }, rows };
}

/**
 * B2/B6/B10 paa en prod-eksport (<race_id>/cache.json, som motor-testporten skriver): de
 * rigtige felter og spillernes gemte ordrer, pr. loebsgruppe (ogsaa U23/junior). Benchens felt
 * er lutter AI-hold, og motorens frem-split kommer kun fra "alt ud"; eksporten maaler derfor
 * B2 med de ordrer spillerne faktisk har givet. Felterne koeres som de er (ingen opfyldning).
 */
export async function runExport7884({ fromDir, caps, seeds = 1, revision = "s5_profiles_v3", now = () => performance.now() } = {}) {
  const { loadExport, selectRaces, DEFAULT_GROUP_CAPS } = await import("./tacticsEffects7266.mjs");
  const { runStagesInOrder, sortedStages, splitEntrants } = await import("./lib/tourScorecard.mjs");
  const { loadRaceEngineV4, breakawayRiderIdsFromSnapshots } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const picked = selectRaces(loadExport(fromDir), caps ?? DEFAULT_GROUP_CAPS);
  const rows = [];
  for (const pr of picked) {
    const data = pr.data;
    const stages = sortedStages(data);
    for (let seed = 1; seed <= seeds; seed++) {
      let tPrev = now();
      runStagesInOrder({
        v4, data, revision, seedTag: `t7884-exp-${seed}`, stages, entrants: splitEntrants(data).entrants,
        onStage: ({ profile, res }) => {
          const ms = now() - tPrev;
          const out = res.v4Output;
          const breakIds = new Set([...breakawayRiderIdsFromSnapshots(out?.groupSnapshots ?? [])].map(String));
          rows.push({ raceId: pr.id, group: pr.group, simSeed: seed, stage_number: profile.stage_number, ...measureStage7884({ profile, out, breakIds, ms }) });
          tPrev = now();
        },
      });
    }
  }
  return { config: { scope: "export", simSeeds: seeds, genSeeds: 0, revision, races: picked.length, caps: caps ?? DEFAULT_GROUP_CAPS }, rows };
}

function arg(argv, name, fallback = null) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return argv.includes(`--${name}`) ? true : fallback;
}

async function main(argv) {
  if (arg(argv, "print-b11-sql") === true) {
    console.log(B11_SQL);
    return;
  }
  const out = arg(argv, "out", null);
  const b11From = arg(argv, "b11-from", null);
  if (b11From) {
    const raw = JSON.parse(readFileSync(path.resolve(REPO_ROOT, b11From), "utf8"));
    const rows = Array.isArray(raw) ? raw : raw.rows ?? [];
    const sum = summarizeB11(rows);
    const md = renderB11Markdown(sum);
    if (!out) { console.log(md); return; }
    const dir = assertPrivateOut(path.resolve(REPO_ROOT, out));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "b11.json"), JSON.stringify({ rows, summary: sum }, null, 2));
    writeFileSync(path.join(dir, "b11.md"), md);
    console.error(`skrev ${path.join(dir, "b11.{json,md}")}`);
    return;
  }
  const fromDir = arg(argv, "from-dir", null);
  if (arg(argv, "bench") !== true && !fromDir) throw new Error("brug --bench, --from-dir=<eksport>, --print-b11-sql eller --b11-from=<fil>");
  if (!out) throw new Error("--bench/--from-dir kraever --out=balance-internals/...");
  const dir = assertPrivateOut(path.resolve(REPO_ROOT, out));
  const num = (k) => (arg(argv, k, null) == null ? undefined : Number(arg(argv, k)));
  const revision = arg(argv, "revision", null) ?? undefined;
  const t0 = performance.now();
  const capsArg = arg(argv, "groups", null);
  const caps = capsArg ? Object.fromEntries(String(capsArg).split(",").map((kv) => { const [k, v] = kv.split(":"); return [k, Number(v)]; })) : undefined;
  const res = fromDir
    ? await runExport7884({ fromDir: path.resolve(REPO_ROOT, fromDir), caps, seeds: num("sim-seeds") ?? 1, revision })
    : await runBench7884({ scope: arg(argv, "scope", "all"), simSeeds: num("sim-seeds"), genSeeds: num("gen-seeds"), revision, limit: num("limit") ?? null });
  const sum = summarize7884(res.rows);
  const name = fromDir ? "export-7884" : "bench-7884";
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ config: res.config, summary: sum, rows: res.rows }, null, 2));
  writeFileSync(path.join(dir, `${name}.md`), renderBenchMarkdown(sum, res.config));
  console.error(`${res.rows.length} etape-koersler paa ${((performance.now() - t0) / 1000).toFixed(1)} s; skrev ${path.join(dir, `${name}.{json,md}`)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err?.stack ?? err); process.exit(1); });
}
