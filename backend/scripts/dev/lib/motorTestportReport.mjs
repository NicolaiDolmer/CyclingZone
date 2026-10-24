// #6750 Motor-testport: samler tourDryRun-scorecards (et pr. kommende loeb) og
// S5-motor-benchen for en baseline- og en kandidat-revision til ÉT kort.
//
// REN: ingen IO. Tager de JSON-objekter tourDryRun.mjs og s5MotorBench skriver,
// og returnerer et kort (tal) + markdown/HTML. Kortet indeholder maalte tal og
// loebsnavne og skrives derfor KUN til balance-internals/ (gitignoreret) af
// motorTestport.mjs. Repoet er offentligt (hard rule 17): her staar ingen
// maalte tal, kun definitionerne.

import { evaluateV3Gates, measureSprintFinale, v3GatesApply } from "./v3Gates.mjs";

/** Tidskoersler: ingen udbrud, ingen favoritter at doemme. */
export const TIME_TRIAL_CLASSES = Object.freeze(["itt", "itt_hilly", "ttt"]);
const isRoad = (row) => !TIME_TRIAL_CLASSES.includes(row?.cls ?? row?.profile_type);

/**
 * Udbrudssejr "med stort forspring": taersklen er en balance-vaerdi og staar
 * derfor IKKE her (hard rule 17). motorTestport.mjs laeser den fra den private
 * taerskelfil i balance-internals/; mangler den, er maalingen null (vises "-").
 */

/**
 * Haarde gates: spillervendte fejl hvor virkeligheden har nul. Noeglerne er
 * scorecardets egne maalinger (tourScorecard.stageMetrics); labels er kortets.
 */
export const HARD_GATES = Object.freeze([
  ["labelContradictions", "maerkning-modsigelser"],
  ["minuteLossAtZeroKm", "minuttab paa 0 km"],
  ["flatBreakawayWinMinutes", "flad udbrudssejr med minutter"],
  ["gcTop10InBreakOver5Min", "GC-top10 i udbrud >5 min"],
  ["ownTeamChasesOwn", "hold jagter egne"],
  ["clampedAtCap", "ramt loft (liste-gab != raa tid)"],
]);

/** Benchmark-klasserne kortet viser udbrud og tidsgab for. */
export const TERRAIN_CLASSES = Object.freeze(["flat", "hilly", "mountain"]);

const VERDICTS = ["PASS", "WARN", "FAIL", "TODO", "N/A"];

// ── Smaa rene hjaelpere ──────────────────────────────────────────────────────

