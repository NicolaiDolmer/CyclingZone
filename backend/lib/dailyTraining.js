// Dagligt trænings-tick (#1305) — ren matematik, ingen DB.
// Genbruger L0'ens budget (growthFractionByAge) delt i daglige bidder med compounding:
// dag-rate = residual-gap × f(age)/daysPerSeason. Over en sæson ≈ gap×e^(−f) ~ L0's gap×(1−f).
// dailyBudgetBoost kalibreres i scripts/previewDailyTraining.js så peak rammer 27-28 (spec 5.2).
import { PROGRESSION_CONFIG, seededUnit, youthRateForPotential, roleRateFactor, ROLE_CLASS_RATE } from "./riderProgression.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES, focusAbilityWeight, smartDefaultFocus } from "./training.js";
import { dayTypeForProgram, RECOVERY_INTENSITY } from "./trainingDayTypes.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { youthMultiplier } from "./academyFlag.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "./staffTrainingBonus.js";

export const DAILY_TRAINING_CONFIG = Object.freeze({
  daysPerSeason: 28,        // budget-konvertering; kalibreres i sim (Task A10)
  dailyBudgetBoost: 1.0,    // kompenserer compounding-tabet; kalibreres i sim
  bonusMult: 1.25,          // aktivt manager-klik (spec 6.3)
  noiseSpan: 0.15,          // ±15 % dagsform-støj, seeded pr. (rytter, dato)
  intensities: Object.freeze(["rest", "recovery", "easy", "normal", "hard"]),
  // Trætheds-belastning pr. intensitet (bruges af riderCondition.js, Task A5).
  // `recovery` (#3762) ligger MELLEM hvile og let: en aktiv restitutionsdag
  // trækker træthed ned, men langsommere end at holde helt fri. Det er den
  // eneste dagstype der både sænker træthed og giver vækst, og prisen for det
  // er at den sænker mindre end hvile.
  fatigueLoad: Object.freeze({ rest: -14, recovery: -8, easy: 4, normal: 9, hard: 16 }),
});

export const DEFAULT_PROGRAM = Object.freeze({ focus: "endurance", intensity: "normal" });

// #3459 D2 — race-profil → udviklings-relevante evner. Flyttet HERTIL fra
// backend/scripts/loebsdagsModelSimulation.js (var lokal duplikat i sim'en) så sim
// og produktionsmotor deler ÉN sandhed (ejer-mandat i spec'en, D2-afsnittet).
// Dokumenteret forslag (afledt af raceFatigue.js's 9 profiltyper + eksisterende
// TRAINING_FOCUSES-grupperinger, så mapningen "føles" som den trænings-fokus
// løbstypen mest ligner) — se sim-scriptets historik for den fulde begrundelse
// pr. profiltype.
export const RACE_PROFILE_ABILITY_MAP = Object.freeze({
  flat: ["flat", "sprint", "acceleration"],
  rolling: ["punch", "tempo", "endurance"],
  hilly: ["climbing", "punch", "tempo"],
  classic: ["punch", "durability", "positioning"],
  cobbles: ["cobblestone", "durability", "flat"],
  mountain: ["climbing", "endurance", "durability"],
  high_mountain: ["climbing", "endurance", "recovery", "durability"],
  itt: ["time_trial", "tempo"],
  ttt: ["time_trial", "tactics", "positioning"],
});

// #3459 D2 — devMult-bånd (ejer-valgt 6/8): racing udvikler ~10-20% MERE end det
// pas det erstatter, kun i løbets relevante evner. Sim-valideret (G4) midtpunkt
// 1.15 — behold medmindre målinger mod ægte population siger andet (se PR-body
// G4-scorecard).
export const RACE_DEV_CONFIG = Object.freeze({ devMult: 1.15, devMultLo: 1.10, devMultHi: 1.20 });

