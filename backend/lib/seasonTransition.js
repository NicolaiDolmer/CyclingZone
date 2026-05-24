/**
 * Slice 08 — Sæson-transition orchestrator
 * =========================================
 * Lukker sæson X (status='completed', end_date=transitionAt) og åbner
 * sæson X+1 (status='active', start_date=transitionAt). Idempotent per
 * fase: re-run skipper allerede-gjort arbejde via UUID-existens-tjek.
 *
 * Faser (rækkefølge er kritisk):
 *   1. Validate (fromSeason er 'active', toSeason ikke endnu eksisterende)
 *   2. Insert next season (status='active')
 *   3. Mark previous season completed
 *   4. Close prev transfer_window (status='closed')
 *   5. Insert next transfer_window (status='closed' — racing-sæson)
 *   6. Sponsor-payout via processSeasonStart(nextSeasonId)
 *   7. admin_log entry (action_type='season_transition')
 *
 * Special case sæson 0 → 1:
 *   Sæson 0 er open-beta-fase uden løb/standings/lønninger. Klassisk
 *   processSeasonEnd er irrelevant. Engine antager at processSeasonEnd
 *   ER kørt FØR (for sæson ≥ 1) — for sæson 0 springes det helt over.
 *
 * Sponsor-modifier sæson 1: managers har KUN baseline (completed,
 * budget_modifier=1.0) eller 1yr (pending, ikke completed), så
 * processSeasonStart's `activeBoards.filter(b => b.negotiation_status === "completed")`
 * matcher kun baseline → modifier=1.0 → sæson 1 er fredet by-design.
 */

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";
import { notifySeasonEvent as defaultNotifySeasonEvent } from "./discordNotifier.js";
import {
  buildSponsorStandingsContext,
  computeSponsorForSeason,
  FIRST_VARIABLE_SPONSOR_SEASON,
} from "./sponsorEngine.js";

let processSeasonStartImpl;
async function getProcessSeasonStart() {
  if (!processSeasonStartImpl) {
    processSeasonStartImpl = (await import("./economyEngine.js")).processSeasonStart;
  }
  return processSeasonStartImpl;
}

// ─── UUID helpers ─────────────────────────────────────────────────────────────

/**
 * Deterministisk UUID for sæson N: 00000000-0000-0000-0000-{N as 12 hex chars}.
 * Sæson 0 = ...000, sæson 1 = ...001, sæson 16 = ...010, osv.
 */
export function computeSeasonUuid(seasonNumber) {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    throw new Error(`Invalid season number: ${seasonNumber}`);
  }
  const hex = seasonNumber.toString(16).padStart(12, "0");
  return `00000000-0000-0000-0000-${hex}`;
}

/**
 * Deterministisk UUID for sæson N's transfer_window:
 * 00000000-0000-0000-0000-{N as 8 hex chars}aaaa.
 */
export function computeTransferWindowUuid(seasonNumber) {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    throw new Error(`Invalid season number: ${seasonNumber}`);
  }
  const hex = seasonNumber.toString(16).padStart(8, "0");
  return `00000000-0000-0000-0000-${hex}aaaa`;
}

// ─── Plan-builder (used in both dry-run + real run) ───────────────────────────

