// Security-audit 2026-06-12 (P4, #1338): Escape LIKE/ILIKE-wildcards i bruger-
// input der bruges som EXACT-match via .ilike() (ikke substring-søgning).
//
// PostgreSQL LIKE/ILIKE fortolker `%` (vilkårlig længde) og `_` (ét tegn) som
// wildcards, med `\` som default escape-tegn. Når et bruger-input forventes at
// matche en præcis værdi (fx unikt holdnavn), må disse tegn IKKE virke som
// wildcards — ellers kan navnet "%" matche alle rækker (falsk unikheds-konflikt)
// eller "Te_m" utilsigtet kollidere med "Team".
//
// Brug KUN til exact-match-checks. Til bevidste substring-søgninger (`%${q}%`)
// er wildcard-injektion harmløs (udvider kun søgeresultatet), og escaping ville
// fjerne forventet søge-funktionalitet.
export function likeEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\") // backslash først, ellers dobbelt-escaper vi de næste
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
