// #4382 · Drift-vagt for hjaelpe-afsnittet om flerarsplanens livscyklus.
//
// Baggrund: tre erfarne spillere kunne 28/8 ikke svare hinanden paa hvornaar en
// 3- eller 5-arsplan udloeber, om den bare udsaettes, og hvor bonustilbuddet kan
// komme fra. Afsnittet `sections.board.multiYearLifecycle` i help.json (EN+DA)
// besvarer det nu, og hvert svar er et udsagn OM KODEN. Uden en vagt driver den
// slags copy praecis som tallene gjorde i #1907/#1916: koden aendres, hjaelpen
// bliver til en loegn, og ingen test bliver roed.
//
// Samme princip og placering som handheldCopyGuards.test.js (#3681): naar to
// steder skal vaere ens, testes VAERDIERNE, ikke formen. `backend-tests` er et
// required check, og en backend-test kan laese frontendens locale-filer direkte.
//
// Teknik pr. udsagn:
//   1. IMPORT   — naar konstanten/funktionen er afhaengighedslet
//                 (PLAN_DURATIONS, isBonusOfferEligible, computeBoardBaseModifier).
//   2. KILDE-SCAN — naar udsagnet handler om en gren i en route/motor som ikke
//                 kan importeres uden at trekke hele Express/Supabase-stakken ind
//                 (api.js' bonus-accept, economyEngine's udloebs-reset,
//                 boardWeekendFinalization's mid-season-checkpoint).
//
// SSOT for de samme udsagn: docs/BOARD_RULES.md §1.1 + §4.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAN_DURATIONS } from "./boardConstants.js";
import { isBonusOfferEligible } from "./boardConsequences.js";
import { computeBoardBaseModifier } from "./sponsorEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const readSource = (...parts) => readFileSync(join(REPO_ROOT, ...parts), "utf8");
const loadHelp = (lng) =>
  JSON.parse(readSource("frontend", "public", "locales", lng, "help.json"));

const EN = loadHelp("en");
const DA = loadHelp("da");
const EN_BLOCK = EN.sections?.board?.multiYearLifecycle;
const DA_BLOCK = DA.sections?.board?.multiYearLifecycle;

// Hele afsnittet som een streng pr. sprog — udsagns-vagterne herunder soeger i den.
const blockText = (block) => [block?.title, block?.text, ...(block?.steps || [])].join(" ");

test("#4382: hjaelpe-afsnittet findes i begge sprog med samme antal trin", () => {
  for (const [lng, block] of [["en", EN_BLOCK], ["da", DA_BLOCK]]) {
    assert.ok(block, `${lng}/help.json mangler sections.board.multiYearLifecycle`);
    assert.ok(block.text, `${lng}: afsnittet mangler indledningen (kind "textSteps" renderer text + steps)`);
    assert.ok(Array.isArray(block.steps) && block.steps.length > 0, `${lng}: afsnittet mangler steps`);
  }
  assert.equal(
    EN_BLOCK.steps.length,
    DA_BLOCK.steps.length,
    "EN og DA er drevet fra hinanden: forskelligt antal trin i multiYearLifecycle",
  );
});

test("#4382: DA-teksten bruger aeoeaa (ejer-krav, bidt 19/8)", () => {
  assert.match(
    blockText(DA_BLOCK),
    /[æøå]/,
    "DA-afsnittet indeholder ingen aeoeaa — translitereret dansk maa kun bruges i commits og CLI",
  );
});

test("#4382: ingen em-dash i det nye afsnit (copy-reglen)", () => {
  for (const [lng, block] of [["en", EN_BLOCK], ["da", DA_BLOCK]]) {
    assert.ok(!blockText(block).includes("—"), `${lng}: afsnittet indeholder em-dash`);
  }
});

// ── Udsagn 1: "1, 3 eller 5 saesoner" + midtvejs-review efter 1 hhv. 2 saesoner ──
// Hjaelpen naevner planlaengderne og midtvejs-punkterne i klartekst. De er
// udledt af PLAN_DURATIONS + economyEngine's Math.floor(planDuration / 2).
test("#4382: planlaengderne i hjaelpen matcher PLAN_DURATIONS", () => {
  assert.deepEqual(PLAN_DURATIONS, { "1yr": 1, "3yr": 3, "5yr": 5 });

  const en = blockText(EN_BLOCK);
  assert.match(en, /1, 3 or 5 seasons/, "EN naevner ikke laengderne 1/3/5 laengere");
  // floor(3/2) = 1 og floor(5/2) = 2 — de tal staar ordret i hjaelpen.
  assert.equal(Math.floor(PLAN_DURATIONS["3yr"] / 2), 1);
  assert.equal(Math.floor(PLAN_DURATIONS["5yr"] / 2), 2);
  assert.match(
    en,
    /after 1 completed season on a 3-year plan and 2 on a 5-year plan/,
    "EN's midtvejs-punkter matcher ikke laengere Math.floor(planDuration / 2)",
  );
});

test("#4382: economyEngine udleder stadig midtvejs-reviewet af Math.floor(planDuration / 2)", () => {
  const src = readSource("backend", "lib", "economyEngine.js");
  assert.match(
    src,
    /isMidReview\s*=\s*!planIsComplete\s*&&\s*seasonsCompleted\s*===\s*Math\.floor\(planDuration \/ 2\)/,
    "Midtvejs-reviewets betingelse er aendret — hjaelpens '1 hhv. 2 saesoner' skal opdateres",
  );
});

