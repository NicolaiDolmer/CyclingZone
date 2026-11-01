// #7239: delt kaptajn (C2) og luksushjaelper (L) i saesonmatrixen (ejer 31/10, design A).
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyRaceDraft, buildDraftsFromEntries, roleOf, setRiderRole, removeRiderFromRace, raceDraftDirty,
  rolesForRace, buildBulkChange, ROLE_LETTER, roleBadgeClass,
} from "./seasonMatrix.js";

const entries = [
  { raceId: "r1", riderId: "a", raceRole: "captain" },
  { raceId: "r1", riderId: "b", raceRole: "co_captain" },
  { raceId: "r1", riderId: "c", raceRole: "luxury_helper" },
  { raceId: "r1", riderId: "d", raceRole: "helper" },
];

test("#7239 entries med co_captain/luxury_helper bliver til egne kladde-felter og roller", () => {
  const d = buildDraftsFromEntries(entries).get("r1");
  assert.equal(d.co_captain_id, "b");
  assert.equal(d.luxury_helper_id, "c");
  assert.equal(roleOf(d, "b"), "co_captain");
  assert.equal(roleOf(d, "c"), "luxury_helper");
  assert.equal(roleOf(d, "d"), "helper");
  assert.equal(ROLE_LETTER.co_captain, "C2");
  assert.equal(ROLE_LETTER.luxury_helper, "L");
});

test("#7239 popoveren tilbyder kun de nye roller i loeb der kender dem (fail-closed)", () => {
  assert.equal(rolesForRace({ rolesAllowed: true }).includes("co_captain"), true);
  assert.equal(rolesForRace({ rolesAllowed: true }).includes("luxury_helper"), true);
  assert.equal(rolesForRace({ rolesAllowed: false }).length, 5);
  assert.equal(rolesForRace({}).includes("co_captain"), false);
  assert.equal(rolesForRace(null).includes("luxury_helper"), false);
});

test("#7239 setRiderRole: delt kaptajn kraever en anden kaptajn og et loeb der kender rollen", () => {
  const base = { ...emptyRaceDraft(), rider_ids: ["a", "b"], captain_id: "a" };
  const ok = setRiderRole(base, "b", "co_captain", false, true);
  assert.equal(ok.co_captain_id, "b");
  assert.equal(roleOf(ok, "b"), "co_captain");
  // loeb uden rollen: no-op
  assert.equal(setRiderRole(base, "b", "co_captain", false, false), base);
  assert.equal(setRiderRole(base, "b", "luxury_helper", false, false), base);
  // ingen kaptajn: no-op
  const noCaptain = { ...emptyRaceDraft(), rider_ids: ["b"] };
  assert.equal(setRiderRole(noCaptain, "b", "co_captain", false, true), noCaptain);
  // kaptajnen kan ikke vaere sin egen delte kaptajn
  assert.equal(setRiderRole(base, "a", "co_captain", false, true), base);
});

test("#7239 hoejst en delt kaptajn og en luksushjaelper: den forrige degraderes til helper", () => {
  let d = { ...emptyRaceDraft(), rider_ids: ["a", "b", "c"], captain_id: "a" };
  d = setRiderRole(d, "b", "co_captain", false, true);
  d = setRiderRole(d, "c", "co_captain", false, true);
  assert.equal(d.co_captain_id, "c");
  assert.equal(roleOf(d, "b"), "helper");
  d = setRiderRole(d, "b", "luxury_helper", false, true);
  d = setRiderRole(d, "c", "luxury_helper", false, true);
  assert.equal(d.luxury_helper_id, "c");
  assert.equal(d.co_captain_id, null);
  assert.equal(roleOf(d, "b"), "helper");
  assert.equal(d.rider_ids.length, 3);
});

