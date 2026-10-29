/**
 * #1346 — Readiness-gate for manuel sæson-transition.
 * =====================================================
 * Ingen udskudte transfers må vente, og trup-loftets resultat skal holde
 * (se #5855 nedenfor for hvordan det måles).
 * Dertil: ingen aktive auktioner og alle sæsonens løb afviklet
 * (ejer-beslutning 12/6: kritisk check).
 *
 * #2361 — season_end_completed: transitionToNextSeason (season-transition) og
 * processSeasonEnd ("Afslut sæson") er TO adskilte manuelle admin-handlinger.
 * Kører man transition på en stadig-AKTIV sæson, springes board-eval,
 * payDivisionBonuses og processDivisionEnd (op/nedrykning) HELT over —
 * irreversibelt, fordi season-end bagefter afviser en allerede completed
 * sæson. processSeasonEnd sætter seasons.status='completed' som sidste skridt
 * (economyEngine.js, EFTER divisionsbonus + op/nedrykning), så
 * status==='completed' er et robust signal på at season-end faktisk er kørt.
 * Season 0 er undtaget (FIRST_PROMOTION_RELEGATION_SEASON=1): der findes intet
 * season-end-skridt for sæson 0, og 0→1-transitionen kræver fromSeason
 * status='active'.
 *
 * #6120 — final_whistle_sent er fjernet: Final Whistle blev kun sat af den
 * afskaffede Deadline Day-cron (markedet er altid åbent, docs/TRANSFER_MARKET_RULES.md),
 * så checket var permanent rødt uden at beskytte noget.
 *
 * #5855 — markedet er altid åbent, og transfer_windows er død data som ingen
 * kode må ankre adfærd i (docs/TRANSFER_MARKET_RULES.md, "Transfervinduet er
 * afskaffet"). Gaten læser derfor IKKE transfer_windows. Kontrakten er:
 *   - no_deferred_transfers: ingen gennemførte handler, der venter på at blive
 *     flyttet (riders.pending_team_id sat). En udskudt transfer under et
 *     etapeløb flyttes af flush/heal-sweepet; står den stadig ved skiftet,
 *     ville transitionen regne trupper og kontrakter på det gamle hold.
 *     Åbne forhandlinger (pending/countered/awaiting_confirmation) blokerer
 *     ikke: markedet er altid åbent, og finalize-gaten håndhæver trup-loftet
 *     mod tilstanden efter skiftet (TRANSFER_MARKET_RULES §7).
 *   - squad_enforcement_completed: trup-loftets POSTCONDITION måles på data,
 *     ikke på en markør: ingen menneske-styrede, ikke-frosne hold uden for
 *     divisionens trup-grænser, talt med samme semantik som
 *     getTeamMarketState.future_count (nuværende minus udgående plus
 *     indgående udskudte), samme population og senior-tælling som
 *     squadEnforcement.js.
 *
 * Gaten håndhæves i POST /api/admin/season-transition (routes/api.js).
 * Cron, relaunch-orchestratoren (#1103) og scripts/executeSeasonTransition.js
 * kalder transitionToNextSeason direkte og er bevidst ugatede (executeSeasonTransition.js
 * logger dog et eksplicit season-end-verificeret JA/NEJ-warn, #2361).
 */

import { copenhagenDateString, copenhagenHour } from './copenhagenTime.js';
import { isTrainingDateTeam, loadTrainingDateTeams, trainingDateBounds } from './trainingDateReadiness.js';

import { FIRST_PROMOTION_RELEGATION_SEASON } from "./economyConstants.js";
import { loadEmptyPoolFilter } from "./emptyPoolPolicy.js";
import { getSquadLimits } from "./marketUtils.js";
import { applySeniorSquadFilter } from "./squads.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";

/**
 * #5855 — read-only måling af trup-håndhævelsens postcondition.
 * Samme population som processSquadEnforcementCron (menneske-styret, ikke bank,
 * ikke frosset, har user_id) og samme tælling som getSquadSnapshot i
 * squadEnforcement.js (senior-trup, ikke akademi, ikke pensioneret), målt mod
 * getSquadLimits(division) — begge retninger, ligesom håndhævelsen.
 * Returnerer antal hold uden for grænserne og hvilke (#6784: violating_teams =
 * {teamId, teamName, count, min, max}). Kaster ved læsefejl (fail-closed).
 */
