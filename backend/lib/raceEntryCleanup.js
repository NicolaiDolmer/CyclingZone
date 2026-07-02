// backend/lib/raceEntryCleanup.js
// Defense-in-depth (app-lag): når en rytter forlader holdet / bliver akademi /
// pensioneres, ryd hans FREMTIDIGE (endnu ikke afviklede) race_entries med det samme,
// så de aldrig hænger ved som ghost og phantom-binder en ægte rytter. Spejler præcis
// demote_rider_to_academy-RPC'ens prædikat (races.status='scheduled' AND
// stages_completed=0) — rører ALDRIG historik (completed) eller igangværende (frosne)
// felter. Idempotent med DB-triggeren (2026-06-26-ghost-race-entries-trigger.sql): begge
// sletter samme rækker, så det er ufarligt at have begge (defense-in-depth).
//
// Best-effort: kalderen bør logge en evt. fejl men IKKE crashe afgangs-handlingen
// (salget/fyringen er allerede sket; en manglende entry-oprydning fanges af triggeren).

// Slet én rytters fremtidige entries. Returnerer { cleared, error } (cleared = antal løb).
export async function clearFutureRaceEntries({ supabase, riderId }) {
  if (!riderId) return { cleared: 0, error: null };
  // Find rytterens entries i endnu-ikke-afviklede løb (inner-join races for status+stages).
  const { data: future, error: selErr } = await supabase
    .from("race_entries")
    .select("race_id, races!inner(status, stages_completed)")
    .eq("rider_id", riderId)
    .eq("races.status", "scheduled")
    .eq("races.stages_completed", 0);
  if (selErr) return { cleared: 0, error: selErr };
  const raceIds = [...new Set((future || []).map((r) => r.race_id))];
  if (!raceIds.length) return { cleared: 0, error: null };

  const { error: delErr } = await supabase
    .from("race_entries").delete().eq("rider_id", riderId).in("race_id", raceIds);
  if (delErr) return { cleared: 0, error: delErr };
  return { cleared: raceIds.length, error: null };
}

// Bekvemmeligheds-wrapper til afgangs-stier: rydder + logger uden at kaste (afgangen er
// allerede sket; triggeren er backstop). Tag et label med til loggen for sporbarhed.
export async function clearFutureRaceEntriesSafe({ supabase, riderId, label = "departure" }) {
  try {
    const { cleared, error } = await clearFutureRaceEntries({ supabase, riderId });
    if (error) {
      console.warn(`[raceEntryCleanup] ${label}: kunne ikke rydde fremtidige entries for rytter ${riderId}: ${error.message}`);
      return 0;
    }
    if (cleared) console.log(`[raceEntryCleanup] ${label}: ryddede ${cleared} fremtidige race_entries for rytter ${riderId}`);
    return cleared;
  } catch (err) {
    console.warn(`[raceEntryCleanup] ${label}: undtagelse ved oprydning for rytter ${riderId}: ${err.message}`);
    return 0;
  }
}
