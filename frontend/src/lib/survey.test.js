import test from "node:test";
import assert from "node:assert/strict";

import {
  SCALE_0_10,
  SCALE_1_5,
  answeredUnits,
  answersByQuestionKey,
  buildResponsePayload,
  canSubmit,
  computeProgress,
  displayTextAnswer,
  groupQuestionsIntoSections,
  INVITE_DISMISS_DAYS,
  inviteDismissKey,
  inviteDismissedUntil,
  isInviteDismissed,
  isAnswered,
  missingRequired,
  normalizeAnswer,
  optionGroup,
  optionLabel,
  SECTION_ORDER,
  progressUnits,
  questionHelp,
  questionLabel,
  resolveSurveyView,
  scaleFor,
  sectionForQuestion,
  sortQuestions,
} from "./survey.js";

const nps = { key: "nps", kind: "scale_0_10", required: true, sort_order: 10, label_en: "NPS", label_da: "NPS" };
const satisfaction = {
  key: "satisfaction",
  kind: "scale_1_5",
  required: true,
  sort_order: 20,
  label_en: "Satisfied?",
  label_da: "Tilfreds?",
  help_en: "1 to 5",
  help_da: "1 til 5",
};
const axes = {
  key: "feature_axes",
  kind: "idea_importance",
  required: false,
  sort_order: 30,
  label_en: "Rate each idea twice.",
  label_da: "Giv hver idé to karakterer.",
  options: [
    { key: "live_race", label_en: "Live race", label_da: "Live løb" },
    { key: "youth_teams", label_en: "Youth teams", label_da: "Ungdomshold" },
    { key: "team_looks", label_en: "Team looks", label_da: "Holdets udseende" },
  ],
};
const fogMore = {
  key: "fog_more",
  kind: "single",
  required: true,
  sort_order: 50,
  label_en: "How much more should be hidden?",
  label_da: "Hvor meget mere skal skjules?",
  options: [
    { key: "nothing", label_en: "Nothing more", label_da: "Ikke mere" },
    { key: "a_lot", label_en: "A lot more", label_da: "Meget mere" },
    { key: "no_opinion", label_en: "No strong opinion", label_da: "Ingen stærk holdning" },
  ],
};
const worst = {
  key: "works_worst",
  kind: "multi_max3",
  required: true,
  sort_order: 40,
  label_en: "Worst?",
  label_da: "Dårligst?",
  options: [
    { key: "racing", label_en: "Racing", label_da: "Løbene" },
    { key: "training", label_en: "Training", label_da: "Træning" },
    { key: "market", label_en: "Market", label_da: "Marked" },
    { key: "forum", label_en: "Forum", label_da: "Forum" },
  ],
};
const pro = {
  key: "pro_contents",
  kind: "multi",
  required: false,
  sort_order: 90,
  label_en: "Pro?",
  label_da: "Pro?",
  options: [
    { key: "compare", label_en: "Compare", label_da: "Sammenlign" },
    { key: "analytics", label_en: "Analytics", label_da: "Analyse" },
    { key: "history", label_en: "History", label_da: "Historik" },
    { key: "badge", label_en: "Badge", label_da: "Mærke" },
  ],
};
const oneThing = { key: "one_thing", kind: "text", required: true, sort_order: 60, label_en: "One thing?", label_da: "Én ting?" };
const wouldPay = {
  key: "pro_would_pay",
  kind: "single",
  required: true,
  sort_order: 110,
  label_en: "Pay?",
  label_da: "Betale?",
  options: [
    { key: "yes", label_en: "Yes", label_da: "Ja" },
    { key: "no", label_en: "No", label_da: "Nej" },
  ],
};
const followUp = { key: "follow_up", kind: "yes_no", required: false, sort_order: 120, label_en: "Follow up?", label_da: "Følge op?" };

// ── Sprog ───────────────────────────────────────────────────────────────────

test("labels følger sproget, EN som fallback for alt der ikke er dansk", () => {
  assert.equal(questionLabel(satisfaction, "en"), "Satisfied?");
  assert.equal(questionLabel(satisfaction, "da"), "Tilfreds?");
  assert.equal(questionLabel(satisfaction, "da-DK"), "Tilfreds?");
  assert.equal(questionLabel(satisfaction, undefined), "Satisfied?");
  assert.equal(questionHelp(satisfaction, "da"), "1 til 5");
  assert.equal(questionHelp(nps, "da"), null, "manglende hjælpetekst er null, ikke undefined");
  assert.equal(optionLabel(axes.options[0], "da"), "Live løb");
});

