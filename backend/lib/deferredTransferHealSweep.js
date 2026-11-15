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
import { reconcileHeldSaleEscrows } from "./saleEscrowFlow6181.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { buildKeyedNotification } from "./notificationKeys.js";
// #8153: kun konstanter og rene hjaelpere herfra; kontakten laeses aldrig paa
// udfoerelses-stien (motoren importerer denne fil, se featureStage.test.js #7663).
import { PENDING_RELEASES_TABLE, PENDING_RELEASE_NOTIFICATION_TYPE, isMissingPendingReleasesTable as isMissingTable, pendingReleaseErrorMessage as errorMessage, riderFullName as fullName } from "./riderReleaseDefer8153.js";

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
    return withSaleEscrows(supabase, now, { candidates: 0, healed: 0, failed: 0, stillRacing: 0, errors: [] }, notifyTeamOwner);
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
        arrival: { reason: "dealCompleted" },
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

  return withSaleEscrows(supabase, now, {
    candidates: parked.length,
    healed,
    failed,
    stillRacing: racingIds.size,
    errors,
  }, notifyTeamOwner);
}

// #6181: sikkerhedsnettet for laaste salgspenge, IKKE bag sale_escrow_enabled (en
// escrow fra en taendt periode skal afregnes, ogsaa efter et sluk). Koerer efter
// flushen, saa en netop leveret rytter afregnes i samme koersel. Fejl taelles i
// failed/errors, saa cron-wrapperens Sentry-capture ser dem. Ingen escrows = samme
// resultat som foer.
async function withSaleEscrows(supabase, now, result, notifyTeamOwner) {
  const escrows = await reconcileHeldSaleEscrows({ supabase, now, sourcePath: "deferredTransferHealSweep.saleEscrow" });
  const withEscrows = escrows.checked === 0 && escrows.failed === 0 ? result : {
    ...result,
    failed: result.failed + escrows.failed,
    errors: [...result.errors, ...escrows.errors],
    saleEscrows: escrows,
  };
  return withPendingReleases(supabase, now, withEscrows, notifyTeamOwner);
}

// #8153: sikkerhedsnettet for ventende frigivelser, IKKE bag release_defer_8153 (en
// bestilling fra en taendt periode skal udfoeres, ogsaa efter et sluk). Udfoerer en
// bestilling, hvis loeb er slut, og hvis rytter ikke koerer et andet etapeloeb.
// Ingen bestillinger = samme resultat som foer.
async function withPendingReleases(supabase, now, result, notifyTeamOwner) {
  let releases;
  try {
    releases = await runPendingReleaseHealSweep(supabase, { now, notifyTeamOwner });
  } catch (err) {
    // best-effort: taelles i failed/errors, saa cron-wrapperens Sentry-capture ser fejlen.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[deferredTransferHealSweep] ventende frigivelser fejlede: ${message}`);
    return { ...result, failed: result.failed + 1, errors: [...result.errors, { riderId: null, message }] };
  }
  if (releases.checked === 0 && releases.failed === 0) return result;
  return {
    ...result,
    failed: result.failed + releases.failed,
    errors: [...result.errors, ...releases.errors],
    pendingReleases: releases,
  };
}

// ── #8153: udfoerelse af ventende frigivelser ─────────────────────────────────
// Her (og ikke i riderReleaseDefer8153.js), fordi raceRunner kalder den ved loebets
// finalisering, og udfoerelsen er uafhaengig af kontakten release_defer_8153.

