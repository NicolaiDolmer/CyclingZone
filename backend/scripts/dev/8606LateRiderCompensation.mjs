// #8606: dry-run of the compensation for late riders (ejer-go 24/11: byg + vis praecise tal
// foer noget skrives). A rider who joined a team after the date's roster was frozen stood in no
// roster and lost the whole date (20/11-23/11). The repair runs through the existing #6061 path:
//   1. an explicit rider-date list (rider_id, team_id on the date, season_id, tick_date,
//      game_days), produced read-only by LATE_RIDER_LIST_SQL and kept private;
//   2. the #6061 inventory/calculation, with the engine's own development model per date
//      (XP from development_xp_from_date, curve B, Udviklingsscore B/catch-up, per-date rule);
//   3. the apply payload for apply_training_compensation_6061 (idempotent, one receipt per
//      rider and race day). This script never writes to the database and has no apply flag:
//      apply6061Compensation.mjs applies the approved payload after a separate production go.
// Owner rules (24/11): a sold rider is compensated too (the training follows the rider, to his
// current team); every team gets the same rule. A released rider has no team the writer can
// credit and is shown as blocked.
//
// Run (from backend/):
//   node scripts/dev/8606LateRiderCompensation.mjs --print-list-sql
//   infisical run --env=prod --silent -- node scripts/dev/8606LateRiderCompensation.mjs \
//     --list=../balance-internals/8606/late-riders.json --through=2026-11-23 --as-of=<ISO now>
// Output: totals per anonymous team (Hold A, B, ...) on stdout; review, inputs and payload
// files in balance-internals/8606/ (gitignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllRowsChunkedIn } from '../../lib/supabasePagination.js';
import { readConditionWriterFlag } from '../../lib/trainingDateConditionFlag.js';
import { ABILITY_CAP_PER_DATE_FLAG_KEY } from '../../lib/dailyTrainingEngine.js';
import { loadDevelopmentScoreB } from '../../lib/developmentScoreWiring.js';
import { loadRaceCatchUp } from '../../lib/raceCatchUpWiring.js';
import { loadDevelopmentCurveB } from '../../lib/developmentCurveBFlag.ts';
import { readCurveBIgnitedOn, curveBTransitionForDate, loadCurveBTransitionRoster } from '../../lib/developmentCurveBTransition7382.ts';
import { loadDevelopmentXp, readDevelopmentXpFromDate } from '../../lib/developmentXpFlag.ts';
import { loadXpFirstDatePayoutRiderIds } from '../../lib/developmentXpFirstDate.js';
import { isManagerTeamForDevelopment } from '../../lib/managerTeamForDevelopment.js';
import { roundedXp } from '../../lib/developmentXp.ts';
import { buildRecoveryManifest, workFromRiderDates } from './prepare6061TrainingRecovery.mjs';
import { calculateCompensation, loadCompensationInputs } from './calculate6061Compensation.mjs';
import { captureSourceHashes, changedSourceTables, buildApplyPayload, serializeApplyPayload } from './compensation6061Source.mjs';

