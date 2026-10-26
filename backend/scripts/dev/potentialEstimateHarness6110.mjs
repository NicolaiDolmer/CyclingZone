// #6110 Udvikling 2.0, byggetrin 1: harness for potentiale-skønnet (gates H1-H6).
//
// OFFLINE: læser kun et dateret snapshot (snapshot-6110-potential-estimate.mjs)
// og en PRIVAT parameterfil. Ingen DB, ingen writes til spillet.
//
// Kør:
//   SNAP_DIR=<snapshot> PARAMS=<privat params.json> OUT_DIR=<privat mappe> \
//     node backend/scripts/dev/potentialEstimateHarness6110.mjs
//
// Sandt loft: rytterens potentiale omregnet 1-6 -> 1-99 med remap-variant B
// (lib/remap3564.mjs, samme kode som remap-dry-runnet). Det levende talent
// (retning C) findes ikke endnu, så loftet er statisk i denne version.
//
// Output (KUN til OUT_DIR, som skal ligge i balance-internals/, hard rule 17):
//   potential-estimate-harness.json  alle gate-tal
//   potential-estimate-harness.md    kort læsbar rapport
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SNAP_DIR = process.env.SNAP_DIR;
const PARAMS = process.env.PARAMS;
const OUT_DIR = process.env.OUT_DIR;
if (!SNAP_DIR || !PARAMS || !OUT_DIR) {
  console.error("Brug: SNAP_DIR=<snapshot> PARAMS=<params.json> OUT_DIR=<privat mappe> node backend/scripts/dev/potentialEstimateHarness6110.mjs");
  process.exit(1);
}

const { remapPotentiale } = await import(pathToFileURL(path.join(import.meta.dirname, "lib/remap3564.mjs")).href);
const { estimatePotential, uncertaintyFor, certaintyWord, CERTAINTY_WORDS } = await import(
  pathToFileURL(path.join(import.meta.dirname, "../../lib/potentialEstimate.js")).href
);

const params = JSON.parse(fs.readFileSync(PARAMS, "utf8"));
const riders = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, "riders.json"), "utf8"));
const knowledge = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, "knowledge.json"), "utf8"));
const meta = fs.existsSync(path.join(SNAP_DIR, "meta.json"))
  ? JSON.parse(fs.readFileSync(path.join(SNAP_DIR, "meta.json"), "utf8"))
  : {};

const { remapById, rankViolations } = remapPotentiale(riders.filter((r) => r.age != null), "b");
const riderById = new Map(riders.map((r) => [r.id, r]));

// Byggetrin 1b: det sande tal er det bløde loft i den naturlige rolle (ratingskala),
// ikke talent-tallet fra remappen. FIT_LOFT=1 fitter omsætningen på de ejede ryttere
// ud fra params.loftFit (mål private); ellers bruges params.loft direkte.
const { ratingLoft, fitLoft, shareOverLoft } = await import(pathToFileURL(path.join(import.meta.dirname, "lib/ratingLoft6110.mjs")).href);
const ownedRows = riders
  .filter((r) => r.team_id && r.rating != null && remapById.has(r.id))
  .map((r) => ({ rating: r.rating, talent: remapById.get(r.id).newPot99 }));
let loftFit = null;
if (process.env.FIT_LOFT === "1") {
  loftFit = fitLoft(ownedRows, params.loftFit);
  params.loft = loftFit.params;
}
const loftParams = params.loft ?? null;
// K3b (ejer 23/10): ryttere, der allerede er over deres loft, får et personligt
// loft lidt over deres rating, så ingen manager ser en "færdig" rytter.
const personalMargin = params.personalLoftMargin ?? null;
let personalLofts = 0;
const truePotOf = (id) => {
  const g = remapById.get(id)?.newPot99;
  if (g == null) return null;
  if (!loftParams) return g;
  const base = Math.round(ratingLoft(g, loftParams));
  const rating = riderById.get(id)?.rating;
  if (personalMargin != null && rating != null && rating >= base) return Math.min(99, rating + personalMargin);
  return base;
};
for (const r of riders) {
  const g = remapById.get(r.id)?.newPot99;
  if (g != null && loftParams && personalMargin != null && r.team_id && r.rating != null && r.rating >= Math.round(ratingLoft(g, loftParams))) personalLofts++;
}

