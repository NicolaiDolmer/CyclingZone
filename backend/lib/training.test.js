import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_CONFIG, TRAINING_FOCUSES, TRAINING_FOCUS_KEYS,
  deriveTrainingState, canTrain, resolveTrainingModifier,
  isValidFocus, isValidIntensity,
  partitionBulkTrainingTargets, partitionSmartBulkTargets, BULK_TRAINING_MAX_RIDERS,
  focusTrainability, smartDefaultFocus,
  WEEKDAY_KEYS, isValidWeekPlanDays, resolveDayIntensity, cappedVisibleAbilities,
} from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { YOUTH_PROGRESSION_CONFIG } from "./riderProgression.js";

// ── Taksonomi-integritet ────────────────────────────────────────────────────────

test("alle fokus-evner er gyldige synlige abilities", () => {
  const visible = new Set(VISIBLE_ABILITIES);
  for (const [focus, abilities] of Object.entries(TRAINING_FOCUSES)) {
    for (const a of abilities) {
      assert.ok(visible.has(a), `fokus ${focus} peger på ukendt ability: ${a}`);
    }
  }
});

test("validatorer afviser ukendte fokus/intensiteter", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nonsense"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(!isValidIntensity("brutal"));
  // #1305: "rest" er nu gyldig daglig intensitet
  assert.ok(isValidIntensity("rest"));
});

// ── #1885: bulk-træning partitionering ──────────────────────────────────────────

test("partitionBulkTrainingTargets — fuld trup (>30) anvendes i ÉT kald med unlimited slots", () => {
  // Kernescenariet bag #1885: en fuld trup på 32 ryttere. Med unlimitedSlots
  // (slotsRemaining=null) skal ALLE ejede ryttere anvendes — ingen tabes.
  const riderIds = Array.from({ length: 32 }, (_, i) => `r${i}`);
  const owned = new Set(riderIds);
  const { toApply, skippedNotOwned, skippedNoSlots } = partitionBulkTrainingTargets({
    riderIds,
    ownedRiderIds: owned,
    plannedRiderIds: [],
    slotsRemaining: null,
  });
  assert.equal(toApply.length, 32);
  assert.deepEqual(skippedNotOwned, []);
  assert.deepEqual(skippedNoSlots, []);
});

test("partitionBulkTrainingTargets — ikke-ejede ryttere springes over (ejer-guard)", () => {
  const { toApply, skippedNotOwned } = partitionBulkTrainingTargets({
    riderIds: ["mine1", "rival", "mine2"],
    ownedRiderIds: ["mine1", "mine2"],
  });
  assert.deepEqual(toApply, ["mine1", "mine2"]);
  assert.deepEqual(skippedNotOwned, ["rival"]);
});

test("partitionBulkTrainingTargets — dubletter og null ignoreres, rækkefølge bevares", () => {
  const { toApply } = partitionBulkTrainingTargets({
    riderIds: ["a", null, "a", "b", undefined],
    ownedRiderIds: ["a", "b"],
  });
  assert.deepEqual(toApply, ["a", "b"]);
});

