// Trætheds-belastning pr. løbsdag (#1306, spec 6.4). Kalibreres i race:gate/training:gate.
//
// Upsert-semantik (supabase-js): ved konflikt (rider_id eksisterer) opdateres KUN
// de angivne kolonner (fatigue, updated_at). Kolonner der ikke er med i upsert-rækken
// (fx form, injured_until) berøres ikke på UPDATE-stien. På INSERT-stien (ny række)
// træder DB-defaults i kraft — form har DEFAULT 50 og sættes automatisk. Det er præcis
// den ønskede adfærd: vi opdaterer kun træthed, rører aldrig form.

import { isTrainingConditionPerDateEnabled } from './trainingDateConditionFlag.js';

import { effortFatigueMultiplier } from "./raceRoles.js";
import { nextFatigue, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isS5ProfilesV1OrLater } from "./raceEngineRulesRevision.ts";
import { stageLoadV2, enteringFatigueV2 } from "./conditionModelV2.js";
import { fetchAllRows } from "./supabasePagination.js";
import { copenhagenDateString } from "./copenhagenTime.js";

const RACE_FATIGUE_BY_PROFILE = {
  flat:          10,
  rolling:       12,
  hilly:         14,
  classic:       16,
  cobbles:       16,
  mountain:      18,
  high_mountain: 20,
  itt:           12,
  ttt:           10,
};

/**
 * Belastning (fatigue-point) for en given etapeprofil.
 * Ukendt profil → 12 (rolling-default).
 */
export function raceFatigueLoad(profileType) {
  return RACE_FATIGUE_BY_PROFILE[profileType] ?? 12;
}

/**
 * Intra-løb trætheds-akkumulering (#1021-hybrid, ejer-valgt 2026-06-17).
 * Givet en rytters start-træthed (rider_condition.fatigue ved løbsstart, eller 0
 * hvis ingen condition-data) og etapeprofilerne i rækkefølge: returnér den træthed
 * rytteren GÅR IND TIL hver etape med. Etape i's belastning lægges til EFTER etape i
 * (rammer i+1, i+2 ...), så etape 1 køres på start-træthed og en 21-etapers tour
 * bliver en udmattelseskamp. Clamp 0–100. Ren + deterministisk.
 *
 * Race v3 S1 (#2352): valgfri `effort`-parameter kobler roller til trætheden
 * (spec §6 — "hjælper der arbejder (protect-effort) +20% race-fatigue; save
 * -30%"). DORMANT seam i S1: default 'normal' → multiplikator 1.0 → adfærd
 * UÆNDRET (bit-identisk med før S1).
 *
 * S3 (#2034): valgfri `efforts`-array giver ÉT effort PR. ETAPE (i stedet for ét
 * fælles `effort` for hele løbet) — raceRunner.js sender rytterens per-etape-
 * resolverede overrides (race_stage_roles) her når v3=true. Bagudkompatibelt:
 * `efforts` udeladt → falder tilbage til det gamle enkelt-`effort`-flow (default
 * 'normal', BIT-IDENTISK med før S3). `efforts[i]` falsy (huller/for kort array,
 * bør ikke ske men defensivt) → 'normal' for den etape.
 *
 * #3470: valgfri `restDaysBefore`-array (parallel til profileTypes) — antal GT-
 * hviledage (game_day-hul) FØR etape i. Er restDaysBefore[i] > 0, restitueres f via
 * restDayFatigue (SAMME model som den eksplicitte hviledags-restitution der rent
 * faktisk skrives til rider_condition, raceRunner.js) FØR etapens belastning lægges
 * til — så prædiktionen her ikke dobbelt-tæller/modsiger den faktiske restitution.
 * Udeladt/alt 0 → BIT-IDENTISK med før #3470.
 *
 * @param {number|null|undefined} startFatigue
 * @param {string[]} profileTypes  etapeprofiler i etape-rækkefølge
 * #6079: valgfri `rulesRevision` (løbets engine_rules_revision). Under
 * "orders_gc_v1" afhænger save's besparelse af etapeprofilen (raceRoles.js
 * effortFatigueMultiplier). Udeladt/legacy → BIT-IDENTISK.
 *
 * @param {{effort?: 'grupetto'|'save'|'normal'|'protect'|'all_out', efforts?: string[], restDaysBefore?: number[], recoveryAbility?: number, rulesRevision?: string|null}} [opts]
 * @returns {number[]} træthed ved START af hver etape (samme længde som profileTypes)
 */
