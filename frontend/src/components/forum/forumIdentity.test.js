// #4751 — reglerne bag profil-identiteten i forummet.
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatForumDate,
  authorDisplayName,
  showsSeparateTeamName,
  shouldShowSignature,
} from "./forumIdentity.js";

test("formatForumDate: altid Europe/Copenhagen, tom streng uden dato", () => {
  assert.equal(formatForumDate(null, "en"), "");
  assert.equal(formatForumDate("", "da"), "");
  // 2026-08-01T10:00:00Z = 12:00 dansk sommertid.
  assert.match(formatForumDate("2026-08-01T10:00:00Z", "en"), /12:00/);
  assert.match(formatForumDate("2026-08-01T10:00:00Z", "da"), /12[.:]00/);
});

test("authorDisplayName: managernavn foerst, ellers holdnavn, ellers ?", () => {
  assert.equal(authorDisplayName({ username: "alice", team_name: "Team Alpha" }), "alice");
  assert.equal(authorDisplayName({ username: null, team_name: "Team Alpha" }), "Team Alpha");
  assert.equal(authorDisplayName({}), "?");
  assert.equal(authorDisplayName(null), "?");
});

test("showsSeparateTeamName: kun naar begge navne findes (ingen dublet paa linjen)", () => {
  assert.equal(showsSeparateTeamName({ username: "alice", team_name: "Team Alpha" }), true);
  assert.equal(showsSeparateTeamName({ username: null, team_name: "Team Alpha" }), false);
  assert.equal(showsSeparateTeamName({ username: "alice", team_name: null }), false);
});

test("shouldShowSignature: kraever baade holdnavn og division", () => {
  assert.equal(shouldShowSignature("Hej alle", { team_name: "Team Alpha", division: 2 }), true);
  assert.equal(shouldShowSignature("Hej alle", { team_name: "Team Alpha", division: null }), false);
  assert.equal(shouldShowSignature("Hej alle", { team_name: null, division: 2 }), false);
  assert.equal(shouldShowSignature("Hej alle", null), false);
});

test("shouldShowSignature: division 1 taeller som en division (ikke falsy)", () => {
  assert.equal(shouldShowSignature("Hej alle", { team_name: "Team Alpha", division: 1 }), true);
  assert.equal(shouldShowSignature("Hej alle", { team_name: "Team Alpha", division: 0 }), true);
});

test("shouldShowSignature: falder vaek naar skribenten selv har skrevet holdnavnet", () => {
  const author = { team_name: "Team Alpha", division: 2 };
  assert.equal(shouldShowSignature("Vi i Team Alpha koerer defensivt", author), false);
  assert.equal(shouldShowSignature("hilsen team alpha", author), false);
  assert.equal(shouldShowSignature("Hilsen\nTeam   Alpha", author), false);
  assert.equal(shouldShowSignature("Hilsen Team Beta", author), true);
});

test("shouldShowSignature: tom body giver stadig en signatur", () => {
  assert.equal(shouldShowSignature("", { team_name: "Team Alpha", division: 2 }), true);
  assert.equal(shouldShowSignature(undefined, { team_name: "Team Alpha", division: 2 }), true);
});