export async function countSquadLimitViolations({ supabase } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  let teams;
  let riders;
  let incoming;
  try {
    teams = await fetchAllRows(() => supabase
      .from("teams")
      .select("id, name, division")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .not("user_id", "is", null)
      .order("id", { ascending: true }));
    const teamIds = (teams || []).map((t) => t.id);
    riders = teamIds.length === 0 ? [] : await fetchAllRowsChunkedIn(teamIds, (chunk) =>
      applySeniorSquadFilter(supabase
        .from("riders")
        .select("id, team_id, pending_team_id")
        .in("team_id", chunk))
        .eq("is_retired", false)
        .order("id", { ascending: true }));
    // #5855 (Codex): udskudte indgående transfers tæller paa KOEBERENS trup
    // (getTeamMarketState.future_count), ikke paa saelgerens.
    incoming = teamIds.length === 0 ? [] : await fetchAllRowsChunkedIn(teamIds, (chunk) =>
      applySeniorSquadFilter(supabase
        .from("riders")
        .select("id, pending_team_id, team_id")
        .in("pending_team_id", chunk))
        .eq("is_retired", false)
        .order("id", { ascending: true }));
  } catch (e) {
    throw new Error(`Kunne ikke måle trup-grænser: ${e.message || e}`, { cause: e });
  }

  const effectiveTeamById = new Map();
  for (const r of [...(riders || []), ...(incoming || [])]) {
    effectiveTeamById.set(r.id, r.pending_team_id ?? r.team_id);
  }
  const countByTeam = new Map();
  for (const teamId of effectiveTeamById.values()) countByTeam.set(teamId, (countByTeam.get(teamId) || 0) + 1);
  const violatingTeams = [];
  for (const t of teams || []) {
    const limits = getSquadLimits(t.division);
    const n = countByTeam.get(t.id) || 0;
    if (n > limits.max || n < limits.min) {
      violatingTeams.push({ teamId: t.id, teamName: t.name ?? null, count: n, min: limits.min, max: limits.max });
    }
  }
  return { teams_checked: (teams || []).length, violations: violatingTeams.length, violating_teams: violatingTeams };
}

