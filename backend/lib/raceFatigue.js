// Trætheds-belastning pr. løbsdag (#1306, spec 6.4). Kalibreres i race:gate/training:gate.
//
// Upsert-semantik (supabase-js): ved konflikt (rider_id eksisterer) opdateres KUN
// de angivne kolonner (fatigue, updated_at). Kolonner der ikke er med i upsert-rækken
// (fx form, injured_until) berøres ikke på UPDATE-stien. På INSERT-stien (ny række)
// træder DB-defaults i kraft — form har DEFAULT 50 og sættes automatisk. Det er præcis
// den ønskede adfærd: vi opdaterer kun træthed, rører aldrig form.

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