test("optionGroup følger sproget og er null når en option ikke har en gruppe", () => {
  const grouped = { key: "live_race", group_en: "Racing", group_da: "Løbene", label_en: "Live", label_da: "Live" };
  assert.equal(optionGroup(grouped, "en"), "Racing");
  assert.equal(optionGroup(grouped, "da"), "Løbene");
  assert.equal(optionGroup(grouped, "da-DK"), "Løbene");
  assert.equal(optionGroup(grouped, undefined), "Racing");
  // Bagudkompatibelt: et ældre skema uden group-felter må ikke få overskrifter.
  assert.equal(optionGroup(axes.options[0], "da"), null);
  assert.equal(optionGroup(undefined, "da"), null, "ingen forrige option i listen er ikke en gruppe");
  assert.equal(optionGroup({ key: "x", group_en: "", group_da: "" }, "en"), null);
});

test("scaleFor giver 0-10 til NPS og 1-5 til begge akser", () => {
  assert.deepEqual(scaleFor("scale_0_10"), SCALE_0_10);
  assert.deepEqual(scaleFor("scale_1_5"), SCALE_1_5);
  assert.deepEqual(scaleFor("idea_importance"), SCALE_1_5);
  assert.deepEqual(scaleFor("text"), []);
});

test("sortQuestions sorterer på sort_order og muterer ikke input", () => {
  const input = [worst, nps, axes];
  const sorted = sortQuestions(input);
  assert.deepEqual(sorted.map((q) => q.key), ["nps", "feature_axes", "works_worst"]);
  assert.deepEqual(input.map((q) => q.key), ["works_worst", "nps", "feature_axes"]);
});

// ── Normalisering ───────────────────────────────────────────────────────────

test("skala-svar normaliseres til { score } og 0 tæller som et svar", () => {
  assert.deepEqual(normalizeAnswer(nps, 0), { score: 0 });
  assert.deepEqual(normalizeAnswer(nps, 10), { score: 10 });
  assert.deepEqual(normalizeAnswer(satisfaction, { score: 3 }), { score: 3 });
  assert.equal(normalizeAnswer(nps, null), null);
  assert.equal(normalizeAnswer(nps, undefined), null);
  assert.throws(() => normalizeAnswer(nps, 11), /out of range/);
  assert.throws(() => normalizeAnswer(satisfaction, 0), /out of range/);
  assert.throws(() => normalizeAnswer(satisfaction, 2.5), /out of range/);
});

test("to-akse-gitteret gemmer kun rørte funktioner, og ved ikke er sit eget felt", () => {
  const value = normalizeAnswer(axes, {
    live_race: { idea: 5, importance: 4 },
    youth_teams: { dont_know: true },
    team_looks: { idea: null, importance: null },
  });
  assert.deepEqual(value, {
    ratings: {
      live_race: { idea: 5, importance: 4, dont_know: false },
      youth_teams: { idea: null, importance: null, dont_know: true },
    },
  });
  assert.equal("team_looks" in value.ratings, false, "urørt funktion gemmes ikke");
});

test("to-akse: halvt udfyldt række bevares, ukendte nøgler droppes, ugyldig score kaster", () => {
  assert.deepEqual(normalizeAnswer(axes, { live_race: { idea: 2 } }), {
    ratings: { live_race: { idea: 2, importance: null, dont_know: false } },
  });
  assert.equal(normalizeAnswer(axes, { not_an_option: { idea: 3, importance: 3 } }), null);
  assert.equal(normalizeAnswer(axes, {}), null);
  assert.throws(() => normalizeAnswer(axes, { live_race: { idea: 6, importance: 3 } }), /idea out of range/);
  assert.throws(() => normalizeAnswer(axes, { live_race: { idea: 3, importance: 9 } }), /importance out of range/);
});