export function stageEnteringFatigues(startFatigue, profileTypes, { effort = "normal", efforts, restDaysBefore, recoveryAbility = 50, trainingOwnsRecovery = false, rulesRevision = null } = {}) {
  let f = Number.isFinite(Number(startFatigue))
    ? Math.max(0, Math.min(100, Number(startFatigue)))
    : 0;
  const out = [];
  for (let i = 0; i < profileTypes.length; i++) {
    const rest = Array.isArray(restDaysBefore) ? (Number(restDaysBefore[i]) || 0) : 0;
    if (!trainingOwnsRecovery && rest > 0) f = restDayFatigue({ fatigue: f, restDays: rest, recoveryAbility });
    const p = profileTypes[i];
    const stageEffort = Array.isArray(efforts) ? (efforts[i] || "normal") : effort;
    const mult = effortFatigueMultiplier(stageEffort, { profileType: p, rulesRevision });
    out.push(f);
    if (!trainingOwnsRecovery) f = Math.min(100, f + raceFatigueLoad(p) * mult);
  }
  return out;
}

/**
 * Skriv løbsdags-træthed til rider_condition for alle deltagere.
 *
 * Læs-modificér-skriv i ét batch; clamp 0–100. Ryttere uden eksisterende
 * condition-række får én (form defaulter til 50 via DB-schema). Fejl herfra
 * KASTES til kald-stedet — kald-stedet sluger dem (non-blocking, mirror B2).
 *
 * S3 (#2034): valgfrit `effortByRider` (Map<rider_id, effort>) ganger DENNE
 * dags load med effortFatigueMultiplier PR. RYTTER (protect +20%, save -30%,
 * normal/manglende nøgle = ×1.0). Bagudkompatibelt: `effortByRider` udeladt/null
 * → alle ryttere ganges med 1.0 — BIT-IDENTISK med før S3. Kald-stedet
 * (raceRunner.js) sender kun et udfyldt Map når v3=true.
 *
 * @param {{ supabase, riderIds: string[], profileType: string, now?: Date, effortByRider?: Map<string,string>|null }}
 * @returns {{ updated: number }}
 */
export async function applyRaceFatigue({ supabase, riderIds, profileType, now = new Date(), effortByRider = null, raceId = null, stageNumber = null, loadSnapshot = null, rulesRevision = null }) {
  if (!riderIds?.length) return { updated: 0 };
  const load = raceFatigueLoad(profileType);
  if (await isTrainingConditionPerDateEnabled(supabase)) {
    if (!raceId || !Number.isInteger(stageNumber) || stageNumber < 1) throw new Error('Normalized race load requires race and stage identifiers');
    const { data, error } = await supabase.rpc('record_training_race_load', {
      p_race_id: raceId, p_stage_number: stageNumber,
      p_loads: loadSnapshot ?? raceConditionLoads(riderIds, profileType, effortByRider, rulesRevision),
    });
    if (error) throw new Error(`race condition load ledger: ${error.message}`);
    return { updated: 0, recorded: data?.recorded ?? 0 };
  }

  const { data, error } = await supabase
    .from("rider_condition")
    .select("rider_id, fatigue")
    .in("rider_id", riderIds);
  if (error) throw new Error(`rider_condition (race fatigue): ${error.message}`);

  const by = new Map((data ?? []).map((r) => [r.rider_id, r.fatigue]));
  const rows = riderIds.map((id) => {
    const mult = effortByRider?.has(id) ? effortFatigueMultiplier(effortByRider.get(id), { profileType, rulesRevision }) : 1;
    return {
      rider_id: id,
      // rider_condition.fatigue er smallint — afrund så load*mult ikke sender
      // en float (fx 53.599999999999994) til DB → 22P02 invalid-input-fejl.
      fatigue: Math.max(0, Math.min(100, Math.round((Number(by.get(id)) || 0) + load * mult))),
      updated_at: now.toISOString(),
    };
  });

  const { error: upErr } = await supabase
    .from("rider_condition")
    .upsert(rows, { onConflict: "rider_id" });
  if (upErr) throw new Error(`rider_condition upsert (race fatigue): ${upErr.message}`);

  return { updated: rows.length };
}

