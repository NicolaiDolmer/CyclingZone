#!/usr/bin/env node
// #7316 datareparation: genberegn den tabte hovedevne-fremgang fra kurve B-muren.
//
// Baggrund (docs/superpowers/specs/2026-10-29-7316-training-main-ability-rootcause.md):
// mens `development_curve_b` var taendt, fik en evne over sit bloede loft praecis 0
// fremgang. Programmets hovedevne ligger naesten altid taettest paa loftet, saa den
// stod stille, mens de andre evner steg. Scriptet finder de ramte traeningsticks og
// genberegner hovedevnens fremgang med S4-modellen: SAMME kode som flag off
// (`applyDailyTick` med `curveB: null`, dvs. `dailyAbilityDelta` uden kurven).
//
// Kreditten laegges paa fremdriftsbaren (`ability_progress`), ALDRIG som hele point.
// Motoren omsaetter baren til point i sit eget tempo, saa +1 pr. dato (#6210) og det
// haarde loft respekteres af den almindelige kode.
//
// Et ramt tick er: et managerhold (samme regel som motoren, isManagerTeamForDevelopment),
// en traeningsdag (intensitet ikke rest/race/unknown_pending, ikke loebsdag), hovedevnen
// bevaegede sig IKKE (progress foer = efter, ingen gain), og hovedevnen stod under
// rollens haarde loft (buildCapsForRider). Tidsvinduet er flagets on-periode.
//
// Review-fundene fra #7342 (rettet foer --apply):
//  1. Kreditten og apply-guarden foelger rytterens NUVAERENDE hold (riders.team_id), ikke
//     holdet paa tick-tidspunktet. En rytter der nu staar paa et AI-hold (eller intet hold)
//     springes over, og quiesce-tjekket i apply-SQL'en vogter det hold der faktisk traener ham.
//  2. Form og traethed foer ticket kommer fra datoens traeningsrapport: condition_before_date
//     naar den findes, ellers udledt af rapportlinjens form/fatigue/fatigue_delta (samme
//     formel som motoren). Mangler begge, springes ticket over. Aldrig et gaet 50/0.
//  3. Udviklingsscore B og catch-up via loeb laeses fra app_config for vinduet. Var et flag
//     on, koerer genberegningen med det; aendrede et flag sig i vinduet, eller mangler
//     dets params, blokeres --apply (modellen kan ikke gengives sikkert).
//  4. --apply blokeres naar tilbagespolingen afviger fra rapporternes gains_detail
//     (rewindMismatches > 0), fordi kreditten saa ville bygge paa forkerte evnevaerdier.
//
// Brug:
//   infisical run --env=prod -- node scripts/7316-repair-main-ability.mjs            (dry-run, default)
//   infisical run --env=prod -- node scripts/7316-repair-main-ability.mjs --apply --confirm-token=<hash> --training-quiesced
//   infisical run --env=prod -- node scripts/7316-repair-main-ability.mjs --verify                   (efter apply)
//   node scripts/7316-repair-main-ability.mjs --print-export-sql | --input=<fil>                    (uden egen DB-adgang)
//
// --dry-run er DEFAULT og skriver INTET til databasen. Den skriver en audit-fil (med
// navne og tal) uden for repoet, i balance-internals/7316/. --apply kraever baade flaget
// og en --confirm-token, der svarer til dry-runnets hash. Apply koerer én transaktion pr.
// hold via psql (SUPABASE_DB_URL) og gemmer foer-tilstanden i backup_7316_repair_ledger.
// Ledger-tabellen er ogsaa idempotens-vaernet: en (rytter, evne) krediteres hoejst én gang.
// Apply er ejer-gated ("atombombe"-reglen): ejeren ser dry-run-tallene live foerst.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { applyDailyTick } from "../backend/lib/dailyTraining.js";
import { TRAINING_FOCUSES } from "../backend/lib/training.js";
import { VISIBLE_ABILITIES } from "../backend/lib/abilityDerivation.js";
import { buildCapsForRider } from "../backend/lib/riderProgression.js";
import { ageForSeason } from "../backend/lib/riderSeasonAge.js";
import { conditionMultiplier, nextForm } from "../backend/lib/riderCondition.js";
import { riderLevelBand } from "../backend/lib/staffAbilityConstants.js";
import { raceDaySeedKey, resolveRaceDayBudgetDivisor } from "../backend/lib/trainingRaceDayTick.js";
import { isManagerTeamForDevelopment, ABILITY_CAP_PER_DATE_FLAG_KEY } from "../backend/lib/dailyTrainingEngine.js";
import { evaluateFlagStage } from "../backend/lib/featureStage.js";
import {
  DEVELOPMENT_SCORE_V2_FLAG_KEY, developmentScoreParamsFromEnv, developmentTickArgs,
} from "../backend/lib/developmentScoreWiring.js";
import { RACE_DAY_CATCHUP_FLAG_KEY, raceCatchUpParamsFromEnv } from "../backend/lib/raceCatchUpWiring.js";

// Flagets on-periode i prod (app_config.development_curve_b). Taendt 25/10 21:02 UTC
// (spec §1), slukket 29/10 14:12:32 UTC (app_config.updated_at, tilbagelaest 29/10).
export const DEFAULT_WINDOW = Object.freeze({
  from: "2026-10-25T21:02:00.000Z",
  to: "2026-10-29T14:12:32.629Z",
});

export const LEDGER_TABLE = "backup_7316_repair_ledger";
export const AUDIT_DIR = "C:/dev/CyclingZone-local/balance-internals/7316";

