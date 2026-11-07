// #2009 · Hover-miniprofilen: hvad kortet viser for egen vs. andens rytter.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRiderHoverCardModel, canHover, flattenHoverCardRow, placeHoverCard, type HoverCardRiderRow } from "./riderHoverCardModel.ts";
import { ABILITY_CATEGORIES, ABILITY_KEYS } from "./generated/abilityRegistry.js";

function abilities(value: number): Record<string, number> {
  return Object.fromEntries(ABILITY_KEYS.map((k: string) => [k, value]));
}

function row(extra: Partial<HoverCardRiderRow> = {}): HoverCardRiderRow {
  return {
    id: "r1",
    firstname: "Ada",
    lastname: "Pedersen",
    birthdate: "2004-03-01",
    nationality_code: "dk",
    primary_type: "climber",
    secondary_type: "gc",
    team_id: "team-a",
    team: { id: "team-a", name: "Hold A" },
    rider_derived_abilities: abilities(40),
    ...extra,
  };
}

test("egen rytter: potentialet maa vises", () => {
  const m = buildRiderHoverCardModel(row(), { viewerTeamId: "team-a", seasonYear: 2028 });
  assert.ok(m);
  assert.equal(m.isOwn, true);
  assert.equal(m.showPotential, true);
});

test("andens rytter: potentialet vises aldrig (scouting-fog)", () => {
  const m = buildRiderHoverCardModel(row(), { viewerTeamId: "team-b", seasonYear: 2028 });
  assert.ok(m);
  assert.equal(m.isOwn, false);
  assert.equal(m.showPotential, false);
});

test("uden viewer-hold og for en fri rytter: ingen potentiale", () => {
  assert.equal(buildRiderHoverCardModel(row(), { viewerTeamId: null })?.showPotential, false);
  const free = buildRiderHoverCardModel(row({ team_id: null, team: null }), { viewerTeamId: "team-a" });
  assert.equal(free?.showPotential, false);
  assert.equal(free?.teamName, null);
});

test("hold-id sammenlignes som tekst (tal fra en tabel, tekst fra en anden)", () => {
  const m = buildRiderHoverCardModel(row({ team_id: "7", team: { id: "7", name: "Hold A" } }), { viewerTeamId: 7 as unknown as string });
  assert.equal(m?.isOwn, true);
});

test("identitet: navn, flag, hold og alder fra sæsonens år", () => {
  const m = buildRiderHoverCardModel(row(), { viewerTeamId: "team-b", seasonYear: 2028 });
  assert.equal(m?.name, "Ada Pedersen");
  assert.equal(m?.nationalityCode, "dk");
  assert.equal(m?.teamName, "Hold A");
  assert.equal(m?.age, 24);
  assert.equal(m?.primaryType, "climber");
  assert.equal(m?.secondaryType, "gc");
});

test("ukendt sæson giver ingen alder, aldrig et gæt", () => {
  assert.equal(buildRiderHoverCardModel(row(), { seasonYear: null })?.age, null);
});

test("evnerne staar i registrets grupper og raekkefoelge, ens for egen og anden", () => {
  const own = buildRiderHoverCardModel(row(), { viewerTeamId: "team-a" });
  const other = buildRiderHoverCardModel(row(), { viewerTeamId: "team-b" });
  for (const m of [own, other]) {
    assert.deepEqual(m?.groups.map((g) => g.key), ABILITY_CATEGORIES.map((c: { key: string }) => c.key));
    assert.deepEqual(m?.groups.flatMap((g) => g.abilities.map((a) => a.key)), [...ABILITY_KEYS]);
    assert.ok(m?.groups.every((g) => g.abilities.every((a) => a.value === 40)));
  }
  assert.deepEqual(own?.groups, other?.groups);
});

test("rating er bedste rolle nu, og den er den samme for egen og anden", () => {
  const own = buildRiderHoverCardModel(row(), { viewerTeamId: "team-a" });
  const other = buildRiderHoverCardModel(row(), { viewerTeamId: "team-b" });
  assert.equal(typeof own?.rating, "number");
  assert.equal(own?.rating, other?.rating);
});

test("manglende evner vises som tomme, ikke som 0", () => {
  const m = buildRiderHoverCardModel(row({ rider_derived_abilities: null }), {});
  assert.ok(m?.groups.every((g) => g.abilities.every((a) => a.value === null)));
  assert.equal(m?.rating, null);
});

test("evner fladet op paa forhaand bevares", () => {
  const flat = { ...row(), rider_derived_abilities: undefined, ...abilities(55) };
  const m = buildRiderHoverCardModel(flat, {});
  assert.ok(m?.groups.every((g) => g.abilities.every((a) => a.value === 55)));
});

test("ingen raekke giver intet kort", () => {
  assert.equal(buildRiderHoverCardModel(null), null);
  assert.equal(flattenHoverCardRow({ id: "" }), null);
});

test("canHover: kun en rigtig hover-enhed aabner paa hover", () => {
  assert.equal(canHover(() => ({ matches: true })), true);
  assert.equal(canHover(() => ({ matches: false })), false);
  assert.equal(canHover(null), false);
  assert.equal(canHover(() => { throw new Error("x"); }), false);
});

test("placeHoverCard: under navnet, over hvis der ikke er plads, og inden for vinduet", () => {
  const anchor = { top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 };
  const card = { width: 360, height: 300 };
  const below = placeHoverCard(anchor, card, { width: 1280, height: 800 });
  assert.equal(below.side, "below");
  assert.equal(below.top, 126);
  assert.equal(below.left, 50);

  const low = { ...anchor, top: 700, bottom: 720 };
  const above = placeHoverCard(low, card, { width: 1280, height: 800 });
  assert.equal(above.side, "above");
  assert.equal(above.top, 700 - 6 - 300);

  const right = { ...anchor, left: 1200, right: 1260 };
  assert.equal(placeHoverCard(right, card, { width: 1280, height: 800 }).left, 1280 - 8 - 360);
});
