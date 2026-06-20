// Akademi-intake (#1308) — genererer kandidat-kuld pr. menneske-hold og
// indsætter dem i riders + academy_intake. Flag-gated via academyFlag.js;
// opkalderen (relaunchOrchestrator) checker flaget FØR kald. Idempotent
// pr. sæson: hold allerede i academy_intake springes over.

import { generateAcademyCandidates } from "./academyGenerator.js";
import { fetchAllRows } from "./supabasePagination.js";
import { foldNameNordic } from "./pcmRiderMatcher.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { ACADEMY } from "./academyFlag.js";
import { calculateRiderMarketValue } from "./marketUtils.js";
import { DUPLICATE_VIOLATION_CODE } from "./balanceRpc.js";
import { notifyTeamOwner } from "./notificationService.js";
import { deriveForRiderIds } from "./backfillCores.js";

/**
 * Returnerer antal ryttere med is_academy=true for et givet hold.
 * Bruges af squad-cap-logik (Task 7).
 *
 * @param {object} supabase
 * @param {string} teamId
 * @returns {Promise<number>}
 */
export async function getTeamAcademyCount(supabase, teamId) {
  const { count, error } = await supabase
    .from("riders")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("is_academy", true);
  if (error) throw new Error(`getTeamAcademyCount: ${error.message}`);
  return count ?? 0;
}

/**
 * Kør akademi-intake: ét kandidat-kuld pr. ikke-seedet menneske-hold i den
 * aktive sæson. Skriver til riders + academy_intake i apply-mode.
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {boolean} [opts.dryRun=true]
 * @param {number}  [opts.seed=2026]
 * @param {Function} [opts.getManagerTeams]  DI-hook til tests (returnerer hold med season_1_identity_basis)
 * @param {Function} [opts.deriveRiders]     DI-hook til tests; default deriveForRiderIds (afled-pipeline)
 * @returns {Promise<{dryRun, teams, candidates} | {dryRun, teams, candidates, note}>}
 */
