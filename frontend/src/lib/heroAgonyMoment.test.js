// Hero & Agony (#3397) — unit-tests for den rene drama-score-udvælgelse.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAMA_SCORE, buildRosterMap, buildHeroAgonyCandidates, selectHeroAgonyMoment, buildHeroAgonyMoment,
} from "./heroAgonyMoment.js";

const TEAM_A = "team-a";
const TEAM_B = "team-b";

function moment(overrides = {}) {
  return { stage_number: 1, moment_key: "sprint_win", params: {}, significance: 50, rider_ids: [], team_ids: [], ...overrides };
}

function stageRow(overrides = {}) {
  return { result_type: "stage", rider_id: null, team_id: null, rider_name: null, rank: null, in_breakaway: false, breakaway_caught: false, ...overrides };
}

test("buildRosterMap: kun 'stage'-rækker, øvrige result_type ignoreres", () => {
  const rows = [
    stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Rider One" }),
    { result_type: "gc", rider_id: "r2", team_id: TEAM_B, rider_name: "Rider Two" },
  ];
  const map = buildRosterMap(rows);
  assert.deepEqual(map.get("r1"), { teamId: TEAM_A, riderName: "Rider One" });
  assert.equal(map.get("r2"), undefined);
});

test("sprint_win: kun min rytter giver en triumf-kandidat", () => {
  const rows = [stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Rider One" })];
  const moments = [moment({ moment_key: "sprint_win", rider_ids: ["r1"], params: { gapSeconds: 2 } })];
  const candidates = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  const stageWin = candidates.find((c) => c.kind === "sprint_win");
  assert.ok(stageWin);
  assert.equal(stageWin.tone, "triumph");
  assert.equal(stageWin.riderName, "Rider One");
  assert.equal(stageWin.dramaScore, DRAMA_SCORE.sprint_win);

  // Samme moment, men holdet er team-b → ingen kandidat.
  const none = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_B });
  assert.equal(none.some((c) => c.kind === "sprint_win"), false);
});

test("gc_takeover: symmetrisk score uanset retning (tog/tabte føringen)", () => {
  const rows = [
    stageRow({ rider_id: "leader", team_id: TEAM_A, rider_name: "New Leader" }),
    stageRow({ rider_id: "prev", team_id: TEAM_B, rider_name: "Old Leader" }),
  ];
  const moments = [moment({ moment_key: "gc_takeover", rider_ids: ["leader", "prev"], params: { riderId: "leader", previousLeaderId: "prev" } })];

  const won = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  const wonCand = won.find((c) => c.kind === "gc_takeover_won");
  assert.ok(wonCand);
  assert.equal(wonCand.tone, "triumph");
  assert.equal(wonCand.params.previousLeaderName, "Old Leader");

  const lost = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_B });
  const lostCand = lost.find((c) => c.kind === "gc_takeover_lost");
  assert.ok(lostCand);
  assert.equal(lostCand.tone, "agony");
  assert.equal(lostCand.params.newLeaderName, "New Leader");

  // Eksplicit AC: "agony vægtes lige så højt som triumf" — samme tal.
  assert.equal(DRAMA_SCORE.gc_takeover_won, DRAMA_SCORE.gc_takeover_lost);
});

test("stage win (85) er lig incident_abandon (85) — bevidst symmetri", () => {
  assert.equal(DRAMA_SCORE.sprint_win, DRAMA_SCORE.incident_abandon);
  assert.equal(DRAMA_SCORE.solo_win, DRAMA_SCORE.incident_abandon);
});

