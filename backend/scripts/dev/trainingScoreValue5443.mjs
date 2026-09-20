// #5443 runde 6 · Træningsscoren som drivkraft i værdien (ejer-direktiv 20/9).
// READ-ONLY. Kalibrerer score → vækstrate mod FAKTISK målt evne-fremgang,
// bygger formel V6, og måler dækning, misbrug og stabilitet.
//
//   infisical run --env=prod --silent -- node scripts/dev/trainingScoreValue5443.mjs \
//     --base-model=lib/riderValuationModelV4.candidate-5443-V5.json --out=<mappe>

import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { ABILITY_KEYS } from "../../lib/riderTypes.js";
import { ABILITY_KEYS as RACE_ABILITY_KEYS } from "../../lib/raceSimulator.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { applyTypeDampening } from "../../lib/riderValuationTypeDampening.js";
import { recomputeRiderValue } from "../../lib/riderValueRefresh.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";
import { olsSolve } from "../../lib/riderValuationFit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, "../../lib");
const BACKEND = join(__dirname, "../..");

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(`--${n}=`.length) : d; };
const BASE_MODEL = resolve(join(BACKEND, String(arg("base-model", "lib/riderValuationModelV4.candidate-5443-V5.json"))));
const OUT_DIR = resolve(arg("out", join(BACKEND, "../balance-internals/2026-09-20-5443-v4-refit/sammenligning-runde6")));
const WINDOWS = String(arg("windows", "7,14,30")).split(",").map(Number);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ mangler secrets; kør via infisical"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const n0 = (x) => Number(x) || 0;
const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} %`);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

async function main() {
  console.log("=== #5443 runde 6 · træningsscore i værdien (READ-ONLY) ===");
  const baseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
  const v5raw = JSON.parse(readFileSync(BASE_MODEL, "utf8"));
  const v5 = applyTypeDampening(v5raw);

  const { data: season } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = season?.number ?? 3;

  const riders = await fetchAllRows(() => sb.from("riders")
    .select("id, firstname, lastname, team_id, is_retired, is_academy, primary_type, secondary_type, valuation_type, base_value, birthdate, potentiale, archetype_draw").order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);
  const teams = await fetchAllRows(() => sb.from("teams").select("id, is_ai, is_bank, is_test_account").order("id"));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const isHuman = (id) => { const t = id ? teamById.get(id) : null; return Boolean(t && t.is_ai === false && t.is_bank !== true && t.is_test_account !== true); };
  const abilityCols = [...new Set([...ABILITY_KEYS, ...RACE_ABILITY_KEYS])];
  const abilities = await fetchAllRows(() => sb.from("rider_derived_abilities").select(`rider_id, ability_caps, ${abilityCols.join(", ")}`).order("rider_id"));
  const abById = new Map(abilities.map((a) => [a.rider_id, a]));

  const scores = await fetchAllRows(() => sb.from("rider_training_scores").select("rider_id, tick_date, score, was_race_day").order("rider_id"));
  const byRider = new Map();
  for (const s of scores) { if (!byRider.has(s.rider_id)) byRider.set(s.rider_id, []); byRider.get(s.rider_id).push(s); }
  const allDates = [...new Set(scores.map((s) => s.tick_date))].sort();
  console.log(`Score-historik: ${scores.length} rækker · ${byRider.size} ryttere · ${allDates.length} dage (${allDates[0]} → ${allDates[allDates.length - 1]})`);

  // Vindues-gennemsnit. Historikken raekker kun 6 dage, saa 14 og 30 er i
  // praksis det samme som "alt hvad der findes" - det rapporteres eksplicit.
  const windowMean = (riderId, days) => {
    const rows = (byRider.get(riderId) || []).filter((r) => Number.isFinite(Number(r.score)));
    if (!rows.length) return null;
    const cut = allDates.slice(-days);
    const inWin = rows.filter((r) => cut.includes(r.tick_date));
    const use = inWin.length ? inWin : rows;
    return mean(use.map((r) => Number(r.score)));
  };

  // ── Kalibrering: score → faktisk maalt evne-fremgang ──────────────────────
  const since = allDates[0];
  const hist = await fetchAllRows(() => sb.from("rider_derived_ability_history")
    .select("rider_id, snapshot_date, abilities").gte("snapshot_date", since).order("rider_id"));
  const histByRider = new Map();
  for (const h of hist) { if (!histByRider.has(h.rider_id)) histByRider.set(h.rider_id, []); histByRider.get(h.rider_id).push(h); }

  const calib = [];
  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abById.get(r.id);
    const rows = (histByRider.get(r.id) || []).sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    if (!ab || rows.length < 2) continue;
    const first = rows[0].abilities || {};
    let gain = 0;
    for (const k of ABILITY_KEYS) gain += Math.max(0, n0(ab[k]) - n0(first[k]));
    const s = windowMean(r.id, 7);
    if (s == null || !(gain > 0)) continue;
    calib.push({ score: s, gain, potentiale: n0(r.potentiale), age: r.age });
  }
  // ln(gain) = ln(A) + gamma*ln(S/50)  →  OLS paa to led.
  const X = calib.map((c) => [1, Math.log(c.score / 50)]);
  const y = calib.map((c) => Math.log(c.gain));
  const [lnA, gamma] = calib.length > 10 ? olsSolve(X, y) : [0, 0];
  // Sammenlign med potentiale som forklaring (samme form).
  const Xp = calib.map((c) => [1, Math.log(Math.max(1, c.potentiale) / 3)]);
  const [, gammaPot] = calib.length > 10 ? olsSolve(Xp, y) : [0, 0];
  const r2 = (Xm, coef) => {
    const yh = Xm.map((row) => row.reduce((s2, v, i) => s2 + v * coef[i], 0));
    const m = mean(y);
    const ssr = y.reduce((s2, v, i) => s2 + (v - yh[i]) ** 2, 0);
    const sst = y.reduce((s2, v) => s2 + (v - m) ** 2, 0);
    return sst > 0 ? 1 - ssr / sst : 0;
  };
  const r2score = calib.length > 10 ? r2(X, [lnA, gamma]) : null;
  const r2pot = calib.length > 10 ? r2(Xp, olsSolve(Xp, y)) : null;
  console.log(`Kalibrering: n=${calib.length} · gamma(score)=${gamma.toFixed(3)} R²=${r2score?.toFixed(3)} · til sammenligning gamma(potentiale)=${gammaPot.toFixed(3)} R²=${r2pot?.toFixed(3)}`);

  // Basen saettes saa medianrytteren faar SAMME vaekst som den live rate-tabel
  // ville give ham - saa skiftet aendrer FORDELINGEN, ikke niveauet.
  const liveRate = (await import("../../lib/riderProgression.js")).YOUTH_PROGRESSION_CONFIG.rateByPotential;
  const medPot = med(calib.map((c) => c.potentiale)) ?? 3;
  const base = liveRate[Math.round(Math.max(1, Math.min(6, medPot)))] ?? 0.47;
  const scoreRate = { base: Number(base.toFixed(4)), gamma: Number(gamma.toFixed(4)), midpoint: 50 };
  console.log(`score_rate = ${JSON.stringify(scoreRate)} (base = live rate for median-potentiale ${medPot})`);

  // ── V6-model ──────────────────────────────────────────────────────────────
  const v6raw = { ...v5raw, npv_rates: "score", score_rate: scoreRate };
  writeFileSync(join(BACKEND, "lib/riderValuationModelV4.candidate-5443-V6.json"), JSON.stringify(v6raw, null, 2) + "\n", "utf8");
  const v6 = applyTypeDampening(v6raw);

  // ── Vaerdier pr. variant ──────────────────────────────────────────────────
  const active = riders.filter((r) => !r.is_retired && abById.has(r.id) && r.base_value > 0);
  const valueOf = (r, model, score) => {
    const ab = abById.get(r.id);
    const row = { ...r, valuation_type: r.primary_type, ...(score != null ? { training_score: score } : {}) };
    return recomputeRiderValue(row, ab, baseline, model, { typeAbilities: ab.ability_caps, youthBaseline })?.base_value ?? null;
  };

  const rows = [];
  for (const r of active) {
    const ab = abById.get(r.id);
    const rec = { id: r.id, name: `${r.firstname} ${r.lastname}`.trim(), age: r.age, potentiale: n0(r.potentiale),
      human: isHuman(r.team_id), academy: r.is_academy === true, free: r.team_id == null,
      primary_type: r.primary_type, stored: r.base_value, rating: ratingFromAbilities(ab, r.primary_type) };
    rec.V5 = valueOf(r, v5);
    for (const w of WINDOWS) rec[`score${w}`] = windowMean(r.id, w);
    rec.hasScore = rec.score7 != null;
    // Reserve (a): standardscore efter alder = medianscoren for rytterens aldersgruppe.
    // Reserve (b): potentiale-raten (dvs. praecis V5) indtil rytteren har score.
    rec.V6 = valueOf(r, v6, rec.score7);            // uden score ⇒ falder tilbage paa rate-tabel = V5
    rows.push(rec);
  }
  // Reserve (a): standardscore pr. aldersgruppe, beregnet paa dem DER har en.
  const ageKey = (a) => (a == null ? "?" : a <= 20 ? "<=20" : a <= 23 ? "21-23" : a <= 27 ? "24-27" : a <= 31 ? "28-31" : "32+");
  const defaultByAge = {};
  for (const g of ["<=20", "21-23", "24-27", "28-31", "32+"]) {
    const v = rows.filter((x) => ageKey(x.age) === g && x.score7 != null).map((x) => x.score7);
    defaultByAge[g] = v.length ? med(v) : 50;
  }
  for (const r of active) {
    const rec = rows.find((x) => x.id === r.id);
    if (!rec) continue;
    rec.V6a = rec.hasScore ? rec.V6 : valueOf(r, v6, defaultByAge[ageKey(rec.age)]);
    rec.V6b = rec.V6; // = V5-fallback for dem uden score
  }

  const summarize = (rs, key) => {
    const v = rs.filter((x) => x[key] != null && x.stored > 0);
    const sb2 = v.reduce((s, x) => s + x.stored, 0);
    const sa = v.reduce((s, x) => s + x[key], 0);
    const ratios = v.map((x) => x[key] / x.stored);
    return { n: v.length, sum_pct: sb2 ? (sa / sb2 - 1) * 100 : null,
      up: ratios.filter((x) => x > 1.01).length, down: ratios.filter((x) => x < 0.99).length,
      lose25: ratios.filter((x) => x <= 0.75).length, lose50: ratios.filter((x) => x <= 0.5).length,
      double: ratios.filter((x) => x > 2).length, median_pct: med(ratios.map((x) => (x - 1) * 100)) };
  };

  const human = rows.filter((x) => x.human);
  const variants = ["V5", "V6", "V6a"];
  const summary = {};
  for (const v of variants) {
    summary[v] = { alle: summarize(rows, v), menneske: summarize(human, v) };
    console.log(`${v}: Σ alle ${pct(summary[v].alle.sum_pct)} · Σ menneske ${pct(summary[v].menneske.sum_pct)} · ned ${summary[v].menneske.down} · ≥25 % ${summary[v].menneske.lose25} · ≥50 % ${summary[v].menneske.lose50}`);
  }

  // Aldersgrupper
  const byAge = {};
  for (const g of ["<=20", "21-23", "24-27", "28-31", "32+"]) {
    const grp = human.filter((x) => ageKey(x.age) === g);
    byAge[g] = { n: grp.length };
    for (const v of variants) byAge[g][v] = summarize(grp, v).sum_pct;
  }
  console.log("Alder (menneskehold, Σ-ændring):", Object.entries(byAge).map(([k, v]) => `${k} n=${v.n} V5 ${pct(v.V5)} V6 ${pct(v.V6)}`).join(" · "));

  // Daekning
  const coverage = {
    menneske_senior: { n: human.filter((x) => !x.academy).length, med: human.filter((x) => !x.academy && x.hasScore).length },
    menneske_akademi: { n: human.filter((x) => x.academy).length, med: human.filter((x) => x.academy && x.hasScore).length },
    ai: { n: rows.filter((x) => !x.human && !x.free).length, med: rows.filter((x) => !x.human && !x.free && x.hasScore).length },
    fri: { n: rows.filter((x) => x.free).length, med: rows.filter((x) => x.free && x.hasScore).length },
  };
  const valueOnFallback = rows.filter((x) => !x.hasScore).reduce((s, x) => s + x.stored, 0);
  const valueTotal = rows.reduce((s, x) => s + x.stored, 0);
  console.log("Dækning:", JSON.stringify(coverage), `· andel af bestandens værdi uden score: ${((valueOnFallback / valueTotal) * 100).toFixed(1)} %`);

  // ── Misbrug: hvad kan en manager hente ved at maksimere scoren? ───────────
  // Scoren er 1-99; en manager kan realistisk loefte sit vindues-gennemsnit fra
  // dagens niveau mod toppen af hvad der er observeret i prod (p95).
  const observed = rows.filter((x) => x.score7 != null).map((x) => x.score7).sort((a, b) => a - b);
  const p95 = observed[Math.floor(0.95 * observed.length)] ?? 80;
  const abuse = [];
  const probePool = human.filter((x) => x.hasScore && x.age <= 23).sort((a, b) => b.stored - a.stored);
  const probe = probePool[Math.floor(probePool.length / 2)];
  if (probe) {
    const pr = riders.find((r) => r.id === probe.id);
    for (const w of WINDOWS) {
      // Vindue w: et manipuleret vindue kan hoejst loefte gennemsnittet med den
      // andel af vinduet manageren naar at styre. Har historikken kun D dage,
      // kan han styre min(D, w) af dem.
      const D = Math.min(allDates.length, w);
      const cur = probe[`score${w}`] ?? probe.score7;
      const boosted = (cur * (w - D) + p95 * D) / w;
      const before = valueOf(pr, v6, cur);
      const after = valueOf(pr, v6, boosted);
      abuse.push({ window: w, days_controllable: D, score_before: cur, score_after: boosted,
        value_before: before, value_after: after, gain_pct: before ? (after / before - 1) * 100 : null });
    }
    for (const a of abuse) console.log(`misbrug vindue ${a.window} dage: score ${a.score_before?.toFixed(1)} → ${a.score_after.toFixed(1)} ⇒ værdi ${pct(a.gain_pct)}`);
  }

  // ── Stabilitet: hvor meget svinger vaerdien alene af scorens udsving? ─────
  const swings = [];
  for (const r of active.slice(0, 1500)) {
    const rec = rows.find((x) => x.id === r.id);
    if (!rec?.hasScore) continue;
    const ss = (byRider.get(r.id) || []).map((x) => Number(x.score)).filter(Number.isFinite);
    if (ss.length < 3) continue;
    const lo = Math.min(...ss);
    const hi = Math.max(...ss);
    const vLo = valueOf(r, v6, lo);
    const vHi = valueOf(r, v6, hi);
    if (vLo > 0 && vHi > 0) swings.push(Math.abs(vHi / vLo - 1) * 100);
  }
  swings.sort((a, b) => a - b);
  const stability = { n: swings.length, median_pct: med(swings), p90_pct: swings[Math.floor(0.9 * swings.length)] ?? null, max_pct: swings[swings.length - 1] ?? null };
  console.log(`Stabilitet: værdi-udsving alene af scorens dag-til-dag-spænd — median ${stability.median_pct?.toFixed(1)} %, p90 ${stability.p90_pct?.toFixed(1)} %, max ${stability.max_pct?.toFixed(1)} %`);

  // ── Roebe-effekt: kan potentialet regnes baglaens ud af vaerdien? ─────────
  // Maal: hvor ofte rammer "gaet potentiale ud fra vaerdi+alder+rating" inden
  // for ±1 trin? Sammenlignes i dag (V5, hvor potentiale ER i formlen) og V6.
  const guessHit = (key) => {
    const pool = human.filter((x) => x[key] != null && x.potentiale > 0 && x.rating != null);
    // Simpel naboskabs-gaet: find den rytter med naermeste (ln vaerdi, alder,
    // rating) og laan hans potentiale. Det er praecis hvad en fremmed manager
    // kan goere med offentlige tal.
    let hit = 0;
    const sample = pool.slice(0, 900);
    for (const x of sample) {
      let best = null;
      let bestD = Infinity;
      for (const o of pool) {
        if (o.id === x.id) continue;
        const d = Math.abs(Math.log(o[key] / x[key])) * 2 + Math.abs(o.age - x.age) * 0.3 + Math.abs(o.rating - x.rating) * 0.05;
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best && Math.abs(best.potentiale - x.potentiale) <= 1) hit++;
    }
    return sample.length ? (hit / sample.length) * 100 : null;
  };
  const reveal = { i_dag_V5: guessHit("V5"), V6: guessHit("V6") };
  console.log(`Røbe-effekt: potentiale rammes inden for ±1 trin — V5 ${reveal.i_dag_V5?.toFixed(1)} %, V6 ${reveal.V6?.toFixed(1)} %`);

  const NAMED = ["ryan cooper", "wessel k. mertens", "jasper verhoeven", "daniel carmona", "jihoon bae", "yuto suzuki",
    "mason marsh", "tijl coppens", "toby murphy", "romain dumas", "nicolo caruso", "ryan newton", "long chen"];
  const norm = (s2) => (s2 || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const named = NAMED.map((n) => rows.find((x) => norm(x.name) === norm(n)) ?? { name: n });

  mkdirSync(OUT_DIR, { recursive: true });
  const json = { meta: { ran_at: new Date().toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }), base_model: BASE_MODEL, windows: WINDOWS, score_days_available: allDates.length, score_dates: allDates },
    calibration: { n: calib.length, gamma_score: gamma, r2_score: r2score, gamma_potentiale: gammaPot, r2_potentiale: r2pot, score_rate: scoreRate, default_by_age: defaultByAge },
    coverage, value_share_without_score_pct: (valueOnFallback / valueTotal) * 100,
    summary, by_age: byAge, abuse, stability, reveal, named, rows };
  writeFileSync(join(OUT_DIR, "sammenligning.json"), JSON.stringify(json, null, 2), "utf8");
  console.log(`\n✅ Skrevet: ${join(OUT_DIR, "sammenligning.json")}`);
  console.log("INTET er skrevet til databasen.");
}

main().catch((e) => { console.error("❌", e.message); console.error(e.stack); process.exit(1); });
