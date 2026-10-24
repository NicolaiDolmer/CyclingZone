// Navne-fold-util (accent- og nordisk-fold) til navne-sammenligning.
//
// Filen var oprindeligt PCM-resultatimportens rytter/hold-matcher. Selve
// matcherne (buildRiderMatcher/buildTeamMatcher) blev slettet sammen med
// PCM-resultatimporten 2026-10-24 (#7082); fold-funktionerne bruges stadig af
// ikke-PCM-kode (academyIntake, fictionalRiderGenerator, relaunchOrchestrator,
// starterSquadAllocator m.fl.) og bor derfor her indtil de flyttes til et
// neutralt navne-modul.

// Accent-fold: fjern diakritik så "Guégan" == "Guegan". unaccent-extension
// er IKKE installeret i prod, så vi folder i JS via NFD-normalisering.
export function foldName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Nordisk-fold: oven på accent-fold også ø→o, æ→ae, å→a. NFD-folden over
// dækker é/í/š/č OG å (U+00E5 dekomponerer til a+ring), men ø (U+00F8) og
// æ (U+00E6) har INGEN dekomposition, så "Soren Waerenskjold" matcher ellers
// ikke "Søren Wærenskjold". (å medtages eksplicit for robusthed selvom NFD
// allerede dækker det.)
export function foldNameNordic(s) {
  return foldName(s)
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a");
}
