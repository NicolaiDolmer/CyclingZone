// #5435 (D-049) — rating-VISNINGEN er "bedste rolle nu" (model A) på alle flader.
//
// #6853: app_config-flaget `rider_best_role_display` var tændt for alle og er
// pensioneret. Den gamle visning (rating = egen rolle) og flag-hentningen er
// fjernet; der er ikke længere nogen kontakt at slå fra.
//
// Modulet består kun som fælles kilde for de flader der stadig spørger
// "er bedste-rolle-visningen tændt?" (useBestRoleDisplay.js m.fl.). Svaret er
// altid ja, og der kommer aldrig en ændring at abonnere på.
//
// Ren .js uden React-import, så node --test kan loade riderRating.js.

export function isBestRoleDisplayOn() {
  return true;
}

export function subscribeBestRoleDisplay() {
  return () => {};
}