test("partitionBulkTrainingTargets — slot-grænse: nye planer kappes, re-targeting er gratis", () => {
  // 2 resterende slots. r1+r2 har allerede plan (gratis); r3 forbruger 1, r4
  // forbruger 1, r5 mangler slot → skipped.
  const { toApply, skippedNoSlots } = partitionBulkTrainingTargets({
    riderIds: ["r1", "r2", "r3", "r4", "r5"],
    ownedRiderIds: ["r1", "r2", "r3", "r4", "r5"],
    plannedRiderIds: ["r1", "r2"],
    slotsRemaining: 2,
  });
  assert.deepEqual(toApply, ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(skippedNoSlots, ["r5"]);
});

test("partitionBulkTrainingTargets — tom/manglende input giver tomme lister", () => {
  assert.deepEqual(partitionBulkTrainingTargets({}), { toApply: [], skippedNotOwned: [], skippedNoSlots: [] });
  assert.deepEqual(
    partitionBulkTrainingTargets({ riderIds: [], ownedRiderIds: [] }),
    { toApply: [], skippedNotOwned: [], skippedNoSlots: [] },
  );
});

test("BULK_TRAINING_MAX_RIDERS dækker en lovlig fuld trup med margin", () => {
  // 30 senior-cap + akademi; grænsen skal ligge komfortabelt over.
  assert.ok(BULK_TRAINING_MAX_RIDERS >= 50);
});

// ── deriveTrainingState ─────────────────────────────────────────────────────────

test("deriveTrainingState: ubegrænsede slots (unlimitedSlots=true) — total/remaining er null", () => {
  // #1305: default config har unlimitedSlots=true
  const s = deriveTrainingState([], "s2");
  assert.equal(s.slots.total, null);
  assert.equal(s.slots.used, 0);
  assert.equal(s.slots.remaining, null);
  assert.deepEqual(s.plans, {});
  assert.deepEqual(s.focuses, TRAINING_FOCUS_KEYS);
});

test("deriveTrainingState: kun aktiv-sæson-planer tæller (ubegrænset)", () => {
  const rows = [
    { rider_id: "r1", season_id: "s1", focus: "vo2max", intensity: "hard" }, // gammel sæson
    { rider_id: "r2", season_id: "s2", focus: "sprint", intensity: "normal" },
    { rider_id: "r3", season_id: "s2", focus: "aero", intensity: "easy" },
  ];
  const s = deriveTrainingState(rows, "s2");
  assert.equal(s.slots.used, 2);
  assert.equal(s.slots.remaining, null); // ubegrænset → null
  assert.deepEqual(s.plans.r2, { focus: "sprint", intensity: "normal" });
  assert.deepEqual(s.plans.r3, { focus: "aero", intensity: "easy" });
  assert.equal(s.plans.r1, undefined); // gammel sæson vises ikke som aktiv plan
});

test("deriveTrainingState: begrænset cfg (slotsPerSeason=3) — remaining bunder ud i 0", () => {
  // Explicit begrænset cfg for backward-compat test
  const limitedCfg = { ...TRAINING_CONFIG, unlimitedSlots: false };
  const rows = Array.from({ length: 9 }, (_, i) => ({ rider_id: `r${i}`, season_id: "s2", focus: "vo2max", intensity: "normal" }));
  const s = deriveTrainingState(rows, "s2", limitedCfg);
  assert.equal(s.slots.total, TRAINING_CONFIG.slotsPerSeason);
  assert.equal(s.slots.remaining, 0);
});

// ── canTrain ────────────────────────────────────────────────────────────────────

test("canTrain: ubegrænset (default) — altid ok uanset hasPlan/remaining", () => {
  // #1305: unlimitedSlots=true i default config
  assert.deepEqual(canTrain(false, null), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0), { ok: true, reason: null });
  assert.deepEqual(canTrain(true, 0), { ok: true, reason: null });
});

test("canTrain: begrænset cfg — ny plan kræver ledigt slot, om-målretning koster ikke", () => {
  const limitedCfg = { ...TRAINING_CONFIG, unlimitedSlots: false };
  assert.deepEqual(canTrain(false, 1, limitedCfg), { ok: true, reason: null });
  assert.deepEqual(canTrain(false, 0, limitedCfg), { ok: false, reason: "no_slots" });
  assert.deepEqual(canTrain(true, 0, limitedCfg), { ok: true, reason: null });
});

// ── resolveTrainingModifier ─────────────────────────────────────────────────────

test("resolveTrainingModifier: null plan → null modifier", () => {
  assert.equal(resolveTrainingModifier(null, "r1", 2), null);
  assert.equal(resolveTrainingModifier({ focus: "x", intensity: "hard" }, "r1", 2), null);
  // "x" er stadig ugyldig — men "rest" er nu gyldig
  assert.equal(resolveTrainingModifier({ focus: "vo2max", intensity: "x" }, "r1", 2), null);
});

test("resolveTrainingModifier: rest giver easy-lignende multiplier", () => {
  for (let i = 0; i < 50; i++) {
    const m = resolveTrainingModifier({ focus: "endurance", intensity: "rest" }, `r-rest-${i}`, 3);
    assert.ok(m !== null, "rest + gyldig fokus → ikke null");
    assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.easy);
    assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
  }
});

