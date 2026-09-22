// #5443 · Ren udvælgelses- og valideringslogik for dagens smalle oplåsning af
// `riders.valuation_type`. Ingen DB, ingen fs — testbar med `node --test`.
//
// Dagens rettelse er bevidst SMAL: den retter kun de ryttere hvor den frosne
// værditype gør rytteren for BILLIG, og kun så langt at han ikke havner over
// det niveau den kommende permanente model (V5a) ville give ham. Ingen falder i
// dag, og ingen får en værdi der senere skal ned igen.
//
// De fire krav en rytter skal opfylde — alle gen-valideres mod prod på
// kørselstidspunktet, ikke kun da listen blev lavet:
//   1. stadig aktiv og på et menneskehold
//   2. stadig et mismatch (`valuation_type` ≠ `primary_type`)
//   3. værdien STIGER når typen rettes (mere end `minGainPct`)
//   4. den nye værdi overskyder ikke V5a-målet med mere end `maxOvershootPct`
//
// Hver afvisning bærer en årsag, så tørkørslen kan vise præcis hvorfor en
// rytter fra listen ikke kom med — fx fordi han har trænet siden morgenens
// søndagskørsel og tallene har flyttet sig.

export const SELECTION_DEFAULTS = Object.freeze({
  minGainPct: 1,        // værdien skal stige mere end 1 %
  maxOvershootPct: 10,  // må højst ligge 10 % over V5a-målet
});

// Taerskler sammenlignes med en lille tolerance. Uden den afgoer flydende-tals-
// stoej graenserne: (110000/100000 - 1) * 100 giver 10,000000000000009, og en
// raa `> 10` ville afvise en rytter der ligger PRAECIS paa det dokumenterede
// loft. Tolerancen er mindre end enhver forskel der betyder noget i kroner.
const EPS = 1e-9;

export const SKIP_REASONS = Object.freeze({
  NOT_FOUND: "ikke fundet i prod",
  RETIRED: "pensioneret",
  NOT_HUMAN_TEAM: "ikke længere på et menneskehold",
  NO_MISMATCH: "valuation_type er allerede lig primary_type",
  NO_ABILITIES: "ingen evne-række",
  NO_VALUE: "kunne ikke beregne en værdi",
  NO_STORED_VALUE: "ingen gemt base_value at sammenligne med",
  NOT_A_GAIN: "værdien stiger ikke længere",
  OVERSHOOT: "ville overskyde måL-modellen",
});

/**
 * Vurdér ÉN rytter. Alle tal gives af kalderen (som har hentet dem fra prod).
 *
 * @param {object} c kandidat:
 *   { id, name, team, active, humanTeam, valuationType, primaryType,
 *     storedValue, frozenValue, unfrozenValue, targetValue }
 *   - storedValue   : `riders.base_value` som den står nu
 *   - frozenValue   : genberegning med den FROSNE type (kontrol af beregningsstien)
 *   - unfrozenValue : genberegning med `primary_type` — det dagens rettelse giver
 *   - targetValue   : V5a-målet (den kommende permanente model); null ⇒ ingen loft-test
 * @param {{minGainPct?:number, maxOvershootPct?:number}} [opts]
 * @returns {{ include: boolean, reason?: string, gainPct?: number, overshootPct?: number }}
 */
export function evaluateCandidate(c, opts = {}) {
  const { minGainPct, maxOvershootPct } = { ...SELECTION_DEFAULTS, ...opts };
  if (!c || c.found === false) return { include: false, reason: SKIP_REASONS.NOT_FOUND };
  if (c.active === false) return { include: false, reason: SKIP_REASONS.RETIRED };
  if (c.humanTeam !== true) return { include: false, reason: SKIP_REASONS.NOT_HUMAN_TEAM };
  if (!c.primaryType || c.valuationType === c.primaryType) {
    return { include: false, reason: SKIP_REASONS.NO_MISMATCH };
  }
  if (c.hasAbilities === false) return { include: false, reason: SKIP_REASONS.NO_ABILITIES };
  if (!Number.isFinite(c.unfrozenValue) || c.unfrozenValue <= 0) {
    return { include: false, reason: SKIP_REASONS.NO_VALUE };
  }
  // Sammenligningsgrundlaget er den GEMTE værdi — det er den spilleren ser, og
  // den rettelsen faktisk flytter. `frozenValue` bruges kun til kontrol.
  if (!Number.isFinite(c.storedValue) || c.storedValue <= 0) {
    return { include: false, reason: SKIP_REASONS.NO_STORED_VALUE };
  }
  const gainPct = (c.unfrozenValue / c.storedValue - 1) * 100;
  if (!(gainPct > minGainPct + EPS)) return { include: false, reason: SKIP_REASONS.NOT_A_GAIN, gainPct };
  if (Number.isFinite(c.targetValue) && c.targetValue > 0) {
    const overshootPct = (c.unfrozenValue / c.targetValue - 1) * 100;
    if (overshootPct > maxOvershootPct + EPS) {
      return { include: false, reason: SKIP_REASONS.OVERSHOOT, gainPct, overshootPct };
    }
    return { include: true, gainPct, overshootPct };
  }
  return { include: true, gainPct, overshootPct: null };
}

/**
 * Kør vurderingen over en hel liste og del den i med/uden.
 * @returns {{ selected: object[], skipped: object[], byReason: Record<string, number> }}
 */
export function selectCandidates(candidates, opts = {}) {
  const selected = [];
  const skipped = [];
  const byReason = {};
  for (const c of candidates || []) {
    const verdict = evaluateCandidate(c, opts);
    if (verdict.include) selected.push({ ...c, ...verdict });
    else {
      skipped.push({ ...c, ...verdict });
      byReason[verdict.reason] = (byReason[verdict.reason] || 0) + 1;
    }
  }
  return { selected, skipped, byReason };
}

/** Σ før/efter + antal hold for en udvalgt liste. */
export function summarizeSelection(selected) {
  const sumBefore = selected.reduce((s, x) => s + (Number(x.storedValue) || 0), 0);
  const sumAfter = selected.reduce((s, x) => s + (Number(x.unfrozenValue) || 0), 0);
  return {
    riders: selected.length,
    teams: new Set(selected.map((x) => x.teamId).filter(Boolean)).size,
    sum_before: sumBefore,
    sum_after: sumAfter,
    sum_diff: sumAfter - sumBefore,
    sum_pct: sumBefore ? (sumAfter / sumBefore - 1) * 100 : null,
  };
}
