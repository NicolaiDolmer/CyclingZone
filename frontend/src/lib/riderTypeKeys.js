// Ryttertype-nøgler (#49) — frontend-spejl af RIDER_TYPE_KEYS i
// backend/lib/riderTypes.js. KUN nøgle-listen (enum), ikke formlerne: frontend
// beregner ikke typer, den læser de persisterede riders.primary_type/
// secondary_type-kolonner og slår labels op i `riderTypes`-i18n-namespacet.
//
// Rækkefølgen matcher backend (tie-break-prioritet) og bruges som dropdown-orden.
export const RIDER_TYPE_KEYS = Object.freeze([
  "sprinter", "tt", "climber", "puncheur",
  "brostensrytter", "baroudeur", "rouleur", "gc",
]);