export async function runAcademyIntake(supabase, {
  dryRun = true,
  seed = 2026,
  getManagerTeams,
  deriveRiders = deriveForRiderIds,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // ── Resolver manager-hold ────────────────────────────────────────────────────
  // getBetaManagerTeams selekterer ikke season_1_identity_basis, så vi bruger
  // enten den injicerede getManagerTeams (tests + fremtidige overskrivninger)
  // eller foretager en direkte forespørgsel der inkluderer kolonnen.
  let teams;
  if (getManagerTeams) {
    teams = await getManagerTeams(supabase);
  } else {
    // Hent alle manager-hold med season_1_identity_basis via getBetaManagerTeams-
    // filtret men med udvidet SELECT. Vi genkalder betaResetService's filter
    // direkte (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false)
    // for at undgå at modificere getBetaManagerTeams-signaturen (#1309-aftale).
    const fallbackRes = await supabase
      .from("teams")
      .select("id, user_id, season_1_identity_basis")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false);
    if (fallbackRes?.error) {
      throw new Error(`runAcademyIntake teams lookup: ${fallbackRes.error.message}`);
    }
    teams = fallbackRes?.data || [];
  }

  // ── Aktiv sæson ─────────────────────────────────────────────────────────────
  const seasonRes = await supabase
    .from("seasons")
    .select("id, number, start_date")
    .eq("status", "active")
    .maybeSingle();
  if (seasonRes?.error) throw new Error(`runAcademyIntake season lookup: ${seasonRes.error.message}`);

  const season = seasonRes?.data ?? null;

  if (!season) {
    if (dryRun) {
      return { dryRun: true, teams: 0, candidates: 0, note: "no active season in preview" };
    }
    throw new Error("runAcademyIntake: no active season - run after season transition");
  }

  const referenceYear = parseInt(String(season.start_date).slice(0, 4), 10) || 2026;

  // ── Navne-unikhed (mod eksisterende ryttere) ─────────────────────────────────
  const existingRiders = await fetchAllRows(() =>
    supabase.from("riders").select("firstname,lastname").order("id")
  );
  const existingNames = new Set(
    existingRiders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`))
  );

  // ── Idempotens: find allerede-seedede hold for denne sæson ───────────────────
  const seededRows = await fetchAllRows(() =>
    supabase.from("academy_intake").select("team_id").eq("season_id", season.id)
  );
  const seededTeamIds = new Set(seededRows.map((r) => r.team_id));

  // ── Delt PRNG (deterministisk pr. seed, på tværs af alle hold) ───────────────
  const rng = makeRng(seed);

  // ── Per-hold kandidat-generering ─────────────────────────────────────────────
  let totalTeams = 0;
  let totalCandidates = 0;
  const insertedRiderIds = []; // alle nyindsatte akademi-ryttere (til afled-pipeline)

  for (const team of teams) {
    if (seededTeamIds.has(team.id)) continue; // allerede behandlet

    const candidates = generateAcademyCandidates({
      rng,
      referenceYear,
      existingNames,
      identityBasis: team.season_1_identity_basis || null,
    });

    totalTeams++;
    totalCandidates += candidates.length;

    if (dryRun) continue; // ingen writes i preview

    // Apply: insert ryttere → hent id'er → insert academy_intake-rækker
    const riderPayload = candidates.map((c) => c.rider);
    const { data: insertedRiders, error: riderErr } = await supabase
      .from("riders")
      .insert(riderPayload)
      .select("id");
    if (riderErr) throw new Error(`runAcademyIntake rider insert (team ${team.id}): ${riderErr.message}`);

    const intakeRows = insertedRiders.map((r, idx) => ({
      team_id: team.id,
      rider_id: r.id,
      season_id: season.id,
      is_serious: candidates[idx].is_serious,
      status: "offered",
    }));

    const { error: intakeErr } = await supabase
      .from("academy_intake")
      .insert(intakeRows);
    if (intakeErr) throw new Error(`runAcademyIntake intake insert (team ${team.id}): ${intakeErr.message}`);

    for (const r of insertedRiders) insertedRiderIds.push(r.id);
  }

  // ── Afled-pipeline for de nyindsatte akademi-ryttere (#1478) ─────────────────
  // Akademiryttere oprettes EFTER den globale backfill-kæde (relaunch trin 4 vs
  // 6.4) og uden for relaunch slet ikke — så uden dette får de aldrig physiology,
  // rider_derived_abilities, primary/secondary_type eller base_value. Konsekvens:
  // de springes over i træning-engine (#1478 bug #3), mangler ryttertype (#bug 2)
  // og viser rå PCM-stats i stedet for de nye afledte evner (#bug 4).
  if (!dryRun && insertedRiderIds.length > 0) {
    await deriveRiders(supabase, insertedRiderIds, { dryRun: false });
  }

  return { dryRun, teams: totalTeams, candidates: totalCandidates };
}

/**
 * Signer en akademi-kandidat til holdet.
 *
 * #1558: cap-check (8-plads) + rider-update + signing-fee-debit sker ATOMISK i
 * finalize_academy_acquisition-RPC'en under pg_advisory_xact_lock(team_id), så en
 * samtidig youth-auktion-finalize ikke kan dobbelt-debitere samme rytter. Kun
 * offered-check'en sker før RPC-kaldet; RPC'en er den autoritative cap/balance-gate.
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {string} opts.teamId
 * @param {string} opts.riderId
 * @param {number} opts.seasonNumber   — aktiv sæsons nummer (bruges til contract_end_season)
 * @returns {Promise<{riderId, salary, fee, contractEndSeason}>}
 * @throws {Error} 'not_offered' | 'academy_full' | 'insufficient_balance' | 'already_assigned'
 */
export async function signAcademyCandidate(supabase, { teamId, riderId, seasonNumber }) {
  // 1. Hent academy_intake-rækken — skal eksistere og have status 'offered'.
  const { data: intakeRow, error: intakeErr } = await supabase
    .from("academy_intake")
    .select("id, status")
    .eq("team_id", teamId)
    .eq("rider_id", riderId)
    .maybeSingle();
  if (intakeErr) throw new Error(`signAcademyCandidate intake lookup: ${intakeErr.message}`);
  if (!intakeRow || intakeRow.status !== "offered") throw new Error("not_offered");

  // 2. Hent rytterens markedsværdi og beregn løn + signing-fee.
  const { data: rider, error: riderErr } = await supabase
    .from("riders")
    .select("id, firstname, lastname, market_value, base_value, prize_earnings_bonus")
    .eq("id", riderId)
    .maybeSingle();
  if (riderErr) throw new Error(`signAcademyCandidate rider lookup: ${riderErr.message}`);
  if (!rider) throw new Error(`signAcademyCandidate: rytter ${riderId} ikke fundet`);

  const value = calculateRiderMarketValue(rider);
  const salary = Math.max(1, Math.round(value * ACADEMY.SALARY_RATE));
  const fee = Math.round(value * ACADEMY.SIGNING_FEE_RATE);
  const contractEndSeason = seasonNumber + ACADEMY.CONTRACT_LENGTH - 1;
  const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
  const acquiredAt = new Date().toISOString();

  // 3. #1558: cap-check (8-plads) + rider-update + signing-fee-debit sker nu
  // ATOMISK i én RPC under pg_advisory_xact_lock(team_id). Tidligere var
  // cap-tjekket (ulåst getTeamAcademyCount) adskilt fra writes, og denne sti
  // brugte INGEN idempotency_key — så en samtidig finalize (youth_auction_winner)
  // gav to separate finance_transactions (dobbelt-debit). RPC'en lukker racen;
  // idempotency_key nedenfor gør gentagne signeringer af samme rytter sikre.
  //
  // #1483: struktureret metadata så Historik-fanen renderer rytternavnet via
  // backendMessages-i18n i stedet for den rå UUID i description-fallbacken.
  const { data: acq, error: acqErr } = await supabase.rpc("finalize_academy_acquisition", {
    p_team_id: teamId,
    p_rider_id: riderId,
    p_price: fee,
    p_salary: salary,
    p_contract_length: ACADEMY.CONTRACT_LENGTH,
    p_contract_end_season: contractEndSeason,
    p_acquired_at: acquiredAt,
    p_finance_payload: {
      type: "academy_signing",
      amount: -fee,
      description: riderName
        ? `Akademi-signing af ${riderName}`
        : `Akademi-signing af rytter ${riderId}`,
      metadata: {
        code: "tx.academySigning",
        params: { riderName: riderName || riderId },
      },
      // En rytter kan kun optages i ét akademi én gang — riderId er derfor en
      // stabil, unik nøgle der lukker racen mod youth_auction_winner:<auctionId>.
      // (seasonId er ikke i scope her; en akademi-optagelse er en éngangshændelse
      // pr. rytter, så riderId alene er tilstrækkeligt unikt.)
      idempotency_key: `academy_signing:${riderId}`,
    },
  });

  if (acqErr) {
    // 23505 = denne rytter er allerede optaget (cron-/dobbeltklik-retry). Behandl
    // som idempotent no-op snarere end hård fejl.
    if (acqErr.code === DUPLICATE_VIOLATION_CODE) throw new Error("already_assigned");
    throw acqErr;
  }
  if (acq?.code === "academy_full") throw new Error("academy_full");
  if (acq?.code === "insufficient_balance") throw new Error("insufficient_balance");
  if (acq?.code === "already_assigned") throw new Error("already_assigned");
  if (!acq?.ok) throw new Error(`finalize_academy_acquisition uventet svar: ${JSON.stringify(acq)}`);

  // 4. Opdatér academy_intake → signed.
  const { error: intakeUpdateErr } = await supabase
    .from("academy_intake")
    .update({ status: "signed", resolved_at: new Date().toISOString() })
    .eq("id", intakeRow.id);
  if (intakeUpdateErr) throw new Error(`signAcademyCandidate intake update: ${intakeUpdateErr.message}`);

  // 5. Notifikation til hold-ejeren. notifyTeamOwner henter user_id selv.
  await notifyTeamOwner({
    supabase,
    teamId,
    type: "academy_signed",
    // EN-first fallback (#1068 i18n-leak: ingen rå dansk i backend); locale-aware
    // rendering via backendMessages-koderne nedenfor (#666).
    title: "Academy signing complete",
    message: "Your academy prospect has joined your academy.",
    relatedId: riderId,
    metadata: {
      titleCode: "notif.academySigned.title",
      messageCode: "notif.academySigned.message",
    },
  });

  return { riderId, salary, fee, contractEndSeason };
}

/**
 * Default youth-auktion-lister: dynamisk import af youthMarket bryder den
 * statiske import-cyklus (youthMarket → academyIntake.getTeamAcademyCount).
 */
async function defaultListYouthAuction(supabase, riderId) {
  const { listRejectedAsYouthAuction } = await import("./youthMarket.js");
  return listRejectedAsYouthAuction(supabase, { riderId });
}

/**
 * Afvis en akademi-kandidat. Fase B: den afviste kandidat listes straks som en
 * individuel ungdomsauktion (auctions.is_youth=true, ingen sælger). Får den ingen
 * bud, forbliver rytteren en fri ungdom (auctionFinalization-grenen).
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {string} opts.teamId
 * @param {string} opts.riderId
 * @param {Function} [opts.listYouthAuction]  DI-hook (test): (supabase, riderId) => auction
 * @returns {Promise<{riderId, status:'rejected', auctionId: string|null}>}
 * @throws {Error} 'not_offered'
 */
export async function rejectAcademyCandidate(supabase, { teamId, riderId, listYouthAuction = defaultListYouthAuction } = {}) {
  // Verificér at der eksisterer en 'offered' intake-række for (teamId, riderId).
  const { data: intakeRow, error: intakeErr } = await supabase
    .from("academy_intake")
    .select("id, status")
    .eq("team_id", teamId)
    .eq("rider_id", riderId)
    .maybeSingle();
  if (intakeErr) throw new Error(`rejectAcademyCandidate intake lookup: ${intakeErr.message}`);
  if (!intakeRow || intakeRow.status !== "offered") throw new Error("not_offered");

  // Opdatér status → rejected.
  const { error: updateErr } = await supabase
    .from("academy_intake")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", intakeRow.id);
  if (updateErr) throw new Error(`rejectAcademyCandidate update: ${updateErr.message}`);

  // Fase B: list rytteren som ungdomsauktion. Ejerskabet ændres ikke her —
  // rytteren forbliver team_id=NULL indtil en auktionsvinder optager ham i sit
  // akademi (auctionFinalization). Usolgt → fortsat fri ungdom.
  const auction = await listYouthAuction(supabase, riderId);
  return { riderId, status: "rejected", auctionId: auction?.id ?? null };
}
