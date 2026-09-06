// backend/scripts/backfillMandateForTeamsWithoutRelation.test.js
// ============================================================================
// #4837 — backfill for menneskehold uden board_relations.
//
// Kernen i denne test-fil er den samme disciplin som #4715 lærte os på
// repairMissingBoardMembers: kør scriptets kerne i BÅDE dry-run- og apply-
// tilstand mod PRÆCIS samme fixture, og bevis at dry-run-listen
// (backfillCandidateIds) er identisk med apply's faktiske resultat
// (backfilledTeamIds). En dry-run-rapport ejeren skal godkende på er kun
// noget værd hvis den forudsiger apply.
//
// Refs #4837 #3514 #4557.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isBackfillEligible,
  fetchBackfillSnapshot,
  runBackfillMandateForTeamsWithoutRelation,
} from "./backfillMandateForTeamsWithoutRelation.js";
import { createFakeSupabase } from "../lib/testUtils/fakeSupabase.js";

const IDENTITY_BASIS = {
  national_core: { code: "FRA", share: 0.6 },
  dominant_specialty: "climber",
  avg_age: 26,
};

function makeState(over = {}) {
  return {
    teams: [
      // Kandidat: menneskehold, ingen relation.
      { id: "t-new-1", name: "Nyt Hold 1", division: 3, season_1_identity_basis: IDENTITY_BASIS },
      // Kandidat: menneskehold, ingen relation.
      { id: "t-new-2", name: "Nyt Hold 2", division: 2, season_1_identity_basis: IDENTITY_BASIS },
      // Har allerede relation → skal springes over.
      { id: "t-old", name: "Gammelt Hold", division: 1, season_1_identity_basis: IDENTITY_BASIS },
      // Ikke-menneskehold → skal springes over.
      { id: "t-ai", name: "AI", is_ai: true, season_1_identity_basis: IDENTITY_BASIS },
      { id: "t-bank", name: "Banken", is_bank: true, season_1_identity_basis: IDENTITY_BASIS },
      { id: "t-frozen", name: "Frosset", is_frozen: true, season_1_identity_basis: IDENTITY_BASIS },
      { id: "t-test", name: "Testkonto", is_test_account: true, season_1_identity_basis: IDENTITY_BASIS },
      // Menneskehold uden identity_basis → endnu ikke klar til bestyrelse.
      { id: "t-not-ready", name: "Ikke klar", division: 3, season_1_identity_basis: null },
    ],
    board_relations: [
      { id: "rel-old", team_id: "t-old", confidence: 71 },
    ],
    board_mandates: [],
    app_config: [{ key: "board_mandate_model_enabled", value: "on" }],
    seasons: [{ id: "season-3", number: 3, status: "active" }],
    riders: [],
    team_board_members: [],
    ...over,
  };
}

test("#4837 backfill: kandidat-predikatet tager KUN menneskehold uden relation", () => {
  const withRelation = new Set(["t-old"]);
  assert.equal(isBackfillEligible({ id: "t-new-1" }, withRelation), true);
  assert.equal(isBackfillEligible({ id: "t-old" }, withRelation), false, "har allerede relation");
  assert.equal(isBackfillEligible({ id: "a", is_ai: true }, withRelation), false);
  assert.equal(isBackfillEligible({ id: "b", is_bank: true }, withRelation), false);
  assert.equal(isBackfillEligible({ id: "c", is_frozen: true }, withRelation), false);
  assert.equal(isBackfillEligible({ id: "d", is_test_account: true }, withRelation), false);
  assert.equal(isBackfillEligible(null, withRelation), false);
});

test("#4837 backfill: snapshot læser hold + eksisterende relationer", async () => {
  const supabase = createFakeSupabase(makeState());
  const { teams, teamIdsWithRelation } = await fetchBackfillSnapshot(supabase);
  assert.equal(teams.length, 8);
  assert.deepEqual([...teamIdsWithRelation], ["t-old"]);
});

test("#4837 backfill: dry-run skriver INTET og rapporterer præcis de 2 kandidater", async () => {
  const state = makeState();
  const supabase = createFakeSupabase(state);

  const res = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: false, seasonNumber: 3 });

  assert.deepEqual(res.backfillCandidateIds.sort(), ["t-new-1", "t-new-2"]);
  assert.deepEqual(res.notReadyTeamIds, ["t-not-ready"]);
  assert.equal(res.backfilledTeamIds.length, 0);
  assert.equal(state.board_relations.length, 1, "dry-run må ikke oprette relationer");
  assert.equal(state.board_mandates.length, 0, "dry-run må ikke oprette mandater");
});

test("#4837 backfill: apply giver præcis dry-run-kandidaterne relation + mandat, og rører ikke de øvrige", async () => {
  const state = makeState();
  const supabase = createFakeSupabase(state);

  const dry = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: false, seasonNumber: 3 });
  const applied = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: true, seasonNumber: 3 });

  assert.deepEqual(
    applied.backfilledTeamIds.sort(),
    dry.backfillCandidateIds.sort(),
    "dry-run-listen SKAL forudsige apply — ellers er ejerens godkendelsesgrundlag forkert",
  );
  assert.equal(applied.failedTeamIds.length, 0);

  assert.equal(state.board_relations.length, 3, "2 nye + den eksisterende");
  assert.equal(state.board_relations.find((r) => r.team_id === "t-old").confidence, 71, "eksisterende relation urørt");
  for (const teamId of ["t-new-1", "t-new-2"]) {
    assert.equal(state.board_relations.find((r) => r.team_id === teamId).confidence, 50);
    const mandate = state.board_mandates.find((m) => m.team_id === teamId);
    assert.equal(mandate.season_id, "season-3");
    assert.equal(mandate.status, "proposed");
  }
  assert.equal(state.board_mandates.length, 2, "kun kandidaterne fik mandat");
});

test("#4837 backfill: en gentagen apply er en ren no-op (idempotent)", async () => {
  const state = makeState();
  const supabase = createFakeSupabase(state);

  await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: true, seasonNumber: 3 });
  const second = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: true, seasonNumber: 3 });

  assert.deepEqual(
    second.backfillCandidateIds,
    [],
    "ingen kandidater tilbage — alle klar-menneskehold har nu relation",
  );
  assert.deepEqual(
    second.notReadyTeamIds,
    ["t-not-ready"],
    "et hold uden identity_basis forbliver eligible, men rapporteres som ikke-klar i stedet for at blive skrevet",
  );
  assert.equal(second.backfilledTeamIds.length, 0);
  assert.equal(state.board_relations.length, 3);
  assert.equal(state.board_mandates.length, 2);
});

test("#4837 backfill: kill-switch off → intet skrives, holdene rapporteres som skipped (ikke failed)", async () => {
  const state = makeState({ app_config: [{ key: "board_mandate_model_enabled", value: "off" }] });
  const supabase = createFakeSupabase(state);

  const res = await runBackfillMandateForTeamsWithoutRelation({ supabase, apply: true, seasonNumber: 3 });

  assert.deepEqual(res.skippedTeamIds.sort(), ["t-new-1", "t-new-2"]);
  assert.equal(res.failedTeamIds.length, 0, "flag off er ikke en fejl");
  assert.equal(res.details.find((d) => d.teamId === "t-new-1").reason, "flag_off");
  assert.equal(state.board_relations.length, 1);
  assert.equal(state.board_mandates.length, 0);
});
