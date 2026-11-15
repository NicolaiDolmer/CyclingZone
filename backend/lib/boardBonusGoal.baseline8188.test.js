// #8188 · Bonusmålets udgangstal (baseline) talte monument-podier fra ALLE
// sæsoner, mens visning og evaluering kun tæller indeværende plan-cyklus.
//
// Rodårsag: computeBonusGoalBaseline kaldte loadGoalContextForBoard uden
// planStartSeasonNumber, og loadCompletedOneYearBoard hentede ikke
// plan_start_season_number. Uden den springes cyklusfilteret på
// board_plan_snapshots over, og 1yr-boardet genbruges sæson efter sæson, så
// alle tidligere sæsoners snapshots kom med i podie-optællingen. Fremdrift =
// sæsonens podier minus en for høj baseline = fast på 0.
//
// Testene her kører den ÆGTE loadGoalContextForBoard (ikke en stub) mod en
// fake der forstår de indlejrede race-filtre, så både baseline-stien og
// evaluerings-stien tæller over præcis samme rækker.

import test from "node:test";
import assert from "node:assert/strict";

import { applyAcceptedBonusGoal, computeBonusGoalBaseline } from "./boardBonusGoal.js";
import { loadGoalContextForBoard } from "./boardGoalContext.js";
import { evaluateGoalProgress } from "./boardGoals.js";

// ── Fake-supabase med indlejrede kolonner ("races.season_id") ────────────────
function readPath(row, path) {
  return String(path).split(".").reduce((value, key) => (value == null ? undefined : value[key]), row);
}

// Splitter en PostgREST-select paa kommaer i yderste niveau, saa
// "rank, races!inner(season_id, squad)" bliver to felter.
function splitTopLevel(columns) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of String(columns)) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Returnerer KUN de valgte kolonner (som PostgREST), saa en kolonne der
// mangler i select'en ogsaa mangler i resultatet. Indlejrede relationer
// ("races!inner(...)", "team:team_id(...)") beholdes hele.
function projectRow(row, columns) {
  if (columns == null || String(columns).trim() === "*") return { ...row };
  const out = {};
  for (const item of splitTopLevel(columns)) {
    const head = item.includes("(") ? item.slice(0, item.indexOf("(")) : item;
    const [aliasPart, sourcePart] = head.includes(":") ? head.split(":") : [head, head];
    const key = aliasPart.split("!")[0].trim();
    const source = sourcePart.split("!")[0].trim();
    out[key] = row[key] !== undefined ? row[key] : row[source];
  }
  return out;
}