// #1894: ryttere uden aktiv plan trænede tidligere ALTID DEFAULT_PROGRAM
// ("endurance") uanset ryttertype (44% af trup — fejludvikling for fx sprintere).
// primaryType er VALGFRI (bagudkompatibel) — udeladt/null falder tilbage til
// smartDefaultFocus(null) som giver "endurance" (samme adfærd som DEFAULT_PROGRAM.focus).
export function resolveProgram(plan, primaryType) {
  // "rest" er gyldig daglig intensitet, men indgår bevidst IKKE i training.js' sæson-validator
  // (sæson-stien kender kun easy/normal/hard; A7 håndterer API-validering).
  if (!plan || !plan.focus || !plan.intensity) {
    return { focus: smartDefaultFocus(primaryType), intensity: DEFAULT_PROGRAM.intensity };
  }
  return { focus: plan.focus, intensity: plan.intensity };
}

// Returnér vækst-fraktionen for en given alder fra L0's growthFractionByAge-tabel
// (array af { maxAge, frac } sorteret stigende på maxAge).
export function growthFractionForAge(age) {
  const table = PROGRESSION_CONFIG.growthFractionByAge;
  for (const row of table) {
    if (age <= row.maxAge) return row.frac;
  }
  return table[table.length - 1].frac;
}

// Multiplikator pr. evne: fokus-evner får intensitetens focusGrowthMult, resten offFocusMult.
// "rest" → 0 (ingen progress på hviledage).
//
// #3709 trin 4: `cfg` er VALGFRI og defaulter til den frosne TRAINING_CONFIG, så
// enhver eksisterende caller er bit-identisk. Den findes fordi spec §4.4 kræver en
// NEGATIV-TEST: kandidaten kørt med `offFocusMult` uændret på 0,97 SKAL fejle
// gaten, og uden en injicerbar config kunne den test kun køres ved at redigere en
// frossen konstant. En gate man ikke kan køre er ikke en gate.
export function abilityMult(ability, program, cfg = TRAINING_CONFIG) {
  if (program.intensity === "rest") return 0;
  const focusAbilities = TRAINING_FOCUSES[program.focus] ?? [];
  const inFocus = focusAbilities.includes(ability);
  // #3762 aktiv restitution: KUN sessionens egen evne rører sig. Uden denne gren
  // ville off-fokus-multiplikatoren give hele resten af kroppen en smule vækst
  // på en dag der er defineret ved at kroppen hviler.
  if (program.intensity === RECOVERY_INTENSITY) {
    return inFocus ? (cfg.focusGrowthMult[RECOVERY_INTENSITY] ?? 0) : 0;
  }
  // #4631: vægten pr. (fokus, evne) ganges KUN på fokus-evner. Den er 1,0 for
  // alle fokus der ikke står i FOCUS_ABILITY_WEIGHT, så enhver eksisterende plan
  // er bit-identisk. Off-fokus-evner rører den ikke: en session må ikke kunne
  // ændre hvad den IKKE træner.
  return inFocus
    ? (cfg.focusGrowthMult[program.intensity] ?? 1) * focusAbilityWeight(program.focus, ability)
    : cfg.offFocusMult;
}

