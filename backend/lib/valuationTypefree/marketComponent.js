// #5497 R4 — markedskomponent: fælles + lokal, med misbrugsfilter (DEV-ONLY).
//
// Låst (#5497): marked fra første aktivering med stigende vægt; fælles
// markedsestimat + lokale forskelle efter evidens; simulationsforankret
// krone-niveau i starten — markedet flytter RELATIVE priser, ikke det samlede
// niveau. Ingen procenter uden ejer-valg.
//
// Opbygning pr. handel i:
//   r_i = ln(betalt pris_i) − ln(grundværdi_i)      (grundværdi fra typefri model,
//                                                     evner fra historik FØR handlen)
//
//   fælles(x) = γ1·(O − Ō) + γ2·(alder − ā) + γ3·(alder − ā)²
//               — ridge-fit; skæringen γ0 (markedets samlede niveau vs. modellen)
//                 RAPPORTERES men anvendes ikke (krone-niveauet er låst til
//                 simulationen; #3449-niveau-korrektionen er det eksisterende
//                 værktøj til niveauet)
//   lokal(x)  = Σ_i K(x, x_i)·(r_i − fælles(x_i)) / (Σ_i K(x, x_i) + k0)
//               — Gauss-kerne på (evne-profil, alder); k0 krymper mod 0 hvor
//                 der er få handler. Glat i x, så ét evnepoint giver ingen hop.
//   evidens(x) = Σ_i K(x, x_i) / (Σ_i K(x, x_i) + k0)  ∈ [0,1)
//               — typefri afløser for computeSupport (ingen same-type-match)
//
//   markedsværdi = grundværdi · exp( clamp( w · (fælles(x) + lokal(x)), ±L ) )
//
// w (markedsvægt) og L (loft på markedets påvirkning pr. rytter) er ejer-valg.
//
// Misbrugsfilter (kvalifikation) — genbruger de eksisterende, kalibrerede
// detektorer i stedet for at opfinde nye tærskler:
//   1. #3750/V2: auktion kræver ≥2 forskellige menneske-budgivere og hævet pris;
//      forhandlet handel kun menneske↔menneske; ingen garanteret salg.
//   2. V2: par med ≥ maxPairTrades handler i vinduet udelukkes helt.
//   3. #3818: computeDirectionalStrength > 0 på et holdpar → parret udelukkes.
//   4. #3438/#3231: computePriceOutlierStrength(pris / niveaujusteret
//      grundværdi) > 0 → handlen udelukkes (uden for det kalibrerede ærlig-
//      pris-bånd). Niveaujusteret = grundværdi · exp(median r), så et
//      niveau-skel mellem model og marked ikke i sig selv smider handler ud.

import {
  FAIRPLAY_DEFAULTS,
  computeDirectionalStrength,
  computePriceOutlierStrength,
} from "../fairplayScoring.js";

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const median = (xs) => {
  const a = [...xs].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2;
};

// obs: { id, kind: 'auction'|'transfer', at, price, seller|null, buyer,
//        distinctEligibleBidders?, startingPrice?, guaranteed?, base (grundværdi) }
// humanTeams: Set af menneskehold-id'er.
export function qualifyMarketEvidence(obs, { humanTeams, maxPairTrades = 3, config = FAIRPLAY_DEFAULTS } = {}) {
  const funnel = {
    raw: obs.length,
    dropped_missing_base: 0,
    dropped_guaranteed_sale: 0,
    dropped_auction_no_competition: 0,
    dropped_transfer_not_human_to_human: 0,
    dropped_repeat_pair: 0,
    dropped_directional_pair: 0,
    dropped_price_outlier: 0,
  };
  const isHuman = (t) => (humanTeams ? humanTeams.has(t) : Boolean(t));
  const stage1 = [];
  for (const o of obs) {
    if (!(Number(o.base) > 0) || !(Number(o.price) > 0)) { funnel.dropped_missing_base++; continue; }
    if (o.guaranteed) { funnel.dropped_guaranteed_sale++; continue; }
    if (o.kind === "auction") {
      if (!(Number(o.distinctEligibleBidders) >= 2)) { funnel.dropped_auction_no_competition++; continue; }
    } else if (!isHuman(o.seller) || !isHuman(o.buyer)) {
      funnel.dropped_transfer_not_human_to_human++; continue;
    }
    stage1.push(o);
  }

  // Par-grafen: kun handler hvor begge sider er menneskehold.
  const pairs = new Map();
  const counterparties = new Map();
  for (const o of stage1) {
    if (!isHuman(o.seller) || !isHuman(o.buyer) || o.seller === o.buyer) continue;
    const key = pairKey(o.seller, o.buyer);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(o);
    for (const [a, b] of [[o.seller, o.buyer], [o.buyer, o.seller]]) {
      if (!counterparties.has(a)) counterparties.set(a, new Set());
      counterparties.get(a).add(b);
    }
  }
  const repeatPairs = new Set();
  const directionalPairs = new Set();
  for (const [key, list] of pairs) {
    if (list.length >= maxPairTrades) repeatPairs.add(key);
    const [lo, hi] = key.split("|");
    const strength = computeDirectionalStrength({
      transactions: list.map((o) => ({ at: o.at, towardHi: o.buyer === hi })),
      counterpartiesLo: counterparties.get(lo)?.size ?? null,
      counterpartiesHi: counterparties.get(hi)?.size ?? null,
    }, config);
    if (strength > 0) directionalPairs.add(key);
  }

  const stage2 = [];
  for (const o of stage1) {
    const key = isHuman(o.seller) && isHuman(o.buyer) && o.seller !== o.buyer ? pairKey(o.seller, o.buyer) : null;
    if (key && repeatPairs.has(key)) { funnel.dropped_repeat_pair++; continue; }
    if (key && directionalPairs.has(key)) { funnel.dropped_directional_pair++; continue; }
    stage2.push(o);
  }

  const levelShift = median(stage2.map((o) => Math.log(o.price / o.base))) ?? 0;
  const qualified = [];
  for (const o of stage2) {
    const ratio = o.price / (o.base * Math.exp(levelShift));
    if (computePriceOutlierStrength(ratio, config) > 0) { funnel.dropped_price_outlier++; continue; }
    qualified.push(o);
  }
  funnel.qualified = qualified.length;
  funnel.repeat_pairs = repeatPairs.size;
  funnel.directional_pairs = directionalPairs.size;
  return { qualified, funnel, levelShift };
}

