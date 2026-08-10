#!/usr/bin/env node
// backend/scripts/dev/repair3570Apply.mjs
// ============================================================================
// #3570 — REPARATIONS-VÆRKTØJET. Én kommando, kørbar af en person der ikke har
// læst natbølgen.
//
// HVAD DEN GØR. Giver hver levende rytter én FAST identitet (`riders.archetype_draw`)
// og sætter hans synlige type til den, samt genopbygger hans udviklings-lofter
// (`rider_derived_abilities.ability_caps`) mod den identitet. Det bryder det lukkede
// kredsløb type → ability_caps → type, som drev peletonen til baroudeur 53,5 %.
//
// HVORFOR DEN GENBEREGNER I STEDET FOR AT SKRIVE EN FORUDBEREGNET LISTE.
// Den adversariske verifikation af dry-runnet (10/8) målte at populationen DRIVER
// mens vi arbejder: mindst 45 menneske-ejede ryttere blev reklassificeret af nattens
// sweep mellem snapshottet (00:30) og formiddagen. En forudberegnet skrive-liste ville
// derfor skrive lofter beregnet mod forældede evner — og et loft under rytterens
// NUVÆRENDE evne bryder gulv-garantien og nulstiller hans vækst-gap. Værktøjet tager
// derfor sit eget friske snapshot og bygger planen forfra, hver gang det kører.
//
// HVOR IDENTITETEN KOMMER FRA (uændret fra det godkendte dry-run):
//   segment A (fri markeds-pyramide) → rytterens GENFUNDNE fødsels-anlæg
//   segment C (akademi-født)         → rytterens GENFUNDNE fødsels-anlæg
//   segment B (trup-pulje)           → TILDELT anlæg: min-cost-flow under ejerens
//                                      knaphedskvoter, maksimerer fødsels-pasning
//   segment D (legacy uden anlæg)    → samme tildeling som B
//   ryttere der ALLEREDE har et draw → UDELADES HELT (0 felter skrives, blokker B2)
//
// SIKKERHEDS-KÆDEN (i den rækkefølge den udføres):
//   1. Ejer-gate i koden: dry-run er default, `--apply` kræver `--jeg-har-set-dry-runnet`.
//   2. Selvtest mod det daterede 10/8-snapshot i repoet: planlæggeren skal reproducere
//      de tal ejeren godkendte, ellers stopper den (obligatorisk før enhver skrivning).
//   3. Frisk snapshot fra prod (kun SELECT) → plan bygges forfra.
//   4. Diff mod planen bygget på 10/8-snapshottet — hvor meget flyttede verden sig?
//   5. Idempotens-bevis: planen anvendes på en kopi i hukommelsen, planlæggeren køres
//      igen, og anden kørsel skal skrive 0 rækker.
//   6. Backup FØR skrivning: to tabeller fyldt og verificeret række for række.
//   7. Batchet skrivning med {data, error}-tjek på hver batch.
//   8. Post-verify: læs tilbage fra DB og bekræft fem invarianter.
//
// KØRSEL
//   dry-run (default, skriver ALDRIG):
//     infisical run --env=prod -- node scripts/dev/repair3570Apply.mjs
//   kun selvtest (ingen DB overhovedet):
//     node scripts/dev/repair3570Apply.mjs --selvtest
//   skrivning (kræver BEGGE flag):
//     infisical run --env=prod -- node scripts/dev/repair3570Apply.mjs --apply --jeg-har-set-dry-runnet
//
// Refs #3570 #3588 #3589 #3590.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { STAT_KEYS, ARCHETYPES } from "../../lib/fictionalRiderGenerator.js";
import { RIDER_TYPE_KEYS, resolveRiderTypes } from "../../lib/riderTypes.js";
import { buildCapsForRider, sameCaps } from "../../lib/riderProgression.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(BACKEND_ROOT, "..");

// ── Konstanter ──────────────────────────────────────────────────────────────
/** Ejerens knaphedsmål i procent (#3564/#3570). */
export const MAAL = Object.freeze({
  sprinter: 15, tt: 9, climber: 17, puncheur: 13,
  brostensrytter: 9, baroudeur: 11, rouleur: 17, gc: 9,
});

export const DA = Object.freeze({
  sprinter: "sprinter", tt: "tidskører", climber: "klatrer", puncheur: "puncheur",
  brostensrytter: "brostensrytter", baroudeur: "baroudeur", rouleur: "rouleur", gc: "GC-rytter",
});

/**
 * Data-spærren, samme tal som `rollback.sql`s PART B: før reparationen har en
 * håndfuld ryttere et `archetype_draw` (dem født efter #3588-deployet). Findes der
 * flere end dette uden at ALLE har et, er en tidligere kørsel afbrudt midt i.
 */
export const DRAW_BASELINE_SPAERRE = 50;

const RIDER_COLS =
  "id, firstname, lastname, birthdate, height, weight, potentiale, archetype_draw, " +
  "primary_type, secondary_type, valuation_type, team_id, base_value, market_value, " +
  "current_production_value, salary, is_academy, is_retired, " + STAT_KEYS.join(", ");

const ADULT_BASELINE = JSON.parse(readFileSync(join(BACKEND_ROOT, "lib/riderTypesBaseline.json"), "utf8"));
const YOUTH_BASELINE = JSON.parse(readFileSync(join(BACKEND_ROOT, "lib/riderTypesBaselineYouth.json"), "utf8"));

/**
 * F4's fødsels-anlægs-model: en mixture over (regime × tier × arketype) fittet
 * UDELUKKENDE på syntetiske kohorter med kendt arketype — aldrig på prod-labels,
 * som bærer løkkens aftryk. Vendored fra natbølgens `F4-foedselsanlaeg/model.json`
 * så værktøjet er selvstændigt og reproducerbart uden en session-scratchpad.
 */
export const BIRTH_MODEL = JSON.parse(
  readFileSync(join(__dirname, "lib/birthArchetypeModel3570.json"), "utf8"),
);

/** Det daterede snapshot der ligger permanent i repoet (rollback- og selvtest-grundlag). */
export const BASELINE_SNAPSHOT_DIR = join(REPO_ROOT, "docs/snapshots/3570");

/**
 * Tallene ejeren godkendte i `RAPPORT-DRYRUN.md` (rev 2). Selvtesten kører
 * planlæggeren mod det daterede 10/8-snapshot og kræver dem eksakt. Drifter
 * planlæggeren — en ændret vægt, en ændret baseline, en ændret caps-formel —
 * fejler den her, ikke i produktionen.
 */
export const DRYRUN_FACIT = Object.freeze({
  n: 8199,
  segmenter: { A: 1055, B: 5550, C: 1533, D: 61 },
  kilder: { "fødsel": 2582, tildelt: 5611, "eksisterende draw": 6 },
  skrives: 8193,
  primaerSkift: 5965,
  sekundaerSkift: 6234,
  loftSaenketAntal: 7234,          // 88,2 % af 8.199 — rev 2's tal efter B2-ekskluderingen
  saenkningMedian: 30,
  saenkningP90: 47,
  saenkningMax: 77,
  primal: -100057.26336740356,
  kvoter: { sprinter: 842, tt: 505, climber: 954, puncheur: 729, brostensrytter: 505, baroudeur: 617, rouleur: 954, gc: 505 },
  L1efter2: 7.72,                  // L1 mod knaphedsmålene, alle ryttere, 2 decimaler
});

// ── Små hjælpere ────────────────────────────────────────────────────────────
export const pct = (n, t) => (t ? (100 * n) / t : 0);
const f1 = (x) => (x == null ? "—" : Number(x).toFixed(1));
const sortNum = (v) => v.filter(Number.isFinite).sort((a, b) => a - b);
export function percentil(vals, p) {
  const s = sortNum(vals);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
export const median = (v) => percentil(v, 50);
export const maxOf = (v) => { const s = sortNum(v); return s.length ? s[s.length - 1] : null; };
const logsumexp = (xs) => { const m = Math.max(...xs); return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };

/** Datostempel i Europe/Copenhagen (YYYYMMDD) — al dato/tid i projektet er dansk lokaltid. */
export function cphDateStamp(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).replace(/-/g, "");
}

// ── Fødsels-anlæg: krops-model + stat-features (fra F4, uændret) ────────────
// Generatoren skriver weight = round(bmi_a · (height/100)²) UDEN støj, så (højde,
// vægt) er et ~eksakt opslag af arketypen for enhver voksen-genereret rytter.
// Akademi-generatoren trækker bmi ~ N(21,5; 1,0) UAFHÆNGIGT af anlægget — dér
// bærer kroppen intet, og likelihooden er derfor flad over typerne.
const SD_FLOOR = 0.25;
const LOG_IMPOSSIBLE = Math.log(1e-20);
const BODY_ADULT = Object.fromEntries(ARCHETYPES.map((a) => [a.type, { hm: a.heightMean, bmi: a.bmi }]));
const YOUTH_H_MEAN = 180, YOUTH_H_SD = 5, YOUTH_BMI_MEAN = 21.5, YOUTH_BMI_SD = 1.0;

const logNormPdf = (x, m, s) => -0.5 * Math.log(2 * Math.PI * s * s) - 0.5 * ((x - m) / s) ** 2;
function erf(x) {
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}
const normCdf = (x, m, s) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));

