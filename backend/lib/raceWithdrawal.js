// backend/lib/raceWithdrawal.js
// Race Hub Fase 0b: afmelding fra løb (frivillig deltagelse). Et (race_id, team_id)
// i race_withdrawals = holdet deltager ikke. Generator + afvikling respekterer det.

export async function withdrawTeam({ supabase, raceId, teamId, reason = null }) {
  const { error } = await supabase
    .from("race_withdrawals")
    .upsert({ race_id: raceId, team_id: teamId, withdrawn_reason: reason }, { onConflict: "race_id,team_id" });
  if (error) throw new Error(`race_withdrawals upsert: ${error.message}`);
}

export async function reinstateTeam({ supabase, raceId, teamId }) {
  const { error } = await supabase
    .from("race_withdrawals").delete().eq("race_id", raceId).eq("team_id", teamId);
  if (error) throw new Error(`race_withdrawals delete: ${error.message}`);
}

// Set af team_id der har trukket sig fra et løb.
export async function loadWithdrawnTeamIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_withdrawals").select("team_id").eq("race_id", raceId);
  if (error) throw new Error(`race_withdrawals select: ${error.message}`);
  return new Set((data || []).map((r) => r.team_id));
}
