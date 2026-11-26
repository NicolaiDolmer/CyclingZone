// #8797 — nationaliteterne til rytterlistens filter.
//
// Før: nationality_code for ALLE aktive ryttere, distinct i browseren. Over 1.000
// ryttere afkortede PostgREST svaret stille, så filtret manglede nationer.
// Nu: viewet rider_nationality_codes laver distinct i databasen (én række pr. nation).
// Indtil migrationen er kørt (eller hvis viewet fejler) falder vi tilbage til den
// gamle læsning, men pagineret, så resultatet er komplet i begge tilfælde.

const PAGE_SIZE = 1000;

type NationalityRow = { nationality_code: string | null };
type QueryResult = { data: NationalityRow[] | null; error: unknown };

// Bevidst løs type: kaldes med den typede browser-klient, og viewet findes først i
// database.types.ts når typerne regenereres efter migrationen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseSupabase = { from: (table: string) => any };

function uniqueSorted(rows: NationalityRow[] | null): string[] {
  const codes = (rows || []).map((r) => r.nationality_code).filter((c): c is string => Boolean(c));
  return [...new Set(codes)].sort();
}

export async function loadRiderNationalities(supabase: LooseSupabase): Promise<string[]> {
  const view: QueryResult = await supabase.from("rider_nationality_codes").select("nationality_code")
    .order("nationality_code").range(0, PAGE_SIZE - 1);
  if (!view.error && view.data) return uniqueSorted(view.data);

  const rows: NationalityRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error }: QueryResult = await supabase.from("riders").select("nationality_code")
      .eq("is_retired", false).neq("nationality_code", null)
      .order("id").range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return uniqueSorted(rows);
}
