import test from "node:test";
import assert from "node:assert/strict";

const {
  ordinal,
  buildPersonalResultText,
  capitalize,
  selectHeadlineMoment,
  buildHeadlineText,
  summarizeRaceResultRows,
  buildRaceResultNarrative,
  buildStageResultNarrative,
} = await import("./raceNarrativeNotification.js");

// ─── ordinal ────────────────────────────────────────────────────────────────

test("ordinal: standard suffixes", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(22), "22nd");
  assert.equal(ordinal(23), "23rd");
});

test("ordinal: 11th/12th/13th exception (not 11st/12nd/13rd)", () => {
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(13), "13th");
  assert.equal(ordinal(111), "111th");
  assert.equal(ordinal(112), "112th");
  assert.equal(ordinal(113), "113th");
});

// ─── buildPersonalResultText ────────────────────────────────────────────────

test("buildPersonalResultText: single rank", () => {
  assert.equal(buildPersonalResultText([4]), "you placed 4th");
});

test("buildPersonalResultText: two ranks joined with 'and'", () => {
  assert.equal(buildPersonalResultText([5, 2]), "you placed 2nd and 5th");
});

test("buildPersonalResultText: three+ ranks use a comma list", () => {
  assert.equal(buildPersonalResultText([11, 2, 5]), "you placed 2nd, 5th and 11th");
});

test("buildPersonalResultText: empty/invalid ranks degrade to null (no invented text)", () => {
  assert.equal(buildPersonalResultText([]), null);
  assert.equal(buildPersonalResultText(null), null);
  assert.equal(buildPersonalResultText([null, undefined]), null);
});

test("capitalize: uppercases only the first letter", () => {
  assert.equal(capitalize("you placed 2nd"), "You placed 2nd");
  assert.equal(capitalize(""), "");
  assert.equal(capitalize(null), null);
});

// ─── selectHeadlineMoment (1:1-port af frontend/src/lib/raceReport.js) ──────

const m = (key, extra = {}) => ({ moment_key: key, significance: 50, rider_ids: [], params: {}, ...extra });

test("selectHeadlineMoment: intet vinder-moment => null (aerlig degradering)", () => {
  assert.equal(selectHeadlineMoment([]), null);
  assert.equal(selectHeadlineMoment([m("team_day")]), null);
});

test("selectHeadlineMoment: final_gc vinder altid over alt andet", () => {
  const moments = [
    m("sprint_win", { rider_ids: ["r1"] }),
    m("gc_takeover", { significance: 99, rider_ids: ["r2"] }),
    m("final_gc", { rider_ids: ["r3"] }),
  ];
  assert.equal(selectHeadlineMoment(moments).moment_key, "final_gc");
});

test("selectHeadlineMoment: gc_takeover slaar vindermomentet naar signifikansen er hoejere", () => {
  const moments = [
    m("sprint_win", { significance: 50, rider_ids: ["r1"] }),
    m("gc_takeover", { significance: 70, rider_ids: ["r2"] }),
  ];
  assert.equal(selectHeadlineMoment(moments).moment_key, "gc_takeover");
});

test("selectHeadlineMoment: lavt-signifikans gc_takeover taber til vindermomentet", () => {
  const moments = [
    m("sprint_win", { significance: 50, rider_ids: ["r1"] }),
    m("gc_takeover", { significance: 10, rider_ids: ["r2"] }),
  ];
  assert.equal(selectHeadlineMoment(moments).moment_key, "sprint_win");
});

test("selectHeadlineMoment: breakaway_survived for SAMME rytter som vinderen vaelges naar signifikansen er hoejest", () => {
  const moments = [
    m("solo_win", { significance: 55, rider_ids: ["r1"] }),
    m("breakaway_survived", { significance: 55, rider_ids: ["r1"] }),
  ];
  assert.equal(selectHeadlineMoment(moments).moment_key, "breakaway_survived");
});

test("selectHeadlineMoment: gc_takeover slaar breakaway_survived for samme rytter naar signifikansen er hoejere", () => {
  const moments = [
    m("solo_win", { significance: 55, rider_ids: ["r1"] }),
    m("breakaway_survived", { significance: 55, rider_ids: ["r1"] }),
    m("gc_takeover", { significance: 90, rider_ids: ["r1"] }),
  ];
  assert.equal(selectHeadlineMoment(moments).moment_key, "gc_takeover");
});

