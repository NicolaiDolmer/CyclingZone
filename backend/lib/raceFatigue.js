// Trætheds-belastning pr. løbsdag (#1306, spec 6.4). Kalibreres i race:gate/training:gate.
//
// Upsert-semantik (supabase-js): ved konflikt (rider_id eksisterer) opdateres KUN
// de angivne kolonner (fatigue, updated_at). Kolonner der ikke er med i upsert-rækken
// (fx form, injured_until) berøres ikke på UPDATE-stien. På INSERT-stien (ny række)
// træder DB-defaults i kraft — form har DEFAULT 50 og sættes automatisk. Det er præcis
// den ønskede adfærd: vi opdaterer kun træthed, rører aldrig form.

import { effortFatigueMultiplier } from "./raceRoles.js";
import { nextFatigue } from "./riderCondition.js";

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
 * @param {{effort?: 'protect'|'normal'|'save', efforts?: string[], restDaysBefore?: number[], recoveryAbility?: number}} [opts]
 * @returns {number[]} træthed ved START af hver etape (samme længde som profileTypes)
 */
export function stageEnteringFatigues(startFatigue, profileTypes, { effort = "normal", efforts, restDaysBefore, recoveryAbility = 50 } = {}) {
  let f = Number.isFinite(Number(startFatigue))
    ? Math.max(0, Math.min(100, Number(startFatigue)))
    : 0;
  const out = [];
  for (let i = 0; i < profileTypes.length; i++) {
    const rest = Array.isArray(restDaysBefore) ? (Number(restDaysBefore[i]) || 0) : 0;
    if (rest > 0) f = restDayFatigue({ fatigue: f, restDays: rest, recoveryAbility });
    const p = profileTypes[i];
    const stageEffort = Array.isArray(efforts) ? (efforts[i] || "normal") : effort;
    const mult = effortFatigueMultiplier(stageEffort);
    out.push(f);
    f = Math.min(100, f + raceFatigueLoad(p) * mult);
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
export async function applyRaceFatigue({ supabase, riderIds, profileType, now = new Date(), effortByRider = null }) {
  if (!riderIds?.length) return { updated: 0 };
  const load = raceFatigueLoad(profileType);

  const { data, error } = await supabase
    .from("rider_condition")
    .select("rider_id, fatigue")
    .in("rider_id", riderIds);
  if (error) throw new Error(`rider_condition (race fatigue): ${error.message}`);

  const by = new Map((data ?? []).map((r) => [r.rider_id, r.fatigue]));
  const rows = riderIds.map((id) => {
    const mult = effortByRider?.has(id) ? effortFatigueMultiplier(effortByRider.get(id)) : 1;
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
 * @param {{fatigue:number|null|undefined, restDays:number, recoveryAbility?:number}} args
 * @returns {number} heltal 0-100
 */
export function restDayFatigue({ fatigue, restDays, recoveryAbility = 50 } = {}) {
  const days = Math.max(0, Math.floor(Number(restDays) || 0));
  const rec = Number.isFinite(Number(recoveryAbility)) ? Number(recoveryAbility) : 50;
  let f = Number.isFinite(Number(fatigue)) ? Number(fatigue) : 0;
  for (let i = 0; i < days; i++) {
    f = nextFatigue({ fatigue: f, intensity: "rest", recoveryAbility: rec });
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
 * @param {{ supabase, riderIds: string[], restDays: number, recoveryAbilityByRider?: Map<string,number>, now?: Date }}
 * @returns {{ updated: number, fatigueByRider: Map<string,number> }} fatigueByRider lader
 *   kald-stedet synkronisere et in-memory entrants-snapshot (fx til selve simuleringen)
 *   uden endnu en DB-læsning.
 */
export async function applyGrandTourRestDayFatigue({ supabase, riderIds, restDays, recoveryAbilityByRider = new Map(), now = new Date() }) {
  if (!riderIds?.length || !restDays) return { updated: 0, fatigueByRider: new Map() };

  const { data, error } = await supabase
    .from("rider_condition")
    .select("rider_id, fatigue")
    .in("rider_id", riderIds);
  if (error) throw new Error(`rider_condition (GT hviledags-restitution): ${error.message}`);

  const by = new Map((data ?? []).map((r) => [r.rider_id, r.fatigue]));
  const rows = riderIds.map((id) => ({
    rider_id: id,
    fatigue: restDayFatigue({ fatigue: by.get(id), restDays, recoveryAbility: recoveryAbilityByRider.get(id) ?? 50 }),
    updated_at: now.toISOString(),
  }));

  const { error: upErr } = await supabase
    .from("rider_condition")
    .upsert(rows, { onConflict: "rider_id" });
  if (upErr) throw new Error(`rider_condition upsert (GT hviledags-restitution): ${upErr.message}`);

  return { updated: rows.length, fatigueByRider: new Map(rows.map((r) => [r.rider_id, r.fatigue])) };
}
