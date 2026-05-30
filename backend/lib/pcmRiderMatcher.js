// Matcher PCM-rytternavne ("Firstname Lastname") → riders.id i CyclingZone.
//
// PCM-filerne giver kun fuldt navn som én streng. Den eksisterende
// Excel/Sheets-import brugte `lastname ILIKE '%token%'` LIMIT 1 — farligt:
// "Nielsen" gav 8 træffere, "Oliveira" 10, "Cort" 3. Det kan attribuere
// point til den forkerte rytter.
//
// Verificeret mod prod (2026-05-30): når PCM-navne sammenholdes på
// lower(firstname||' '||lastname) matcher de ENTYDIGT (inkl. accenter:
// Lukáš Kubiš, Maël Guégan, Magnus Cort Nielsen). Vi matcher derfor på
// fuldt navn, med accent-foldet fallback, og flagger ægte tvetydighed
// som "unmatched" frem for at gætte.

import { resolvePcmRiderName } from "./pcmRiderAliases.js";

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
// æ (U+00E6) har INGEN dekomposition, så en PCM-"Soren Waerenskjold"
// matcher ellers ikke DB-"Søren Wærenskjold". Dette er sidste fold-fallback
// før et navn flagges unmatchet. (å medtages eksplicit for robusthed selvom
// NFD allerede dækker det.)
export function foldNameNordic(s) {
  return foldName(s)
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a");
}

// Byg et matcher-objekt fra alle riders. Loader hele riders-tabellen én gang
// (8.7k rækker, ét kald) og indekserer på fuldt navn + accent-foldet navn.
//
// Returnerer: { match(fullName) -> { riderId, teamId, status } }
//   status: "exact" | "folded" | "nordic" | "ambiguous" | "missing"
//   ("exact"/"folded"/"nordic" kan også være ramt via et verificeret alias)
export async function buildRiderMatcher(supabase) {
  const { data: riders, error } = await supabase
    .from("riders")
    .select("id, firstname, lastname, team_id");
  if (error) throw new Error(`Kunne ikke hente riders: ${error.message}`);

  // Indeks: exact (med accenter), folded (accent-fold) og nordic (ø/æ/å-fold).
  // Værdi-arrays for at fange ægte dubletter → tvetydighed.
  const exactIndex = new Map(); // lower("first last") -> [rider, ...]
  const foldedIndex = new Map(); // fold("first last") -> [rider, ...]
  const nordicIndex = new Map(); // foldNordic("first last") -> [rider, ...]

  for (const r of riders || []) {
    const full = `${r.firstname || ""} ${r.lastname || ""}`.replace(/\s+/g, " ").trim();
    const exactKey = full.toLowerCase();
    const foldedKey = foldName(full);
    const nordicKey = foldNameNordic(full);
    if (!exactIndex.has(exactKey)) exactIndex.set(exactKey, []);
    exactIndex.get(exactKey).push(r);
    if (!foldedIndex.has(foldedKey)) foldedIndex.set(foldedKey, []);
    foldedIndex.get(foldedKey).push(r);
    if (!nordicIndex.has(nordicKey)) nordicIndex.set(nordicKey, []);
    nordicIndex.get(nordicKey).push(r);
  }

  function match(fullName) {
    const raw = String(fullName || "").replace(/\s+/g, " ").trim();
    if (!raw) return { riderId: null, teamId: null, status: "missing" };

    // 0) Manuelt verificeret alias har forrang (samme princip som hold-alias).
    // resolvePcmRiderName er identitet for navne uden alias-entry, så et reelt
    // alias der peger på et ikke-eksisterende DB-navn ender alligevel "missing"
    // (ingen falsk attribution).
    const cleaned = resolvePcmRiderName(raw);

    // 1) Eksakt (med accenter) — entydigt?
    const exact = exactIndex.get(cleaned.toLowerCase());
    if (exact && exact.length === 1) {
      return { riderId: exact[0].id, teamId: exact[0].team_id || null, status: "exact" };
    }
    if (exact && exact.length > 1) {
      return { riderId: null, teamId: null, status: "ambiguous" };
    }

    // 2) Accent-foldet — entydigt?
    const folded = foldedIndex.get(foldName(cleaned));
    if (folded && folded.length === 1) {
      return { riderId: folded[0].id, teamId: folded[0].team_id || null, status: "folded" };
    }
    if (folded && folded.length > 1) {
      return { riderId: null, teamId: null, status: "ambiguous" };
    }

    // 3) Nordisk-foldet (ø/æ/å) — entydigt? Sidste fallback før unmatchet.
    const nordic = nordicIndex.get(foldNameNordic(cleaned));
    if (nordic && nordic.length === 1) {
      return { riderId: nordic[0].id, teamId: nordic[0].team_id || null, status: "nordic" };
    }
    if (nordic && nordic.length > 1) {
      return { riderId: null, teamId: null, status: "ambiguous" };
    }

    return { riderId: null, teamId: null, status: "missing" };
  }

  return { match, riderCount: (riders || []).length };
}

// Byg et hold-matcher: game-holdnavn → team_id. Loader alle teams én gang.
// PCM-holdnavne resolves først via pcmTeamAliases.resolvePcmTeamName, og det
// resulterende game-navn slås op her (eksakt, case-insensitivt).
export async function buildTeamMatcher(supabase) {
  const { data: teams, error } = await supabase.from("teams").select("id, name, is_ai, is_bank");
  if (error) throw new Error(`Kunne ikke hente teams: ${error.message}`);

  const byName = new Map(); // lower(name) -> team
  for (const t of teams || []) {
    byName.set(String(t.name || "").toLowerCase().trim(), t);
  }

  // gameName er allerede alias-resolved (det rigtige CyclingZone-holdnavn).
  function matchGameName(gameName) {
    const t = byName.get(String(gameName || "").toLowerCase().trim());
    if (!t) return { teamId: null, status: "missing" };
    return { teamId: t.id, status: "exact", isAi: t.is_ai, isBank: t.is_bank };
  }

  return { matchGameName, teamCount: (teams || []).length };
}
