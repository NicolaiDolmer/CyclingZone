// #3330 — self-heal-sweep for parkerede holdskifter (riders.pending_team_id)
// der aldrig blev flushet.
//
// ROD-ÅRSAG: stageRaceTransferDefer.js parkerer et holdskifte på pending_team_id
// når en rytter handles midt i et aktivt fleretape-løb (#1995). Flushen
// (flushDeferredTransfersForRace) kaldes KUN fra raceRunner.js ved LØBS-
// finalisering, og KUN for DET løbs deltagere. Falder flushen på gulvet —
// løbet finaliseres ad en anden vej, rytteren fjernes fra race_entries før
// finalisering, en admin-genkørsel springer den over — bliver rytteren
// hængende for evigt: intet ANDET i systemet rører pending_team_id igen.
// Prod-evidens (#3330): Vasco Fernandes stod parkeret 22/6→4/8 (>40 dage) med
// en betalt, aldrig-leveret handel — spilleren rapporterede det selv i Discord.
//
// DENNE sweep kører periodisk (samme mønster + kadence som de øvrige
// *HealSweep.js-filer) og flusher enhver rytter med pending_team_id != null
// der IKKE (længere) er i et aktivt fleretape-løb. getRidersInActiveStageRace
// er den SAMME diskriminator flushDeferredTransfersForRace selv bruger — en
// rytter midt i et løb røres aldrig.
//
// Idempotent: flushParkedRider deler TOCTOU-guarden med race-flushen (kun
// opdatér hvis pending_team_id stadig peger hvor vi læste), så en genkørsel
// finder pending_team_id=null → 0 rows → 0 healed.

import { fetchAllRows } from "./supabasePagination.js";
import { getRidersInActiveStageRace, flushParkedRider } from "./stageRaceTransferDefer.js";

const NOOP = () => {};

export async function runDeferredTransferHealSweep({
  supabase,
  now = new Date(),
  notifyTeamOwner = NOOP,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // #879/#3030: populationen forventes lille (i praksis 0-nogle-få — kun
  // ryttere hvis parkering ikke selv-heler ved næste løbs-finalisering), men
  // paginer defensivt alligevel — samme forsvar som alle andre riders-loads.
  const parked = await fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, pending_team_id")
      .not("pending_team_id", "is", null)
      .order("id")
  );

  if (parked.length === 0) {
    return { candidates: 0, healed: 0, failed: 0, stillRacing: 0, errors: [] };
  }

  const racingIds = new Set(
    await getRidersInActiveStageRace(supabase, parked.map((r) => r.id))
  );
  const toFlush = parked.filter((r) => !racingIds.has(r.id));

  let healed = 0;
  let failed = 0;
  const errors = [];
  const flushedAt = now.toISOString();

  for (const rider of toFlush) {
    try {
      const flushed = await flushParkedRider(supabase, rider, {
        notifyTeamOwner,
        flushedAt,
        arrivalNote: "hans handel er nu gennemført",
      });
      if (flushed) healed += 1;
    } catch (err) {
      // best-effort: per-rytter isolation — én fejlende flush må ikke stoppe
      // resten af sweep'en. Fejlen er IKKE tavs: den tælles i failed/errors[]
      // og cron.js's wrapper (runDeferredTransferHealSweepCron) sentryCapture'r
      // en aggregeret fejl hvis failed > 0 (samme mønster som de øvrige heal-sweeps).
      failed += 1;
      errors.push({ riderId: rider.id, message: err?.message || String(err) });
      console.error(`[deferredTransferHealSweep] rytter ${rider.id} fejlede:`, err?.message || err);
    }
  }

  return {
    candidates: parked.length,
    healed,
    failed,
    stillRacing: racingIds.size,
    errors,
  };
}