// ── Udsagn 2: planen udsaettes IKKE, den udloeber og nulstilles ────────────────
test("#4382: plan-udloeb nulstiller stadig taellere og saetter negotiation_status pending", () => {
  const src = readSource("backend", "lib", "economyEngine.js");
  assert.match(src, /const planIsComplete = seasonsCompleted >= planDuration;/);
  const resetBlock = src.slice(src.indexOf("if (planIsComplete) {"));
  for (const field of [
    'negotiation_status: "pending"',
    "seasons_completed: 0",
    "cumulative_stage_wins: 0",
    "cumulative_gc_wins: 0",
  ]) {
    assert.ok(
      resetBlock.includes(field),
      `Udloebs-grenen saetter ikke laengere ${field} — hjaelpen lover at planen nulstilles og skal genforhandles`,
    );
  }
});

// ── Udsagn 3: en pending plan tælles ikke med i sponsor-modifierens gennemsnit ─
test("#4382: kun completed-planer tæller i sponsor-modifierens gennemsnit", () => {
  const signed = [
    { negotiation_status: "completed", budget_modifier: 1.2 },
    { negotiation_status: "completed", budget_modifier: 1.0 },
  ];
  const withPending = [...signed, { negotiation_status: "pending", budget_modifier: 0.8 }];
  assert.equal(
    computeBoardBaseModifier(withPending),
    computeBoardBaseModifier(signed),
    "En pending plan paavirker nu gennemsnittet — hjaelpen siger at den holdes udenfor",
  );
});

// ── Udsagn 4: bonustilbuddet kraever STRENGT over 75 % ─────────────────────────
test("#4382: bonus-berettigelsen er strengt over 75 %, ikke 75 og derover", () => {
  const met = { goalsMet: 4, goalsTotal: 4 };
  assert.equal(isBonusOfferEligible({ satisfaction: 75, ...met }), false, "75 burde ikke vaere nok");
  assert.equal(isBonusOfferEligible({ satisfaction: 76, ...met }), true);
  assert.equal(
    isBonusOfferEligible({ satisfaction: 90, goalsMet: 2, goalsTotal: 4 }),
    false,
    "50 % maal opfyldt burde ikke vaere nok",
  );
  assert.equal(isBonusOfferEligible({ satisfaction: 90, goalsMet: 3, goalsTotal: 4 }), true);
});

// ── Udsagn 5: ekstra-maalet lander ALTID paa 1-aarsplanen ─────────────────────
// Hjaelpen siger "the extra target is always added to your 1-year plan ...
// whichever plan the offer came from". Det hviler paa at accept-stien slaar
// 1yr-boardet op eksplicit, uanset offer.source_board_id.
//
// #4856 · Selve skrivningen bor nu i `boardBonusGoal.js` (api.js delegerer),
// fordi det samme maal ogsaa skal i `board_mandates.goals`. Vagten foelger med
// til den nye adresse i stedet for at blive slaeket: BEGGE halvdele checkes —
// at ruten stadig delegerer, og at modulet stadig rammer 1yr-boardet.
test("#4382: bonus-accept lægger stadig ekstra-maalet paa 1yr-boardet", () => {
  const src = readSource("backend", "routes", "api.js");
  const acceptBlock = src.slice(src.indexOf("finalizeBonusOfferAccept({ supabase, offerId: loaded.offer.id })"));
  assert.ok(acceptBlock.length > 0, "Kunne ikke finde bonus-accept-grenen i api.js");
  const attachBlock = acceptBlock.slice(0, acceptBlock.indexOf("res.json("));
  assert.match(
    attachBlock,
    /applyAcceptedBonusGoal\(/,
    "Accept-ruten vedhaefter ikke laengere ekstra-maalet — hjaelpens bonus-udsagn bliver forkert",
  );

  const bonusGoal = readSource("backend", "lib", "boardBonusGoal.js");
  assert.match(
    bonusGoal,
    /\.eq\("plan_type", "1yr"\)/,
    "Ekstra-maalet lægges ikke laengere paa 1yr-boardet — baade help.json (faq.bonusOffer + multiYearLifecycle) og BOARD_RULES §4 skal rettes",
  );
  assert.match(
    bonusGoal,
    /source: "bonus_offer"/,
    "Ekstra-maalet markeres ikke laengere som bonus_offer i current_goals",
  );
});

// ── #4856: samme maal skal ogsaa i mandatet, som Boardroom laeser ─────────────
// Adfaerds-daekningen ligger i boardBonusGoal.test.js; denne vagt holder
// KILDE-udsagnet: der findes stadig en skrivning til board_mandates.goals paa
// accept-stien. Uden den er Boardroom-siden blind for et accepteret bonusmaal
// (rod-aarsagen til #4856).
test("#4856: bonus-accept skriver ogsaa til board_mandates.goals", () => {
  const bonusGoal = readSource("backend", "lib", "boardBonusGoal.js");
  assert.match(
    bonusGoal,
    /from\("board_mandates"\)[\s\S]{0,800}?\.update\(\{ goals:/,
    "Mandat-skrivningen er væk — Boardroom viser saa ikke det accepterede bonusmaal (#4856)",
  );
});

// ── Udsagn 6: to hårde checkpoints, ikke eet ──────────────────────────────────
test("#4382: konsekvens-lagene evalueres stadig paa mid-season-checkpointet ogsaa", () => {
  const weekend = readSource("backend", "lib", "boardWeekendFinalization.js");
  assert.match(
    weekend,
    /if \(checkpoint === CHECKPOINT_KINDS\.MID_SEASON\) \{[\s\S]{0,400}?evaluateAndApplyConsequencesFn\(/,
    "Mid-season-checkpointet kalder ikke laengere konsekvens-motoren — hjaelpens 'to checkpoints' bliver forkert",
  );
  const engine = readSource("backend", "lib", "economyEngine.js");
  assert.match(
    engine,
    /evaluateAndApplyConsequences(Fn)?\(/,
    "Saeson-slut-stien kalder ikke laengere konsekvens-motoren",
  );
});