export function median(xs) {
  const s = xs.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
const share = (hits, n) => (n > 0 ? hits / n : null);
const has = (row, key) => row && Object.prototype.hasOwnProperty.call(row, key);

/** Dato i dansk tid (Europe/Copenhagen) som YYYY-MM-DD. */
export function copenhagenDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ── Indsamling ───────────────────────────────────────────────────────────────

/**
 * Et tourDryRun-resultat ({race, generatedAt, runs}) som kortets loebs-raekke.
 * `runs` noegles paa revision. Uden runs (fx et fejlet loeb) = null.
 */
export function raceResultFromDryRun(json) {
  if (!json?.race || !Array.isArray(json.runs) || !json.runs.length) return null;
  const runs = {};
  for (const r of json.runs) if (r?.revision && r.summary) runs[r.revision] = r;
  return {
    raceId: json.race.id ?? null,
    name: json.race.name ?? json.race.id ?? "?",
    stages: Number(json.race.stages) || Math.max(0, ...json.runs.map((r) => r.summary?.stages?.length ?? 0)),
    runs,
  };
}

/** Optaelling af domme pr. maaling (etape-, profiltype- og loebsdomme samlet). */
export function verdictTallies(summary) {
  const out = {};
  const add = (key, v) => {
    out[key] ??= Object.fromEntries(VERDICTS.map((x) => [x, 0]));
    if (out[key][v] !== undefined) out[key][v] += 1;
  };
  for (const r of summary?.stages ?? []) for (const [k, v] of Object.entries(r.verdicts ?? {})) add(k, v);
  for (const r of summary?.classes ?? []) for (const [k, v] of Object.entries(r.verdicts ?? {})) add(k, v);
  for (const [k, v] of Object.entries(summary?.race?.verdicts ?? {})) add(k, v);
  return out;
}

function mergeTallies(into, t) {
  for (const [k, c] of Object.entries(t)) {
    into[k] ??= Object.fromEntries(VERDICTS.map((x) => [x, 0]));
    for (const v of VERDICTS) into[k][v] += c[v] ?? 0;
  }
  return into;
}

function terrainStats(rows) {
  const won = rows.filter((r) => r.breakawayWon === true);
  return {
    n: rows.length,
    breakawayWinShare: share(won.length, rows.length),
    breakawaySizeMedian: median(rows.map((r) => r.breakawaySize)),
    // Som scorecardet (#6199): nr. 10 maales paa de seeds hvor udbruddet blev hentet.
    gapTo10Median: median(rows.filter((r) => r.breakawayWon !== true).map((r) => r.gapTo10)),
  };
}

/**
 * Alle kortets maalinger for EN revision over alle loeb. Loeb uden en koersel
 * under revisionen springes over (og taelles i `missing`). Maalinger kortet
 * bygger paa nye raekke-felter (vinderens rolle, udbrudsryttere, tidlig
 * indhentning) er null, naar ingen raekke har feltet (aeldre scorecards).
 */
export function aggregateRevision(raceResults, revision, { bigBreakawayWinSeconds = null } = {}) {
  const agg = {
    revision, races: 0, missing: 0, stageRuns: 0, roadRuns: 0,
    counts: Object.fromEntries(VERDICTS.map((x) => [x, 0])), tallies: {},
    hardGates: {}, bigBreakawayWins: 0, ittGapTo10Per40KmMedian: null,
    stageRaces: { races: 0, seeds: 0, gcTo10FinalMedian: null, gcWinnerMarginMedian: null },
    byClass: {}, byProfileType: {},
    favouriteBreakawayWins: null, gcWinnerFromBreak: null, earlyCatches: null,
  };
  for (const [k] of HARD_GATES) agg.hardGates[k] = { total: 0, racesHit: 0, racesFail: 0, measured: 0 };
  const allRows = [];
  const itt = [];
  const gcFinal = [];
  const gcMargin = [];
  const gcSeeds = { n: 0, member: 0, wonFromBreak: 0, known: false };
  for (const rr of raceResults) {
    const run = rr?.runs?.[revision];
    if (!run) { agg.missing += 1; continue; }
    agg.races += 1;
    for (const v of VERDICTS) agg.counts[v] += run.summary?.counts?.[v] ?? 0;
    mergeTallies(agg.tallies, verdictTallies(run.summary));
    const rows = (run.perSeed ?? []).flatMap((s) => s.rows ?? []);
    allRows.push(...rows);
    for (const [k] of HARD_GATES) {
      const vals = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
      const g = agg.hardGates[k];
      g.total += sum(vals);
      g.measured += vals.length;
      if (vals.some((v) => Number(v) > 0)) g.racesHit += 1;
      if (run.summary?.race?.verdicts?.[k] === "FAIL") g.racesFail += 1;
    }
    for (const r of rows) if (Number.isFinite(r.ittGapTo10Per40Km)) itt.push(r.ittGapTo10Per40Km);
    if (rr.stages > 1) {
      agg.stageRaces.races += 1;
      for (const s of run.perSeed ?? []) {
        agg.stageRaces.seeds += 1;
        gcFinal.push(s.gcFinalTo10);
        gcMargin.push(s.gcWinnerMargin);
        const sr = s.rows ?? [];
        if (!sr.some((r) => has(r, "breakawayRiderIds"))) continue;
        gcSeeds.known = true;
        if (!s.gcWinner) continue;
        gcSeeds.n += 1;
        if (sr.some((r) => (r.breakawayRiderIds ?? []).includes(s.gcWinner))) gcSeeds.member += 1;
        if (sr.some((r) => r.breakawayWon === true && r.winnerId === s.gcWinner)) gcSeeds.wonFromBreak += 1;
      }
    }
  }
  const road = allRows.filter(isRoad);
  agg.stageRuns = allRows.length;
  agg.roadRuns = road.length;
  const bigWinSeconds = Number.isFinite(Number(bigBreakawayWinSeconds)) && bigBreakawayWinSeconds !== null ? Number(bigBreakawayWinSeconds) : null;
  agg.bigBreakawayWins = bigWinSeconds === null ? null
    : road.filter((r) => r.breakawayWon === true && Number(r.breakawayWinMargin) >= bigWinSeconds).length;
  agg.bigBreakawayWinShare = agg.bigBreakawayWins === null ? null : share(agg.bigBreakawayWins, road.length);
  agg.ittGapTo10Per40KmMedian = median(itt);
  agg.stageRaces.gcTo10FinalMedian = median(gcFinal);
  agg.stageRaces.gcWinnerMarginMedian = median(gcMargin);
  for (const cls of TERRAIN_CLASSES) agg.byClass[cls] = terrainStats(road.filter((r) => r.cls === cls));
  for (const t of [...new Set(road.map((r) => r.profile_type))].sort()) agg.byProfileType[t] = terrainStats(road.filter((r) => r.profile_type === t));

  const wins = road.filter((r) => r.breakawayWon === true);
  if (road.some((r) => has(r, "winnerRole"))) {
    const fav = wins.filter((r) => r.winnerRole === "captain").length;
    agg.favouriteBreakawayWins = { count: fav, ofBreakawayWins: share(fav, wins.length), breakawayWins: wins.length, ofRoadRuns: share(fav, road.length) };
  }
  if (gcSeeds.known) {
    agg.gcWinnerFromBreak = { seeds: gcSeeds.n, member: gcSeeds.member, memberShare: share(gcSeeds.member, gcSeeds.n), wonFromBreak: gcSeeds.wonFromBreak, wonFromBreakShare: share(gcSeeds.wonFromBreak, gcSeeds.n) };
  }
  if (road.some((r) => has(r, "earlyCatch"))) {
    const withBreak = road.filter((r) => (r.breakawayRiderIds ?? []).length > 0);
    const early = road.filter((r) => r.earlyCatch === true).length;
    const reformed = road.filter((r) => r.reformed === true).length;
    agg.earlyCatches = { count: early, ofBreakaways: share(early, withBreak.length), breakaways: withBreak.length, reformed, reformedShare: share(reformed, early) };
  }
  return agg;
}

/** Pr. loeb: domme og haard-gate-hits under begge revisioner (til tabellen "pr. loeb"). */
export function perRaceRows(raceResults, baseline, candidate) {
  const pick = (run) => {
    if (!run) return null;
    const rows = (run.perSeed ?? []).flatMap((s) => s.rows ?? []);
    return { counts: run.summary?.counts ?? null, hardGateHits: sum(HARD_GATES.map(([k]) => sum(rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined)))) };
  };
  return raceResults
    .map((rr) => ({ raceId: rr.raceId, name: rr.name, stages: rr.stages, baseline: pick(rr.runs[baseline]), candidate: pick(rr.runs[candidate]) }))
    .sort((a, b) => {
      const d = (x) => (x.candidate?.counts?.FAIL ?? 0) - (x.baseline?.counts?.FAIL ?? 0);
      return d(b) - d(a) || (b.candidate?.hardGateHits ?? 0) - (a.candidate?.hardGateHits ?? 0) || String(a.name).localeCompare(String(b.name));
    });
}