// Stab fremskynder egen viden (samme idé som akademiets kendskabstrin #6666).
const staffSpeed = (k) => ((k.coachTier ?? 0) + (k.facilityTier ?? 0)) / 10;
const toKnowledge = (k) => (k.own
  ? { own: true, trainingDates: k.trainingDates, staffSpeed: staffSpeed(k) }
  : { own: false, looks: k.looks, bestScoutTier: k.bestScoutTier });

const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const share = (arr, pred) => (arr.length ? Math.round((1000 * arr.filter(pred).length) / arr.length) / 10 : null);

// ── H1: præcision pr. ord, på den VIRKELIGE viden i prod ───────────────────
const rows = [];
for (const k of knowledge) {
  const r = riderById.get(k.rider_id);
  const truePot = truePotOf(k.rider_id);
  if (!r || truePot == null) continue;
  const est = estimatePotential({ truePot, currentRating: r.rating, riderId: k.rider_id, teamId: k.team_id, knowledge: toKnowledge(k) }, params);
  rows.push({ own: k.own, hidden: est.hidden, word: est.certainty ?? null, err: est.hidden ? null : est.value - truePot });
}
const h1 = {};
for (const group of ["own", "scouted"]) {
  const g = rows.filter((x) => (group === "own" ? x.own : !x.own));
  h1[group] = { pairs: g.length, hidden: g.filter((x) => x.hidden).length, byWord: {} };
  for (const w of CERTAINTY_WORDS) {
    const errs = g.filter((x) => x.word === w).map((x) => Math.abs(x.err));
    h1[group].byWord[w] = {
      n: errs.length,
      p50: quantile(errs, 0.5),
      p90: quantile(errs, 0.9),
      max: errs.length ? Math.max(...errs) : null,
      within3pct: share(errs, (e) => e <= 3),
      within5pct: share(errs, (e) => e <= 5),
    };
  }
}

// ── H2: stabilitet. Skønnet afhænger ikke af dato; to kørsler er bit-identiske ──
let unstable = 0;
for (const k of knowledge.slice(0, 5000)) {
  const r = riderById.get(k.rider_id);
  const truePot = truePotOf(k.rider_id);
  if (!r || truePot == null) continue;
  const input = { truePot, currentRating: r.rating, riderId: k.rider_id, teamId: k.team_id, knowledge: toKnowledge(k) };
  if (JSON.stringify(estimatePotential(input, params)) !== JSON.stringify(estimatePotential(input, params))) unstable++;
}

// ── H3: monotoni. Mere viden skal give mindre fejl I FORVENTNING (gennemsnit
// over mange ryttere) og må aldrig gøre ordet usikrere. Pr. rytter kan fejlen
// godt stige en smule; det er prisen for inversionsværnet (delen pr. niveau).
const order = (w) => CERTAINTY_WORDS.indexOf(w);
const sample = riders.filter((r) => truePotOf(r.id) != null).slice(0, 4000);
const paths = {
  ...Object.fromEntries([1, 3, 5].map((tier) => [`scout_t${tier}`, [1, 2, 3].map((looks) => ({ own: false, looks, bestScoutTier: tier }))])),
  own: [5, 12, 20, 40].map((d) => ({ own: true, trainingDates: d, staffSpeed: 0 })),
};
const h3 = {};
let wordBreaks = 0, meanBreaks = 0, perRiderIncreases = 0, perRiderChecks = 0;
for (const [name, p] of Object.entries(paths)) {
  const sums = p.map(() => 0), counts = p.map(() => 0);
  for (const r of sample) {
    const base = { truePot: truePotOf(r.id), currentRating: 1, riderId: r.id, teamId: "hA" };
    let prevErr = Infinity, prevWord = -1;
    p.forEach((kn, i) => {
      const e = estimatePotential({ ...base, knowledge: kn }, params);
      if (e.hidden) return;
      const err = Math.abs(e.value - base.truePot);
      sums[i] += err; counts[i]++;
      perRiderChecks++;
      if (err > prevErr) perRiderIncreases++;
      if (order(e.certainty) < prevWord) wordBreaks++;
      prevErr = err; prevWord = order(e.certainty);
    });
  }
  const means = sums.map((s, i) => (counts[i] ? Math.round((100 * s) / counts[i]) / 100 : null));
  for (let i = 1; i < means.length; i++) if (means[i] != null && means[i - 1] != null && means[i] > means[i - 1]) meanBreaks++;
  h3[name] = means;
}