// Read-only. The MED rows of the #8606 dry-run (C:\Users\...\8606-dryrun.sql, private), with
// one change by the owner 24/11: a rider no longer on the team is included, because the
// compensation follows the rider. Still out: open dates, already compensated, any receipt on the
// date, in another team's roster, retired, bank/frozen/test teams, no abilities, injured now.
// Run it via the read-only MCP/psql session and save the JSON array as the --list file.
export const LATE_RIDER_LIST_SQL = `
WITH params AS (
  SELECT DATE '2026-11-20' AS d_from, DATE '2026-11-23' AS d_to,
         (now() AT TIME ZONE 'Europe/Copenhagen')::date AS today
),
work AS (
  SELECT w.team_id, w.season_id, w.tick_date, w.game_days, w.expected_rider_ids,
         (w.tick_date::timestamp AT TIME ZONE 'Europe/Copenhagen')       AS date_start,
         ((w.tick_date + 1)::timestamp AT TIME ZONE 'Europe/Copenhagen') AS date_end,
         t.is_bank, t.is_frozen, t.is_test_account
  FROM training_date_work w
  JOIN seasons s ON s.id = w.season_id AND s.status = 'active'
  JOIN teams t ON t.id = w.team_id
  CROSS JOIN params p
  WHERE w.tick_date BETWEEN p.d_from AND p.d_to AND t.is_ai IS NOT TRUE
),
joined AS (
  SELECT r.id AS rider_id, r.team_id, GREATEST(COALESCE(r.acquired_at, r.created_at), COALESCE(r.created_at, r.acquired_at)) AS joined_at
  FROM riders r WHERE r.team_id IS NOT NULL
  UNION ALL
  SELECT a.rider_id, a.team_id, a.resolved_at FROM academy_intake a WHERE a.status = 'signed' AND a.resolved_at IS NOT NULL
  UNION ALL
  SELECT e.rider_id, e.to_team_id, e.occurred_at FROM rider_ownership_events e WHERE e.to_team_id IS NOT NULL
),
cand AS (
  SELECT DISTINCT ON (w.team_id, w.tick_date, j.rider_id) w.*, j.rider_id
  FROM work w
  JOIN joined j ON j.team_id = w.team_id AND j.joined_at >= w.date_start AND j.joined_at < w.date_end
  WHERE NOT j.rider_id = ANY (w.expected_rider_ids)
  ORDER BY w.team_id, w.tick_date, j.rider_id, j.joined_at DESC
)
SELECT COALESCE(json_agg(json_build_object(
         'rider_id', c.rider_id, 'team_id', c.team_id, 'season_id', c.season_id,
         'tick_date', to_char(c.tick_date, 'YYYY-MM-DD'), 'game_days', c.game_days)
         ORDER BY c.tick_date, c.team_id, c.rider_id), '[]'::json) AS late_riders
FROM cand c
JOIN riders r ON r.id = c.rider_id
CROSS JOIN params p
WHERE c.tick_date < p.today
  AND r.is_retired IS NOT TRUE
  AND NOT (c.is_bank IS TRUE OR c.is_frozen IS TRUE OR c.is_test_account IS TRUE)
  AND EXISTS (SELECT 1 FROM rider_derived_abilities a WHERE a.rider_id = c.rider_id)
  AND NOT EXISTS (SELECT 1 FROM training_compensation_receipts k WHERE k.rider_id = c.rider_id
                    AND k.season_id = c.season_id AND k.game_day = ANY (c.game_days))
  AND NOT EXISTS (SELECT 1 FROM training_rider_ticks t WHERE t.rider_id = c.rider_id
                    AND t.season_id = c.season_id AND t.game_day = ANY (c.game_days))
  AND NOT EXISTS (SELECT 1 FROM training_date_work o WHERE o.season_id = c.season_id AND o.tick_date = c.tick_date
                    AND o.team_id <> c.team_id AND o.expected_rider_ids @> ARRAY[c.rider_id])
  AND NOT EXISTS (SELECT 1 FROM rider_condition rc WHERE rc.rider_id = c.rider_id
                    AND ((rc.injured_until IS NOT NULL AND rc.injured_until >= p.today) OR COALESCE(rc.injury_race_days_left, 0) > 0));
`;

/**
 * PURE: the engine's development model for each listed rider, per listed date. `model` holds what
 * the engine's own loaders returned (see loadDevelopmentModel); `ticks` are the riders' real
 * receipts (training_rider_ticks with report).
 */