// ── S5-motor-bench ───────────────────────────────────────────────────────────

/** Det kortet bruger af en s5MotorBench-JSON ({config, scope, summary}). */
export function benchView(json) {
  if (!json?.summary) return null;
  const s = json.summary;
  return {
    revision: json.config?.revision ?? null,
    scope: json.scope ?? null,
    config: json.config ?? null,
    gate: { medians: s.gate?.medians ?? {}, verdicts: s.gate?.verdicts ?? {}, sources: s.gate?.sources ?? {} },
    byTerrainFinish: Object.fromEntries(Object.entries(s.all?.byTerrainFinish ?? {}).map(([k, g]) => [k, { n: g.n, median: g.median, breakawayWinPct: g.breakawayWinPct }])),
    expectedWinnerShares: s.expectedWinnerShares ?? {},
  };
}

// ── Kortet ───────────────────────────────────────────────────────────────────

/**
 * Hele kortet: baseline og kandidat side om side + bench. `meta` er koerslens
 * parametre (seeds, parallel, kilde, fejlede loeb ...), skrives som de er.
 */
export function buildTestportCard({ raceResults, baseline, candidate, benchByRevision = {}, meta = {}, thresholds = {}, contexts = new Map() }) {
  const results = raceResults.filter(Boolean);
  const base = aggregateRevision(results, baseline, thresholds);
  const cand = baseline === candidate ? base : aggregateRevision(results, candidate, thresholds);
  const regressions = [];
  for (const [k, label] of HARD_GATES) {
    if (cand.hardGates[k].total > base.hardGates[k].total) regressions.push({ gate: k, label, baseline: base.hardGates[k].total, candidate: cand.hardGates[k].total });
  }
  return {
    generatedAt: meta.generatedAt ?? null,
    baseline, candidate, sameRevision: baseline === candidate,
    meta,
    races: results.length,
    thresholds,
    revisions: { baseline: base, candidate: cand },
    verdict: { failDelta: cand.counts.FAIL - base.counts.FAIL, passDelta: cand.counts.PASS - base.counts.PASS, hardGateRegressions: regressions },
    perRace: perRaceRows(results, baseline, candidate),
    bench: { baseline: benchByRevision[baseline] ?? null, candidate: benchByRevision[candidate] ?? null },
    // #6804 v3 (ejer valg 8 A): G16-G19 + G2-flad blokerer taendingen. Doemt for begge
    // revisioner; kun kandidatens dom blokerer, og kun naar kandidaten er v3 eller senere.
    v3Gates: {
      applies: v3GatesApply(candidate),
      baseline: evaluateV3Gates({ raceResults: results, revision: baseline, contexts, bands: thresholds.v3Gates ?? null }),
      candidate: evaluateV3Gates({ raceResults: results, revision: candidate, contexts, bands: thresholds.v3Gates ?? null }),
    },
    // #2757 S0: spurtfinalen (maaling, ingen gate).
    sprintFinale: { baseline: measureSprintFinale(results, baseline, contexts), candidate: measureSprintFinale(results, candidate, contexts) },
  };
}

