// #8797 — nationaliteterne til rytterlistens filter.
//
// Før: nationality_code for ALLE aktive ryttere, distinct i browseren. Over 1.000
// ryttere afkortede PostgREST svaret stille, så filtret manglede nationer.
// Nu: viewet rider_nationality_codes laver distinct i databasen (én række pr. nation).
// Indtil migrationen er kørt (eller hvis viewet fejler) falder vi tilbage til den
// gamle læsning, men pagineret, så resultatet er komplet i begge tilfælde.

const PAGE_SIZE = 1000;

function uniqueSorted(rows) {
  return [...new Set((rows || []).map((r) => r.nationality_code).filter(Boolean))].sort();
}

/** @param {any} supabase @returns {Promise<string[]>} */
export async function loadRiderNationalities(supabase) {
  const view = await supabase.from("rider_nationality_codes").select("nationality_code")
    .order("nationality_code").range(0, PAGE_SIZE - 1);
  if (!view.error && view.data) return uniqueSorted(view.data);

  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from("riders").select("nationality_code")
      .eq("is_retired", false).neq("nationality_code", null)
      .order("id").range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return uniqueSorted(rows);
}
