// backend/lib/raceActiveGuard.js
// Forward-guard mod tabt startfelt i AKTIVE (igangværende) løb (#2074).
//
// Rod-årsag (prod 2/7, verificeret read-only): et 7-etapers div-1-løb mistede HELE
// sit startfelt (race_entries=0) efter etape 2, mens dets 344 race_results overlevede.
// Asymmetrien er mekanisk: FK'en race_entries.rider_id → riders er ON DELETE CASCADE,
// mens race_results.rider_id → riders er ON DELETE SET NULL. En HARD DELETE af en
// rytter-række (fx purge-migrationen 2026-06-27, eller en anden rytter-sletning) hvor
// rytteren stadig havde entries i et igangværende løb, cascade-slettede derfor entries
// men bevarede results. Etape-scheduleren fejlede så hvert tick med "No start list".
//
// To lag forward-guard (dette modul er backend-only, INGEN migration for kode-delen):
//   1) DETEKTION: detectInFlightRacesWithoutEntries() — alarmerer (log + Sentry) hvis et
//      igangværende løb (stages_completed>0, ikke completed) har 0 race_entries. Kaldes
//      fra stage-scheduler-sweepet, så et tabt felt bliver SYNLIGT inden for ét tick i
//      stedet for at køre usynligt i timevis.
//   2) PRÆVENTION: assertLineupMutationAllowed() / isRaceLineupFrozen() — en kode-guard
//      der forhindrer app-lag-sletning af entries for et løb hvis felt er LÅST (start er
//      gået: stages_completed>0). Wired ind i de delete-then-insert-stier der ellers
//      kunne nulstille et aktivt felt hvis insert'en fejlede efter delete'en.
//
// Bemærk: den STRUKTURELLE rod-årsag (CASCADE-FK) kan kun lukkes helt med en migration
// (BEFORE DELETE-guard på riders eller FK → RESTRICT). Den ligger som forslag i PR-body
// til ejer-beslutning; dette modul lukker app-laget uden migration.

import { captureException } from "./sentry.js";

/**
 * Er løbets startfelt LÅST (afvikling er gået i gang)?
 *
 * status forbliver 'scheduled' hele afviklingen (motoren flipper først til 'completed'
 * til sidst), så den pålidelige gate er stages_completed. Et løb med stages_completed>0
 * har et frosset felt (#1825/#1844) — dets entries må app-laget ALDRIG slette.
 *
 * Ren funktion (ingen DB). completed-løb regnes også som låst (historik).
 *
 * @param {{ status?: string, stages_completed?: number|null }} race
 * @returns {boolean}
 */
export function isRaceLineupFrozen(race) {
  if (!race) return false;
  if (race.status === "completed") return true;
  return (race.stages_completed ?? 0) > 0;
}

/**
 * Guard for app-lag-sletning af race_entries: kast hvis løbets felt er låst.
 *
 * Bruges på delete-then-insert-stier (manager-udtagelse, auto-generator, regenerering).
 * Disse stier er allerede API-gated på stages_completed=0 i rute-laget, men guarden gør
 * invarianten lokal til selve mutationen (defense-in-depth): en fremtidig kalder eller en
 * bug kan ikke længere nulstille et aktivt felt via en delete der ikke efterfølges af en
 * vellykket insert.
 *
 * Hvis `race` medsendes (allerede indlæst) bruges den direkte — ingen ekstra query.
 * Ellers slås status+stages_completed op på raceId.
 *
 * @param {{ supabase?: object, raceId: string, race?: object, label?: string }} args
 * @returns {Promise<void>} kaster Error med .code = 'race_lineup_frozen' hvis låst
 */
