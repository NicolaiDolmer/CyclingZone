// #5686 · Ejerens værdi-forhåndsvisning: hele populationens rytterværdi FØR og
// EFTER en valgt værdimodel, set i admin FØR modellen går live.
//
// Siden er GATEN for værdikørslen (#5443/#5497): ejeren siger "kør" herfra, ikke
// fra en CSV i chatten. Derfor gælder to løfter, og testen holder dem:
//
// 1. SAMME BEREGNINGSSTI SOM SØNDAGEN. Rækkerne hentes med de samme selects som
//    refreshChangedRiderValues (riderValueRefresh.js), alderen forankres i samme
//    sæson, baselines er de samme committede JSON-filer, og tallet regnes af
//    produktionens egen recomputeRiderValue. Der findes INGEN formel i denne fil.
//    Mønsteret er backend/scripts/dev/valuationV5DryRun5443.mjs, bare som et
//    endpoint i stedet for en CSV.
//
// 2. READ-ONLY. Modulet SELECT'er og regner. Det skriver intet, flipper intet og
//    kender ingen app_config-nøgle ud over dem det LÆSER for at vide hvad der er
//    live i dag.
//
// FØR = den model app_config peger på nu (rider_valuation_model).
// EFTER = `to` (et id fra VALUATION_MODEL_IDS, aldrig hårdkodet her), regnet ved
// trin `step` (0-4). Trinnet sendes videre som opts.phaseStep; v4/v5 ignorerer
// det, den typefri model (#5497) bruger det til elitepræmiens udfasning.
//
// LØN-KONTROL: løngrundlaget (current_production_value) regnes i BEGGE ender med
// den model rider_production_value_model peger på i dag. Flytter et eneste
// løngrundlag sig, er det en fejl i modellen, ikke i lønnen, og siden viser det.
//
// CACHE: ~7.000 ryttere regnes server-side. Datasættet (rækkerne) og hvert
// resultat pr. (from, to, step, løn-model) holdes i hukommelsen i 5 min, så et
// trin-skift ikke henter hele populationen igen og filtre i klienten er gratis.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { VALUATION_ABILITY_COLUMNS } from "./riderValuation.js";
import { recomputeRiderValue } from "./riderValueRefresh.js";
import {
  VALUATION_MODEL_IDS,
  loadValuationModelById,
  readProductionValueModelId,
  readValuationModelId,
} from "./riderValuationModelSelect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const VALUE_PREVIEW_CACHE_TTL_MS = 5 * 60_000;
// Kørselsdag + uge 1-4 (#5497: elitepræmien udfases 100/75/50/25/0 %).
export const VALUE_PREVIEW_STEPS = Object.freeze([0, 1, 2, 3, 4]);
export const VALUE_PREVIEW_MAX_STEP = VALUE_PREVIEW_STEPS[VALUE_PREVIEW_STEPS.length - 1];

// Samme kolonner som refreshChangedRiderValues + dem siden selv skal vise
// (navn, hold, akademi, pensioneret). Ekstra felter påvirker ikke beregningen:
// recomputeRiderValue læser kun de felter værdikæden kender.
const RIDER_SELECT = [
  "id", "firstname", "lastname", "team_id", "is_academy", "is_retired",
  "primary_type", "secondary_type", "valuation_type", "base_value",
  "current_production_value", "birthdate", "potentiale", "archetype_draw",
].join(", ");

/**
 * Validér query-parametrene. Ukendt model eller trin er en 400, ikke et gæt:
 * en forhåndsvisning af en model der ikke findes, må aldrig ligne en rigtig.
 * @returns {{ ok: true, to: string|null, step: number } | { ok: false, error: string }}
 */
export function parseValuePreviewQuery(query = {}, modelIds = VALUATION_MODEL_IDS) {
  const rawTo = typeof query.to === "string" ? query.to.trim().toLowerCase() : "";
  let to = null;
  if (rawTo) {
    if (!modelIds.includes(rawTo)) {
      return { ok: false, error: `Unknown model '${rawTo}'. Known: ${modelIds.join(", ")}` };
    }
    to = rawTo;
  }
  const rawStep = query.step;
  let step = 0;
  if (rawStep !== undefined && rawStep !== null && rawStep !== "") {
    const n = Number(rawStep);
    if (!Number.isInteger(n) || n < 0 || n > VALUE_PREVIEW_MAX_STEP) {
      return { ok: false, error: `step must be an integer 0-${VALUE_PREVIEW_MAX_STEP}` };
    }
    step = n;
  }
  return { ok: true, to, step };
}

/**
 * Standard-målmodellen når `to` ikke er givet: den første nøgle der IKKE er
 * live i dag (så siden åbner på en ægte sammenligning), ellers den live.
 */
export function defaultTargetModelId(liveId, modelIds = VALUATION_MODEL_IDS) {
  return modelIds.find((id) => id !== liveId) ?? liveId;
}

const humanTeam = (t) => !!t && !t.is_ai && !t.is_test_account && !t.is_frozen && !t.is_bank;

/**
 * Hent rækkerne præcis som søndagskørslen gør (samme sæson-anker, samme
 * selects, samme baselines). Ren I/O, ingen beregning.
 */