// ── Formatering ──────────────────────────────────────────────────────────────

export const fmtS = (v) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "-";
  const s = Math.round(Number(v));
  const a = Math.abs(s);
  return `${s < 0 ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
};
export const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${Math.round(v * 100)} %`);
export const fmtN = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "-" : String(Math.round(Number(v) * 10 ** d) / 10 ** d));
const fmtDelta = (b, c, f = fmtN) => {
  if (!Number.isFinite(Number(b)) || !Number.isFinite(Number(c))) return "-";
  const d = Number(c) - Number(b);
  if (d === 0) return "=";
  return `${d > 0 ? "+" : "-"}${f(Math.abs(d))}`;
};

/** Kortets hovedtabel: [label, baseline-tekst, kandidat-tekst, delta-tekst]. */
export function sideBySideRows(card) {
  const b = card.revisions.baseline;
  const c = card.revisions.candidate;
  const rows = [];
  const add = (label, get, f = fmtN, deltaF = f) => rows.push([label, f(get(b)), f(get(c)), fmtDelta(get(b), get(c), deltaF)]);
  rows.push(["loeb koert", String(b.races), String(c.races), fmtDelta(b.races, c.races, (x) => String(x))]);
  add("etapekoersler (vej)", (a) => a.roadRuns, (x) => fmtN(x, 0));
  add("PASS", (a) => a.counts.PASS, (x) => fmtN(x, 0));
  add("WARN", (a) => a.counts.WARN, (x) => fmtN(x, 0));
  add("FAIL", (a) => a.counts.FAIL, (x) => fmtN(x, 0));
  for (const [k, label] of HARD_GATES) add(`haard gate: ${label} (hits)`, (a) => a.hardGates[k].total, (x) => fmtN(x, 0));
  const bigWin = card.thresholds?.bigBreakawayWinSeconds;
  const bigWinLabel = Number.isFinite(Number(bigWin)) && bigWin !== null ? `>${Number(bigWin) / 60} min` : "stort forspring (privat taerskel mangler)";
  add(`udbrudssejre ${bigWinLabel} (antal)`, (a) => a.bigBreakawayWins, (x) => fmtN(x, 0));
  add(`udbrudssejre ${bigWinLabel} (andel af vejetaper)`, (a) => a.bigBreakawayWinShare, fmtPct);
  add("enkeltstart nr. 10 pr. 40 km (median)", (a) => a.ittGapTo10Per40KmMedian, fmtS);
  add("etapeloeb: klassement nr. 10 slut (median)", (a) => a.stageRaces.gcTo10FinalMedian, fmtS);
  add("etapeloeb: vindermargin (median)", (a) => a.stageRaces.gcWinnerMarginMedian, fmtS);
  for (const cls of TERRAIN_CLASSES) {
    add(`${cls}: udbrud vandt`, (a) => a.byClass[cls]?.breakawayWinShare, fmtPct);
    add(`${cls}: udbrudsstoerrelse (median)`, (a) => a.byClass[cls]?.breakawaySizeMedian);
    add(`${cls}: nr. 10 hentet (median)`, (a) => a.byClass[cls]?.gapTo10Median, fmtS);
  }
  add("favorit-udbrudssejre (kaptajn vandt fra udbrud)", (a) => a.favouriteBreakawayWins?.count, (x) => fmtN(x, 0));
  add("favorit-udbrudssejre (andel af udbrudssejre)", (a) => a.favouriteBreakawayWins?.ofBreakawayWins, fmtPct);
  add("GC-vinder sad i udbrud (andel af etapeloeb x seeds)", (a) => a.gcWinnerFromBreak?.memberShare, fmtPct);
  add("GC-vinder vandt en etape fra udbrud (andel)", (a) => a.gcWinnerFromBreak?.wonFromBreakShare, fmtPct);
  add("tidlige indhentninger (andel af udbrud)", (a) => a.earlyCatches?.ofBreakaways, fmtPct);
  add("tidlige indhentninger med nyt udbrud (andel)", (a) => a.earlyCatches?.reformedShare, fmtPct);
  return rows;
}