// ── H6: inversion. Hvor tæt kommer man på sandheden ved at slå flere holds skøn sammen? ──
const h6 = {};
for (const nTeams of [1, 3, 10]) {
  const errs = [];
  for (const r of sample.slice(0, 2000)) {
    const truePot = truePotOf(r.id);
    let sum = 0;
    for (let t = 0; t < nTeams; t++) {
      sum += estimatePotential({ truePot, currentRating: 1, riderId: r.id, teamId: `inv${t}`, knowledge: { own: false, looks: 1, bestScoutTier: 1 } }, params).value;
    }
    errs.push(Math.abs(sum / nTeams - truePot));
  }
  h6[`teams_${nTeams}`] = { p50: quantile(errs, 0.5), p90: quantile(errs, 0.9) };
}
// To-niveau-angrebet (review #7107): løs to aflæsninger fra samme hold for sandheden.
// Krav (privat grænse): højst marginalt bedre end holdets bedste enkelt-skøn.
{
  const k1 = { own: false, looks: 1, bestScoutTier: 1 }, k3 = { own: false, looks: 3, bestScoutTier: 1 };
  const u1 = uncertaintyFor(k1, params), u3 = uncertaintyFor(k3, params);
  const attack = [], best = [];
  for (const r of sample.slice(0, 2000)) {
    const truePot = truePotOf(r.id);
    const base = { truePot, currentRating: 1, riderId: r.id, teamId: "inv0" };
    const e1 = estimatePotential({ ...base, knowledge: k1 }, params).value;
    const e3 = estimatePotential({ ...base, knowledge: k3 }, params).value;
    attack.push(Math.abs((e1 * u3 - e3 * u1) / (u3 - u1) - truePot));
    best.push(Math.abs(e3 - truePot));
  }
  h6.two_level_attack = { p50: quantile(attack, 0.5), p90: quantile(attack, 0.9), best_single_p50: quantile(best, 0.5) };
}

// ── Ordfordeling i dag + usikkerhedstabellen som den er parametreret ──
const wordShare = {};
for (const group of ["own", "scouted"]) {
  const g = rows.filter((x) => (group === "own" ? x.own : !x.own) && !x.hidden);
  wordShare[group] = Object.fromEntries(CERTAINTY_WORDS.map((w) => [w, share(g, (x) => x.word === w)]));
}
const uTable = {
  scout: [1, 2, 3].map((looks) => [1, 3, 5].map((tier) => ({ looks, tier, u: uncertaintyFor({ own: false, looks, bestScoutTier: tier }, params), word: certaintyWord(uncertaintyFor({ own: false, looks, bestScoutTier: tier }, params), params) }))),
  own: [5, 12, 20, 40].map((d) => ({ dates: d, u: uncertaintyFor({ own: true, trainingDates: d }, params), word: certaintyWord(uncertaintyFor({ own: true, trainingDates: d }, params), params) })),
};

const out = {
  generated_at: new Date().toISOString(),
  snapshot: meta,
  params_file: path.basename(PARAMS),
  remap_rank_violations: rankViolations.length,
  loft: loftParams
    ? { params: loftParams, fitted: !!loftFit, owned_share_over_loft: Math.round(1000 * shareOverLoft(ownedRows, loftParams)) / 10, owned_personal_lofts: personalLofts }
    : null,
  h1_precision_by_word: h1,
  h2_unstable_pairs: unstable,
  h3: { mean_abs_err_by_step: h3, mean_increases: meanBreaks, word_downgrades: wordBreaks, per_rider_checks: perRiderChecks, per_rider_err_increases: perRiderIncreases },
  h4_note: "Lækage måles, når skønnet kobles på API og pris (byggetrin 4 og 11). Funktionen bruges i dag kun af denne harness.",
  h5_note: "Én funktion pr. (rytter, hold): alle flader får samme tal, når de læser samme kilde (byggetrin 4).",
  h6_pooling: h6,
  word_share_today: wordShare,
  uncertainty_table: uTable,
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "potential-estimate-harness.json"), JSON.stringify(out, null, 2));

