import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSurveyResults,
  segmentValue,
  copenhagenDate,
  dateRange,
  avg2,
  pct1,
  SEGMENT_DIMENSIONS,
} from "./surveyResults.js";

// #4943 · Aggregeringen bag /api/admin/surveys/:slug/results.
// Fixturen er et miniature af det aegte skema: een skala, eet flervalg, eet
// enkeltvalg, to-akse-gitteret og een fritekst, med tre managere fordelt paa
// to divisioner og to sprog.

const SURVEY = {
  id: "survey-1",
  slug: "2026-09-features",
  title_en: "What should I build next?",
  title_da: "Hvad skal jeg bygge næste gang?",
  status: "open",
  opens_at: "2026-09-08T12:15:00Z",
  closes_at: null,
};

const QUESTIONS = [
  { key: "satisfaction", kind: "scale_1_5", sort_order: 10, label_en: "Satisfaction", label_da: "Tilfredshed", required: true },
  {
    key: "works_worst", kind: "multi_max3", sort_order: 20, label_en: "Worst", label_da: "Dårligst", required: true,
    options: [
      { key: "racing", label_en: "Racing", label_da: "Løbene" },
      { key: "mobile", label_en: "Phone", label_da: "Telefonen" },
      { key: "forum", label_en: "Forum", label_da: "Forummet" },
    ],
  },
  { key: "one_thing", kind: "text", sort_order: 30, label_en: "One thing", label_da: "Én ting", required: true },
  {
    key: "feature_axes", kind: "idea_importance", sort_order: 40, label_en: "Ideas", label_da: "Idéerne",
    options: [
      { key: "live_race", group_en: "Racing", group_da: "Løbene", label_en: "Live race", label_da: "Live-løb" },
      { key: "youth_teams", group_en: "Youth", group_da: "Ungdom", label_en: "Youth", label_da: "Ungdom" },
      { key: "team_looks", group_en: "The club", group_da: "Klubben", label_en: "Looks", label_da: "Udseende" },
    ],
  },
  {
    key: "fog_more", kind: "single", sort_order: 50, label_en: "Fog", label_da: "Tåge", required: true,
    options: [
      { key: "nothing", label_en: "Nothing", label_da: "Ikke mere" },
      { key: "a_bit", label_en: "A bit", label_da: "Lidt mere" },
      { key: "a_lot", label_en: "A lot", label_da: "Meget mere" },
    ],
  },
  { key: "follow_up", kind: "yes_no", sort_order: 60, label_en: "Follow up", label_da: "Følge op" },
];

const TEAMS = {
  "team-a": { division: 1, name: "Aquila Racing" },
  "team-b": { division: 3, name: "Bjergholdet" },
  "team-c": { division: 3, name: "Cobble Crew" },
};

const NOW = Date.parse("2026-09-10T09:00:00Z");

const USERS = {
  "user-a": { language: "da", last_seen: "2026-09-10T07:00:00Z" },
  "user-b": { language: "en", last_seen: "2026-08-01T07:00:00Z" },
  "user-c": { language: null, browser_language: "da-DK", last_seen: null },
};

const r = (user_id, team_id, question_key, value, created_at) => ({
  user_id, team_id, question_key, value, created_at, updated_at: created_at,
});

