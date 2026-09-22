// Version 6 profiles may use a jointly selected variant. Reconstruct from the
// persisted output before any rewrite; never guess from the old local winner.
import { generateRaceStageProfiles, GENERATOR_VERSION } from './raceStageProfileGenerator.js';

const fields = ['stage_number', 'profile_type', 'finale_type', 'demand_vector', 'distance_km',
  'elevation_gain_m', 'climbs', 'sprints', 'sectors', 'segments', 'weather'];
export const PERSISTED_PROFILE_SELECT = ['race_id', 'generator_version', 'is_manual', ...fields].join(',');

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function signature(profile) {
  const wire = JSON.parse(JSON.stringify(Object.fromEntries(fields.map(key => [key, profile[key] ?? null]))));
  return JSON.stringify(ordered(wire));
}

export function persistedVariant({ races, persistedProfiles = [], catalogMeta = new Map(), generateProfiles = generateRaceStageProfiles, maxAttempts = 12 }) {
  const ids = new Set(races.map(r => r.id));
  const evidence = persistedProfiles.filter(p => ids.has(p.race_id) && !p.is_manual && p.generator_version >= 6);
  if (!evidence.length) return null;
  if (evidence.some(p => p.generator_version > GENERATOR_VERSION)) throw Error('Stored profiles require a newer generator; refusing rewrite');
  const raceById = new Map(races.map(r => [r.id, r]));
  const generate = (race, attempt) => {
    const meta = catalogMeta.get(race.pool_race_id) || {};
    return generateProfiles({ ...race, external_id: meta.external_id ?? null,
      terrain_archetype: meta.terrain_archetype ?? null, season_variant: attempt });
  };
  const candidates = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cache = new Map();
    const profiles = race => {
      if (!cache.has(race.id)) cache.set(race.id, generate(race, attempt));
      return cache.get(race.id);
    };
    if (evidence.every(row => {
      const generated = profiles(raceById.get(row.race_id)).find(p => p.stage_number === row.stage_number);
      return generated && signature(generated) === signature(row);
    })) candidates.push({ attempt, all: () => races.map(r => profiles(r).map(signature)) });
  }
  if (!candidates.length) throw Error('Cannot reproduce persisted version-6 profiles; refusing rewrite');
  if (candidates.length > 1) {
    const first = JSON.stringify(candidates[0].all());
    if (candidates.some(c => JSON.stringify(c.all()) !== first)) throw Error('Persisted profile evidence is ambiguous; refusing rewrite');
  }
  return candidates[0].attempt;
}
