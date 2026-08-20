// #4000 — rene scenarie-byggere + statistik-hjælpere for type-dæmpnings-harnesset.
//
// MÅLING, IKKE ÆNDRING: intet i denne fil rører den LIVE model
// (backend/lib/riderValuationModelV4.json) eller nogen DB-skrivning. Filen bygger
// kun ALTERNATIVE model-objekter i hukommelsen, som harnesset
// (typeDampeningHarness4000.mjs) sender gennem den EKSISTERENDE, urørte
// predictBaseValueV4 (riderCareerNpv.js) — præcis samme kaldsvej som produktionen,
// blot med et andet model-objekt.
//
// Baggrund (issue #4000, ejer-godkendt 20/8): V4-modellens offset[type] er fittet
// på meget små stikprøver for sjældne typer — puncheur offset 2,071 (=7,9x
// multiplikator) på n=19, gc 1,6x på n=34, mod tt n=2.622. Bindende rækkefølge
// (kommentar på #3353): niveaukorrektionen (#3449) appliceres FØR denne dæmpning
// flippes — de to må ALDRIG køre samtidig eller omvendt.
//
// TO HÅNDTAG (issue-tekstens (a)/(b) = orkestrator-opgavens (b)/(c)):
//   1. n-vægtet regularisering af offset-tabellen: offset'[t] = offset[t] × n[t]/(n[t]+k).
//      k styrer hvor hårdt der "krybes mod midten" (0) for dårligt understøttede
//      typer — jo mindre n[t], jo tættere n/(n+k) på 0, jo mere offset'[t] → 0.
//      Typer med stort n (tt, climber, sprinter) er næsten urørte.
//   2. alpha-sænkning: fit.alpha (i dag 1,0 = ren speciale-output) sænkes, så
//      O = alpha·speciale-output + (1−alpha)·snit-af-alle-evner — blander mere
//      alsidighed ind, hvilket dæmper typens vægt UDEN at røre offset-tabellen.

/**
 * n-vægtet regularisering af ÉN offset-værdi mod 0 (midten).
 * n/(n+k) → 1 for store n (offset stort set urørt), → 0 for små n (offset → 0).
 * @param {number} offset  fittet offset[type]
 * @param {number} n       antal fit-observationer for typen (model.type_stats[type].n)
 * @param {number} k       regulariserings-styrke (større k = mere dæmpning)
 * @returns {number}
 */
export function regularizeOffset(offset, n, k) {
  const o = Number(offset);
  const nn = Number(n);
  const kk = Number(k);
  if (!Number.isFinite(o)) return o;
  if (!Number.isFinite(nn) || nn < 0 || !Number.isFinite(kk) || kk < 0) return o;
  const weight = nn / (nn + kk);
  return o * weight;
}

/**
 * Regulariserer en HEL offset-tabel mod 0, n-vægtet pr. type.
 * @param {Record<string, number>} offsetTable  model.fit.offset
 * @param {Record<string, {n: number}>} typeStats  model.type_stats
 * @param {number} k
 * @returns {Record<string, number>}
 */
export function regularizeOffsetTable(offsetTable, typeStats, k) {
  const out = {};
  for (const [type, offset] of Object.entries(offsetTable || {})) {
    const n = typeStats?.[type]?.n;
    out[type] = Number.isFinite(Number(n)) ? regularizeOffset(offset, n, k) : offset;
  }
  return out;
}

// ── Scenarie-katalog ─────────────────────────────────────────────────────────
// k-værdier og alpha-værdier fra opgavebeskrivelsen (#4000). "combo" krydser dem
// alle (3×3=9) — billigt at beregne (rene funktioner), og krydset viser om
// håndtagene forstærker eller modvirker hinanden.
export const OFFSET_K_VALUES = Object.freeze([50, 100, 200]);
export const ALPHA_VALUES = Object.freeze([0.85, 0.7, 0.5]);

/**
 * Bygger det fulde scenarie-katalog: baseline + offset-only(3) + alpha-only(3) +
 * combo(3×3=9) = 16 scenarier. Ren metadata (ingen model-objekter her endnu).
 */