const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];

/**
 * #6909: kortets linjer om input: startfeltets og ruternes kilde. `meta.field` og
 * `meta.routes` kommer fra motorTestportInputs.prepareInputs; mangler de, er
 * koerslen paa prod's egne tilmeldinger og ruter.
 */
export function inputLines(meta = {}) {
  const lines = [];
  const f = meta.field;
  if (f) {
    const parts = [`${f.prod} loeb med prod-tilmeldinger`];
    if (f.kind) parts.push(`${f.synthetic} med syntetisk felt (${f.kind}: ${f.note ?? "-"})`);
    if (f.skippedNoField) parts.push(`${f.skippedNoField} uden felt sprunget over`);
    lines.push(`Startfelt: ${parts.join(" · ")}`);
  } else {
    lines.push("Startfelt: prod-tilmeldinger");
  }
  const r = meta.routes;
  lines.push(r ? `Ruter: foreslaaede fra ${r.dir}${r.label ? ` (${r.label})` : ""}, ${r.races} loeb` : "Ruter: prod's nuvaerende race_stage_profiles");
  return lines;
}

/** #6804: kortets dom-linje for v3-gaterne (G16-G19 + G2-flad). */
export function v3GateLine(card) {
  const v = card.v3Gates;
  if (!v?.candidate) return "- v3-gaterne: ikke doemt.";
  if (!v.applies) return `- v3-gaterne (G16-G19, G2-flad) blokerer kun en v3-kandidat; ${card.candidate} er ikke v3, dommen vises til orientering.`;
  return v.candidate.blocked
    ? `- **TAEND-GATE v3 BLOKERET:** ${v.candidate.reasons.join("; ")}.`
    : "- Taend-gaten for v3: G16-G19 og G2-flad er groenne.";
}

/** Vaerdien af en v3-gate som kort tekst (tal kun i det private kort). */
export function v3GateValueText(g) {
  const x = g?.value;
  if (!x) return "-";
  switch (g.id) {
    case "G16": return [...Object.entries(x.byGroup ?? {}).filter(([, v]) => v.n).map(([k, v]) => `${k} ${fmtPct(v.gcAlsoKom)} (n ${v.n})`), `udbrudspoint ${x.komFromBreak ? fmtPct(x.komFromBreak.share) : "-"}`].join(" · ");
    case "G17": return [...Object.entries(x.byGroup ?? {}).map(([k, v]) => `${k} ${fmtPct(v.share)}`), `kaptajn ${fmtPct(x.captainRate)} / hjaelper ${fmtPct(x.helperRate)}`].join(" · ");
    case "G18": return `sprinter ${fmtPct(x.sprinterWins)} · klassementsvinder ${fmtPct(x.gcWinnerWins)} (n ${x.n}, ${x.races} loeb)`;
    case "G19": return `samlet ${fmtS(x.median)} (n ${x.n}) · ${Object.entries(x.byDivision ?? {}).map(([d, v]) => `${String(d).slice(0, 8)} ${fmtS(v.median)}`).join(" · ")}`;
    case "G2F": return `${x.n} etaper · over oevre zone uden jagt-interesse ${x.overUpperWithoutUnchased ?? "-"} · over haard graense ${x.overHardMax ?? "-"}`;
    default: return "-";
  }
}

