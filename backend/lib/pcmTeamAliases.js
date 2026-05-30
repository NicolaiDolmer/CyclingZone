// PCM (Pro Cycling Manager) holdnavn → CyclingZone game-holdnavn.
//
// PCM's "Team results"-fane angiver PCM-squad'ens navn (fx "Swatt Club").
// I CyclingZone har managere egne holdnavne. 19 af sæson-1-holdene er den
// samme PCM-squad som et game-hold; nogle har en navnevariant, nogle er
// custom-omdøbt. Denne tabel er MANUELT verificeret mod prod-`teams`
// (sæson 1, 2026-05-30) — ikke fuzzy-gættet — så hold-attribution er fejlfri.
//
// Kun PCM-navne der AFVIGER fra game-navnet står her. Eksakte match
// (Bahrain Victorious, Camp Cycling Team, …) resolves direkte mod teams.
//
// PCM-hold uden game-ejer (AI-squads i sæson 1) → ingen hold-point:
// Caja Rural-Seguros RGA, Cofidis, Pinarello-Q36.5 Pro Cycling Team,
// Tudor Pro Cycling Team, Unibet Rose Rockets.
// "Inuit Cycling" er et game-hold uden aktiv PCM-squad i sæson 1.

// Normalisér til opslagsnøgle: trim + collapse whitespace. Bevarer tegn/case
// så vi ikke utilsigtet kolliderer (fx "Swatt Club" vs "Swatt Team").
export function normalizePcmTeamName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

// Nøgler er normaliserede PCM-navne; værdier er det nøjagtige game-holdnavn.
export const PCM_TEAM_ALIASES = {
  "Above + Beyond Cancer Cycling": "Above & Beyond Cancer Cycling",
  "Team Hopplà": "Hopplà Team",
  "Red Bull - BORA - hansgrohe": "Red Bull - BORA-Hansgrohe",
  "Swatt Club": "Swatt Team",
  "VolkerWessels Cycling Team": "Team WolkerWessels",
  "Team Trululu Grupo La Guacamaya": "Trululu La Guacamaya",
  "Team UKYO": "Vestas - Vov Vov Cycling",
  TotalEnergies: "Chris Machines",
};

// PCM-hold der bevidst IKKE har en game-ejer (AI-squads). Bruges kun til at
// dæmpe støj i dry-run-rapporten — importen fejler ikke på dem.
export const PCM_TEAMS_WITHOUT_OWNER = new Set([
  "Caja Rural-Seguros RGA",
  "Cofidis",
  "Pinarello-Q36.5 Pro Cycling Team",
  "Tudor Pro Cycling Team",
  "Unibet Rose Rockets",
]);

// Returnér det game-holdnavn et PCM-holdnavn svarer til (alias eller uændret).
// Den endelige navn→team_id-opslag sker mod DB i pipelinen.
export function resolvePcmTeamName(pcmName) {
  const norm = normalizePcmTeamName(pcmName);
  return PCM_TEAM_ALIASES[norm] || norm;
}
