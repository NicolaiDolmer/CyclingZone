// backend/lib/raceEntriesLoader.js
// Delt loader der gør det UMULIGT at glemme ghost-krydsningen ved en race_entries-
// læsning. #1893 indførte filterEligibleEntries men anvendte den kun to steder; de øvrige
// binding/lås-stier læste RÅ race_entries → en solgt/fyret/akademi/pensioneret
// rytter phantom-bandt en ægte rytter (rod-årsag #1906/#1823/#1800). Rut ALLE entry-
// læsninger gennem loadEligibleEntries, så krydsningen sker ét sted og aldrig glemmes.

import { selectInChunks, fetchAllPaged } from "./dbChunk.js";
import { filterEligibleEntries } from "./riderEligibility.js";

// baseQuery = thunk der returnerer en frisk, allerede team/race-scopet PostgREST-query
// på race_entries (kalderen sætter .select/.eq/.in/.neq, som varierer). paged=true →
// range-pagineret (felt-brede opslag der kan overstige PostgREST's 1000-cap).
// Returnerer { data: berettigede entries, error }. Henter rytter-tilstand og krydser
// via filterEligibleEntries. Entries SKAL have mindst { rider_id, team_id }.
export async function loadEligibleEntries({ supabase, baseQuery, paged = false }) {
  const { data: entries, error: entriesErr } = paged
    ? await fetchAllPaged(baseQuery)
    : await baseQuery();
  if (entriesErr) return { data: null, error: entriesErr };
  const rows = entries || [];
  if (!rows.length) return { data: [], error: null };

  const riderIds = [...new Set(rows.map((e) => e.rider_id))];
  const { data: riders, error: ridersErr } = await selectInChunks({
    supabase, table: "riders", columns: "id, team_id, is_academy, is_retired",
    inColumn: "id", ids: riderIds,
  });
  if (ridersErr) return { data: null, error: ridersErr };
  const ridersById = new Map((riders || []).map((r) => [r.id, r]));

  return { data: filterEligibleEntries({ entries: rows, ridersById }), error: null };
}