export async function assessTransitionReadiness({ supabase, fromSeasonId } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");

  const [deferredRes, auctionsRes, racesRes, seasonRes, poolFilterRes] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id")
      .not("pending_team_id", "is", null)
      .order("id", { ascending: true }))
      .then((rows) => ({ data: rows, error: null }), (e) => ({ data: null, error: e })),
    supabase
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "extended"]),
    // #3038-hul lukket 24/8: HEAD-tællingen så bort fra empty-pool-undtagelsen,
    // så et løb i en pulje uden hold blokerede transitionen selvom season-end
    // (assessSeasonEndBlockers) korrekt undtog det. Samme filter nu — og
    // pagineringssikkert (mid-sæson kan uafviklede løb overstige 1000-cappen).
    fetchAllRows(() => supabase
      .from("races")
      .select("id, league_division_id")
      .eq("season_id", fromSeasonId)
      .neq("status", "completed")
      .order("id", { ascending: true }))
      .then((rows) => ({ data: rows, error: null }), (e) => ({ data: null, error: e })),
    supabase
      .from("seasons")
      .select("id, number, status, end_date")
      .eq("id", fromSeasonId)
      .maybeSingle(),
    loadEmptyPoolFilter({ supabase })
      .then((f) => ({ data: f, error: null }), (e) => ({ data: null, error: e })),
  ]);

  if (deferredRes.error) throw new Error(`Kunne ikke tælle udskudte transfers: ${deferredRes.error.message || deferredRes.error}`);
  if (auctionsRes.error) throw new Error(`Kunne ikke tælle auktioner: ${auctionsRes.error.message}`);
  if (racesRes.error) throw new Error(`Kunne ikke tælle løb: ${racesRes.error.message || racesRes.error}`);
  if (seasonRes.error) throw new Error(`Kunne ikke læse sæson: ${seasonRes.error.message}`);
  if (!seasonRes.data) throw new Error(`Sæson ${fromSeasonId} findes ikke`);
  if (poolFilterRes.error) throw new Error(`Kunne ikke læse puljer: ${poolFilterRes.error.message || poolFilterRes.error}`);

  const deferredTransfers = (deferredRes.data || []).length;
  const activeAuctions = auctionsRes.count || 0;
  const { inEmptyPool } = poolFilterRes.data;
  const unfinishedRaces = (racesRes.data || []).filter((r) => !inEmptyPool(r)).length;
  const season = seasonRes.data;
  // #2361: for sæson 0 er der intet season-end-skridt at vente på (0→1-transitionen
  // kræver status='active' — den bliver aldrig 'completed' inden transition).
  const seasonEndRequired = season.number >= FIRST_PROMOTION_RELEGATION_SEASON;
  const seasonEndCompleted = !seasonEndRequired || season.status === "completed";

  // #5855: trup-loftet maales altid paa data (ingen vindue-markoer at stole paa).
  const { violations, violating_teams: violatingTeams = [] } = await countSquadLimitViolations({ supabase });
  const squadOk = violations === 0;
  // #6784: admin skal kunne handle paa fundet, saa de foerste 5 hold vises med antal.
  const shownTeams = violatingTeams.slice(0, 5)
    .map((t) => `${t.teamName ?? t.teamId} ${t.count} (${t.count > t.max ? `max ${t.max}` : `min ${t.min}`})`)
    .join(", ") + (violatingTeams.length > 5 ? ` og ${violatingTeams.length - 5} flere` : "");
  const squadDetail = squadOk
    ? null
    : `${violations} hold er uden for divisionens trup-grænser (inkl. udskudte transfers): ${shownTeams} — ret trupperne før skiftet`;

  // #7282 (ejer 26/10): ingen saesonpause. Dagene foer naeste saesons foerste loeb
  // traenes som brodatoer (trainingDateReadiness.bridgeGameDays), saa et hul koster
  // ikke traening, men der er dage uden loeb. Advarsel i `warnings`, ingen spaerre.
  const { data: nextSeason, error: nextSeasonError } = await supabase
    .from("seasons").select("start_date").eq("number", season.number + 1).maybeSingle();
  if (nextSeasonError) throw new Error(`Kunne ikke læse næste sæson: ${nextSeasonError.message}`);
  const lastDate = season.end_date ? String(season.end_date).slice(0, 10) : null;
  const nextStart = nextSeason?.start_date ? String(nextSeason.start_date).slice(0, 10) : null;
  const breakDays = lastDate && nextStart
    ? Math.round((Date.parse(`${nextStart}T12:00:00Z`) - Date.parse(`${lastDate}T12:00:00Z`)) / 86400000) - 1
    : 0;

  const checks = {
    season_end_completed: {
      ok: seasonEndCompleted,
      critical: true,
      detail: seasonEndCompleted
        ? null
        : `Sæson ${season.number} er stadig '${season.status}' — kør 'Afslut sæson' (season-end) FØRST, ellers springes op/nedrykning + divisionsbonusser over`,
    },
    no_deferred_transfers: {
      ok: deferredTransfers === 0,
      critical: true,
      detail: deferredTransfers === 0
        ? null
        : `${deferredTransfers} gennemførte transfers venter på at blive flyttet (pending_team_id) — kør flush/heal-sweepet først`,
    },
    squad_enforcement_completed: { ok: squadOk, critical: true, detail: squadDetail },
    no_active_auctions: {
      ok: activeAuctions === 0,
      critical: true,
      detail: activeAuctions === 0 ? null : `${activeAuctions} aktive/forlængede auktioner`,
    },
    all_races_completed: {
      ok: unfinishedRaces === 0,
      critical: true,
      detail: unfinishedRaces === 0 ? null : `${unfinishedRaces} løb er ikke afviklet (status er ikke 'completed')`,
    },
  };

  const failed_critical = Object.entries(checks)
    .filter(([, c]) => c.critical && !c.ok)
    .map(([key]) => key);

  const warnings = breakDays > 0
    ? [{ key: "season_break", detail: `${breakDays} dag(e) uden løb mellem sæson ${season.number} og ${season.number + 1} — rytterne træner, men der er ingen løb` }]
    : [];

  return { ready: failed_critical.length === 0, checks, failed_critical, warnings };
}

