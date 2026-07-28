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
//
// KUN ÆGTE MANAGER-HOLD (2026-07-28, CYCLINGZONE-42): AI-hold oprettes af
// aiTeamGenerator.createAiTeam, som ALDRIG sætter markøren — den er signup-flowets
// kvittering, ikke AI-fyldets. Uden is_ai-gaten blev hvert eneste nye AI-hold derfor
// kandidat 5 minutter efter oprettelsen (prod: 27/27 AI-hold på 14 dage fik markøren
// sat af DENNE sweep, mod 0/33 ægte hold), og allocateStarterSquadForTeam kørte
// MANAGER-stien på dem. AI-truppen har sin egen størrelse (AI_SQUAD, op til 24) og
// matcher ikke STARTER_SQUAD.TOTAL_SIZE, så heal'en landede i "ryd delvist forsøg"-
// grenen og forsøgte at SLETTE hele AI-holdets trup. 27/7 blev 23 sådanne sletninger
// kun stoppet af DB-guarden block_rider_delete_with_inflight_entries (#2074) — dvs.
// af det tilfælde at rytterne allerede var i et løb. Et AI-hold uden entries endnu
// ville være blevet tømt lydløst.

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

  // Ægte manager-hold der aldrig fik fuldført start-trup-bootstrap (markør NULL) og
  // er ældre end alders-guarden. allocateStarterSquadForTeam er selv markør-gatet +
  // idempotent, så et hold der når at blive markeret mellem query og kald bliver et
  // no-op. is_ai=false er en HARD gate (CYCLINGZONE-42): AI-hold har deres egen
  // trup-allokering og må aldrig røres af manager-stien.
  const candidates = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, created_at")
      .eq("is_ai", false)
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
