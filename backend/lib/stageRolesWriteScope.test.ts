// #6095 · Skrive-scope for taktik-gem. Ingen DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWriteScope, stageVersions, versionForStage, EMPTY_STAGE_VERSION, type StageRoleRow } from './stageRolesWriteScope.ts';

const row = (stage_number: number, rider_id: string, effort = 'protect', race_role = 'helper'): StageRoleRow =>
  ({ stage_number, rider_id, race_role, effort });

// Giro della Penisola 2/10: 17 etaper, ingen kørt, etape 1 startet (planlagt 11:00, kørt 19:05).
const stored = [row(1, 'a'), row(2, 'a'), row(3, 'a'), row(9, 'b', 'save')];
const versions = stageVersions(stored);
const base = { stageCount: 17, stagesCompleted: 0, timeLockedStages: new Set([1]), currentVersions: versions };
const draft = [row(1, 'a', 'normal', 'captain'), row(2, 'x'), row(3, 'a'), row(9, 'b', 'save')];

test('gem af én ændret etape skriver kun den etape, uanset hvad resten af kladden siger', () => {
  const r = resolveWriteScope({ ...base, overrides: draft, stages: [2], baseVersions: { 2: versionForStage(versions, 2) } });
  assert.deepEqual(r, { ok: true, stages: [2], overrides: [row(2, 'x')] });
});

test('en etape der er ændret et andet sted siden indlæsning giver konflikt, ikke overskrivning', () => {
  const r = resolveWriteScope({ ...base, overrides: draft, stages: [2], baseVersions: { 2: 'gammel-version' } });
  assert.deepEqual(r, { ok: false, error: 'stage_roles_conflict' });
});

test('en tom etape har en fast version, så første gem uden rækker ikke giver falsk konflikt', () => {
  assert.equal(versionForStage(versions, 5), EMPTY_STAGE_VERSION);
  const r = resolveWriteScope({ ...base, overrides: [row(5, 'a')], stages: [5], baseVersions: { 5: EMPTY_STAGE_VERSION } });
  assert.equal(r.ok, true);
});

test('en startet (tidslåst) eller kørt etape kan ikke skrives', () => {
  assert.deepEqual(resolveWriteScope({ ...base, overrides: draft, stages: [1] }), { ok: false, error: 'stage_roles_stage_locked' });
  assert.deepEqual(resolveWriteScope({ ...base, stagesCompleted: 3, overrides: draft, stages: [3] }), { ok: false, error: 'stage_roles_stage_locked' });
});

test('ugyldige stages eller base_versions afvises', () => {
  for (const stages of [[0], [18], [2, 2], ['2'], 'alle']) {
    assert.deepEqual(resolveWriteScope({ ...base, overrides: [], stages }), { ok: false, error: 'stage_roles_invalid_body' });
  }
  assert.deepEqual(resolveWriteScope({ ...base, overrides: [], stages: [2], baseVersions: [] }), { ok: false, error: 'stage_roles_invalid_body' });
});

test('klient fra før #6095 (ingen stages): alle skrivbare etaper som før, men aldrig en startet etape', () => {
  const r = resolveWriteScope({ ...base, overrides: draft });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.stages, Array.from({ length: 16 }, (_, i) => i + 2));
  assert.equal(r.overrides.some((o) => o.stage_number === 1), false, 'kladdens kopi af den startede etape ignoreres');
});

test('versionen afhænger af indhold, ikke rækkefølge', () => {
  const a = stageVersions([row(2, 'a'), row(2, 'b', 'save')]);
  const b = stageVersions([row(2, 'b', 'save'), row(2, 'a')]);
  assert.equal(a[2], b[2]);
  assert.notEqual(a[2], stageVersions([row(2, 'a'), row(2, 'b', 'normal')])[2]);
});