// #6079: `rulesRevision` (løbets bundne engine_rules_revision) gør save's
// multiplikator profil-afhængig under orders_gc_v1; udeladt/legacy = bit-identisk.
// #5928: under s5_profiles_v1 (og KUN dér) vokser etapens belastning med etapens
// plads i løbet og med det arbejde rytteren faktisk lavede (se stageRaceConditionLoad).
// `work` = { stageNumber, efforts?, exposure? } fra raceRunner; udeladt = kun etapens plads.
// #6984: `conditionV2` = { distanceKm, seasonRaceDaysByRider } når condition_model_v2 er
// on (kaldestedet læser flaget). Så gælder v2-belastningen for ALLE løb; null = uændret.
export function raceConditionLoads(riderIds, profileType, effortByRider = null, rulesRevision = null, work = null, conditionV2 = null) {
  if (conditionV2) {
    return [...new Set(riderIds)].map((riderId) => ({
      rider_id: riderId,
      load: stageLoadV2({
        profileType,
        distanceKm: conditionV2.distanceKm ?? null,
        stageNumber: work?.stageNumber ?? 1,
        effort: work?.efforts?.get(riderId) ?? effortByRider?.get(riderId) ?? "normal",
        exposure: work?.caught?.has(String(riderId))
          ? { ...(work?.exposure?.get(riderId) ?? { front: 0, shelter: 0 }), caught: true }
          : work?.exposure?.get(riderId) ?? null,
        // Løbsdage FØR denne etape + denne etape selv.
        seasonRaceDays: (Number(conditionV2.seasonRaceDaysByRider?.get(riderId)) || 0) + 1,
        rulesRevision,
      }),
    }));
  }
  if (isS5ProfilesV1OrLater(rulesRevision)) {
    return [...new Set(riderIds)].map((riderId) => ({
      rider_id: riderId,
      load: stageRaceConditionLoad({
        profileType,
        stageNumber: work?.stageNumber ?? 1,
        effort: work?.efforts?.get(riderId) ?? effortByRider?.get(riderId) ?? "normal",
        exposure: work?.exposure?.get(riderId) ?? null,
        rulesRevision,
      }),
    }));
  }
  return [...new Set(riderIds)].map(riderId => ({rider_id:riderId,load:raceFatigueLoad(profileType)*effortFatigueMultiplier(effortByRider?.get(riderId) ?? 'normal', { profileType, rulesRevision })}));
}

// ── #5928: Grand Tour-træthed (KUN s5_profiles_v1) ──────────────────────────────
//
// Ejer 15/10: GT'en skal være svær gennem træthed der hober sig op over hele løbet,
// så uge 3 bliver hård, og en hjælper der arbejder skal trættes mere end en der
// spares. Tilstanden afregnes stadig ÉN gang pr. dato med datoens samlede belastning
// fra de 5 løbsdage (trainingDateCondition.settleTrainingDateCondition, uændret), og
// en etape optager stadig ét af datoens 5 pladser. To ting ændres i etapens belastning:
//   1. Etapens plads i løbet: hver etape ud over den første koster lidt mere, op til
//      et loft. Et 5-etapers løb mærker det knap; en GT's sidste uge koster markant
//      mere end den første (kroppen når ikke at komme sig mellem etaperne).
//   2. Det reelle arbejde: indsatsen motoren faktisk kørte rytteren på (managerens
//      ordre ELLER AI-holdets ordre), og hvor stor del af etapen han lå i et udbrud,
//      alene eller i en jagtgruppe (mere) eller i grupettoen (mindre). Enkeltstarter
//      er ens for alle: alle kører alene og fuldt ud.
// Konstanterne er balance (hard rule 17: målte fordelinger kun i balance-internals/).

/** Profiler S5-generatoren skriver, som den gamle tabel ikke kender (ellers 12). */
const S5_EXTRA_FATIGUE_BY_PROFILE = Object.freeze({ medium_mountain: 16, gravel: 16 });