// Dage uden traeningspas: ingen hovedevne at genberegne.
const NON_TRAINING_INTENSITIES = new Set(["rest", "race", "unknown_pending"]);
const ABILITY_SET = new Set(VISIBLE_ABILITIES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Programmets hovedevne = foerste evne i fokus-listen (spec §2's mapping). */
export function mainAbilityForFocus(focus) {
  const list = TRAINING_FOCUSES[focus];
  return Array.isArray(list) && list.length ? list[0] : null;
}

/** Ligger ticket i flagets on-periode? Halvaabent interval [from, to). */
export function isTickInWindow(createdAt, window = DEFAULT_WINDOW) {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= Date.parse(window.from) && t < Date.parse(window.to);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// null/undefined/"" er IKKE 0 her: Number(null) === 0 ville tavst blive "form 0".
const finiteOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Fund 2: form og traethed FOER ticket, fra datoens traeningsrapport.
 * - Dato-afregningens sti skriver `condition_before_date` direkte: den bruges.
 * - Den gamle sti skriver kun tilstanden EFTER (form, fatigue) og fatigue_delta. Motoren
 *   regnede dér `fatigueFoer = fatigue - fatigue_delta` og `form = nextForm(formFoer,
 *   fatigue)`, og nextForm's skridt afhaenger kun af den nye traethed, saa formen foer er
 *   formen efter minus det skridt (klippet til 0..100).
 * - Mangler begge: null. Kalderen springer ticket over i stedet for at gaette.
 * @returns {{form:number,fatigue:number,source:string}|null}
 */
export function conditionForTick(tick) {
  const cbd = tick?.condition_before_date;
  const cbdForm = finiteOrNull(cbd?.form);
  const cbdFatigue = finiteOrNull(cbd?.fatigue);
  if (cbdForm != null && cbdFatigue != null) return { form: cbdForm, fatigue: cbdFatigue, source: "condition_before_date" };
  const formAfter = finiteOrNull(tick?.form);
  const fatigueAfter = finiteOrNull(tick?.fatigue);
  const fatigueDelta = finiteOrNull(tick?.fatigue_delta);
  if (formAfter == null || fatigueAfter == null || fatigueDelta == null) return null;
  const formStep = nextForm({ form: 50, fatigue: fatigueAfter }) - 50;
  return {
    form: Math.max(0, Math.min(100, formAfter - formStep)),
    fatigue: fatigueAfter - fatigueDelta,
    source: "report_after_minus_delta",
  };
}

// Fund 3: de flag der aendrer S4-modellens delta paa en traeningsdag.
export const WINDOW_MODEL_FLAG_KEYS = Object.freeze([
  DEVELOPMENT_SCORE_V2_FLAG_KEY, RACE_DAY_CATCHUP_FLAG_KEY, ABILITY_CAP_PER_DATE_FLAG_KEY,
]);

// En traeningskoersel laeser flaget foer den skriver sine ticks. Et flag der aendrede sig
// mindre end dette foer det foerste tick, kan derfor stadig have styret det tick.
export const FLAG_READ_MARGIN_MINUTES = 60;

/**
 * Et flags tilstand for vinduets ticks ud fra app_config-raekken (value, updated_at).
 * updated_at er SIDSTE aendring, saa vaerdien er kendt for alle ticks efter den. "off"/"on"
 * kun naar aendringen ligger mindst FLAG_READ_MARGIN_MINUTES foer det foerste tick i
 * vinduet (`firstTickAt`, default vinduets start); ellers "changed" (vaerdien ved de
 * tidlige ticks er ukendt). Manglende raekke = off, som motorens readFlagStage.
 */
export function flagStateForWindow(row, window = DEFAULT_WINDOW, firstTickAt = null) {
  if (!row) return "off";
  const changedAt = Date.parse(row.updated_at);
  const firstTick = Date.parse(firstTickAt ?? window.from);
  const knownFrom = Math.max(Date.parse(window.from), Number.isFinite(firstTick) ? firstTick : -Infinity)
    - FLAG_READ_MARGIN_MINUTES * 60_000;
  if (!Number.isFinite(changedAt) || changedAt >= knownFrom) return "changed";
  return evaluateFlagStage(row.value) ? "on" : "off";
}

/** Foerste tick i vinduet (ISO) eller null. */
export function firstTickInWindow(ticks, window = DEFAULT_WINDOW) {
  let first = null;
  for (const t of ticks ?? []) {
    if (!isTickInWindow(t.created_at, window)) continue;
    if (first == null || Date.parse(t.created_at) < Date.parse(first)) first = t.created_at;
  }
  return first;
}

/**
 * PURE: den udviklingsmodel prod brugte i vinduet (fund 3), samme regler som motorens
 * loadDevelopmentScoreB/loadRaceCatchUp: flag on + gyldige params + dato-loftet on.
 * `issues` ikke-tom = modellen kan ikke gengives sikkert, og --apply blokeres.
 * @param {{rows: Array<{key:string,value:any,updated_at:string}>|null, window?:object, env?:object, firstTickAt?:string|null}} p
 */
export function resolveDevelopmentModel({ rows, window = DEFAULT_WINDOW, env = process.env, firstTickAt = null }) {
  if (!Array.isArray(rows)) {
    return { developmentScoreB: null, raceCatchUp: null, states: {}, issues: ["app_config flags not read"] };
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const states = Object.fromEntries(WINDOW_MODEL_FLAG_KEYS.map((k) => [k, flagStateForWindow(byKey.get(k), window, firstTickAt)]));
  const issues = [];
  const capOn = states[ABILITY_CAP_PER_DATE_FLAG_KEY];
  const resolve = (key, fromEnv, envName) => {
    if (states[key] === "changed") { issues.push(`${key} changed too close to or after the first tick in the window`); return null; }
    if (states[key] !== "on") return null;
    if (capOn === "changed") { issues.push(`${ABILITY_CAP_PER_DATE_FLAG_KEY} changed during the window while ${key} is on`); return null; }
    if (capOn !== "on") return null; // motoren koerer dagens model uden dato-loftet
    const params = fromEnv(env);
    if (!params) issues.push(`${key} was on, but ${envName} is missing or invalid here`);
    return params;
  };
  const developmentScoreB = resolve(DEVELOPMENT_SCORE_V2_FLAG_KEY, developmentScoreParamsFromEnv, "DEVELOPMENT_SCORE_V2_PARAMS");
  const raceCatchUp = resolve(RACE_DAY_CATCHUP_FLAG_KEY, raceCatchUpParamsFromEnv, "RACE_DAY_CATCHUP_PARAMS");
  return { developmentScoreB, raceCatchUp, states, issues };
}

/**
 * Fund 4 (+ de eksisterende vaern): maa planen anvendes? Kaster med en forklaring,
 * og intet er skrevet, naar svaret er nej.
 */
export function assertApplyAllowed(plan, args) {
  if (!args.confirmToken || args.confirmToken !== plan.hash) {
    throw new Error(`--apply requires --confirm-token matching the dry-run hash (expected ${plan.hash}). Nothing written.`);
  }
  if (!args.trainingQuiesced) {
    throw new Error("--apply requires --training-quiesced: confirm no training sweep or Train now is running (a concurrent commit overwrites ability_progress). Nothing written.");
  }
  if (!(plan.rewindMismatches === 0)) {
    throw new Error(`--apply blocked: the rewind disagrees with the training reports (${plan.rewindMismatches} mismatches). Credits would rest on wrong ability values. Nothing written.`);
  }
  const issues = plan.model?.issues;
  if (!Array.isArray(issues)) throw new Error("--apply blocked: the window's development model was not resolved. Nothing written.");
  if (issues.length) throw new Error(`--apply blocked: the window's development model cannot be reproduced (${issues.join("; ")}). Nothing written.`);
}

function tickOrder(a, b) {
  const t = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (t !== 0) return t;
  return num(a.game_day) - num(b.game_day);
}

/**
 * Evnerne FOER hvert tick: nuvaerende vaerdi minus alle gevinster fra ticket selv og
 * senere ticks. Returnerer Map(tick -> abilities) for de givne ticks (én rytter).
 */
export function rewindAbilities(nowAbilities, riderTicks) {
  const sorted = [...riderTicks].sort(tickOrder);
  const acc = { ...nowAbilities };
  const out = new Map();
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const tick = sorted[i];
    for (const [ability, n] of Object.entries(tick.gains ?? {})) {
      if (ABILITY_SET.has(ability) && num(n) > 0) acc[ability] = num(acc[ability]) - num(n);
    }
    out.set(tick, { ...acc });
  }
  return out;
}

/**
 * S4-modellens fremgang til hovedevnen for ét tick. Kalder motorens egen
 * applyDailyTick med curveB = null, tom bar (progress 0) og intet dagsloft, saa
 * resultatet er dagens raa delta for evnen (hele point + rest paa baren).
 */
export function s4MainAbilityDelta({
  tick, rider, abilitiesAtTick, caps, age, seasonNumber, mainAbility, staffCtx, condition, model = null,
}) {
  const gameDay = tick.game_day == null ? null : Number(tick.game_day);
  const useRaceDayKey = Number.isFinite(gameDay);
  const tickSeedKey = useRaceDayKey ? raceDaySeedKey({ seasonId: tick.season_id, gameDay }) : null;
  if (!condition) throw new Error("s4MainAbilityDelta: condition is required (no 50/0 fallback)");
  const tickArgs = {
    riderId: tick.rider_id,
    dateStr: tick.tick_date,
    age,
    abilities: abilitiesAtTick,
    caps,
    progress: {},
    program: { focus: tick.focus, intensity: tick.intensity },
    conditionMult: conditionMultiplier(condition),
    potentiale: rider.potentiale,
    staff: staffCtx?.staff ?? null,
    facilityTier: staffCtx?.facilityTier ?? null,
    riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
    primaryType: rider.primary_type,
    secondaryType: rider.secondary_type,
    tickSeedKey,
    budgetDivisor: useRaceDayKey ? resolveRaceDayBudgetDivisor({ seasonNumber }) : null,
    curveB: null,
  };
  // Fund 3: samme udviklings-argumenter som motorens traeningsdag (racedToday false).
  // Tomt objekt naar begge er null = bit-identisk med S4-modellen.
  const devArgs = developmentTickArgs({
    developmentScoreB: model?.developmentScoreB ?? null,
    raceCatchUp: model?.raceCatchUp ?? null,
    dayKey: tickSeedKey ?? tick.tick_date,
    tickArgs,
  });
  const result = applyDailyTick({ ...tickArgs, ...devArgs });
  return num(result.gains?.[mainAbility]) + num(result.progress?.[mainAbility]);
}

function bump(map, key, n = 1) {
  map[key] = (map[key] ?? 0) + n;
}

/**
 * PURE: byg reparationsplanen. Ingen DB, ingen sideeffekter.
 * @param {object} input
 * @param {object[]} input.ticks  alle training_rider_ticks fra vinduets start og frem (ogsaa efter vinduet, til tilbagespoling)
 * @param {Map} input.ridersById   rider_id -> riders-raekke
 * @param {Map} input.derivedById  rider_id -> rider_derived_abilities-raekke (nu)
 * @param {Map} input.teamsById    team_id -> teams-raekke (user_id, is_ai, is_bank, is_test_account)
 * @param {Map} input.seasonNumberById season_id -> saesonnummer
 * @param {Map} [input.staffByTeam] team_id -> { facilityTier, staff }
 * @param {Set} [input.applied]    `${rider_id}:${ability}` der allerede er krediteret (ledger)
 * @param {{from:string,to:string}} [input.window]
 * @param {object} [input.model]   resolveDevelopmentModel(...) for vinduet (fund 3). Udeladt =
 *   S4-modellen uden udviklingsscore, men --apply kraever en loest model.
 */
export function computeRepairPlan({
  ticks, ridersById, derivedById, teamsById, seasonNumberById,
  staffByTeam = new Map(), applied = new Set(), window = DEFAULT_WINDOW, model = null,
}) {
  const skips = {};
  const byRider = new Map();
  for (const tick of ticks) {
    if (!byRider.has(tick.rider_id)) byRider.set(tick.rider_id, []);
    byRider.get(tick.rider_id).push(tick);
  }

  const pairs = new Map(); // `${rider}:${ability}` -> akkumuleret kredit
  let rewindChecked = 0;
  let rewindMismatches = 0;
  let windowTicks = 0;

  for (const [riderId, riderTicks] of byRider) {
    const inWindow = riderTicks.filter((t) => isTickInWindow(t.created_at, window));
    if (!inWindow.length) continue;
    windowTicks += inWindow.length;
    const rider = ridersById.get(riderId);
    const derived = derivedById.get(riderId);
    if (!rider || !derived) { bump(skips, "missing_rider_row", inWindow.length); continue; }
    if (rider.is_retired === true) { bump(skips, "retired", inWindow.length); continue; }
    // Fund 1: kreditten lander hos rytterens NUVAERENDE hold. Staar han nu paa et AI-hold,
    // en bank, en testkonto eller intet hold, krediteres intet.
    const currentTeamId = rider.team_id ?? null;
    if (!currentTeamId || !isManagerTeamForDevelopment(teamsById.get(currentTeamId))) {
      bump(skips, "rider_not_on_manager_team_now", inWindow.length); continue;
    }

    const nowAbilities = {};
    for (const ability of VISIBLE_ABILITIES) {
      if (derived[ability] != null) nowAbilities[ability] = Number(derived[ability]);
    }
    const atTick = rewindAbilities(nowAbilities, riderTicks);

    for (const tick of inWindow) {
      // Eksport-stien (MCP_EXPORT_SQL) spoler tilbage i SQL og leverer evnen ved ticket direkte.
      const abilitiesAtTick = tick.abilities_at_tick
        ? { ...atTick.get(tick), ...tick.abilities_at_tick } : atTick.get(tick);
      // Selvkontrol af tilbagespolingen: rapportens gains_detail.from er sandheden.
      for (const [ability, detail] of Object.entries(tick.gains_detail ?? {})) {
        if (!ABILITY_SET.has(ability) || detail?.from == null) continue;
        rewindChecked += 1;
        if (num(detail.from) !== num(abilitiesAtTick[ability])) rewindMismatches += 1;
      }

      if (!isManagerTeamForDevelopment(teamsById.get(tick.team_id))) { bump(skips, "not_manager_team"); continue; }
      if (NON_TRAINING_INTENSITIES.has(tick.intensity) || !tick.intensity || tick.race_day === true) {
        bump(skips, "not_training_day"); continue;
      }
      const mainAbility = mainAbilityForFocus(tick.focus);
      if (!mainAbility) { bump(skips, "unknown_focus"); continue; }
      const moved = num(tick.progress_after?.[mainAbility]) !== num(tick.progress_before?.[mainAbility])
        || num(tick.gains?.[mainAbility]) > 0;
      if (moved) { bump(skips, "main_ability_moved"); continue; }

      const seasonNumber = seasonNumberById.get(tick.season_id);
      const age = ageForSeason(rider.birthdate, seasonNumber);
      if (age == null) { bump(skips, "no_age"); continue; }
      const caps = buildCapsForRider(abilitiesAtTick, { ...rider, age }, rider.primary_type, rider.secondary_type);
      const current = num(abilitiesAtTick[mainAbility]);
      const hardCap = Math.min(99, num(caps?.[mainAbility] ?? 0));
      if (!(current < hardCap)) { bump(skips, "at_hard_cap"); continue; }

      const condition = conditionForTick(tick);
      if (!condition) { bump(skips, "no_condition_in_report"); continue; }

      const delta = s4MainAbilityDelta({
        tick, rider, abilitiesAtTick, caps, age, seasonNumber, mainAbility, condition, model,
        // Traener og facilitet er holdets paa tick-tidspunktet: dét hold traenede ham.
        staffCtx: staffByTeam.get(tick.team_id),
      });
      if (!(delta > 0)) { bump(skips, "zero_s4_delta"); continue; }

      const key = `${riderId}:${mainAbility}`;
      // Fund 1: transaktionen (og dens quiesce-vaern) ejes af det hold der traener ham NU.
      const pair = pairs.get(key) ?? { riderId, ability: mainAbility, teamId: currentTeamId, ticks: 0, rawCredit: 0 };
      pair.ticks += 1;
      pair.rawCredit += delta;
      pairs.set(key, pair);
    }
  }

  const entries = [];
  for (const [key, pair] of pairs) {
    if (applied.has(key)) { bump(skips, "already_applied_pair"); continue; }
    const derived = derivedById.get(pair.riderId);
    const rider = ridersById.get(pair.riderId);
    const abilityNow = num(derived[pair.ability]);
    const progressNow = num(derived.ability_progress?.[pair.ability]);
    const capNow = Math.min(99, num(derived.ability_caps?.[pair.ability] ?? 99));
    // Haardt loft: evne + bar + kredit maa aldrig overstige loftet.
    const headroom = Math.max(0, capNow - abilityNow - progressNow);
    const credit = Math.min(pair.rawCredit, headroom);
    if (!(credit > 0)) { bump(skips, "no_headroom_now"); continue; }
    entries.push({
      riderId: pair.riderId,
      teamId: pair.teamId,
      ability: pair.ability,
      ticks: pair.ticks,
      rawCredit: round9(pair.rawCredit),
      credit: round9(credit),
      clamped: credit < pair.rawCredit,
      progressNow,
      extraPoints: Math.floor(progressNow + credit) - Math.floor(progressNow),
      name: `${rider?.firstname ?? ""} ${rider?.lastname ?? ""}`.trim(),
    });
  }
  entries.sort((a, b) => (a.riderId === b.riderId ? a.ability.localeCompare(b.ability) : a.riderId.localeCompare(b.riderId)));
  return { entries, skips, windowTicks, rewindChecked, rewindMismatches, model, hash: planHash(entries, window) };
}

function round9(x) {
  return Math.round(x * 1e9) / 1e9;
}

/** Deterministisk hash af planen (rytter, evne, raa kredit) + vinduet. */
export function planHash(entries, window = DEFAULT_WINDOW) {
  const body = JSON.stringify({
    window,
    entries: entries.map((e) => [e.riderId, e.ability, e.rawCredit.toFixed(9)]),
  });
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function summarizePlan(plan) {
  const teams = new Set(plan.entries.map((e) => e.teamId));
  const riders = new Set(plan.entries.map((e) => e.riderId));
  const distribution = { 0: 0, 1: 0, 2: 0, "3+": 0 };
  for (const e of plan.entries) {
    const k = e.extraPoints >= 3 ? "3+" : String(e.extraPoints);
    distribution[k] += 1;
  }
  return {
    teams: teams.size,
    riders: riders.size,
    pairs: plan.entries.length,
    ticks: plan.entries.reduce((s, e) => s + e.ticks, 0),
    creditSum: round9(plan.entries.reduce((s, e) => s + e.credit, 0)),
    rawCreditSum: round9(plan.entries.reduce((s, e) => s + e.rawCredit, 0)),
    clampedPairs: plan.entries.filter((e) => e.clamped).length,
    distribution,
    top10: [...plan.entries].sort((a, b) => b.credit - a.credit).slice(0, 10),
  };
}

const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * SQL til ét holds transaktion (koeres med `psql -1 -v ON_ERROR_STOP=1`).
 * Kreditten klippes IGEN mod live-tilstanden i selve UPDATE'en, saa et tick der er
 * koert siden dry-runnet aldrig kan skubbe evnen over det haarde loft.
 *
 * Samtidige traeningsskrivere (Codex P1): motorens commit erstatter HELE
 * `ability_progress` med en patch beregnet foer vores UPDATE, og FOR UPDATE stopper
 * det ikke. Derfor (1) kraever apply `--training-quiesced` (ejeren bekraefter at hverken
 * sweep eller "Train now" koerer), (2) afbryder transaktionen selv, hvis holdet har haft
 * traeningsaktivitet de sidste QUIESCE_MINUTES minutter, og (3) gemmer ledgeren evne og
 * bar foer, saa `--verify` bagefter kan finde en kredit der alligevel blev overskrevet.
 */
export const QUIESCE_MINUTES = 15;

export function buildTeamApplySql({ teamId, entries, hash }) {
  if (!UUID_RE.test(teamId)) throw new Error(`invalid team id: ${teamId}`);
  if (!/^[0-9a-f]{16}$/.test(hash)) throw new Error("invalid plan hash");
  const team = sqlLit(teamId);
  const lines = [
    "SET lock_timeout = '5s';",
    "DO $$ BEGIN",
    `  IF EXISTS (SELECT 1 FROM public.training_rider_ticks WHERE team_id = ${team} AND created_at > now() - interval '${QUIESCE_MINUTES} minutes')`,
    `    OR EXISTS (SELECT 1 FROM public.training_date_work WHERE team_id = ${team} AND updated_at > now() - interval '${QUIESCE_MINUTES} minutes')`,
    `    OR EXISTS (SELECT 1 FROM public.training_day_runs WHERE team_id = ${team} AND report->>'pending' = 'true') THEN`,
    "    RAISE EXCEPTION '7316 repair: recent training activity on team, aborting (nothing written)';",
    "  END IF;",
    "END $$;",
    `CREATE TABLE IF NOT EXISTS public.${LEDGER_TABLE} (`,
    "  rider_id uuid NOT NULL,",
    "  ability text NOT NULL,",
    "  team_id uuid NOT NULL,",
    "  raw_credit numeric NOT NULL,",
    "  applied_credit numeric NOT NULL,",
    "  ability_before numeric,",
    "  progress_before jsonb,",
    "  plan_hash text NOT NULL,",
    "  applied_at timestamptz NOT NULL DEFAULT now(),",
    "  PRIMARY KEY (rider_id, ability)",
    ");",
    // Backend-only kontrakt: kun service_role laeser ledgeren (dry-run/--verify).
    `ALTER TABLE public.${LEDGER_TABLE} ENABLE ROW LEVEL SECURITY;`,
    `REVOKE ALL ON public.${LEDGER_TABLE} FROM anon, authenticated;`,
    `GRANT SELECT ON public.${LEDGER_TABLE} TO service_role;`,
  ];
  for (const e of entries) {
    if (e.teamId !== teamId) throw new Error("entry belongs to another team");
    if (!UUID_RE.test(e.riderId)) throw new Error(`invalid rider id: ${e.riderId}`);
    if (!ABILITY_SET.has(e.ability)) throw new Error(`invalid ability: ${e.ability}`);
    if (!(Number.isFinite(e.rawCredit) && e.rawCredit > 0)) throw new Error("invalid credit");
    const ab = e.ability; // whitelisted ovenfor: sikker som identifikator og noegle
    const raw = e.rawCredit.toFixed(9);
    lines.push(
      `WITH src AS (`,
      `  SELECT r.rider_id, r.ability_progress, r."${ab}" AS ability_before,`,
      `    GREATEST(0, LEAST(${raw}::numeric, LEAST(99, COALESCE((r.ability_caps->>'${ab}')::numeric, 99))`,
      `      - COALESCE(r."${ab}", 0) - COALESCE((r.ability_progress->>'${ab}')::numeric, 0))) AS credit`,
      `  FROM public.rider_derived_abilities r WHERE r.rider_id = ${sqlLit(e.riderId)} FOR UPDATE`,
      `), ins AS (`,
      `  INSERT INTO public.${LEDGER_TABLE} (rider_id, ability, team_id, raw_credit, applied_credit, ability_before, progress_before, plan_hash)`,
      `  SELECT rider_id, '${ab}', ${team}, ${raw}, credit, ability_before, ability_progress, ${sqlLit(hash)} FROM src`,
      `  ON CONFLICT (rider_id, ability) DO NOTHING`,
      `  RETURNING rider_id, applied_credit`,
      `)`,
      `UPDATE public.rider_derived_abilities r`,
      `  SET ability_progress = jsonb_set(COALESCE(r.ability_progress, '{}'::jsonb), '{${ab}}',`,
      `    to_jsonb(COALESCE((r.ability_progress->>'${ab}')::numeric, 0) + ins.applied_credit), true)`,
      `  FROM ins WHERE r.rider_id = ins.rider_id AND ins.applied_credit > 0;`,
    );
  }
  lines.push("NOTIFY pgrst, 'reload schema';");
  return `${lines.join("\n")}\n`;
}

// ─────────────── Eksport-stien: read-only SELECT uden scriptets egen DB-adgang ───────────────
// Naar SUPABASE_URL/SERVICE_KEY ikke findes (ingen infisical-session), koeres denne ene
// SELECT (fx via Supabase MCP execute_sql), resultatets `export`-JSON gemmes i en fil, og
// scriptet koeres med --input=<fil>. SQL'en laver de billige filtre og tilbagespolingen af
// hovedevnen; S4-modellen koeres stadig af motorens egen kode her i scriptet. Kun
// managerhold eksporteres, saa "not_manager_team" taelles ikke i denne sti.
export function buildExportSql(window = DEFAULT_WINDOW) {
  const focusCase = Object.keys(TRAINING_FOCUSES)
    .map((f) => `when ${sqlLit(f)} then ${sqlLit(mainAbilityForFocus(f))}`).join(" ");
  const excluded = [...NON_TRAINING_INTENSITIES].map(sqlLit).join(", ");
  return `with win as (select ${sqlLit(window.from)}::timestamptz f, ${sqlLit(window.to)}::timestamptz t),
mgr as (select id, name, user_id, is_ai, is_bank, is_test_account from teams
  where user_id is not null and not coalesce(is_ai,false) and not coalesce(is_bank,false) and not coalesce(is_test_account,false)),
c as (select k.rider_id, k.season_id, k.game_day, k.tick_date, k.team_id, k.created_at,
    k.report->>'focus' focus, k.report->>'intensity' intensity, coalesce((k.report->>'race_day')::boolean,false) race_day,
    case k.report->>'focus' ${focusCase} end main, k.report->'condition_before_date' cbd,
    k.report->'form' rform, k.report->'fatigue' rfatigue, k.report->'fatigue_delta' rfd,
    k.report->'progress_before' pb, k.report->'progress_after' pa, k.report->'gains' g
  from training_rider_ticks k, win where k.created_at >= win.f and k.created_at < win.t and k.team_id in (select id from mgr)),
cand as (select * from c where intensity is not null and intensity not in (${excluded}) and not race_day and main is not null
  and coalesce((pa->>main)::numeric,0) = coalesce((pb->>main)::numeric,0) and coalesce((g->>main)::numeric,0) = 0),
v as (select cand.*, (to_jsonb(rda)->>cand.main)::numeric - coalesce((select sum((k2.report->'gains'->>cand.main)::numeric)
    from training_rider_ticks k2, win where k2.rider_id = cand.rider_id and k2.created_at >= win.f
    and (k2.created_at, coalesce(k2.game_day,0)) >= (cand.created_at, coalesce(cand.game_day,0))),0) at_tick
  from cand join rider_derived_abilities rda on rda.rider_id = cand.rider_id),
mains as (select rider_id, array_agg(distinct main) m from cand group by rider_id),
tm as (select distinct team_id from cand),
-- Fund 1: rytterens NUVAERENDE hold (riders.team_id) skal ogsaa med; kun managerhold eksporteres.
cur as (select distinct r.team_id from riders r join mains on mains.rider_id = r.id where r.team_id is not null)
select json_build_object(
  'window', json_build_object('from', ${sqlLit(window.from)}, 'to', ${sqlLit(window.to)}),
  -- Fund 2: condition_before_date raa (null naar den mangler) + rapportlinjens form/fatigue/fatigue_delta.
  'ticks', (select json_agg(json_build_object('rider_id', rider_id, 'season_id', season_id, 'game_day', game_day,
      'tick_date', tick_date, 'team_id', team_id, 'created_at', created_at, 'focus', focus, 'intensity', intensity,
      'race_day', race_day, 'condition_before_date', cbd, 'form', rform, 'fatigue', rfatigue, 'fatigue_delta', rfd,
      'abilities_at_tick', json_build_object(main, at_tick))) from v),
  'riders', (select json_agg(json_build_object('id', r.id, 'firstname', r.firstname, 'lastname', r.lastname,
      'birthdate', r.birthdate, 'potentiale', r.potentiale, 'primary_type', r.primary_type, 'secondary_type', r.secondary_type,
      'is_academy', r.is_academy, 'is_retired', r.is_retired, 'team_id', r.team_id)) from riders r join mains on mains.rider_id = r.id),
  -- Fund 3: flagene der aendrer modellen, med updated_at saa vinduets tilstand kan afgoeres.
  'app_config', (select coalesce(json_agg(json_build_object('key', key, 'value', value, 'updated_at', updated_at)), '[]')
    from app_config where key in (${WINDOW_MODEL_FLAG_KEYS.map(sqlLit).join(", ")})),
  'derived', (select json_agg(jsonb_build_object('rider_id', d.rider_id)
      || (select jsonb_object_agg(a, to_jsonb(d)->a) from unnest(mains.m) a)
      || jsonb_build_object('ability_caps', (select jsonb_object_agg(a, d.ability_caps->a) from unnest(mains.m) a),
        'ability_progress', (select jsonb_object_agg(a, coalesce(d.ability_progress->a, '0'::jsonb)) from unnest(mains.m) a)))
    from rider_derived_abilities d join mains on mains.rider_id = d.rider_id),
  'teams', (select json_agg(row_to_json(mgr)) from mgr where id in (select team_id from tm union select team_id from cur)),
  'seasons', (select json_agg(json_build_object('id', id, 'number', number)) from seasons where id in (select season_id from cand)),
  'team_facilities', (select coalesce(json_agg(json_build_object('team_id', team_id, 'track', track, 'tier', tier)), '[]')
    from team_facilities where track = 'training' and team_id in (select team_id from tm)),
  'team_staff', (select coalesce(json_agg(json_build_object('id', id, 'team_id', team_id, 'name', name, 'role', role, 'tier', tier, 'status', status)), '[]')
    from team_staff where role = 'training' and status = 'active' and team_id in (select team_id from tm)),
  'staff_derived_abilities', (select coalesce(json_agg(json_build_object('staff_id', staff_id, 'overall', overall, 'dimensions', dimensions, 'levels', levels)), '[]')
    from staff_derived_abilities where staff_id in (select id from team_staff where role = 'training' and status = 'active' and team_id in (select team_id from tm))),
  -- Ledgeren findes foerst efter foerste apply. query_to_xml koerer kun naar tabellen findes,
  -- saa SELECT'en virker baade foer og efter.
  'applied', case when to_regclass('public.${LEDGER_TABLE}') is null then '[]'::json else (
    select coalesce(json_agg(json_build_object('rider_id', (xpath('/row/rider_id/text()', x))[1]::text,
      'ability', (xpath('/row/ability/text()', x))[1]::text)), '[]')
    from unnest(xpath('/table/row', query_to_xml('select rider_id, ability from public.${LEDGER_TABLE}', false, false, ''))) x) end
) as export;`;
}

/** Minimal laese-stub over eksporterede raekker, saa motorens egen loadTrainingStaffContext kan genbruges. */
export function rowsClient(tables) {
  return {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(col, val) { filters.push((r) => r[col] === val); return query; },
        in(col, vals) { const s = new Set(vals); filters.push((r) => s.has(r[col])); return query; },
        then(resolve, reject) {
          return Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null })
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
}

/**
 * Laes eksport-filen: enten raa JSON (`[{export}]`, `{export}` eller selve objektet) eller
 * Supabase MCP's gemte svar, hvor raekkerne ligger som tekst i `result` mellem to
 * untrusted-data-markoerer. Indholdet behandles som data, aldrig som instruktioner.
 */
export function parseExportFile(text) {
  let raw = JSON.parse(text);
  if (raw && typeof raw.result === "string") {
    const m = raw.result.match(/<untrusted-data-([^>]+)>\s*([[{][\s\S]*?)\s*<\/untrusted-data-\1>/);
    if (!m) throw new Error("export file: no data block found");
    raw = JSON.parse(m[2]);
  }
  const exported = Array.isArray(raw) ? (raw[0]?.export ?? raw[0]) : (raw.export ?? raw);
  if (!exported || !Array.isArray(exported.ticks)) throw new Error("export file: missing ticks");
  return exported;
}

/** Byg plan-input fra eksport-JSON'en (--input). */
export async function planInputFromExport(exported) {
  const { loadTrainingStaffContext } = await import("../backend/lib/trainingStaffContext.js");
  const client = rowsClient(exported);
  const teams = exported.teams ?? [];
  const staffByTeam = new Map();
  for (const team of teams) staffByTeam.set(team.id, await loadTrainingStaffContext(client, team.id));
  const window = exported.window ?? DEFAULT_WINDOW;
  return {
    ticks: exported.ticks ?? [],
    ridersById: new Map((exported.riders ?? []).map((r) => [r.id, r])),
    derivedById: new Map((exported.derived ?? []).map((d) => [d.rider_id, d])),
    teamsById: new Map(teams.map((t) => [t.id, t])),
    seasonNumberById: new Map((exported.seasons ?? []).map((s) => [s.id, Number(s.number)])),
    staffByTeam,
    applied: new Set((exported.applied ?? []).map((a) => `${a.rider_id}:${a.ability}`)),
    window,
    // En aeldre eksport uden app_config giver en model med issues (aldrig et gaet "off").
    model: resolveDevelopmentModel({
      rows: Array.isArray(exported.app_config) ? exported.app_config : null, window,
      firstTickAt: firstTickInWindow(exported.ticks, window),
    }),
  };
}

// ───────────────────────────── DB-laesning (kun SELECT) ─────────────────────────────

const PAGE = 1000;
const TICK_SELECT = [
  "rider_id", "season_id", "game_day", "tick_date", "team_id", "created_at",
  "focus:report->>focus", "intensity:report->>intensity", "race_day:report->race_day",
  "progress_before:report->progress_before", "progress_after:report->progress_after",
  "gains:report->gains", "gains_detail:report->gains_detail",
  "condition_before_date:report->condition_before_date",
  // Fund 2: rapportlinjens tilstand efter ticket + traethedens skridt.
  "form:report->form", "fatigue:report->fatigue", "fatigue_delta:report->fatigue_delta",
].join(", ");

async function selectAll(build, label) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function selectIn(supabase, table, columns, key, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase.from(table).select(columns).in(key, chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

const isMissingTable = (error) => error?.code === "PGRST205" || error?.code === "42P01";

/** Hele ledgeren, pagineret i stabil orden. Manglende tabel = intet krediteret endnu. */
export async function loadLedgerRows(supabase, columns = "rider_id, ability") {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from(LEDGER_TABLE).select(columns)
      .order("rider_id").order("ability").range(offset, offset + PAGE - 1);
    if (error) {
      if (isMissingTable(error) && offset === 0) return [];
      throw new Error(`${LEDGER_TABLE}: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function loadApplied(supabase) {
  return new Set((await loadLedgerRows(supabase)).map((r) => `${r.rider_id}:${r.ability}`));
}

async function tickCountSince(supabase, from) {
  const { count, error } = await supabase.from("training_rider_ticks")
    .select("rider_id", { count: "exact", head: true }).gte("created_at", from);
  if (error) throw new Error(`training_rider_ticks count: ${error.message}`);
  return count;
}

const SNAPSHOT_ATTEMPTS = 3;

export async function loadPlanInput(supabase, window = DEFAULT_WINDOW) {
  // Konsistent snapshot (Codex P2): tilbagespolingen kraever at evnerne "nu" kun
  // indeholder gevinster fra de ticks vi har laest. Taellingen af ticks tages foer og
  // efter evne-laesningen; et tick committet midt i laesningen giver et nyt forsoeg.
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    const before = await tickCountSince(supabase, window.from);
    const input = await loadPlanInputOnce(supabase, window);
    const after = await tickCountSince(supabase, window.from);
    if (before === after && after === input.ticks.length) return input;
    console.warn(`  training ticks changed during read (attempt ${attempt}), retrying`);
  }
  throw new Error("training is writing ticks right now; run the dry-run outside the training sweep");
}

const TICK_RIDER_CHUNK = 100;
const TICK_READ_CONCURRENCY = 4;

/**
 * Alle ticks fra `from` og frem. training_rider_ticks har intet index paa created_at, saa
 * offset-paginering over hele tabellen sorterer det hele igen pr. side (malt 29-30/10: ca.
 * 25 min pr. laesning, og saa naar en "Train now" altid at aendre taellingen undervejs).
 * I stedet laeses der i rytter-bidder via primaernoeglen (rider_id, season_id, game_day).
 * Raekkefoelgen er ligegyldig: tilbagespolingen sorterer selv pr. rytter.
 */
async function loadTicksSince(supabase, from) {
  const riderIds = (await selectAll(() => supabase.from("riders").select("id").order("id"), "riders (ids)")).map((r) => r.id);
  const chunks = [];
  for (let i = 0; i < riderIds.length; i += TICK_RIDER_CHUNK) chunks.push(riderIds.slice(i, i + TICK_RIDER_CHUNK));
  const ticks = [];
  for (let i = 0; i < chunks.length; i += TICK_READ_CONCURRENCY) {
    const batch = await Promise.all(chunks.slice(i, i + TICK_READ_CONCURRENCY).map((chunk) => selectAll(
      () => supabase.from("training_rider_ticks").select(TICK_SELECT)
        .in("rider_id", chunk).gte("created_at", from)
        .order("rider_id").order("season_id").order("game_day"),
      "training_rider_ticks",
    )));
    for (const rows of batch) ticks.push(...rows);
  }
  return ticks;
}

async function loadPlanInputOnce(supabase, window) {
  const ticks = await loadTicksSince(supabase, window.from);
  const riderIds = [...new Set(ticks.map((t) => t.rider_id))];
  const tickTeamIds = [...new Set(ticks.map((t) => t.team_id).filter(Boolean))];
  const seasonIds = [...new Set(ticks.map((t) => t.season_id).filter(Boolean))];
  const [riders, derived, seasons, applied, flagRows] = await Promise.all([
    selectIn(supabase, "riders", "id, firstname, lastname, birthdate, potentiale, primary_type, secondary_type, is_academy, is_retired, team_id", "id", riderIds),
    selectIn(supabase, "rider_derived_abilities", `rider_id, ${VISIBLE_ABILITIES.join(", ")}, ability_caps, ability_progress`, "rider_id", riderIds),
    selectIn(supabase, "seasons", "id, number", "id", seasonIds),
    loadApplied(supabase),
    selectIn(supabase, "app_config", "key, value, updated_at", "key", [...WINDOW_MODEL_FLAG_KEYS]),
  ]);
  // Fund 1: baade holdene paa tick-tidspunktet og rytternes nuvaerende hold.
  const teamIds = [...new Set([...tickTeamIds, ...riders.map((r) => r.team_id).filter(Boolean)])];
  const teams = await selectIn(supabase, "teams", "id, name, user_id, is_ai, is_bank, is_test_account", "id", teamIds);
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const { loadTrainingStaffContext } = await import("../backend/lib/trainingStaffContext.js");
  const staffByTeam = new Map();
  const tickTeams = new Set(tickTeamIds);
  for (const team of teams) {
    // Traener/facilitet bruges kun for holdet der traenede ham paa tick-tidspunktet.
    if (!tickTeams.has(team.id) || !isManagerTeamForDevelopment(team)) continue;
    staffByTeam.set(team.id, await loadTrainingStaffContext(supabase, team.id));
  }
  return {
    ticks,
    ridersById: new Map(riders.map((r) => [r.id, r])),
    derivedById: new Map(derived.map((d) => [d.rider_id, d])),
    teamsById,
    seasonNumberById: new Map(seasons.map((s) => [s.id, Number(s.number)])),
    staffByTeam,
    applied,
    window,
    model: resolveDevelopmentModel({ rows: flagRows, window, firstTickAt: firstTickInWindow(ticks, window) }),
  };
}

// ───────────────────────────── Audit + CLI ─────────────────────────────

function teamAliases(entries) {
  const alias = new Map();
  for (const e of entries) {
    if (!alias.has(e.teamId)) alias.set(e.teamId, `Hold ${alias.size + 1}`);
  }
  return alias;
}

/** Flagtilstande + issues, uden params (de er private og hoerer ikke til i loggen). */
export function describeModel(model) {
  if (!model) return "not resolved";
  const states = Object.entries(model.states ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
  return `${states || "no flags"}${model.issues?.length ? ` · issues: ${model.issues.join("; ")}` : ""}`;
}

/** Data-blokeringer for --apply (fund 3 og 4), til dry-run-visningen. */
export function applyBlockers(plan) {
  const out = [];
  if (!(plan.rewindMismatches === 0)) out.push(`${plan.rewindMismatches} rewind mismatches`);
  if (!plan.model) out.push("development model not resolved");
  else if (plan.model.issues?.length) out.push(...plan.model.issues);
  return out;
}

export function renderAudit({ plan, summary, input, generatedAt }) {
  const alias = teamAliases(plan.entries);
  const teamName = (id) => input?.teamsById?.get(id)?.name ?? alias.get(id) ?? id;
  const lines = [
    `# #7316 reparation, dry-run ${generatedAt}`,
    "",
    "PRIVAT (balance-internals, ikke repo). Intet er skrevet til databasen.",
    "",
    `- Vindue: ${plan.window?.from ?? DEFAULT_WINDOW.from} til ${plan.window?.to ?? DEFAULT_WINDOW.to} (UTC)`,
    `- Confirm-token (plan-hash): \`${plan.hash}\``,
    `- Ticks i vinduet (alle hold): ${plan.windowTicks}`,
    `- Hold: ${summary.teams} · ryttere: ${summary.riders} · rytter-evne-par: ${summary.pairs} · ramte ticks: ${summary.ticks}`,
    `- Krediteret fremgang i alt: ${summary.creditSum.toFixed(3)} (raa ${summary.rawCreditSum.toFixed(3)}, ${summary.clampedPairs} par klippet af det haarde loft)`,
    `- Ekstra hele point naar baren omsaettes: 0 → ${summary.distribution[0]}, +1 → ${summary.distribution[1]}, +2 → ${summary.distribution[2]}, +3 eller mere → ${summary.distribution["3+"]}`,
    `- Tilbagespoling kontrolleret mod gains_detail: ${plan.rewindChecked} evner, ${plan.rewindMismatches} afvigelser`,
    `- Udviklingsmodel i vinduet: ${describeModel(plan.model)}`,
    `- Apply: ${applyBlockers(plan).length ? `BLOKERET (${applyBlockers(plan).join("; ")})` : "ikke blokeret af data (kraever stadig token + --training-quiesced + ejer-go)"}`,
    "",
    "## Frasorterede ticks",
    "",
    ...Object.entries(plan.skips).sort().map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Top 10",
    "",
    "| rytter | hold | evne | ticks | kredit | bar nu | ekstra point |",
    "|---|---|---|---|---|---|---|",
    ...summary.top10.map((e) => `| ${e.name} | ${teamName(e.teamId)} | ${e.ability} | ${e.ticks} | ${e.credit.toFixed(3)} | ${e.progressNow.toFixed(3)} | ${e.extraPoints} |`),
    "",
    "## Alle par",
    "",
    "| rytter | rider_id | hold | evne | ticks | raa | kredit | ekstra |",
    "|---|---|---|---|---|---|---|---|",
    ...plan.entries.map((e) => `| ${e.name} | ${e.riderId} | ${teamName(e.teamId)} | ${e.ability} | ${e.ticks} | ${e.rawCredit.toFixed(4)} | ${e.credit.toFixed(4)} | ${e.extraPoints} |`),
    "",
  ];
  return lines.join("\n");
}

export function parseArgs(argv) {
  const args = { apply: false, confirmToken: null, from: DEFAULT_WINDOW.from, to: DEFAULT_WINDOW.to, auditDir: AUDIT_DIR };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a.startsWith("--confirm-token=")) args.confirmToken = a.slice("--confirm-token=".length);
    else if (a.startsWith("--from=")) args.from = a.slice(7);
    else if (a.startsWith("--to=")) args.to = a.slice(5);
    else if (a.startsWith("--audit-dir=")) args.auditDir = a.slice(12);
    else if (a.startsWith("--input=")) args.input = a.slice(8);
    else if (a === "--print-export-sql") args.printExportSql = true;
    else if (a === "--training-quiesced") args.trainingQuiesced = true;
    else if (a === "--verify") args.verify = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  // Apply skal se live-tilstanden og ledgeren direkte, aldrig en eksport-fil.
  if (args.apply && args.input) throw new Error("--apply cannot be combined with --input");
  if (!Number.isFinite(Date.parse(args.from)) || !Number.isFinite(Date.parse(args.to))) throw new Error("invalid --from/--to");
  return args;
}

/**
 * PURE: find ledger-par hvis kredit ikke staar i live-tilstanden (fx overskrevet af en
 * samtidig traeningscommit). Evne + bar maa aldrig vaere under foer + kredit, medmindre
 * evnen sidder paa loftet (dér klipper motoren baren, og intet er tabt).
 */
export function findLostCredits(ledgerRows, derivedById) {
  const lost = [];
  for (const row of ledgerRows) {
    const d = derivedById.get(row.rider_id);
    if (!d || !(num(row.applied_credit) > 0)) continue;
    const expected = num(row.ability_before) + num(row.progress_before?.[row.ability]) + num(row.applied_credit);
    const live = num(d[row.ability]) + num(d.ability_progress?.[row.ability]);
    const cap = Math.min(99, num(d.ability_caps?.[row.ability] ?? 99));
    if (live + 1e-9 < expected && num(d[row.ability]) < cap) lost.push({ ...row, expected, live });
  }
  return lost;
}

async function runVerify(supabase) {
  const ledger = await loadLedgerRows(supabase, "rider_id, ability, applied_credit, ability_before, progress_before");
  const ids = [...new Set(ledger.map((r) => r.rider_id))];
  const derived = await selectIn(supabase, "rider_derived_abilities", `rider_id, ${VISIBLE_ABILITIES.join(", ")}, ability_caps, ability_progress`, "rider_id", ids);
  const lost = findLostCredits(ledger, new Map(derived.map((d) => [d.rider_id, d])));
  console.log(`Verify: ${ledger.length} ledger pairs, ${lost.length} with credit missing from live state.`);
  for (const l of lost.slice(0, 20)) console.log(`  lost: ${l.rider_id} ${l.ability} expected ${l.expected.toFixed(3)} live ${l.live.toFixed(3)}`);
  if (lost.length) process.exitCode = 3;
}

async function runApply({ plan, args }) {
  assertApplyAllowed(plan, args);
  const dsn = process.env.SUPABASE_DB_URL;
  if (!dsn) throw new Error("SUPABASE_DB_URL missing (infisical run --env=prod). Nothing written.");
  const { pgEnvFromDsn, resolvePgBin, run } = await import("./db-lib.mjs");
  const env = pgEnvFromDsn(dsn);
  const sqlDir = path.join(args.auditDir, `apply-sql-${plan.hash}`);
  mkdirSync(sqlDir, { recursive: true });
  const byTeam = new Map();
  for (const e of plan.entries) {
    if (!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
    byTeam.get(e.teamId).push(e);
  }
  let done = 0;
  for (const [teamId, entries] of byTeam) {
    const file = path.join(sqlDir, `${teamId}.sql`);
    writeFileSync(file, buildTeamApplySql({ teamId, entries, hash: plan.hash }));
    run(resolvePgBin("psql"), ["-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-f", file], { env });
    done += 1;
    console.log(`  applied team ${done}/${byTeam.size} (${entries.length} pairs)`);
  }
  console.log(`Apply done: ${done} teams. Next: --verify (lost credits) and a new dry-run (must report 0 pairs).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let window = { from: new Date(args.from).toISOString(), to: new Date(args.to).toISOString() };
  if (args.printExportSql) {
    console.log(buildExportSql(window));
    return;
  }
  let input;
  if (args.input) {
    // Eksport-stien: filen er resultatet af buildExportSql (kolonnen `export`).
    input = await planInputFromExport(parseExportFile(readFileSync(args.input, "utf8")));
    window = input.window;
    console.log(`#7316 repair DRY-RUN from export file (writes nothing) · window ${window.from} → ${window.to}`);
  } else {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Run via: infisical run --env=prod -- node scripts/7316-repair-main-ability.mjs");
      console.error("No DB access: use --print-export-sql, run that SELECT read-only, save it, and pass --input=<file>.");
      process.exitCode = 2;
      return;
    }
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    if (args.verify) {
      await runVerify(supabase);
      return;
    }
    console.log(`#7316 repair ${args.apply ? "APPLY" : "DRY-RUN (writes nothing)"} · window ${window.from} → ${window.to}`);
    input = await loadPlanInput(supabase, window);
  }
  const plan = { ...computeRepairPlan(input), window };
  const summary = summarizePlan(plan);

  console.log(`Ticks in window: ${plan.windowTicks}`);
  console.log(`Teams: ${summary.teams} · riders: ${summary.riders} · pairs: ${summary.pairs} · affected ticks: ${summary.ticks}`);
  console.log(`Credited progress: ${summary.creditSum.toFixed(3)} (raw ${summary.rawCreditSum.toFixed(3)}, clamped pairs ${summary.clampedPairs})`);
  console.log(`Extra whole points: 0=${summary.distribution[0]} +1=${summary.distribution[1]} +2=${summary.distribution[2]} +3+=${summary.distribution["3+"]}`);
  console.log(`Rewind check: ${plan.rewindChecked} abilities, ${plan.rewindMismatches} mismatches`);
  console.log(`Development model in window: ${describeModel(plan.model)}`);
  const blockers = applyBlockers(plan);
  console.log(`Apply blockers: ${blockers.length ? blockers.join("; ") : "none from data"}`);
  console.log(`Skips: ${JSON.stringify(plan.skips)}`);
  console.log("Top 10:");
  for (const e of summary.top10) console.log(`  ${e.name} · ${e.ability} · ticks ${e.ticks} · credit ${e.credit.toFixed(3)} · +${e.extraPoints}`);
  console.log(`Confirm token: ${plan.hash}`);

  const generatedAt = new Date().toISOString();
  mkdirSync(args.auditDir, { recursive: true });
  const stamp = generatedAt.slice(0, 10);
  const auditFile = path.join(args.auditDir, `repair-dry-run-${stamp}.md`);
  writeFileSync(auditFile, renderAudit({ plan, summary, input, generatedAt }));
  writeFileSync(path.join(args.auditDir, `repair-plan-${stamp}-${plan.hash}.json`), JSON.stringify({ window, hash: plan.hash, entries: plan.entries }, null, 2));
  console.log(`Audit: ${auditFile}`);

  if (args.apply) await runApply({ plan, args });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`#7316 repair failed: ${err.message}`);
    process.exitCode = 1;
  });
}
