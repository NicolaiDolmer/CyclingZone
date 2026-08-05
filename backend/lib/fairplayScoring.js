// #3138 (fair-play epic #3131) — scoring-kernen: kombinerer detektorernes
// signaler (#3135 identitet, #3136 værdibånd, #3137 livscyklus) til ÉN vægtet
// score pr. mistænkt hændelse, i stedet for uafhængige boolske flag der hver
// især larmer (scanningen 30/7: værdi-reglen alene = 7 uskyldige flag,
// identitets-reglen alene = 5 uskyldige flag; kombinationen = 1 ægte sag,
// 0 falske).
//
// Bindende designregel (ejer 30/7, #3131): forbundet identitet ∧ ensidig
// værdioverførsel → flag. HVER DEL ALENE ER STØJ. Det er implementeret
// multiplikativt: score = værdi-komponent × (identitet + prisafvigelse +
// livscyklus). Ingen værdistrøm → værdi-komponent 0 → score 0, uanset hvor
// stærkt identitetssignalet er. Delt IP alene kan derfor ALDRIG flagge.
//
// Vægtene er udledt af de kendte, dokumenterede sager (acceptkriteriet i
// #3138 — ikke en teoretisk model):
//   - #2221 (EvoPro↔Barra CC): svag email-lighed + 766k ensidig strøm +
//     ekstreme swap-ratioer (0,008×/153,8×)          → score ~1,58 (flag)
//   - #2776 (1-kr-handlerne): first_seen_at-arv 61 s + 1,97 mio. strøm +
//     1-kr-priser + lån→værditab                      → score ~2,4  (flag)
//   - De 5 kendte lovlige par fra #3135-auditten      → score 0,00–0,22
//     (alle UNDER tærsklen 0,35 — 4 af dem har slet ingen værdistrøm)
// Kalibreringen er fastfrosset som fixtures i fairplayScoring.test.js — en
// vægt-ændring der knækker en kendt sag knækker testen.
//
// Ren funktionel kerne: ingen I/O, ingen supabase — dataindsamlingen bor i
// fairplayFlagsCron.js, så denne fil kan unit-testes udtømmende.

export const FAIRPLAY_DEFAULTS = {
  // Værdistrøm under dette = ingen flag (beskytter husstande der handler småt;
  // TR↔LEGO-Vestas' ene 10.539-handel er langt under). Lånt niveau fra #3135's
  // 100k-konvention, halveret fordi scoren SKALERER med strømmen i stedet for
  // at være binær — små strømme får lav score selv over gulvet.
  valueFlowMin: 50_000,
  // Strøm der giver fuld værdi-komponent (1,0). 250k ≈ en hel starterkapital
  // halvvejs — #2221 (766k) og #2776 (1,97 mio.) mætter begge.
  valueFlowSaturation: 250_000,
  // Flag-tærskel — ejerstyret i app_config ('fairplay_flag_threshold'),
  // dette er kun fallback hvis nøglen mangler.
  flagThreshold: 0.35,
  // Kalibreret ærlig-pris-bånd fra #3231 (P05/P95, ~10% FP): uden for dette
  // regnes en handel som prisafvigende.
  priceBandFloorPct: 0.10,
  priceBandCapMultiple: 2.2,
  // Livscyklus-tragten (#3137) kigger kun på handler hvor der reelt flyttede
  // et stort beløb — 100k matcher issuets egen formulering ("den eneste gang
  // ... en konto har betalt over 100.000 til et menneskehold inden 2 timer").
  funnelMinAmount: 100_000,
};

// Identitets-signaler (#3135-auditten ejer hierarkiet):
//   first_seen_at-arv løste #2776 → stærkest. IP-eksakt (fan-out≤2) er stærk
//   men CGNAT-plaget. Email/brugernavn-lighed fangede #2221 men er svag.
// Summen cappes på 1,0 — flere svage signaler sammen ≈ ét stærkt.
export const IDENTITY_WEIGHTS = {
  first_seen_at_match: 0.9,
  ip_exact_low_fanout: 0.7,
  ip_prefix_low_fanout: 0.5,
  signup_proximity: 0.5,
  email_username_similarity: 0.4,
};