export function logBodyAdult(height, weight, type) {
  const b = BODY_ADULT[type];
  if (!b || !Number.isFinite(height) || !Number.isFinite(weight)) return 0;
  const exact = Math.round(b.bmi * (height / 100) ** 2) === Math.round(weight);
  return logNormPdf(height, b.hm, 5) + (exact ? 0 : LOG_IMPOSSIBLE);
}
export function logBodyYouth(height, weight) {
  if (!Number.isFinite(height) || !Number.isFinite(weight)) return 0;
  const h2 = (height / 100) ** 2;
  const lo = (Math.round(weight) - 0.5) / h2, hi = (Math.round(weight) + 0.5) / h2;
  const p = Math.max(1e-12, normCdf(hi, YOUTH_BMI_MEAN, YOUTH_BMI_SD) - normCdf(lo, YOUTH_BMI_MEAN, YOUTH_BMI_SD));
  return logNormPdf(height, YOUTH_H_MEAN, YOUTH_H_SD) + Math.log(p);
}

/**
 * Arketypen er en AFVIGELSE fra rytterens eget niveau, ikke et niveau — og
 * fødsels-stats er clamp'et i vinduer der er forskellige pr. produktions-sti.
 * Derfor normaliseres HVER rytter mod SIG SELV; det fjerner både niveauet og
 * clamp'ets skala-kompression, så en hale-rytter i et 3-points-vindue og en
 * superstjerne i et 35-points-vindue får samme signatur-FORM.
 */
export function statFeatures(row) {
  const v = STAT_KEYS.map((k) => Number(row[k]));
  if (v.some((x) => !Number.isFinite(x))) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.max(SD_FLOOR, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length));
  const u = v.map((x) => (x - m) / sd);
  u.push(Math.log(sd), (m - 55) / 5);
  return { u, sd, mean: m };
}

/**
 * Genfind rytterens fødsels-anlæg. Returnerer HELE log-posterior-vektoren (ikke kun
 * argmax), fordi tildelingen i segment B har brug for rangeringen.
 * @returns {{logPost:number[], ranked:string[], rankOf:object, primary:string,
 *            secondary:string, confidence:number, family:"adult"|"youth", signal:number}|null}
 */
export function recoverBirthArchetype(row, model = BIRTH_MODEL) {
  const f = statFeatures(row);
  if (!f) return null;
  const h = Number(row.height), w = Number(row.weight);
  const byType = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, []]));
  const famScore = { adult: [], youth: [] };
  for (const c of model.components) {
    let s = c.logNorm;
    for (let i = 0; i < f.u.length; i++) { const d = f.u[i] - c.mu[i]; s -= 0.5 * d * d / c.varv[i]; }
    s += c.family === "adult" ? logBodyAdult(h, w, c.type) : logBodyYouth(h, w);
    byType[c.type].push(s);
    famScore[c.family].push(s);
  }
  // Uniform prior: ejerens knaphedsmål som prior ville være cirkulært (vi måler
  // bagefter L1 mod netop det mål). Kvoterne pålægges i stedet som hårde bindinger
  // i tildelingen, hvor de er synlige.
  const logPrior = Math.log(1 / RIDER_TYPE_KEYS.length);
  const raw = RIDER_TYPE_KEYS.map((k) => (byType[k].length ? logsumexp(byType[k]) + logPrior : -1e9));
  const lse = logsumexp(raw);
  const logPost = raw.map((x) => x - lse);
  const order = RIDER_TYPE_KEYS.map((k, i) => ({ k, s: logPost[i] })).sort((a, b) => b.s - a.s);
  const fa = famScore.adult.length ? logsumexp(famScore.adult) : -Infinity;
  const fy = famScore.youth.length ? logsumexp(famScore.youth) : -Infinity;
  return {
    logPost,
    ranked: order.map((o) => o.k),
    rankOf: Object.fromEntries(order.map((o, r) => [o.k, r + 1])),
    primary: order[0].k,
    secondary: order[1].k,
    confidence: Math.exp(order[0].s),
    family: fa >= fy ? "adult" : "youth",
    signal: f.sd,
  };
}

/**
 * F4's segmentering. Grænserne er de produktions-stier generatoren har skrevet ad:
 * fri pyramide [50,85], start-trup-kerne [50,57], AI-t4 [51,55], akademi [49,54].
 * `family` kommer fra fødsels-modellen selv, ikke fra en håndlavet regime-detektor.
 */
export function segmentOf(row, family) {
  const v = STAT_KEYS.map((k) => Number(row[k]));
  if (v.some((x) => !Number.isFinite(x))) return "D";
  const mn = Math.min(...v), mx = Math.max(...v);
  if (mn < 49 || mx > 85) return "D";
  if (family === "youth") return "C";
  if (mx > 57) return "A";
  return "B";
}

export function konfidensBaand(c) {
  if (c == null) return null;
  if (c >= 0.9) return "høj (≥0,90)";
  if (c >= 0.7) return "middel (0,70-0,90)";
  if (c >= 0.5) return "lav (0,50-0,70)";
  return "meget lav (<0,50)";
}

// ── Eksakt transport-løser (n ryttere × 8 typer, hårde kvoter) ──────────────
// Trin 1 Sinkhorn/annealing på det duale prisproblem → næsten optimal start.
// Trin 2 reparation til EKSAKTE kvoter (mindst kostbare flyt).
// Trin 3 cyklus-annullering på 8-node-typegrafen → beviseligt optimum
//        (et transportproblem er optimalt ⟺ ingen forbedrende cyklus i restgrafen).
// Trin 4 duale priser + LP-bund som uafhængig kontrol af trin 3.
export function solveAssignment(S, q) {
  const n = S.length, K = q.length;
  const total = q.reduce((a, b) => a + b, 0);
  if (total !== n) throw new Error(`kvoter summer til ${total}, ikke n=${n}`);
  if (n === 0) return { assign: new Int32Array(0), counts: new Array(K).fill(0), primal: 0, dualBound: 0, gap: 0, cycleRounds: 0 };

  const p = new Float64Array(K);
  const soft = new Float64Array(K);
  for (const tau of [4, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02]) {
    for (let it = 0; it < 400; it++) {
      soft.fill(0);
      for (let i = 0; i < n; i++) {
        const s = S[i];
        let m = -Infinity;
        for (let k = 0; k < K; k++) { const v = (s[k] - p[k]) / tau; if (v > m) m = v; }
        let z = 0;
        for (let k = 0; k < K; k++) z += Math.exp((s[k] - p[k]) / tau - m);
        for (let k = 0; k < K; k++) soft[k] += Math.exp((s[k] - p[k]) / tau - m) / z;
      }
      let maxRel = 0;
      for (let k = 0; k < K; k++) {
        p[k] += tau * Math.log(Math.max(1e-12, soft[k]) / Math.max(1e-12, q[k]));
        maxRel = Math.max(maxRel, Math.abs(soft[k] - q[k]) / Math.max(1, q[k]));
      }
      if (maxRel < 1e-4) break;
    }
  }

  const a = new Int32Array(n);
  const cnt = new Int32Array(K);
  for (let i = 0; i < n; i++) {
    const s = S[i];
    let best = 0, bv = -Infinity;
    for (let k = 0; k < K; k++) { const v = s[k] - p[k]; if (v > bv) { bv = v; best = k; } }
    a[i] = best; cnt[best]++;
  }
  let guard = 0;
  for (;;) {
    let over = -1, under = -1;
    for (let k = 0; k < K; k++) { if (cnt[k] > q[k]) over = k; if (cnt[k] < q[k]) under = k; }
    if (over < 0 || under < 0) break;
    if (++guard > 10 * n) throw new Error("kvote-reparation konvergerer ikke");
    let bi = -1, bl = -Infinity;
    for (let i = 0; i < n; i++) {
      if (a[i] !== over) continue;
      const l = S[i][under] - S[i][over];
      if (l > bl) { bl = l; bi = i; }
    }
    a[bi] = under; cnt[over]--; cnt[under]++;
  }

  let rounds = 0;
  for (;;) {
    const w = Array.from({ length: K }, () => new Float64Array(K).fill(-Infinity));
    const who = Array.from({ length: K }, () => new Int32Array(K).fill(-1));
    for (let i = 0; i < n; i++) {
      const k = a[i], s = S[i];
      for (let k2 = 0; k2 < K; k2++) {
        if (k2 === k) continue;
        const g = s[k2] - s[k];
        if (g > w[k][k2]) { w[k][k2] = g; who[k][k2] = i; }
      }
    }
    const cyc = findPositiveCycle(w, K);
    if (!cyc) break;
    for (let t = 0; t < cyc.length; t++) a[who[cyc[t]][cyc[(t + 1) % cyc.length]]] = cyc[(t + 1) % cyc.length];
    if (++rounds > 200000) throw new Error("cyklus-annullering konvergerer ikke");
  }

  const wFinal = Array.from({ length: K }, () => new Float64Array(K).fill(-Infinity));
  for (let i = 0; i < n; i++) {
    const k = a[i], s = S[i];
    for (let k2 = 0; k2 < K; k2++) { if (k2 !== k) { const g = s[k2] - s[k]; if (g > wFinal[k][k2]) wFinal[k][k2] = g; } }
  }
  const pStar = new Float64Array(K).fill(0);
  for (let it = 0; it < K + 2; it++) {
    for (let u = 0; u < K; u++) for (let v = 0; v < K; v++) {
      if (u === v || !Number.isFinite(wFinal[u][v])) continue;
      if (pStar[u] + wFinal[u][v] > pStar[v]) pStar[v] = pStar[u] + wFinal[u][v];
    }
  }
  let primal = 0;
  for (let i = 0; i < n; i++) primal += S[i][a[i]];
  let dual = 0;
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let k = 0; k < K; k++) { const v = S[i][k] - pStar[k]; if (v > m) m = v; }
    dual += m;
  }
  for (let k = 0; k < K; k++) dual += q[k] * pStar[k];
  const counts = new Array(K).fill(0);
  for (const x of a) counts[x]++;
  return { assign: a, counts, primal, dualBound: dual, gap: dual - primal, cycleRounds: rounds };
}