/**
 * #2805 — Spærre for "Afslut sæson" (POST /admin/seasons/:id/end).
 *
 * Season-end beregner op/nedrykning + divisionsbonusser på season_standings og
 * er irreversibel (transition afviser bagefter at season-end genkøres). Ruten
 * tjekkede hidtil kun pending_race_results — men et løb der ALDRIG er afviklet
 * har ingen række der og passerede tavst. Et for tidligt klik ville droppe alle
 * resterende løb permanent (stage-scheduleren ser kun den aktive sæson) og
 * afgøre op/nedrykning på en ufuldstændig slutstilling.
 *
 * Kontrakten er samme semantik som all_races_completed i transition-gaten
 * ovenfor: HVERT løb i sæsonen skal have status='completed' — også løb med
 * scheduled_at i fremtiden (det er netop det for-tidlige-klik-scenarie).
 * Sæson 0 (ingen løb) passerer naturligt med count 0.
 *
 * BEVIDST ingen force-bypass: transition-endpointets force må heller ikke
 * kunne slå denne klasse af kontrol fra (issue-krav). Et permanent brudt løb
 * skal repareres/annulleres i admin, ikke forbi-klikkes.
 *
 * #3038 — empty-pool-undtagelse (samme diskriminator som stage-scheduleren,
 * P0 2/7-filteret i stageScheduler.js "inEmptyPool"). #2851-reconcilen tømte
 * D4 C-H-puljerne for legacy-AI (enginens design: tier 3/4-puljer uden ægte
 * managere → 0 AI), men S2-kalenderen var materialiseret FØR den tømning med
 * ~143 løb i de puljer. De løb kører aldrig (stage-scheduleren skipper dem
 * korrekt) og må derfor IKKE tælle som spærre — ellers blokerer de "Afslut
 * sæson" for evigt. Løbene BEVARES i kalenderen (en pulje kan aktiveres af
 * nye signups) — kun tællingen her undtager dem.
 */
export async function assessSeasonEndBlockers({ supabase, seasonId } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId) throw new Error("seasonId required");

  // Pagineringssikker (#2974-mønstret): mid-sæson kan uafviklede løb overstige
  // PostgREST's 1000-cap, og en trunkeret læsning ville tavst undertælle spærren.
  let unfinished;
  try {
    unfinished = await fetchAllRows(() => supabase
      .from("races")
      .select("id, league_division_id")
      .eq("season_id", seasonId)
      .neq("status", "completed")
      .order("id", { ascending: true }));
  } catch (e) {
    throw new Error(`Kunne ikke tælle uafviklede løb: ${e.message || e}`, { cause: e });
  }

  // #3038: fælles "puljer uden hold"-diskriminator (emptyPoolPolicy.js) — samme
  // definition som stageScheduler.js og all_races_completed i transition-gaten.
  const { inEmptyPool } = await loadEmptyPoolFilter({ supabase });

  const blockingRaces = (unfinished || []).filter((r) => !inEmptyPool(r));
  const unfinishedRaces = blockingRaces.length;
  if (unfinishedRaces === 0) {
    return { blocked: false, unfinished_races: 0, last_unfinished_stage_at: null, detail: null };
  }

  // Sidste planlagte etape blandt de blokerende (ikke-dormant) uafviklede løb —
  // til en fejlbesked admin kan handle på ("vent til efter X"). Løb uden
  // schedule-rækker giver null.
  //
  // #3014-fejlklassen: én .in("race_id", blockingRaceIds) med hundredvis af
  // id'er (fx et for tidligt "Afslut sæson"-klik med de fleste af sæsonens
  // løb uafviklede) kan ramme PostgRESTs URL-længde-cap — sket 2x før i dette
  // repo. Chunk id-listen og tag MAX scheduled_at på tværs af biddene i stedet
  // for at stole på at én query ser hele mængden.
  const blockingRaceIds = blockingRaces.map((r) => r.id);
  const LAST_STAGE_CHUNK_SIZE = 100;
  let lastAt = null;
  for (let i = 0; i < blockingRaceIds.length; i += LAST_STAGE_CHUNK_SIZE) {
    const chunk = blockingRaceIds.slice(i, i + LAST_STAGE_CHUNK_SIZE);
    const { data: lastStage, error: stageError } = await supabase
      .from("race_stage_schedule")
      .select("scheduled_at")
      .in("race_id", chunk)
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (stageError) throw new Error(`Kunne ikke finde sidste uafviklede etape: ${stageError.message}`);
    const chunkAt = lastStage?.scheduled_at ?? null;
    if (chunkAt && (lastAt === null || new Date(chunkAt).getTime() > new Date(lastAt).getTime())) {
      lastAt = chunkAt;
    }
  }
  return {
    blocked: true,
    unfinished_races: unfinishedRaces,
    last_unfinished_stage_at: lastAt,
    detail:
      `Sæsonen kan ikke afsluttes: ${unfinishedRaces} løb er ikke afviklet endnu` +
      (lastAt ? ` (sidste etape er planlagt til ${lastAt})` : "") +
      `. Op/nedrykning beregnes på slutstillingen — afvent at alle løb er kørt.`,
  };
}

