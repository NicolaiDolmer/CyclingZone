// #8099 · Halvsæson-tjekket (processMidSeasonReviewCron) må ikke røre et
// parkeret hold. Ejer-regel (#4592 23/9, #5902 4/10 valg A, låst): bestyrelsen
// for et parkeret hold er frosset. #8068 lukkede den ugentlige kørsel; denne
// fil låser halvsæson-tjekket:
//   - et parkeret hold får hverken halvsæson-beskeden eller oplåsning af den
//     ekstraordinære forespørgsel,
//   - et aktivt hold får begge dele præcis som før (samme besked, samme værdier),
//   - kan parkeringen ikke aflæses, fejler kørslen synligt og sender intet
//     (fail-closed).
// Sandheden er den samme som #8068: managerParking.isParkedTeam på
// teams.parked_at.

import test from "node:test";
import assert from "node:assert/strict";

import { processMidSeasonReviewCron, MID_SEASON_TITLE_PREFIX } from "./boardMidSeason.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

function makeTeam(id, userId, parkedAt) {
  return {
    id,
    user_id: userId,
    is_ai: false,
    is_bank: false,
    is_frozen: false,
    is_test_account: false,
    division: 3,
    name: `Hold ${id}`,
    season_1_identity_basis: null,
    balance: 0,
    parked_at: parkedAt,
  };
}

function makeBoard(id, teamId, satisfaction) {
  return {
    id,
    team_id: teamId,
    plan_type: "1yr",
    satisfaction,
    current_goals: [
      { type: "top_n_finish", target: 3 },
      { type: "stage_wins", target: 5 },
    ],
    negotiation_status: "completed",
    is_baseline: false,
  };
}

function makeStanding(teamId) {
  return {
    team_id: teamId,
    season_id: "season-5",
    division: 3,
    rank_in_division: 4,
    total_points: 200,
    stage_wins: 1,
    gc_wins: 0,
  };
}

// Hold A er aktivt, hold B er parkeret. Begge har lav tilfredshed, så begge
// ville udløse beskeden, hvis de blev tjekket.
function makeState({ includeParked = true } = {}) {
  const teams = [makeTeam("team-a", "user-a", null)];
  const boards = [makeBoard("board-a", "team-a", 40)];
  const standings = [makeStanding("team-a")];
  if (includeParked) {
    teams.push(makeTeam("team-b", "user-b", "2026-10-01T00:00:00Z"));
    boards.push(makeBoard("board-b", "team-b", 40));
    standings.push(makeStanding("team-b"));
  }
  return {
    teams,
    riders: [
      { team_id: "team-a", is_u25: true, popularity: 50 },
      { team_id: "team-b", is_u25: true, popularity: 50 },
    ],
    seasons: [{
      id: "season-5",
      number: 5,
      status: "active",
      race_days_completed: 30,
      race_days_total: 60,
    }],
    board_profiles: boards,
    season_standings: standings,
    loans: [],
    notifications: [],
  };
}

async function run(state, { supabase = createFakeSupabase(state) } = {}) {
  const notifications = [];
  const unlockCalls = [];
  const summary = await processMidSeasonReviewCron({
    supabase,
    now: new Date("2026-11-13T12:00:00Z"),
    notifyUser: async (args) => {
      notifications.push({ ...args });
      return { delivered: true, deduped: false };
    },
    deps: {
      unlockExtraordinaryRequestForTeam: async (_sb, args) => {
        unlockCalls.push({ ...args });
        return { unlocked: true };
      },
    },
  });
  return { summary, notifications, unlockCalls };
}

test("#8099: et parkeret hold får hverken halvsæson-besked eller oplåsning af den ekstraordinære forespørgsel", async () => {
  const { notifications, unlockCalls } = await run(makeState());

  assert.deepEqual(
    notifications.map((n) => n.userId),
    ["user-a"],
    "kun det aktive hold får beskeden"
  );
  assert.deepEqual(
    unlockCalls.map((c) => c.teamId),
    ["team-a"],
    "kun det aktive hold får den ekstraordinære forespørgsel låst op"
  );
});

test("#8099: summary tæller de parkerede hold, der er sprunget over", async () => {
  const { summary } = await run(makeState());
  assert.equal(summary.parked_teams_skipped, 1);
  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.banners_sent, 1);
});

test("#8099: et aktivt hold får præcis samme besked og samme oplåsning som før", async () => {
  // Reference: kun det aktive hold i populationen (sådan som det aktive hold
  // altid er blevet behandlet).
  const alone = await run(makeState({ includeParked: false }));
  const mixed = await run(makeState({ includeParked: true }));

  assert.equal(alone.notifications.length, 1);
  assert.deepEqual(mixed.notifications, alone.notifications);
  assert.deepEqual(mixed.unlockCalls, alone.unlockCalls);
  assert.equal(mixed.notifications[0].type, "board_critical");
  assert.equal(mixed.notifications[0].title, `${MID_SEASON_TITLE_PREFIX} (season 5)`);
  assert.equal(mixed.notifications[0].relatedId, "board-a");
  assert.deepEqual(mixed.unlockCalls[0], { teamId: "team-a", seasonId: "season-5" });
});

test("#8099: kan parkeringen ikke aflæses (parked_at mangler i rækken), fejler kørslen synligt og sender intet", async () => {
  const state = makeState();
  const fake = createFakeSupabase(state);
  const realFrom = fake.from.bind(fake);
  // Simulerer et opslag, hvor parked_at ikke kom med (fx en select uden
  // kolonnen): uden feltet kan koden ikke vide, om holdet er parkeret.
  fake.from = (table) => {
    const builder = realFrom(table);
    if (table !== "teams") return builder;
    const realSelect = builder.select.bind(builder);
    builder.select = (columns) => realSelect(
      String(columns).split(",").map((c) => c.trim()).filter((c) => c !== "parked_at").join(", ")
    );
    return builder;
  };

  const notifications = [];
  const unlockCalls = [];
  await assert.rejects(
    processMidSeasonReviewCron({
      supabase: fake,
      now: new Date("2026-11-13T12:00:00Z"),
      notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
      deps: {
        unlockExtraordinaryRequestForTeam: async (_sb, args) => { unlockCalls.push(args); return { unlocked: true }; },
      },
    }),
    /parked_at/
  );
  assert.equal(notifications.length, 0, "ingen besked, når parkeringen ikke kan aflæses");
  assert.equal(unlockCalls.length, 0, "ingen oplåsning, når parkeringen ikke kan aflæses");
});

test("#8099: fejler hold-opslaget, fejler kørslen synligt og sender intet", async () => {
  const state = makeState();
  const fake = createFakeSupabase(state);
  const realFrom = fake.from.bind(fake);
  fake.from = (table) => {
    if (table !== "teams") return realFrom(table);
    const failing = {
      select: () => failing,
      eq: () => failing,
      order: () => failing,
      range: () => failing,
      then: (resolve) => resolve({ data: null, error: new Error("teams lookup failed") }),
    };
    return failing;
  };

  const notifications = [];
  const unlockCalls = [];
  await assert.rejects(
    processMidSeasonReviewCron({
      supabase: fake,
      now: new Date("2026-11-13T12:00:00Z"),
      notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
      deps: {
        unlockExtraordinaryRequestForTeam: async (_sb, args) => { unlockCalls.push(args); return { unlocked: true }; },
      },
    }),
    /teams lookup failed/
  );
  assert.equal(notifications.length, 0);
  assert.equal(unlockCalls.length, 0);
});
