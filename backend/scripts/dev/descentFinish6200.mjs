// #6200: diagnose af nedkoerselsfinaler (bjergetaper der slutter paa en
// nedkoersel). Deler nr. 10's hul til vinderen op i tre dele pr. etape og seed:
//   1. hullet ved SIDSTE TOP (nr. 10 i gruppe-billedet ved toppen),
//   2. lukningen pr. lukker paa sidste nedkoersel, maalt mod loftet
//      (finishDescentChaseCapSeconds: hoejst et loft pr. km og en andel af hullet),
//   3. finaleplaceringen (hvor mange der kom samlet over toppen, og om den
//      bedste klatrer i frontgruppen tabte tid paa stigningen).
//
// READ-ONLY: ingen DB, ingen motor-aendring. Data fra en tourDryRun-cache eller
// det anonymiserede Giro-felt. Output (maalte tal) skrives KUN til den
// gitignorerede balance-internals/ (hard rule 17).
//
// Koer:
//   node backend/scripts/dev/descentFinish6200.mjs --cache=<tour-cache.json> --revision=official_times_v2[,official_times_v3] [--seeds=5] [--out=<fil.md>]
//   node backend/scripts/dev/descentFinish6200.mjs --fixture=giro --revision=official_times_v2
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { breakawaySets, breakawayWin, runStagesInOrder, sortedStages } from "./lib/tourScorecard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const GIRO_FIXTURE = path.join(here, "..", "baselines", "giro-field-6088-2026-10-02.json");

export function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
  };
  const seeds = Number(get("seeds", "5"));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds skal vaere et positivt heltal");
  return {
    cache: get("cache"),
    fixture: get("fixture"),
    revisions: String(get("revision", "official_times_v2")).split(",").map((s) => s.trim()).filter(Boolean),
    seeds,
    out: get("out"),
    seedPrefix: get("seed-prefix", "tour6285"),
  };
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Ren analyse af én etape. `route.segments` er motorens rute, `out` motorens
 * StageOutput (results + groupSnapshots, ét snapshot pr. segment).
 * Returnerer null naar etapen ikke har en nedkoerselsfinale (finale_type
 * "descent" med en nedkoersel efter sidste stigning).
 */