const pct = (v) => (v == null ? "-" : `${String(v).replace(".", ",")} %`);
const md = [
  "# #6110 potentiale-skøn: harness (PRIVAT, hard rule 17)",
  "",
  `Snapshot: ${meta.measured_at_utc ?? "ukendt"} · params: ${path.basename(PARAMS)} · kørt ${out.generated_at}`,
  "",
  loftParams
    ? `Sandt tal = blødt loft i naturlig rolle (ratingskala)${loftFit ? ", fittet" : ""}: ${JSON.stringify(loftParams)} · ejede over loftet: ${pct(out.loft.owned_share_over_loft)} · personlige lofter: ${out.loft.owned_personal_lofts}`
    : "Sandt tal = talent-tal fra remappen (ikke ratingskala).",
  "",
  "## H1 præcision pr. ord (virkelig viden i prod)",
  "",
  "| Gruppe | Ord | n | p50 fejl | p90 fejl | maks | inden for ±3 | inden for ±5 |",
  "|---|---|---|---|---|---|---|---|",
  ...["own", "scouted"].flatMap((g) => CERTAINTY_WORDS.map((w) => {
    const b = h1[g].byWord[w];
    return `| ${g === "own" ? "egne" : "scoutede"} | ${w} | ${b.n} | ${b.p50 ?? "-"} | ${b.p90 ?? "-"} | ${b.max ?? "-"} | ${pct(b.within3pct)} | ${pct(b.within5pct)} |`;
  })),
  "",
  `Skjult (intet tal): egne ${h1.own.hidden} af ${h1.own.pairs}, scoutede ${h1.scouted.hidden} af ${h1.scouted.pairs}.`,
  "",
  "## Ordfordeling i dag",
  "",
  `Egne: ${CERTAINTY_WORDS.map((w) => `${w} ${pct(wordShare.own[w])}`).join(" · ")}`,
  `Scoutede: ${CERTAINTY_WORDS.map((w) => `${w} ${pct(wordShare.scouted[w])}`).join(" · ")}`,
  "",
  "## H2, H3, H6",
  "",
  `- H2 stabilitet: ${unstable} ustabile par (krav 0).`,
  `- H3 monotoni i forventning: gennemsnitlig fejl pr. trin ${Object.entries(h3).map(([k, v]) => `${k} ${v.join(" > ")}`).join(" · ")}; ${meanBreaks} trin hvor snittet steg, ${wordBreaks} hvor ordet blev usikrere (krav 0 og 0). Pr. rytter steg fejlen i ${perRiderIncreases} af ${perRiderChecks} trin (prisen for inversionsværnet).`,
  `- H6 to-niveau-angreb (p50/p90): ${h6.two_level_attack.p50}/${h6.two_level_attack.p90} mod bedste enkelt-skøn p50 ${h6.two_level_attack.best_single_p50} (krav: angrebet ikke bedre).`,
  `- H6 sammenlægning af flere holds niveau-1-skøn (p50/p90 fejl): ${Object.entries(h6).map(([k, v]) => `${k.replace("teams_", "")} hold ${v.p50}/${v.p90}`).join(" · ")}.`,
  `- Remap: ${rankViolations.length} rang-brud (krav 0).`,
  "",
  "## Forenklinger",
  "",
  "- Sandt loft = statisk remap (variant B). Det levende talent er ikke bygget.",
  "- Scoutens niveau = holdets bedste aktive scout i dag, ikke den der lavede kigget.",
  "- Træningsdatoer = forskellige tick_date på nuværende hold inden for snapshot-vinduet (standard 60 dage).",
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "potential-estimate-harness.md"), md);
console.log(md);