const RESPONSES = [
  r("user-a", "team-a", "satisfaction", { score: 5 }, "2026-09-08T13:00:00Z"),
  r("user-a", "team-a", "works_worst", { selected: ["racing", "mobile"] }, "2026-09-08T13:01:00Z"),
  r("user-a", "team-a", "one_thing", { text: "Live races" }, "2026-09-08T13:02:00Z"),
  r("user-a", "team-a", "fog_more", { choice: "a_bit" }, "2026-09-08T13:03:00Z"),
  r("user-a", "team-a", "follow_up", { choice: "yes" }, "2026-09-08T13:04:00Z"),
  r("user-a", "team-a", "feature_axes", {
    ratings: {
      live_race: { idea: 5, importance: 5, dont_know: false },
      youth_teams: { idea: 2, importance: 1, dont_know: false },
      team_looks: { idea: null, importance: null, dont_know: true },
    },
  }, "2026-09-08T13:05:00Z"),

  r("user-b", "team-b", "satisfaction", { score: 3 }, "2026-09-09T08:00:00Z"),
  r("user-b", "team-b", "works_worst", { selected: ["racing"] }, "2026-09-09T08:01:00Z"),
  r("user-b", "team-b", "one_thing", { text: "Better mobile" }, "2026-09-09T08:02:00Z"),
  r("user-b", "team-b", "fog_more", { choice: "nothing" }, "2026-09-09T08:03:00Z"),
  r("user-b", "team-b", "feature_axes", {
    ratings: {
      live_race: { idea: 4, importance: 3, dont_know: false },
      youth_teams: { idea: 1, importance: 2, dont_know: false },
    },
  }, "2026-09-09T08:04:00Z"),

  r("user-c", "team-c", "satisfaction", { score: 4 }, "2026-09-09T20:00:00Z"),
  r("user-c", "team-c", "feature_axes", {
    ratings: { live_race: { idea: 3, importance: 4, dont_know: false } },
  }, "2026-09-09T20:01:00Z"),
  // Et svar paa en noegle skemaet ikke laengere kender.
  r("user-c", "team-c", "nps", { score: 8 }, "2026-09-09T20:02:00Z"),
];

const COMPLETIONS = [
  { user_id: "user-a", completed_at: "2026-09-08T13:10:00Z", seconds_spent: 300 },
  { user_id: "user-b", completed_at: "2026-09-09T08:10:00Z", seconds_spent: 420 },
];

function build(overrides = {}) {
  return buildSurveyResults({
    survey: SURVEY,
    questions: QUESTIONS,
    responses: RESPONSES,
    completions: COMPLETIONS,
    invitedCount: 240,
    teamsById: TEAMS,
    usersById: USERS,
    now: NOW,
    ...overrides,
  });
}

const q = (results, key) => results.questions.find((x) => x.key === key);

// ── Regne-hjaelpere ─────────────────────────────────────────────────────────

test("avg2/pct1: null frem for 0 naar der intet er at regne paa", () => {
  assert.equal(avg2(0, 0), null);
  assert.equal(pct1(3, 0), null);
  assert.equal(avg2(7, 2), 3.5);
  assert.equal(pct1(1, 3), 33.3);
});

test("copenhagenDate: sen aften i UTC hoerer til den danske dag, ikke UTC-dagen", () => {
  // 22:30 UTC den 8/9 er 00:30 dansk tid den 9/9 (CEST, UTC+2).
  assert.equal(copenhagenDate("2026-09-08T22:30:00Z"), "2026-09-09");
  assert.equal(copenhagenDate("2026-09-08T11:00:00Z"), "2026-09-08");
  assert.equal(copenhagenDate(null), null);
  assert.equal(copenhagenDate("ikke en dato"), null);
});