async function loadRiderNames(supabase, riderIds) {
  const ids = [...new Set((riderIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  // pagination-safe: kun ryttere med en ventende frigivelse (een aktiv pr. rytter, faa i alt).
  const { data, error } = await supabase.from("riders").select("id, firstname, lastname").in("id", ids);
  if (error) throw new Error(`pendingRelease rider lookup failed: ${error.message}`);
  return new Map((data || []).map((r) => [r.id, fullName(r)]));
}

/**
 * Udfoer een bestilling (idempotent i SQL). Bagefter: ryd fremtidige
 * loebstilmeldinger og send beskeden. Returnerer true, hvis rytteren blev frigivet nu.
 */
async function executeOne(supabase, row, { now, notifyTeamOwner, riderName }) {
  const { data: result, error } = await supabase.rpc("execute_pending_rider_release_8153", {
    p_release_id: row.id,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`execute_pending_rider_release_8153 (${row.id}): ${error.message}`);
  if (result?.status !== "executed") return false;

  await clearFutureRaceEntriesSafe({ supabase, riderId: row.rider_id, label: "pending_release_8153" });
  const notice = buildKeyedNotification({
    titleCode: "notif.riderReleaseExecuted.title",
    messageCode: "notif.riderReleaseExecuted.message",
    messageParams: { rider: riderName ?? "" },
    metadata: { riderId: row.rider_id, raceId: row.race_id },
  });
  try {
    await notifyTeamOwner(row.team_id, PENDING_RELEASE_NOTIFICATION_TYPE, notice.title, notice.message, row.rider_id, notice.metadata);
  } catch (notifyErr) {
    // best-effort: frigivelsen er udfoert; en fejlet besked logges, men taeller ikke som en fejlet udfoerelse.
    console.error(`[pendingRelease8153] beskeden ved udfoerelse fejlede (${row.rider_id}): ${errorMessage(notifyErr)}`);
  }
  return true;
}

async function executeRows(supabase, rows, { now, notifyTeamOwner }) {
  const stats = { executed: 0, failed: 0, errors: [] };
  if (!rows.length) return stats;
  const names = await loadRiderNames(supabase, rows.map((r) => r.rider_id));
  for (const row of rows) {
    try {
      if (await executeOne(supabase, row, { now, notifyTeamOwner, riderName: names.get(row.rider_id) })) stats.executed += 1;
    } catch (err) {
      // best-effort pr. raekke: een fejl maa ikke stoppe resten. Fejlen taelles (failed/errors) og logges.
      stats.failed += 1;
      stats.errors.push({ riderId: row.rider_id, message: errorMessage(err) });
      console.error(`[pendingRelease8153] udfoerelse fejlede for rytter ${row.rider_id}: ${errorMessage(err)}`);
    }
  }
  return stats;
}

/**
 * Ved loebets finalisering (raceRunner, samme sted som flushDeferredTransfersForRace).
 * Udfoerer loebets aktive bestillinger for ryttere, der ikke er i et andet aktivt
 * etapeloeb. Uanset kontakten: en bestilling skal altid udfoeres.
 *
 * @param {any} supabase
 * @param {{ id: string, race_type?: string }} race
 * @param {{ now?: Date, notifyTeamOwner?: Function }} [deps]
 */
export async function executePendingReleasesForRace(supabase, race, { now = new Date(), notifyTeamOwner = NOOP } = {}) {
  const empty = { executed: 0, failed: 0, errors: [] };
  if (!race?.id || race.race_type !== "stage_race") return empty;
  const { data, error } = await supabase
    .from(PENDING_RELEASES_TABLE)
    .select("id, rider_id, team_id, race_id")
    .eq("race_id", race.id)
    .eq("status", "pending");
  if (error) {
    if (isMissingTable(error)) return empty;
    throw new Error(`executePendingReleasesForRace: ${error.message}`);
  }
  const rows = data || [];
  if (!rows.length) return empty;
  const stillActive = new Set(await getRidersInActiveStageRace(supabase, rows.map((r) => r.rider_id), { excludeRaceId: race.id }));
  return executeRows(supabase, rows.filter((r) => !stillActive.has(r.rider_id)), { now, notifyTeamOwner });
}

const RACE_DONE_STATUSES = new Set(["completed", "cancelled"]);

/**
 * Sikkerhedsnettet i deferredTransferHealSweep: en bestilling, hvis loeb er slut
 * (eller slettet), og hvis rytter ikke er i et andet aktivt etapeloeb, udfoeres.
 *
 * @param {any} supabase
 * @param {{ now?: Date, notifyTeamOwner?: Function }} [deps]
 * @returns {Promise<{ checked: number, executed: number, failed: number, errors: Array<{ riderId: string, message: string }> }>}
 */
export async function runPendingReleaseHealSweep(supabase, { now = new Date(), notifyTeamOwner = NOOP } = {}) {
  let rows;
  try {
    rows = await fetchAllRows(() => supabase
      .from(PENDING_RELEASES_TABLE)
      .select("id, rider_id, team_id, race_id")
      .eq("status", "pending")
      .order("id"));
  } catch (err) {
    // Manglende tabel (migrationen er ikke applied endnu) = ingen bestillinger; alt andet kastes.
    if (isMissingTable(err)) return { checked: 0, executed: 0, failed: 0, errors: [] };
    throw err;
  }
  if (!rows.length) return { checked: 0, executed: 0, failed: 0, errors: [] };

  const { data: races, error: rErr } = await supabase.from("races").select("id, status").in("id", [...new Set(rows.map((r) => r.race_id))]);
  if (rErr) throw new Error(`runPendingReleaseHealSweep: races lookup failed: ${rErr.message}`);
  const statusById = new Map((races || []).map((r) => [r.id, r.status]));
  const raceDone = (row) => !statusById.has(row.race_id) || RACE_DONE_STATUSES.has(statusById.get(row.race_id));
  const finished = rows.filter(raceDone);
  if (!finished.length) return { checked: rows.length, executed: 0, failed: 0, errors: [] };

  const racing = new Set(await getRidersInActiveStageRace(supabase, finished.map((r) => r.rider_id)));
  const stats = await executeRows(supabase, finished.filter((r) => !racing.has(r.rider_id)), { now, notifyTeamOwner });
  return { checked: rows.length, ...stats };
}