// ─── buildHeadlineText ──────────────────────────────────────────────────────

const riderName = (id) => ({ r1: "Krogh", r2: "Vingegaard" }[id] || "the rider");

test("buildHeadlineText: sprint_win", () => {
  const moment = { moment_key: "sprint_win", params: { riderId: "r1" } };
  assert.equal(buildHeadlineText(moment, { riderName }), "Krogh takes the sprint");
});

test("buildHeadlineText: close_win interpolates margin", () => {
  const moment = { moment_key: "close_win", params: { riderId: "r1", gapSeconds: 65 } };
  assert.equal(buildHeadlineText(moment, { riderName }), "Krogh wins by 1:05");
});

test("buildHeadlineText: solo_win", () => {
  const moment = { moment_key: "solo_win", params: { riderId: "r2", gapSeconds: 30 } };
  assert.equal(buildHeadlineText(moment, { riderName }), "Vingegaard rides away from the field");
});

test("buildHeadlineText: breakaway_survived", () => {
  const moment = { moment_key: "breakaway_survived", params: { riderId: "r1" } };
  assert.equal(buildHeadlineText(moment, { riderName }), "The breakaway makes it: Krogh wins");
});

test("buildHeadlineText: gc_takeover", () => {
  const moment = { moment_key: "gc_takeover", params: { riderId: "r2" } };
  assert.equal(buildHeadlineText(moment, { riderName }), "Vingegaard takes the race lead");
});

test("buildHeadlineText: final_gc bruger raceName + foerste riderId", () => {
  const moment = { moment_key: "final_gc", params: { riderIds: ["r1", "r2"] } };
  assert.equal(buildHeadlineText(moment, { riderName, raceName: "Vuelta a Castilla" }), "Krogh wins Vuelta a Castilla");
});

test("buildHeadlineText: ukendt moment_key => null (aerlig degradering)", () => {
  assert.equal(buildHeadlineText({ moment_key: "team_day", params: {} }, { riderName }), null);
  assert.equal(buildHeadlineText(null, { riderName }), null);
});

// ─── summarizeRaceResultRows ────────────────────────────────────────────────

test("summarizeRaceResultRows: rytternavne fra ALLE raekker, ranks kun for menneske/ikke-frosne hold", () => {
  const rows = [
    { rider_id: "r1", rider_name: "Krogh", rank: 1, team: { user_id: "u1", is_ai: false, is_frozen: false } },
    { rider_id: "r2", rider_name: "AI Rider", rank: 2, team: { user_id: "u-ai", is_ai: true, is_frozen: false } },
    { rider_id: "r3", rider_name: "Frozen Rider", rank: 3, team: { user_id: "u-frozen", is_ai: false, is_frozen: true } },
    { rider_id: "r4", rider_name: "Second Rider", rank: 5, team: { user_id: "u1", is_ai: false, is_frozen: false } },
  ];
  const { riderNameById, ranksByUser } = summarizeRaceResultRows(rows);
  assert.equal(riderNameById.get("r1"), "Krogh");
  assert.equal(riderNameById.get("r2"), "AI Rider", "rytternavne indeholder ogsaa AI-holds ryttere (rubrikkens vinder kan vaere paa et AI-hold)");
  assert.deepEqual(ranksByUser.get("u1"), [1, 5], "flere ryttere paa samme menneske-hold akkumuleres");
  assert.equal(ranksByUser.has("u-ai"), false, "AI-hold tælles ikke som en notificerbar manager");
  assert.equal(ranksByUser.has("u-frozen"), false, "frosne hold tælles ikke som en notificerbar manager");
});

// ─── buildRaceResultNarrative / buildStageResultNarrative (data-opslag) ────

