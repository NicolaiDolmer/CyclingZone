// Trætheds-belastning pr. løbsdag (#1306, spec 6.4). Kalibreres i race:gate/training:gate.
//
// Upsert-semantik (supabase-js): ved konflikt (rider_id eksisterer) opdateres KUN
// de angivne kolonner (fatigue, updated_at). Kolonner der ikke er med i upsert-rækken
// (fx form, injured_until) berøres ikke på UPDATE-stien. På INSERT-stien (ny række)
// træder DB-defaults i kraft — form har DEFAULT 50 og sættes automatisk. Det er præcis
// den ønskede adfærd: vi opdaterer kun træthed, rører aldrig form.

import { effortFatigueMultiplier } from "./raceRoles.js";

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
 * @param {number|null|undefined} startFatigue
 * @param {string[]} profileTypes  etapeprofiler i etape-rækkefølge
 * @param {{effort?: 'protect'|'normal'|'save', efforts?: string[]}} [opts]
 * @returns {number[]} træthed ved START af hver etape (samme længde som profileTypes)
 */
export function stageEnteringFatigues(startFatigue, profileTypes, { effort = "normal", efforts } = {}) {
  let f = Number.isFinite(Number(startFatigue))
    ? Math.max(0, Math.min(100, Number(startFatigue)))
    : 0;
  const out = [];
  for (let i = 0; i < profileTypes.length; i++) {
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
      fatigue: Math.min(100, (Number(by.get(id)) || 0) + load * mult),
      updated_at: now.toISOString(),
    };
  });

  const { error: upErr } = await supabase
    .from("rider_condition")
    .upsert(rows, { onConflict: "rider_id" });
  if (upErr) throw new Error(`rider_condition upsert (race fatigue): ${upErr.message}`);

  return { updated: rows.length };
}