test("tag_favorite_collapse produces ingen selvstændig kandidat (dubleret af favorite_off_day)", () => {
  const rows = [stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Favorite" })];
  const moments = [
    moment({ moment_key: "favorite_off_day", rider_ids: ["r1"], params: { riderId: "r1", rank: 34, reason: "incident" } }),
    moment({ moment_key: "tag_favorite_collapse", rider_ids: ["r1"], params: { riderId: "r1", rank: 34, reason: "incident" } }),
  ];
  const candidates = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  // favorite_off_day findes præcis én gang; tag_favorite_collapse producerer INGEN
  // selvstændig kandidat (plain_result-gulvet er upåvirket støj fra samme rytter).
  assert.equal(candidates.filter((c) => c.kind === "favorite_off_day").length, 1);
  assert.equal(candidates.some((c) => c.kind === "tag_favorite_collapse"), false);
  const favoriteCandidate = candidates.find((c) => c.kind === "favorite_off_day");
  assert.equal(favoriteCandidate.tone, "agony");
  assert.equal(favoriteCandidate.params.reason, "incident");
});

test("tag_helper_sacrifice scorer højere end helper_shift (agony-vægtning)", () => {
  assert.ok(DRAMA_SCORE.tag_helper_sacrifice > DRAMA_SCORE.helper_shift);
});

test("helper_shift: kun mit hold via team_ids, ikke via rider_ids", () => {
  const rows = [stageRow({ rider_id: "captain", team_id: TEAM_A, rider_name: "Captain" })];
  const moments = [moment({ moment_key: "helper_shift", team_ids: [TEAM_A], params: { captainId: "captain", helperIds: ["h1", "h2"] } })];
  const candidates = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  const c = candidates.find((x) => x.kind === "helper_shift");
  assert.ok(c);
  assert.equal(c.params.count, 2);
  assert.equal(c.riderName, "Captain");
});

test("breakaway_effort: syntetiseret fra race_results, ikke fra moments", () => {
  const rows = [stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Breakaway Rider", in_breakaway: true, breakaway_caught: true, rank: 45 })];
  const candidates = buildHeroAgonyCandidates({ moments: [], stageResultRows: rows, myTeamId: TEAM_A });
  const c = candidates.find((x) => x.kind === "breakaway_effort");
  assert.ok(c);
  assert.equal(c.tone, "agony");
  assert.equal(c.riderName, "Breakaway Rider");
});

test("breakaway_effort udelades hvis tag_aggression_no_cost allerede dækker SAMME rytter", () => {
  const rows = [stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Breakaway Rider", in_breakaway: true, breakaway_caught: true, rank: 12 })];
  const moments = [moment({ moment_key: "tag_aggression_no_cost", rider_ids: ["r1"], params: { riderId: "r1" } })];
  const candidates = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  assert.equal(candidates.some((c) => c.kind === "breakaway_effort"), false);
  assert.equal(candidates.filter((c) => c.kind === "tag_aggression_no_cost").length, 1);
});

test("plain_result: gulv-kandidat findes altid når holdet startede, men vinder aldrig over en ægte moment", () => {
  const rows = [
    stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Domestique", rank: 88 }),
    stageRow({ rider_id: "r2", team_id: TEAM_A, rider_name: "Best Placed", rank: 14 }),
  ];
  // Ingen moments overhovedet — kun gulv-kandidaten kan vælges.
  const onlyFloor = buildHeroAgonyMoment({ moments: [], stageResultRows: rows, myTeamId: TEAM_A });
  assert.equal(onlyFloor.kind, "plain_result");
  assert.equal(onlyFloor.riderName, "Best Placed"); // bedste rank blandt holdets rækker
  assert.equal(onlyFloor.params.rank, 14);

  // Med en ægte moment til stede vinder den ALTID over gulvet.
  const moments = [moment({ moment_key: "tag_jour_sans", rider_ids: ["r1"], params: { riderId: "r1" } })];
  const withMoment = buildHeroAgonyMoment({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  assert.equal(withMoment.kind, "tag_jour_sans");
});

test("selectHeroAgonyMoment: højeste dramaScore vinder, deterministisk uafgjort-brydning på riderId", () => {
  const candidates = [
    { kind: "tag_jour_sans", tone: "agony", dramaScore: 45, riderId: "r2", riderName: "B", teamId: null, teamName: null, params: {} },
    { kind: "form_peak", tone: "triumph", dramaScore: 45, riderId: "r1", riderName: "A", teamId: null, teamName: null, params: {} },
  ];
  const picked = selectHeroAgonyMoment(candidates);
  // Samme score → laveste riderId ("r1") vinder, UANSET array-rækkefølge.
  assert.equal(picked.riderId, "r1");
  const reversed = selectHeroAgonyMoment([...candidates].reverse());
  assert.equal(reversed.riderId, "r1");
});

test("selectHeroAgonyMoment: tom liste giver null, aldrig kast", () => {
  assert.equal(selectHeroAgonyMoment([]), null);
  assert.equal(selectHeroAgonyMoment(null), null);
});

test("final_gc: rang afledt af podium-array-indeks (0=1., 1=2., 2=3.)", () => {
  const rows = [
    stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Third Place" }),
  ];
  const moments = [moment({ moment_key: "final_gc", rider_ids: ["w1", "w2", "r1"], params: { riderIds: ["w1", "w2", "r1"] } })];
  const candidates = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
  const c = candidates.find((x) => x.kind === "final_gc");
  assert.ok(c);
  assert.equal(c.params.rank, 3);
});

test("ingen myTeamId → ingen kandidater, aldrig kast", () => {
  assert.deepEqual(buildHeroAgonyCandidates({ moments: [], stageResultRows: [], myTeamId: null }), []);
});

test("ukendt moment_key ignoreres (forward-compat), aldrig kast", () => {
  // stageResultRows: [] isolerer testen fra plain_result-gulvet (som kun
  // fyrer når holdet rent faktisk havde en 'stage'-række) — det der testes
  // her er UDELUKKENDE at en ukendt moment_key aldrig producerer en kandidat.
  const moments = [moment({ moment_key: "some_future_key_2027", rider_ids: ["r1"] })];
  assert.deepEqual(buildHeroAgonyCandidates({ moments, stageResultRows: [], myTeamId: TEAM_A }), []);
});

// #4373: uden itt_win/ttt_win i kandidat-switchen forsvandt helte-kortet helt
// på en enkeltstart i stedet for at få den rigtige tekst.
test("#4373: itt_win/ttt_win giver en triumf-kandidat for mit hold", () => {
  for (const key of ["itt_win", "ttt_win"]) {
    const rows = [stageRow({ rider_id: "r1", team_id: TEAM_A, rider_name: "Lei Lin", rank: 1 })];
    const moments = [moment({ moment_key: key, rider_ids: ["r1"], params: { gapSeconds: 2 } })];
    const candidates = buildHeroAgonyCandidates({ moments, stageResultRows: rows, myTeamId: TEAM_A });
    const win = candidates.find((c) => c.kind === key);
    assert.ok(win, `forventede en ${key}-kandidat`);
    assert.equal(win.tone, "triumph");
    assert.equal(win.dramaScore, DRAMA_SCORE[key]);
  }
});
