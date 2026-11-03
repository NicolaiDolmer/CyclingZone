// #7488: eget modul, så frigivelses-stierne (contractExpiryRelease.js,
// retirementRelease.js) ikke trækker hele academyGraduation.js med ind i
// typecheck-baselinen.

/**
 * #7488: en automatisk frigivelse (kontraktudløb, pension) fjerner rytteren fra holdet
 * uden at røre graduerings-rækken. Luk en evt. 'pending' række lydløst (best-effort:
 * frigivelsen er allerede gennemført, så en fejl her må aldrig vælte den).
 */
export async function closePendingGraduationOnRelease(
  supabase: any,
  { teamId, riderId, now = new Date() }: { teamId?: string | null; riderId?: string | null; now?: Date } = {},
): Promise<void> {
  if (!supabase?.from || !teamId || !riderId) return;
  try {
    const { error } = await supabase.from("academy_graduation")
      .update({ status: "released", resolved_at: now.toISOString() })
      .eq("team_id", teamId).eq("rider_id", riderId).eq("status", "pending");
    if (error) throw new Error(error.message);
  } catch (err) {
    // best-effort: resolveGraduation har selv not_on_team-vagten, så en tilbageblevet række er ufarlig.
    console.error("closePendingGraduationOnRelease failed (%s):", riderId, err instanceof Error ? err.message : String(err));
  }
}