test("resolveTrainingModifier: fokus-evner får focusMult, resten offFocusMult", () => {
  const m = resolveTrainingModifier({ focus: "sprint", intensity: "easy" }, "r1", 2);
  assert.ok(m.focusAbilities.has("sprint"));
  assert.ok(m.focusAbilities.has("acceleration"));
  assert.ok(!m.focusAbilities.has("climbing"));
  assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.easy);
  assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
});

test("resolveTrainingModifier: deterministisk pr. (rytter, sæson, plan)", () => {
  const a = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, "rider-x", 3);
  const b = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, "rider-x", 3);
  assert.equal(a.focusMult, b.focusMult);
  assert.equal(a.offFocusMult, b.offFocusMult);
});

// #3758: setback (risiko for tabt vækst ved hård intensitet) er fjernet fra
// spillet — målt til 0 udløsninger nogensinde (se issuet). Hård intensitet
// giver nu altid sin fulde focusGrowthMult, uden dæmpning.
test("resolveTrainingModifier: hård intensitet giver fuld focusMult, ingen dæmpning (#3758)", () => {
  for (let i = 0; i < 200; i++) {
    const m = resolveTrainingModifier({ focus: "vo2max", intensity: "hard" }, `seed-${i}`, 2);
    assert.equal(m.focusMult, TRAINING_CONFIG.focusGrowthMult.hard);
    assert.equal(m.offFocusMult, TRAINING_CONFIG.offFocusMult);
  }
});

// ── #1974/#3195: focusTrainability — type-derived trainability-signal ──────────
// Udledes af youthRoleFactor(primaryType, secondaryType, ability) (riderProgression.js)
// — SAMME model som buildCapsForRider rent faktisk bruger til livstidsloftet
// (ejer-besluttet 2026-07-15). Værdier bekræftet mod de faktiske vægt-tabeller i
// riderTypes.js (RIDER_TYPES) OG mod YOUTH_PROGRESSION_CONFIG's tier-konstanter
// (naturalPrimaryFactor 1.0 / naturalSecondaryFactor 0.82 / neutralFactor 0.45 /
// oppositeFactor 0.12 — "blocked" er altså laveste tier, IKKE bogstaveligt nul).

test("focusTrainability: climber (uden sekundær type) — signatur-fokus er 'strength', modsat fokus er 'blocked'", () => {
  const t = focusTrainability("climber");
  // #3325: climber weights: climbing:3, tempo:2, punch:1, endurance:1, sprint:-1
  // (acceleration/flat-straffen fjernet — se riderTypes.js's #3325-kommentar: den
  // fungerede som en generisk "ikke-sprinter"-bonus under caps-klassifikationen).
  assert.equal(t.vo2max, "strength");    // climbing+punch+tempo alle positive (factor 1.0)
  assert.equal(t.threshold, "strength"); // tempo positiv (time_trial neutral 0.45)
  assert.equal(t.sprint, "limited");     // sprint(-1)→0.12, acceleration uvægtet→0.45 — blanding, ikke alle ≤0.12 (#3325: var 'blocked' da acceleration også var -1)
  assert.equal(t.endurance, "strength"); // endurance positiv
  // #3709 trin 4: haandvaerks-taget (0,95) ligger nu UNDER sekundaer-taerskelen
  // (1,10), saa climberens positioning laeses som 'limited' — samme tier som en
  // helt neutral evne paa 0,70. Se HAANDVAERK-noten nedenfor: labelen kan ikke
  // skelne 0,95 fra 0,70, og det er en kendt begraensning, ikke et resultat.
  assert.equal(t.technique, "limited");
  assert.equal(t.aero, "limited");       // time_trial neutral (0.45), flat uvægtet→0.45 (#3325: var negativ)
});