// Livscyklus-signaler (#3137). Signal 2 (levetid-efter, empirisk max 0,401 i
// hele vinduet) og signal 4 (konto-oprettet-under-auktion, 157/168 falske
// positiver pga. spillets bevidste hurtig-onboarding) er BEVIDST udeladt af
// v1 — auditten dokumenterer selv at signal 4 aldrig må stå alene, og begge
// sager fanges allerede uden dem. Kan tilføjes som korroboration i v1.1.
export const LIFECYCLE_WEIGHTS = {
  loan_then_value_loss: 0.7, // #2776-mekanikken direkte (signal 3)
  account_age_at_tx: 0.5, // signal 1
  low_activity_profile: 0.5, // signal 6
  disposable_email: 0.35, // signal 5 — bevidst lavt (folk bruger temp-mail lovligt)
};

export const PRICE_OUTLIER_WEIGHT = 0.8;

const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ── Komponenter ──────────────────────────────────────────────────────────────

// Værdi-komponenten er GATEN: under valueFlowMin → 0 (identitet alene må
// aldrig flagge), derover lineær op til mætning.
export function computeValueComponent(netFlowAbs, config = FAIRPLAY_DEFAULTS) {
  if (!Number.isFinite(netFlowAbs) || netFlowAbs < config.valueFlowMin) return 0;
  return clamp01(netFlowAbs / config.valueFlowSaturation);
}

// Identitets-komponent: vægtet sum af boolske signaler, cap 1,0.
// ip_exact impliserer ip_prefix — tæl aldrig begge (dobbelt-tælling af samme
// underliggende observation ville puste husstands-par kunstigt op).
export function computeIdentityComponent(signals = {}, weights = IDENTITY_WEIGHTS) {
  let sum = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (name === "ip_prefix_low_fanout" && signals.ip_exact_low_fanout) continue;
    if (signals[name]) sum += weight;
  }
  return clamp01(sum);
}

// Prisafvigelses-styrke for én handel: 0 inde i det kalibrerede bånd; skalerer
// med hvor ekstrem afvigelsen er. 1-kr-handlerne (#2776, ratio ~0,0000006) og
// 15-16× (#2221) mætter begge til ~1,0; en handel til 0,09× får kun 0,1.
export function computePriceOutlierStrength(ratio, config = FAIRPLAY_DEFAULTS) {
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  const { priceBandFloorPct: floor, priceBandCapMultiple: cap } = config;
  if (ratio < floor) return clamp01((floor - ratio) / floor);
  if (ratio > cap) return clamp01((ratio - cap) / (cap * 2));
  return 0;
}

// Kontoalder ved transaktionen (signal 1): lineært fald over 48 timer.
// gwshare (7 min) → ~1,0; Atom Bikers (7,5 t) → ~0,84 (matcher auditens 0,831).
export function computeAccountAgeStrength(ageHours) {
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours >= 48) return 0;
  return round3(1 - ageHours / 48);
}

// Aktivitetsprofil (signal 6, forenklet JS-port af SQL-formlens level/xp/
// streak-ben; race-historik-benet er udeladt i v1 — kræver historisk join som
// cron'en ikke laver endnu; niveau/xp=0 bærer gwshare-casen alene).
export function computeActivityStrength({ level, xp, loginStreak } = {}) {
  const levelScore = level == null || level <= 1 ? 1 : level <= 3 ? 0.5 : 0;
  const xpScore = !xp ? 1 : xp < 100 ? 0.5 : 0;
  const streakScore = loginStreak == null || loginStreak <= 1 ? 1 : loginStreak <= 3 ? 0.5 : 0;
  return round3(0.4 * levelScore + 0.3 * xpScore + 0.3 * streakScore);
}

// Lån→værditab (signal 3, #2776-mekanikken): salg under 25% af market_value
// inden 7 dage efter et lån. 0,25/7d er signal-filens egne konventioner.
export function computeLoanFunnelStrength({ ratio, gapDays } = {}) {
  if (!Number.isFinite(ratio) || !Number.isFinite(gapDays)) return 0;
  if (ratio >= 0.25 || gapDays > 7 || gapDays < 0) return 0;
  return round3(0.6 * (1 - ratio / 0.25) + 0.4 * clamp01(1 - gapDays / 7));
}

