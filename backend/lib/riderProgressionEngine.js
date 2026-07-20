// Passiv udviklings-motor (#1137) — DB-orchestrator for season-transition.
//
// Kører ÉN gang pr. (rytter, sæson) i processSeasonStart, EFTER payroll. Muterer
// rider_derived_abilities (current ability) mod et uforanderligt loft, re-beregner
// base_value, ældes ryttere (is_u25), og pensionerer semi-auto med notifikation.
//
// Idempotent + ATOMISK PR. RYTTER (#2361): dev-log-insert + ability-update +
// rider-update sker i ÉN Postgres-transaktion pr. rytter via RPC'en
// apply_rider_development (database/2026-07-20-rider-development-atomic-rpc.sql).
// rider_development_log(rider_id, season_id) er UNIQUE og fungerer som RPC'ens
// interne idempotens-guard (INSERT ... ON CONFLICT DO NOTHING → returnerer false
// hvis rækken allerede fandtes, UDEN at røre evner/rytter). Før #2361 blev
// dev-loggen skrevet FØRST for ALLE ryttere, dernæst evner/rytter i separate
// batch-loops — en fejl midtvejs i den sidste update-loop efterlod loggen skrevet
// men evnerne/pensionering aldrig anvendt for de resterende ryttere, og en re-run
// ville springe dem over (uoprettelig inkonsistens — loggen sagde "udviklet", men
// var det ikke). RPC'en gør "logget" og "anvendt" atomisk: fejler ét RPC-kald, er
// alle FORUDGÅENDE ryttere i loopet allerede committet korrekt, og en re-run
// behandler kun de reelt uafsluttede. Deterministisk: al variation seedes pr.
// (rider_id, sæson) i riderProgression.js — men KUN ift. INPUT (nuværende evner);
// da RPC'en forhindrer dobbelt-anvendelse rammes determinismen aldrig af en
// re-run (en allerede-committet rytter genudvikles aldrig fra sin NYE evne).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { predictBaseValue } from "./riderValuation.js";
import { currentProductionValue } from "./riderCareerNpv.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { developRiderSeason, buildCapsForRider, sameCaps } from "./riderProgression.js";
import { resolveTrainingModifier } from "./training.js";
import { notifyTeamOwner } from "./notificationService.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { isAcademyEnabled } from "./academyFlag.js";
import { detectGraduates } from "./academyGraduation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sæson 1 = launch-året (2026). Alder er SÆSON-drevet (ikke real-world-tid), så
// ryttere ældes troværdigt over sæsoner. ageForSeason(birthdate, N) = år N − fødselsår.
export const LAUNCH_REFERENCE_YEAR = 2026;

export function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

let cachedModel = null;
function defaultModel() {
  if (!cachedModel) {
    // #2594 cutover: v4-modellen (karriere-NPV) er nu den live værdi-model.
    cachedModel = JSON.parse(readFileSync(join(__dirname, "riderValuationModelV4.json"), "utf8"));
  }
  return cachedModel;
}

async function runBatched(items, concurrency, fn) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

/**
 * Udvikl alle aktive ryttere én sæson frem. Idempotent + deterministisk.
 *
 * @param {object}  args
 * @param {object}  args.supabase       — service-role client
 * @param {string}  args.seasonId       — UUID på den NYE sæson (udviklingen hører til)
 * @param {number}  args.seasonNumber   — sæson-nummer (alder + seed)
 * @param {string}  [args.trainingSeasonId] — UUID på den AFSLUTTEDE sæson hvis træningsfokus
 *                  (#1163) skal biase udviklingen. Udeladt → ingen træningsbias (ren passiv).
 * @param {object}  [args.model]        — base_value-model (default: riderValuationModel.json)
 * @param {boolean} [args.notify=true]  — send retirement-notifikationer
 * @param {Date}    [args.now]          — til notifikations-dedup (default new Date())
 * @param {boolean} [args.dailyTrainingEnabled] — injiceret flag (test/orchestrator); udefineret →
 *                  slår isDailyTrainingEnabled(supabase) op. Når true: menneskelige holds
 *                  vækst-trin springes over (anti-double-dip #1305); AI-hold er upåvirket.
 * @returns {Promise<object>} summary
 */