test("focusTrainability: sprinter (uden sekundær type) — sprint-fokus 'strength', vo2max/threshold 'limited' (ingen blocked)", () => {
  const t = focusTrainability("sprinter");
  // sprinter weights: acceleration:3, sprint:2, flat:1, durability:1, climbing:-2, endurance:-1
  assert.equal(t.sprint, "strength");   // sprint+acceleration begge positive
  assert.equal(t.endurance, "strength"); // durability positiv (endurance selv er -1 → 0.12, men durability≥1 gør fokus 'strength')
  assert.equal(t.vo2max, "limited");    // climbing(-2)→0.12, punch/tempo neutrale (0.45) → ikke alle ≤0.12
  // trin 2 (#3746, 16/8): positioning flyttede fra `technique` til `loebslaere`.
  // technique er nu kun descending+cobblestone, og sprinteren ejer ingen af de
  // to (vaegt 0 for begge) → 'limited', ikke laengere 'strength'.
  assert.equal(t.technique, "limited");
  // #3682: sprinteren EJER positioning (vaegt 1) → signatur → 'strength' for
  // loebslaere (der nu baerer positioning).
  assert.equal(t.loebslaere, "strength");
});

test("focusTrainability: alle TRAINING_FOCUS_KEYS er dækket for enhver kendt type", () => {
  for (const focusKey of TRAINING_FOCUS_KEYS) {
    const t = focusTrainability("gc");
    assert.ok(["strength", "limited", "blocked"].includes(t[focusKey]), `ugyldig værdi for ${focusKey}`);
  }
});

test("focusTrainability: null/undefined primary_type → alt 'limited' (sikker neutral)", () => {
  // null/undefined kortsluttes ØVERST i focusTrainability og rører aldrig
  // youthRoleFactor — derfor er de upåvirkede af håndværks-gulvet.
  for (const primaryType of [null, undefined]) {
    const t = focusTrainability(primaryType);
    for (const focusKey of TRAINING_FOCUS_KEYS) {
      assert.equal(t[focusKey], "limited", `${String(primaryType)} → ${focusKey} skulle være 'limited'`);
    }
  }
});

test("focusTrainability: ukendt type-STRENG giver alt 'limited', ligesom null", () => {
  // "" og "nonexistent-type" er IKKE == null, saa de gaar gennem youthRoleFactor i
  // stedet for null-kortslutningen oeverst i funktionen. Efter trin 4 lander begge
  // veje samme sted: en ukendt type ejer ingen evner (0,70 andenRolle) og
  // haandvaerks-taget (0,95) naar ikke op over sekundaer-taerskelen (1,10).
  // De to grene giver altsaa samme svar — men af FORSKELLIGE grunde, og det er
  // vaerd at pinne, for aendres taallene igen, skilles de ad uden varsel.
  for (const primaryType of ["", "nonexistent-type"]) {
    const t = focusTrainability(primaryType);
    for (const focusKey of TRAINING_FOCUS_KEYS) {
      assert.equal(t[focusKey], "limited", `${primaryType} → ${focusKey}`);
    }
  }
});