export function analyseDescentFinish({ route, out, abilitiesById, capFor, breakawayWin = null, breakawaySets = null, climbEntry = null }) {
  const segs = route?.segments ?? [];
  if (route?.finale_type !== "descent" || segs.length < 2) return null;
  const snaps = out?.groupSnapshots ?? [];
  if (snaps.length !== segs.length) return null;
  const lastClimbIdx = segs.map((s) => s.kind).lastIndexOf("climb");
  const after = segs.slice(lastClimbIdx + 1);
  const last = after.find((s) => s.kind === "descent");
  if (lastClimbIdx < 0 || !last) return null;
  // Toppen = snapshottet ved sidste stignings top.
  const top = snaps[lastClimbIdx];
  let blockStart = lastClimbIdx;
  while (blockStart > 0 && segs[blockStart - 1].kind === "climb") blockStart--;
  const beforeClimb = blockStart > 0 ? snaps[blockStart - 1] : null;
  const finished = (out.results ?? []).filter((r) => r.status === "finished").sort((a, b) => a.time_seconds - b.time_seconds || a.rank - b.rank);
  if (finished.length < 10) return null;
  const t0 = finished[0].time_seconds;
  const finishGap = new Map(finished.map((r) => [r.rider_id, r.time_seconds - t0]));
  const topGap = new Map();
  for (const g of top.groups) for (const id of g.rider_ids) topGap.set(id, g.gap_seconds);
  const topSorted = [...topGap.entries()].filter(([id]) => finishGap.has(id)).sort((a, b) => a[1] - b[1]);
  // Loftet maales fra toppen til stregen (nedkoersel + et evt. kort run-in).
  const lengthKm = after.reduce((sum, s) => sum + Math.max(0, s.to_km - s.from_km), 0);

  // 2: lukning pr. lukker (gruppe ved toppen) mod loftet. Referencen er den
  // forreste gruppe ved toppen. Gruppens MEDIAN i maal maaler gruppens lukning;
  // gruppens BEDSTE i maal maaler lukningen inkl. nedkoerselsangreb. Grupettoen
  // (tidsgraensens tempo) maales separat.
  const groupsAtTop = [...top.groups].filter((g) => g.rider_ids.some((id) => finishGap.has(id))).sort((a, b) => a.gap_seconds - b.gap_seconds);
  const front = groupsAtTop[0];
  const finishesOf = (g) => g.rider_ids.filter((id) => finishGap.has(id)).map((id) => finishGap.get(id));
  const bestFinish = (g) => Math.min(...finishesOf(g));
  const frontMedian = front ? median(finishesOf(front)) : 0;
  const frontBest = front ? bestFinish(front) : 0;
  const closers = groupsAtTop.slice(1).filter((g) => g.gap_seconds <= 600).map((g) => {
    const closed = g.gap_seconds - (median(finishesOf(g)) - frontMedian);
    const closedBest = g.gap_seconds - (bestFinish(g) - frontBest);
    const cap = capFor(g.gap_seconds, lengthKm);
    const ratioOf = (c) => (cap > 0 ? c / cap : (c > 0 ? Infinity : 0));
    return { kind: g.kind, size: g.rider_ids.length, topGap: g.gap_seconds, closed, closedBest, cap, ratio: ratioOf(closed), ratioBest: ratioOf(closedBest) };
  });
  const racing = closers.filter((c) => c.kind !== "gruppetto");
  const gruppetto = closers.filter((c) => c.kind === "gruppetto");

  // 3: finaleplaceringen. Frontgruppen ved toppen og den bedste klatrer i den.
  const climbing = (id) => Number(abilitiesById.get(id)?.climbing ?? 0);
  const frontIds = front ? front.rider_ids.filter((id) => finishGap.has(id)) : [];
  const bestClimber = [...topGap.keys()].filter((id) => finishGap.has(id)).sort((a, b) => climbing(b) - climbing(a) || a.localeCompare(b))[0];
  const bestClimberTopGap = bestClimber ? topGap.get(bestClimber) : null;
  const winner = finished[0].rider_id;
  // Fik den bedste klatrer (blandt de ryttere der kom samlet ind til
  // slutstigningen) tid paa stigningen? Gruppen foer stigningen er referencen.
  let climberGainOnClimb = null;
  if (beforeClimb) {
    const g = beforeClimb.groups.find((x) => x.rider_ids.includes(bestClimber));
    if (g) {
      const peersAtTop = g.rider_ids.filter((id) => id !== bestClimber && topGap.has(id)).map((id) => topGap.get(id));
      climberGainOnClimb = peersAtTop.length ? median(peersAtTop) - topGap.get(bestClimber) : null;
    }
  }
  // 4: kontrakten pr. seed (ejer 5/10). Klatrer-parrene: ryttere i samme gruppe
  // ved indgangen til den afgoerende stigning (sidste blok), som stadig koerer ved
  // toppen. En bedre klatrer der kommer over efter en daarligere (mere end
  // CLIMB_PAIR_SLACK_S) er et brud. Hullet maales paa gruppe-billedet ved toppen.
  // Med `climbEntry` (rytter -> gruppe, art, energi 0-1, indsats ved stigningens
  // indgang, fra motoren selv) er et par med mindre energi tilbage (mere end
  // CLIMB_ENERGY_SLACK) eller en anden indsats end den daarligere klatrer
  // forklaret, ikke et brud: kontrakten sammenligner evne ved lige vilkaar.
  const climberPairs = [];
  let climberExplained = 0;
  const entryGroups = new Map();
  if (climbEntry) {
    for (const [id, x] of climbEntry) {
      if (x.kind === "gruppetto") continue;
      if (!entryGroups.has(x.group)) entryGroups.set(x.group, []);
      entryGroups.get(x.group).push(id);
    }
  } else if (beforeClimb) {
    // En grupetto koerer ikke om etapen (faelles tempo, deles ikke af klatring).
    for (const g of beforeClimb.groups) if (g.kind !== "gruppetto") entryGroups.set(g.group_id ?? g.id, g.rider_ids);
  }
  for (const groupIds of entryGroups.values()) {
    const ids = groupIds.filter((id) => topGap.has(id) && finishGap.has(id));
    for (const a of ids) for (const b of ids) {
      if (a === b || !(climbing(a) > climbing(b))) continue;
      const lost = topGap.get(a) - topGap.get(b);
      if (!(lost > CLIMB_PAIR_SLACK_S)) continue;
      const ea = climbEntry?.get(a);
      const eb = climbEntry?.get(b);
      if (ea && eb && (ea.effort !== eb.effort || ea.energy < eb.energy - CLIMB_ENERGY_SLACK)) {
        climberExplained++;
        continue;
      }
      climberPairs.push({ better: climbing(a), worse: climbing(b), lost });
    }
  }
  // Placering: i frontgruppen ved toppen slaar en klart daarligere klatrer
  // (mindst CLEAR_CLIMB_MARGIN under) der heller ikke er en bedre nedkoerer,
  // aldrig den bedre klatrer i maal. Klatring vejer i placeringen
  // (descentFinaleDemand); nedkoersel, positionering og stoej kan stadig afgoere
  // mellem ryttere hvor ingen dominerer.
  const descending = (id) => Number(abilitiesById.get(id)?.descending ?? 0);
  const place = new Map(finished.map((r, i) => [r.rider_id, i]));
  let placementBreaches = 0;
  for (const a of frontIds) for (const b of frontIds) {
    if (climbing(a) >= climbing(b) + CLEAR_CLIMB_MARGIN && descending(a) >= descending(b) && place.get(a) > place.get(b)) placementBreaches++;
  }
  const nr10Id = topSorted.length >= 10 ? topSorted[9][0] : null;
  const nr10TopGap = nr10Id ? topSorted[9][1] - topSorted[0][1] : null;
  // Nr. 10 ved toppens lukning paa vej til maal: hans hul ved toppen minus hans hul i maal.
  const nr10Closed = nr10Id ? nr10TopGap - finishGap.get(nr10Id) : null;
  const nr10Cap = nr10Id ? capFor(nr10TopGap, lengthKm) : null;
  const bw = breakawayWin ? breakawayWin(out) : { won: false };
  // Vandt udbruddet: nr. 10 blandt ryttere uden for morgenudbruddet, maalt til
  // den foerste af dem (favoritternes etape). Kun information ved siden af N/A.
  let nr10Favourites = null;
  if (bw.won === true && breakawaySets) {
    const { formed } = breakawaySets(out);
    const favs = finished.filter((r) => !formed.has(r.rider_id));
    if (favs.length >= 10) nr10Favourites = favs[9].time_seconds - favs[0].time_seconds;
  }
  return {
    breakawayWon: bw.won === true,
    nr10Favourites,
    climberViolations: climberPairs.length,
    climberExplained,
    placementBreaches,
    climberWorstLoss: climberPairs.length ? Math.max(...climberPairs.map((p) => p.lost)) : 0,
    nr10Closed,
    nr10Cap,
    lengthKm,
    technicality: last.technicality,
    lastClimb: lastClimbIdx >= 0 ? { lengthKm: segs[lastClimbIdx].to_km - segs[lastClimbIdx].from_km, gradient: segs[lastClimbIdx].avg_gradient ?? null, category: segs[lastClimbIdx].category ?? null } : null,
    nr10Top: topSorted.length >= 10 ? topSorted[9][1] - topSorted[0][1] : null,
    nr10Finish: finishGap.get(finished[9].rider_id),
    frontSizeAtTop: frontIds.length,
    groupsAtTopWithin150: groupsAtTop.filter((g) => g.gap_seconds - (front?.gap_seconds ?? 0) <= 150).length,
    closers,
    maxCloserRatio: racing.length ? Math.max(...racing.map((c) => c.ratio)) : 0,
    maxCloserRatioBest: racing.length ? Math.max(...racing.map((c) => c.ratioBest)) : 0,
    maxGruppettoRatio: gruppetto.length ? Math.max(...gruppetto.map((c) => c.ratio)) : 0,
    bestClimberTopGap: bestClimberTopGap === null ? null : bestClimberTopGap - (front?.gap_seconds ?? 0),
    bestClimberFinishRank: finished.findIndex((r) => r.rider_id === bestClimber) + 1,
    bestClimberGainOnClimb: climberGainOnClimb,
    winnerClimbRankInFront: frontIds.length ? [...frontIds].sort((a, b) => climbing(b) - climbing(a) || a.localeCompare(b)).indexOf(winner) + 1 : null,
  };
}