export function buildDevelopmentContexts({ riderIds, ticks = [], model }) {
  const contexts = {};
  for (const id of riderIds) {
    const own = ticks.filter((t) => t.rider_id === id);
    const dateReports = {};
    for (const date of model.dates) {
      const rows = own.filter((t) => t.tick_date === date).map((t) => t.report ?? null).filter(Boolean);
      if (rows.length) dateReports[date] = rows;
    }
    contexts[id] = {
      xpByDate: model.xpByDate,
      xpFromDate: model.xpFromDate ?? null,
      // Developed under XP on a real date = his stored bar is already paid (never twice).
      alreadyDeveloped: !!model.xpFromDate && own.some((t) => t.tick_date >= model.xpFromDate && t.report?.xp_developed === true),
      eligibleAfterIgnition: (model.eligibleAfterIgnition ?? []).includes(id),
      curveB: model.curveB ?? null,
      curveBTransitionByDate: model.curveBTransitionByRider?.[id] ?? {},
      developmentScoreB: model.developmentScoreB ?? null,
      raceCatchUp: model.raceCatchUp ?? null,
      capPerDateOn: model.capPerDateOn === true,
      dateReports,
    };
  }
  return contexts;
}

/** Read-only: the engine's loaders for every listed date, in the engine's order (strict reads). */
export async function loadDevelopmentModel(supabase, { dates, riderIds, riders, abilityRows }) {
  const capPerDateOn = await readConditionWriterFlag(supabase, ABILITY_CAP_PER_DATE_FLAG_KEY);
  const [developmentScoreB, raceCatchUp] = await Promise.all([
    loadDevelopmentScoreB({ supabase, strict: true, capPerDateOn }),
    loadRaceCatchUp({ supabase, strict: true, capPerDateOn }),
  ]);
  const curveB = await loadDevelopmentCurveB({ supabase, strict: true });
  // Read the ignition stamp only (the engine's ensureCurveBIgnition would write a missing one).
  const ignitedOn = curveB ? await readCurveBIgnitedOn(supabase, { strict: true }) : null;
  const curveBTransitionByRider = {};
  const xpByDate = {};
  for (const date of dates) {
    xpByDate[date] = await loadDevelopmentXp({ supabase, tickDate: date, strict: true, developmentScoreB, raceCatchUp });
    const transition = curveB ? curveBTransitionForDate({ ignitedOn, tickDate: date }) : null;
    if (!transition) continue;
    const roster = await loadCurveBTransitionRoster(supabase, { transition, riderIds, strict: true });
    for (const id of riderIds) {
      const row = roster.forRider(id);
      if (row) (curveBTransitionByRider[id] ??= {})[date] = { weight: row.weight, abilities: [...row.abilities] };
    }
  }
  const xpFromDate = Object.values(xpByDate).some(Boolean) ? await readDevelopmentXpFromDate(supabase, { strict: true }) : null;
  // A first XP date after the start date pays the stored bar only to riders who stood on a
  // manager team at the start (the engine's own lookup, per rider and his current team).
  const eligibleAfterIgnition = [];
  const firstXpDate = dates.filter((d) => xpByDate[d]).sort()[0] ?? null;
  if (xpFromDate && firstXpDate && firstXpDate > xpFromDate) {
    for (const rider of riders.filter((r) => r.team_id)) {
      const payout = await loadXpFirstDatePayoutRiderIds({
        supabase, developmentXp: xpByDate[firstXpDate], developmentXpIgnition: false, xpFromDate, conditionPerDate: true,
        developmentAllowed: true, tickDate: firstXpDate, abilityRows: abilityRows.filter((a) => a.rider_id === rider.id), teamId: rider.team_id,
      });
      if (payout?.has(rider.id)) eligibleAfterIgnition.push(rider.id);
    }
  }
  return { dates, capPerDateOn, developmentScoreB, raceCatchUp, curveB, curveBTransitionByRider, xpByDate, xpFromDate, eligibleAfterIgnition };
}