export const GT_FATIGUE_TUNING = Object.freeze({
  // Etapens plads: +andel pr. etape efter den første, loft efter capStages etaper.
  accumulationPerStage: 0.075,
  accumulationCapStages: 20,
  // Arbejde: fuld etape i front (udbrud/alene/jagt) = +frontWork; fuld etape i grupettoen = -shelterRelief.
  frontWork: 0.5,
  shelterRelief: 0.3,
  workFactorMin: 0.7,
  workFactorMax: 1.5,
});

const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);
const FRONT_GROUP_KINDS = new Set(["breakaway", "solo", "chase"]);

/** Profil-belastning under S5 (de nye profiler får en rigtig værdi i stedet for 12). */
export function s5RaceFatigueLoad(profileType) {
  return S5_EXTRA_FATIGUE_BY_PROFILE[profileType] ?? raceFatigueLoad(profileType);
}

/** Etapens plads i løbet som multiplikator (1 på etape 1, aldrig faldende, loft). */
export function stageAccumulationMultiplier(stageNumber, tuning = GT_FATIGUE_TUNING) {
  const n = Math.max(1, Math.floor(Number(stageNumber) || 1));
  return 1 + tuning.accumulationPerStage * Math.min(n - 1, tuning.accumulationCapStages);
}

/** Arbejds-multiplikator ud fra rytterens andel af etapen i front/grupetto (0-1 hver). */
export function workExposureMultiplier(exposure, { profileType = null, tuning = GT_FATIGUE_TUNING } = {}) {
  if (!exposure || TIME_TRIAL_PROFILES.has(profileType)) return 1;
  const front = clamp01(exposure.front);
  const shelter = clamp01(exposure.shelter);
  const raw = 1 + tuning.frontWork * front - tuning.shelterRelief * shelter;
  return Math.max(tuning.workFactorMin, Math.min(tuning.workFactorMax, raw));
}

/**
 * REN: én rytters belastning for én etape under s5_profiles_v1.
 * profil × indsats × arbejde × etapens plads. Indsatsen er den motoren kørte.
 */
export function stageRaceConditionLoad({ profileType, stageNumber = 1, effort = "normal", exposure = null, rulesRevision = null, tuning = GT_FATIGUE_TUNING }) {
  const effortMult = TIME_TRIAL_PROFILES.has(profileType) ? 1 : effortFatigueMultiplier(effort, { profileType, rulesRevision });
  return s5RaceFatigueLoad(profileType)
    * effortMult
    * workExposureMultiplier(exposure, { profileType, tuning })
    * stageAccumulationMultiplier(stageNumber, tuning);
}

/**
 * REN: hver rytters andel af etapen (km-vægtet) i front (udbrud, alene, jagtgruppe) og
 * i grupettoen, fra motorens egne gruppe-snapshots (v4Output.groupSnapshots). Et snapshot
 * gælder strækningen fra forrige snapshot til dets eget km. Enkeltstarter og manglende
 * snapshots giver et tomt kort (= intet arbejdstillæg).
 * @returns {Map<string, {front:number, shelter:number}>}
 */
export function stageWorkExposure(v4Output, profileType = null) {
  const out = new Map();
  const snaps = Array.isArray(v4Output?.groupSnapshots) ? v4Output.groupSnapshots : [];
  if (!snaps.length || TIME_TRIAL_PROFILES.has(profileType)) return out;
  const sorted = snaps.slice().sort((a, b) => Number(a.km) - Number(b.km));
  const total = Math.max(0, Number(sorted[sorted.length - 1].km) || 0);
  if (total <= 0) return out;
  let prevKm = 0;
  for (const snap of sorted) {
    const km = Number(snap.km) || 0;
    const w = Math.max(0, km - prevKm) / total;
    prevKm = Math.max(prevKm, km);
    if (w <= 0) continue;
    for (const g of snap.groups ?? []) {
      const front = FRONT_GROUP_KINDS.has(g.kind);
      const shelter = g.kind === "gruppetto";
      if (!front && !shelter) continue;
      for (const id of g.rider_ids ?? []) {
        const key = String(id);
        const e = out.get(key) ?? { front: 0, shelter: 0 };
        if (front) e.front += w;
        else e.shelter += w;
        out.set(key, e);
      }
    }
  }
  for (const e of out.values()) { e.front = round3(clamp01(e.front)); e.shelter = round3(clamp01(e.shelter)); }
  return out;
}