function findPositiveCycle(w, K) {
  const dist = new Float64Array(K).fill(0);
  const pred = new Int32Array(K).fill(-1);
  let x = -1;
  for (let it = 0; it < K; it++) {
    x = -1;
    for (let u = 0; u < K; u++) for (let v = 0; v < K; v++) {
      if (u === v || !Number.isFinite(w[u][v])) continue;
      if (dist[u] + w[u][v] > dist[v] + 1e-10) { dist[v] = dist[u] + w[u][v]; pred[v] = u; x = v; }
    }
    if (x === -1) return null;
  }
  let y = x;
  for (let i = 0; i < K; i++) y = pred[y];
  const back = [];
  let v = y;
  do { back.push(v); v = pred[v]; } while (v !== y && back.length <= K + 1);
  if (v !== y) return null;
  const fwd = back.slice().reverse();
  let g = 0;
  for (let t = 0; t < fwd.length; t++) {
    const e = w[fwd[t]][fwd[(t + 1) % fwd.length]];
    if (!Number.isFinite(e)) return null;
    g += e;
  }
  return g > 1e-9 ? fwd : null;
}

/** Heltalskvoter ud fra procent-mål, største-rest-metoden. */
export function quotasFromPct(n, pctMap = MAAL, keys = RIDER_TYPE_KEYS) {
  const raw = keys.map((k) => (n * (pctMap[k] ?? 0)) / 100);
  const base = raw.map(Math.floor);
  let rest = n - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
  for (let j = 0; rest > 0; j++, rest--) base[order[j % order.length].i]++;
  return base;
}

// ── Planlæggeren ────────────────────────────────────────────────────────────
const validDraw = (d) => !!(d && typeof d === "object" && RIDER_TYPE_KEYS.includes(d.primary));

export const abilitiesOf = (r) => {
  const a = {};
  for (const k of VISIBLE_ABILITIES) if (r.abilities?.[k] != null) a[k] = Number(r.abilities[k]);
  return a;
};

/**
 * Bygger hele skrive-planen fra en population. REN funktion — ingen DB, ingen I/O.
 *
 * @param {object[]} rows  normaliserede rytter-rækker (se `normaliserRaekker`)
 * @param {object} opts  { seasonNumber, model }
 */
export function buildPlan(rows, { seasonNumber, model = BIRTH_MODEL } = {}) {
  if (!Number.isFinite(seasonNumber)) throw new Error("buildPlan: seasonNumber mangler — sæson-alder kan ikke regnes.");

  const rec = new Map();
  let udenFoedselsstats = 0;
  for (const r of rows) {
    const g = recoverBirthArchetype(r, model);
    if (!g) udenFoedselsstats++;
    rec.set(r.rider_id, g);
  }

  const poster = [];
  const pulje = [];
  for (const r of rows) {
    const g = rec.get(r.rider_id);
    const segment = segmentOf(r, g?.family ?? "adult");
    const eksisterende = validDraw(r.archetype_draw);
    // Segment A og C: fødsels-anlægget kan genfindes (gitter-dækning 96,4 % / 62,4 %).
    // Segment B og D: generatorens ENSURE_MIN_TYPES-fejl gjorde 97 % til sprinter/gc,
    // så anlægget er ødelagt og skal omfordeles under kvoterne.
    const fraFoedsel = !eksisterende && g != null && (segment === "A" || segment === "C");
    poster.push({
      rider_id: r.rider_id, row: r, segment, genfundet: g, eksisterende, fraFoedsel,
      newPrimary: null, newSecondary: null,
    });
    if (!eksisterende && !fraFoedsel) pulje.push(poster[poster.length - 1]);
  }

  const kvoterArr = quotasFromPct(pulje.length, MAAL);
  const S = pulje.map((p) => p.genfundet?.logPost ?? new Array(RIDER_TYPE_KEYS.length).fill(0));
  const sol = solveAssignment(S, kvoterArr);
  pulje.forEach((p, i) => { p.newPrimary = RIDER_TYPE_KEYS[sol.assign[i]]; });

  for (const p of poster) {
    const r = p.row;
    if (p.eksisterende) {
      p.newPrimary = r.archetype_draw.primary;
      p.newSecondary = RIDER_TYPE_KEYS.includes(r.archetype_draw.secondary) ? r.archetype_draw.secondary : r.secondary_type;
      p.kilde = "eksisterende draw";
    } else {
      if (p.fraFoedsel) { p.newPrimary = p.genfundet.primary; p.kilde = "fødsel"; }
      else p.kilde = "tildelt";
      // Sekundæren fryses SAMMEN med primæren, ellers ville den blive udledt af
      // klassifikatoren hver nat og 32,6 % af rytterne fik en anden biType end
      // planen beregnede (Æ1's tredje ben i dry-runnet).
      p.newSecondary = p.genfundet
        ? p.genfundet.ranked.find((k) => k !== p.newPrimary)
        : RIDER_TYPE_KEYS.find((k) => k !== p.newPrimary);
    }

    p.skrives = !p.eksisterende && r.har_abilities_raekke !== false;
    p.udeladelses_grund = p.eksisterende
      ? "eksisterende archetype_draw (født efter #3588-deployet) — identiteten er allerede korrekt; INGEN af de fire felter skrives"
      : (r.har_abilities_raekke === false ? "ingen rider_derived_abilities-række — uden for scope" : null);

    p.abilities = abilitiesOf(r);
    p.oldCaps = r.ability_caps || {};
    p.newCaps = p.skrives
      ? buildCapsForRider(p.abilities, { potentiale: r.potentiale, age: r.age }, p.newPrimary, p.newSecondary)
      : { ...p.oldCaps };
    p.draw = p.skrives ? { primary: p.newPrimary, secondary: p.newSecondary } : null;
    p.konfidens = p.kilde === "fødsel" ? p.genfundet.confidence : null;
    p.konfidens_baand = konfidensBaand(p.konfidens);
    p.pasnings_rang = p.genfundet ? p.genfundet.rankOf[p.newPrimary] : null;
    p.foedsels_argmax = p.genfundet?.primary ?? null;
    p.primaerSkifter = p.skrives && p.newPrimary !== r.primary_type;
    p.sekundaerSkifter = p.skrives && p.newSecondary !== r.secondary_type;
    p.vaersteSaenkning = Math.max(0, ...VISIBLE_ABILITIES.map((a) => Number(p.oldCaps[a] ?? 0) - Number(p.newCaps[a] ?? 0)));
    p.vaersteHaevning = Math.max(0, ...VISIBLE_ABILITIES.map((a) => Number(p.newCaps[a] ?? 0) - Number(p.oldCaps[a] ?? 0)));
    p.capsAendres = p.skrives && !sameCaps(p.oldCaps, p.newCaps);
    p.identitetAendres = p.skrives && (
      !validDraw(r.archetype_draw)
      || r.archetype_draw.primary !== p.newPrimary
      || r.archetype_draw.secondary !== p.newSecondary
      || r.primary_type !== p.newPrimary
      || r.secondary_type !== p.newSecondary
    );
  }

  const segmenter = {};
  const kilder = {};
  for (const p of poster) {
    segmenter[p.segment] = (segmenter[p.segment] || 0) + 1;
    kilder[p.kilde] = (kilder[p.kilde] || 0) + 1;
  }

  return {
    poster,
    seasonNumber,
    udenFoedselsstats,
    segmenter,
    kilder,
    kvoter: Object.fromEntries(RIDER_TYPE_KEYS.map((k, i) => [k, kvoterArr[i]])),
    loeser: {
      metode: "min-cost-flow + cyklus-annullering + LP-dual-certifikat",
      n: pulje.length, primal: sol.primal, dual: sol.dualBound, gap: sol.gap, cykler: sol.cycleRounds,
    },
  };
}

// ── Fordelinger / sammendrag ────────────────────────────────────────────────
export function fordeling(keys) {
  const c = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  for (const k of keys) c[k] = (c[k] || 0) + 1;
  return Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, pct(c[k], keys.length)]));
}
export const L1 = (d) => RIDER_TYPE_KEYS.reduce((s, k) => s + Math.abs(d[k] - MAAL[k]), 0);

export function populationer(poster) {
  const hum = (p) => p.row.owner_kind === "human";
  return {
    alle: poster,
    "menneske-ejede": poster.filter(hum),
    "menneske-ejede <22": poster.filter((p) => hum(p) && p.row.age < 22),
    "menneske-ejede 22+": poster.filter((p) => hum(p) && p.row.age >= 22),
    "AI-ejede": poster.filter((p) => p.row.owner_kind === "ai"),
    "frie agenter": poster.filter((p) => p.row.owner_kind === "free"),
  };
}

