// Akademi-intake (#1308) — genererer kandidat-kuld pr. menneske-hold og
// indsætter dem i riders + academy_intake. Flag-gated via academyFlag.js;
// opkalderen (relaunchOrchestrator) checker flaget FØR kald. Idempotent
// pr. sæson: hold allerede i academy_intake springes over.

import { getBetaManagerTeams } from "./betaResetService.js";
import { generateAcademyCandidates } from "./academyGenerator.js";
import { fetchAllRows } from "./supabasePagination.js";
import { foldNameNordic } from "./pcmRiderMatcher.js";
import { makeRng } from "./fictionalRiderGenerator.js";

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
 * @returns {Promise<{dryRun, teams, candidates} | {dryRun, teams, candidates, note}>}
 */
export async function runAcademyIntake(supabase, {
  dryRun = true,
  seed = 2026,
  getManagerTeams,
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
    throw new Error("runAcademyIntake: no active season — kør efter sæson-transition");
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
  }

  return { dryRun, teams: totalTeams, candidates: totalCandidates };
}
