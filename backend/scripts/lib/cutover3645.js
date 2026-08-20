// #3645 — ren, testbar logik bag cutover-værktøjet til 23/8.
//
// FORMÅL. Drejebogen (`docs/2026-08-23-cutover-drejebog.md`) kræver fire ting FØR
// et flip: et snapshot der kan læses, et gendannelses-script der er tør-kørt, en
// backup af de tabeller løn- og mandat-komponenterne rører, og en genberegning der
// kan vises frem uden at skrive. Alt det er I/O-tungt, og I/O er svært at teste.
// Denne fil holder derfor ALT der kan regnes uden en database, så scriptene i
// `backend/scripts/dev/` kun står for læsning, skrivning og rapport.
//
// INTET HER RØRER EN DATABASE. Ingen import af supabase, ingen process.env.
//
// Refs #3645 #3459 #3393 #3514.

// ── Percentiler ─────────────────────────────────────────────────────────────
// Nærmeste-rang på en STIGENDE liste. Vi bruger nærmeste-rang frem for lineær
// interpolation, fordi tallene skal kunne genfindes som en konkret rytter i
// rapporten — et interpoleret p10 svarer ikke til nogen faktisk række.
export function percentile(sortedAsc, p) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(clamped * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

// p10/p50/p90 af en vilkårligt sorteret talrække. Kopierer inden sortering, så
// kalderens array ikke muteres.
export function percentileSummary(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!nums.length) return { n: 0, min: null, p10: null, p50: null, p90: null, max: null, mean: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    n: nums.length,
    min: nums[0],
    p10: percentile(nums, 0.1),
    p50: percentile(nums, 0.5),
    p90: percentile(nums, 0.9),
    max: nums[nums.length - 1],
    mean: sum / nums.length,
  };
}

// ── Lofter ──────────────────────────────────────────────────────────────────
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function capSum(caps, keys) {
  return keys.reduce((a, k) => a + num(caps?.[k]), 0);
}