function makeMomentsSupabase({ moments = [], resultRows = [], momentsError = null, resultsError = null } = {}) {
  return {
    from(table) {
      if (table === "race_stage_moments") {
        return {
          select() {
            return {
              eq(col, val) {
                const filters = { [col]: val };
                return {
                  eq(col2, val2) {
                    filters[col2] = val2;
                    return Promise.resolve({
                      data: momentsError ? null : moments.filter((m2) =>
                        Object.entries(filters).every(([k, v]) => (k === "stage_number" ? (m2.stage_number ?? 1) === v : true))),
                      error: momentsError,
                    });
                  },
                  then(resolve) {
                    // race-result (final) path only filters on race_id -> no second .eq
                    resolve({ data: momentsError ? null : moments, error: momentsError });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "race_results") {
        return {
          select() {
            const filters = {};
            const builder = {
              eq(col, val) {
                filters[col] = val;
                return builder;
              },
              then(resolve) {
                const data = resultsError ? null : resultRows.filter((r) =>
                  Object.entries(filters).every(([k, v]) => {
                    if (k === "race_id") return true; // not carried on row fixtures
                    if (k === "stage_number") return (r.stage_number ?? 1) === v;
                    if (k === "result_type") return r.result_type === v;
                    return true;
                  }));
                resolve({ data, error: resultsError });
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("buildRaceResultNarrative: null uden supabase/race.id (ingen krasj)", async () => {
  assert.equal(await buildRaceResultNarrative({ supabase: null, race: { id: "r1" } }), null);
  assert.equal(await buildRaceResultNarrative({ supabase: {}, race: {} }), null);
});

test("buildRaceResultNarrative: ingen momenter => null (gammelt/PCM-loeb, aerlig degradering)", async () => {
  const supabase = makeMomentsSupabase({ moments: [] });
  const result = await buildRaceResultNarrative({ supabase, race: { id: "race-1", name: "Vuelta a Castilla" } });
  assert.equal(result, null);
});

test("buildRaceResultNarrative: fejlende query => null, ikke kast", async () => {
  const supabase = makeMomentsSupabase({ momentsError: new Error("boom") });
  const result = await buildRaceResultNarrative({ supabase, race: { id: "race-1" } });
  assert.equal(result, null);
});

test("buildRaceResultNarrative: bygger rubrik fra sidste etapes momenter + ranks pr. manager", async () => {
  const moments = [
    { stage_number: 1, moment_key: "sprint_win", significance: 50, params: { riderId: "r-old" }, rider_ids: ["r-old"] },
    { stage_number: 2, moment_key: "final_gc", significance: 90, params: { riderIds: ["r-krogh"] }, rider_ids: ["r-krogh"] },
    { stage_number: 2, moment_key: "sprint_win", significance: 50, params: { riderId: "r-krogh" }, rider_ids: ["r-krogh"] },
  ];
  const resultRows = [
    { rider_id: "r-krogh", rider_name: "Krogh", rank: 1, result_type: "gc", team: { user_id: "u1", is_ai: false, is_frozen: false } },
    { rider_id: "r-second", rider_name: "Second Rider", rank: 5, result_type: "gc", team: { user_id: "u1", is_ai: false, is_frozen: false } },
  ];
  const supabase = makeMomentsSupabase({ moments, resultRows });
  const result = await buildRaceResultNarrative({ supabase, race: { id: "race-1", name: "Vuelta a Castilla" } });
  assert.ok(result, "narrativ bygget");
  assert.equal(result.headlineText, "Krogh wins Vuelta a Castilla", "final_gc fra stage 2 (ikke stage 1's sprint_win)");
  assert.deepEqual(result.ranksByUser.get("u1"), [1, 5]);
});

test("buildStageResultNarrative: mangler stageNumber => null", async () => {
  assert.equal(await buildStageResultNarrative({ supabase: {}, race: { id: "r1" }, stageNumber: null }), null);
});

test("buildStageResultNarrative: bygger rubrik for DENNE etape", async () => {
  const moments = [
    { stage_number: 3, moment_key: "close_win", significance: 50, params: { riderId: "r-krogh", gapSeconds: 8 }, rider_ids: ["r-krogh"] },
  ];
  const resultRows = [
    { rider_id: "r-krogh", rider_name: "Krogh", rank: 2, stage_number: 3, result_type: "stage", team: { user_id: "u1", is_ai: false, is_frozen: false } },
  ];
  const supabase = makeMomentsSupabase({ moments, resultRows });
  const result = await buildStageResultNarrative({ supabase, race: { id: "race-1" }, stageNumber: 3 });
  assert.equal(result.headlineText, "Krogh wins by 0:08");
  assert.deepEqual(result.ranksByUser.get("u1"), [2]);
});
