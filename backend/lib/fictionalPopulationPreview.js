// Delt builder: kør den fiktive launch-population gennem HELE værdi-kæden
// (generator → abilities → typer → base_value) UDEN at røre DB. Brugt af
// preview-scriptet OG admin Rider Explorer-endpointet (#1364-enabler).
import { generateFictionalRiders } from "./fictionalRiderGenerator.js";
import { deriveAbilities } from "./abilityDerivation.js";
import { computeRiderTypes } from "./riderTypes.js";
import { predictBaseValue } from "./riderValuation.js";
import { LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";

export function buildFictionalPopulationPreview({
  count = LAUNCH_POPULATION.count,
  seed = 2026,
  referenceYear = 2026,
  baseline,
  model,
} = {}) {
  if (!baseline || !model) {
    throw new Error("buildFictionalPopulationPreview requires baseline + model");
  }
  const { riders, coverage } = generateFictionalRiders({ seed, count, referenceYear });
  const rows = riders.map((r, i) => {
    const id = `fic-${seed}-${i}`;
    const riderRow = { ...r, id };
    const abilities = deriveAbilities({}, riderRow, { asOfYear: referenceYear });
    const { primary, secondary } = computeRiderTypes(abilities, baseline);
    const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
    const base_value = predictBaseValue(withType, abilities, model);
    return {
      id,
      firstname: r.firstname,
      lastname: r.lastname,
      name: `${r.firstname} ${r.lastname}`,
      age: r._meta?.age ?? null,
      tier: r._meta?.tier ?? null,
      nationality_code: r.nationality_code,
      primary_type: primary.key,
      secondary_type: secondary.key,
      abilities,
      base_value,
      _meta: r._meta,
    };
  });
  return { riders: rows, coverage };
}
