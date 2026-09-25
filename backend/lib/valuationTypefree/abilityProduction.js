// #5497 R2 — typefri præstationsgrundlag (DEV-ONLY, ingen live-kaldesti).
//
// Ejer-beslutning 22/9: typen må ikke sætte prisen. To ryttere med samme evner
// skal have samme grundværdi, uanset primary_type/valuation_type/best_role.
//
// Hvad dette modul erstatter (kun i forslaget, ikke i produktionen):
//   v4 regner "output" som ét type-keyet vægtet snit (outputScore(abilities, type))
//   og lægger et pristillæg pr. type oven i (offset[type]). Begge dele kender
//   rytterens label.
//
// Typefri afløser: rytteren bruges hvor evnerne gavner bedst på ét FÆLLES
// program (ejer-valg 2 og 3). Programmet består af terræner; på hvert terræn
// måles rytterens egnethed med den terræn-opskrift der allerede står i
// weights/displayRecipes.js (samme tal som rating-kortet). Egnetheden samles
// med en BLØD maksimum-funktion vægtet med programmets andel af hvert terræn:
//
//   O_tf = alpha · (1/beta) · ln( Σ_p share_p · exp(beta · R_p(evner)) )
//        + (1 − alpha) · snit(alle evner)
//
//   R_p      = terræn-egnethed 0-99 (roleOutputRaw for terræn p)
//   share_p  = programmets vægt på terræn p (summer til 1)
//   beta     = hvor meget point koncentreres hos de bedste på et terræn
//              (beta → 0: jævnt snit; beta → ∞: kun bedste terræn tæller)
//   alpha    = andel til egnethed vs. alsidighed/hjælperbidrag
//
// Hvorfor en BLØD maksimum og ikke "bedste rolle": argmax skifter terræn
// diskontinuert, så ét evnepoint kan flytte hele værdien til en anden
// opskrift (målt i 1b: flere hundrede procents hop). Den bløde maksimum har en
// begrænset hældning: ∂O/∂evne = Σ_p π_p · ∂R_p/∂evne, hvor π er
// softmax-vægtene. Derfor kan ét evnepoint aldrig give et spring.
//
// Label-fri pr. konstruktion: funktionen læser kun evne-tal. Den tager ikke
// imod en type overhovedet.
//
// Tallene (shares, beta, alpha, a, b, c) fittes af
// backend/scripts/dev/typefree5497Measure.mjs mod en sæson-simulering og
// gemmes PRIVAT (balance-internals/). Ingen tal står i denne fil.

import { DISPLAY_RECIPES, roleOutputRaw } from "../weights/displayRecipes.js";
import { meanAbilityScore } from "../riderValuation.js";

export const TERRAIN_KEYS = Object.freeze(DISPLAY_RECIPES.map((r) => r.key));

// Egnethed pr. terræn (0-99). Et terræn uden brugbare evner falder tilbage til
// snit af alle evner — samme neutrale fallback som v4's outputScore.
export function terrainRatings(abilities = {}) {
  const fallback = meanAbilityScore(abilities);
  return TERRAIN_KEYS.map((key) => {
    const r = roleOutputRaw(abilities, key);
    return Number.isFinite(r) ? r : fallback;
  });
}

// Normalisér programandele til en sum på 1. Accepterer objekt {terræn: vægt}
// eller array i TERRAIN_KEYS-orden. Negative/ugyldige vægte tæller som 0.
export function normalizeShares(shares) {
  const raw = Array.isArray(shares)
    ? TERRAIN_KEYS.map((_, i) => Number(shares[i]))
    : TERRAIN_KEYS.map((k) => Number(shares?.[k]));
  const clean = raw.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = clean.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) return TERRAIN_KEYS.map(() => 1 / TERRAIN_KEYS.length);
  return clean.map((v) => v / sum);
}

// Blød maksimum (vægtet log-sum-exp), numerisk stabil.
export function softBest(ratings, shares, beta) {
  const b = Number(beta);
  if (!(b > 0)) {
    // beta ≤ 0 → vægtet snit (grænsen beta → 0).
    return ratings.reduce((s, r, i) => s + r * shares[i], 0);
  }
  let m = -Infinity;
  for (let i = 0; i < ratings.length; i++) if (shares[i] > 0 && ratings[i] > m) m = ratings[i];
  if (!Number.isFinite(m)) return 0;
  let s = 0;
  for (let i = 0; i < ratings.length; i++) {
    if (shares[i] > 0) s += shares[i] * Math.exp(b * (ratings[i] - m));
  }
  return m + Math.log(s) / b;
}

// Softmax-vægtene π_p: hvor stor en del af rytterens forventede præstation der
// kommer fra hvert terræn. Bruges til rapportering ("hvor bruges rytteren").
export function terrainUse(abilities, params) {
  const shares = normalizeShares(params?.shares);
  const R = terrainRatings(abilities);
  const b = Number(params?.beta) > 0 ? Number(params.beta) : 0;
  const m = Math.max(...R);
  const w = R.map((r, i) => shares[i] * Math.exp(b * (r - m)));
  const sum = w.reduce((s, v) => s + v, 0) || 1;
  return Object.fromEntries(TERRAIN_KEYS.map((k, i) => [k, w[i] / sum]));
}

// O_tf — typefri effektiv output (0-99-skala).
export function effectiveOutput(abilities = {}, params = {}) {
  const alpha = Number.isFinite(Number(params.alpha)) ? Math.min(1, Math.max(0, Number(params.alpha))) : 1;
  const shares = normalizeShares(params.shares);
  const best = softBest(terrainRatings(abilities), shares, params.beta);
  if (alpha >= 1) return best;
  return alpha * best + (1 - alpha) * meanAbilityScore(abilities);
}

// Sæson-produktion i kroner fra O_tf: ét fælles niveau-led (ingen offset[type]).
//   prod(O) = exp(a + b·O + c·O²)
// Monotoni-vagt: med c < 0 vender parablen ved O* = −b/(2c). Output over O*
// holdes på toppunktet, så en bedre rytter aldrig kan blive billigere.
export function productionFromOutput(O, prod = {}) {
  const a = Number(prod.a);
  const b = Number(prod.b);
  const c = Number.isFinite(Number(prod.c)) ? Number(prod.c) : 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let o = Number(O);
  if (!Number.isFinite(o)) return null;
  if (c < 0) {
    const vertex = -b / (2 * c);
    if (o > vertex) o = vertex;
  }
  const oMax = Number(prod.output_max);
  if (Number.isFinite(oMax) && o > oMax) o = oMax;
  const v = Math.exp(a + b * o + c * o * o);
  return Number.isFinite(v) ? v : null;
}
