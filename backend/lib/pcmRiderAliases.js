// PCM (Pro Cycling Manager) rytternavn → CyclingZone DB-fuldnavn.
//
// PCM-filerne giver fuldt navn som én streng ("Firstname Lastname").
// pcmRiderMatcher matcher dem mod riders via eksakt navn + accent-fold +
// nordisk-fold (ø/æ/å). De fleste varianter dækkes automatisk, men PCM
// bruger lejlighedsvis en navnevariant for samme rytter som ingen fold
// fanger (omvendt navnerækkefølge, mellemnavn, alternativ stavning).
//
// Denne tabel er — som hold-aliasene i pcmTeamAliases.js — MANUELT
// verificeret (PCM-navn → DB-navn), aldrig fuzzy-gættet. Det forhindrer
// at point/præmie attribueres til den forkerte rytter. Konsulteres som
// FØRSTE skridt i match() (forrang frem for fold), præcis som
// resolvePcmTeamName kaldes før hold-opslaget.
//
// ── Sådan udvides tabellen ────────────────────────────────────────
// Drivende kilde = live-importens "Umatch. scorende ⚠"-kolonne. Når et
// PCM-navn dukker op dér og du har bekræftet hvilken DB-rytter det er,
// tilføj en linje: "PCM-navn": "DB-fuldnavn (firstname lastname)".
//
// Initialt tom: harness mod 11 sæson-1-filer + prod-DB (2026-05-30) gav
// 0 unmatchede scorende. Strukturen er forebyggende — klar når første
// hul opstår (#770).

// Normalisér til opslagsnøgle: trim + collapse whitespace. Bevarer tegn/case
// så vi ikke utilsigtet kolliderer to forskellige navne.
export function normalizePcmRiderName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

// Nøgler er normaliserede PCM-navne; værdier er det nøjagtige DB-fuldnavn
// ("firstname lastname"). Tom indtil live-importen viser et reelt hul.
export const PCM_RIDER_ALIASES = {
  // Eksempel (udkommenteret — fjern når et reelt match er verificeret):
  // "Tobias Halland Johannessen": "Tobias Johannessen",
};

// Returnér det DB-fuldnavn et PCM-rytternavn svarer til (alias eller uændret).
// Det endelige navn→rider-opslag sker mod riders-indekset i matcheren.
export function resolvePcmRiderName(pcmName) {
  const norm = normalizePcmRiderName(pcmName);
  return PCM_RIDER_ALIASES[norm] || norm;
}