const teamLabel = (n) => {
  const letters = (i) => (i < 26 ? String.fromCharCode(65 + i) : letters(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
  return `Hold ${letters(n)}`;
};

/**
 * PURE: totals per team on the date (the list's team), anonymous (Hold A, B, ... in team-id
 * order) and in all. No ids, names or ability levels leave this function.
 */
export function summarizeByTeam({ state, result }) {
  const inventory = buildRecoveryManifest(state);
  const teamOf = new Map(inventory.candidates.map((c) => [`${c.rider_id}:${c.tick_date}`, c.team_id]));
  const teamIds = [...new Set(inventory.candidates.map((c) => c.team_id))].sort();
  const label = new Map(teamIds.map((id, i) => [id, teamLabel(i)]));
  const row = () => ({ rider_days: 0, riders: new Set(), sessions: 0, points: 0, xp: 0, blocked_riders: new Set(), blocked_reasons: {} });
  const rows = new Map(teamIds.map((id) => [id, row()]));
  for (const plan of result.plans) {
    const perDay = new Map((plan.perDay ?? []).map((d) => [d.key, d]));
    for (const day of plan.days) {
      const team = teamOf.get(`${plan.rider_id}:${day.tickDate}`);
      const r = rows.get(team);
      if (!r) continue;
      const sim = perDay.get(day.key);
      r.rider_days += 1;
      r.riders.add(plan.rider_id);
      if (day.kind !== 'bound_rest') r.sessions += 1;
      r.points += Object.values(sim?.gains ?? {}).reduce((s, n) => s + Number(n), 0);
      r.xp += Object.values(roundedXp(sim?.xp ?? {})).reduce((s, n) => s + Number(n), 0);
    }
  }
  for (const b of result.blocked) {
    const dates = inventory.candidates.filter((c) => c.rider_id === b.rider_id);
    for (const team of new Set(dates.map((c) => c.team_id))) {
      const r = rows.get(team);
      r.blocked_riders.add(b.rider_id);
      r.blocked_reasons[b.reason] = (r.blocked_reasons[b.reason] ?? 0) + 1;
    }
  }
  const teams = teamIds.map((id) => {
    const r = rows.get(id);
    return { team: label.get(id), rider_days: r.rider_days, riders: r.riders.size, sessions: r.sessions, ability_points: r.points, xp: r.xp, blocked_riders: r.blocked_riders.size, blocked_reasons: r.blocked_reasons };
  });
  const total = teams.reduce((t, r) => ({
    rider_days: t.rider_days + r.rider_days, sessions: t.sessions + r.sessions, ability_points: t.ability_points + r.ability_points, xp: t.xp + r.xp,
  }), { rider_days: 0, sessions: 0, ability_points: 0, xp: 0 });
  total.riders = result.plans.length;
  total.blocked_riders = new Set(result.blocked.map((b) => b.rider_id)).size;
  total.list_rider_dates = inventory.candidates.length;
  return { teams, total };
}

/** Human-readable lines for the owner card; anonymous. */
export function formatSummary({ teams, total }) {
  const lines = teams.map((t) => `${t.team}: ${t.riders} ryttere, ${t.rider_days} rytter-loebsdage (${t.sessions} traeningspas), ${t.ability_points} evnepoint, ${t.xp} XP`
    + (t.blocked_riders ? `; blokeret ${t.blocked_riders} (${Object.entries(t.blocked_reasons).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''));
  lines.push(`I alt: ${total.riders} ryttere, ${total.rider_days} rytter-loebsdage (${total.sessions} traeningspas), ${total.ability_points} evnepoint, ${total.xp} XP; blokeret ${total.blocked_riders}; listen havde ${total.list_rider_dates} rytter-datoer`);
  return lines;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function parseLateRiderArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    if (arg === '--print-list-sql') opts.printSql = true;
    else if (arg.startsWith('--list=')) opts.list = arg.slice(7);
    else if (arg.startsWith('--through=')) opts.through = arg.slice(10);
    else if (arg.startsWith('--as-of=')) opts.asOf = arg.slice(8);
    // No --apply here on purpose: this is the dry-run. apply6061Compensation.mjs writes.
    else throw new Error(`Unsupported argument: ${arg}; this tool is read-only`);
  }
  if (opts.printSql) return opts;
  if (!opts.list || !ISO_DATE.test(opts.through ?? '') || !opts.asOf) throw new Error('Use --list=FILE --through=YYYY-MM-DD --as-of=ISO_TIMESTAMP');
  return opts;
}

async function main() {
  const opts = parseLateRiderArgs(process.argv.slice(2));
  if (opts.printSql) { console.log(LATE_RIDER_LIST_SQL.trim()); return; }
  const riderDates = JSON.parse(readFileSync(resolve(opts.list), 'utf8'));
  // Validate the list and the closed cutoff before any credentials or reads.
  const work = workFromRiderDates(riderDates);
  buildRecoveryManifest({ through: opts.through, asOf: opts.asOf, work: [], riders: [], conditions: [], ticks: [], settlements: [], loads: [], plans: [], weekPlans: [], legacyReports: [] });
  if (work.some((w) => w.tick_date > opts.through)) throw new Error('A listed date is after --through; close it first');
  const { createClient } = await import('@supabase/supabase-js');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) throw new Error('Supabase credentials required');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const inputs = await loadCompensationInputs(supabase, { through: opts.through, asOf: opts.asOf, riderDates });
  const { ids, scope, hashesBefore, state, fullRiders, abilityRows, seasons, teamContexts, stageBySlot, boundBySlot } = inputs;
  const dates = [...new Set(state.work.map((w) => w.tick_date))].sort();
  const model = await loadDevelopmentModel(supabase, { dates, riderIds: ids, riders: fullRiders, abilityRows });
  const developmentContexts = buildDevelopmentContexts({ riderIds: ids, ticks: state.ticks, model });
  const currentTeamIds = [...new Set(fullRiders.map((r) => r.team_id).filter(Boolean))];
  const teams = await fetchAllRowsChunkedIn(currentTeamIds, (c) => supabase.from('teams').select('id,user_id,is_ai,is_bank,is_test_account').in('id', c).order('id'));
  const managerTeamIds = teams.filter((t) => isManagerTeamForDevelopment(t)).map((t) => t.id);
  const result = await calculateCompensation({ state, fullRiders, abilityRows, seasons, teamContexts, stageBySlot, boundBySlot, developmentContexts, managerTeamIds });
  const changed = changedSourceTables(hashesBefore, await captureSourceHashes(supabase, scope, opts.through));
  if (changed.length) throw new Error(`Source changed during calculation (${changed.join(',')}); repeat dry-run`);
  result.source_scope = scope; result.source_hashes = hashesBefore; result.case_filter = { issue: 8606, rider_dates: riderDates.length };
  const summary = summarizeByTeam({ state, result });
  const directory = resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'balance-internals', '8606', opts.through);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'compensation-current-plans.json'), JSON.stringify({ ...result, team_summary: summary }, null, 2));
  writeFileSync(resolve(directory, 'compensation-inputs.json'), JSON.stringify({ ...inputs, model, developmentContexts, managerTeamIds }, null, 2));
  for (const line of formatSummary(summary)) console.log(line);
  if (!result.plans.length) { console.log('Intet at skrive: ingen rytter-datoer tilbage (allerede kompenseret eller blokeret).'); return; }
  const payload = serializeApplyPayload(buildApplyPayload(result, { scope, sourceHashes: hashesBefore }));
  // The only file the writer accepts. Approve its exact sha256, not the review file.
  writeFileSync(resolve(directory, 'compensation-apply-payload.json'), payload.raw);
  console.log(JSON.stringify({ ...result.summary, apply_payload_bytes: payload.bytes, apply_payload_sha256: payload.sha256 }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
