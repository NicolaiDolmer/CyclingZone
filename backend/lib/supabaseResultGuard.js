// Security-audit 2026-06-12 (P3, #1338): Fælles guard der overflader Supabase-
// query-fejl i stedet for at lade dem blive slugt som tom historik.
//
// Baggrund: read-pipelines som riderHistory.js / teamTransferHistory.js itererede
// over `res.data || []`. Hvis en query fejlede (RLS-afvisning, timeout, mistet
// forbindelse) er `res.data` null og `res.error` sat — løkken kører bare over en
// tom liste, så et 500-niveau-problem returneres til klienten som en gyldig,
// tom handelshistorik. Det skjuler reelle fejl for både bruger og observability.
//
// Denne guard kaster en samlet Error med tabel-kontekst, så den propagerer op til
// rutens eksisterende try/catch (→ HTTP 500) og bliver synlig i logs/Sentry.

// `results` er et map fra et beskrivende navn (typisk tabel-navnet) til et
// Supabase-resultatobjekt ({ data, error }). Kaster hvis nogen har en `.error`.
export function assertNoSupabaseError(results, context = "supabase query") {
  const failed = [];
  for (const [name, res] of Object.entries(results || {})) {
    if (res && res.error) {
      const msg = res.error.message || res.error.code || String(res.error);
      failed.push(`${name}: ${msg}`);
    }
  }
  if (failed.length > 0) {
    const err = new Error(`${context} failed — ${failed.join("; ")}`);
    err.code = "SUPABASE_QUERY_ERROR";
    // Bevar de oprindelige fejl for observability (Sentry-extra etc.)
    err.supabaseErrors = failed;
    throw err;
  }
}