export function populationsTal(poster) {
  const foer = fordeling(poster.map((p) => p.row.primary_type));
  const efter = fordeling(poster.map((p) => (p.skrives ? p.newPrimary : p.row.primary_type)));
  const saenkninger = poster.filter((p) => p.vaersteSaenkning > 0).map((p) => p.vaersteSaenkning);
  return {
    n: poster.length,
    skrives: poster.filter((p) => p.skrives).length,
    kilder: poster.reduce((a, p) => ((a[p.kilde] = (a[p.kilde] || 0) + 1), a), {}),
    L1foer: L1(foer), L1efter: L1(efter),
    fordelingFoer: foer, fordelingEfter: efter,
    primaerSkift: poster.filter((p) => p.primaerSkifter).length,
    sekundaerSkift: poster.filter((p) => p.sekundaerSkifter).length,
    capsAendres: poster.filter((p) => p.capsAendres).length,
    loftSaenketAntal: saenkninger.length,
    loftSaenketPct: pct(saenkninger.length, poster.length),
    saenkningMedian: median(saenkninger),
    saenkningP90: percentil(saenkninger, 90),
    saenkningMax: maxOf(saenkninger),
    ratingDeltaMedian: median(poster.map((p) =>
      ratingFromAbilities(p.newCaps, p.skrives ? p.newPrimary : p.row.primary_type)
      - ratingFromAbilities(p.oldCaps, p.row.primary_type))),
  };
}

// ── Snapshot-indlæsning ─────────────────────────────────────────────────────
/**
 * Slår `riders_full` og `birthstats` sammen til den rækkeform planlæggeren bruger.
 * Samme form som det friske prod-snapshot, så baseline og frisk plan bygges af
 * NØJAGTIG samme kode — ellers ville diffen måle kode-forskelle, ikke drift.
 */
export function normaliserRaekker(ridersFull, birthstats, seasonNumber) {
  const bById = new Map(birthstats.map((b) => [b.id, b]));
  return ridersFull.map((r) => {
    const b = bById.get(r.rider_id) || {};
    const row = {
      ...r,
      age: ageForSeason(r.birthdate, seasonNumber),
      height: b.height ?? null,
      weight: b.weight ?? null,
      har_abilities_raekke: r.ability_caps !== undefined,
    };
    for (const k of STAT_KEYS) row[k] = b[k] ?? null;
    return row;
  });
}

export function loadBaselineSnapshot(dir = BASELINE_SNAPSHOT_DIR) {
  const gz = (f) => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8"));
  const meta = JSON.parse(readFileSync(join(dir, "meta-2026-08-10.json"), "utf8"));
  const rows = normaliserRaekker(
    gz("riders_full-2026-08-10.json.gz"),
    gz("birthstats-2026-08-10.json.gz"),
    meta.activeSeasonNumber,
  );
  // Snapshottets `age` ER sæson-alder; hvis vores egen ageForSeason afviger, er
  // enten snapshottet eller SSOT'en flyttet sig, og alt nedenfor er ugyldigt.
  const src = gz("riders_full-2026-08-10.json.gz");
  let mismatch = 0;
  for (let i = 0; i < rows.length; i++) if (src[i].age !== rows[i].age) mismatch++;
  if (mismatch) throw new Error(`Baseline-snapshottets age matcher ikke ageForSeason for ${mismatch} ryttere — STOP.`);
  return { rows, meta, seasonNumber: meta.activeSeasonNumber };
}

// ── Selvtest: reproducér de tal ejeren godkendte ────────────────────────────
/**
 * Kører planlæggeren mod det daterede 10/8-snapshot og kræver dry-runnets tal
 * eksakt. Det er værktøjets paritets-bevis: driver klassifikator, baseline,
 * caps-formel, fødsels-model eller løser, fejler den HER — ikke i produktionen.
 */
// Baseline-planen er en ren funktion af et frosset snapshot — den beregnes én
// gang pr. proces. (Verdikten genberegnes altid; kun det dyre plan-arbejde cackes.)
const baselinePlanCache = new Map();
export function baselinePlan(dir = BASELINE_SNAPSHOT_DIR) {
  if (!baselinePlanCache.has(dir)) {
    const { rows, seasonNumber } = loadBaselineSnapshot(dir);
    baselinePlanCache.set(dir, { rows, plan: buildPlan(rows, { seasonNumber }) });
  }
  return baselinePlanCache.get(dir);
}

export function runSelvtest({ dir = BASELINE_SNAPSHOT_DIR, facit = DRYRUN_FACIT } = {}) {
  const { plan } = baselinePlan(dir);
  const t = populationsTal(plan.poster);
  const afvigelser = [];
  const cmp = (navn, faktisk, forventet) => {
    if (faktisk !== forventet) afvigelser.push({ navn, faktisk, forventet });
  };
  cmp("n", plan.poster.length, facit.n);
  for (const s of ["A", "B", "C", "D"]) cmp(`segment ${s}`, plan.segmenter[s] ?? 0, facit.segmenter[s]);
  for (const k of Object.keys(facit.kilder)) cmp(`kilde ${k}`, plan.kilder[k] ?? 0, facit.kilder[k]);
  cmp("skrives", t.skrives, facit.skrives);
  cmp("primær-skift", t.primaerSkift, facit.primaerSkift);
  cmp("sekundær-skift", t.sekundaerSkift, facit.sekundaerSkift);
  cmp("loft sænket", t.loftSaenketAntal, facit.loftSaenketAntal);
  cmp("sænkning median", t.saenkningMedian, facit.saenkningMedian);
  cmp("sænkning p90", t.saenkningP90, facit.saenkningP90);
  cmp("sænkning max", t.saenkningMax, facit.saenkningMax);
  cmp("L1 efter (alle, 2 dec.)", Number(t.L1efter.toFixed(2)), facit.L1efter2);
  for (const k of RIDER_TYPE_KEYS) cmp(`kvote ${k}`, plan.kvoter[k], facit.kvoter[k]);
  if (Math.abs(plan.loeser.primal - facit.primal) > 1e-6) {
    afvigelser.push({ navn: "løser-primal", faktisk: plan.loeser.primal, forventet: facit.primal });
  }
  if (Math.abs(plan.loeser.gap) > 1e-6) {
    afvigelser.push({ navn: "dual-gap", faktisk: plan.loeser.gap, forventet: 0 });
  }

  // Invarianter der skal holde uanset facit-tallene.
  let gulvBrud = 0, drift = 0, udenforInterval = 0;
  for (const p of plan.poster) {
    if (!p.skrives) continue;
    const model = selectTypesBaseline(p.row.age, ADULT_BASELINE, YOUTH_BASELINE);
    if (resolveRiderTypes(p.draw, p.newCaps, model).primary.key !== p.newPrimary) drift++;
    for (const a of VISIBLE_ABILITIES) {
      const c = Number(p.newCaps[a]);
      if (c < Number(p.abilities[a] ?? 0)) gulvBrud++;
      if (!(c >= 0 && c <= 99)) udenforInterval++;
    }
  }
  if (drift) afvigelser.push({ navn: "resolveRiderTypes-drift", faktisk: drift, forventet: 0 });
  if (gulvBrud) afvigelser.push({ navn: "gulv-brud", faktisk: gulvBrud, forventet: 0 });
  if (udenforInterval) afvigelser.push({ navn: "lofter uden for [0,99]", faktisk: udenforInterval, forventet: 0 });

  return { bestaaet: afvigelser.length === 0, afvigelser, plan, tal: t, sammenligninger: 8 + 4 + 3 + RIDER_TYPE_KEYS.length + plan.poster.length * (1 + VISIBLE_ABILITIES.length * 2) };
}

// ── Idempotens-bevis ────────────────────────────────────────────────────────
/**
 * Anvender planen på en kopi af populationen i hukommelsen og kører planlæggeren
 * igen. Anden kørsel SKAL skrive 0 rækker — ellers er værktøjet ikke idempotent,
 * og en gentaget kørsel ville flytte identiteter en gang til.
 */
export function bevisIdempotens(rows, plan) {
  const byId = new Map(plan.poster.map((p) => [p.rider_id, p]));
  const efter = rows.map((r) => {
    const p = byId.get(r.rider_id);
    if (!p || !p.skrives) return r;
    return {
      ...r,
      archetype_draw: { ...p.draw },
      primary_type: p.newPrimary,
      secondary_type: p.newSecondary,
      ability_caps: { ...p.newCaps },
    };
  });
  const plan2 = buildPlan(efter, { seasonNumber: plan.seasonNumber });
  const skriverIgen = plan2.poster.filter((p) => p.skrives);
  return {
    andenKoerselSkriver: skriverIgen.length,
    andenKoerselIdentitet: plan2.poster.filter((p) => p.identitetAendres).length,
    andenKoerselCaps: plan2.poster.filter((p) => p.capsAendres).length,
    ok: skriverIgen.length === 0,
    eksempler: skriverIgen.slice(0, 5).map((p) => p.rider_id),
  };
}

// ── Diff mod dry-runnets plan ───────────────────────────────────────────────
/**
 * Hvor meget flyttede verden sig under ejeren? Baseline-planen bygges af SAMME
 * kode på det daterede 10/8-snapshot, så enhver forskel er datadrift, ikke kode.
 */