/**
 * Ejerens 5/10-kontrakt for én etape i ét seed (#6200). Hver del er PASS, FAIL
 * eller N/A:
 *  - loft: alle jagende grupper (ikke grupettoen) og nr. 10 lukker hoejst loftet
 *    fra toppen til maal (afrundings-slack CAP_SLACK_S), ogsaa gruppens bedste;
 *  - nr10: nr. 10 er NR10_BAND_S efter vinderen; N/A naar udbruddet vandt
 *    (scorecardets opdeling, docs/RACE_ENGINE_RULES.md);
 *  - klatrer: ingen bedre klatrer taber tid til en daarligere paa den afgoerende stigning;
 *  - placering: i frontgruppen ved toppen slaar en klart daarligere klatrer, der
 *    heller ikke er en bedre nedkoerer, aldrig den bedre klatrer i maal.
 */
export const CAP_SLACK_S = 1;
export const CLIMB_PAIR_SLACK_S = 1;
export const CLIMB_ENERGY_SLACK = 0.02;
export const CLEAR_CLIMB_MARGIN = 5;
export const NR10_BAND_S = Object.freeze([60, 150]);
export function contractVerdict(a) {
  const capOk = a.closers.filter((c) => c.kind !== "gruppetto").every((c) => c.closed <= c.cap + CAP_SLACK_S && c.closedBest <= c.cap + CAP_SLACK_S)
    && (a.nr10Closed === null || a.nr10Closed <= a.nr10Cap + CAP_SLACK_S);
  const nr10 = a.breakawayWon ? "N/A" : (a.nr10Finish >= NR10_BAND_S[0] && a.nr10Finish <= NR10_BAND_S[1] ? "PASS" : "FAIL");
  const placement = a.placementBreaches === 0 ? "PASS" : "FAIL";
  const parts = { cap: capOk ? "PASS" : "FAIL", nr10, climber: a.climberViolations === 0 ? "PASS" : "FAIL", placement };
  return { ...parts, all: Object.values(parts).includes("FAIL") ? "FAIL" : "PASS" };
}