test("dateRange: udfylder hullerne saa bar-charten ikke springer dage over", () => {
  assert.deepEqual(dateRange("2026-09-08", "2026-09-11"), [
    "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  ]);
  assert.deepEqual(dateRange(null, "2026-09-11"), []);
});

// ── Segmenter ───────────────────────────────────────────────────────────────

test("segmentValue: division kommer fra HOLDET, sprog og aktivitet fra KONTOEN", () => {
  const ctx = { teamsById: TEAMS, usersById: USERS, now: NOW };
  assert.equal(segmentValue("division", { team_id: "team-b" }, ctx), "3");
  assert.equal(segmentValue("division", { team_id: null }, ctx), "unknown");
  assert.equal(segmentValue("language", { user_id: "user-b" }, ctx), "en");
  // users.language er null -> browser_language bruges som fallback (SURVEY_SYSTEM §3).
  assert.equal(segmentValue("language", { user_id: "user-c" }, ctx), "da");
  assert.equal(segmentValue("active", { user_id: "user-a" }, ctx), "active");
  assert.equal(segmentValue("active", { user_id: "user-b" }, ctx), "lapsed");
  assert.equal(segmentValue("active", { user_id: "user-c" }, ctx), "unknown");
  assert.equal(segmentValue("ukendt-dimension", { user_id: "user-a" }, ctx), "unknown");
});

test("SEGMENT_DIMENSIONS er de tre fladen tilbyder", () => {
  assert.deepEqual(SEGMENT_DIMENSIONS, ["division", "language", "active"]);
});

// ── Totaler og tidslinje ────────────────────────────────────────────────────

test("totals: startede taeller BRUGERE (ikke svar-raekker), og de to procenter er forskellige spoergsmaal", () => {
  const out = build();
  assert.equal(out.totals.invited, 240);
  assert.equal(out.totals.started, 3);
  assert.equal(out.totals.completed, 2);
  assert.equal(out.totals.startedPct, 1.3);   // 3/240
  assert.equal(out.totals.completedPct, 0.8); // 2/240
  assert.equal(out.totals.finishPct, 66.7);   // 2/3
  assert.equal(out.totals.avgMinutes, 6);     // (300+420)/2 = 360s
});

test("totals: tomt skema giver 0/null, ikke 0 %", () => {
  const out = build({ responses: [], completions: [], invitedCount: 0 });
  assert.equal(out.totals.started, 0);
  assert.equal(out.totals.startedPct, null);
  assert.equal(out.totals.finishPct, null);
  assert.equal(out.totals.avgMinutes, null);
  assert.deepEqual(out.timeline, []);
  assert.equal(q(out, "satisfaction").avg, null);
});

test("timeline: en manager taelles paa den dag han BEGYNDTE, og dagene er sammenhaengende", () => {
  const out = build();
  assert.deepEqual(out.timeline, [
    { date: "2026-09-08", started: 1, completed: 1 },
    { date: "2026-09-09", started: 2, completed: 1 },
  ]);
});

test("orphanQuestionKeys: svar paa en noegle skemaet ikke kender tabes ikke tavst", () => {
  assert.deepEqual(build().orphanQuestionKeys, ["nps"]);
});

// ── Spoergsmaals-typer ──────────────────────────────────────────────────────

test("scale: fordeling over hele skalaen plus gennemsnit", () => {
  const s = q(build(), "satisfaction");
  assert.equal(s.n, 3);
  assert.equal(s.avg, 4);
  assert.deepEqual(s.distribution.map((d) => d.count), [0, 0, 1, 1, 1]);
  assert.equal(s.distribution[4].pct, 33.3);
});

test("multi: pct er andel af DEM DER SVAREDE, og listen er sorteret efter flest", () => {
  const w = q(build(), "works_worst");
  assert.equal(w.n, 2);
  assert.equal(w.picks, 3);
  assert.equal(w.options[0].key, "racing");
  assert.equal(w.options[0].count, 2);
  assert.equal(w.options[0].pct, 100);
  assert.equal(w.options[1].key, "mobile");
  assert.equal(w.options[2].count, 0);
});

test("multi: samme valg to gange i een raekke taeller een gang", () => {
  const out = build({
    responses: [r("user-a", "team-a", "works_worst", { selected: ["racing", "racing"] }, "2026-09-08T13:00:00Z")],
    completions: [],
  });
  const w = q(out, "works_worst");
  assert.equal(w.n, 1);
  assert.equal(w.picks, 1);
  assert.equal(w.options[0].count, 1);
});

test("single/yes_no: fordeling pr. valg, og yes_no faar sine to faste valg uden options i databasen", () => {
  const out = build();
  const fog = q(out, "fog_more");
  assert.equal(fog.n, 2);
  assert.deepEqual(fog.options.map((o) => [o.key, o.count]), [["nothing", 1], ["a_bit", 1], ["a_lot", 0]]);

  const follow = q(out, "follow_up");
  assert.deepEqual(follow.options.map((o) => o.key), ["yes", "no"]);
  assert.equal(follow.options[0].count, 1);
});

test("single: et valg uden for options taelles ikke med, men rapporteres som orphan", () => {
  const out = build({
    responses: [r("user-a", "team-a", "fog_more", { choice: "hvad_som_helst" }, "2026-09-08T13:00:00Z")],
    completions: [],
  });
  const fog = q(out, "fog_more");
  assert.equal(fog.n, 0);
  assert.deepEqual(fog.orphanKeys, ["hvad_som_helst"]);
});

test("idea_importance: prioritet = idé x vigtigt, ved-ikke staar UDEN for gennemsnittet, veto er andelen paa 1-2", () => {
  const axes = q(build(), "feature_axes");
  assert.equal(axes.n, 3);

  const live = axes.options.find((o) => o.key === "live_race");
  assert.equal(live.n, 3);
  assert.equal(live.avgIdea, 4);         // (5+4+3)/3
  assert.equal(live.avgImportance, 4);   // (5+3+4)/3
  assert.equal(live.priority, 16);
  assert.equal(live.vetoPct, 0);
  assert.equal(live.rank, 1);
  assert.equal(live.group_da, "Løbene");

  const youth = axes.options.find((o) => o.key === "youth_teams");
  assert.equal(youth.n, 2);
  assert.equal(youth.avgIdea, 1.5);
  assert.equal(youth.avgImportance, 1.5);
  assert.equal(youth.priority, 2.25);
  assert.equal(youth.vetoPct, 100);
  assert.equal(youth.rank, 2);

  // team_looks fik kun et "ved ikke": ingen gennemsnit, men andelen er 100 %.
  const looks = axes.options.find((o) => o.key === "team_looks");
  assert.equal(looks.n, 0);
  assert.equal(looks.dontKnow, 1);
  assert.equal(looks.dontKnowPct, 100);
  assert.equal(looks.avgIdea, null);
  assert.equal(looks.priority, null);
  assert.equal(looks.rank, null);
});

test("idea_importance: en halv raekke (kun den ene akse) taeller ikke i gennemsnittet", () => {
  const out = build({
    responses: [r("user-a", "team-a", "feature_axes", {
      ratings: { live_race: { idea: 5, importance: null, dont_know: false } },
    }, "2026-09-08T13:00:00Z")],
    completions: [],
  });
  const live = q(out, "feature_axes").options.find((o) => o.key === "live_race");
  assert.equal(live.n, 0);
  assert.equal(live.avgIdea, null);
});

test("idea_importance: options bevarer den redaktionelle raekkefoelge (gruppering), rang staar som felt", () => {
  const axes = q(build(), "feature_axes");
  assert.deepEqual(axes.options.map((o) => o.key), ["live_race", "youth_teams", "team_looks"]);
});

test("text: nyeste foerst, med hold, division og sprog men uden email/brugernavn", () => {
  const one = q(build(), "one_thing");
  assert.equal(one.n, 2);
  assert.equal(one.answers[0].text, "Better mobile");
  assert.equal(one.answers[0].teamName, "Bjergholdet");
  assert.equal(one.answers[0].division, 3);
  assert.equal(one.answers[0].language, "en");
  assert.equal(one.answers[0].active, "lapsed");
  assert.ok(!("email" in one.answers[0]));
  assert.ok(!("user_id" in one.answers[0]));
});

test("text: tomme og whitespace-svar tages ikke med", () => {
  const out = build({
    responses: [
      r("user-a", "team-a", "one_thing", { text: "   " }, "2026-09-08T13:00:00Z"),
      r("user-b", "team-b", "one_thing", { text: "  Rigtigt svar " }, "2026-09-08T14:00:00Z"),
    ],
    completions: [],
  });
  const one = q(out, "one_thing");
  assert.equal(one.n, 1);
  assert.equal(one.answers[0].text, "Rigtigt svar");
});

// ── Segmentering ────────────────────────────────────────────────────────────

test("uden segment: ingen bySegment-blokke", () => {
  const out = build();
  assert.equal(out.segment, null);
  assert.equal(out.segmentValues, null);
  assert.equal(q(out, "satisfaction").bySegment, null);
});

test("ukendt segment-navn falder tilbage til ingen segmentering", () => {
  const out = build({ segment: "holdfarve" });
  assert.equal(out.segment, null);
  assert.equal(out.segmentValues, null);
});

test("segment=division: gennemsnit pr. division, og oversigten taeller brugere ikke raekker", () => {
  const out = build({ segment: "division" });
  assert.equal(out.segment, "division");
  assert.deepEqual(out.segmentValues, [
    { segment: "1", started: 1 },
    { segment: "3", started: 2 },
  ]);
  const s = q(out, "satisfaction").bySegment;
  assert.deepEqual(s, [
    { segment: "1", n: 1, avg: 5 },
    { segment: "3", n: 2, avg: 3.5 },
  ]);
});

test("segment=language: enkeltvalg tælles pr. segment", () => {
  const fog = q(build({ segment: "language" }), "fog_more").bySegment;
  assert.deepEqual(fog, [
    { segment: "da", n: 1, counts: { a_bit: 1 } },
    { segment: "en", n: 1, counts: { nothing: 1 } },
  ]);
});

test("segment=active: idé-gitteret skjuler segmenter under tre svar (stoej, ikke et segment)", () => {
  const out = build({ segment: "active" });
  const axes = q(out, "feature_axes").bySegment;
  // Ingen af de tre grupper naar 3 svar pr. option i fixturen.
  for (const bucket of axes) assert.deepEqual(bucket.options, []);

  // Med tre aktive managere paa samme idé kommer den igennem.
  const many = buildSurveyResults({
    survey: SURVEY,
    questions: QUESTIONS,
    responses: ["user-a", "user-a2", "user-a3"].map((id, i) => r(
      id, "team-a", "feature_axes",
      { ratings: { live_race: { idea: 5, importance: 4, dont_know: false } } },
      `2026-09-${String(8 + i).padStart(2, "0")}T10:00:00Z`,
    )),
    completions: [],
    invitedCount: 240,
    teamsById: TEAMS,
    usersById: {
      "user-a": USERS["user-a"], "user-a2": USERS["user-a"], "user-a3": USERS["user-a"],
    },
    segment: "active",
    now: NOW,
  });
  const active = q(many, "feature_axes").bySegment.find((b) => b.segment === "active");
  assert.equal(active.options.length, 1);
  assert.equal(active.options[0].key, "live_race");
  assert.equal(active.options[0].priority, 20);
});

test("segmenter sorteres med unknown sidst", () => {
  const out = build({
    segment: "division",
    responses: [
      ...RESPONSES,
      r("user-d", null, "satisfaction", { score: 1 }, "2026-09-09T21:00:00Z"),
    ],
  });
  assert.deepEqual(out.segmentValues.map((s) => s.segment), ["1", "3", "unknown"]);
});

// ── Payloadens form ─────────────────────────────────────────────────────────

test("survey-blokken baerer titel og status, og spoergsmaalene kommer i sort_order", () => {
  const out = build();
  assert.equal(out.survey.slug, "2026-09-features");
  assert.equal(out.survey.status, "open");
  assert.deepEqual(out.questions.map((x) => x.key), [
    "satisfaction", "works_worst", "one_thing", "feature_axes", "fog_more", "follow_up",
  ]);
});

test("uden survey-raekke returneres null i stedet for at kaste", () => {
  const out = buildSurveyResults({ survey: null, questions: [], responses: [] });
  assert.equal(out.survey, null);
  assert.deepEqual(out.questions, []);
});