/**
 * REN: det raceRunner hæfter på en v4-etapes run, så belastningen kan fryses med det
 * reelle arbejde. Kun under s5_profiles_v1; ellers null (ingen ændring af run-objektet).
 */
export function stageConditionWork({ rulesRevision, stageNumber, profileType, v4Result }) {
  if (!isS5ProfilesV1OrLater(rulesRevision) || !v4Result) return null;
  return {
    stageNumber,
    efforts: v4Result.efforts instanceof Map ? v4Result.efforts : null,
    exposure: stageWorkExposure(v4Result.v4Output, profileType),
    // #6984: kun v2 læser det (hentet udbrud koster et tillæg); v1 ignorerer feltet.
    caught: stageCaughtBreakaway(v4Result.v4Output, profileType),
  };
}

/**
 * #6984 REN: ryttere der lå i front (udbrud, alene, jagtgruppe) i et af etapens
 * gruppe-snapshots, men IKKE i front i det sidste (udbruddet blev hentet).
 * Enkeltstarter og manglende snapshots giver et tomt sæt.
 * @returns {Set<string>}
 */
export function stageCaughtBreakaway(v4Output, profileType = null) {
  const caught = new Set();
  const snaps = Array.isArray(v4Output?.groupSnapshots) ? v4Output.groupSnapshots : [];
  if (!snaps.length || TIME_TRIAL_PROFILES.has(profileType)) return caught;
  const sorted = snaps.slice().sort((a, b) => Number(a.km) - Number(b.km));
  const frontIds = (snap) => new Set((snap.groups ?? []).filter((g) => FRONT_GROUP_KINDS.has(g.kind)).flatMap((g) => (g.rider_ids ?? []).map(String)));
  const finalFront = frontIds(sorted[sorted.length - 1]);
  for (const snap of sorted.slice(0, -1)) {
    for (const id of frontIds(snap)) if (!finalFront.has(id)) caught.add(id);
  }
  return caught;
}

/**
 * Hæfter etapens arbejde på et run-objekt som en IKKE-enumerérbar egenskab: run'et
 * persisteres felt for felt (raceRunner.persistRuns) og sammenlignes i determinisme-
 * testene, så formen må ikke ændre sig. work=null (alt andet end s5_profiles_v1) = no-op.
 */
export function attachConditionWork(run, work) {
  if (run && work) Object.defineProperty(run, "conditionWork", { value: work, enumerable: false, configurable: true, writable: true });
  return run;
}

/** Arbejdet til raceConditionLoads for et run: det hæftede, ellers kun etapens nummer. */
export function conditionWorkForRun(run) {
  return run?.conditionWork ?? { stageNumber: Number(run?.stage_number) || 1 };
}