// "Bedste-af-N loft" — snittet af de N højeste lofter. Drejebogens stop-gate er
// formuleret i "bedste-af-8", og det er bevidst IKKE en rating: `ratingFromAbilities`
// skiftede enhed 14/8 (#3666), så et rating-delta målt i dag kan ikke sammenlignes
// med de tal der blev godkendt. Vi rapporterer derfor i rå loft-enheder, hvor
// enheden ikke har flyttet sig.
export function topNMean(caps, keys, n = 8) {
  const vals = keys.map((k) => num(caps?.[k])).sort((a, b) => b - a).slice(0, n);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Dyb lighed for de nøgler vi faktisk skriver. `ability_caps` og `ability_progress`
// er jsonb; en JSON.stringify-sammenligning ville falde over nøgle-rækkefølge.
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

// Bygger gendannelses-planen: hvilke rækker skal skrives tilbage fra snapshottet,
// og hvad er deltaet der bliver rullet tilbage.
//
// `deltaCapSum` og `deltaTop8` måles som LEVENDE MINUS SNAPSHOT — altså det som
// flippet har flyttet, og som gendannelsen fjerner igen. Negativ = rytteren har
// TABT loft siden snapshottet (det forventede efter race-day-flippet).
//
// Idempotens: rækker der allerede er identiske med snapshottet kommer ikke i
// planen, så en anden kørsel skriver nul rækker.
export function buildCapsRestorePlan({ snapshotRows, liveRows, abilityKeys }) {
  const keys = abilityKeys || [];
  const liveById = new Map((liveRows || []).map((r) => [r.rider_id, r]));
  const seenSnapshot = new Set();

  const plan = [];
  const missingInLive = [];
  const deltaCapSums = [];
  const deltaTop8s = [];
  let unchanged = 0;
  let capsChanged = 0;
  let progressChanged = 0;

  for (const snap of snapshotRows || []) {
    if (!snap || !snap.rider_id) continue;
    seenSnapshot.add(snap.rider_id);
    const live = liveById.get(snap.rider_id);
    if (!live) {
      missingInLive.push(snap.rider_id);
      continue;
    }
    const capsDiff = !jsonEqual(live.ability_caps ?? null, snap.ability_caps ?? null);
    const progDiff = !jsonEqual(live.ability_progress ?? null, snap.ability_progress ?? null);
    if (!capsDiff && !progDiff) {
      unchanged++;
      continue;
    }
    if (capsDiff) capsChanged++;
    if (progDiff) progressChanged++;
    const dSum = capSum(live.ability_caps, keys) - capSum(snap.ability_caps, keys);
    const dTop8 = topNMean(live.ability_caps, keys, 8) - topNMean(snap.ability_caps, keys, 8);
    if (capsDiff) {
      deltaCapSums.push(dSum);
      deltaTop8s.push(dTop8);
    }
    plan.push({
      rider_id: snap.rider_id,
      capsDiff,
      progressDiff: progDiff,
      deltaCapSum: dSum,
      deltaTop8: dTop8,
      ability_caps: snap.ability_caps ?? null,
      ability_progress: snap.ability_progress ?? null,
    });
  }

  const extraInLive = (liveRows || [])
    .filter((r) => r && r.rider_id && !seenSnapshot.has(r.rider_id))
    .map((r) => r.rider_id);

  return {
    plan,
    unchanged,
    capsChanged,
    progressChanged,
    missingInLive,
    // Ryttere der er kommet til EFTER snapshottet. De må aldrig røres af en
    // gendannelse — der findes ingen "før"-tilstand at gendanne dem til.
    extraInLive,
    deltaCapSum: percentileSummary(deltaCapSums),
    deltaTop8: percentileSummary(deltaTop8s),
  };
}

// ── Mandat (#3514) ──────────────────────────────────────────────────────────
// Ejer-valg 7/8 (spec §65 + beslutningstabel række 7): startværdien for det ENE
// tillidstal er det vægtede snit af de tre nuværende tilfredsheder,
// 1yr 50 % / 3yr 30 % / 5yr 20 %.
export const MANDATE_CONFIDENCE_WEIGHTS = Object.freeze({ "1yr": 0.5, "3yr": 0.3, "5yr": 0.2 });

// Målt mod prod 17/8: 208 hold har en 1yr-plan, 175 en 3yr, 183 en 5yr — altså
// har IKKE alle hold alle tre. Vægtene renormaliseres derfor over de planer der
// faktisk findes, i stedet for at lade et manglende 5-årsmål trække tilliden mod 0.
// Et hold uden nogen plan får null (ikke 0) og skal springes over af kalderen.
export function mandateConfidenceFromSatisfactions(satisfactionByPlanType, weights = MANDATE_CONFIDENCE_WEIGHTS) {
  let wSum = 0;
  let acc = 0;
  const used = [];
  for (const [planType, weight] of Object.entries(weights)) {
    const raw = satisfactionByPlanType?.[planType];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    acc += Number(raw) * weight;
    wSum += weight;
    used.push(planType);
  }
  if (wSum === 0) return { confidence: null, usedPlanTypes: [], weightCoverage: 0 };
  const confidence = Math.round(Math.min(100, Math.max(0, acc / wSum)));
  return { confidence, usedPlanTypes: used, weightCoverage: wSum };
}

// Konsekvens-laget som ET tillidstal lander i. Tærsklerne er UÆNDREDE (spec §33:
// "Konsekvens-lag 1-6: uændrede tærskler, nu mod det ENE confidence-tal") og
// injiceres af kalderen fra `boardConsequences.CONSEQUENCE_CONSTANTS`, så denne
// fil aldrig bliver en andenudgave af tærsklerne.
export function consequenceTier(value, thresholds) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  if (v < thresholds.SPONSOR_PULLOUT) return "sponsor_pullout";
  if (v < thresholds.FORCED_LISTING) return "forced_listing";
  if (v < thresholds.SIGNING_RESTRICTION) return "signing_restriction";
  if (v < thresholds.SALARY_CAP) return "salary_cap";
  if (v > thresholds.BONUS_OFFER) return "bonus_offer";
  return "none";
}