// Admin-vendte strenge samlet her — filen er EXEMPT i i18n-leak-guarden:
// admin-UI er DA-only-konvention (ikke player-facing), og admin_log er internt.
export const TRANSITION_BLOCKED_ERROR = "Sæson-transition blokeret: readiness-gaten er rød";

export function formatForceOverrideDescription(failedCritical) {
  return `Sæson-transition FORCED med rød readiness-gate (${failedCritical.join(", ")})`;
}
/**
 * #6924: the evening run (loadTrainingDateIndex) settles a date from this
 * Copenhagen hour. Before it, the date's training is not due yet.
 */
export const TRAINING_DATE_SETTLEMENT_HOUR = 20;

/**
 * #6898/#6924: a season's final training date. Shared by the season-end gate and
 * the evening run, so both agree on which date closes the season.
 * end_date is null while a season is active and is also written at cutover.
 * The scheduled season calendar is the training axis's date authority.
 * Returns null when the calendar has no valid stage; a read failure throws.
 */
export async function loadFinalTrainingDate({ supabase, seasonId }) {
  // pagination-safe: one maximum timestamp, scoped by the season through races.
  const { data: lastStages, error: calendarError } = await supabase
    .from('race_stage_schedule')
    .select('scheduled_at,races!inner(season_id)')
    .eq('races.season_id', seasonId)
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: false })
    .limit(1);
  if (calendarError) throw new Error(`Kunne ikke læse sidste træningsdato fra sæsonens løbskalender: ${calendarError.message}`);
  const scheduledAt = Array.isArray(lastStages) ? lastStages[0]?.scheduled_at : null;
  const lastInstant = scheduledAt == null ? null : new Date(scheduledAt);
  return lastInstant && Number.isFinite(lastInstant.getTime()) ? copenhagenDateString(lastInstant) : null;
}

/**
 * #6898: read-only fail-closed proof before season-end removes the active season.
 * The final civil date comes from the season's calendar, never end_date or today's index:
 * an empty training_date_work result is not evidence of completed training.
 * Existing registered work always counts, including parked/disappeared teams.
 * Unregistered population mirrors loadTrainingDateContext/currentIds.
 *
 * #6924 (owner decision B, 20/10): the evening run also settles the final date of
 * a season that has just left `active` (loadTrainingDateIndex). So on the final
 * date itself, before the evening run is due, unsettled training no longer
 * blocks: the result is `deferred` and the season can end at any time that day.
 * That holds only while no team has registered work for the date: registered
 * pending/partial work (a manager's press) still blocks, because its frozen opening
 * condition predates the season-start resets (see the gate below).
 * From the evening run's hour, and on any later day, proof is required as before:
 * by then unsettled work means the run failed, not that it has yet to run.
 */
