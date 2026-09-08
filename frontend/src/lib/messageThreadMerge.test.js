import assert from "node:assert/strict";
import test from "node:test";

import { combineThreadMessages } from "./messageThreadMerge.js";

const m = (id, minute) => ({ id, createdAt: `2026-09-08T10:${String(minute).padStart(2, "0")}:00.000Z` });

test("hele samtalen i én side erstatter alt", () => {
  const previous = [m("a", 1), m("b", 2)];
  const page = [m("b", 2)];
  assert.deepEqual(combineThreadMessages(previous, page, { hasMore: false }), page);
});

test("en blokeret afsenders besked FORSVINDER ved næste hentning", () => {
  // Præcis blokerings-scenariet: serveren filtrerer modpartens besked fra, og
  // visningen skal følge med. Det var her den anden review-runde fandt fejlen.
  const previous = [m("dem", 1), m("mig", 2)];
  const page = [m("mig", 2)];
  assert.deepEqual(
    combineThreadMessages(previous, page, { hasMore: false }).map(x => x.id),
    ["mig"],
  );
});

test("en tom nyeste side betyder en tom tråd", () => {
  assert.deepEqual(combineThreadMessages([m("a", 1)], [], { hasMore: false }), []);
  assert.deepEqual(combineThreadMessages([m("a", 1)], [], { hasMore: true }), []);
});

test("'vis ældre' prepender uden dubletter og i kronologisk orden", () => {
  const previous = [m("c", 30), m("d", 40)];
  const older = [m("a", 10), m("b", 20)];
  assert.deepEqual(
    combineThreadMessages(previous, older, { before: previous[0].createdAt }).map(x => x.id),
    ["a", "b", "c", "d"],
  );
});

test("'vis ældre' taber ikke det der allerede stod der", () => {
  const previous = [m("c", 30)];
  const older = [m("b", 20), m("c", 30)];
  assert.deepEqual(
    combineThreadMessages(previous, older, { before: "2026-09-08T10:31:00.000Z" }).map(x => x.id),
    ["b", "c"],
  );
});

test("et poll-tick ruller ikke en hentet ældre side tilbage", () => {
  // Dette var den FØRSTE fejl: siden erstattede alt, så "vis ældre" blev
  // slettet af næste 20-sekunders opdatering.
  const previous = [m("old", 5), m("c", 30), m("d", 40)];
  const newestPage = [m("c", 30), m("d", 40), m("e", 50)];
  assert.deepEqual(
    combineThreadMessages(previous, newestPage, { hasMore: true }).map(x => x.id),
    ["old", "c", "d", "e"],
  );
});
