// Deterministisk AI-holdnavne-generator (#1688). Holdt adskilt fra aiTeamGenerator
// så navne-pools + navne-mekanikken kan testes/udvides isoleret.
//
// Navne følger et cykelhold-mønster (sponsor + suffix), med et AI-præfiks så de er
// trivielt skelnelige fra ægte managerhold i intern logging/admin (player-facing
// vises de blot som almindelige hold). Determinisme: navn vælges af et per-hold seed
// (basis XOR hash(pulje:indeks)), så en replay giver identiske navne. Ved kollision
// (samme pulje-seed-rum eller eksisterende navn) tilføjes et numerisk suffix.

import { makeRng } from "./fictionalRiderGenerator.js";
import { hashStringToSeed } from "./starterSquadAllocator.js";
import { fetchAllRows } from "./supabasePagination.js";

// Intern markør så AI-hold er skelnelige i logs/admin. Player-facing UI viser
// holdets `name` som det er — præfikset er en del af navnet (bevidst, så et AI-felt
// aldrig forveksles med menneske-hold i standings før spillere fylder puljen op).
export const AI_TEAM_NAME_PREFIX = "AI";

// Sponsor-stammer + suffixer (cykelhold-flavor, EN-first). Bevidst neutrale/fiktive —
// ingen ægte sponsornavne. Stort nok kryds-produkt (40×8 = 320) til 15×24 = 360 hold
// med suffix-fallback ved kollision.
const SPONSOR_STEMS = [
  "Apex", "Vanguard", "Summit", "Meridian", "Cobalt", "Aurora", "Tempo", "Cadence",
  "Velocity", "Horizon", "Pinnacle", "Zenith", "Solstice", "Ridgeline", "Slipstream",
  "Echelon", "Peloton", "Domestik", "Breakaway", "Sprinta", "Granfondo", "Maillot",
  "Cima", "Strada", "Borealis", "Helix", "Quantum", "Vertex", "Nimbus", "Aero",
  "Titanium", "Carbon", "Drivetrain", "Cassette", "Derailleur", "Wattage", "Threshold",
  "Cadenza", "Tarmac", "Gravel",
];
const TEAM_SUFFIXES = [
  "Racing", "Cycling", "Pro Team", "Cycling Collective", "Development",
  "Continental", "Squad", "Devo",
];

function pickFrom(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Deterministisk AI-holdnavn. usedNames muterer (navnet tilføjes), så successive kald
 * inden for samme kørsel ikke kolliderer. Suffix-fallback (#2, #3 …) garanterer
 * unikhed selv hvis sponsor+suffix-rummet rammes to gange.
 */
export function makeAiTeamName({ baseSeed, poolId, ordinal, usedNames = new Set() }) {
  const seed = (((baseSeed >>> 0) ^ hashStringToSeed(`${poolId}:${ordinal}`)) >>> 0);
  const rng = makeRng(seed);
  const stem = pickFrom(rng, SPONSOR_STEMS);
  const suffix = pickFrom(rng, TEAM_SUFFIXES);
  const core = `${AI_TEAM_NAME_PREFIX} ${stem} ${suffix}`;
  let name = core;
  let n = 2;
  while (usedNames.has(name)) {
    name = `${core} ${n}`;
    n++;
  }
  usedNames.add(name);
  return name;
}

// Folded eksisterende rytter-navne (AI-trupperne må ikke kollidere på navn med
// markeds-/start-rytterne — samme PCM-import-fælde som #669/#1487). Lille wrapper så
// aiTeamGenerator ikke duplikerer fetch-stien.
export async function fetchExistingFoldedNamesForAi(supabase) {
  const { foldNameNordic } = await import("./pcmRiderMatcher.js");
  const existing = await fetchAllRows(() =>
    supabase.from("riders").select("firstname, lastname").order("id"));
  return new Set(existing.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));
}
