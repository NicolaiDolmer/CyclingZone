// #1563 — self-heal-sweep for nye-hold start-trupper.
//
// Et hold hvis signup-allokering fejlede sidder med starter_squad_allocated_at =
// NULL (markøren). Holdet kan ikke selv re-trigge en allokering: SetupWizard'en
// viser kun ved manglende manager_name (som ER sat), og login re-bootstrapper ikke.
// Denne sweep finder de markør-NULL hold og kører den robuste, markør-gatede
// allocateStarterSquadForTeam, så de får deres 8 ryttere uden manuel indgriben —
// analogt til trainingSweep / academyGraduationSweep / autoPrizeSweep.
//
// Eksisterende hold er backfilled til markør=sat (migration 2026-06-20-starter-
// squad-marker.sql), så sweep'en rører KUN hold oprettet EFTER migrationen. En
// ALDERS-guard (created_at < cutoff) sikrer at den ikke racer med et signup, der
// er midt i sin synkrone allokering lige nu.

import { allocateStarterSquadForTeam } from "./starterSquadAllocator.js";
import { fetchAllRows } from "./supabasePagination.js";

// Lad et in-flight signup fuldføre sin synkrone allokering selv, før sweep'en rører
// holdet — undgår dobbelt-arbejde og en unødig race mod den normale sti.
export const HEAL_MIN_AGE_MS = 5 * 60 * 1000;

export async function runStarterSquadHealSweep({
  supabase,
  now = new Date(),
  minAgeMs = HEAL_MIN_AGE_MS,
  allocate = allocateStarterSquadForTeam,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const cutoffIso = new Date(now.getTime() - minAgeMs).toISOString();

  // Hold der aldrig fik fuldført start-trup-bootstrap (markør NULL) og er ældre end
  // alders-guarden. allocateStarterSquadForTeam er selv markør-gatet + idempotent,
  // så et hold der når at blive markeret mellem query og kald bliver et no-op.
  const candidates = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, created_at")
      .is("starter_squad_allocated_at", null)
      .lt("created_at", cutoffIso)
      .order("created_at"));

  let healed = 0;
  let failed = 0;
  const errors = [];

  for (const team of candidates) {
    try {
      const res = await allocate(supabase, team.id);
      // skipped (markør nået i mellemtiden) tæller ikke som heal.
      if (res?.assigned > 0 || res?.recovered) healed += 1;
    } catch (err) {
      failed += 1;
      errors.push({ teamId: team.id, message: err?.message || String(err) });
      // Per-team isolation: én fejl må ikke stoppe resten af sweep'en.
      console.error(`[starterSquadHealSweep] hold ${team.id} fejlede:`, err?.message || err);
    }
  }

  return { candidates: candidates.length, healed, failed, errors };
}