function makeQueryBuilder(rows, { mode = "select", patch = null, columns = null } = {}) {
  let filtered = [...rows];
  let selected = columns;
  const keep = (predicate) => {
    filtered = filtered.filter(predicate);
    return builder;
  };
  const builder = {
    eq: (col, value) => keep((r) => readPath(r, col) === value),
    neq: (col, value) => keep((r) => readPath(r, col) !== value),
    in: (col, values) => keep((r) => values.includes(readPath(r, col))),
    gte: (col, value) => keep((r) => readPath(r, col) != null && readPath(r, col) >= value),
    lte: (col, value) => keep((r) => readPath(r, col) != null && readPath(r, col) <= value),
    is: (col, value) => keep((r) => (value === null ? readPath(r, col) == null : readPath(r, col) === value)),
    or: () => builder,
    order(col, opts = {}) {
      const ascending = opts.ascending !== false;
      filtered = [...filtered].sort((a, b) => {
        const av = readPath(a, col);
        const bv = readPath(b, col);
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
      return builder;
    },
    limit(n) {
      filtered = filtered.slice(0, n);
      return builder;
    },
    select(cols) {
      selected = cols;
      return builder;
    },
    apply() {
      if (mode !== "update") return;
      for (const row of filtered) Object.assign(row, patch);
    },
    result() {
      builder.apply();
      return filtered.map((row) => projectRow(row, selected));
    },
    maybeSingle: async () => ({ data: builder.result()[0] ?? null, error: null }),
    then(resolve, reject) {
      return Promise.resolve({ data: builder.result(), error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function makeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] || (tables[table] = []);
      return {
        select: (columns) => makeQueryBuilder(rows, { columns }),
        update: (patch) => makeQueryBuilder(rows, { mode: "update", patch }),
      };
    },
  };
}

const TEAM_ID = "team-a";
const OFFER_ID = "offer-8188";
const MONUMENT_GOAL = { type: "monument_podium", target: 1, label: "Top 3 in a monument, after accepting" };

function podium(id, seasonId, { raceClass = "Monuments", rank = 2, squad = "senior", teamId = TEAM_ID } = {}) {
  return {
    id,
    team_id: teamId,
    result_type: "gc",
    rank,
    races: { race_class: raceClass, race_type: "single", season_id: seasonId, squad },
  };
}

// Holdet har to monument-podier i TIDLIGERE sæsoner (s1, s2) og ét i den
// aktive sæson (s3). 1yr-boardet er genbrugt, så dets snapshots dækker s1+s2.
function tables({ planStartSeasonNumber = 3, extraResults = [] } = {}) {
  return {
    seasons: [
      { id: "s1", number: 1, status: "completed" },
      { id: "s2", number: 2, status: "completed" },
      { id: "s3", number: 3, status: "active" },
    ],
    board_profiles: [{
      id: "board-1yr",
      team_id: TEAM_ID,
      plan_type: "1yr",
      negotiation_status: "completed",
      plan_start_season_number: planStartSeasonNumber,
      current_goals: JSON.stringify([{ type: "min_riders", target: 20 }]),
    }],
    board_plan_snapshots: [
      { board_id: "board-1yr", season_id: "s1", season_number: 1, season_within_plan: 1, u25_stat_sum: 0, u25_count: 0 },
      { board_id: "board-1yr", season_id: "s2", season_number: 2, season_within_plan: 1, u25_stat_sum: 0, u25_count: 0 },
    ],
    board_mandates: [{
      id: "mand-s3",
      team_id: TEAM_ID,
      season_number: 3,
      status: "active",
      signed_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
      goals: [{ type: "min_riders", target: 20 }],
    }],
    race_results: [
      podium("rr-s1", "s1"),
      podium("rr-s2", "s2"),
      podium("rr-s3", "s3"),
      // Støj der aldrig må tælle: et andet holds podie, et ikke-monument-podie
      // og et ungdomsløb (#5537).
      podium("rr-other-team", "s3", { teamId: "team-b" }),
      podium("rr-classic", "s3", { raceClass: "OtherWorldTourA" }),
      podium("rr-youth", "s3", { squad: "u23" }),
      ...extraResults,
    ],
    finance_transactions: [],
    app_config: [],
    riders: [],
  };
}

test("#8188 regression: baseline ved accept midt i saesonen = saesonens monument-podier, ikke alle saesoners", async () => {
  const state = tables();
  const supabase = makeSupabase(state);

  // Kontrol: uden cyklusvindue tæller loaderen alle tre (fejlens signatur).
  const unwindowed = await loadGoalContextForBoard({
    supabase, teamId: TEAM_ID, boardId: "board-1yr", currentSeasonId: "s3",
  });
  assert.equal(unwindowed.cumulativeMonumentPodiums, 3, "kontrol: uden vindue tælles s1+s2+s3");

  const result = await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: MONUMENT_GOAL,
    isMandateModelEnabled: async () => true,
  });

  assert.equal(result.goal.baseline, 1, "baseline = kun s3-podiet");
  const mandateGoal = state.board_mandates[0].goals.find((g) => g.source === "bonus_offer");
  const profileGoal = JSON.parse(state.board_profiles[0].current_goals).find((g) => g.source === "bonus_offer");
  assert.equal(mandateGoal.baseline, 1, "board_mandates.goals faar samme baseline");
  assert.equal(profileGoal.baseline, 1, "board_profiles.current_goals faar samme baseline");
});

test("#8188 regression: et nyt monument-podie efter accept giver fremdrift 1 af 1 i evalueringens vindue", async () => {
  const state = tables();
  const supabase = makeSupabase(state);

  const { goal } = await applyAcceptedBonusGoal({
    supabase, teamId: TEAM_ID, offerId: OFFER_ID, extraGoal: MONUMENT_GOAL,
    isMandateModelEnabled: async () => true,
  });

  // Samme dag: holdet kører et nyt monument-podie hjem.
  state.race_results.push(podium("rr-s3-new", "s3", { rank: 2 }));

  // Evalueringen/visningen læser med plan-cyklusvinduet (boardRoom.js,
  // economyEngine/boardWeekendFinalization: plan_start_season_number).
  const context = await loadGoalContextForBoard({
    supabase, teamId: TEAM_ID, boardId: "board-1yr", currentSeasonId: "s3", planStartSeasonNumber: 3,
  });
  assert.equal(context.cumulativeMonumentPodiums, 2);

  const progress = evaluateGoalProgress(goal, {}, { riders: [] }, {
    ...context, planDuration: 1, seasonsCompleted: 1, isFinalSeason: true,
  });
  assert.equal(progress.actual, 1, "netto-podier siden accept");
  assert.equal(progress.target, 1);
  assert.equal(progress.status, "ahead");
  assert.equal(progress.met, true);
});

test("#8188 uden plan_start_season_number paa 1yr-boardet maales i den aktive saeson (samme fallback som Boardroom)", async () => {
  const state = tables({ planStartSeasonNumber: null });
  const supabase = makeSupabase(state);

  const result = await applyAcceptedBonusGoal({
    supabase, teamId: TEAM_ID, offerId: OFFER_ID, extraGoal: MONUMENT_GOAL,
    isMandateModelEnabled: async () => true,
  });

  assert.equal(result.goal.baseline, 1);
});

test("#8188 plan-start fra 1yr-boardet (2) bruges, ikke den aktive saesons fallback (3)", async () => {
  // Plan-cyklussen startede i s2, saa vinduet er s2 + s3: baseline = 2.
  // Henter loadCompletedOneYearBoard ikke plan_start_season_number, falder
  // baselinen tilbage til den aktive saeson (3) og bliver 1; saa fejler prøven.
  const state = tables({ planStartSeasonNumber: 2 });
  const supabase = makeSupabase(state);

  const result = await applyAcceptedBonusGoal({
    supabase, teamId: TEAM_ID, offerId: OFFER_ID, extraGoal: MONUMENT_GOAL,
    isMandateModelEnabled: async () => true,
  });

  assert.equal(result.goal.baseline, 2, "baseline = s2- og s3-podierne i plan-cyklussen");
  const mandateGoal = state.board_mandates[0].goals.find((g) => g.source === "bonus_offer");
  assert.equal(mandateGoal.baseline, 2);
});

test("#8188 baseline-stien sender cyklusvinduet videre til goal-konteksten", async () => {
  const state = tables({ planStartSeasonNumber: 3 });
  const supabase = makeSupabase(state);
  const seen = [];

  const baseline = await computeBonusGoalBaseline({
    supabase,
    teamId: TEAM_ID,
    boardId: "board-1yr",
    planStartSeasonNumber: 3,
    extraGoal: MONUMENT_GOAL,
    loadGoalContext: async (args) => {
      seen.push(args);
      return { cumulativeMonumentPodiums: 0 };
    },
  });

  assert.equal(baseline, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].planStartSeasonNumber, 3);
  assert.equal(seen[0].currentSeasonId, "s3");
  assert.equal(seen[0].boardId, "board-1yr");
});

