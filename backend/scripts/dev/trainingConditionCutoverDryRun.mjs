// Read-only proposal builder. Never connects to or mutates a database.
// Input/output contain private rider data and must stay outside the public repo.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { raceFatigueLoad } from '../../lib/raceFatigue.js';
import { effortFatigueMultiplier } from '../../lib/raceRoles.js';
import { copenhagenDateString } from '../../lib/copenhagenTime.js';
import { orderEffortByRiderForStage, resolvedEffortByRiderForStage } from '../../lib/raceStageRoles.js';
import { seasonResetFatigue } from '../../lib/seasonFatigueReset.js';
import { seasonResetForm } from '../../lib/seasonFormReset.js';
import { settleTrainingDateCondition } from '../../lib/trainingDateCondition.js';

export function replayOpeningFromSeasonReset({ riderId, targetDate, proof, previousReport, days }) {
  const meta = proof?.phaseLog?.meta;
  const reset = meta?.phases?.find(row => row.phase === 'season_fatigue_reset');
  if (!proof?.phaseLog?.id || !meta?.to_season_id || !Number.isInteger(meta?.to_season_number) ||
      meta.status !== 'completed' || meta.error || !reset || reset.error || proof.fatigueMode !== 'full') {
    throw new Error('Completed full fatigue reset evidence required');
  }
  if (!proof.formRun?.completed_at || proof.formRun.season_id !== meta.to_season_id || proof.formRun.mode !== proof.formConfig?.mode) {
    throw new Error('Completed matching form reset evidence required');
  }
  if (!previousReport?.id || !Number.isFinite(previousReport.form) ||
      !Number.isFinite(Date.parse(previousReport.created_at)) || !Number.isFinite(Date.parse(meta.transition_at)) ||
      Date.parse(previousReport.created_at) > Date.parse(meta.transition_at)) throw new Error('Pre-reset report evidence required');
  if (!Number.isFinite(Date.parse(proof.configured_at)) || Date.parse(proof.configured_at) > Date.parse(meta.transition_at)) throw new Error('Historical reset configuration required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proof.seasonStartDate)) throw new Error('Canonical season start date required');
  let condition = {
    fatigue: seasonResetFatigue({ fatigue: previousReport.fatigue, mode: proof.fatigueMode }),
    form: seasonResetForm({ form: previousReport.form, riderId, season: meta.to_season_number, ...proof.formConfig }),
  };
  let date = proof.seasonStartDate;
  for (const day of days ?? []) {
    if (day.date !== date || day.date >= targetDate) throw new Error('Forward replay dates must be complete and ordered');
    if (day.settled === true) {
      condition = settleTrainingDateCondition({ riderId, dateStr: day.date, condition,
        intensities: day.intensities, raceLoads: day.raceLoads, recoveryAbility: day.recoveryAbility });
    } else if (day.settled !== false || day.recordedRaceStarts !== 0 || day.recordedTrainingRuns !== 0) {
      throw new Error('Cannot infer missing historical activity');
    }
    date = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  if (date !== targetDate) throw new Error('Forward replay does not reach the cutover date');
  return { fatigue: condition.fatigue, form: condition.form,
    source: `season-reset-forward:${proof.phaseLog.id}:${previousReport.id}` };
}

export function buildConditionCutoverProposal(input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.training_runs !== 0) {
    throw new Error('An explicit date with no training runs is required');
  }
  const yesterday = new Date(Date.parse(input.date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const seasonIds = new Set(input.runs.map(run => run.season_id));
  if (seasonIds.size !== 1) throw new Error('Exactly one canonical season is required');
  const starters = new Set();
  const stageKeys = new Set();
  const loads = [];
  for (const run of input.runs) {
    if (copenhagenDateString(new Date(run.scheduled_at)) !== input.date) throw new Error('Stage is outside the cutover date');
    const key = `${run.race_id}:${run.stage_number}`;
    if (stageKeys.has(key)) throw new Error('Duplicate stage snapshot');
    stageKeys.add(key);
    if (!run.profile_type || !Array.isArray(run.entrant_snapshot)) throw new Error('Missing immutable stage input');
    const roles = (input.roles ?? []).filter(row => row.race_id === run.race_id && row.stage_number === run.stage_number);
    const orders = (input.orders ?? []).filter(row => row.race_id === run.race_id && row.stage_number === run.stage_number);
    if (!Number.isFinite(Date.parse(run.created_at))) throw new Error('Stage snapshot time required');
    for (const row of [...roles, ...orders]) {
      if (row.updated_at != null && !Number.isFinite(Date.parse(row.updated_at))) {
        throw new Error('Unprovable effort timestamp; authoritative evidence required');
      }
      if (row.updated_at && Date.parse(row.updated_at) > Date.parse(run.created_at)) {
        throw new Error('Effort was modified after the stage snapshot; authoritative evidence required');
      }
    }
    const overrides = new Map([[run.stage_number, new Map(roles.map(row => [row.rider_id, row]))]]);
    const efforts = resolvedEffortByRiderForStage(overrides, run.stage_number, orderEffortByRiderForStage(orders, run.stage_number));
    const stageStarters = new Set();
    for (const entry of run.entrant_snapshot) {
      const riderId = typeof entry === 'string' ? entry : entry?.rider_id;
      if (!riderId || stageStarters.has(riderId)) throw new Error('Invalid or duplicate immutable starter');
      stageStarters.add(riderId);
      starters.add(riderId);
      loads.push({ rider_id: riderId, race_id: run.race_id, stage_number: run.stage_number,
        load: raceFatigueLoad(run.profile_type) * effortFatigueMultiplier(efforts?.get(riderId) ?? 'normal') });
    }
  }
  const openingIds = new Set();
  const openings = input.openings.map(row => {
    if (!starters.has(row.rider_id) || openingIds.has(row.rider_id)) throw new Error('Opening roster mismatch');
    openingIds.add(row.rider_id);
    let opening = row;
    if ((row.source_date !== yesterday || !row.source) && !row.forward_evidence) {
      // Exact inverse of the legacy race writer (fatigue += load, form untouched),
      // valid only for ONE start today that is a stage 1 (no rest-day recovery
      // before it) and no clamp at 100. Anything else still needs evidence.
      const mine = loads.filter(l => l.rider_id === row.rider_id);
      const run = mine.length === 1 ? input.runs.find(r => r.race_id === mine[0].race_id && r.stage_number === mine[0].stage_number) : null;
      const opened = Number(row.expected_fatigue) - Number(mine[0]?.load);
      if (!run || run.stage_number !== 1 || !Number.isInteger(opened) || opened < 0 || !(row.expected_fatigue < 100)) {
        throw new Error('Yesterday final report or documented forward replay required');
      }
      opening = { ...row, opening_fatigue: opened, opening_form: row.expected_form,
        source: `legacy-single-start-inverse:${run.race_id}:${run.stage_number}` };
    } else if (row.source_date !== yesterday || !row.source) {
      const replay = replayOpeningFromSeasonReset({ riderId: row.rider_id, targetDate: input.date,
        proof: input.seasonResetProof, ...row.forward_evidence });
      opening = { ...row, opening_fatigue: replay.fatigue, opening_form: replay.form, source: replay.source };
    }
    for (const field of ['opening_form', 'opening_fatigue', 'expected_form', 'expected_fatigue']) {
      if (!Number.isFinite(opening[field]) || opening[field] < 0 || opening[field] > 100) throw new Error(`Invalid ${field}`);
    }
    return { rider_id: opening.rider_id, opening_form: opening.opening_form, opening_fatigue: opening.opening_fatigue,
      expected_form: opening.expected_form, expected_fatigue: opening.expected_fatigue, source: opening.source };
  });
  if (openingIds.size !== starters.size) throw new Error('Missing opening conditions');
  const args = { p_season_id: [...seasonIds][0], p_tick_date: input.date, p_openings: openings, p_loads: loads };
  return { operation: 'bootstrap_training_condition_date', requiresOwnerGo: true,
    preconditions: ['Deploy verified code', 'Pause scheduler and drain legacy finalizers', 'Re-export fresh data', 'Review CAS and complete stage coverage'],
    summary: { date: input.date, riders: starters.size, stages: stageKeys.size, loads: loads.length,
      changedConditions: openings.filter(row => row.opening_form !== row.expected_form || row.opening_fatigue !== row.expected_fatigue).length },
    sha256: createHash('sha256').update(JSON.stringify(args)).digest('hex'), args };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: input.private.json output.private.json');
  const proposal = buildConditionCutoverProposal(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  fs.writeFileSync(process.argv[3], JSON.stringify(proposal, null, 2));
  console.log(JSON.stringify({ ...proposal.summary, sha256: proposal.sha256, applied: false }));
}