test("#7239 en rytter har kun en rolle: skift fra delt kaptajn rydder feltet", () => {
  let d = buildDraftsFromEntries(entries).get("r1");
  d = setRiderRole(d, "b", "hunter", false, true);
  assert.equal(d.co_captain_id, null);
  assert.equal(d.hunter_id, "b");
  d = setRiderRole(d, "c", "free_role", false, true);
  assert.equal(d.luxury_helper_id, null);
  assert.deepEqual(d.free_role_ids, ["c"]);
});

test("#7239 forsvinder kaptajnen, rykker den delte kaptajn op (som udtagelsespanelet)", () => {
  const d = buildDraftsFromEntries(entries).get("r1");
  const a = setRiderRole(d, "a", "helper", false, true);
  assert.equal(a.captain_id, "b");
  assert.equal(a.co_captain_id, null);
  const removed = removeRiderFromRace(d, "a");
  assert.equal(removed.captain_id, "b");
  assert.equal(removed.co_captain_id, null);
  assert.equal(removed.luxury_helper_id, "c");
});

test("#7239 fjern fra loebet rydder rollen; blocked er stadig et no-op", () => {
  const d = buildDraftsFromEntries(entries).get("r1");
  const r = removeRiderFromRace(d, "c");
  assert.equal(r.luxury_helper_id, null);
  assert.equal(r.rider_ids.includes("c"), false);
  assert.equal(setRiderRole(d, "d", "co_captain", true, true), d);
});

test("#7239 dirty: kun en aendret delt kaptajn/luksushjaelper goer kladden uren", () => {
  const server = buildDraftsFromEntries(entries).get("r1");
  assert.equal(raceDraftDirty(buildDraftsFromEntries(entries).get("r1"), server), false);
  assert.equal(raceDraftDirty(setRiderRole(server, "d", "co_captain", false, true), server), true);
  assert.equal(raceDraftDirty(setRiderRole(server, "d", "luxury_helper", false, true), server), true);
});

test("#7239 gem: en rolle sat via API nulstilles aldrig af et gem fra matrixen", () => {
  const server = buildDraftsFromEntries(entries).get("r1");
  // spilleren aendrer kun en helper -> kladden bevarer begge roller, og de sendes med
  const draft = setRiderRole(server, "d", "hunter", false, true);
  const change: Record<string, unknown> = buildBulkChange("r1", draft, server, true);
  assert.equal(change.co_captain_id, "b");
  assert.equal(change.luxury_helper_id, "c");
  assert.equal(change.hunter_id, "d");
});

test("#7239 gem: uaendret tom rolle udelades, saa serveren beholder den gemte", () => {
  const server = { ...emptyRaceDraft(), rider_ids: ["a", "d"], captain_id: "a" };
  const draft = setRiderRole(server, "d", "hunter", false, true);
  const change: Record<string, unknown> = buildBulkChange("r1", draft, server, true);
  assert.equal(Object.prototype.hasOwnProperty.call(change, "co_captain_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(change, "luxury_helper_id"), false);
});

test("#7239 gem: en bevidst fjernet rolle sendes eksplicit som null", () => {
  const server = buildDraftsFromEntries(entries).get("r1");
  const draft = setRiderRole(server, "b", "helper", false, true);
  const change: Record<string, unknown> = buildBulkChange("r1", draft, server, true);
  assert.equal(change.co_captain_id, null);
  assert.equal(change.luxury_helper_id, "c");
});

test("#7239 gem i loeb uden rollerne sender hverken felt (gammelt payload uaendret)", () => {
  const server = { ...emptyRaceDraft(), rider_ids: ["a"], captain_id: "a" };
  const change: Record<string, unknown> = buildBulkChange("r2", server, server, false);
  assert.deepEqual(Object.keys(change).sort(), ["captain_id", "free_role_ids", "hunter_id", "raceId", "rider_ids", "sprint_captain_id"]);
});

test("#7239 badge: delt kaptajn faar kaptajn-tinten, luksushjaelper er neutral", () => {
  assert.equal(roleBadgeClass("co_captain"), roleBadgeClass("captain"));
  assert.equal(roleBadgeClass("luxury_helper"), roleBadgeClass("helper"));
});