export async function assertLineupMutationAllowed({ supabase, raceId, race = null, label = "entry-mutation" }) {
  let target = race;
  if (!target) {
    if (!supabase || !raceId) return; // intet at gå ud fra → fail-open (kalder-ansvar)
    const { data, error } = await supabase
      .from("races").select("status, stages_completed").eq("id", raceId).maybeSingle();
    if (error) throw new Error(`raceActiveGuard: kunne ikke slå løb ${raceId} op: ${error.message}`);
    target = data;
  }
  if (target && isRaceLineupFrozen(target)) {
    const err = new Error(
      `race_lineup_frozen: nægter at slette race_entries for igangværende løb ${raceId} (${label}); ` +
      `feltet er låst (stages_completed=${target.stages_completed ?? 0}, status=${target.status ?? "?"})`
    );
    err.code = "race_lineup_frozen";
    throw err;
  }
}

/**
 * DETEKTION: find igangværende løb (stages_completed>0, ikke completed) uden race_entries.
 * Dette er præcis #2074-fingeraftrykket. Alarmerer (console.error + Sentry-capture) så et
 * tabt felt bliver synligt inden for ét scheduler-tick.
 *
 * Read-only. Sikker at kalde hvert tick: én index-venlig aggregat-query. Muterer intet
 * (INGEN repair — genopretning er ejer-only, jf. #2074's hårde stop).
 *
 * @param {{ supabase: object, seasonId?: string|null, now?: Date }} args
 * @returns {Promise<{ affected: Array<{id:string,name:string,stages_completed:number,stages:number}> }>}
 */
export async function detectInFlightRacesWithoutEntries({ supabase, seasonId = null, now = new Date() }) {
  // Igangværende løb = ikke-completed OG mindst én etape kørt.
  let q = supabase
    .from("races")
    .select("id, name, stages, stages_completed, status")
    .neq("status", "completed")
    .gt("stages_completed", 0);
  if (seasonId) q = q.eq("season_id", seasonId);
  const { data: inFlightRaw, error: rErr } = await q;
  if (rErr) throw new Error(`raceActiveGuard.detect: races: ${rErr.message}`);
  // Re-filtrér defensivt på klienten: kun ægte igangværende løb (start gået, ikke completed).
  // Gør funktionen robust hvis kalderen/laget ikke honorerer server-filteret 1:1.
  const inFlight = (inFlightRaw || []).filter(
    (r) => r.status !== "completed" && (r.stages_completed ?? 0) > 0
  );
  if (!inFlight.length) return { affected: [] };

  // For hvert igangværende løb: har det mindst én entry? (billig HEAD-count pr. løb —
  // typisk <30 igangværende løb, så ingen batching nødvendig.)
  const affected = [];
  for (const race of inFlight) {
    const { count, error: cErr } = await supabase
      .from("race_entries")
      .select("race_id", { count: "exact", head: true })
      .eq("race_id", race.id);
    if (cErr) throw new Error(`raceActiveGuard.detect: race_entries count (${race.id}): ${cErr.message}`);
    if ((count ?? 0) === 0) {
      affected.push({
        id: race.id, name: race.name,
        stages_completed: race.stages_completed ?? 0, stages: race.stages ?? 0,
      });
    }
  }

  if (affected.length) {
    const names = affected.map((r) => `${r.name} (${r.stages_completed}/${r.stages} etaper)`).join(", ");
    console.error(
      `  🚨 raceActiveGuard: ${affected.length} IGANGVÆRENDE løb har MISTET sit startfelt (0 race_entries): ${names}. ` +
      `Genopretning er ejer-only (#2074) — dette er kun en alarm.`
    );
    // Ét Sentry-event pr. sweep (ikke pr. løb) med løbe-id'erne som ekstra kontekst.
    captureException(new Error(`race_startfield_lost: ${affected.length} in-flight race(s) with 0 entries`), {
      tags: { guard: "race-active-guard", kind: "startfield_lost" },
      raceIds: affected.map((r) => r.id),
      raceNames: affected.map((r) => r.name),
      detectedAt: now.toISOString(),
    });
  }

  return { affected };
}