export function buildScenarioCatalog() {
  const scenarios = [
    { id: "baseline", label: "Baseline (nuværende live model)", offsetK: null, alpha: null },
  ];
  for (const k of OFFSET_K_VALUES) {
    scenarios.push({ id: `offset_k${k}`, label: `Offset-regularisering k=${k}`, offsetK: k, alpha: null });
  }
  for (const a of ALPHA_VALUES) {
    scenarios.push({ id: `alpha_${String(a).replace(".", "")}`, label: `Alpha-sænkning α=${a}`, offsetK: null, alpha: a });
  }
  for (const k of OFFSET_K_VALUES) {
    for (const a of ALPHA_VALUES) {
      scenarios.push({
        id: `combo_k${k}_a${String(a).replace(".", "")}`,
        label: `Kombination: offset k=${k} + α=${a}`,
        offsetK: k,
        alpha: a,
      });
    }
  }
  return scenarios;
}

/**
 * Bygger et scenarie-model-objekt ud fra base-modellen (dyb kopi — basemodellen
 * MUTERES ALDRIG). offsetK/alpha = null ⇒ den pågældende del af modellen er urørt.
 * @param {object} baseModel  riderValuationModelV4.json-objektet
 * @param {{offsetK?: number|null, alpha?: number|null}} scenario
 */
export function buildScenarioModel(baseModel, { offsetK = null, alpha = null } = {}) {
  const model = JSON.parse(JSON.stringify(baseModel)); // dyb, urørt kopi af base
  if (offsetK != null) {
    model.fit.offset = regularizeOffsetTable(baseModel.fit.offset, baseModel.type_stats, offsetK);
  }
  if (alpha != null) {
    model.fit.alpha = alpha;
  }
  return model;
}

// ── Statistik-hjælpere (rene, testbare) ─────────────────────────────────────

export function median(values) {
  const a = [...values].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function quantile(values, q) {
  const a = [...values].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor(q * a.length)));
  return a[idx];
}

export function mean(values) {
  const a = values.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/**
 * Pct-delta ((after-before)/before)*100. before<=0 eller ikke-finite ⇒ null
 * (ingen meningsfuld procent — undgår division-ved-0/negativ-støj i rapporten).
 */
export function pctDelta(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(a)) return null;
  return ((a - b) / b) * 100;
}

/**
 * Global normaliserings-faktor så scenariets populations-SUM matcher baseline
 * (doktrinen: dæmpningen skal flytte FORDELINGEN, ikke NIVEAUET). factor=1 ⇒
 * ingen normalisering nødvendig. baselineSum<=0 ⇒ null (ingen mening).
 */
export function normalizationFactor(baselineSum, scenarioSum) {
  const b = Number(baselineSum);
  const s = Number(scenarioSum);
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(s) || s <= 0) return null;
  return b / s;
}

// ── Doktrin-sanity: ingen inversion ──────────────────────────────────────────
// "Inden for samme type skal bedre evner stadig give højere værdi i ALLE
// scenarier." Konstruerer en STIGENDE serie af syntetiske, pointvis-dominerende
// evneprofiler (hvert niveau ≥ det forrige i ALLE evner) for én type, og
// verificerer at predictBaseValueV4 er ikke-faldende hen over serien. Ren
// funktion (samme age/potentiale/abilities for alle scenarier — kun
// model-objektet varierer), ingen DB, ingen tilfældighed.
export const MONOTONICITY_ABILITY_LEVELS = Object.freeze([25, 40, 55, 70, 85]);
const MONOTONICITY_AGE = 25;
const MONOTONICITY_POTENTIALE = 4;

function flatAbilities(level, visibleAbilities) {
  const out = {};
  for (const k of visibleAbilities) out[k] = level;
  return out;
}

/**
 * @param {(rider, abilities, model) => number|null} predictFn  predictBaseValueV4
 * @param {string[]} visibleAbilities  VISIBLE_ABILITIES (abilityDerivation.js)
 * @param {object} model  et scenarie-model-objekt (fra buildScenarioModel)
 * @param {string} type   fx "puncheur"
 * @param {number[]} levels  stigende evne-niveauer (0-99)
 * @returns {{ type: string, ok: boolean, values: (number|null)[], levels: number[] }}
 */
export function checkTypeMonotonicity(predictFn, visibleAbilities, model, type, levels = MONOTONICITY_ABILITY_LEVELS) {
  const rider = { valuation_type: type, potentiale: MONOTONICITY_POTENTIALE, age: MONOTONICITY_AGE };
  const values = levels.map((lvl) => predictFn(rider, flatAbilities(lvl, visibleAbilities), model));
  let ok = true;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev == null || cur == null || cur < prev) { ok = false; break; }
  }
  return { type, ok, values, levels };
}
