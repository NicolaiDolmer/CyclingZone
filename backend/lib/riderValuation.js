// Eget data-drevet rytter-værdisystem (#1101) — single source.
//
// Afløser (ved cutover) de tre uci-afledte formel-kopier i schema.sql,
// marketUtils.js og frontend/marketValues.js. I shadow-fasen bruges denne kun
// til at BEREGNE + VISE base_value; den styrer endnu ikke økonomien.
//
// Modellen er en ridge-regression på log(slutpris) trænet af
// scripts/fitRiderValuationModel.js og persisteret i riderValuationModel.json.
// Se docs/decisions/rider-valuation-model-v1.md.

// De 10 udledte abilities (rider_derived_abilities), 0-99.
export const ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobble_classics", "acceleration", "recovery", "tactics", "positioning",
]);

// Fuld feature-rækkefølge. Koefficienterne i modellen er [intercept, ...FEATURE_KEYS].
export const FEATURE_KEYS = Object.freeze([
  ...ABILITY_KEYS,
  "age", "age_sq", "potentiale", "popularity", "is_u25",
]);

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

// Alder i hele år pr. en reference-dato. Deterministisk når asOf gives.
export function riderAge(birthdate, asOf) {
  if (!birthdate) return null;
  const born = new Date(birthdate).getTime();
  if (Number.isNaN(born)) return null;
  const ref = asOf ? new Date(asOf).getTime() : Date.now();
  const age = (ref - born) / MS_PER_YEAR;
  return age > 0 && age < 60 ? age : null;
}

// Byg den rå (ikke-standardiserede) feature-vektor for en rytter.
// abilities: rider_derived_abilities-række. rider: riders-række.
// Manglende værdier returneres som null og erstattes ved predict af modellens
// feature-mean (→ standardiseret bidrag 0 = neutral).
export function featurizeRider(rider = {}, abilities = {}, { asOf } = {}) {
  const f = {};
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    f[k] = Number.isFinite(v) ? v : null;
  }
  const age = riderAge(rider?.birthdate, asOf);
  f.age = age;
  f.age_sq = age == null ? null : age * age;
  const pot = Number(rider?.potentiale);
  f.potentiale = Number.isFinite(pot) ? pot : null;
  // popularity: null behandles som 0 (de fleste ryttere har 0 i dag).
  const pop = Number(rider?.popularity);
  f.popularity = Number.isFinite(pop) ? pop : 0;
  f.is_u25 = rider?.is_u25 ? 1 : 0;
  return f;
}

// Forudsig base_value (CZ$, heltal) for en rytter ud fra en fittet model.
// model: { intercept, coef:{key:val}, means:{key:val}, stds:{key:val},
//          convexity_exponent, log_mean }
// Returnerer null hvis abilities mangler helt (kan ikke værdisættes meningsfuldt).
export function predictBaseValue(rider, abilities, model, { asOf } = {}) {
  if (!model || !model.coef) return null;
  const haveAbilities = ABILITY_KEYS.some((k) => Number.isFinite(Number(abilities?.[k])));
  if (!haveAbilities) return null;

  const f = featurizeRider(rider, abilities, { asOf });

  // Standardiseret lineær prædiktor i log-rummet.
  let logPred = model.intercept ?? 0;
  for (const k of FEATURE_KEYS) {
    const mean = model.means?.[k] ?? 0;
    const std = model.stds?.[k] || 1;
    const raw = f[k] == null ? mean : f[k]; // manglende → neutral
    const z = (raw - mean) / std;
    logPred += (model.coef[k] ?? 0) * z;
  }

  let value = Math.exp(logPred);

  // Mild konveksitets-justering omkring den geometriske middelpris: løft
  // afstanden fra log-middel med en eksponent ≥1 (1.0 = ingen ændring).
  const gamma = model.convexity_exponent ?? 1;
  if (gamma !== 1 && Number.isFinite(model.log_mean)) {
    const adjLog = model.log_mean + (logPred - model.log_mean) * gamma;
    value = Math.exp(adjLog);
  }

  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

// Value-vægtet overall 0-99 (til display/sortering). Bruger modellens
// ability-koefficienter (positive dele, normaliseret) hvis givet, ellers lige
// vægt. Afspejler "hvor værdifuld er denne rytters evneprofil".
export function riderOverall(abilities = {}, model = null) {
  let weights;
  if (model?.coef) {
    const pos = ABILITY_KEYS.map((k) => Math.max(0, model.coef[k] ?? 0));
    const sum = pos.reduce((s, v) => s + v, 0);
    weights = sum > 0 ? pos.map((v) => v / sum) : null;
  }
  if (!weights) weights = ABILITY_KEYS.map(() => 1 / ABILITY_KEYS.length);

  let score = 0;
  ABILITY_KEYS.forEach((k, i) => {
    const v = Number(abilities?.[k]);
    score += (Number.isFinite(v) ? v : 0) * weights[i];
  });
  return Math.round(Math.max(0, Math.min(99, score)));
}

// Rytterens primære speciale = den højeste ability (til label/rolle-udledning).
export function riderSpecialty(abilities = {}) {
  let best = null;
  let bestVal = -1;
  for (const k of ABILITY_KEYS) {
    const v = Number(abilities?.[k]);
    if (Number.isFinite(v) && v > bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}
