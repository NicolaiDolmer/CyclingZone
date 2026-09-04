export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampSatisfaction(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function roundNumber(value) {
  return Math.round(value * 1000) / 1000;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function averageNumbers(values = []) {
  const safeValues = (values || []).filter((value) => Number.isFinite(value));
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

export function averageTopScores(items = [], scorer) {
  const scores = (items || [])
    .map((item) => scorer(item))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
    .slice(0, Math.min(5, items.length));

  if (!scores.length) return 0;

  return roundNumber(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

export function clampToStep(value, min, step, max) {
  const steppedValue = Math.round(value / step) * step;
  return clamp(steppedValue, min, max);
}

export function scoreHigherBetter(actual, target) {
  if (actual == null) return 0.6;

  const safeTarget = target > 0 ? target : 1;
  if (target <= 0) return actual <= 0 ? 1.05 : 1.15;

  const ratio = actual / safeTarget;
  if (ratio >= 1) {
    return clamp(1 + Math.min(0.15, (ratio - 1) * 0.25), 0, 1.15);
  }

  return clamp(Math.pow(Math.max(ratio, 0), 0.70), 0, 1.0);
}

export function scoreLowerBetter(actual, target) {
  if (actual == null) return 0.6;

  const safeTarget = Math.max(target || 1, 1);
  if (actual <= safeTarget) {
    const margin = (safeTarget - actual) / safeTarget;
    return clamp(1 + Math.min(0.15, margin * 0.20), 0, 1.15);
  }

  const miss = actual - safeTarget;
  const tolerance = Math.max(4, safeTarget);
  return clamp(1 - (miss / tolerance), 0, 1.0);
}

// #1237 · Ejer-beslutning 4/9 (Discord 10/6 + spiller-bekræftelse 29/6): bestyrelsens
// økonomi-mål scorer nu på NETTOSTILLING (balance minus aktiv gæld) med en buffer mod
// sæsonens lønudgift — ikke på antal lån isoleret. Symptomet var konkret: 27 hold m.
// lån, 5 med positiv netto fik "bekymret" bestyrelse; hold m. 14k på kontoen og 0 lån
// fik topscore selvom bufferen mod lønnen var forsvindende.
//
// Buffer-reference: `wageBillPerSeason` = sum(riders.salary) for holdet, fyldt af
// kalderen fra data der allerede hentes (samme formel som economyEngine.js'
// buildSeasonEndPreviewRows' `totalSalary`-beregning, ~economyEngine.js:1622) — ikke
// en fast GAME_INVARIANTS-konstant, fordi lønsummen er hold-specifik (rytterantal ×
// individuelle frosne lønninger, #1309) og en flad konstant enten ville straffe små
// hold hårdt eller være meningsløs slap for store. Score ≈ 1.0 når nettostilling ≥ én
// sæsons lønudgift (fuld buffer); glider mod ~0.15 når nettostillingen er markant
// negativ. Lån trækker kun lidt (−0.05 pr. aktivt lån, cap −0.15) OG kan aldrig alene
// sende en manager med stærk nettostilling (score ≥0.8 FØR lån-fradrag) under 0.8.
//
// Ren funktion — ingen I/O, ingen Supabase-kald. Kalderen slår balance/aktiv gæld/
// aktive lån/lønsum op og sender dem ind.
export function scoreFinanceHealthGoal({
  balance = 0,
  activeDebt = 0,
  activeLoanCount = 0,
  wageBillPerSeason = 0,
  isFinalSeason = false,
} = {}) {
  const net = (balance || 0) - (activeDebt || 0);
  // Buffer-gulv på 1 for at undgå division mod (næsten-)0-lønsummer (fx et hold uden
  // ryttere) — coverageRatio ville ellers eksplodere til 1.0 på en triviel saldo.
  const buffer = Math.max(wageBillPerSeason || 0, 1);

  let base;
  if (net <= 0) {
    // Negativ nettostilling: glid fra 0.35 (lige under vandet) mod 0.15 (dybt
    // negativ, relativt til holdets egen lønsum så bedømmelsen skalerer med
    // holdstørrelse, ikke et absolut kronebeløb).
    const deficitRatio = clamp(Math.abs(net) / buffer, 0, 2);
    base = clamp(0.35 - deficitRatio * 0.10, 0.15, 0.35);
  } else {
    // Positiv nettostilling: glid fra 0.35 (lige over vandet) mod 1.0 når
    // nettostillingen dækker en fuld sæsons lønudgift.
    const coverageRatio = clamp(net / buffer, 0, 1);
    base = 0.35 + coverageRatio * 0.65;
  }

  const loanPenalty = Math.min(0.05 * Math.max(0, activeLoanCount || 0), 0.15);
  let score = base - loanPenalty;

  // Garanti: lån alene må aldrig sende en manager under 0.8, hvis nettostillingen
  // FØR lån-fradraget allerede var god nok til at fortjene 0.8+.
  if (base >= 0.8) score = Math.max(score, 0.8);

  score = clamp(score, 0.15, 1.0);

  // Bevarer den gamle 1.05-topscore ved sæsonslut for det tidligere "perfekte"
  // tilfælde: fuld buffer dækket OG ingen aktive lån.
  if (isFinalSeason && net >= buffer && (activeLoanCount || 0) === 0) score = 1.05;

  return roundNumber(score);
}

// #1237 · Netto-hjælpere delt af alle score-kaldere (boardGoals.js) og de mange
// context-byggere der fodrer buildBoardEvalContext (boardRoom.js, api.js,
// boardWeekendFinalization.js, economyEngine.js) — ét sted for formlen, så
// "sum af aktiv gæld" og "sæsonens lønsum" ikke reimplementeres per kaldested.
export function sumActiveLoanDebt(loans = []) {
  return (loans || []).reduce((sum, loan) => sum + (loan?.amount_remaining || 0), 0);
}

export function sumRiderSalaries(riders = []) {
  return (riders || []).reduce((sum, rider) => sum + (rider?.salary || 0), 0);
}