export function diffModBaseline(friskPlan, baselinePlan) {
  const b = new Map(baselinePlan.poster.map((p) => [p.rider_id, p]));
  const f = new Map(friskPlan.poster.map((p) => [p.rider_id, p]));
  const nye = [], forsvundne = [], primaerDiff = [], sekundaerDiff = [], labelDrift = [], capsDrift = [];
  for (const p of friskPlan.poster) {
    const o = b.get(p.rider_id);
    if (!o) { nye.push({ rider_id: p.rider_id, navn: navnAf(p.row), ny_primaer: p.newPrimary }); continue; }
    if (o.newPrimary !== p.newPrimary) {
      primaerDiff.push({ rider_id: p.rider_id, navn: navnAf(p.row), ejer: p.row.owner_kind, hold: p.row.manager_display_name, plan_1008: o.newPrimary, plan_nu: p.newPrimary, segment: p.segment, kilde: p.kilde });
    }
    if (o.newSecondary !== p.newSecondary) sekundaerDiff.push({ rider_id: p.rider_id, plan_1008: o.newSecondary, plan_nu: p.newSecondary });
    if (o.row.primary_type !== p.row.primary_type) {
      labelDrift.push({ rider_id: p.rider_id, navn: navnAf(p.row), ejer: p.row.owner_kind, label_1008: o.row.primary_type, label_nu: p.row.primary_type });
    }
    if (!sameCaps(o.oldCaps, p.oldCaps)) capsDrift.push(p.rider_id);
  }
  for (const p of baselinePlan.poster) if (!f.has(p.rider_id)) forsvundne.push({ rider_id: p.rider_id, navn: navnAf(p.row) });
  return {
    baseline_n: baselinePlan.poster.length,
    frisk_n: friskPlan.poster.length,
    nye, forsvundne,
    labelDriftAntal: labelDrift.length, labelDrift,
    capsDriftAntal: capsDrift.length,
    primaerDiffAntal: primaerDiff.length, primaerDiff,
    sekundaerDiffAntal: sekundaerDiff.length,
  };
}

