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
import { academyPlacementSquad, squadCapRpcArgs } from "./squads.js";

const NOOP = () => {};

// flush_pending_academy_signing-RPC'ens "ikke nu"-svar (database/2026-09-24-
// 5432-squad-caps-rpc.sql): mål-truppen er fuld, eller rytteren venter ikke
// længere (allerede flushet af en parallel kørsel). Begge betyder "prøv igen
// senere / intet at gøre", ikke en fejl.
const FLUSH_NOT_NOW = new Set(["academy_full", "not_pending"]);

async function activeSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`flushDeferredAcademySigningsForRace: season lookup failed: ${error.message}`);
  return data?.number ?? null;
}

/**
 * Flush ÉN udskudt akademi-optagelse: flip is_academy=true OG skriv truppen,
 * hvis mål-truppen har en ledig plads.
 *
 * #5432: tællingen og skrivningen sker i flush_pending_academy_signing-RPC'en
 * under holdets advisory-lås, pr. MÅL-trup med loftet fra squads.js. Før lå
 * her en JS-tælling mod en flad cap på HELE akademiet; med loft pr. trup kan et
 * hold lovligt have flere akademiryttere end det tal, og en udskudt optagelse
 * ville så aldrig kunne fuldføres. TOCTOU-guarden (kun flip hvis
 * pending_academy_signing STADIG er sat) sidder i RPC'en. Er truppen fuld,
 * forbliver rytteren pending og prøves igen ved næste finalisering af et af hans
 * andre aktive løb (eller forbliver pending indtil en plads frigøres).
 *
 * @param {object} supabase
 * @param {{ id: string, firstname?: string, lastname?: string, team_id: string, birthdate?: string|null }} rider
 * @param {{ notifyTeamOwner: Function, seasonNumber?: number|null }} opts
 * @returns {Promise<boolean>} true hvis rytteren rent faktisk blev flippet nu.
 */
export async function flushPendingAcademySigning(supabase, rider, { notifyTeamOwner, seasonNumber = null } = {}) {
  // Uden en aktiv sæson kan sæsonalderen ikke regnes ud. Rytteren bliver hellere
  // stående som ventende end at blive gættet ned i junior-truppen (CodeRabbit).
  if (!Number.isFinite(seasonNumber)) return false;
  const squad = academyPlacementSquad(rider.birthdate, seasonNumber);
  const { data, error } = await supabase.rpc("flush_pending_academy_signing", {
    p_team_id: rider.team_id,
    p_rider_id: rider.id,
    ...squadCapRpcArgs(squad),
  });
  if (error) throw new Error(`flushPendingAcademySigning: flip fejlede (${rider.id}): ${error.message}`);
  if (data?.ok !== true) {
    if (FLUSH_NOT_NOW.has(data?.code)) return false;
    throw new Error(`flushPendingAcademySigning: uventet svar (${rider.id}): ${JSON.stringify(data)}`);
  }

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
        .select("id, firstname, lastname, team_id, birthdate")
        .in("id", riderIds)
        .eq("pending_academy_signing", true)
        .order("id")
    );
  } catch (err) {
    throw new Error(`flushDeferredAcademySigningsForRace: pending riders lookup failed: ${err.message}`, { cause: err });
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

  // #5432: mål-truppen afhænger af sæsonalderen, så den aktive sæson hentes én
  // gang pr. flush (samme opslag som /academy/promote + /academy/demote).
  const seasonNumber = await activeSeasonNumber(supabase);

  const flushedIds = [];
  for (const rider of toFlush) {
    const flushed = await flushPendingAcademySigning(supabase, rider, { notifyTeamOwner, seasonNumber });
    if (flushed) flushedIds.push(rider.id);
  }

  return { ridersFlushed: flushedIds.length, riderIds: flushedIds };
}