// ── HAANDVAERK-noten (#3709 trin 4) ─────────────────────────────────────────
// focusTrainability laeser KUN taget. Modellen har efter trin 4 TO knapper, og
// labelen kan ikke se den anden:
//
//   klasse       tag     rate    label
//   signatur     1,30    0,45    strength
//   sekundaer    1,10    0,36    strength
//   haandvaerk   0,95    0,22    limited   ← hoejt tag, næstlavest rate
//   andenRolle   0,70    0,15    limited
//   svaghed      0,20    0,05    blocked (kun hvis ALLE fokus-evner er svagheder)
//
// Haandvaerk og andenRolle faar samme label selvom taget er 36 % hoejere paa den
// ene. For positioning og tactics betyder det at spilleren faar at vide at det er
// "begraenset", mens loftet i virkeligheden er taet paa en sekundaer evnes.
//
// Det er en KENDT begraensning, ikke et resultat. En label der skal vaere aerlig
// om to knapper skal laese begge — og hvordan den skal se ud er en designbeslutning
// paa traeningsfladen, som ejes af #3721. Trin 2 flytter desuden positioning ud af
// `technique` og over i `loebslaere`, saa fokus-inddelingen selv aendrer sig.
// Denne test pinner den nuvaerende, tag-only adfaerd saa aendringen bliver et VALG.
test("focusTrainability: haandvaerk og andenRolle er UMULIGE at skelne i labelen (kendt begraensning)", () => {
  const cfg = YOUTH_PROGRESSION_CONFIG;
  assert.ok(cfg.craftFactor > cfg.neutralFactor, "haandvaerk HAR et hoejere tag end andenRolle ...");
  // ... men labelen kan stadig ikke se forskel, og BEGRUNDELSEN aendrede sig 15/8.
  //
  // Den gamle regel laeste FAKTOREN og satte graensen ved naturalSecondaryFactor.
  // Den holdt kun saa laenge haandvaerks-taget laa under sekundaer, og det gjorde
  // det aldrig: trin 3 indfoerte craftFactor 0,95 mod sekundaerens 0,82. Reglen
  // ville derfor have gjort positioning og tactics til "strength" for HVER eneste
  // rytter i spillet — assertionen herunder er netop den inversion.
  //
  // Labelen laeser klassen nu, og BAADE haandvaerk og andenRolle mapper bevidst
  // til 'limited'. Samme kendte begraensning, men uafhaengig af kalibreringen.
  assert.ok(cfg.craftFactor > cfg.naturalSecondaryFactor,
    "inversionen der braekkede den gamle faktor-baserede taerskel");
  // climber ejer hverken positioning (haandvaerk) eller descending (andenRolle)
  // — begge lander paa 'limited'.
  assert.equal(focusTrainability("climber").technique, "limited");
});

test("#3682/#3709: smartDefaultFocus er UÆNDRET for alle otte typer (ingen rytter skifter fokus i prod)", () => {
  // Den vigtigste sikkerhedsegenskab i trin 3. smartDefaultFocus afgør hvilket
  // fokus tusindvis af ryttere UDEN egen plan rent faktisk trænes med hver dag.
  // Den læser legacyPrimaryTypeTier → signatureFactor, som #3682's nye
  // positioning-vægt PÅVIRKER (sprinter/brostensrytter/puncheur/rouleur får
  // technique = 'strength'). At outputtet alligevel ikke flytter sig skyldes at
  // alle fire allerede har et 'strength'-fokus TIDLIGERE i TRAINING_FOCUS_KEYS —
  // det er en egenskab ved rækkefølgen, ikke et tilfælde vi må stole på blindt.
  assert.deepEqual(
    Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, smartDefaultFocus(t)])),
    {
      sprinter: "sprint",
      tt: "threshold",
      climber: "vo2max",
      puncheur: "vo2max",
      brostensrytter: "vo2max",
      baroudeur: "vo2max",
      rouleur: "endurance",
      gc: "vo2max",
    },
  );
});

// ── #3195 rod-årsag: sekundær type skal RESCUE et fokus, ikke ignoreres ────────
// Bug-reproduktion: ægte prod-rytter "Oliver Doyle" (primary=tt, secondary=sprinter,
// potentiale 6.0). Før #3195 sagde focusTrainability("tt") "limited" på Sprint-fokus
// (kun tt-vægtene set: sprint:-1, acceleration uvægtet) — men rider_derived_abilities.
// ability_caps i prod viste sprint=72/acceleration=72 (loftByPotential[6]=88 ×
// naturalSecondaryFactor 0.82), fordi hans SEKUNDÆRE sprinter-type reelt løfter
// loftet næsten til fuldt niveau. Uden secondaryType kan denne rescue aldrig ses.
test("focusTrainability: #3195 — sekundær type rescuer et fokus primærtypen alene ville vise som begrænset", () => {
  const withoutSecondary = focusTrainability("tt", null);
  assert.equal(withoutSecondary.sprint, "limited"); // tt alene: sprint(-1)→0.12, acceleration uvægtet→0.45 — blanding

  const withSecondary = focusTrainability("tt", "sprinter");
  // tt.sprint=-1 (negativ i primær) MEN sprinter.sprint=+2 (positiv i sekundær) →
  // naturalSecondaryFactor 0.82 vinder (youthRoleFactor tjekker ws>0 FØR opposite).
  // tt.acceleration er uvægtet, sprinter.acceleration=+3 → samme rescue.
  assert.equal(withSecondary.sprint, "strength");
});