export async function buildTransitionPlan({ supabase, fromSeasonId }) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: fromSeason, error: fromError } = await supabase
    .from("seasons")
    .select("id, number, status, start_date, end_date")
    .eq("id", fromSeasonId)
    .maybeSingle();
  if (fromError) throw new Error(`Could not load season ${fromSeasonId}: ${fromError.message}`);
  if (!fromSeason) throw new Error(`Season ${fromSeasonId} not found`);

  const toSeasonNumber = fromSeason.number + 1;
  const toSeasonId = computeSeasonUuid(toSeasonNumber);
  const toWindowId = computeTransferWindowUuid(toSeasonNumber);

  const { data: existingTo } = await supabase
    .from("seasons").select("id, status").eq("id", toSeasonId).maybeSingle();

  // Resume-support (#578): tillad completed fromSeason når toSeason eksisterer.
  // Signatur på partial failure efter mark_previous_completed (fase 3) — fase 4-8
  // er alle idempotente og kan genoptages. Completed UDEN toSeason er en faktisk
  // fejl (sandsynligvis manuel DB-tilstand) og blokeres stadig.
  const isResumeFromPartialFailure =
    fromSeason.status === "completed" && Boolean(existingTo);
  if (fromSeason.status !== "active" && !isResumeFromPartialFailure) {
    throw new Error(
      `Cannot transition from season ${fromSeason.number}: status='${fromSeason.status}' (must be 'active' or 'completed' with existing next season for resume)`
    );
  }

  const { data: humanTeams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, sponsor_income, division")
    .eq("is_ai", false)
    .eq("is_frozen", false);
  if (teamsError) throw new Error(`Could not load teams: ${teamsError.message}`);
  const sponsorStandingsContext = await loadSponsorPreviewStandings({
    supabase,
    fromSeasonId: fromSeason.id,
    toSeasonNumber,
  });

  // Sponsor-preview viser base før board/pullout-modifier. Den samme sponsor-engine
  // bruges i processSeasonStart, så admin-preview og faktisk payout ikke driver.
  const sponsorPreview = (humanTeams || []).map((team) => ({
    team_id: team.id,
    team_name: team.name,
    division: team.division,
    ...buildSponsorPreviewRow(team, toSeasonNumber, sponsorStandingsContext),
  }));

  return {
    from_season: {
      id: fromSeason.id,
      number: fromSeason.number,
      start_date: fromSeason.start_date,
    },
    to_season: {
      id: toSeasonId,
      number: toSeasonNumber,
      transfer_window_id: toWindowId,
    },
    already_transitioned: Boolean(existingTo),
    teams_affected: sponsorPreview.length,
    sponsor_base_total: sponsorPreview.reduce((s, p) => s + p.sponsor_base, 0),
    sponsor_breakdown: sponsorPreview,
  };
}

async function loadSponsorPreviewStandings({ supabase, fromSeasonId, toSeasonNumber }) {
  if (toSeasonNumber < FIRST_VARIABLE_SPONSOR_SEASON) {
    return buildSponsorStandingsContext([]);
  }
  const { data, error } = await supabase
    .from("season_standings")
    .select("team_id, division, rank_in_division, total_points")
    .eq("season_id", fromSeasonId);
  if (error) throw new Error(`Could not load sponsor preview standings: ${error.message}`);
  return buildSponsorStandingsContext(data || []);
}

function buildSponsorPreviewRow(team, toSeasonNumber, sponsorStandingsContext) {
  const lastSeasonStanding = sponsorStandingsContext.standingByTeamId.get(team.id) || null;
  const breakdown = computeSponsorForSeason({
    seasonNumber: toSeasonNumber,
    team,
    lastSeasonStanding,
    divisionStandings: lastSeasonStanding
      ? sponsorStandingsContext.divisionStandingsByDivision.get(lastSeasonStanding.division) || []
      : [],
  });
  return {
    sponsor_base: breakdown.gross_sponsor,
    sponsor_mode: breakdown.mode,
    sponsor_variable: breakdown.variable,
    sponsor_formula_base: breakdown.base,
    sponsor_breakdown: breakdown,
  };
}

// ─── Idempotent fase-helpers ──────────────────────────────────────────────────

async function insertSeasonIfMissing(supabase, seasonId, seasonNumber, transitionAtIso) {
  const { data: existing } = await supabase
    .from("seasons").select("id, status, start_date").eq("id", seasonId).maybeSingle();

  if (existing) {
    // Legacy /admin/seasons-endpoint kan have pre-created rowen med status='upcoming'
    // (typisk 0→1 hvor sæson 1 er admin-oprettet før engine'n bruges). Engine'ns
    // kontrakt siger sæson X+1 skal være 'active' efter transition — promotér her
    // så confirm-dialogen ikke lyver og processSeasonStart kører mod en faktisk
    // aktiv sæson. Andre statusser ('active', 'completed') skipper som før.
    if (existing.status === "upcoming") {
      const { error } = await supabase
        .from("seasons")
        .update({ status: "active", start_date: existing.start_date || transitionAtIso })
        .eq("id", seasonId);
      if (error) throw new Error(`Could not activate season ${seasonNumber}: ${error.message}`);
      return { updated: true, reason: "promoted upcoming → active", season_id: seasonId, season_number: seasonNumber };
    }
    return { skipped: true, reason: `season ${seasonNumber} already exists`, status: existing.status };
  }

  const { error } = await supabase
    .from("seasons")
    .insert({
      id: seasonId,
      number: seasonNumber,
      status: "active",
      start_date: transitionAtIso,
      end_date: null,
    });
  if (error) throw new Error(`Could not insert season ${seasonNumber}: ${error.message}`);

  return { inserted: true, season_id: seasonId, season_number: seasonNumber };
}