// ── Fælles komponent: ridge på (O, alder, alder²) ────────────────────────────
function solve(M) {
  const n = M.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    [M[i], M[p]] = [M[p], M[i]];
    const v = M[i][i];
    if (Math.abs(v) < 1e-12) throw new Error("singular system");
    for (let j = i; j <= n; j++) M[i][j] /= v;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((r) => r[n]);
}

// rows: { O, age, r }. Returnerer { gamma0, gamma, center, predict(x) } hvor
// predict udelader gamma0 (niveauet er låst).
export function fitCommon(rows, { lambda = 1 } = {}) {
  const n = rows.length;
  if (n < 5) return { gamma0: 0, gamma: [0, 0, 0], center: { O: 0, age: 0 }, predict: () => 0, n };
  const oBar = rows.reduce((s, r) => s + r.O, 0) / n;
  const aBar = rows.reduce((s, r) => s + r.age, 0) / n;
  const feat = (x) => [1, (x.O - oBar) / 10, (x.age - aBar) / 5, ((x.age - aBar) / 5) ** 2];
  const d = 4;
  const M = Array.from({ length: d }, () => Array(d + 1).fill(0));
  for (const r of rows) {
    const f = feat(r);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) M[i][j] += f[i] * f[j];
      M[i][d] += f[i] * r.r;
    }
  }
  for (let j = 1; j < d; j++) M[j][j] += lambda;
  const beta = solve(M);
  const predict = (x) => {
    const f = feat(x);
    return beta[1] * f[1] + beta[2] * f[2] + beta[3] * f[3];
  };
  return { gamma0: beta[0], gamma: beta.slice(1), center: { O: oBar, age: aBar }, predict, n };
}

// ── Lokal komponent: Gauss-kerne med krympning ───────────────────────────────
// Afstand på evne-vektoren (standardiseret pr. evne) + alder.
export function makeKernelSpace(rows, abilityKeys) {
  const sd = abilityKeys.map((k) => {
    const v = rows.map((r) => Number(r.abilities[k]));
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1;
  });
  const ageVals = rows.map((r) => r.age);
  const am = ageVals.reduce((s, x) => s + x, 0) / ageVals.length;
  const ageSd = Math.sqrt(ageVals.reduce((s, x) => s + (x - am) ** 2, 0) / ageVals.length) || 1;
  const embed = (x) => [
    ...abilityKeys.map((k, i) => Number(x.abilities[k]) / sd[i] / Math.sqrt(abilityKeys.length)),
    x.age / ageSd,
  ];
  return { embed };
}

export function fitLocal(rows, { abilityKeys, bandwidth = 0.5, k0 = 3, common } = {}) {
  const space = makeKernelSpace(rows, abilityKeys);
  const pts = rows.map((r) => ({ e: space.embed(r), res: r.r - (common ? common.predict(r) : 0) }));
  const h2 = 2 * bandwidth * bandwidth;
  const mass = (x) => {
    const e = space.embed(x);
    let wSum = 0;
    let wr = 0;
    for (const p of pts) {
      let d2 = 0;
      for (let i = 0; i < e.length; i++) d2 += (e[i] - p.e[i]) ** 2;
      const w = Math.exp(-d2 / h2);
      wSum += w;
      wr += w * p.res;
    }
    return { wSum, wr };
  };
  return {
    predict: (x) => {
      const { wSum, wr } = mass(x);
      return wr / (wSum + k0);
    },
    evidence: (x) => {
      const { wSum } = mass(x);
      return wSum / (wSum + k0);
    },
  };
}

// Markedsjusteret værdi. weight = w, cap = L (ln-enheder, fx ln(1,5)).
export function marketAdjustedValue(base, x, { common, local, weight = 0, cap = Infinity } = {}) {
  if (!(base > 0)) return base;
  const c = common ? common.predict(x) : 0;
  const l = local ? local.predict(x) : 0;
  const raw = weight * (c + l);
  const adj = Math.max(-cap, Math.min(cap, raw));
  return base * Math.exp(adj);
}
