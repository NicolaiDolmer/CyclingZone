// #1673 — rytter-DATA-gatet self-heal-sweep for "strandede" ryttere.
//
// Modsat starterSquadHealSweep (#1563) og academyHealSweep (#1584), der er gatet
// på TEAM-markører (starter_squad_allocated_at / academy_intake_seeded_at IS NULL),
// er denne sweep gatet på selve RYTTER-dataen: en aktiv (ikke-retired) rytter der
// mangler sin rider_derived_abilities-række ELLER har base_value IS NULL er
// "strandet" — derive-trinet fuldførte aldrig for ham.
//
// Hvorfor team-markør-sweepene STRUKTURELT ikke fanger dette (#1673 rod-årsag):
//   - 75 fiktive ryttere blev oprettet i ét batch 2026-06-18 hvor deriveForRiderIds
//     ikke fuldførte. De rå stat_*-felter er intakte; kun derive-laget mangler.
//   - 5 sad på ÆGTE menneske-hold (markør SAT) → starterSquadHealSweep rører dem
//     aldrig (den ser kun markør-NULL hold). Resten er free agents (intet hold,
//     ingen markør at gate på). Begge falder strukturelt uden for de team-gatede
//     sweeps.
// Derfor gates DENNE sweep på rytter-dataen direkte — den fanger en strandet rytter
// uanset om han er free agent eller sidder på et hvilket som helst hold.
//
// Serve-laget (api.js, embed rider_derived_abilities) har ingen fallback til rå
// stat_* → en manglende derived-række = blank UI. Sweep'en lukker det vindue
// runtime; verify-invariants.js (rytter-invariant) + kilde-guarden i
// deriveForRiderIds (kast ved partiel batch) lukker det fremad.
//
// Idempotent: re-derive af en allerede-derived rytter giver samme værdier (deriv-
// kæden er deterministisk). Default cap'er antal pr. tick så et stort efterslæb
// ikke kører hele populationen i ét tick; resten tages næste tick.

import { fetchAllRows } from "./supabasePagination.js";
import { deriveForRiderIds as deriveForRiderIdsDefault } from "./backfillCores.js";

// Maks antal strandede ryttere der heales pr. tick. Et normalt efterslæb er 0;
// et stort efterslæb (fx efter en fejlet relaunch-batch) tages over flere ticks
// så ét tick ikke holder cron'en optaget i minutter. Backfill-scriptet sætter
// limit: Infinity for at tage alt på én gang (ejer-styret engangskørsel).
export const HEAL_BATCH_LIMIT = 200;

// Find aktive (ikke-retired) ryttere der enten mangler en rider_derived_abilities-
// række ELLER har base_value IS NULL. Returnerer et sorteret, dedupliceret id-sæt.
//
// To separate queries (robust mod PostgREST's 1000-række-cap, jf. #1478-postmortem):
//   1) alle aktive rytter-id'er + base_value
//   2) alle derived rider_id'er
// Strandet = aktiv OG (ikke i derived-sæt ELLER base_value IS NULL).
export async function findStrandedRiderIds(supabase) {
  const [activeRiders, derivedRows] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, base_value")
        .eq("is_retired", false)
        .order("id", { ascending: true })),
    fetchAllRows(() =>
      supabase
        .from("rider_derived_abilities")
        .select("rider_id")
        .order("rider_id", { ascending: true })),
  ]);

  const haveDerived = new Set(derivedRows.map((d) => d.rider_id));
  const stranded = [];
  for (const r of activeRiders) {
    const missingDerived = !haveDerived.has(r.id);
    const missingValue = r.base_value == null;
    if (missingDerived || missingValue) stranded.push(r.id);
  }
  return { strandedIds: stranded, activeCount: activeRiders.length };
}

export async function runRiderDeriveHealSweep({
  supabase,
  limit = HEAL_BATCH_LIMIT,
  deriveForRiderIds = deriveForRiderIdsDefault,
  log = () => {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { strandedIds, activeCount } = await findStrandedRiderIds(supabase);
  if (strandedIds.length === 0) {
    return { stranded: 0, healed: 0, activeCount };
  }

  const batch = Number.isFinite(limit) ? strandedIds.slice(0, limit) : strandedIds;
  log(`[riderDeriveHealSweep] ${strandedIds.length} strandede ryttere (af ${activeCount} aktive) — healer ${batch.length} i dette tick`);

  // deriveForRiderIds kaster nu (kilde-guard, #1673) hvis et batch ikke dækker alle
  // input-id'er → en partiel fejl bliver synlig i stedet for at strande tavst.
  const res = await deriveForRiderIds(supabase, batch, { dryRun: false, log });

  return {
    stranded: strandedIds.length,
    healed: res?.riders ?? batch.length,
    remaining: Math.max(0, strandedIds.length - batch.length),
    activeCount,
  };
}