export async function assessFinalTrainingDateSettlement({ supabase, season, now } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!season?.id) throw new Error("season required");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Explicit valid now required");
  if (season.number === 0) return { blocked: false, tick_date: null, detail: null, blockers: [] };

  const tickDate = await loadFinalTrainingDate({ supabase, seasonId: season.id });
  if (!tickDate) {
    return { blocked: true, tick_date: null, blockers: [],
      detail: "Sæsonen kan ikke afsluttes: sidste træningsdato kan ikke findes i sæsonens løbskalender (ingen gyldig planlagt etape)" };
  }
  if (tickDate > copenhagenDateString(now)) {
    return { blocked: true, tick_date: tickDate, blockers: [],
      detail: `Sæsonen kan ikke afsluttes: sidste træningsdato ${tickDate} fra løbskalenderen ligger i fremtiden` };
  }
  const [work, teams, riders] = await Promise.all([
    fetchAllRows(() => supabase.from('training_date_work').select('team_id,status')
      .eq('season_id', season.id).eq('tick_date', tickDate).order('team_id')),
    loadTrainingDateTeams(supabase),
    fetchAllRows(() => supabase.from('riders').select('id,team_id,created_at,acquired_at')
      .eq('is_retired', false).not('team_id', 'is', null).order('id')),
  ]);
  const terminal = new Set(['complete', 'needs_reconciliation']);
  const workByTeam = new Map(work.map(row => [row.team_id, row]));
  const registered = new Set(workByTeam.keys());
  const { end } = trainingDateBounds(tickDate);
  const teamsWithRiders = new Set(riders.filter(rider =>
    (!rider.created_at || new Date(rider.created_at) < end) &&
    (!rider.acquired_at || new Date(rider.acquired_at) < end)).map(rider => rider.team_id));
  const missingTeams = teams.filter(team => !registered.has(team.id) &&
    isTrainingDateTeam(team, registered, end) && teamsWithRiders.has(team.id));

  // Division-less teams use a calendar-day report rather than training_date_work.
  // A reservation (including writing) is never proof. This legacy key has no
  // season_id; date + team + game_day IS NULL is the writer's canonical key.
  const legacyTeams = missingTeams.filter(team => !team.league_division_id);
  const legacyRuns = legacyTeams.length ? await fetchAllRowsChunkedIn(legacyTeams.map(team => team.id), chunk =>
    supabase.from('training_day_runs').select('id,team_id,report').in('team_id', chunk)
      .eq('tick_date', tickDate).is('game_day', null).order('id')) : [];
  const legacySettled = new Set(legacyRuns.filter(row => row.report?.pending !== true &&
    Array.isArray(row.report?.riders) && row.report.tick_date === tickDate &&
    row.report.game_day === null).map(row => row.team_id));
  const blockers = work.filter(row => !terminal.has(row.status))
    .map(row => ({ team_id: row.team_id, reason: row.status ?? 'unknown_status' }));
  for (const team of missingTeams) {
    if (!team.league_division_id && legacySettled.has(team.id)) continue;
    blockers.push({ team_id: team.id, reason: 'missing_registration' });
  }
  // #6924: today's final date is not due yet; the evening run settles it after season-end.
  // Only unregistered teams defer. Registered pending/partial work froze its opening
  // condition before the season-start form/fatigue resets, so settling it after them
  // would quarantine those riders (commit_training_date_tick: unsafe_current_state).
  // It must settle first, as before #6924.
  if (blockers.length && blockers.every(row => row.reason === 'missing_registration') &&
      tickDate === copenhagenDateString(now) && copenhagenHour(now) < TRAINING_DATE_SETTLEMENT_HOUR) {
    return { blocked: false, deferred: true, tick_date: tickDate, blockers,
      detail: `Træning ${tickDate} er ikke afregnet endnu (${blockers.length} hold). Aftenkørslen kl. ${TRAINING_DATE_SETTLEMENT_HOUR} afregner den, også efter sæsonafslutningen.` };
  }
  return { blocked: blockers.length > 0, tick_date: tickDate, blockers,
    detail: blockers.length ? `Sæsonen kan ikke afsluttes: træning ${tickDate} er ikke fuldt afregnet. ` +
      blockers.slice(0, 5).map(row => `${row.team_id}: ${row.reason}`).join(', ') +
      (blockers.length > 5 ? ` (+${blockers.length - 5} hold)` : '') : null };
}