function v3GateSection(card) {
  const v = card.v3Gates;
  if (!v?.candidate) return [];
  const byId = (side) => Object.fromEntries((v[side]?.gates ?? []).map((g) => [g.id, g]));
  const b = byId("baseline");
  const c = byId("candidate");
  return ["", `## Taend-gaten for v3 (#6804, ejer valg 8 A: blokerende)${v.applies ? "" : " - til orientering"}`, "",
    ...table(["Gate", `${card.baseline} dom`, `${card.baseline} vaerdi`, `${card.candidate} dom`, `${card.candidate} vaerdi`, "Hvorfor (kandidat)"],
      (v.candidate.gates ?? []).map((g) => [`${g.id} ${g.issue}: ${g.label}`, b[g.id]?.status ?? "-", v3GateValueText(b[g.id]), g.status, v3GateValueText(g), g.why ?? "-"])),
    "", "MANGLER = ingen maaling i scorecardet (motor-sporets felt er ikke leveret endnu) eller intet privat baand; det blokerer som FAIL."];
}

/** #2757 S0: spurtfinalens maaling, baseline og kandidat side om side. */
function sprintFinaleSection(card) {
  const s = card.sprintFinale;
  if (!s?.baseline && !s?.candidate) return ["", "## #2757 S0: spurtfinalen", "", "Ingen spurtfinaler i koerslen (eller ingen loebskontekst/sprintTop10 i scorecardet)."];
  const keys = [...new Set([...Object.keys(s.baseline ?? {}), ...Object.keys(s.candidate ?? {})])].sort((a, b) => (a === "alle" ? -1 : b === "alle" ? 1 : a.localeCompare(b)));
  const cells = (x) => (x ? [String(x.n), fmtPct(x.bestSprinterWins), fmtPct(x.top3Wins), fmtN(x.winnerSprintRankMedian), fmtPct(x.roleShares?.sprint_captain ?? 0), fmtPct(x.leadoutBeatOwnCaptain), fmtN(x.top10MeanRankDiffMedian), fmtPct(x.top5SprintersInTop10Median)] : Array(8).fill("-"));
  const head = ["n", "bedste sprinter vandt", "top 3 vandt", "vinderens sprint-rang (median)", "sprint-kaptajn vandt", "lead-out slog egen kaptajn", "top 10: |rang - plads| (median)", "feltets 5 bedste i top 10 (median)"];
  const sides = card.sameRevision ? [["baseline", card.baseline]] : [["baseline", card.baseline], ["candidate", card.candidate]];
  return ["", "## #2757 S0: spurtfinalen (maaling, ingen gate)",
    ...sides.flatMap(([side, rev]) => ["", `### ${rev}`, "", ...table(["Udsnit", ...head], keys.map((k) => [k, ...cells(s[side]?.[k])]))]),
    "", "Spurtfinale = flad eller brosten vej-etape (massespurt-etape i scorecardet) hvor udbruddet ikke vandt. Sprint-rang = plads i feltet efter evnen sprint (1 = bedst)."];
}

