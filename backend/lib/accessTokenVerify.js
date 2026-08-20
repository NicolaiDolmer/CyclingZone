// Verifikation af Supabase access tokens for backendens auth-middleware (#4010).
//
// Baggrund: `requireAuth` kaldte `supabase.auth.getUser(token)` på HVER request.
// Det er et HTTP-kald til GoTrue, som selv laver fem queries mod databasen
// (sessions, mfa_amr_claims, identities, mfa_factors, users). Målt i
// pg_stat_statements over 23 timer 19.-20./8: 110.938 getUser-kald → ~515.000
// DB-queries, alene for at bekræfte tokens vi kan verificere selv.
//
// Projektets JWT'er er ES256 (284.020 af 284.218 målte requests i edge_logs), så
// signeringsnøglerne er asymmetriske. `getClaims()` henter da JWKS'et én gang,
// cacher det i processen og verificerer signaturen lokalt med WebCrypto — nul
// netværkskald i den varme sti.
//
// Sikkerhedsnettet er indbygget i auth-js selv: er algoritmen symmetrisk (HS*),
// mangler `kid`, eller er WebCrypto utilgængeligt, kalder getClaims internt
// getUser() og fejler hvis serveren afviser tokenet
// (@supabase/auth-js@2.112.2, GoTrueClient.js:5339-5359). Skiftet kan derfor
// ikke lukke et uverificeret token igennem.
//
// Prisen ved lokal verifikation: den ser signatur og udløb, ikke om sessionen er
// blevet tilbagekaldt. Et token fra en session der logges ud accepteres indtil
// det udløber — målt TTL er 3.600 s. Det er afvejningen Supabase selv anbefaler
// for den almindelige sti. Kald med { strict: true } for ruter hvor det vindue
// ikke er acceptabelt (admin) — så køres fuld server-side verifikation.

/**
 * @returns {Promise<{ id: string, email: string | null } | null>} null = afvist.
 */
export async function verifyAccessToken(supabase, token, { strict = false } = {}) {
  if (typeof token !== "string" || token.length === 0) return null;

  if (strict) {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }

  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  // `sub` er brugerens UUID. Mangler den, er tokenet ikke et bruger-token
  // (fx service_role) og hører ikke hjemme på en spiller-rute.
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: claims.email ?? null };
}