test("multi_max3 håndhæver loftet, multi gør ikke, og begge dedupliker", () => {
  assert.deepEqual(normalizeAnswer(worst, ["racing", "training"]), { selected: ["racing", "training"] });
  assert.deepEqual(normalizeAnswer(worst, ["racing", "racing"]), { selected: ["racing"] });
  assert.equal(normalizeAnswer(worst, ["not_an_option"]), null);
  assert.equal(normalizeAnswer(worst, []), null);
  assert.throws(() => normalizeAnswer(worst, ["racing", "training", "market", "forum"]), /at most 3/);
  assert.deepEqual(normalizeAnswer(pro, ["compare", "analytics", "history", "badge"]), {
    selected: ["compare", "analytics", "history", "badge"],
  });
});

test("single og yes_no normaliseres til { choice } og afviser ukendte valg", () => {
  assert.deepEqual(normalizeAnswer(wouldPay, "yes"), { choice: "yes" });
  assert.deepEqual(normalizeAnswer(wouldPay, { choice: "no" }), { choice: "no" });
  assert.equal(normalizeAnswer(wouldPay, null), null);
  assert.throws(() => normalizeAnswer(wouldPay, "maybe"), /not in options/);
  assert.deepEqual(normalizeAnswer(followUp, "no"), { choice: "no" });
  assert.throws(() => normalizeAnswer(followUp, "dunno"), /not in options/);
});

test("fritekst trimmes, tom tekst er intet svar, og længden er begrænset", () => {
  assert.deepEqual(normalizeAnswer(oneThing, "  Live races  "), { text: "Live races" });
  assert.equal(normalizeAnswer(oneThing, "   "), null);
  assert.equal(normalizeAnswer(oneThing, ""), null);
  assert.equal(normalizeAnswer(oneThing, "a".repeat(2000)).text.length, 1000);
});

test("displayTextAnswer bevarer indre og afsluttende mellemrum (kun normalizeAnswer trimmer, ved persist)", () => {
  assert.deepEqual(displayTextAnswer("hej "), { text: "hej " }, "afsluttende mellemrum må ikke forsvinde mens der skrives (#4943-hotfix)");
  assert.deepEqual(displayTextAnswer("to ord"), { text: "to ord" });
  assert.deepEqual(displayTextAnswer("  Live races  "), { text: "  Live races  " });
  assert.equal(displayTextAnswer(""), null);
  assert.equal(displayTextAnswer("a".repeat(2000)).text.length, 1000, "beskæres til TEXT_MAX_LENGTH ligesom normalizeAnswer");
});

test("et fritekst-svar der kun er mellemrum tæller ikke som besvaret, selvom det viste svar ikke er trimmet", () => {
  assert.equal(answeredUnits(oneThing, displayTextAnswer("   ")), 0);
  assert.equal(answeredUnits(oneThing, displayTextAnswer("hej ")), 1);
  assert.equal(answeredUnits(oneThing, null), 0);
  assert.equal(isAnswered(oneThing, displayTextAnswer("   ")), false);
});

test("ukendt spørgsmålstype kaster i stedet for at gemme noget uforståeligt", () => {
  assert.throws(() => normalizeAnswer({ key: "x", kind: "slider" }, 3), /unknown question kind/);
});

// ── Progress ────────────────────────────────────────────────────────────────

test("to-akse-gitteret tæller én enhed pr. funktion, alt andet én", () => {
  assert.equal(progressUnits(axes), 3);
  assert.equal(progressUnits(nps), 1);
  assert.equal(progressUnits(oneThing), 1);
});

test("en to-akse-række tæller først når begge akser er sat, eller ved ikke er valgt", () => {
  assert.equal(answeredUnits(axes, { ratings: { live_race: { idea: 4, importance: null, dont_know: false } } }), 0);
  assert.equal(answeredUnits(axes, { ratings: { live_race: { idea: 4, importance: 2, dont_know: false } } }), 1);
  assert.equal(answeredUnits(axes, { ratings: { live_race: { idea: null, importance: null, dont_know: true } } }), 1);
  assert.equal(answeredUnits(axes, null), 0);
  assert.equal(isAnswered(nps, { score: 0 }), true, "NPS 0 er et svar, ikke et tomt felt");
  assert.equal(isAnswered(nps, null), false);
});