test("#8188 to aktive saesoner under skiftet: den nyeste vaelges, accept fejler ikke", async () => {
  const state = tables();
  state.seasons.push({ id: "s4", number: 4, status: "active" });
  const supabase = makeSupabase(state);
  const seen = [];

  await computeBonusGoalBaseline({
    supabase, teamId: TEAM_ID, boardId: "board-1yr", planStartSeasonNumber: null,
    extraGoal: MONUMENT_GOAL,
    loadGoalContext: async (args) => {
      seen.push(args);
      return { cumulativeMonumentPodiums: 0 };
    },
  });

  assert.equal(seen[0].currentSeasonId, "s4");
  assert.equal(seen[0].planStartSeasonNumber, 4);
});

test("#8188 signature_rider er en beholdning uden saesonvindue og er uaendret", async () => {
  const state = tables();
  const supabase = makeSupabase(state);
  let contextCalls = 0;

  const baseline = await computeBonusGoalBaseline({
    supabase, teamId: TEAM_ID, boardId: "board-1yr", planStartSeasonNumber: 3,
    extraGoal: { type: "signature_rider", target: 1 },
    loadGoalContext: async () => {
      contextCalls += 1;
      return {};
    },
  });

  assert.equal(baseline, 0, "ingen ryttere i truppen = 0 stjerner");
  assert.equal(contextCalls, 0, "signature_rider laeser aldrig goal-konteksten");
});
