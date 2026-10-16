// #6638 — kontrakt-tilstand og fri-agent-adgang set fra den aktive saeson.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_STATE,
  riderContractState,
  contractOfferEligibility,
  isContractAwaitingRelease,
} from "./contractOfferEligibility.js";

test("isContractAwaitingRelease: strengt end < aktiv, aldrig ved ukendte tal", () => {
  assert.equal(isContractAwaitingRelease(3, 4), true);
  assert.equal(isContractAwaitingRelease(4, 4), false);
  assert.equal(isContractAwaitingRelease(5, 4), false);
  assert.equal(isContractAwaitingRelease(null, 4), false);
  assert.equal(isContractAwaitingRelease(3, null), false);
  assert.equal(isContractAwaitingRelease("3", "4"), true);
});

const TEAM = "team-a";

test("udloebet men stadig paa holdet -> EXPIRED_AWAITING_RELEASE (spillerens tilfaelde)", () => {
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: 3, activeSeasonNumber: 4 }),
    CONTRACT_STATE.EXPIRED_AWAITING_RELEASE,
  );
  // To saesoner bagud (ungdom sprunget over ved to skift, #5864) er samme tilstand.
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: 2, activeSeasonNumber: 4 }),
    CONTRACT_STATE.EXPIRED_AWAITING_RELEASE,
  );
});

test("sidste saeson er IKKE udloebet: contract_end_season er sidste aktive saeson", () => {
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: 4, activeSeasonNumber: 4 }),
    CONTRACT_STATE.FINAL_SEASON,
  );
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: 5, activeSeasonNumber: 4 }),
    CONTRACT_STATE.RUNNING,
  );
});

test("fri agent: et efterladt contract_end_season ignoreres", () => {
  assert.equal(
    riderContractState({ teamId: null, contractEndSeason: 3, activeSeasonNumber: 4 }),
    CONTRACT_STATE.FREE_AGENT,
  );
  assert.equal(riderContractState({}), CONTRACT_STATE.FREE_AGENT);
});

test("ejet rytter uden udloebssaeson -> NO_END", () => {
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: null, activeSeasonNumber: 4 }),
    CONTRACT_STATE.NO_END,
  );
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: "", activeSeasonNumber: 4 }),
    CONTRACT_STATE.NO_END,
  );
});

test("ukendt aktiv saeson paastaar aldrig udloeb", () => {
  for (const active of [null, undefined, Number.NaN, "x"]) {
    assert.equal(
      riderContractState({ teamId: TEAM, contractEndSeason: 1, activeSeasonNumber: active }),
      CONTRACT_STATE.RUNNING,
    );
  }
});

test("talstrenge fra PostgREST behandles som tal", () => {
  assert.equal(
    riderContractState({ teamId: TEAM, contractEndSeason: "3", activeSeasonNumber: "4" }),
    CONTRACT_STATE.EXPIRED_AWAITING_RELEASE,
  );
});

test("eligibility: kun en ikke-pensioneret fri agent kan signeres direkte", () => {
  assert.deepEqual(
    contractOfferEligibility({ teamId: null, contractEndSeason: null, activeSeasonNumber: 4 }),
    { state: CONTRACT_STATE.FREE_AGENT, canSignAsFreeAgent: true, awaitingRelease: false, freeAgentAfterSeason: null },
  );
  assert.equal(
    contractOfferEligibility({ teamId: null, activeSeasonNumber: 4, isRetired: true }).canSignAsFreeAgent,
    false,
  );
});

test("eligibility: udloebet-men-ejet venter paa frigivelse EFTER den aktive saeson", () => {
  assert.deepEqual(
    contractOfferEligibility({ teamId: TEAM, contractEndSeason: 3, activeSeasonNumber: 4 }),
    {
      state: CONTRACT_STATE.EXPIRED_AWAITING_RELEASE,
      canSignAsFreeAgent: false,
      awaitingRelease: true,
      freeAgentAfterSeason: 4,
    },
  );
});

test("eligibility: loebende og sidste-saeson-kontrakter venter ikke paa frigivelse", () => {
  for (const end of [4, 5, 7]) {
    const r = contractOfferEligibility({ teamId: TEAM, contractEndSeason: end, activeSeasonNumber: 4 });
    assert.equal(r.canSignAsFreeAgent, false);
    assert.equal(r.awaitingRelease, false);
    assert.equal(r.freeAgentAfterSeason, null);
  }
});
