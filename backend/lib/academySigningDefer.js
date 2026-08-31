// backend/lib/academySigningDefer.js
// #4423: udskudt akademi-optagelse når kontrakten skrives MIDT i et aktivt
// fleretape-løb — udskilt fra #4418 (rod-årsag B) og spejler
// stageRaceTransferDefer.js (#1995)'s mønster, men for is_academy-flippet i
// stedet for team_id.
//
// Problem: finalize_academy_acquisition (database/2026-08-31-4423-academy-
// signing-defer.sql) satte tidligere is_academy=true STRAKS ved signering.
// isEligibleRider (riderEligibility.js) afviser akademiryttere, og
// filterEligibleEntries smed derfor rytteren ud af feltet på NÆSTE
// etape-build. Ramte den "egen ikke-akademi-rytter"-gren #4213 bevarede som
// legacy-sti — typisk en stale academy_intake-offer der peger på en rytter
// der i mellemtiden er landet på tilbudsholdets egen seniortrup, mens et af
// holdets etapeløb kører — fik rytteren fjernet fra løbet uden varsel. Målt i
// prod 30/8: 3 ryttere, alle Wander Riders, forsvundet fra Giro della
// Penisola / Tour of South Australia efter etape 2.
//
// Løsning (ejer, #4418's afsluttende kommentar 30/8): spejl #1995's "handel
// nu, fysisk flytning senere"-princip. RPC'en sætter nu
// riders.pending_academy_signing=true og lader is_academy stå UÆNDRET (false)
// hvis rytteren har en levende race_entries-binding hos holdet i et aktivt
// fleretape-løb. Kontrakt + betaling sker STRAKS uændret — kun selve løbs-
// berettigelses-flippet udskydes, så rytteren fortsætter uforstyrret som
// seniorrytter resten af løbet.
//
// Flush sker HER, når løbet finaliseres (raceRunner.js — SAMME to call-sites
// som #1995's flushDeferredTransfersSafe) — for netop DET løbs deltagere.
// getRidersInActiveStageRace genbruges fra stageRaceTransferDefer.js: SAMME
// diskriminator, én definition (undgår at de to defer-mekanismer drifter).
//
// IKKE i scope: demote_rider_to_academy (academyTransfer.js's demote-flow) har
// en BESLÆGTET, adskilt mangel — se academyTransfer.js:210-213 (#3805). Egen
// sag, egen fix; rører ikke denne fil.

import { fetchAllRows } from "./supabasePagination.js";
import { getRidersInActiveStageRace } from "./stageRaceTransferDefer.js";

const NOOP = () => {};
// Spejler ACADEMY.SLOTS (academyFlag.js) — dupliceret som et LILLE, statisk
// tal (samme stil som hashStringToSeed i academyIntake.js) frem for at
// importere academyFlag.js her og risikere en cyklus; RPC'en (SQL) har sin
// egen litterale 8-cap af samme grund. Ændrer akademi-cap'en sig nogensinde,
// skal begge steder (+ finalize_academy_acquisition + demote_rider_to_academy)
// opdateres sammen — samme aftale som de øvrige hårdkodede 8-tal i koden.
const ACADEMY_CAP = 8;

/**
 * Flush ÉN udskudt akademi-optagelse: flip is_academy=true hvis holdets
 * akademi-cap (8) ikke er nået. TOCTOU-guard på pending_academy_signing (kun
 * flip hvis den STADIG er sat), så en genkørsel er sikker. Er cap'en fyldt
 * (sjældent — flere udskudte optagelser på samme hold, eller holdet har
 * fyldt akademiet på anden vis i mellemtiden), forbliver rytteren pending og
 * prøves igen ved næste finalisering af et af hans andre aktive løb (eller
 * forbliver pending indtil en plads frigøres — ingen anden sti rører flaget).
 *
 * @param {object} supabase
 * @param {{ id: string, firstname?: string, lastname?: string, team_id: string }} rider
 * @param {{ notifyTeamOwner: Function }} opts
 * @returns {Promise<boolean>} true hvis rytteren rent faktisk blev flippet nu.
 */