async function markSeasonCompleted(supabase, seasonId, transitionAtIso) {
  const { data: current } = await supabase
    .from("seasons").select("status, end_date").eq("id", seasonId).maybeSingle();

  if (!current) throw new Error(`Season ${seasonId} disappeared mid-transition`);
  if (current.status === "completed") {
    return { skipped: true, reason: "already completed", end_date: current.end_date };
  }

  const { error } = await supabase
    .from("seasons")
    .update({ status: "completed", end_date: transitionAtIso })
    .eq("id", seasonId);
  if (error) throw new Error(`Could not mark season completed: ${error.message}`);

  return { updated: true };
}

async function closePrevTransferWindow(supabase, fromSeasonId, transitionAtIso) {
  const { data: window } = await supabase
    .from("transfer_windows")
    .select("id, status")
    .eq("season_id", fromSeasonId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!window) {
    return { skipped: true, reason: "no transfer_window for prev season" };
  }
  if (window.status === "closed") {
    return { skipped: true, reason: "already closed", window_id: window.id };
  }

  const { error } = await supabase
    .from("transfer_windows")
    .update({ status: "closed", closed_at: transitionAtIso })
    .eq("id", window.id);
  if (error) throw new Error(`Could not close prev transfer_window: ${error.message}`);

  return { updated: true, window_id: window.id };
}

async function insertTransferWindowIfMissing(supabase, windowId, seasonId, transitionAtIso) {
  const { data: existing } = await supabase
    .from("transfer_windows").select("id, status").eq("id", windowId).maybeSingle();

  if (existing) {
    return { skipped: true, reason: "window already exists", status: existing.status };
  }

  const { error } = await supabase
    .from("transfer_windows")
    .insert({
      id: windowId,
      season_id: seasonId,
      status: "closed",
      created_at: transitionAtIso,
    });
  if (error) throw new Error(`Could not insert next transfer_window: ${error.message}`);

  return { inserted: true, window_id: windowId };
}