// Livscyklus-komponent: vægtet sum over signalliste [{name, strength}], cap 1,0.
export function computeLifecycleComponent(signalList = [], weights = LIFECYCLE_WEIGHTS) {
  let sum = 0;
  for (const s of signalList) {
    const weight = weights[s.name];
    if (!weight || !Number.isFinite(s.strength)) continue;
    sum += weight * clamp01(s.strength);
  }
  return clamp01(sum);
}

// ── Samlet scoring pr. hændelses-type ───────────────────────────────────────

function buildSignalBreakdown({ identitySignals, priceOutlierStrengths, lifecycleSignals, config }) {
  const breakdown = [];
  for (const [name, weight] of Object.entries(IDENTITY_WEIGHTS)) {
    if (name === "ip_prefix_low_fanout" && identitySignals?.ip_exact_low_fanout) continue;
    if (identitySignals?.[name]) breakdown.push({ name, strength: 1, weight, contribution: weight });
  }
  const maxOutlier = Math.max(0, ...(priceOutlierStrengths ?? []));
  if (maxOutlier > 0) {
    breakdown.push({
      name: "price_band_outlier",
      strength: round3(maxOutlier),
      weight: PRICE_OUTLIER_WEIGHT,
      contribution: round3(maxOutlier * PRICE_OUTLIER_WEIGHT),
    });
  }
  for (const s of lifecycleSignals ?? []) {
    const weight = LIFECYCLE_WEIGHTS[s.name];
    if (!weight || !(s.strength > 0)) continue;
    breakdown.push({
      name: s.name,
      strength: round3(clamp01(s.strength)),
      weight,
      contribution: round3(weight * clamp01(s.strength)),
    });
  }
  void config;
  return breakdown;
}

// Par-hændelse (#3135-reglen, generaliseret): forbundet identitet og/eller
// prisafvigelse og/eller livscyklus-anomali, GATET af ensidig netto-værdistrøm.
export function scorePairIncident(
  { netFlowAbs, identitySignals = {}, priceOutlierStrengths = [], lifecycleSignals = [] },
  config = FAIRPLAY_DEFAULTS
) {
  const value = computeValueComponent(netFlowAbs, config);
  const identity = computeIdentityComponent(identitySignals);
  const priceOutlier = round3(Math.max(0, ...priceOutlierStrengths, 0) * PRICE_OUTLIER_WEIGHT);
  const lifecycle = computeLifecycleComponent(lifecycleSignals);
  const score = round3(value * (identity + priceOutlier + lifecycle));
  return {
    score,
    components: { value: round3(value), identity: round3(identity), priceOutlier, lifecycle: round3(lifecycle) },
    signals: buildSignalBreakdown({ identitySignals, priceOutlierStrengths, lifecycleSignals, config }),
  };
}

// Livscyklus-tragt (#3137): prisen kan være HELT fair — gaten er her det
// flyttede BELØB (ikke netto-værdioverskud), og der kræves MINDST 2 forskellige
// livscyklus-signaler (auditens egen lektie: hvert signal alene er støj i et
// spil designet til hurtig onboarding).
export function scoreFunnelIncident(
  { amount, identitySignals = {}, lifecycleSignals = [] },
  config = FAIRPLAY_DEFAULTS
) {
  const firing = (lifecycleSignals ?? []).filter((s) => LIFECYCLE_WEIGHTS[s.name] && s.strength > 0);
  const distinct = new Set(firing.map((s) => s.name));
  const zero = {
    score: 0,
    components: { value: 0, identity: 0, priceOutlier: 0, lifecycle: 0 },
    signals: [],
  };
  if (!Number.isFinite(amount) || amount < config.funnelMinAmount) return zero;
  if (distinct.size < 2) return zero;

  const value = clamp01(amount / config.valueFlowSaturation);
  const identity = computeIdentityComponent(identitySignals);
  const lifecycle = computeLifecycleComponent(firing);
  const score = round3(value * (identity + lifecycle));
  return {
    score,
    components: { value: round3(value), identity: round3(identity), priceOutlier: 0, lifecycle: round3(lifecycle) },
    signals: buildSignalBreakdown({ identitySignals, priceOutlierStrengths: [], lifecycleSignals: firing, config }),
  };
}