// ── Backup-navngivning ──────────────────────────────────────────────────────
// Repoets konvention er `<emne>_<issue>_backup_<YYYYMMDD>` (fx
// `rider_caps_3591_backup_20260813`). Datoen er cutover-datoen, ikke kørselsdatoen,
// så to kørsler samme cutover fylder den SAMME tabel og forbliver idempotente.
export function backupTableName(topic, issue, isoDate) {
  const d = String(isoDate || "").slice(0, 10).replaceAll("-", "");
  if (!/^\d{8}$/.test(d)) throw new Error(`backupTableName: ugyldig dato "${isoDate}" (forventede YYYY-MM-DD)`);
  return `${topic}_${issue}_backup_${d}`;
}

// ── Rapport-hjælpere ────────────────────────────────────────────────────────
export const fmtInt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
export const fmtSigned = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n * 100) / 100}`);

// Fordeling som "nøgle: antal"-linjer, sorteret faldende.
export function countBy(rows, keyFn) {
  const out = new Map();
  for (const r of rows || []) {
    const k = String(keyFn(r));
    out.set(k, (out.get(k) || 0) + 1);
  }
  return Object.fromEntries([...out.entries()].sort((a, b) => b[1] - a[1]));
}

// ── Løn-grundlag (#3645 / #3989) ────────────────────────────────────────────
// #3989 gjorde løn-formlen til ÉT globalt grundlag (computeFrozenSalary,
// current_production_value × SALARY_RATE_PRODUCTION, ingen division). Det
// tidligere `--basis market`-grundlag (#3393, lib/salaryBasis.js) blev
// parkeret og filen slettet ved merge af #3992 — der er intet at vælge
// imellem længere, kun ét gyldigt navn. Valideringen er bevidst ren og
// importerer IKKE computeFrozenSalary selv: scriptet i backend/scripts/dev/
// importerer og kalder den ægte funktion; denne fil siger kun om
// --basis-navnet er kendt.
export const VALID_SALARY_BASIS = Object.freeze(["production"]);

export function assertValidSalaryBasis(basis) {
  if (!VALID_SALARY_BASIS.includes(basis)) {
    throw new Error(
      `Ukendt --basis "${basis}". Gyldig værdi: ${VALID_SALARY_BASIS.join(", ")} (default, eneste model siden #3989).`,
    );
  }
  return basis;
}

// ── Løn-rapport pr. hold (#3645 / #3989) ────────────────────────────────────
// Rulle pr.-rytter foer/efter op pr. hold, så en løn-genberegnings-dry-run kan
// vise "nuværende lønsum → ny lønsum, ratio" pr. hold og et medianhold — det
// er præcis det tal ejeren godkendte hold-for-hold-målingen mod 20/8 (#3989:
// medianholdets prognose ×2,2 af dagens frosne løn). Ratio er null når
// holdets nuværende lønsum er 0 (undgår division med 0).
export function buildTeamSalaryReport(riderRows) {
  const byTeam = new Map();
  for (const r of riderRows || []) {
    if (r == null || r.teamId == null) continue;
    const t = byTeam.get(r.teamId) || {
      teamId: r.teamId,
      teamName: r.teamName ?? "(ukendt)",
      isAi: !!r.isAi,
      n: 0,
      foer: 0,
      efter: 0,
    };
    t.n++;
    t.foer += num(r.foer);
    t.efter += num(r.efter);
    byTeam.set(r.teamId, t);
  }
  const teams = [...byTeam.values()]
    .map((t) => ({ ...t, ratio: t.foer > 0 ? t.efter / t.foer : null }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName, "da"));

  const foerVals = teams.map((t) => t.foer).sort((a, b) => a - b);
  const efterVals = teams.map((t) => t.efter).sort((a, b) => a - b);
  const ratios = teams.filter((t) => t.ratio != null).map((t) => t.ratio).sort((a, b) => a - b);

  return {
    teams,
    medianFoer: percentile(foerVals, 0.5),
    medianEfter: percentile(efterVals, 0.5),
    medianRatio: percentile(ratios, 0.5),
    ratioSummary: percentileSummary(ratios),
  };
}
