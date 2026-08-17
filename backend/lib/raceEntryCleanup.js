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

// #3805/#3784: read-only variant af ovenstående SELECT (samme prædikat,
// INGEN delete) — bruges af academy-demote-quote-routen til at vise "N
// kommende løb ryddes" FØR bekræftelse, med samme forudsigelse som selve
// sletningen ovenfor rent faktisk udfører. Best-effort ligesom
// clearFutureRaceEntries ovenfor: en query-fejl her er en preview-tæller,
// ikke en mutation — 0 er en sikker fallback.
export async function countFutureRaceEntries(supabase, riderId) {
  if (!riderId) return 0;
  // pagination-safe: bundet til ÉT rider_id — en enkelt rytter kan aldrig
  // have tæt på 1000 race_entries (et helt sæson-kalenderår er en brøkdel af det).
  const { data, error } = await supabase
    .from("race_entries")
    .select("race_id, races!inner(status, stages_completed)")
    .eq("rider_id", riderId)
    .eq("races.status", "scheduled")
    .eq("races.stages_completed", 0);
  if (error) {
    console.warn(`[raceEntryCleanup] countFutureRaceEntries: count failed for rider ${riderId}: ${error.message}`);
    return 0;
  }
  return new Set((data || []).map((r) => r.race_id)).size;
}

// #3805: rytterens entries i løb der er IGANGVÆRENDE (status='scheduled' AND
// stages_completed>0 — startet, ikke afsluttet). demote_rider_to_academy-
// RPC'en rører ALDRIG disse rækker (resultat-/snapshot-invarians, se
// database/2026-06-25-academy-promote-demote.sql), men riderEligibility.js
// filtrerer is_academy=true fra ved udtagelse/afvikling — så rytteren falder
// reelt ud af feltet i et løb der er i gang, uden at nogen race_entries-række
// forsvinder. Root cause for #3805: dialogen talte KUN "fremtidige løb
// ryddet" (altid 0 for denne sag) og sagde derfor intet om det igangværende
// løb rytteren rent faktisk udgik af. SAMME funktion bruges af demote() (den
// faktiske konsekvens, logget/returneret efter flyttet) og af
// academy-demote-quote-routen (preview FØR bekræftelse) — ingen JS-kopi,
// ingen mulighed for at de to tal driver fra hinanden.
// pagination-safe: bundet til ÉT rider_id, se countFutureRaceEntries ovenfor.
// Best-effort af samme grund: en preview-tæller, ikke en mutation.
export async function countOngoingRaceEntries(supabase, riderId) {
  if (!riderId) return 0;
  const { data, error } = await supabase
    .from("race_entries")
    .select("race_id, races!inner(status, stages_completed)")
    .eq("rider_id", riderId)
    .eq("races.status", "scheduled")
    .gt("races.stages_completed", 0);
  if (error) {
    console.warn(`[raceEntryCleanup] countOngoingRaceEntries: count failed for rider ${riderId}: ${error.message}`);
    return 0;
  }
  return new Set((data || []).map((r) => r.race_id)).size;
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
