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

// Deterministisk 32-bit hash (FNV-1a) — samme algoritme som
// starterSquadAllocator.hashStringToSeed, bevidst dupliceret (få linjer) for ikke
// at koble akademi-intake til startholds-allokatoren. Bruges til per-hold PRNG-seed
// så to nye hold ikke får identiske kuld, men hvert hold er reproducerbart.
function hashStringToSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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
 * Slå den aktive sæson op. Returnerer { id, number, start_date } eller null.
 * Delt af batch- og per-hold-stien, så de altid rammer SAMME sæson-definition.
 */
async function fetchActiveSeason(supabase) {
  const seasonRes = await supabase
    .from("seasons")
    .select("id, number, start_date")
    .eq("status", "active")
    .maybeSingle();
  if (seasonRes?.error) throw new Error(`academy-intake season lookup: ${seasonRes.error.message}`);
  return seasonRes?.data ?? null;
}

function referenceYearForSeason(season) {
  return parseInt(String(season.start_date).slice(0, 4), 10) || 2026;
}

// #1584-markør: "fik dette hold nogensinde sit FØRSTE akademi-kuld?"
// (teams.academy_intake_seeded_at). SANDHEDEN for idempotens — IKKE academy_intake-
// rækkerne — så et hold der selv har underskrevet/afvist sine pladser aldrig får et
// gratis-kuld. Service-role-managed (api.js/teamProfileEngine + cron). 1:1-spejling
// af starterSquadAllocator.readSquadMarker/setSquadMarker.
async function readAcademyMarker(supabase, teamId) {
  const { data, error } = await supabase
    .from("teams").select("academy_intake_seeded_at").eq("id", teamId).single();
  if (error) throw new Error(`read academy-intake marker ${teamId}: ${error.message}`);
  return data?.academy_intake_seeded_at ?? null;
}

async function setAcademyMarker(supabase, teamId, nowIso) {
  const { error } = await supabase
    .from("teams").update({ academy_intake_seeded_at: nowIso }).eq("id", teamId);
  if (error) throw new Error(`set academy-intake marker ${teamId}: ${error.message}`);
}

/**
 * Byg sættet af foldede navne på ALLE eksisterende ryttere (navne-unikhed).
 * Delt af batch- og per-hold-stien.
 */
async function fetchExistingFoldedRiderNames(supabase) {
  const existingRiders = await fetchAllRows(() =>
    supabase.from("riders").select("firstname,lastname").order("id")
  );
  return new Set(existingRiders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));
}

/**
 * DELT KERNE (batch + per-hold): generér ét kuld for ÉT hold, indsæt ryttere
 * (pcm_id null, is_academy false) og academy_intake-rækker (status 'offered').
 * Muterer `existingNames` (navne-dedup) og returnerer de nyindsatte rider-id'er.
 *
 * KØRER IKKE afled-pipelinen — det ejer opkalderen, så batch kan afled'e ALLE
 * nyindsatte ryttere i ÉT kald (uændret #1478-adfærd) mens per-hold afled'er sit
 * eget kuld. Begge call-sites deler dermed nøjagtig samme generering+insert-logik,
 * så batch og signup-stien ikke kan drifte fra hinanden.
 *
 * @returns {Promise<string[]>} de nyindsatte akademi-rytteres id'er
 */