export async function developRidersForSeason({
  supabase, seasonId, seasonNumber, trainingSeasonId = null,
  model = defaultModel(), notify = true, now = new Date(),
  notifyTeamOwnerFn = notifyTeamOwner,
  dailyTrainingEnabled: dailyTrainingEnabledArg,
  detectGraduatesFn = detectGraduates,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId) throw new Error("seasonId required");

  // ── Idempotens: hvilke ryttere er allerede udviklet for denne sæson? ──────────
  const alreadyRows = await fetchAllRows(() =>
    supabase.from("rider_development_log").select("rider_id").eq("season_id", seasonId));
  const alreadyDeveloped = new Set(alreadyRows.map((r) => r.rider_id));

  // ── Anti-double-dip (#1305): når daglig træning er aktiv springer menneskelige ──
  //    holds vækst over (de vokser allerede via den daglige tick). Fald + retirement
  //    kører sæsonbaseret for alle. AI-hold er upåvirket (full L0 som hidtil).
  //    Flag-opslag: injiceret boolean fra caller (test/orchestrator), ellers live-lookup.
  const dailyTrainingActive = dailyTrainingEnabledArg !== undefined
    ? dailyTrainingEnabledArg
    : await isDailyTrainingEnabled(supabase);

  // Human-team id-sæt: kun nødvendig når flaget er aktivt (ingen forespørgsel ellers).
  const humanTeamIds = new Set();
  if (dailyTrainingActive) {
    const teamRows = await fetchAllRows(() => supabase
      .from("teams")
      .select("id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false));
    for (const t of teamRows) humanTeamIds.add(t.id);
  }

  // ── Træningsfokus (#1163): planer fra den afsluttede sæson biaser udviklingen.
  //    Keyet (team,rider) så kun rytterens NUVÆRENDE holds plan tæller. Gated:
  //    uden trainingSeasonId køres ren passiv udvikling (uændret #1137-adfærd).
  const trainingByTeamRider = new Map();
  if (trainingSeasonId) {
    const planRows = await fetchAllRows(() => supabase
      .from("training_plans")
      .select("team_id, rider_id, focus, intensity")
      .eq("season_id", trainingSeasonId));
    for (const p of planRows) {
      trainingByTeamRider.set(`${p.team_id}:${p.rider_id}`, { focus: p.focus, intensity: p.intensity });
    }
  }

  // ── Load aktive ryttere + abilities (+ loft) ──────────────────────────────────
  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, primary_type, secondary_type, potentiale, birthdate, base_value, is_u25, is_retired, team_id, firstname, lastname")
      .eq("is_retired", false)
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const perRider = [];         // { id, abilityPatch, riderPatch, logPayload } → apply_rider_development RPC
  const notifications = [];    // { teamId, riderId, name }
  const summary = {
    season_id: seasonId, season_number: seasonNumber,
    candidates: 0, skipped_already_done: 0, developed: 0,
    grew: 0, declined: 0, retired: 0, caps_initialised: 0,
    trained: 0, training_setbacks: 0,
    growth_skipped: 0,  // ryttere hvis vækst-trin springes over (anti-double-dip #1305)
  };

  for (const r of riders) {
    if (alreadyDeveloped.has(r.id)) { summary.skipped_already_done++; continue; }
    if (!r.primary_type || r.potentiale == null) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (age == null) continue;
    const abRow = abilityByRider.get(r.id);
    if (!abRow) continue;

    summary.candidates++;

    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);

    // Livstidsloftet genberegnes hver sæson (ikke lazy-initeret) — ren funktion af
    // potentiale + anlæg + nuværende evne, så en forkert persisteret værdi ikke kan
    // overleve. Se buildCapsForRider for hvorfor lazy-init var selve fejlen.
    // age medsendes (#2472, 16/7) så buildCapsForRider kan aftrappe det absolutte
    // loft efter peakAge — uden den ville post-peak-ryttere ikke aldres (blocker-fund).
    const caps = buildCapsForRider(abilities, { ...r, age }, r.primary_type, r.secondary_type);
    const capsChanged = !sameCaps(abRow.ability_caps, caps);
    if (capsChanged) summary.caps_initialised++;

    // Anti-double-dip (#1305): menneskelige holds ryttere i vækstfasen spring over;
    // AI/bank/frozen/test-hold + team_id=null kører fuld L0 som hidtil.
    const skipGrowth = dailyTrainingActive && r.team_id != null && humanTeamIds.has(r.team_id);
    if (skipGrowth) summary.growth_skipped++;

    // Træningsbias: rytterens nuværende holds plan fra den afsluttede sæson.
    // For skipGrowth-ryttere er den sæsonbaserede bias irrelevant (vækst hoppes over),
    // så vi sætter training=undefined for at undgå en stille bias der intet gør.
    const plan = (!skipGrowth && r.team_id) ? trainingByTeamRider.get(`${r.team_id}:${r.id}`) : null;
    const training = resolveTrainingModifier(plan, r.id, seasonNumber);
    if (training) { summary.trained++; if (training.setbackHit) summary.training_setbacks++; }

    const { next, retirement } = developRiderSeason(
      { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age },
      abilities, caps, seasonNumber, undefined, training, { skipGrowth }
    );

    // Vækst/fald-tælling (signaturen er den højeste evne-bevægelse).
    const before = abilitySum(abilities);
    const after = abilitySum(next);
    if (after > before) summary.grew++; else if (after < before) summary.declined++;

    // #2594: v4 kræver alder + potentiale (karriere-NPV) — begge er i scope her.
    // Alder-leddet betyder at sæson-reconcilen nu også flytter værdi ved aldring
    // (ønsket, #1364 §Symmetri). current_production_value (løn-basen) følger med.
    const valueRider = { primary_type: r.primary_type, potentiale: r.potentiale, age };
    const newBaseValue = predictBaseValue(valueRider, next, model);
    const newCpv = currentProductionValue(valueRider, next, model);

    const abilityPatch = { ...next };
    if (capsChanged) abilityPatch.ability_caps = caps;

    const riderPatch = { is_u25: age < 25 };
    if (newBaseValue != null) riderPatch.base_value = newBaseValue;
    if (newCpv != null) riderPatch.current_production_value = newCpv;
    if (retirement.retire) { riderPatch.is_retired = true; summary.retired++; }

    perRider.push({
      id: r.id,
      abilityPatch,
      riderPatch,
      logPayload: { age, abilities: next, base_value: newBaseValue ?? null, retired_this_season: retirement.retire },
    });

    if (retirement.retire && r.team_id) {
      notifications.push({ teamId: r.team_id, riderId: r.id, name: `${r.firstname} ${r.lastname}`.trim(), age });
    }
    summary.developed++;
  }

  // ── Skriv (ATOMISK PR. RYTTER, #2361) ─────────────────────────────────────────
  // apply_rider_development committer dev-log-insert + ability-update + rider-update
  // i ÉN transaktion pr. rytter. RPC returnerer false hvis dev-log-rækken allerede
  // fandtes (INSERT ... ON CONFLICT (rider_id,season_id) DO NOTHING) — i så fald har
  // RPC'en GARANTERET ikke rørt evner/rytter, så det tælles som allerede-udviklet i
  // stedet for developed. Dette er kun en race (fx en samtidig anden kørsel) — det
  // indledende alreadyDeveloped-filter fanger den almindelige re-run-sti. Fejler et
  // RPC-kald, kaster vi straks: alle FORUDGÅENDE ryttere i dette loop er allerede
  // committet atomisk (logget OG anvendt sammen), så en re-run kun genoptager de
  // reelt uafsluttede — ingen dobbelt-udvikling, ingen "logget men ikke anvendt".
  const appliedForHistory = [];
  await runBatched(perRider, 25, async ({ id, abilityPatch, riderPatch, logPayload }) => {
    const { data, error } = await supabase.rpc("apply_rider_development", {
      p_rider_id: id,
      p_season_id: seasonId,
      p_season_number: seasonNumber ?? null,
      p_ability_patch: abilityPatch,
      p_rider_patch: riderPatch,
      p_log: logPayload,
    });
    if (error) throw new Error(`apply_rider_development ${id}: ${error.message}`);
    if (data === false) {
      summary.skipped_already_done++;
      summary.developed--;
      return;
    }
    appliedForHistory.push({ rider_id: id, abilities: logPayload.abilities });
  });

  // #2000 Udvikling-fane: season-snapshot af evnevektoren for ALLE FAKTISK udviklede
  // ryttere (dækker AI/free-agents + giver ejede ryttere et rent sæson-grænsepunkt).
  // Kører EFTER RPC-loopet og KUN for appliedForHistory (ikke race-skippede — deres
  // evner blev aldrig anvendt, et snapshot ville være vildledende). Best-effort: en
  // historik-fejl må ALDRIG kaste her (season-transition er kritisk spil-state;
  // historik er afledt visning). Idempotent via UNIQUE(rider_id,snapshot_date,source).
  if (appliedForHistory.length) {
    const snapshotDate = copenhagenDateString(now);
    const historyRows = appliedForHistory.map((lr) => {
      const abilities = {};
      for (const k of VISIBLE_ABILITIES) abilities[k] = lr.abilities?.[k];
      return {
        rider_id: lr.rider_id,
        snapshot_date: snapshotDate,
        source: "season_transition",
        season_number: seasonNumber ?? null,
        abilities,
      };
    });
    try {
      for (let i = 0; i < historyRows.length; i += 500) {
        const { error } = await supabase
          .from("rider_derived_ability_history")
          .upsert(historyRows.slice(i, i + 500), { onConflict: "rider_id,snapshot_date,source", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
    } catch (histErr) {
      console.error(`  ⚠️ ability-history snapshot (season) fejlede:`, histErr.message);
    }
  }

  // ── Retirement-notifikationer (fire-and-forget pr. ejer) ──────────────────────
  if (notify && notifications.length) {
    await runBatched(notifications, 10, ({ teamId, riderId, name, age }) =>
      notifyTeamOwnerFn({
        supabase, teamId, type: "rider_retired", relatedId: riderId, now,
        title: `${name} has retired`,
        message: `${name} has retired from professional cycling at age ${age}.`,
        metadata: {
          titleCode: "notification.rider_retired.title",
          titleParams: { name },
          messageCode: "notification.rider_retired.message",
          messageParams: { name, age },
        },
      }).catch(() => { /* notifikation må aldrig vælte transitionen */ }));
  }

  // ── Akademi-graduering (#932): akademiryttere der har passeret 21 sættes i
  //    pending-valg (promover/sælg/slip). Gated på academy_enabled (no-op uden
  //    akademi). Kører efter aldring så ageForSeason afspejler den nye sæson.
  if (await isAcademyEnabled(supabase)) {
    await detectGraduatesFn(supabase, { seasonId, seasonNumber, now });
  }

  return summary;
}

function abilitySum(abilities) {
  let s = 0;
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) s += Number(abilities[k]);
  return s;
}