const navnAf = (r) => `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();

// ── Supabase-adgang (tynd, mock-bar) ────────────────────────────────────────
const PAGE = 1000;
const IN_CHUNK = 200;

async function selectPaged(supabase, table, cols) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + PAGE - 1);
    if (error) throw new Error(`SELECT ${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function selectIn(supabase, table, cols, col, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from(table).select(cols).in(col, ids.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`SELECT ${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

/** Frisk, read-only prod-snapshot i planlæggerens rækkeform. */
export async function hentFriskPopulation(supabase) {
  const seasons = await selectPaged(supabase, "seasons", "number, status, start_date, end_date, race_days_completed, race_days_total");
  const aktiv = seasons.find((s) => s.status === "active");
  if (!aktiv) throw new Error("Ingen aktiv sæson — sæson-alder kan ikke regnes. STOP.");

  const appConfig = await selectPaged(supabase, "app_config", "key, value");
  const teams = await selectPaged(supabase, "teams", "id, name, division, is_ai, is_test_account, is_frozen, user_id");
  const userIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))];
  const users = userIds.length ? await selectIn(supabase, "users", "id, username", "id", userIds) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const alleRiders = await selectPaged(supabase, "riders", RIDER_COLS);
  const levende = alleRiders.filter((r) => !r.is_retired);
  const ab = await selectIn(supabase, "rider_derived_abilities", "*", "rider_id", levende.map((r) => r.id));
  const abById = new Map(ab.map((a) => [a.rider_id, a]));

  const rows = levende.map((r) => {
    const a = abById.get(r.id) || null;
    const team = r.team_id ? teamById.get(r.team_id) : null;
    const abilities = {};
    if (a) for (const k of VISIBLE_ABILITIES) if (a[k] != null) abilities[k] = Number(a[k]);
    const row = {
      rider_id: r.id,
      firstname: r.firstname, lastname: r.lastname, birthdate: r.birthdate,
      age: ageForSeason(r.birthdate, aktiv.number),
      potentiale: r.potentiale != null ? Number(r.potentiale) : null,
      archetype_draw: r.archetype_draw,
      team_id: r.team_id,
      manager_display_name: team?.user_id ? userById.get(team.user_id)?.username ?? null : null,
      owner_kind: !r.team_id ? "free" : team?.is_ai ? "ai" : "human",
      is_test_account: !!team?.is_test_account,
      division: team?.division ?? null,
      is_academy: !!r.is_academy,
      primary_type: r.primary_type, secondary_type: r.secondary_type, valuation_type: r.valuation_type,
      base_value: r.base_value, market_value: r.market_value,
      height: r.height, weight: r.weight,
      abilities,
      ability_caps: a?.ability_caps ?? null,
      ability_progress: a?.ability_progress ?? null,
      har_abilities_raekke: !!a,
    };
    for (const k of STAT_KEYS) row[k] = r[k];
    return row;
  });

  return {
    rows, seasonNumber: aktiv.number, aktivSaeson: aktiv,
    appConfig: Object.fromEntries(appConfig.map((c) => [c.key, c.value])),
    antalAlleRiders: alleRiders.length,
    antalPensionerede: alleRiders.length - levende.length,
    udenAbilitiesRaekke: rows.filter((r) => !r.har_abilities_raekke).length,
    takenAt: new Date().toISOString(),
  };
}

// ── Backup ──────────────────────────────────────────────────────────────────
export const backupTabeller = (suffix) => ({
  riders: `riders_3570_backup_${suffix}`,
  abilities: `rider_derived_abilities_3570_backup_${suffix}`,
});

/**
 * DDL'en for de to backup-tabeller. Skabelonen er prod-præcedensen
 * `riders_type_backfill_snapshot_20260805` — plus `base_value`/`market_value`
 * (som præcedensen har og #3570-udkastet udelod) og den primærnøgle præcedensen
 * mangler (uden den kan rollback-joinet ramme dubletter).
 */
export function backupDDL(suffix) {
  const t = backupTabeller(suffix);
  return `-- #3570 backup-tabeller. Kør FØR reparationen, commit for sig.
CREATE TABLE IF NOT EXISTS public.${t.riders} (
  id uuid PRIMARY KEY,
  archetype_draw jsonb,
  primary_type text,
  secondary_type text,
  valuation_type text,
  base_value integer,
  market_value integer,
  is_retired boolean,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.${t.abilities} (
  rider_id uuid PRIMARY KEY,
  ability_caps jsonb,
  ability_progress jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);`;
}

/**
 * Fylder og VERIFICERER de to backup-tabeller. Kaster hvis noget som helst
 * ikke stemmer — der skrives ikke én rytter-række før denne funktion er
 * returneret uden fejl.
 *
 * Spærren mod at "verificere" en backup taget EFTER en skrivning er den samme
 * data-baserede som i `rollback.sql`: før reparationen har en håndfuld ryttere
 * et `archetype_draw`, efter har hele peletonen.
 */
export async function sikreBackup(supabase, { suffix, dryRun, log }) {
  const t = backupTabeller(suffix);
  const kilde = {
    riders: await selectPaged(supabase, "riders", "id, archetype_draw, primary_type, secondary_type, valuation_type, base_value, market_value, is_retired"),
    abilities: await selectPaged(supabase, "rider_derived_abilities", "rider_id, ability_caps, ability_progress"),
  };

  const laes = async (tabel, cols) => {
    try {
      return await selectPaged(supabase, tabel, cols);
    } catch (err) {
      throw new Error(
        `Backup-tabellen public.${tabel} kunne ikke læses (${err.message}).\n`
        + "Opret begge backup-tabeller først — DDL:\n\n" + backupDDL(suffix) + "\n",
        { cause: err },
      );
    }
  };

  const resultat = { suffix, tabeller: t, kilde: { riders: kilde.riders.length, abilities: kilde.abilities.length }, indsat: { riders: 0, abilities: 0 } };

  if (dryRun) {
    resultat.dryRun = true;
    resultat.note = `dry-run: ${kilde.riders.length} riders-rækker og ${kilde.abilities.length} abilities-rækker VILLE blive kopieret (inkl. pensionerede).`;
    return resultat;
  }

  const eksisterendeR = await laes(t.riders, "id, archetype_draw, primary_type, secondary_type, valuation_type, base_value, market_value, is_retired");
  const eksisterendeA = await laes(t.abilities, "rider_id, ability_caps, ability_progress");

  // Spærre: en ikke-tom kopi må ikke være taget efter en skrivning.
  const medDraw = eksisterendeR.filter((r) => validDraw(r.archetype_draw)).length;
  if (eksisterendeR.length > 0 && medDraw > DRAW_BASELINE_SPAERRE) {
    throw new Error(
      `STOP: public.${t.riders} indeholder allerede ${medDraw} ryttere med archetype_draw. `
      + "Kopien er taget EFTER en reparation og duer ikke som rollback-kilde. Vælg et nyt --backup-suffix.",
    );
  }

  if (eksisterendeR.length === 0) {
    log(`  fylder public.${t.riders} (${kilde.riders.length} rækker) …`);
    resultat.indsat.riders = await indsaetBatchet(supabase, t.riders, kilde.riders.map((r) => ({ ...r })));
  }
  if (eksisterendeA.length === 0) {
    log(`  fylder public.${t.abilities} (${kilde.abilities.length} rækker) …`);
    resultat.indsat.abilities = await indsaetBatchet(supabase, t.abilities, kilde.abilities.map((r) => ({ ...r })));
  }

  // Verifikation MOD DB, ikke mod det vi troede vi indsatte.
  const kopiR = await laes(t.riders, "id, archetype_draw, primary_type, secondary_type, valuation_type, base_value, market_value, is_retired");
  const kopiA = await laes(t.abilities, "rider_id, ability_caps, ability_progress");
  const kR = new Map(kopiR.map((r) => [r.id, r]));
  const kA = new Map(kopiA.map((r) => [r.rider_id, r]));
  const mangler = [], afviger = [];
  for (const r of kilde.riders) {
    const c = kR.get(r.id);
    if (!c) { mangler.push(r.id); continue; }
    if (c.primary_type !== r.primary_type || c.secondary_type !== r.secondary_type
      || c.valuation_type !== r.valuation_type || c.base_value !== r.base_value
      || c.market_value !== r.market_value
      || JSON.stringify(c.archetype_draw ?? null) !== JSON.stringify(r.archetype_draw ?? null)) afviger.push(r.id);
  }
  for (const r of kilde.abilities) {
    const c = kA.get(r.rider_id);
    if (!c) { mangler.push(r.rider_id); continue; }
    if (JSON.stringify(c.ability_caps ?? null) !== JSON.stringify(r.ability_caps ?? null)
      || JSON.stringify(c.ability_progress ?? null) !== JSON.stringify(r.ability_progress ?? null)) afviger.push(r.rider_id);
  }
  resultat.kopi = { riders: kopiR.length, abilities: kopiA.length };
  resultat.mangler = mangler.length;
  resultat.afviger = afviger.length;
  if (kopiR.length !== kilde.riders.length || kopiA.length !== kilde.abilities.length || mangler.length || afviger.length) {
    throw new Error(
      `STOP: backup ikke verificeret. riders ${kopiR.length}/${kilde.riders.length}, `
      + `abilities ${kopiA.length}/${kilde.abilities.length}, manglende ${mangler.length}, afvigende ${afviger.length}. `
      + "Der er IKKE skrevet én rytter-række.",
    );
  }
  resultat.verificeret = true;
  return resultat;
}

async function indsaetBatchet(supabase, tabel, rows, chunk = 500) {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const { error } = await supabase.from(tabel).insert(batch);
    if (error) throw new Error(`INSERT ${tabel}: nåede ${n}/${rows.length} rækker, batch @${i} fejlede: ${error.message}`);
    n += batch.length;
  }
  return n;
}

// ── Skrivning ───────────────────────────────────────────────────────────────
/**
 * Identiteten skrives grupperet: `archetype_draw`, `primary_type` og
 * `secondary_type` er ens for alle ryttere med samme (primær, sekundær)-par, så
 * 8.193 rækker bliver til højst 56 grupper × id-batches i stedet for 8.193 kald.
 * Lofterne er unikke pr. rytter og skrives række for række.
 */
export async function skrivIdentitet(supabase, poster, { chunk = 100, log } = {}) {
  const grupper = new Map();
  for (const p of poster) {
    const key = `${p.newPrimary}|${p.newSecondary}`;
    if (!grupper.has(key)) grupper.set(key, []);
    grupper.get(key).push(p.rider_id);
  }
  let skrevet = 0, batches = 0;
  for (const [key, ids] of grupper) {
    const [primary, secondary] = key.split("|");
    for (let i = 0; i < ids.length; i += chunk) {
      const del = ids.slice(i, i + chunk);
      // Værdien kommer fra det frosne anlæg (archetype_draw), som er præcis hvad
      // resolveRiderTypes ville returnere — ikke fra computeRiderTypes.
      const patch = { archetype_draw: { primary, secondary }, primary_type: primary, secondary_type: secondary };
      const { error } = await supabase.from("riders").update(patch).in("id", del);
      batches++;
      if (error) {
        throw new Error(`UPDATE riders: nåede ${skrevet}/${poster.length} ryttere (${batches - 1} batches OK), batch ${key}@${i} fejlede: ${error.message}`);
      }
      skrevet += del.length;
      if (log && skrevet % 1000 < chunk) log(`  identitet: ${skrevet}/${poster.length}`);
    }
  }
  return { skrevet, batches, grupper: grupper.size };
}

export async function skrivLofter(supabase, poster, { concurrency = 8, log } = {}) {
  let skrevet = 0;
  let fejl = null;
  let idx = 0;
  const arbejder = async () => {
    for (;;) {
      const i = idx++;
      if (i >= poster.length || fejl) return;
      const p = poster[i];
      const { error } = await supabase.from("rider_derived_abilities").update({ ability_caps: p.newCaps }).eq("rider_id", p.rider_id);
      if (error) { fejl = fejl || { rider_id: p.rider_id, message: error.message }; return; }
      skrevet++;
      if (log && skrevet % 1000 === 0) log(`  lofter: ${skrevet}/${poster.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, arbejder));
  if (fejl) throw new Error(`UPDATE rider_derived_abilities: nåede ${skrevet}/${poster.length} rækker, rytter ${fejl.rider_id} fejlede: ${fejl.message}`);
  return { skrevet };
}

// ── Post-verify ─────────────────────────────────────────────────────────────
/**
 * Læser tilbage fra DB og bekræfter fem invarianter. Kaster ved enhver afvigelse.
 *   (a) alle skrevne ryttere har et gyldigt `archetype_draw`
 *   (b) `primary_type` == draw'ets primær — kontrolleret gennem produktionens
 *       egen `resolveRiderTypes`, ikke kun en felt-sammenligning
 *   (c) `ability_caps` == `buildCapsForRider` med produktionens kaldform
 *   (d) 0 lofter under rytterens nuværende evne (gulv-garantien)
 *   (e) `valuation_type` uændret for alle (#3345-frysningen må ikke røres)
 */
export async function postVerify(supabase, plan, { skrevneCaps, foerValuation, seasonNumber }) {
  const scope = plan.poster.filter((p) => p.skrives);
  const ids = scope.map((p) => p.rider_id);
  const capsSkrevet = new Set(skrevneCaps.map((p) => p.rider_id));

  const riders = await selectIn(supabase, "riders", "id, archetype_draw, primary_type, secondary_type, valuation_type, birthdate, potentiale", "id", ids);
  const ab = await selectIn(supabase, "rider_derived_abilities", "*", "rider_id", ids);
  const rById = new Map(riders.map((r) => [r.id, r]));
  const aById = new Map(ab.map((a) => [a.rider_id, a]));

  const fejl = { manglerRaekke: [], udenDraw: [], typeMismatch: [], capsMismatch: [], gulvBrud: [], valuationAendret: [], traenetUnderKoerslen: [] };
  for (const p of scope) {
    const r = rById.get(p.rider_id);
    const a = aById.get(p.rider_id);
    if (!r || !a) { fejl.manglerRaekke.push(p.rider_id); continue; }

    if (!validDraw(r.archetype_draw)) { fejl.udenDraw.push(p.rider_id); continue; }

    const friskeEvner = {};
    for (const k of VISIBLE_ABILITIES) if (a[k] != null) friskeEvner[k] = Number(a[k]);
    const alder = ageForSeason(r.birthdate, seasonNumber);
    const model = selectTypesBaseline(alder, ADULT_BASELINE, YOUTH_BASELINE);
    const løst = resolveRiderTypes(r.archetype_draw, a.ability_caps || {}, model);
    if (løst.primary.key !== r.primary_type || r.primary_type !== r.archetype_draw.primary) {
      fejl.typeMismatch.push({ rider_id: p.rider_id, draw: r.archetype_draw.primary, primary_type: r.primary_type, resolve: løst.primary.key });
    }

    if (capsSkrevet.has(p.rider_id)) {
      const forventet = buildCapsForRider(friskeEvner, { potentiale: r.potentiale, age: alder }, r.archetype_draw.primary, r.secondary_type);
      if (!sameCaps(a.ability_caps, forventet)) {
        const trænet = VISIBLE_ABILITIES.some((k) => Number(friskeEvner[k] ?? 0) !== Number(p.abilities[k] ?? 0));
        (trænet ? fejl.traenetUnderKoerslen : fejl.capsMismatch).push(p.rider_id);
      }
    }
    for (const k of VISIBLE_ABILITIES) {
      if (Number(a.ability_caps?.[k] ?? 0) < Number(friskeEvner[k] ?? 0)) { fejl.gulvBrud.push(p.rider_id); break; }
    }

    if ((r.valuation_type ?? null) !== (foerValuation.get(p.rider_id) ?? null)) {
      fejl.valuationAendret.push({ rider_id: p.rider_id, foer: foerValuation.get(p.rider_id) ?? null, efter: r.valuation_type ?? null });
    }
  }

  const antal = Object.fromEntries(Object.entries(fejl).map(([k, v]) => [k, v.length]));
  const samlet = Object.values(antal).reduce((a, b) => a + b, 0);
  const rapport = { kontrolleret: scope.length, capsKontrolleret: capsSkrevet.size, antal, eksempler: Object.fromEntries(Object.entries(fejl).map(([k, v]) => [k, v.slice(0, 5)])) };
  if (samlet > 0) {
    const err = new Error(`POST-VERIFY FEJLEDE: ${JSON.stringify(antal)}. Se rollback.sql / backup-tabellerne.`);
    err.rapport = rapport;
    throw err;
  }
  return { ...rapport, bestaaet: true };
}

// ── Orkestrering ────────────────────────────────────────────────────────────
export const STANDARD_OPTIONS = Object.freeze({
  apply: false,
  ejerBekraeftet: false,
  lofter: "alle",              // alle | menneske | ingen
  backupSuffix: null,          // default: dagens dato i Europe/Copenhagen
  fortsaetDelvis: false,
  baselineDir: BASELINE_SNAPSHOT_DIR,
  ingenBaseline: false,
  concurrency: 8,
  log: (s) => console.log(s),
});

/**
 * Hele reparationen. Dry-run er default; der skrives KUN når både `apply` og
 * `ejerBekraeftet` er sande.
 */
export async function runRepair3570(supabase, options = {}) {
  const o = { ...STANDARD_OPTIONS, ...options };
  const log = o.log;
  const skriver = o.apply === true && o.ejerBekraeftet === true;
  const suffix = o.backupSuffix || cphDateStamp();
  const ud = { tilstand: skriver ? "APPLY" : "DRY-RUN", startet: new Date().toISOString() };

  if (o.apply && !o.ejerBekraeftet) {
    throw new Error(
      "--apply kræver også --jeg-har-set-dry-runnet. Ejer-gaten ligger i koden, ikke i hovedet "
      + "på den der kører den: læs dry-run-udskriften FØR du skriver til produktionen.",
    );
  }

  // 1) Selvtest — planlæggeren skal reproducere de tal ejeren godkendte.
  log("── 1/8 Selvtest mod det daterede 10/8-snapshot ──");
  const selvtest = runSelvtest({ dir: o.baselineDir });
  ud.selvtest = { bestaaet: selvtest.bestaaet, afvigelser: selvtest.afvigelser, sammenligninger: selvtest.sammenligninger };
  if (!selvtest.bestaaet) {
    log(`  🔴 ${selvtest.afvigelser.length} afvigelse(r):`);
    for (const a of selvtest.afvigelser) log(`     ${a.navn}: ${a.faktisk} (forventet ${a.forventet})`);
    throw new Error("Selvtesten fejlede — planlæggeren reproducerer ikke det godkendte dry-run. Der er ikke rørt ved produktionen.");
  }
  log(`  ✅ ${selvtest.sammenligninger.toLocaleString("da-DK")} sammenligninger · 0 afvigelser`);

  // 2) Frisk snapshot.
  log("── 2/8 Frisk prod-snapshot (kun SELECT) ──");
  const frisk = await hentFriskPopulation(supabase);
  ud.frisk = {
    takenAt: frisk.takenAt, saeson: frisk.seasonNumber, levende: frisk.rows.length,
    alleRiders: frisk.antalAlleRiders, pensionerede: frisk.antalPensionerede,
    udenAbilitiesRaekke: frisk.udenAbilitiesRaekke,
    medDraw: frisk.rows.filter((r) => validDraw(r.archetype_draw)).length,
  };
  log(`  ${frisk.rows.length} levende ryttere · sæson ${frisk.seasonNumber} · ${ud.frisk.medDraw} har allerede et anlæg · ${frisk.antalPensionerede} pensionerede (uden for scope)`);

  // 3) Planen bygges forfra på det friske snapshot.
  log("── 3/8 Planen bygges forfra ──");
  const plan = buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber });
  const tal = populationsTal(plan.poster);
  ud.plan = {
    segmenter: plan.segmenter, kilder: plan.kilder, kvoter: plan.kvoter, loeser: plan.loeser,
    udenFoedselsstats: plan.udenFoedselsstats,
    skrives: tal.skrives, primaerSkift: tal.primaerSkift, sekundaerSkift: tal.sekundaerSkift,
  };
  log(`  ${tal.skrives} ryttere i skrive-scopet · ${tal.primaerSkift} skifter synlig type · løser-gap ${plan.loeser.gap.toExponential(1)}`);

  // Delvis-kørsel-spærre.
  const medDraw = ud.frisk.medDraw;
  if (medDraw >= frisk.rows.length) {
    log("  ⚠ ALLE levende ryttere har allerede et anlæg — reparationen er kørt. 0 rækker at skrive.");
  } else if (medDraw > DRAW_BASELINE_SPAERRE && !o.fortsaetDelvis) {
    throw new Error(
      `STOP: ${medDraw} af ${frisk.rows.length} ryttere har allerede et archetype_draw, men ikke alle. `
      + "Det ligner en afbrudt kørsel. Genoptages den, bliver kvoterne beregnet over den RESTERENDE pulje, "
      + "og fordelingen bliver en anden end den ejeren godkendte. Gennemgå tilstanden og kør igen med --fortsaet-delvis "
      + "hvis det er bevidst.",
    );
  }

  // 4) Diff mod dry-runnets plan — flyttede verden sig under ejeren?
  if (!o.ingenBaseline) {
    log("── 4/8 Diff mod planen fra 10/8-snapshottet ──");
    const diff = diffModBaseline(plan, selvtest.plan);
    ud.diff = {
      baseline_n: diff.baseline_n, frisk_n: diff.frisk_n,
      nye: diff.nye.length, forsvundne: diff.forsvundne.length,
      labelDriftAntal: diff.labelDriftAntal, capsDriftAntal: diff.capsDriftAntal,
      primaerDiffAntal: diff.primaerDiffAntal, sekundaerDiffAntal: diff.sekundaerDiffAntal,
      primaerDiff: diff.primaerDiff, labelDrift: diff.labelDrift.slice(0, 50), nyeRyttere: diff.nye, forsvundneRyttere: diff.forsvundne,
    };
    log(`  ${diff.labelDriftAntal} ryttere har fået et nyt label siden 10/8 · ${diff.capsDriftAntal} har nye lofter i DB`);
    log(`  ${diff.primaerDiffAntal} får en ANDEN frossen type end 10/8-planen · ${diff.nye.length} nye · ${diff.forsvundne.length} forsvundne`);
    for (const d of diff.primaerDiff.slice(0, 10)) {
      log(`     ${d.navn} (${d.ejer}${d.hold ? `, ${d.hold}` : ""}, seg. ${d.segment}/${d.kilde}): ${DA[d.plan_1008]} → ${DA[d.plan_nu]}`);
    }
    if (diff.primaerDiff.length > 10) log(`     … og ${diff.primaerDiff.length - 10} til (fuld liste i resultat-objektet)`);
  } else {
    log("── 4/8 Diff mod 10/8-planen SPRUNGET OVER (--ingen-baseline) ──");
  }

  // 5) Idempotens-bevis (kører i BEGGE tilstande, altid før skrivning).
  log("── 5/8 Idempotens-bevis ──");
  const idem = bevisIdempotens(frisk.rows, plan);
  ud.idempotens = idem;
  log(`  anden kørsel ville skrive ${idem.andenKoerselSkriver} rækker (identitet ${idem.andenKoerselIdentitet}, lofter ${idem.andenKoerselCaps})`);
  if (!idem.ok) throw new Error(`Idempotens-beviset fejlede: anden kørsel ville skrive ${idem.andenKoerselSkriver} rækker. STOP.`);

  // 6) Hvad ville/skal skrives.
  const scope = plan.poster.filter((p) => p.skrives);
  const identitetsScope = scope.filter((p) => p.identitetAendres);
  const capsScope = o.lofter === "ingen" ? []
    : scope.filter((p) => p.capsAendres && (o.lofter === "alle" || p.row.owner_kind === "human"));
  ud.skriveScope = {
    lofterValg: o.lofter,
    identitet: identitetsScope.length,
    lofter: capsScope.length,
    udeladt: plan.poster.length - scope.length,
    udeladteRyttere: plan.poster.filter((p) => !p.skrives).map((p) => ({ rider_id: p.rider_id, navn: navnAf(p.row), grund: p.udeladelses_grund })),
  };
  ud.populationer = Object.fromEntries(Object.entries(populationer(plan.poster)).map(([k, v]) => [k, populationsTal(v)]));

  if (!skriver) {
    log("── 6/8 DRY-RUN — intet skrives ──");
    log(`  ville skrive identitet for ${identitetsScope.length} ryttere og lofter for ${capsScope.length} (--lofter=${o.lofter})`);
    log("── 7/8 Backup (dry-run) ──");
    ud.backup = await sikreBackup(supabase, { suffix, dryRun: true, log });
    log(`  ${ud.backup.note}`);
    log("── 8/8 Post-verify springes over i dry-run ──");
    ud.afsluttet = new Date().toISOString();
    ud.skrevet = { identitet: 0, lofter: 0 };
    rapportér(ud, plan, log);
    return ud;
  }

  if (identitetsScope.length === 0 && capsScope.length === 0) {
    // Ingen grund til at kopiere 8.234 rækker for at skrive nul. Det er den
    // normale anden-kørsel: reparationen er allerede gennemført.
    log("── 6/8 Ingen rækker at skrive — backup og skrivning springes over ──");
    log("  Reparationen er allerede gennemført: hver rytter i scope bærer sin faste identitet.");
    ud.skrevet = { identitet: 0, lofter: 0 };
    ud.backup = { suffix, sprunget_over: "0 rækker at skrive" };
    ud.afsluttet = new Date().toISOString();
    rapportér(ud, plan, log);
    return ud;
  }

  // 7) Backup FØR skrivning.
  log("── 6/8 Backup FØR skrivning ──");
  ud.backup = await sikreBackup(supabase, { suffix, dryRun: false, log });
  log(`  ✅ backup verificeret: ${ud.backup.kopi.riders} riders-rækker + ${ud.backup.kopi.abilities} abilities-rækker i public.${ud.backup.tabeller.riders} / public.${ud.backup.tabeller.abilities}`);

  // 8) Skrivning.
  log("── 7/8 Skrivning ──");
  const foerValuation = new Map(frisk.rows.map((r) => [r.rider_id, r.valuation_type ?? null]));
  const idRes = await skrivIdentitet(supabase, identitetsScope, { log });
  log(`  identitet: ${idRes.skrevet} ryttere i ${idRes.batches} batches (${idRes.grupper} type-grupper)`);
  const capRes = capsScope.length ? await skrivLofter(supabase, capsScope, { concurrency: o.concurrency, log }) : { skrevet: 0 };
  log(`  lofter: ${capRes.skrevet} rækker`);
  ud.skrevet = { identitet: idRes.skrevet, lofter: capRes.skrevet };

  // 9) Post-verify.
  log("── 8/8 Post-verify ──");
  ud.postVerify = await postVerify(supabase, plan, { skrevneCaps: capsScope, foerValuation, seasonNumber: frisk.seasonNumber });
  log(`  ✅ ${ud.postVerify.kontrolleret} ryttere kontrolleret · 0 afvigelser`);

  ud.afsluttet = new Date().toISOString();
  rapportér(ud, plan, log);
  return ud;
}

