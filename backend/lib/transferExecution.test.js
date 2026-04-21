import test from "node:test";
import assert from "node:assert/strict";

import {
  getSwapExecutionIssue,
  getTransferExecutionIssue,
} from "./transferExecution.js";

test("getTransferExecutionIssue rejects a buyer that would exceed the squad max", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 2,
      total_count: 15,
      squad_limits: { min: 14, max: 20 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 2,
      total_count: 20,
      squad_limits: { min: 14, max: 20 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "buyer_squad_full");
  assert.equal(issue?.maxRiders, 20);
});

test("getTransferExecutionIssue rejects a seller that would fall below the squad min", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 1,
      total_count: 20,
      squad_limits: { min: 20, max: 30 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 1,
      total_count: 24,
      squad_limits: { min: 20, max: 30 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "seller_squad_too_small");
  assert.equal(issue?.minRiders, 20);
});

test("getTransferExecutionIssue rejects when the seller no longer owns the rider", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "other-team" },
    sellerState: {
      id: "seller-team",
      division: 3,
      total_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 3,
      total_count: 8,
      squad_limits: { min: 8, max: 10 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "seller_no_longer_owns_rider");
});

test("getTransferExecutionIssue rejects when the buyer can no longer afford the rider", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 3,
      total_count: 9,
      squad_limits: { min: 8, max: 10 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 49,
      division: 3,
      total_count: 8,
      squad_limits: { min: 8, max: 10 },
    },
    price: 50,
  });

  assert.equal(issue?.code, "buyer_insufficient_balance");
});

test("getTransferExecutionIssue returns null when the transfer is still valid", () => {
  const issue = getTransferExecutionIssue({
    rider: { team_id: "seller-team" },
    sellerState: {
      id: "seller-team",
      division: 2,
      total_count: 15,
      squad_limits: { min: 14, max: 20 },
    },
    buyerState: {
      id: "buyer-team",
      balance: 500,
      division: 2,
      total_count: 18,
      squad_limits: { min: 14, max: 20 },
    },
    price: 50,
  });

  assert.equal(issue, null);
});

test("getSwapExecutionIssue rejects when one of the riders has moved", () => {
  const issue = getSwapExecutionIssue({
    swap: {
      proposing_team_id: "proposing-team",
      receiving_team_id: "receiving-team",
    },
    offered: { team_id: "proposing-team" },
    requested: { team_id: "someone-else" },
    proposingState: { balance: 500 },
    receivingState: { balance: 500 },
    cash: 0,
  });

  assert.equal(issue?.code, "requested_rider_moved");
});

test("getSwapExecutionIssue rejects when the payer no longer has the cash adjustment", () => {
  const issue = getSwapExecutionIssue({
    swap: {
      proposing_team_id: "proposing-team",
      receiving_team_id: "receiving-team",
    },
    offered: { team_id: "proposing-team" },
    requested: { team_id: "receiving-team" },
    proposingState: { balance: 25 },
    receivingState: { balance: 500 },
    cash: 50,
  });

  assert.equal(issue?.code, "proposing_insufficient_balance");
});
