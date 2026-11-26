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

// Bevidst smal strukturel type: kaldes med browser-klienten, og viewet findes først i
// database.types.ts når typerne regenereres efter migrationen.
interface NationalityQuery {
  select(columns: string): NationalityQuery;
  eq(column: string, value: unknown): NationalityQuery;
  neq(column: string, value: unknown): NationalityQuery;
  order(column: string): NationalityQuery;
  range(from: number, to: number): PromiseLike<QueryResult>;
}
type LooseSupabase = { from: (table: string) => NationalityQuery };

function uniqueSorted(rows: NationalityRow[] | null): string[] {
  const codes = (rows || []).map((r) => r.nationality_code).filter((c): c is string => Boolean(c));
  return [...new Set(codes)].sort();
}

export async function loadRiderNationalities(client: unknown): Promise<string[]> {
  const supabase = client as LooseSupabase;
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
