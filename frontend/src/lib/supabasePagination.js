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
//
// #4581: sider hentes IKKE længere sekventielt (side 1, vent, side 2, vent, ...).
// Et Grand Tour-løb (Giro della Penisola, 14/18 etaper) målte 11.947 rækker/2,43 MB
// / 12 sekventielle round-trips à ~300ms = ~4s load. Supabase-js's query-builder kan
// ikke tilføje `{ count: "exact", head: true }` oven på en allerede-bygget kæde uden
// at ændre kalder-kontrakten (14 kaldere ville skulle bygge count-varianten selv) —
// se PR-beskrivelsen for #4581 for hvorfor count-strategien blev fravalgt. I stedet:
// side 1 hentes ALENE (den afgør om der overhovedet er en side 2 — de fleste queries
// er kun ÉN side); er den fuld, hentes resten PARALLELT i bølger af PARALLEL_WAVE
// samtidige round-trips i stedet for én ad gangen, og stopper så snart en side i
// bølgen er kort (ufuldstændig = sidste side). For Giro-eksemplet: 12 sekventielle
// round-trips → 3 (side 1 + 2 bølger). Kontrakten fetchAllRows(buildQuery, pageSize)
// er UÆNDRET — alle 14 eksisterende kaldere virker uden ændringer.
//
// Rækkefølge er garanteret: Promise.all bevarer input-rækkefølgen (ikke
// resolve-rækkefølgen), og siderne hentes i stigende offset-orden både i og på
// tværs af bølger — kalderens stabile .order() gør resten.
const PAGE_SIZE = 1000;
const PARALLEL_WAVE = 6;

// buildQuery: () => en Supabase-query-builder (med .order()) uden .range().
// Returnerer alle rækker på tværs af sider, i rækkefølge. Kaster ved Supabase-fejl.
export async function fetchAllRows(buildQuery, pageSize = PAGE_SIZE) {
  // Side 1 hentes alene og AFGØR om der er mere at hente — langt de fleste
  // frontend-loads er kun én side, og skal ikke betale for en ekstra parallel
  // "gæt"-forespørgsel de facto altid er spildt.
  const { data: firstData, error: firstError } = await buildQuery().range(0, pageSize - 1);
  if (firstError) throw firstError;
  const firstRows = firstData || [];
  if (firstRows.length < pageSize) return firstRows;

  const rows = [...firstRows];
  let from = pageSize;
  let short = false;
  while (!short) {
    const wave = Array.from({ length: PARALLEL_WAVE }, (_, i) => from + i * pageSize);
    // Bevidst: én PARALLEL bølge ad gangen (Promise.all nedenfor), ikke sekventielt pr. side.
    const results = await Promise.all(wave.map((f) => buildQuery().range(f, f + pageSize - 1)));
    for (const { data, error } of results) {
      if (error) throw error;
      const pageRows = data || [];
      rows.push(...pageRows);
      if (pageRows.length < pageSize) short = true;
    }
    from += PARALLEL_WAVE * pageSize;
  }
  return rows;
}
