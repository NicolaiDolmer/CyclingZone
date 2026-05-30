// Kanonisk paginering for Supabase-queries i frontend.
//
// PostgREST capper svar ved db-max-rows (1000 på dette projekt) — også når man
// beder om .range(0, 9999). Et naivt .select() eller .range(0, N) returnerer
// derfor stille kun de første 1000 rækker. På race_results (sæson 1 har ~2.2k
// rækker) gav det forkerte rytter-rangliste/resultat-aggregeringer.
//
// Brug denne helper til ALLE frontend-loads der kan overstige 1000 rækker.
// VIGTIGT: buildQuery SKAL inkludere en stabil .order() (fx .order("id")), ellers
// kan sider overlappe/springe rækker.

const PAGE_SIZE = 1000;

// buildQuery: () => en Supabase-query-builder (med .order()) uden .range().
// Returnerer alle rækker på tværs af sider. Kaster ved Supabase-fejl.
export async function fetchAllRows(buildQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
