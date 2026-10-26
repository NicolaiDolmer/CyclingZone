// #2757 S0 (maaling, ingen motor): pointtroejens vinder og vinderens plads paa sprint-evne.
// Syntetiske data (hard rule 17): kun logikken testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pointsJerseyWinner, sprintRankIn } from "./tourScorecard.mjs";

const abilities = new Map([["a", { sprint: 90 }], ["b", { sprint: 70 }], ["c", { sprint: 70 }], ["d", { sprint: 40 }]]);

test("#2757 S0: plads paa sprint-evne i startfeltet (1 = bedste), lige evne afgoeres af id", () => {
  const ids = ["a", "b", "c", "d"];
  assert.equal(sprintRankIn("a", ids, abilities), 1);
  assert.equal(sprintRankIn("b", ids, abilities), 2);
  assert.equal(sprintRankIn("c", ids, abilities), 3);
  assert.equal(sprintRankIn("d", ids, abilities), 4);
  assert.equal(sprintRankIn("x", ids, abilities), null, "uden evner");
  assert.equal(sprintRankIn(null, ids, abilities), null);
});

test("#2757 S0: pointtroejen = flest point; lige point afgoeres deterministisk; ingen point = ingen vinder", () => {
  assert.deepEqual(pointsJerseyWinner(new Map([["a", 30], ["b", 55], ["c", 10]])), { riderId: "b", points: 55 });
  assert.deepEqual(pointsJerseyWinner(new Map([["z", 20], ["y", 20]])), { riderId: "y", points: 20 });
  assert.equal(pointsJerseyWinner(new Map([["a", 0]])), null);
  assert.equal(pointsJerseyWinner(new Map()), null);
});