async function seedAcademyCohortForTeam(supabase, {
  teamId,
  season,
  referenceYear,
  existingNames,
  rng,
  identityBasis = null,
}) {
  const candidates = generateAcademyCandidates({
    rng,
    referenceYear,
    existingNames,
    identityBasis: identityBasis || null,
  });

  const riderPayload = candidates.map((c) => c.rider);
  const { data: insertedRiders, error: riderErr } = await supabase
    .from("riders")
    .insert(riderPayload)
    .select("id");
  if (riderErr) throw new Error(`academy-intake rider insert (team ${teamId}): ${riderErr.message}`);

  const intakeRows = insertedRiders.map((r, idx) => ({
    team_id: teamId,
    rider_id: r.id,
    season_id: season.id,
    is_serious: candidates[idx].is_serious,
    status: "offered",
  }));

  const { error: intakeErr } = await supabase
    .from("academy_intake")
    .insert(intakeRows);
  if (intakeErr) throw new Error(`academy-intake intake insert (team ${teamId}): ${intakeErr.message}`);

  return insertedRiders.map((r) => r.id);
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
  const season = await fetchActiveSeason(supabase);

  if (!season) {
    if (dryRun) {
      return { dryRun: true, teams: 0, candidates: 0, note: "no active season in preview" };
    }
    throw new Error("runAcademyIntake: no active season - run after season transition");
  }

  const referenceYear = referenceYearForSeason(season);

  // ── Navne-unikhed (mod eksisterende ryttere) ─────────────────────────────────
  const existingNames = await fetchExistingFoldedRiderNames(supabase);

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

    // Tæl kandidater i dry-run via samme generator (ingen writes). I apply-mode
    // går vi gennem den delte kerne (seedAcademyCohortForTeam) som batch og
    // per-hold-stien deler.
    if (dryRun) {
      const candidates = generateAcademyCandidates({
        rng,
        referenceYear,
        existingNames,
        identityBasis: team.season_1_identity_basis || null,
      });
      totalTeams++;
      totalCandidates += candidates.length;
      continue;
    }

    const newIds = await seedAcademyCohortForTeam(supabase, {
      teamId: team.id,
      season,
      referenceYear,
      existingNames,
      rng,
      identityBasis: team.season_1_identity_basis || null,
    });
    totalTeams++;
    totalCandidates += newIds.length;
    for (const id of newIds) insertedRiderIds.push(id);
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
 * #1560-SPEJLING — PER-HOLD akademi-intake: ét nyt hold (oprettet efter relaunch
 * via den normale signup-flow) får automatisk ÉT akademi-kuld (3-5 offered, nul
 * tvungen cost) ved team-create, akkurat som relaunch-holdene fik. Uden dette er
 * akademiet en forever-relaunch-blindgyde for nye signups.
 *
 * Deler kerne-generering + insert (seedAcademyCohortForTeam) med batch-stien, så
 * de to varianter ikke kan drifte. Genbruger de NØJAGTIGT samme kuld-parametre
 * (ACADEMY.INTAKE_MIN/MAX, SERIOUS_MIN/MAX + evne-bånd i generateAcademyCandidates)
 * — ingen nye parametre. Kører afled-pipelinen for kuldet (#1478-fælden: ellers mangler
 * kandidaterne physiology/abilities/type/base_value og springes i træning).
 *
 *   • Idempotens-guard på MARKØREN academy_intake_seeded_at (#1584), IKKE
 *     academy_intake-rækkerne: markør sat → no-op (også hvis holdet selv har
 *     underskrevet/afvist alle sine kandidater → INGEN gratis-kuld-exploit).
 *     Spejler allocateStarterSquadForTeam's markør-gate (#1563). Som
 *     bælte-og-seler beholdes academy_intake-tjekket: rammer markør-NULL stien
 *     et hold der allerede HAR rækker for sæsonen (fx pre-#1584 relaunch-hold
 *     under back-/forward-fill), markeres det blot uden at dobbelt-seede.
 *   • Per-hold PRNG-seed (seed XOR hash(teamId)) → varierede men reproducerbare
 *     kuld på tværs af nye hold; samme determinisme-mønster som start-truppen.
 *   • null season_1_identity_basis (et splinternyt post-relaunch hold) er gyldigt
 *     → generateAcademyCandidates falder tilbage til default-nation-vægte.
 *
 * @param {object} supabase
 * @param {string} teamId
 * @param {object} [opts]
 * @param {number}  [opts.seed=2026]
 * @param {object|null} [opts.identityBasis]  nation-bias (default null = default-vægte)
 * @param {Function} [opts.deriveRiders]      DI-hook; default deriveForRiderIds
 * @param {Function} [opts.now]               DI-hook; default () => new Date()
 * @returns {Promise<{teamId, candidates} | {teamId, skipped}>}
 */
export async function runAcademyIntakeForTeam(supabase, teamId, {
  seed = 2026,
  identityBasis = null,
  deriveRiders = deriveForRiderIds,
  now = () => new Date(),
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");

  // ── Markør-gate (#1584): fik holdet nogensinde sit første kuld? ──────────────
  // Markøren er sandheden for idempotens (IKKE academy_intake-rækkerne), så et
  // hold der selv har underskrevet/afvist sine pladser aldrig får et gratis-kuld.
  // Spejler allocateStarterSquadForTeam's markør-gate. Markør sat → rent no-op.
  const marker = await readAcademyMarker(supabase, teamId);
  if (marker) {
    return { teamId, skipped: "already-seeded", seededAt: marker, candidates: 0 };
  }

  // ── Aktiv sæson ──────────────────────────────────────────────────────────────
  const season = await fetchActiveSeason(supabase);
  if (!season) throw new Error("runAcademyIntakeForTeam: no active season - run after season transition");

  // ── Bælte-og-seler: har holdet ALLEREDE et kuld for denne sæson? ─────────────
  // Markør-NULL men eksisterende academy_intake-rækker = et pre-#1584 hold der
  // fik sit kuld før markøren fandtes (eller et samtidigt kald der vandt racen).
  // Sæt blot markøren — dobbelt-seed aldrig.
  const existing = await fetchAllRows(() =>
    supabase.from("academy_intake").select("id").eq("team_id", teamId).eq("season_id", season.id)
  );
  if (existing.length > 0) {
    await setAcademyMarker(supabase, teamId, now().toISOString());
    return { teamId, skipped: "already-has-cohort", existing: existing.length, candidates: 0 };
  }

  const referenceYear = referenceYearForSeason(season);
  const existingNames = await fetchExistingFoldedRiderNames(supabase);

  // Per-hold seed: basis-seed XOR hash(teamId) → varieret men reproducerbart kuld.
  const teamSeed = (((seed >>> 0) ^ hashStringToSeed(teamId)) >>> 0);
  const rng = makeRng(teamSeed);

  const newIds = await seedAcademyCohortForTeam(supabase, {
    teamId,
    season,
    referenceYear,
    existingNames,
    rng,
    identityBasis: identityBasis || null,
  });

  // Afled-pipeline (#1478): physiology→abilities→type→base_value for kuldet,
  // ellers springes kandidaterne i træning og viser rå PCM-stats.
  if (newIds.length > 0) {
    await deriveRiders(supabase, newIds, { dryRun: false });
  }

  // Markér holdet som seedet (#1584) → self-heal-sweep'en og en re-signup
  // re-seeder ALDRIG. Sættes EFTER seed+derive: fejler noget undervejs forbliver
  // markøren NULL → sweep'en heler holdet. Sandheden, ikke intake-rækkerne.
  await setAcademyMarker(supabase, teamId, now().toISOString());

  return { teamId, candidates: newIds.length };
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