function clamp01(x) {
  const v = Number(x);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
function round3(x) { return Math.round(x * 1000) / 1000; }

/**
 * #3470 — REN KERNE: hviledags-restitueret træthed. Et GT-game_day-hul (mellem to
 * etaper, jf. grandTourRestDayPositions/raceCalendarLanePacker.js) tickes gennem DEN
 * ÆGTE daglige model (riderCondition.nextFatigue, intensity "rest") ÉN gang PR.
 * hviledag i hullet, med rytterens EGEN recoveryAbility. Samme mekanik som
 * sæsonskifte-restitutionen (seasonFatigueReset.js's "rest_days"-mode) — GT'er er
 * IRL-komprimerede (flere game_day-slots pr. rigtig kalenderdag, jf. TIER_STAGE_SLOTS),
 * så et game_day-hul giver IKKE automatisk en ekstra rigtig-kalenderdags recovery-cyklus
 * (trainingSweep.js/riderCondition.js tickker pr. REAL dansk kalenderdag) — denne funktion
 * ER den eksplicitte erstatning derfor. Deterministisk, ingen DB/Date/random.
 * #3459 D3: valgfrie `recoveryBase`/`recoveryFraction` — passthrough til nextFatigue,
 * udeladt/undefined = CONDITION_CONFIG's status quo (bit-identisk). Kaldestedet
 * (applyGrandTourRestDayFatigue nedenfor) afgør ud fra race_day_engine_enabled om
 * RACE_DAY_ENGINE_RECOVERY_CONFIG sendes — denne kerne-funktion forbliver ren/uafhængig
 * af flag-læsning (samme adskillelse som nextFatigue selv).
 * @param {{fatigue:number|null|undefined, restDays:number, recoveryAbility?:number, recoveryBase?:number, recoveryFraction?:number}} args
 * @returns {number} heltal 0-100
 */
export function restDayFatigue({ fatigue, restDays, recoveryAbility = 50, recoveryBase, recoveryFraction } = {}) {
  const days = Math.max(0, Math.floor(Number(restDays) || 0));
  const rec = Number.isFinite(Number(recoveryAbility)) ? Number(recoveryAbility) : 50;
  let f = Number.isFinite(Number(fatigue)) ? Number(fatigue) : 0;
  for (let i = 0; i < days; i++) {
    f = nextFatigue({ fatigue: f, intensity: "rest", recoveryAbility: rec, recoveryBase, recoveryFraction });
  }
  return Math.max(0, Math.min(100, Math.round(f)));
}

/**
 * #3470 — persistér GT-hviledags-restitution med SAMME læs-modificér-skriv-sti som
 * applyRaceFatigue (frisk DB-læsning → restDayFatigue → upsert). Bevidst en frisk læsning
 * (ikke et in-memory fatigue-øjebliksbillede) — kaldestedet i raceRunner.js's fuld-sim-gren
 * processerer FLERE etaper i ÉT kald, og rider_condition.fatigue akkumulerer undervejs fra
 * tidligere applyRaceFatigue-kald i SAMME kald; kun en frisk læsning her holder rest-tick'et
 * synkront med den faktiske DB-tilstand. recoveryAbilityByRider mangler en rytter →
 * default 50 (samme neutral-fallback som seasonFatigueReset.js).
 * #3459 D3 (minimal ændring, jf. opgavens grænse — raceRunner.js/kaldestedet røres
 * IKKE): recoveryBase/recoveryFraction følger race_day_engine_enabled KONSISTENT med
 * dailyTrainingEngine.js — flagget læses her, internt, fordi kaldestedet (raceRunner.js)
 * allerede sender `supabase` med i args og ligger uden for denne opgaves rørings-grænse.
 * Flag off (default) = bit-identisk (samme ekstra-men-harmløse app_config-select som
 * dailyTrainingEngine.js allerede laver hver tick).
 * @param {{ supabase, riderIds: string[], restDays: number, recoveryAbilityByRider?: Map<string,number>, now?: Date }}
 * @returns {{ updated: number, fatigueByRider: Map<string,number> }} fatigueByRider lader
 *   kald-stedet synkronisere et in-memory entrants-snapshot (fx til selve simuleringen)
 *   uden endnu en DB-læsning.
 */
export async function applyGrandTourRestDayFatigue({ supabase, riderIds, restDays, recoveryAbilityByRider = new Map(), now = new Date() }) {
  if (!riderIds?.length || !restDays) return { updated: 0, fatigueByRider: new Map() };

  // Recovery is already applied once per game day by the training tick.
  // A free slot is not necessarily rest, and the race writer must not pre-credit it.
  if (await isTrainingConditionPerDateEnabled(supabase)) {
    return { updated: 0, fatigueByRider: new Map() };
  }
  const raceDayEngineOn = await isRaceDayEngineEnabled(supabase);
  const recoveryOverrides = raceDayEngineOn ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {};

  const { data, error } = await supabase
    .from("rider_condition")
    .select("rider_id, fatigue")
    .in("rider_id", riderIds);
  if (error) throw new Error(`rider_condition (GT hviledags-restitution): ${error.message}`);

  const by = new Map((data ?? []).map((r) => [r.rider_id, r.fatigue]));
  const rows = riderIds.map((id) => ({
    rider_id: id,
    fatigue: restDayFatigue({
      fatigue: by.get(id), restDays, recoveryAbility: recoveryAbilityByRider.get(id) ?? 50,
      ...recoveryOverrides,
    }),
    updated_at: now.toISOString(),
  }));

  const { error: upErr } = await supabase
    .from("rider_condition")
    .upsert(rows, { onConflict: "rider_id" });
  if (upErr) throw new Error(`rider_condition upsert (GT hviledags-restitution): ${upErr.message}`);

  return { updated: rows.length, fatigueByRider: new Map(rows.map((r) => [r.rider_id, r.fatigue])) };
}

/**
 * #6984 (B3): løbsdage pr. rytter i sæsonen FØR denne etape, fra belastnings-ledgeren
 * (samme kilde som Udvikling 2.0's løbsbremse). Distinkte game_days; aliaser
 * (duplicate_of_race_id) og etapen selv (retry) tælles ikke. Paginering: et GT-felt
 * har tusindvis af rækker.
 * @returns {Promise<Map<string, number>>}
 */
export async function loadSeasonRaceDaysByRider({ supabase, seasonId, riderIds, excludeRaceId = null, excludeStageNumber = null }) {
  const ids = [...new Set((riderIds ?? []).map(String))];
  const out = new Map(ids.map((id) => [id, 0]));
  if (!seasonId || !ids.length) return out;
  const daysByRider = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await fetchAllRows(() => supabase.from("training_race_loads")
      .select("rider_id, game_day, race_id, stage_number")
      .eq("season_id", seasonId)
      .in("rider_id", chunk)
      .is("duplicate_of_race_id", null)
      .order("rider_id").order("game_day").order("race_id").order("stage_number"));
    for (const row of rows) {
      if (excludeRaceId && row.race_id === excludeRaceId && Number(row.stage_number) === Number(excludeStageNumber)) continue;
      const key = String(row.rider_id);
      if (!daysByRider.has(key)) daysByRider.set(key, new Set());
      daysByRider.get(key).add(Number(row.game_day));
    }
  }
  for (const [id, days] of daysByRider) out.set(id, days.size);
  return out;
}