// ── Rapport i klar tekst ────────────────────────────────────────────────────
function rapportér(ud, plan, log) {
  const skrev = ud.tilstand === "APPLY";
  log("");
  log("════════════════════════════════════════════════════════════════════");
  log(skrev ? "  HVAD DER BLEV SKREVET" : "  HVAD DER VILLE BLIVE SKREVET (dry-run — intet er rørt)");
  log("════════════════════════════════════════════════════════════════════");
  log("");
  log(`Identitet (riders.archetype_draw + primary_type + secondary_type): ${skrev ? ud.skrevet.identitet : ud.skriveScope.identitet} ryttere`);
  log(`Lofter (rider_derived_abilities.ability_caps, --lofter=${ud.skriveScope.lofterValg}): ${skrev ? ud.skrevet.lofter : ud.skriveScope.lofter} ryttere`);
  log(`Udeladt helt: ${ud.skriveScope.udeladt} ryttere (eksisterende anlæg / ingen abilities-række)`);
  log("");
  log("Pr. population:");
  log("  population              n     skrives  ny type   L1 før → efter   loft sænket   median");
  for (const [navn, t] of Object.entries(ud.populationer)) {
    log(
      `  ${navn.padEnd(22)} ${String(t.n).padStart(5)}  ${String(t.skrives).padStart(7)}  `
      + `${String(t.primaerSkift).padStart(7)}   ${f1(t.L1foer).padStart(5)} → ${f1(t.L1efter).padEnd(5)}   `
      + `${f1(t.loftSaenketPct).padStart(5)} %      ${String(t.saenkningMedian ?? "—").padStart(4)}`,
    );
  }
  log("");
  log("Fordeling EFTER, alle (mål i parentes):");
  const e = ud.populationer.alle.fordelingEfter;
  log("  " + RIDER_TYPE_KEYS.map((k) => `${DA[k]} ${f1(e[k])} % (${MAAL[k]})`).join(" · "));
  log("");
  log(`Identitetens kilde: ${Object.entries(plan.kilder).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  log(`Segmenter: ${Object.entries(plan.segmenter).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (ud.diff) {
    log("");
    log(`Verden flyttede sig siden 10/8: ${ud.diff.labelDriftAntal} nye labels · ${ud.diff.capsDriftAntal} nye lofter i DB · ${ud.diff.primaerDiffAntal} ryttere får en anden frossen type end 10/8-planen.`);
  }
  if (skrev && ud.postVerify) {
    log("");
    log(`Backup: public.${ud.backup.tabeller.riders} (${ud.backup.kopi.riders}) + public.${ud.backup.tabeller.abilities} (${ud.backup.kopi.abilities}) — verificeret før skrivning.`);
    log(`Post-verify: ${ud.postVerify.kontrolleret} ryttere · 0 afvigelser på alle fem invarianter.`);
  } else if (skrev) {
    log("");
    log("Der var 0 rækker at skrive — hverken backup, skrivning eller post-verify blev nødvendig.");
  } else {
    log("");
    log("Kør med  --apply --jeg-har-set-dry-runnet  for at skrive. Uden BEGGE flag skrives intet.");
  }
  log("");
}

// ── CLI ─────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f, d = null) => {
    const eq = argv.find((a) => a.startsWith(`${f}=`));
    if (eq) return eq.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
  };
  const lofter = val("--lofter", "alle");
  if (!["alle", "menneske", "ingen"].includes(lofter)) throw new Error(`--lofter skal være alle|menneske|ingen, ikke "${lofter}"`);
  return {
    hjaelp: has("--hjaelp") || has("--help") || has("-h"),
    selvtest: has("--selvtest"),
    apply: has("--apply"),
    ejerBekraeftet: has("--jeg-har-set-dry-runnet"),
    lofter,
    backupSuffix: val("--backup-suffix", null),
    fortsaetDelvis: has("--fortsaet-delvis"),
    ingenBaseline: has("--ingen-baseline"),
    baselineDir: val("--baseline", BASELINE_SNAPSHOT_DIR),
    concurrency: Number(val("--concurrency", "8")),
    ud: val("--ud", null),
    printBackupSql: has("--print-backup-sql"),
  };
}

