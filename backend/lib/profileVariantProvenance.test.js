import test from 'node:test';
import assert from 'node:assert/strict';
import { persistedVariant } from './profileVariantProvenance.js';

const races = [{ id: 'fixture-race', season_id: 'fixture-season', pool_race_id: 'fixture-pool', race_class: 'Class2' }];
const generated = race => [{ stage_number: 1, profile_type: 'flat', finale_type: 'bunch_sprint', distance_km: 100 + race.season_variant }];
const stored = [{ ...generated({ season_variant: 3 })[0], race_id: 'fixture-race', generator_version: 6, is_manual: false }];

test('recovers the actually persisted global variant rather than the old local winner', () => {
  assert.equal(persistedVariant({ races, persistedProfiles: stored, generateProfiles: generated }), 3);
});
test('legacy profiles retain the legacy resolver path', () => {
  assert.equal(persistedVariant({ races, persistedProfiles: [{ ...stored[0], generator_version: 5 }], generateProfiles: generated }), null);
});
test('unreproducible current profiles refuse a destructive reconstruction', () => {
  assert.throws(() => persistedVariant({ races, persistedProfiles: [{ ...stored[0], distance_km: 999 }], generateProfiles: generated }), /reproduce/);
});
test('ambiguous partial evidence refuses guessing a different missing stage', () => {
  const generateProfiles = race => [{ stage_number: 1, profile_type: 'flat', finale_type: 'bunch_sprint', distance_km: 100 },
    { stage_number: 2, profile_type: 'hilly', finale_type: 'punch', distance_km: 100 + race.season_variant }];
  assert.throws(() => persistedVariant({ races, persistedProfiles: [{ ...stored[0], distance_km: 100 }], generateProfiles }), /ambiguous/);
});