test("computeProgress vægter gitteret efter antal funktioner", () => {
  const questions = [nps, satisfaction, axes, oneThing]; // 1 + 1 + 3 + 1 = 6 enheder
  assert.deepEqual(computeProgress(questions, {}), { answered: 0, total: 6, percent: 0 });
  assert.deepEqual(computeProgress(questions, { nps: { score: 9 } }), { answered: 1, total: 6, percent: 17 });
  assert.deepEqual(
    computeProgress(questions, {
      nps: { score: 9 },
      satisfaction: { score: 4 },
      feature_axes: {
        ratings: {
          live_race: { idea: 5, importance: 5, dont_know: false },
          youth_teams: { idea: null, importance: null, dont_know: true },
          team_looks: { idea: 2, importance: 1, dont_know: false },
        },
      },
      one_thing: { text: "Live races" },
    }),
    { answered: 6, total: 6, percent: 100 }
  );
  assert.deepEqual(computeProgress([], {}), { answered: 0, total: 0, percent: 0 });
  assert.deepEqual(computeProgress(undefined, undefined), { answered: 0, total: 0, percent: 0 });
});

// ── Aflevering ──────────────────────────────────────────────────────────────

test("missingRequired og canSubmit ser kun på påkrævede spørgsmål", () => {
  const questions = [nps, satisfaction, axes, worst, oneThing, wouldPay, followUp];
  assert.deepEqual(missingRequired(questions, {}), [
    "nps",
    "satisfaction",
    "works_worst",
    "one_thing",
    "pro_would_pay",
  ]);
  assert.equal(canSubmit(questions, {}), false);
  const full = {
    nps: { score: 8 },
    satisfaction: { score: 4 },
    works_worst: { selected: ["racing"] },
    one_thing: { text: "Live races" },
    pro_would_pay: { choice: "yes" },
  };
  assert.deepEqual(missingRequired(questions, full), []);
  assert.equal(canSubmit(questions, full), true, "gitteret og de valgfri felter blokerer ikke aflevering");
});

