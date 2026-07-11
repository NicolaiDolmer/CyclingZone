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
 * -30%"). DORMANT seam: default 'normal' → multiplikator 1.0 → adfærd UÆNDRET
 * (bit-identisk med før S1). raceRunner.js kalder i dag altid med 'normal'
 * (ingen per-etape effort-datamodel findes endnu — det er S3's
 * race_stage_roles-tabel); denne funktion er klar til at modtage rigtige
 * værdier uden signaturændring, samme mønster som #1306's form/fatigue-seams.
 *
 * @param {number|null|undefined} startFatigue
 * @param {string[]} profileTypes  etapeprofiler i etape-rækkefølge
 * @param {{effort?: 'protect'|'normal'|'save'}} [opts]
 * @returns {number[]} træthed ved START af hver etape (samme længde som profileTypes)
 */
export function stageEnteringFatigues(startFatigue, profileTypes, { effort = "normal" } = {}) {
  let f = Number.isFinite(Number(startFatigue))
    ? Math.max(0, Math.min(100, Number(startFatigue)))
    : 0;
  const mult = effortFatigueMultiplier(effort);
  const out = [];
  for (const p of profileTypes) {
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
 * @param {{ supabase, riderIds: string[], profileType: string, now?: Date }}
 * @returns {{ updated: number }}
 */
export async function applyRaceFatigue({ supabase, riderIds, profileType, now = new Date() }) {
  if (!riderIds?.length) return { updated: 0 };
  const load = raceFatigueLoad(profileType);

  const { data, error } = await supabase
    .from("rider_condition")
    .select("rider_id, fatigue")
    .in("rider_id", riderIds);
  if (error) throw new Error(`rider_condition (race fatigue): ${error.message}`);

  const by = new Map((data ?? []).map((r) => [r.rider_id, r.fatigue]));
  const rows = riderIds.map((id) => ({
    rider_id: id,
    fatigue: Math.min(100, (Number(by.get(id)) || 0) + load),
    updated_at: now.toISOString(),
  }));

  const { error: upErr } = await supabase
    .from("rider_condition")
    .upsert(rows, { onConflict: "rider_id" });
  if (upErr) throw new Error(`rider_condition upsert (race fatigue): ${upErr.message}`);

  return { updated: rows.length };
}
