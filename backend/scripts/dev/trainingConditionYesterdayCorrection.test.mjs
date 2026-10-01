import test from 'node:test';
import assert from 'node:assert/strict';
import { recomputeLegacyDate, formDeltaFor } from './trainingConditionYesterdayCorrection.mjs';
import { buildConditionCutoverProposal } from './trainingConditionCutoverDryRun.mjs';

// Real 28/9 shape: five hard slots, no race, opening fatigue 0 / form 50.
const HARD = [
  { game_day: 0, intensity: 'hard', fatigue: 11, fatigue_delta: 11, form: 51 },
  { game_day: 1, intensity: 'hard', fatigue: 20, fatigue_delta: 9, form: 52 },
  { game_day: 2, intensity: 'hard', fatigue: 28, fatigue_delta: 8, form: 55 },
  { game_day: 3, intensity: 'hard', fatigue: 35, fatigue_delta: 7, form: 58 },
  { game_day: 4, intensity: 'hard', fatigue: 41, fatigue_delta: 6, form: 61 },
];

test('five hard legacy slots recompute to ONE normalized hard day', () => {
  const r = recomputeLegacyDate({ slots: HARD, recoveryAbility: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.openingForm, 50);
  assert.equal(r.raceLoad, 0);
  assert.equal(r.legacyFatigue, 41);
  assert.equal(r.legacyForm, 61);
  assert.ok(r.fatigue >= 9 && r.fatigue <= 11, `one hard day, got ${r.fatigue}`);
  assert.equal(r.form, 50 + formDeltaFor(r.fatigue));
});

test('race load is read from the first slot pre-fatigue and counted once', () => {
  const raced = HARD.map((s) => ({ ...s, fatigue: s.fatigue + 10 }));
  raced[0] = { ...raced[0], fatigue_delta: 11 }; // pre = 21 - 11 = 10 race load
  raced[0].form = 50 + formDeltaFor(raced[0].fatigue);
  const r = recomputeLegacyDate({ slots: raced, recoveryAbility: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.raceLoad, 10);
  const plain = recomputeLegacyDate({ slots: HARD, recoveryAbility: 50 });
  assert.ok(r.fatigue > plain.fatigue);
});

test('refuses anything that does not provably chain', () => {
  assert.equal(recomputeLegacyDate({ slots: HARD.slice(0, 4) }).reason, 'not_five_slots');
  const broken = HARD.map((s) => ({ ...s })); broken[2].fatigue_delta = 3;
  assert.equal(recomputeLegacyDate({ slots: broken }).reason, 'slots_do_not_chain');
  const clamped = HARD.map((s) => ({ ...s })); clamped[0].form = 100;
  assert.equal(recomputeLegacyDate({ slots: clamped }).reason, 'form_clamped');
});

function cutoverInput() {
  return {
    date: '2026-09-29', training_runs: 0,
    runs: [{ race_id: 'race', stage_number: 1, season_id: 'season', profile_type: 'flat',
      entrant_snapshot: ['starter'], scheduled_at: '2026-09-29T09:00:00Z', created_at: '2026-09-29T09:01:00Z' }],
    openings: [{ rider_id: 'starter', opening_form: 61, opening_fatigue: 41,
      expected_form: 61, expected_fatigue: 51, source: 'final-report', source_date: '2026-09-28' }],
    orders: [], roles: [],
    corrections: {
      starter: { fatigue: 10, form: 51, legacyFatigue: 41, legacyForm: 61, source: 'recompute-2026-09-28:x' },
      other: { fatigue: 10, form: 51, legacyFatigue: 41, legacyForm: 61, source: 'recompute-2026-09-28:y' },
    },
    extra_openings: [{ rider_id: 'other', expected_form: 61, expected_fatigue: 41 }],
  };
}

test('cutover applies the correction to starters and non-starters via CAS', () => {
  const p = buildConditionCutoverProposal(cutoverInput());
  const byId = Object.fromEntries(p.args.p_openings.map((o) => [o.rider_id, o]));
  assert.equal(byId.starter.opening_fatigue, 10);
  assert.equal(byId.starter.expected_fatigue, 51);
  assert.equal(byId.other.opening_fatigue, 10);
  assert.equal(byId.other.expected_fatigue, 41);
  assert.deepEqual(p.summary.yesterdayCorrection, { starters: 1, nonStarters: 1, unchanged: 0, mismatch: 0 });
});

test('cutover skips a correction whose current state no longer matches yesterday', () => {
  const input = cutoverInput();
  input.extra_openings[0].expected_fatigue = 30; // something else changed it today
  input.openings[0].opening_fatigue = 40; // yesterday report differs from the recompute input
  const p = buildConditionCutoverProposal(input);
  assert.equal(p.args.p_openings.find((o) => o.rider_id === 'other'), undefined);
  assert.equal(p.args.p_openings[0].opening_fatigue, 40);
  assert.equal(p.summary.yesterdayCorrection.mismatch, 2);
});
