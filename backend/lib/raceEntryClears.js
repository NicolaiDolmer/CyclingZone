// backend/lib/raceEntryClears.js
// #2599: eksplicitte "ryd"-markeringer. En række i `race_entry_clears` betyder at
// spilleren har trykket "Ryd dag"/"Ryd alt", bekræftet dialogen, og dermed sagt at
// netop denne (race, team)-enhed skal stå tom. Markeringen slettes automatisk igen
// når spilleren selv udtager manuelt (raceSelection.js) eller selv beder om
// auto-fill/udfyld-manglende (/races/distribution/regenerate) — først da må en
// assistent-sti fylde ud igen.
//
// Hvorfor tabellen findes: FØR den fandtes var et tomt race_entries-sæt umuligt at
// skelne fra "aldrig rørt". Den skelnen er hele pointen — #4174's ejer-beslutning
// ("har man ikke udtaget en time før, udtager assistenten") gælder hold der IKKE har
// valgt, ikke hold der har valgt tomt og bekræftet det.
//
// #4200 anden halvdel: markeringen blev respekteret af den proaktive sweep
// (raceEntryGenerator.js) men IKKE af løbs-tidens autofyld (raceRunner.
// fillMissingTeamEntries), som er den anden — og sidste — push-sti. Tre spillere
// rapporterede 24/8 at ryddede trupper kom tilbage. #4222 lukkede sweepen ved at
// springe hold med en ejer over; denne fil lukker løbs-tids-stien.
//
// NB: en ryddet enhed er IKKE en afmelding. Holdet er stadig tilmeldt løbet
// (race_withdrawals er den separate mekanik) — det stiller bare ingen ryttere.

// Set af team_id der eksplicit har ryddet deres udtagelse til ét løb.
export async function loadClearedTeamIds({ supabase, raceId }) {
  const { data, error } = await supabase
    .from("race_entry_clears").select("team_id").eq("race_id", raceId);
  if (error) throw new Error(`race_entry_clears select: ${error.message}`);
  return new Set((data || []).map((r) => r.team_id));
}