export async function flushPendingAcademySigning(supabase, rider, { notifyTeamOwner } = {}) {
  const { count, error: countErr } = await supabase
    .from("riders")
    .select("id", { count: "exact", head: true })
    .eq("team_id", rider.team_id)
    .eq("is_academy", true);
  if (countErr) {
    throw new Error(`flushPendingAcademySigning: cap-tjek fejlede (${rider.id}): ${countErr.message}`);
  }
  if ((count ?? 0) >= ACADEMY_CAP) return false;

  const { data: updated, error: uErr } = await supabase
    .from("riders")
    .update({ is_academy: true, pending_academy_signing: false })
    .eq("id", rider.id)
    .eq("pending_academy_signing", true)
    .select("id");
  if (uErr) throw new Error(`flushPendingAcademySigning: flip fejlede (${rider.id}): ${uErr.message}`);
  if (!updated || updated.length === 0) return false;

  const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
  await notifyTeamOwner(
    rider.team_id,
    "academy_signed",
    "Academy rider has arrived",
    `${riderName} has joined your academy.`,
    rider.id,
    {
      riderId: rider.id,
      titleCode: "notif.academySigningArrived.title",
      messageCode: "notif.academySigningArrived.message",
      titleParams: { riderName },
      messageParams: { riderName },
    }
  );
  return true;
}

/**
 * Kaldes NÅR et løb er finaliseret (status='completed'). Flusher udskudte
 * akademi-optagelser for LØBETS deltagere der ikke længere er i et andet
 * aktivt fleretape-løb.
 *
 * Idempotent (TOCTOU-guard på pending_academy_signing) + pagineret (#879).
 *
 * @param {object} supabase
 * @param {{ id: string, race_type?: string, name?: string }} race det netop finaliserede løb
 * @param {{ notifyTeamOwner?: Function, now?: Date|null }} [deps]
 * @returns {Promise<{ ridersFlushed: number, riderIds: string[] }>}
 */
export async function flushDeferredAcademySigningsForRace(supabase, race, { notifyTeamOwner = NOOP } = {}) {
  const empty = { ridersFlushed: 0, riderIds: [] };
  // Kun fleretape-løb kan have parkeret en optagelse pga. sig selv (enkelt-løb
  // importeres atomisk — ingen signering kan ramme "midt i").
  if (!race || race.race_type !== "stage_race" || !race.id) return empty;
  const raceId = race.id;

  const entries = await fetchAllRows(() =>
    supabase.from("race_entries").select("rider_id").eq("race_id", raceId).order("rider_id")
  );
  const riderIds = [...new Set((entries || []).map((e) => e.rider_id))];
  if (riderIds.length === 0) return empty;

  // fetchAllRows: .in() bounder ikke SVARET — et stort felt kan overstige
  // PostgRESTs 1000-rækkers cap, og pending-flag der falder udenfor ville
  // aldrig blive flushet (pagination-guard-klassen).
  let pending;
  try {
    pending = await fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, firstname, lastname, team_id")
        .in("id", riderIds)
        .eq("pending_academy_signing", true)
        .order("id")
    );
  } catch (err) {
    throw new Error(`flushDeferredAcademySigningsForRace: pending riders lookup failed: ${err.message}`);
  }
  if (!pending || pending.length === 0) return empty;

  // Overlap-guard: en rytter i FLERE aktive etapeløb flushes først når det
  // SIDSTE finaliseres (samme mønster som #1995's flushDeferredTransfersForRace
  // — ellers ville is_academy flippe mens han stadig kører et andet løb).
  const stillActive = new Set(
    await getRidersInActiveStageRace(supabase, pending.map((r) => r.id), { excludeRaceId: raceId })
  );
  const toFlush = pending.filter((r) => !stillActive.has(r.id));
  if (toFlush.length === 0) return empty;

  const flushedIds = [];
  for (const rider of toFlush) {
    const flushed = await flushPendingAcademySigning(supabase, rider, { notifyTeamOwner });
    if (flushed) flushedIds.push(rider.id);
  }

  return { ridersFlushed: flushedIds.length, riderIds: flushedIds };
}