// #2216 A4 (Task 7): staff/facilityTier/riderLevel er VALGFRIE med sikre defaults
// (staff=null → staffTrainingBonus=1.0). Eksisterende callers, der ikke sender dem,
// får et staffBonus på præcis 1.0 → bit-identisk output (nul regression, bevist i test).
// #2437: academyRateMult er en MIDLERTIDIG interim-knap — akademi-raten kollapsede
// ~9x efter #2202 (sæson-loft sendt som caps i stedet for livstids-loftet, se issue).
// VALGFRI med sikker default 1.0 (bit-identisk, samme kontrakt som staff-parametrene
// ovenfor); dailyTrainingEngine.js sender den IKKE endnu — rør ingen prod-adfærd før
// ejeren har godkendt en model ud fra careerCurveSimulation.js.
// #3709 trin 4: `primaryType`/`secondaryType` er VALGFRIE med samme
// "udeladt = 1.0 = bit-identisk"-kontrakt som staff/facility/academy ovenfor.
// Udelades de, får evnen rolle-rate 1.0 — altså den gap-proportionale model fra
// før trin 4. Det er BEVIDST: harnesses og fixtures der måler noget andet end
// rolleklasser skal kunne køre uden at kende rytterens anlæg, og produktionens
// sti (dailyTrainingEngine.js) sender dem altid.
export function dailyAbilityDelta({
  ability, current, cap, age, program, conditionMult, bonus, noise, potentiale,
  staff = null, facilityTier = null, riderLevel = null, academyRateMult = 1.0,
  primaryType = null, secondaryType = null, trainingCfg = TRAINING_CONFIG,
}) {
  const gap = Math.max(0, (cap ?? current) - current);
  if (gap === 0) return 0;
  const mult = abilityMult(ability, program, trainingCfg);
  if (mult === 0) return 0;
  const cfg = DAILY_TRAINING_CONFIG;
  const base = (gap * growthFractionForAge(age) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  // ── DEN ANDEN KNAP (#3709 trin 4, spec §2.2) ──────────────────────────────
  // Indtil nu satte loftet både hvor højt en evne kunne komme OG hvor hurtigt,
  // fordi `base` er gap-proportional. Rolle-raten er den knap der skiller de to
  // ad: en signatur-evne lukker sit gap 9x hurtigere end en svaghed (0,45 mod
  // 0,05), uden at nogen af dem har fået et andet loft af den grund.
  // Udeladt type ⇒ 1.0 ⇒ præcis den gamle model (se docblokken ovenfor).
  const baseRoleRate = primaryType == null
    ? 1
    : roleRateFactor(primaryType, secondaryType, ability);
  // ── PRISEN FOR EN FÆRDIGHEDSDAG (#3762, ejer-besluttet 14/8) ──────────────
  // En færdighedsdag træner ALTID til håndværks-raten, også når evnen er
  // rytterens signatur. Uden loftet er en lavbelastnings-færdighedsdag strengt
  // bedre end en hård dag for de to roller hvor færdigheds-evner bærer
  // halvdelen af ratingen: målt på en ægte baroudeur (aggression 4 af 12 i hans
  // opskrift, og hans egen signatur-evne) gav en løbslære-dag 211 ratingpoint
  // pr. dag mod 192 for hans bedste lange tur og 147 for intervaller. Med
  // loftet falder den til 145, og den lange tur er hans bedste dag igen.
  // Færdighedsdagen bliver dermed et VALG, ikke et genvejstræk.
  const roleRate = dayTypeForProgram(program) === "skill"
    ? Math.min(baseRoleRate, ROLE_CLASS_RATE.haandvaerk)
    : baseRoleRate;
  // Staff-trænings-bonus (dimension×niveau): ét ekstra multiplikator-led SIDST i kæden,
  // efter manager-klik-bonussen (cfg.bonusMult) og noise. ≥ 1.0 og = 1.0 uden staff, så
  // rækkefølgen er ligegyldig for regression men dokumenteres eksplicit for læsbarhed.
  // Bonussen skalerer KUN denne daglige delta — cap-loopet i dailyTrainingEngine.js klipper
  // stadig hver evne ved ability_caps, så et cap kan ALDRIG udvides af bonussen.
  const staffBonus = staffTrainingBonus({ facilityTier, staff, ability, riderLevel });
  // Plan B (#1441): facilitets-MAGNITUDE (spec §2.1) — samme effectiveBonus som Klub-UI'et
  // viser. facilityTier null/0 → PRÆCIS 1.0 (nul regression for hold uden faciliteter).
  const facilityMult = facilityTrainingMultiplier({ facilityTier, staff });
  // academyRateMult (#2437) ganges SIDST i kæden — samme "ekstra multiplikator-led,
  // default 1.0" kontrakt som staffBonus/facilityMult. Interim-knap: ingen kalder i
  // dagens prod sender den, så udeladt = uændret adfærd.
  return base * mult * roleRate * conditionMult * youthMultiplier(age) * youthRateForPotential(potentiale)
    * (bonus ? cfg.bonusMult : 1) * noise * staffBonus * facilityMult * academyRateMult;
}

// #2082/#1938 (ejer-godkendt 5/7): sæson-budget-loft for akademi-alder — det EFFEKTIVE
// loft for daglige ticks i indeværende sæson, IKKE livstids-loftet direkte. Væksten
// mætter dermed ved sæsonens andel af gappet uanset hvor mange dage sæsonen varer
// (sæsonlængde er ikke en fast konstant, jf. issue-diskussion — S1 var stadig åben
// efter 57+ dage). seasonStartAbilities er en snapshot taget ved sæsonens første tick.
export function computeAcademySeasonCeiling({ seasonStartAbilities, lifetimeCaps, frac }) {
  const ceiling = {};
  for (const ability of VISIBLE_ABILITIES) {
    const cur = seasonStartAbilities?.[ability];
    if (cur == null) continue;
    const life = lifetimeCaps?.[ability] ?? cur;
    const gap = Math.max(0, life - cur);
    ceiling[ability] = cur + gap * frac;
  }
  return ceiling;
}

// Ét dags-tick for én rytter. Muterer ikke input. Returnerer nye abilities/progress + rapportfelter.
// caps er PÅKRÆVET: manglende evne-nøgle ⇒ nul vækst for den evne (konservativt, jf. L0's lazy-caps).
// hardDailyCap (valgfri, #2082/#1938): maks antal hele point én evne må stige pr. dag —
// sikkerhedsnet mod enkelt-dags-spikes. Udeladt/null = ingen ekstra grænse (uændret adfærd).
// #2216 A4 (Task 7): staff/facilityTier/riderLevel er VALGFRIE med sikre defaults, så
// eksisterende callers (uden staff) får bit-identisk adfærd. Trænings-motoren
// (dailyTrainingEngine.js) sender dem videre til dailyAbilityDelta pr. evne.
// #2437: academyRateMult sendes bare videre til dailyAbilityDelta pr. evne — samme
// midlertidige interim-knap, samme sikre default 1.0 (se kommentar ved dailyAbilityDelta).
export function applyDailyTick({
  riderId, dateStr, age, abilities, caps, progress, program, conditionMult, bonus, potentiale, hardDailyCap,
  staff = null, facilityTier = null, riderLevel = null, academyRateMult = 1.0,
  primaryType = null, secondaryType = null, trainingCfg = TRAINING_CONFIG,
}) {
  const cfg = DAILY_TRAINING_CONFIG;
  const noise = 1 - cfg.noiseSpan + 2 * cfg.noiseSpan * seededUnit(`dtick:${riderId}:${dateStr}`);
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  let score = 0;

  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(current)) continue; // korrupt input må ikke forgifte score/progress
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age, program, conditionMult, bonus, noise, potentiale,
      staff, facilityTier, riderLevel, academyRateMult, primaryType, secondaryType, trainingCfg,
    });
    if (delta <= 0) continue;
    score += delta;
    let bar = Number(nextProgress[ability] ?? 0) + delta;
    const dailyCeiling = Number.isFinite(hardDailyCap) ? hardDailyCap : Infinity;
    while (
      bar >= 1
      && (gains[ability] ?? 0) < dailyCeiling
      && current + (gains[ability] ?? 0) < Math.min(99, caps?.[ability] ?? 99)
    ) {
      bar -= 1;
      gains[ability] = (gains[ability] ?? 0) + 1;
    }
    if (gains[ability]) nextAbilities[ability] = current + gains[ability];
    nextProgress[ability] = Math.min(bar, 0.999);
  }

  return {
    abilities: nextAbilities,
    progress: nextProgress,
    gains,
    score: Math.round(score * 100) / 100,
    noise,
    status: noise > 1.05 ? "over" : noise < 0.95 ? "under" : "normal",
  };
}