test("focusTrainability: #3195 — ÆGTE modsat i BÅDE primær og sekundær forbliver 'limited', ingen falsk 'strength'-rescue", () => {
  // #3325: climber (sprint:-1) + puncheur (sprint:-1) — begge typer straffer sprint
  // (factor 0.12), MEN ingen af dem vægter acceleration længere (factor 0.45,
  // neutral) — så mixet lander på 'limited', ikke 'blocked' (var 'blocked' før
  // #3325, da climber også straffede acceleration). Pointen (ingen falsk RESCUE
  // til 'strength' fra en sekundær-type der ikke burde redde fokusset) holder
  // stadig — puncheur redder ikke sprint til 'strength'.
  const t = focusTrainability("climber", "puncheur");
  assert.equal(t.sprint, "limited");
});

test("focusTrainability: matcher youthRoleFactor-tierne direkte (forward-guard mod ny model-drift)", () => {
  // vo2max=[climbing,punch,tempo]: climber prim på alle tre (weights climbing:3,
  // punch:1, tempo:2) → factor 1.0 for alle tre → et utvetydigt 'strength'-tilfælde
  // uanset threshold-detaljer, så testen holder selv hvis tier-konstanterne justeres.
  const t = focusTrainability("climber", null);
  assert.equal(t.vo2max, "strength");
});

// ── smartDefaultFocus (#1894) ────────────────────────────────────────────────────
// Forventede værdier er verificeret mod den FAKTISKE output af funktionen (kørt
// lokalt), ikke antaget — og sanity-tjekket cykelfagligt: en sprinter skal accelerere/
// sprinte, en klatrer/gc-rytter skal bygge vo2max (klatring+punch+tempo), en tempo-
// kører (tt) skal bygge threshold (time_trial+tempo), en rouleur (ingen skarpt
// speciale) lander på endurance — samme adfærd som den gamle hardcoded default.
test("smartDefaultFocus: sprinter → sprint (speciale-evner acceleration+sprint er positive)", () => {
  assert.equal(smartDefaultFocus("sprinter"), "sprint");
});

test("smartDefaultFocus: climber → vo2max (climbing/tempo/punch er positive type-vægte)", () => {
  assert.equal(smartDefaultFocus("climber"), "vo2max");
});

test("smartDefaultFocus: tt (tidskører) → threshold (time_trial-vægt er positiv, climbing er negativ)", () => {
  assert.equal(smartDefaultFocus("tt"), "threshold");
});

test("smartDefaultFocus: gc → vo2max (climbing+tempo positive; første strength-fokus i nøgle-rækkefølgen)", () => {
  assert.equal(smartDefaultFocus("gc"), "vo2max");
});

test("smartDefaultFocus: rouleur → endurance (intet skarpt vo2max/threshold/sprint-speciale)", () => {
  assert.equal(smartDefaultFocus("rouleur"), "endurance");
});

test("smartDefaultFocus: null/undefined/ukendt type → endurance (bagudkompatibel, sikker fallback)", () => {
  for (const primaryType of [null, undefined, "", "nonexistent-type"]) {
    assert.equal(smartDefaultFocus(primaryType), "endurance", `${String(primaryType)} skulle give endurance`);
  }
});

test("smartDefaultFocus: returnerer altid en gyldig fokus-nøgle for enhver kendt type", () => {
  const knownTypes = ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"];
  for (const type of knownTypes) {
    assert.ok(TRAINING_FOCUS_KEYS.includes(smartDefaultFocus(type)), `${type} gav ugyldig fokus-nøgle`);
  }
});

test("smartDefaultFocus: deterministisk — samme input giver samme output hver gang", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(smartDefaultFocus("sprinter"), "sprint");
    assert.equal(smartDefaultFocus("climber"), "vo2max");
  }
});

// ── partitionSmartBulkTargets (#1894 variant 3 — bulk smart-focus) ─────────────────
test("partitionSmartBulkTargets: ryttere MED eksisterende plan springes over (aldrig overskrevet)", () => {
  const result = partitionSmartBulkTargets({
    riderIds: ["r1", "r2", "r3"],
    plannedRiderIds: ["r2"],
  });
  assert.deepEqual(result.eligible, ["r1", "r3"]);
  assert.deepEqual(result.skippedHasPlan, ["r2"]);
});