export const HJAELP = `#3570 reparations-værktøj — én kommando.

  node scripts/dev/repair3570Apply.mjs [flag]

FLAG
  (ingen)                    DRY-RUN. Læser prod (kun SELECT), bygger planen forfra,
                             beviser idempotens, rapporterer — skriver ALDRIG.
  --apply                    Intention om at skrive. Virker KUN sammen med næste flag.
  --jeg-har-set-dry-runnet   Ejer-gate. Uden den skriver --apply ingenting.
  --lofter=alle|menneske|ingen
                             Hvilke ability_caps der skrives (dry-runnets beslutning 2).
                             alle (default) · menneske = kun menneske-ejede hold ·
                             ingen = kun identiteten, lofterne selv-heler ved næste tick.
  --backup-suffix=YYYYMMDD   Suffiks på de to backup-tabeller (default: dagens dato, dansk tid).
  --fortsaet-delvis          Tillad genoptagelse efter en afbrudt kørsel (kvoterne
                             genberegnes så over den RESTERENDE pulje — læs advarslen).
  --selvtest                 Kør KUN selvtesten mod det daterede 10/8-snapshot. Ingen DB.
  --baseline=<mappe>         Alternativt baseline-snapshot (default docs/snapshots/3570).
  --ingen-baseline           Spring diffen mod 10/8-planen over.
  --concurrency=<n>          Parallelle loft-opdateringer (default 8).
  --ud=<fil.json>            Skriv hele resultat-objektet (inkl. fulde diff-lister) hertil.
  --print-backup-sql         Udskriv DDL'en for de to backup-tabeller og stop.
  --hjaelp                   Denne tekst.

REKKEFØLGE (uændret uanset flag): selvtest → frisk snapshot → plan → diff mod 10/8 →
idempotens-bevis → backup (kun ved --apply) → skrivning → post-verify.
`;

function isMain() {
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.hjaelp) { console.log(HJAELP); return; }
  if (args.printBackupSql) { console.log(backupDDL(args.backupSuffix || cphDateStamp())); return; }

  if (args.selvtest) {
    const res = runSelvtest({ dir: args.baselineDir });
    console.log(`Selvtest mod ${args.baselineDir}`);
    console.log(`  ${res.sammenligninger.toLocaleString("da-DK")} sammenligninger · ${res.afvigelser.length} afvigelser`);
    for (const a of res.afvigelser) console.log(`  🔴 ${a.navn}: ${a.faktisk} (forventet ${a.forventet})`);
    if (!res.bestaaet) process.exit(1);
    console.log(`  ✅ planlæggeren reproducerer det godkendte dry-run (segmenter ${JSON.stringify(res.plan.segmenter)}, kilder ${JSON.stringify(res.plan.kilder)})`);
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE-secrets. Kør via: infisical run --env=prod -- node scripts/dev/repair3570Apply.mjs");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const res = await runRepair3570(supabase, {
    apply: args.apply,
    ejerBekraeftet: args.ejerBekraeftet,
    lofter: args.lofter,
    backupSuffix: args.backupSuffix,
    fortsaetDelvis: args.fortsaetDelvis,
    baselineDir: args.baselineDir,
    ingenBaseline: args.ingenBaseline,
    concurrency: args.concurrency,
  });

  if (args.ud) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args.ud, JSON.stringify(res, null, 1));
    console.log(`Resultat-objekt skrevet til ${args.ud}`);
  }
}

if (isMain()) {
  main().catch((err) => {
    console.error(`\n🔴 ${err.message}`);
    if (err.rapport) console.error(JSON.stringify(err.rapport, null, 1));
    process.exit(1);
  });
}
