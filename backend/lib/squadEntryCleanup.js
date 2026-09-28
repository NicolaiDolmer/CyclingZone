// #5843 (ejer-regel 28/9): et løb bruger KUN ryttere fra løbets egen trup
// (senior → senior, U23 → U23, junior → junior).
//
// Hullet: en rytter der er udtaget (typisk auto, late_fill) til et løb i sin
// gamle trup og derefter flyttes til en anden trup, blev stående i det løb.
// promote() (ungdom → senior) og move_academy_rider_squad (junior ↔ U23)
// ændrer kun riders.squad; kun demote-RPC'en rydder fremtidige entries.
// Prod 28/9 07:52: seniorer i U23-/juniorløb og U23-ryttere i juniorløb, og
// deres gamle entry bandt stadig løbsdagen.
//
// Løbsmotoren sorterer allerede forkert-trup-entries fra ved start
// (riderEligibility.filterEligibleEntries med løbets squad), og udtagelsen
// afviser dem ved gem. Denne oprydning fjerner selve rækken, så den hverken
// binder rytterens løbsdag eller ser ud som en udtagelse.
//
// Kun løb der ikke er startet (status 'scheduled', 0 kørte etaper): et
// igangværende løbs startfelt er låst (#1825), og flytningen afvises alligevel
// midt i et etapeløb (rider_in_stage_race).

// Samme regel som riderEligibility.raceSquadOf (manglende/ukendt squad = senior).
// Bevidst lokal: academyTransfer.js er i tsconfig.core.json, og en import af
// riderEligibility trækker hele løbsmotorens utypede graf med i typechecket.
const YOUTH_SQUADS = new Set(["u23", "junior"]);
/** @param {{squad?: string|null}|null|undefined} race */
function raceSquadOf(race) {
  const squad = race?.squad;
  return squad && YOUTH_SQUADS.has(squad) ? squad : "senior";
}

/**
 * Ren regel: hvilke af rytterens entries hører til en anden trup end `squad`?
 * @param {Array<{race_id: string, races?: {squad?: string|null, status?: string, stages_completed?: number|null}|null}>|null|undefined} entries
 * @param {string} squad
 * @returns {string[]}
 */
export function offSquadOpenRaceIds(entries, squad) {
  const ids = new Set();
  for (const e of entries || []) {
    const race = e?.races;
    if (!race) continue;
    if (race.status !== "scheduled" || (race.stages_completed ?? 0) > 0) continue;
    if (raceSquadOf(race) !== squad) ids.add(e.race_id);
  }
  return [...ids];
}

/**
 * Slet rytterens entries i ikke-startede løb for en anden trup end `squad`.
 * @param {any} supabase
 * @param {{riderId: string, squad: string}} args
 * @returns {Promise<{cleared:number}>}
 */
export async function clearOffSquadEntries(supabase, { riderId, squad }) {
  // pagination-safe: én rytters entries i én sæsons kommende løb, få rækker.
  const { data, error } = await supabase
    .from("race_entries")
    .select("race_id, races!inner(squad, status, stages_completed)")
    .eq("rider_id", riderId);
  if (error) throw new Error(`race_entries (off-squad scan): ${error.message}`);
  const raceIds = offSquadOpenRaceIds(data, squad);
  if (!raceIds.length) return { cleared: 0 };
  const { error: delErr } = await supabase
    .from("race_entries").delete()
    .eq("rider_id", riderId)
    .in("race_id", raceIds);
  if (delErr) throw new Error(`race_entries (off-squad delete): ${delErr.message}`);
  return { cleared: raceIds.length };
}