test("partitionSmartBulkTargets: ingen eksisterende planer → alle eligible", () => {
  const result = partitionSmartBulkTargets({ riderIds: ["r1", "r2"], plannedRiderIds: [] });
  assert.deepEqual(result.eligible, ["r1", "r2"]);
  assert.deepEqual(result.skippedHasPlan, []);
});

test("partitionSmartBulkTargets: dubletter og null ignoreres, rækkefølge bevares", () => {
  const result = partitionSmartBulkTargets({
    riderIds: ["r1", null, "r1", "r2", "r1"],
    plannedRiderIds: [],
  });
  assert.deepEqual(result.eligible, ["r1", "r2"]);
});

test("partitionSmartBulkTargets: tom/manglende input giver tomme lister", () => {
  assert.deepEqual(partitionSmartBulkTargets({}), { eligible: [], skippedHasPlan: [] });
  assert.deepEqual(partitionSmartBulkTargets({ riderIds: [] }), { eligible: [], skippedHasPlan: [] });
});

// ── #1895 PR 1: ugentlig træningsrytme ───────────────────────────────────────────

function fullWeek(intensity) {
  const days = {};
  for (const k of WEEKDAY_KEYS) days[k] = { intensity };
  return days;
}

test("isValidWeekPlanDays: gyldig fuld uge accepteres", () => {
  assert.ok(isValidWeekPlanDays(fullWeek("normal")));
  const mixed = fullWeek("normal");
  mixed.sun = { intensity: "rest" };
  assert.ok(isValidWeekPlanDays(mixed));
});

test("isValidWeekPlanDays: manglende ugedag afvises", () => {
  const days = fullWeek("normal");
  delete days.sun;
  assert.ok(!isValidWeekPlanDays(days));
});

test("isValidWeekPlanDays: ugyldig intensitet afvises", () => {
  const days = fullWeek("normal");
  days.mon = { intensity: "brutal" };
  assert.ok(!isValidWeekPlanDays(days));
});

test("isValidWeekPlanDays: ekstra/ukendte nøgler afvises", () => {
  const days = fullWeek("normal");
  days.theme = "recovery-week";
  assert.ok(!isValidWeekPlanDays(days));
});

test("isValidWeekPlanDays: ikke-objekt/null afvises", () => {
  assert.ok(!isValidWeekPlanDays(null));
  assert.ok(!isValidWeekPlanDays(undefined));
  assert.ok(!isValidWeekPlanDays("normal"));
  assert.ok(!isValidWeekPlanDays([]));
});

test("resolveDayIntensity: rytter-override vinder over alt", () => {
  const result = resolveDayIntensity({
    weekday: "mon",
    riderOverrideDays: { mon: { intensity: "rest" } },
    teamWeekDays: { mon: { intensity: "hard" } },
    planIntensity: "normal",
  });
  assert.equal(result, "rest");
});

test("resolveDayIntensity: holdets ugerytme vinder når ingen rytter-override", () => {
  const result = resolveDayIntensity({
    weekday: "tue",
    riderOverrideDays: null,
    teamWeekDays: { tue: { intensity: "hard" } },
    planIntensity: "normal",
  });
  assert.equal(result, "hard");
});

test("resolveDayIntensity: falder tilbage til sæson-intensitet uden ugerytme", () => {
  const result = resolveDayIntensity({
    weekday: "wed",
    riderOverrideDays: null,
    teamWeekDays: null,
    planIntensity: "easy",
  });
  assert.equal(result, "easy");
});

test("resolveDayIntensity: falder tilbage til 'normal' uden nogen input (regressions-guard — bit-identisk med i dag)", () => {
  const result = resolveDayIntensity({
    weekday: "thu",
    riderOverrideDays: null,
    teamWeekDays: null,
    planIntensity: null,
  });
  assert.equal(result, "normal");
});