test("buildResponsePayload kræver nøglerne og nægter at skrive et tomt svar", () => {
  const payload = buildResponsePayload({
    surveyId: "s-1",
    userId: "u-1",
    teamId: "t-1",
    questionKey: "nps",
    value: { score: 9 },
  });
  assert.equal(payload.survey_id, "s-1");
  assert.equal(payload.user_id, "u-1");
  assert.equal(payload.team_id, "t-1");
  assert.equal(payload.question_key, "nps");
  assert.deepEqual(payload.value, { score: 9 });
  assert.match(payload.updated_at, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(
    buildResponsePayload({ surveyId: "s", userId: "u", questionKey: "nps", value: { score: 1 } }).team_id,
    null,
    "en manager uden hold må stadig kunne svare"
  );
  assert.throws(() => buildResponsePayload({ userId: "u", questionKey: "nps", value: { score: 1 } }), /required/);
  assert.throws(() => buildResponsePayload({ surveyId: "s", userId: "u", questionKey: "nps", value: null }), /value is required/);
});

// ── Sektioner ───────────────────────────────────────────────────────────────

test("spørgsmål grupperes i sektioner, tomme sektioner udelades", () => {
  // nps er ikke længere en spoergsmaalsnoegle i skemaet (droppet 8/9, #4943);
  // brugt her udelukkende som generisk scale_0_10-fixture, og lander derfor i
  // "other" som ethvert andet ukendt spoergsmaal.
  const sections = groupQuestionsIntoSections([wouldPay, nps, axes, oneThing, satisfaction, worst, fogMore, followUp]);
  assert.deepEqual(
    sections.map((s) => [s.id, s.questions.map((q) => q.key)]),
    [
      ["today", ["satisfaction"]],
      ["problems", ["works_worst"]],
      ["ideas", ["feature_axes"]],
      ["fog", ["fog_more"]],
      ["choices", ["one_thing"]],
      ["pro", ["pro_would_pay"]],
      ["closing", ["follow_up"]],
      ["other", ["nps"]],
    ]
  );
});

// Rækkefølgen er ejer-godkendt 8/9 (v3) og er ikke en detalje: "hvad fungerer
// dårligst" SKAL komme før idéerne, og fog lige efter dem.
test("sektions-rækkefølgen er v3-flowet, og fog ligger lige efter idéerne", () => {
  assert.deepEqual(SECTION_ORDER, ["today", "problems", "ideas", "fog", "choices", "pro", "closing", "other"]);
  assert.equal(sectionForQuestion(fogMore), "fog");
  assert.equal(SECTION_ORDER.indexOf("problems") < SECTION_ORDER.indexOf("ideas"), true);
  assert.equal(SECTION_ORDER.indexOf("fog"), SECTION_ORDER.indexOf("ideas") + 1);
  assert.equal(SECTION_ORDER.indexOf("pro") < SECTION_ORDER.indexOf("closing"), true);
  // "other" er stadig sidst, så et ukendt spørgsmål aldrig skubber flowet.
  assert.equal(SECTION_ORDER.at(-1), "other");
});

test("et ukendt spørgsmål havner i other frem for at forsvinde fra siden", () => {
  const stray = { key: "brand_new", kind: "text", sort_order: 999, label_en: "New", label_da: "Ny" };
  assert.equal(sectionForQuestion(stray), "other");
  const sections = groupQuestionsIntoSections([stray, satisfaction]);
  assert.deepEqual(sections.map((s) => s.id), ["today", "other"]);
  assert.deepEqual(groupQuestionsIntoSections([]), []);
});

test("answersByQuestionKey samler rækker og tåler tomt input", () => {
  assert.deepEqual(
    answersByQuestionKey([
      { question_key: "nps", value: { score: 7 } },
      { question_key: "one_thing", value: { text: "Live races" } },
    ]),
    { nps: { score: 7 }, one_thing: { text: "Live races" } }
  );
  assert.deepEqual(answersByQuestionKey(null), {});
  assert.deepEqual(answersByQuestionKey([null, { value: { score: 1 } }]), {});
});

// ── Dashboard-indgangen ─────────────────────────────────────────────────────

test("luk-krydset på dashboard-kortet husker i 3 dage pr. skema", () => {
  const now = 1_757_000_000_000;
  assert.equal(INVITE_DISMISS_DAYS, 3);
  assert.equal(inviteDismissKey("2026-09-features"), "cz-dashboard-survey-dismissed:2026-09-features");
  assert.notEqual(inviteDismissKey("a"), inviteDismissKey("b"), "et nyt skema arver ikke et gammelt luk");

  const until = inviteDismissedUntil(now);
  assert.equal(until - now, 3 * 24 * 60 * 60 * 1000);
  assert.equal(isInviteDismissed(String(until), now), true);
  assert.equal(isInviteDismissed(String(until), until - 1), true);
  assert.equal(isInviteDismissed(String(until), until + 1), false, "efter 3 dage vises kortet igen");
});

test("et åbent skema vises som formular for alle, admin eller ej", () => {
  assert.equal(resolveSurveyView({ status: "open", isAdmin: false }), "open");
  assert.equal(resolveSurveyView({ status: "open", isAdmin: true }), "open");
});

test("en kladde er preview for admins og lukket for alle andre", () => {
  assert.equal(resolveSurveyView({ status: "draft", isAdmin: true }), "preview");
  assert.equal(resolveSurveyView({ status: "draft", isAdmin: false }), "closed");
  // Et manglende eller utydeligt admin-svar må ALDRIG åbne kladden: RLS
  // beskytter indholdet, men UI'et skal heller ikke antyde at det findes.
  assert.equal(resolveSurveyView({ status: "draft" }), "closed");
  assert.equal(resolveSurveyView({ status: "draft", isAdmin: "true" }), "closed");
  assert.equal(resolveSurveyView({ status: "draft", isAdmin: null }), "closed");
});

test("et lukket eller ukendt skema er lukket, også for en admin", () => {
  assert.equal(resolveSurveyView({ status: "closed", isAdmin: true }), "closed");
  assert.equal(resolveSurveyView({ status: "closed", isAdmin: false }), "closed");
  assert.equal(resolveSurveyView({ status: "archived", isAdmin: true }), "closed");
  assert.equal(resolveSurveyView({ isAdmin: true }), "closed");
  assert.equal(resolveSurveyView(), "closed");
});

test("et tomt eller ulæseligt luk-flag betyder at kortet vises", () => {
  assert.equal(isInviteDismissed(null), false);
  assert.equal(isInviteDismissed(undefined), false);
  assert.equal(isInviteDismissed(""), false);
  assert.equal(isInviteDismissed("ja tak"), false);
});