export async function loadValuePreviewDataset(supabase, { readFile = readFileSync } = {}) {
  // Samme sæson-anker som refreshChangedRiderValues: aktiv sæson, ellers
  // seneste afsluttede (aldrig 1 hvis der findes en afsluttet).
  const { data: active, error: activeErr } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (activeErr) throw new Error(`value-preview season lookup: ${activeErr.message}`);
  let seasonNumber = active?.number ?? null;
  if (!seasonNumber) {
    const { data: done, error: doneErr } = await supabase
      .from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    if (doneErr) throw new Error(`value-preview season lookup (completed): ${doneErr.message}`);
    seasonNumber = done?.number ?? 1;
  }

  const baseline = JSON.parse(readFile(join(__dirname, "riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFile(join(__dirname, "riderTypesBaselineYouth.json"), "utf8"));

  const riders = await fetchAllRows(() => supabase.from("riders").select(RIDER_SELECT).order("id"));
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);

  const abilityRows = await fetchAllRows(() => supabase.from("rider_derived_abilities")
    .select(`rider_id, ability_caps, ${VALUATION_ABILITY_COLUMNS.join(", ")}`).order("rider_id"));

  const teams = await fetchAllRows(() => supabase.from("teams")
    .select("id, name, division, is_ai, is_test_account, is_frozen, is_bank").order("id"));

  return { seasonNumber, baseline, youthBaseline, riders, abilityRows, teams, loadedAt: new Date().toISOString() };
}

// Hvor mange ryttere der regnes mellem hver pause til event-loopet. Én side af
// populationen tager et par sekunder; uden pauser ville hele API'et stå stille
// imens, fordi beregningen kører på serverens eneste tråd.
export const VALUE_PREVIEW_YIELD_EVERY = 200;
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Regn ÉN side (én model, ét trin) for hele populationen gennem produktionens
 * recomputeRiderValue. Returnerer Map(rider_id -> resultat). Pensionerede
 * ryttere og ryttere uden evner er ikke med, præcis som i tørkørslen.
 * `phaseStep` udeladt = den live tilstand (ingen trin-plan på FØR-siden).
 */
export async function computeValueSide(dataset, model, {
  wageModel, phaseStep, recompute = recomputeRiderValue, yieldEvery = VALUE_PREVIEW_YIELD_EVERY,
} = {}) {
  const { riders, abilityRows, baseline, youthBaseline } = dataset;
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));
  const side = new Map();
  let sinceYield = 0;
  for (const r of riders) {
    if (r.is_retired) continue;
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;
    const opts = { typeAbilities: ab.ability_caps, youthBaseline, productionModel: wageModel };
    if (phaseStep !== undefined) opts.phaseStep = phaseStep;
    side.set(r.id, recompute(r, ab, baseline, model, opts));
    sinceYield += 1;
    if (yieldEvery > 0 && sinceYield >= yieldEvery) { sinceYield = 0; await yieldToEventLoop(); }
  }
  return side;
}

/**
 * Sæt FØR- og EFTER-siden sammen til det siden viser. Ren funktion.
 */
export function combineValuePreview(dataset, beforeSide, afterSide) {
  const { riders, abilityRows, teams } = dataset;
  const withAbilities = new Set(abilityRows.map((a) => a.rider_id));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const out = [];
  let skipped = 0;
  let wageMoved = 0;
  let wageMovedOnTeams = 0;
  // Hvor mange værdier den LIVE model selv ville flytte ved næste søndag
  // (lagret base_value ≠ genberegnet FØR). Kontekst, ikke en del af diffen.
  let liveDrift = 0;

  for (const r of riders) {
    if (r.is_retired) continue;
    if (!withAbilities.has(r.id)) { skipped += 1; continue; }
    const a = beforeSide.get(r.id);
    const b = afterSide.get(r.id);
    if (!a || !b || a.base_value == null || b.base_value == null) { skipped += 1; continue; }

    if (a.current_production_value !== b.current_production_value) {
      wageMoved += 1;
      if (r.team_id) wageMovedOnTeams += 1;
    }
    if (r.base_value != null && r.base_value !== a.base_value) liveDrift += 1;

    const team = r.team_id ? teamById.get(r.team_id) : null;
    out.push({
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" ") || String(r.id),
      teamId: r.team_id ?? null,
      human: humanTeam(team),
      isAcademy: !!r.is_academy,
      age: r.age ?? null,
      type: a.primary_type ?? null,
      valuationType: r.valuation_type ?? null,
      before: a.base_value,
      after: b.base_value,
      cpvBefore: a.current_production_value,
      cpvAfter: b.current_production_value,
    });
  }

  // Kun hold der faktisk har ryttere i populationen.
  const usedTeamIds = new Set(out.map((p) => p.teamId).filter(Boolean));
  const teamList = teams
    .filter((t) => usedTeamIds.has(t.id))
    .map((t) => ({ id: t.id, name: t.name ?? null, division: t.division ?? null, human: humanTeam(t) }));

  return {
    riders: out,
    teams: teamList,
    skipped,
    liveDrift,
    wageControl: { moved: wageMoved, movedOnTeams: wageMovedOnTeams },
  };
}