const fmt = (x, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "-" : x.toFixed(d));

export function renderMarkdown({ label, rows }) {
  const lines = [`# #6200 nedkoerselsfinaler: ${label}`, "", `Genereret ${new Date().toISOString()}.`, ""];
  lines.push("| Revision | Etape | Seed | Nedk. km | Tek. | Sidste stigning km | Nr. 10 top | Nr. 10 maal | Front ved top | Grupper <=150 s | Max lukning/loft (gruppe) | Max lukning/loft (inkl. angreb) | Grupetto lukning/loft | Bedste klatrer hul top | Bedste klatrer nr. | Klatrer vinder paa stigning (s) | Vinders klatre-rang i front |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const a = r.a;
    lines.push(`| ${r.revision} | ${r.stage} | ${r.seed} | ${fmt(a.lengthKm, 1)} | ${a.technicality} | ${fmt(a.lastClimb?.lengthKm, 1)} | ${fmt(a.nr10Top)} | ${fmt(a.nr10Finish)} | ${a.frontSizeAtTop} | ${a.groupsAtTopWithin150} | ${fmt(a.maxCloserRatio, 2)} | ${fmt(a.maxCloserRatioBest, 2)} | ${fmt(a.maxGruppettoRatio, 2)} | ${fmt(a.bestClimberTopGap)} | ${a.bestClimberFinishRank} | ${fmt(a.bestClimberGainOnClimb)} | ${a.winnerClimbRankInFront ?? "-"} |`);
  }
  lines.push("", "## Kontrakten pr. seed (ejer 5/10)", "", "| Revision | Etape | Seed | Udbrud vandt | Nr. 10 lukket / loft | Loft | Nr. 10 (60-150 s) | Klatrer-brud (vaerste s) | Placering | Samlet |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const a = r.a;
    const v = contractVerdict(a);
    lines.push(`| ${r.revision} | ${r.stage} | ${r.seed} | ${a.breakawayWon ? "ja" : "nej"} | ${fmt(a.nr10Closed)} / ${fmt(a.nr10Cap)} | ${v.cap} | ${fmt(a.nr10Finish)} ${v.nr10}${a.nr10Favourites !== null && a.nr10Favourites !== undefined ? ` (favoritter ${fmt(a.nr10Favourites)})` : ""} | ${a.climberViolations} (${fmt(a.climberWorstLoss)}) ${v.climber}; forklaret ${a.climberExplained ?? "-"} | ${a.placementBreaches} ${v.placement} | ${v.all} |`);
  }
  lines.push("", "## Kontrakten pr. revision og etape (antal seeds)", "", "| Revision | Etape | Seeds | Loft PASS | Nr. 10 PASS / FAIL / N/A | Klatrer PASS | Placering PASS | Samlet PASS |", "|---|---|---|---|---|---|---|---|");
  for (const k of [...new Set(rows.map((r) => `${r.revision}|${r.stage}`))]) {
    const [rev, stage] = k.split("|");
    const vs = rows.filter((r) => r.revision === rev && String(r.stage) === stage).map((r) => contractVerdict(r.a));
    const n = (key, val) => vs.filter((v) => v[key] === val).length;
    lines.push(`| ${rev} | ${stage} | ${vs.length} | ${n("cap", "PASS")} | ${n("nr10", "PASS")} / ${n("nr10", "FAIL")} / ${n("nr10", "N/A")} | ${n("climber", "PASS")} | ${n("placement", "PASS")} | ${n("all", "PASS")} |`);
  }
  lines.push("", "## Median pr. revision og etape", "", "| Revision | Etape | Nr. 10 top | Nr. 10 maal | Front ved top | Max lukning/loft |", "|---|---|---|---|---|---|");
  const keys = [...new Set(rows.map((r) => `${r.revision}|${r.stage}`))];
  for (const k of keys) {
    const [rev, stage] = k.split("|");
    const rs = rows.filter((r) => r.revision === rev && String(r.stage) === stage).map((r) => r.a);
    lines.push(`| ${rev} | ${stage} | ${fmt(median(rs.map((a) => a.nr10Top)))} | ${fmt(median(rs.map((a) => a.nr10Finish)))} | ${fmt(median(rs.map((a) => a.frontSizeAtTop)))} | ${fmt(median(rs.map((a) => a.maxCloserRatio)), 2)} |`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Rytterne ved indgangen til den afgoerende stigning (sidste blok af stigninger),
 * maalt i motoren selv: etapen genkoeres med samme input og et climbSelection-hook
 * der registrerer gruppe, art, energi (W' / W'max) og indsats foer det kalder det
 * rigtige hook. Motoren er deterministisk, saa genkoerslen er identisk med etapen.
 */
export function climbEntryAtDecidingClimb({ input, route, core, runSegmentLoop }) {
  const segs = route.segments ?? [];
  const lastClimb = segs.map((s) => s.kind).lastIndexOf("climb");
  if (lastClimb < 0) return null;
  let start = lastClimb;
  while (start > 0 && segs[start - 1].kind === "climb") start--;
  const entry = new Map();
  const live = core.LIVE_MECHANIC_HOOKS;
  runSegmentLoop(input, {
    ...live,
    climbSelection: (state, ctx) => {
      if (ctx.segmentIndex === start) {
        for (const g of state.groups) for (const id of g.rider_ids) {
          const r = state.riders[id];
          entry.set(id, { group: g.id, kind: g.kind, energy: r && r.wprimeMax > 0 ? r.wprime / r.wprimeMax : 0, effort: ctx.entrants[id]?.effort ?? null });
        }
      }
      return live.climbSelection(state, ctx);
    },
  });
  return entry;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const data = JSON.parse(readFileSync(opts.fixture === "giro" ? GIRO_FIXTURE : (opts.fixture ?? opts.cache), "utf8"));
  const bridgeUrl = new URL("../../lib/raceEngineV4Bridge.js", import.meta.url);
  const bridge = await import(bridgeUrl.href);
  const { routeFromStageProfileRow } = await import("../../lib/engine/v4/adapters/routeAdapter.ts");
  const tm = await import("../../lib/engine/v4/mechanics/timeModel.ts");
  const core = await import("../../lib/engine/v4/index.ts");
  const { runSegmentLoop } = await import("../../lib/engine/v4/segmentLoop.ts");
  // Motorens StageInput fanges pr. etape (samme input som broen sender), saa
  // klatrer-kontrakten kan genkoere etapen med et maalende climbSelection-hook.
  let capturedInput = null;
  bridge.__resetRaceEngineV4Cache();
  const v4 = await bridge.loadRaceEngineV4({
    importModule: async (spec) => {
      const m = await import(new URL(spec, bridgeUrl).href);
      if (typeof m.simulateStageV4WithTrace !== "function") return m;
      return { ...m, simulateStageV4WithTrace: (input) => { capturedInput = input; return m.simulateStageV4WithTrace(input); } };
    },
  });
  const climbEntryFor = (route) => (capturedInput ? climbEntryAtDecidingClimb({ input: capturedInput, route, core, runSegmentLoop }) : null);
  const abilitiesById = new Map((data.abilities ?? []).map((a) => [a.rider_id, a]));
  const stages = sortedStages(data);
  const rows = [];
  for (const revision of opts.revisions) {
    // Revisionens egen tidsmodel pr. profil (CodeRabbit-fund): generation 3 = official_times_v3.
    const sharedGroupTime = revision === "official_times_v3" ? { timeModelGeneration: 3 } : {};
    for (let s = 1; s <= opts.seeds; s++) {
      runStagesInOrder({
        v4, data, revision, seedTag: `${opts.seedPrefix}-${s}`, stages,
        onStage: ({ profile, res }) => {
          const route = routeFromStageProfileRow(profile);
          const tuning = tm.timeModelTuningFor({ ordersGcV3: true, sharedGroupTime, route: { profile_type: route.profile_type } });
          const capFor = (gap, km) => tm.finishDescentChaseCapSeconds(gap, km, tuning);
          const quick = analyseDescentFinish({ route, out: res.v4Output, abilitiesById, capFor, breakawayWin });
          const a = quick ? analyseDescentFinish({ route, out: res.v4Output, abilitiesById, capFor, breakawayWin, breakawaySets, climbEntry: climbEntryFor(route) }) : null;
          if (a) rows.push({ revision, stage: profile.stage_number, seed: s, a });
        },
      });
    }
  }
  const md = renderMarkdown({ label: data.race?.name ?? data.race?.id ?? "race", rows });
  if (opts.out) {
    mkdirSync(path.dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, md);
    console.log(`Skrevet: ${opts.out}`);
  } else {
    process.stdout.write(md);
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