// #3459 D2 — søster-funktion til applyDailyTick ovenfor. Ren funktion, ingen DB.
// Kaldt fra dailyTrainingEngine.js's per-rytter-loop i den gren hvor D1-gaten
// (race_day_engine_enabled on + racedToday) fanger racede ryttere — GENSIDIGT
// UDELUKKENDE med applyDailyTick i samme loop (enten-eller, aldrig begge for
// samme rytter samme dag), så dobbelt-kredit er umulig by construction.
//
// Model (ejer-beslutning 6/8, docs/superpowers/specs/2026-08-06-loebsdags-model-design.md
// D2): "det erstattede pas" beregnes NØJAGTIGT som en normal træningsdag ville
// (samme program/conditionMult/staff/facility/academy/bonus-kæde, via
// dailyAbilityDelta, summeret over ALLE VISIBLE_ABILITIES — modsat sim'ens
// bevidst forenklede "gap=1"-enhedsmodel). devMult (RACE_DEV_CONFIG, 1.10-1.20,
// default 1.15) ganges på DENNE sum, og resultatet omfordeles JÆVNT over KUN
// løbsprofilens relevante evner (RACE_PROFILE_ABILITY_MAP, fallback 'rolling'
// for ukendt profil — samme fallback-semantik som raceFatigue.js's
// raceFatigueLoad). Evner allerede på cap springes over (budgettet for dén evne
// går tabt, omfordeles IKKE til de andre relevante evner — samme "hver evne
// står for sig selv"-semantik som applyDailyTick's per-ability gap-model).
//
// Returnerer SAMME kontrakt som applyDailyTick ({abilities, gains, progress,
// score, noise, status}) — skrivestien i dailyTrainingEngine.js (abilityPatch/
// gainsDetail/historyRows) er blind for kilden.
export function applyRaceDevelopmentTick({
  riderId, dateStr, age, abilities, caps, progress, program, conditionMult, bonus, potentiale, hardDailyCap,
  staff = null, facilityTier = null, riderLevel = null, academyRateMult = 1.0,
  primaryType = null, secondaryType = null,
  profileType, devMult = RACE_DEV_CONFIG.devMult,
}) {
  const cfg = DAILY_TRAINING_CONFIG;
  // Egen seed-namespace ("rtick" vs. "dtick") — samme (rider,dato)-par kan ALDRIG
  // ramme begge stier samme dag (gensidigt udelukkende), men et separat namespace
  // holder de to tick-typers noise uafhængige for læsbarhed/fremtidssikring.
  const noise = 1 - cfg.noiseSpan + 2 * cfg.noiseSpan * seededUnit(`rtick:${riderId}:${dateStr}`);
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};

  // "Det erstattede pas": sum af dailyAbilityDelta over ALLE VISIBLE_ABILITIES med
  // rytterens FAKTISKE program (resolveProgram + dagens intensitets-opløsning) —
  // samme faktor-kæde en normal træningsdag ville brugt.
  let replacedTotal = 0;
  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(abilities[ability] ?? 0);
    if (!Number.isFinite(current)) continue;
    replacedTotal += dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age, program, conditionMult, bonus, noise, potentiale,
      staff, facilityTier, riderLevel, academyRateMult, primaryType, secondaryType,
    });
  }

  const relevant = RACE_PROFILE_ABILITY_MAP[profileType] ?? RACE_PROFILE_ABILITY_MAP.rolling ?? [];
  const devTotal = replacedTotal * devMult;
  const perAbility = relevant.length > 0 ? devTotal / relevant.length : 0;
  const dailyCeiling = Number.isFinite(hardDailyCap) ? hardDailyCap : Infinity;

  let score = 0;
  for (const ability of relevant) {
    if (perAbility <= 0) continue;
    const current = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(current)) continue;
    const cap = caps?.[ability];
    if (cap != null && current >= cap) continue; // på cap — intet at vinde, budget tabes (ikke omfordelt)
    score += perAbility;
    let bar = Number(nextProgress[ability] ?? 0) + perAbility;
    while (
      bar >= 1
      && (gains[ability] ?? 0) < dailyCeiling
      && current + (gains[ability] ?? 0) < Math.min(99, cap ?? 99)
    ) {
      bar -= 1;
      gains[ability] = (gains[ability] ?? 0) + 1;
    }
    if (gains[ability]) nextAbilities[ability] = current + gains[ability];
    nextProgress[ability] = Math.min(bar, 0.999);
  }

  return {
    abilities: nextAbilities,
    progress: nextProgress,
    gains,
    score: Math.round(score * 100) / 100,
    noise,
    status: noise > 1.05 ? "over" : noise < 0.95 ? "under" : "normal",
  };
}