/**
 * FØR/EFTER for hele populationen i ét kald (FØR = fromModel uden trin,
 * EFTER = toModel ved `step`). Løngrundlaget regnes i begge ender med wageModel.
 */
export async function computeValuePreview(dataset, { fromModel, toModel, wageModel, step = 0, recompute = recomputeRiderValue, yieldEvery } = {}) {
  const before = await computeValueSide(dataset, fromModel, { wageModel, recompute, yieldEvery });
  const after = await computeValueSide(dataset, toModel, { wageModel, phaseStep: step, recompute, yieldEvery });
  return combineValuePreview(dataset, before, after);
}

// Er modellen trin-følsom? Sammenlign kørselsdagen (trin 0) med sidste trin:
// giver de samme pris for hver eneste rytter, har modellen ingen trin-plan, og
// siden viser én kolonne i stedet for fem.
export function sidesDiffer(a, b) {
  if (a.size !== b.size) return true;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y || x.base_value !== y.base_value) return true;
  }
  return false;
}

/**
 * Cache + orkestrering. Én instans pr. proces (api.js), en frisk pr. test.
 * `now`, `loadDataset`, `recompute` og model-opslagene kan injiceres i tests.
 */
export function createValuePreviewService({
  ttlMs = VALUE_PREVIEW_CACHE_TTL_MS,
  now = Date.now,
  loadDataset = loadValuePreviewDataset,
  readLiveModelId = readValuationModelId,
  readWageModelId = readProductionValueModelId,
  loadModel = loadValuationModelById,
  recompute = recomputeRiderValue,
  modelIds = VALUATION_MODEL_IDS,
  yieldEvery = VALUE_PREVIEW_YIELD_EVERY,
} = {}) {
  let datasetEntry = null; // { promise, expiresAt }
  const sides = new Map(); // key -> { promise, expiresAt }

  function getDataset(supabase) {
    const t = now();
    if (datasetEntry && datasetEntry.expiresAt > t) return datasetEntry.promise;
    const promise = Promise.resolve().then(() => loadDataset(supabase));
    datasetEntry = { promise, expiresAt: t + ttlMs };
    // En fejlet hentning må ikke caches i 5 min: næste kald prøver igen.
    promise.catch(() => {
      // swallow-ok: kun cache-oprydning. Fejlen når kalderen via det returnerede
      // løfte (og ruten capturer den); her fjernes den bare fra cachen.
      if (datasetEntry?.promise === promise) datasetEntry = null;
    });
    return promise;
  }

  // Samtidige kald efter samme side deler ÉT løfte (ingen dobbeltberegning).
  function memo(key, compute) {
    const t = now();
    for (const [k, v] of sides) if (v.expiresAt <= t) sides.delete(k);
    const hit = sides.get(key);
    if (hit) return hit.promise;
    const promise = Promise.resolve().then(compute);
    sides.set(key, { promise, expiresAt: t + ttlMs });
    promise.catch(() => {
      // swallow-ok: kun cache-oprydning, samme som datasættet ovenfor.
      if (sides.get(key)?.promise === promise) sides.delete(key);
    });
    return promise;
  }

  async function getPreview(supabase, { to: requestedTo = null, step = 0 } = {}) {
    const [fromId, wageId] = await Promise.all([readLiveModelId(supabase), readWageModelId(supabase)]);
    const toId = requestedTo ?? defaultTargetModelId(fromId, modelIds);
    const fromModel = loadModel(fromId);
    const toModel = loadModel(toId);
    const wageModel = loadModel(wageId);

    // Alle sider i ét svar regnes på SAMME datasæt (nøglen bærer datasættets
    // tidsstempel), så trin 0 og trin 4 aldrig sammenlignes på tværs af en
    // gen-hentning. FØR-siden er fælles for alle trin og regnes kun én gang.
    const dataset = await getDataset(supabase);
    const base = `${dataset.loadedAt}|wage:${wageId}`;
    const beforeSide = () => memo(`${base}|before:${fromId}`,
      () => computeValueSide(dataset, fromModel, { wageModel, recompute, yieldEvery }));
    const afterSide = (s) => memo(`${base}|after:${toId}|step:${s}`,
      () => computeValueSide(dataset, toModel, { wageModel, phaseStep: s, recompute, yieldEvery }));

    const before = await beforeSide();
    const after = await afterSide(step);
    const first = step === 0 ? after : await afterSide(0);
    const last = step === VALUE_PREVIEW_MAX_STEP ? after : await afterSide(VALUE_PREVIEW_MAX_STEP);

    return {
      from: fromId,
      to: toId,
      step,
      steps: [...VALUE_PREVIEW_STEPS],
      stepSensitive: sidesDiffer(first, last),
      wageModel: wageId,
      modelIds: [...modelIds],
      seasonNumber: dataset.seasonNumber,
      computedAt: dataset.loadedAt,
      ...combineValuePreview(dataset, before, after),
    };
  }

  return {
    getPreview,
    clear() { datasetEntry = null; sides.clear(); },
  };
}