test("resolveDayIntensity: holdrytme uden dagens ugedag falder videre til sæson-intensitet", () => {
  const result = resolveDayIntensity({
    weekday: "fri",
    riderOverrideDays: null,
    teamWeekDays: { mon: { intensity: "hard" } }, // ingen "fri"-nøgle
    planIntensity: "hard",
  });
  assert.equal(result, "hard");
});

test("resolveDayIntensity: rest vinder på alle lag når sat", () => {
  for (const layer of [
    { riderOverrideDays: { sat: { intensity: "rest" } }, teamWeekDays: null, planIntensity: "hard" },
    { riderOverrideDays: null, teamWeekDays: { sat: { intensity: "rest" } }, planIntensity: "hard" },
  ]) {
    assert.equal(resolveDayIntensity({ weekday: "sat", ...layer }), "rest");
  }
});

// #2438 — regressionstest for kontrakten: en individuel rytter-indstilling
// overtrumfer den ugentlige rutine; rutinen er kun default for ryttere UDEN
// override. Reproducerer bug-rapporten: manager satte holdrytme=hard, men
// enkelte ryttere til rest/light via egen plan — de trænede alligevel hard.
test("resolveDayIntensity: #2438 — rytterens EGEN eksplicitte plan (rest) vinder over holdets rytme (hard)", () => {
  const result = resolveDayIntensity({
    weekday: "mon",
    riderOverrideDays: null,
    teamWeekDays: { mon: { intensity: "hard" } },
    planIntensity: "rest",
    hasExplicitPlan: true,
  });
  assert.equal(result, "rest");
});

test("resolveDayIntensity: #2438 — uden eksplicit plan er holdrytmen stadig DEFAULT for rytteren", () => {
  const result = resolveDayIntensity({
    weekday: "mon",
    riderOverrideDays: null,
    teamWeekDays: { mon: { intensity: "hard" } },
    planIntensity: "normal", // DEFAULT_PROGRAM-fallback, ikke en eksplicit rytter-plan
    hasExplicitPlan: false,
  });
  assert.equal(result, "hard");
});

test("resolveDayIntensity: #2438 — individuel ugeplan-override vinder selv over rytterens EGEN eksplicitte plan", () => {
  const result = resolveDayIntensity({
    weekday: "mon",
    riderOverrideDays: { mon: { intensity: "easy" } },
    teamWeekDays: { mon: { intensity: "hard" } },
    planIntensity: "rest",
    hasExplicitPlan: true,
  });
  assert.equal(result, "easy");
});

// ── #2578: cappedVisibleAbilities — loft-markering uden at afsløre tal ─────────
test("cappedVisibleAbilities: evne på/over loftet markeres; under loftet gør ikke", () => {
  const [a, b] = VISIBLE_ABILITIES;
  const row = { [a]: 70, [b]: 69, ability_caps: { [a]: 70, [b]: 70 } };
  assert.deepEqual(cappedVisibleAbilities(row), [a]);
});

test("cappedVisibleAbilities: manglende/ugyldigt cap markeres IKKE (konservativt)", () => {
  const [a, b] = VISIBLE_ABILITIES;
  assert.deepEqual(cappedVisibleAbilities({ [a]: 70, ability_caps: null }), []);
  assert.deepEqual(cappedVisibleAbilities({ [a]: 70, [b]: 80, ability_caps: { [a]: "x" } }), []);
  assert.deepEqual(cappedVisibleAbilities(null), []);
});

test("cappedVisibleAbilities: current >= 99 er ALTID på loftet (dailyTraining klipper ved min(99, cap))", () => {
  const [a] = VISIBLE_ABILITIES;
  assert.deepEqual(cappedVisibleAbilities({ [a]: 99, ability_caps: null }), [a]);
  // cap over 99 ændrer intet — 99 er den hårde grænse.
  assert.deepEqual(cappedVisibleAbilities({ [a]: 99, ability_caps: { [a]: 120 } }), [a]);
});

test("cappedVisibleAbilities: kun VISIBLE_ABILITIES vurderes — fremmede nøgler ignoreres", () => {
  const row = { not_an_ability: 50, ability_caps: { not_an_ability: 50 } };
  assert.deepEqual(cappedVisibleAbilities(row), []);
});
