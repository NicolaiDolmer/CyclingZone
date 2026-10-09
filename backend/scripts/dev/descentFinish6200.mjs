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
import { runStagesInOrder, sortedStages } from "./lib/tourScorecard.mjs";

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
export function analyseDescentFinish({ route, out, abilitiesById, capFor }) {
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
  const lengthKm = after.filter((s) => s.kind === "descent").reduce((sum, s) => sum + Math.max(0, s.to_km - s.from_km), 0);

  // 2: lukning pr. lukker (gruppe ved toppen) mod loftet. Referencen er den
  // forreste gruppe ved toppen; dens bedste tid i maal er nulpunktet.
  const groupsAtTop = [...top.groups].filter((g) => g.rider_ids.some((id) => finishGap.has(id))).sort((a, b) => a.gap_seconds - b.gap_seconds);
  const front = groupsAtTop[0];
  const bestFinish = (g) => Math.min(...g.rider_ids.filter((id) => finishGap.has(id)).map((id) => finishGap.get(id)));
  const frontFinish = front ? bestFinish(front) : 0;
  const closers = groupsAtTop.slice(1).filter((g) => g.gap_seconds <= 600).map((g) => {
    const closed = g.gap_seconds - (bestFinish(g) - frontFinish);
    const cap = capFor(g.gap_seconds, lengthKm);
    return { size: g.rider_ids.length, topGap: g.gap_seconds, closed, cap, ratio: cap > 0 ? closed / cap : (closed > 0 ? Infinity : 0) };
  });

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
  return {
    lengthKm,
    technicality: last.technicality,
    lastClimb: lastClimbIdx >= 0 ? { lengthKm: segs[lastClimbIdx].to_km - segs[lastClimbIdx].from_km, gradient: segs[lastClimbIdx].avg_gradient ?? null, category: segs[lastClimbIdx].category ?? null } : null,
    nr10Top: topSorted.length >= 10 ? topSorted[9][1] - topSorted[0][1] : null,
    nr10Finish: finishGap.get(finished[9].rider_id),
    frontSizeAtTop: frontIds.length,
    groupsAtTopWithin150: groupsAtTop.filter((g) => g.gap_seconds - (front?.gap_seconds ?? 0) <= 150).length,
    closers,
    maxCloserRatio: closers.length ? Math.max(...closers.map((c) => c.ratio)) : 0,
    bestClimberTopGap: bestClimberTopGap === null ? null : bestClimberTopGap - (front?.gap_seconds ?? 0),
    bestClimberFinishRank: finished.findIndex((r) => r.rider_id === bestClimber) + 1,
    bestClimberGainOnClimb: climberGainOnClimb,
    winnerClimbRankInFront: frontIds.length ? [...frontIds].sort((a, b) => climbing(b) - climbing(a) || a.localeCompare(b)).indexOf(winner) + 1 : null,
  };
}

const fmt = (x, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "-" : x.toFixed(d));

export function renderMarkdown({ label, rows }) {
  const lines = [`# #6200 nedkoerselsfinaler: ${label}`, "", `Genereret ${new Date().toISOString()}.`, ""];
  lines.push("| Revision | Etape | Seed | Nedk. km | Tek. | Sidste stigning km | Nr. 10 top | Nr. 10 maal | Front ved top | Grupper <=150 s | Max lukning/loft | Bedste klatrer hul top | Bedste klatrer nr. | Klatrer vinder paa stigning (s) | Vinders klatre-rang i front |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const a = r.a;
    lines.push(`| ${r.revision} | ${r.stage} | ${r.seed} | ${fmt(a.lengthKm, 1)} | ${a.technicality} | ${fmt(a.lastClimb?.lengthKm, 1)} | ${fmt(a.nr10Top)} | ${fmt(a.nr10Finish)} | ${a.frontSizeAtTop} | ${a.groupsAtTopWithin150} | ${fmt(a.maxCloserRatio, 2)} | ${fmt(a.bestClimberTopGap)} | ${a.bestClimberFinishRank} | ${fmt(a.bestClimberGainOnClimb)} | ${a.winnerClimbRankInFront ?? "-"} |`);
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

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const data = JSON.parse(readFileSync(opts.fixture === "giro" ? GIRO_FIXTURE : (opts.fixture ?? opts.cache), "utf8"));
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const { routeFromStageProfileRow } = await import("../../lib/engine/v4/adapters/routeAdapter.ts");
  const tm = await import("../../lib/engine/v4/mechanics/timeModel.ts");
  const v4 = await loadRaceEngineV4();
  const abilitiesById = new Map((data.abilities ?? []).map((a) => [a.rider_id, a]));
  const stages = sortedStages(data);
  const rows = [];
  for (const revision of opts.revisions) {
    const tuning = typeof tm.timeModelTuningForRevision === "function" ? tm.timeModelTuningForRevision(revision) : tm.SHARED_TIME_MODEL_V2_TUNING;
    const capFor = (gap, km) => tm.finishDescentChaseCapSeconds(gap, km, tuning);
    for (let s = 1; s <= opts.seeds; s++) {
      runStagesInOrder({
        v4, data, revision, seedTag: `${opts.seedPrefix}-${s}`, stages,
        onStage: ({ profile, res }) => {
          const a = analyseDescentFinish({ route: routeFromStageProfileRow(profile), out: res.v4Output, abilitiesById, capFor });
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