/** Markdown-kortet (privat, balance-internals). */
export function renderTestportMarkdown(card) {
  const b = card.revisions.baseline;
  const c = card.revisions.candidate;
  const m = card.meta ?? {};
  const lines = [
    `# Motor-testport (#6750): ${card.candidate} mod ${card.baseline} - PRIVAT (hard rule 17)`,
    "",
    `Genereret ${card.generatedAt ?? "-"} · ${card.races} loeb · ${m.seeds ?? "-"} seeds pr. revision · kilde ${m.source ?? "-"}${m.limit ? ` · --limit=${m.limit}` : ""}`,
    "",
    ...inputLines(m).map((l) => `- ${l}`),
  ];
  if (card.sameRevision) lines.push("", "**Kandidat = baseline**: samme koersel i begge kolonner (roegtest/reference).");
  if (m.failedRaces?.length) lines.push("", `**ADVARSEL:** ${m.failedRaces.length} opgaver fejlede og er IKKE med: ${m.failedRaces.join(", ")}.`);
  if (m.missingScorecards?.length) lines.push("", `**ADVARSEL:** ${m.missingScorecards.length} forventede loeb mangler et laesbart scorecard og er IKKE med: ${m.missingScorecards.join(", ")}.`);
  if (m.pendingTasks?.length) lines.push("", `**UFAERDIG:** tidsbudgettet stoppede koerslen; ${m.pendingTasks.length} opgaver er ikke koert: ${m.pendingTasks.join(", ")}. Koer samme kommando igen.`);
  if (b.missing || c.missing) lines.push("", `**ADVARSEL:** loeb uden koersel: baseline ${b.missing}, kandidat ${c.missing}.`);
  lines.push("", "## Dom", "");
  lines.push(`- FAIL: ${c.counts.FAIL} mod ${b.counts.FAIL} (${fmtDelta(b.counts.FAIL, c.counts.FAIL, (x) => fmtN(x, 0))}); PASS ${fmtDelta(b.counts.PASS, c.counts.PASS, (x) => fmtN(x, 0))}.`);
  const reg = card.verdict.hardGateRegressions;
  lines.push(reg.length ? `- Haarde gates VAERRE under kandidaten: ${reg.map((r) => `${r.label} ${r.baseline} -> ${r.candidate}`).join("; ")}.` : "- Ingen haard gate er vaerre under kandidaten.");
  lines.push(v3GateLine(card));
  lines.push(...v3GateSection(card), ...sprintFinaleSection(card));
  lines.push("", "## Side om side", "", ...table(["Maaling", card.baseline, card.candidate, "delta"], sideBySideRows(card)));
  lines.push("", "## Haarde gates", "", ...table(["Gate", ...[card.baseline, card.candidate].flatMap((r) => [`${r} hits`, `${r} loeb ramt`, `${r} loeb FAIL`])],
    HARD_GATES.map(([k, label]) => [label, ...[b, c].flatMap((a) => [fmtN(a.hardGates[k].total, 0), String(a.hardGates[k].racesHit), String(a.hardGates[k].racesFail)])])));
  lines.push("", "## Udbrud pr. profiltype (vejetaper)", "");
  const types = [...new Set([...Object.keys(b.byProfileType), ...Object.keys(c.byProfileType)])].sort();
  lines.push(...table(["Profil", ...[card.baseline, card.candidate].flatMap((r) => [`${r} n`, `${r} udbrud vandt`, `${r} str.`, `${r} nr. 10 hentet`])],
    types.map((t) => [t, ...[b, c].flatMap((a) => { const x = a.byProfileType[t]; return x ? [String(x.n), fmtPct(x.breakawayWinShare), fmtN(x.breakawaySizeMedian), fmtS(x.gapTo10Median)] : ["-", "-", "-", "-"]; })])));
  lines.push("", "## Scorecard-maal (domme pr. maaling, alle loeb)", "");
  const keys = [...new Set([...Object.keys(b.tallies), ...Object.keys(c.tallies)])].sort();
  const tt = (t) => (t ? `${t.PASS}/${t.WARN}/${t.FAIL}/${t.TODO}/${t["N/A"]}` : "-");
  lines.push(...table(["Maaling", `${card.baseline} P/W/F/T/NA`, `${card.candidate} P/W/F/T/NA`, "FAIL delta"], keys.map((k) => [k, tt(b.tallies[k]), tt(c.tallies[k]), fmtDelta(b.tallies[k]?.FAIL, c.tallies[k]?.FAIL, (x) => fmtN(x, 0))])));
  lines.push("", `## S5-motor-bench (--scope=${card.meta?.benchScope ?? "all"})`, "");
  const bb = card.bench.baseline;
  const cb = card.bench.candidate;
  if (!bb && !cb) {
    lines.push("Ikke koert (--no-bench) eller fejlet.");
  } else {
    const finishes = [...new Set([...Object.keys(bb?.gate.medians ?? {}), ...Object.keys(cb?.gate.medians ?? {})])].sort();
    lines.push("### Gatens del 4 (median nr. 10 pr. afslutning)", "", ...table(["Afslutning", `${card.baseline} median`, `${card.baseline} dom`, `${card.candidate} median`, `${card.candidate} dom`],
      finishes.map((f) => [f, bb?.gate.medians[f] == null ? "-" : `${bb.gate.medians[f]} s`, bb?.gate.verdicts[f] ?? "-", cb?.gate.medians[f] == null ? "-" : `${cb.gate.medians[f]} s`, cb?.gate.verdicts[f] ?? "-"])));
    const tf = [...new Set([...Object.keys(bb?.byTerrainFinish ?? {}), ...Object.keys(cb?.byTerrainFinish ?? {})])].sort();
    lines.push("", "### Udbrud pr. terraen/afslutning (alle loeb)", "", ...table(["Terraen/afslutning", `${card.baseline} n`, `${card.baseline} udbrud vandt`, `${card.baseline} nr. 10`, `${card.candidate} n`, `${card.candidate} udbrud vandt`, `${card.candidate} nr. 10`],
      tf.map((k) => [k, ...[bb, cb].flatMap((x) => { const g = x?.byTerrainFinish[k]; return g ? [String(g.n), g.breakawayWinPct == null ? "-" : `${g.breakawayWinPct} %`, g.median == null ? "-" : `${g.median} s`] : ["-", "-", "-"]; })])));
  }
  lines.push("", "## Pr. loeb (stoerst FAIL-forvaerring foerst)", "", ...table(["Loeb", "Etaper", `${card.baseline} P/W/F`, `${card.candidate} P/W/F`, "FAIL delta", `${card.baseline} gate-hits`, `${card.candidate} gate-hits`],
    card.perRace.map((r) => {
      const pwf = (x) => (x?.counts ? `${x.counts.PASS}/${x.counts.WARN}/${x.counts.FAIL}` : "-");
      return [r.name, String(r.stages), pwf(r.baseline), pwf(r.candidate), fmtDelta(r.baseline?.counts?.FAIL, r.candidate?.counts?.FAIL, (x) => fmtN(x, 0)), fmtN(r.baseline?.hardGateHits, 0), fmtN(r.candidate?.hardGateHits, 0)];
    })));
  lines.push("", "## Definitioner", "",
    "- Haarde gates: summen over alle loeb, etaper og seeds (hits); loeb ramt = mindst ét hit; loeb FAIL = scorecardets loebsdom FAIL.",
    "- Favorit-udbrudssejr: etapen vundet fra udbruddet (scorecardets breakawayWin) af en rytter med race_role captain.",
    "- GC-vinder fra udbrud: etapeloebets slutvinder sad i dagens udbrud paa mindst én etape (sad i), eller vandt en etape fra udbruddet.",
    "- Tidlig indhentning: morgenudbruddet hentet inden for motorens reformations-graense af etapen (S5_REFORMATION_TUNING.maxStageFraction); nyt udbrud = breakaway_formed med reformation.",
    "- Nr. 10 hentet: tidsgab vinder til nr. 10 paa de seeds hvor udbruddet IKKE vandt (som scorecardet).",
    "");
  return `${lines.join("\n")}\n`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** Et kompakt HTML-kort (dom + side om side) til PNG-gengivelse. */
export function renderTestportHtml(card) {
  const reg = card.verdict.hardGateRegressions;
  // Delta uden farve: om "+" er godt afhaenger af maalingen (PASS op = godt, FAIL op = skidt).
  const rows = sideBySideRows(card).map(([l, b, c, d]) => `<tr><td>${esc(l)}</td><td class="n">${esc(b)}</td><td class="n">${esc(c)}</td><td class="n">${esc(d)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px/1.4 system-ui,sans-serif;margin:0;padding:20px;background:#fff;color:#111;width:860px}
h1{font-size:18px;margin:0 0 4px}p{margin:4px 0 12px;color:#444}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left}
.n{text-align:right;font-variant-numeric:tabular-nums}
.bad{color:#9a3412;font-weight:600}.ok{color:#166534;font-weight:600}
</style></head><body>
<h1>Motor-testport: ${esc(card.candidate)} mod ${esc(card.baseline)}</h1>
<p>${esc(card.generatedAt ?? "")} · ${card.races} loeb · ${esc(card.meta?.seeds ?? "-")} seeds · PRIVAT</p>
<p>${inputLines(card.meta ?? {}).map(esc).join("<br>")}</p>
${(card.meta?.failedRaces?.length || card.meta?.missingScorecards?.length || card.meta?.pendingTasks?.length) ? `<p class="bad">UFULDSTAENDIG: ${card.meta?.failedRaces?.length ?? 0} opgaver fejlede, ${card.meta?.missingScorecards?.length ?? 0} scorecards mangler, ${card.meta?.pendingTasks?.length ?? 0} opgaver venter</p>` : ""}
<p class="${reg.length ? "bad" : "ok"}">${reg.length ? `Haarde gates vaerre: ${esc(reg.map((r) => r.label).join(", "))}` : "Ingen haard gate er vaerre under kandidaten"} · FAIL-delta ${esc(String(card.verdict.failDelta))}</p>
${card.v3Gates?.applies ? `<p class="${card.v3Gates.candidate.blocked ? "bad" : "ok"}">${esc(v3GateLine(card).replace(/^- /, "").replace(/\*\*/g, ""))}</p>` : ""}
<table><thead><tr><th>Maaling</th><th class="n">${esc(card.baseline)}</th><th class="n">${esc(card.candidate)}</th><th class="n">delta</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