async function writeAdminLog(supabase, payload) {
  const { fromSeasonId, toSeasonId, fromNumber, toNumber, transitionAtIso, adminUserId, plan } = payload;

  // Idempotency: tjek om vi allerede har logget denne transition.
  // Vi bruger metadata.from_season_id + metadata.to_season_id for at matche eksisterende rows.
  const { data: existing } = await supabase
    .from("admin_log")
    .select("id")
    .eq("action_type", ADMIN_ACTION_TYPE.SEASON_TRANSITION)
    .contains("meta", { from_season_id: fromSeasonId, to_season_id: toSeasonId })
    .maybeSingle();

  if (existing) {
    return { skipped: true, reason: "admin_log entry already exists", id: existing.id };
  }

  // description er NOT NULL i admin_log. Cron-runs har adminUserId=null — kræver
  // at admin_log.admin_user_id er gjort nullable (migration 2026-05-21 efter
  // sæson-loop-incidenten). Uden description-feltet eller med null admin_user_id
  // fejlede tidligere INSERT silently → 0 season_transition-rows i logs trods
  // 4 reelle transitions kørte (incident 2026-05-21 21:15–21:45 UTC).
  const { data, error } = await supabase
    .from("admin_log")
    .insert({
      action_type: ADMIN_ACTION_TYPE.SEASON_TRANSITION,
      admin_user_id: adminUserId,
      description: adminUserId
        ? `Sæson-transition: ${fromNumber} → ${toNumber} (manuel via admin)`
        : `Sæson-transition: ${fromNumber} → ${toNumber} (auto via cron)`,
      target_team_id: null,
      meta: {
        from_season_id: fromSeasonId,
        from_season_number: fromNumber,
        to_season_id: toSeasonId,
        to_season_number: toNumber,
        transition_at: transitionAtIso,
        teams_affected: plan.teams_affected,
        sponsor_base_total: plan.sponsor_base_total,
      },
      created_at: transitionAtIso,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not write admin_log: ${error.message}`);

  return { inserted: true, id: data.id };
}

// ─── Hovedfunktion ────────────────────────────────────────────────────────────

/**
 * Udfør sæson-transition. Idempotent — re-run efter delvis fejl er sikker.
 *
 * Re-run accepteres når enten:
 *   - fromSeason.status='active' (normal kørsel), eller
 *   - fromSeason.status='completed' OG toSeason eksisterer (resume efter
 *     partial failure efter mark_previous_completed; alle remaining faser er
 *     idempotente). Se #578.
 *
 * @param {object} args
 * @param {object} args.supabase                — Supabase service-role client
 * @param {string} args.fromSeasonId            — UUID på sæsonen der lukkes (active eller completed-med-resume)
 * @param {Date|string} [args.transitionAt]     — tidspunkt for transition (default: nu)
 * @param {boolean} [args.dryRun]               — hvis true: ingen writes, returnér plan
 * @param {string|null} [args.adminUserId]      — auth.uid for admin-loggen
 * @param {object} [args.deps]                  — dependency-injection for tests
 * @returns {Promise<{ ok: true, dryRun: boolean, plan: object, log?: Array }>}
 */
export async function transitionToNextSeason({
  supabase,
  fromSeasonId,
  transitionAt = new Date(),
  dryRun = false,
  adminUserId = null,
  deps = {},
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");

  const transitionAtIso = transitionAt instanceof Date ? transitionAt.toISOString() : transitionAt;

  const plan = await buildTransitionPlan({ supabase, fromSeasonId });

  if (dryRun) {
    return { ok: true, dryRun: true, plan };
  }

  if (plan.already_transitioned) {
    // Kan stadig være halvfærdig — fortsæt fase 2-6 (alle er idempotente).
  }

  const log = [];

  log.push({
    phase: "insert_next_season",
    ...(await insertSeasonIfMissing(
      supabase, plan.to_season.id, plan.to_season.number, transitionAtIso
    )),
  });

  log.push({
    phase: "mark_previous_completed",
    ...(await markSeasonCompleted(supabase, fromSeasonId, transitionAtIso)),
  });

  log.push({
    phase: "close_prev_transfer_window",
    ...(await closePrevTransferWindow(supabase, fromSeasonId, transitionAtIso)),
  });

  log.push({
    phase: "insert_next_transfer_window",
    ...(await insertTransferWindowIfMissing(
      supabase, plan.to_season.transfer_window_id, plan.to_season.id, transitionAtIso
    )),
  });

  // Phase 6: sponsor-payout + payroll (idempotent via partial UNIQUE-indices
  // på sponsor:team:season + salary/negative_interest:team:season +
  // uniq_loan_interest_per_loan_season).
  //
  // #535: processSeasonStart returnerer nu { sponsor: [...], payroll: { results, summary } }
  // i stedet for ren sponsor-array. Bagudkompatibilitet: ældre stubs (tests
  // der returnerer et array eller intet payroll-felt) håndteres som "ingen
  // payroll-data" i return-log.
  const processSeasonStartFn = deps.processSeasonStart ?? (await getProcessSeasonStart());
  const seasonStartResult = await processSeasonStartFn(plan.to_season.id, { supabase });

  const sponsorList = Array.isArray(seasonStartResult)
    ? seasonStartResult
    : (seasonStartResult?.sponsor || []);
  log.push({
    phase: "sponsor_payout",
    count: sponsorList.length,
  });

  // Phase 6b: season_payroll — aggregeret summary af payroll-trinene
  // (loan_interest, salary, emergency_loan, negative_balance_interest).
  // Tidligere skete dette inde i processSeasonStart uden at counts/totaler
  // blev returneret. Admin måtte køre manuel SQL i Supabase for at
  // verificere at de forventede rows blev skrevet (audit 2026-05-21).
  if (seasonStartResult && typeof seasonStartResult === "object" && seasonStartResult.payroll) {
    log.push({
      phase: "season_payroll",
      ...seasonStartResult.payroll.summary,
    });
  } else {
    // Legacy stub (test der returnerer en array) — log tom payroll-summary
    // så fase-count er stabil, men markér eksplicit at data ikke kunne
    // udledes så UI'en ikke viser misvisende 0-tællinger som "korrekt".
    log.push({
      phase: "season_payroll",
      skipped: true,
      reason: "processSeasonStart returnerede ikke payroll-summary",
    });
  }

  log.push({
    phase: "admin_log",
    ...(await writeAdminLog(supabase, {
      fromSeasonId,
      toSeasonId: plan.to_season.id,
      fromNumber: plan.from_season.number,
      toNumber: plan.to_season.number,
      transitionAtIso,
      adminUserId,
      plan,
    })),
  });

  // Phase 7: Discord-broadcast (fire-and-forget). Pre-incident 2026-05-21 var
  // cron-fyrede transitions silent — bruger spotted først loopen efter 30 min.
  // Kaldet placeres her så både cron + /admin/season-transition broadcaster ens
  // (legacy /admin/seasons/:id/start og /end bruger separate kald).
  const notifyFn = deps.notifySeasonEvent ?? defaultNotifySeasonEvent;
  try {
    await notifyFn({ type: "season_started", seasonNumber: plan.to_season.number });
    log.push({ phase: "discord_broadcast", sent: true });
  } catch (err) {
    log.push({ phase: "discord_broadcast", sent: false, error: err.message });
  }

  return { ok: true, dryRun: false, plan, log };
}
