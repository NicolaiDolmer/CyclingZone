// #1584 — self-heal-sweep for nye-hold akademi-kuld. 1:1-spejling af #1563's
// starterSquadHealSweep.js, blot for akademiet i stedet for start-truppen.
//
// Et hold hvis signup-akademi-seeding fejlede sidder med academy_intake_seeded_at =
// NULL (markøren). Modsat start-truppen (#1560 bobler op = blokeret signup) er
// akademi-fejlen BEVIDST ikke-fatal (teamProfileEngine logger + Sentry-capturer og
// fortsætter), så holdet får sin signup men ingen første akademi-kuld — en stille
// forever-relaunch-blindgyde. Holdet kan ikke selv re-trigge en seeding (signup-
// stien kører kun ved created===true). Denne sweep finder de markør-NULL hold og
// kører den robuste, markør-gatede runAcademyIntakeForTeam, så de får deres kuld
// uden manuel indgriben — analogt til trainingSweep / academyGraduationSweep /
// starterSquadHealSweep.
//
// Eksisterende hold er backfilled til markør=sat (migration 2026-06-20-academy-
// intake-marker.sql), så sweep'en rører KUN hold oprettet EFTER migrationen. En
// ALDERS-guard (created_at < cutoff) sikrer at den ikke racer med et signup, der
// er midt i sin synkrone seeding lige nu.
//
// EXPLOIT-SIKKERHED: markør-NULL betyder "fik ALDRIG sit FØRSTE kuld" — et hold der
// brugte/afviste sine pladser har markøren sat (runAcademyIntakeForTeam sætter den
// efter seed) og rører sweep'en derfor aldrig. Ingen gratis-kuld.

import { runAcademyIntakeForTeam } from "./academyIntake.js";
import { fetchAllRows } from "./supabasePagination.js";

// Lad et in-flight signup fuldføre sin synkrone seeding selv, før sweep'en rører
// holdet — undgår dobbelt-arbejde og en unødig race mod den normale sti. Samme
// guard-størrelse som starterSquadHealSweep (#1563).
export const HEAL_MIN_AGE_MS = 5 * 60 * 1000;

export async function runAcademyHealSweep({
  supabase,
  now = new Date(),
  minAgeMs = HEAL_MIN_AGE_MS,
  seedCohort = runAcademyIntakeForTeam,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const cutoffIso = new Date(now.getTime() - minAgeMs).toISOString();

  // Hold der aldrig fik fuldført deres første akademi-kuld (markør NULL) og er
  // ældre end alders-guarden. runAcademyIntakeForTeam er selv markør-gatet +
  // idempotent, så et hold der når at blive markeret mellem query og kald bliver
  // et no-op (skipped).
  const candidates = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, created_at")
      .is("academy_intake_seeded_at", null)
      .lt("created_at", cutoffIso)
      .order("created_at"));

  let healed = 0;
  let failed = 0;
  const errors = [];

  for (const team of candidates) {
    try {
      const res = await seedCohort(supabase, team.id);
      // skipped (markør nået i mellemtiden / allerede-har-kuld) tæller ikke som heal.
      if (res?.candidates > 0) healed += 1;
    } catch (err) {
      failed += 1;
      errors.push({ teamId: team.id, message: err?.message || String(err) });
      // Per-team isolation: én fejl må ikke stoppe resten af sweep'en.
      console.error(`[academyHealSweep] hold ${team.id} fejlede:`, err?.message || err);
    }
  }

  return { candidates: candidates.length, healed, failed, errors };
}