/**
 * #6984 (B2): træthed ved etapens start, når rytteren allerede har kørt etaper samme
 * dato. rider_condition er åbningen (aftenen før); datoens endnu ikke afregnede
 * belastninger (consumed_at null, kun originaler, tidligere løbsdage) lægges oven i
 * med v2's døgnregnestykke. Muterer `entrant.fatigue`; ryttere uden condition-række
 * røres ikke (neutral i motoren som i dag). Kaldes kun under v2 + regel-revision.
 * @returns {Promise<number>} antal ryttere hvis træthed blev hævet
 */
export async function applySameDateEnteringFatigueV2({ supabase, raceId, stageNumber, entrants }) {
  const withCondition = (entrants ?? []).filter((e) => Number.isFinite(Number(e.fatigue)));
  if (!withCondition.length) return 0;
  const { data: sched, error: schedErr } = await supabase.from("race_stage_schedule")
    .select("game_day, scheduled_at").eq("race_id", raceId).eq("stage_number", stageNumber).maybeSingle();
  if (schedErr) throw new Error(`race_stage_schedule (same-date fatigue): ${schedErr.message}`);
  const gameDay = Number(sched?.game_day);
  if (!Number.isInteger(gameDay) || !sched?.scheduled_at) return 0;
  // Samme dato som ledgerens tick_date (dansk kalenderdato for etapens start).
  const tickDate = copenhagenDateString(new Date(sched.scheduled_at));
  const ids = withCondition.map((e) => e.rider_id);
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    // pagination-safe: ≤200 ryttere × højst 4 tidligere løbsdage samme dato.
    const { data, error } = await supabase.from("training_race_loads")
      .select("rider_id, game_day, load")
      .in("rider_id", ids.slice(i, i + 200))
      .eq("tick_date", tickDate).lt("game_day", gameDay)
      .is("consumed_at", null).is("duplicate_of_race_id", null)
      .order("game_day");
    if (error) throw new Error(`training_race_loads (same-date fatigue): ${error.message}`);
    rows.push(...(data ?? []));
  }
  const loadsByRider = new Map();
  for (const row of rows.slice().sort((a, b) => Number(a.game_day) - Number(b.game_day))) {
    const key = String(row.rider_id);
    if (!loadsByRider.has(key)) loadsByRider.set(key, []);
    loadsByRider.get(key).push(Number(row.load) || 0);
  }
  let raised = 0;
  for (const e of withCondition) {
    const prior = loadsByRider.get(String(e.rider_id));
    if (!prior?.length) continue;
    const next = enteringFatigueV2({ openingFatigue: Number(e.fatigue), priorLoadsToday: prior, recoveryAbility: e.abilities?.recovery ?? 50 });
    if (next !== Number(e.fatigue)) raised++;
    e.fatigue = next;
  }
  return raised;
}
