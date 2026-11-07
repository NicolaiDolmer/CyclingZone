// #2009 · Hover-miniprofilen: hvad kortet viser for egen vs. andens rytter.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRiderHoverCardModel, canHover, flattenHoverCardRow, placeHoverCard, summarizeRaceNow, summarizeRecentResults, type HoverCardRiderRow } from "./riderHoverCardModel.ts";
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

// ── Kort v2 (#2009, ejer 7/11) ───────────────────────────────────────────────

test("v2: form, traethed og plan kun for egen rytter (scouting-fog)", () => {
  const ctx = {
    seasonYear: 2028,
    condition: { form: 61, fatigue: 22, injured: false },
    plan: { role: "captain", tasks: null, effort: "normal" },
  };
  const own = buildRiderHoverCardModel(row(), { ...ctx, viewerTeamId: "team-a" });
  const other = buildRiderHoverCardModel(row(), { ...ctx, viewerTeamId: "team-b" });
  assert.deepEqual(own?.own, { form: 61, fatigue: 22, plan: { role: "captain", tasks: null, effort: "normal" } });
  assert.equal(other?.own, null);
});

test("v2: status-maerker i spillets egne noegler og raekkefoelge", () => {
  const m = buildRiderHoverCardModel(row({ birthdate: "2006-01-01", contract_end_season: 3 }), {
    viewerTeamId: "team-b",
    seasonYear: 2028,
    activeSeasonNumber: 3,
    market: { inAuction: true, listed: false },
    condition: { injured: true },
  });
  assert.deepEqual(m?.badges, ["u23", "injured", "auction", "contractExpiring"]);
});

test("v2: fri rytter har hverken kontrakt eller loen, men stadig vaerdi", () => {
  const m = buildRiderHoverCardModel(row({ team_id: null, team: null, salary: 900, contract_end_season: 4, market_value: 1200 }), { viewerTeamId: "team-a", seasonYear: 2028 });
  assert.equal(m?.contractEndSeason, null);
  assert.equal(m?.salary, null);
  assert.equal(m?.marketValue, 1200);
  assert.equal(m?.teamName, null);
});

test("v2: knapper giver kun mening hvor de kan bruges", () => {
  const own = buildRiderHoverCardModel(row(), { viewerTeamId: "team-a", seasonYear: 2028 });
  const other = buildRiderHoverCardModel(row(), { viewerTeamId: "team-b", seasonYear: 2028 });
  const free = buildRiderHoverCardModel(row({ team_id: null, team: null }), { viewerTeamId: "team-b", seasonYear: 2028 });
  const retired = buildRiderHoverCardModel(row({ is_retired: true }), { viewerTeamId: "team-b", seasonYear: 2028 });
  const loggedOut = buildRiderHoverCardModel(row(), { viewerTeamId: null, seasonYear: 2028 });
  assert.deepEqual(own?.actions, { profile: true, compare: true, watchlist: false, bid: false });
  assert.deepEqual(other?.actions, { profile: true, compare: true, watchlist: true, bid: true });
  assert.equal(free?.actions.bid, false);
  assert.equal(free?.actions.watchlist, true);
  assert.equal(retired?.actions.bid, false);
  assert.equal(retired?.actions.watchlist, false);
  assert.deepEqual(loggedOut?.actions, { profile: true, compare: true, watchlist: false, bid: false });
});

test("summarizeRaceNow: etape, samlet og troejer paa seneste koerte etape", () => {
  const race = summarizeRaceNow({
    raceId: "race-1", raceName: "Loeb A", raceType: "stage_race", stages: 7, stagesCompleted: 3,
    results: [
      { result_type: "stage", stage_number: 3, rank: 12 },
      { result_type: "leader", stage_number: 3, rank: 1 },
      { result_type: "mountain_day", stage_number: 3, rank: 1 },
      { result_type: "points_day", stage_number: 3, rank: 4 },
      // anden etape taeller ikke
      { result_type: "young_day", stage_number: 2, rank: 1 },
    ],
  });
  assert.deepEqual(race, {
    raceId: "race-1", raceName: "Loeb A", stageNumber: 3, stageCount: 7, stageRank: 12, gcRank: 1, jerseys: ["leader", "mountain_day"],
  });
});

test("summarizeRaceNow: endagsloeb har ingen samlet stilling og ingen troejer; ikke startet = ingen etape", () => {
  const oneDay = summarizeRaceNow({ raceId: "r", raceName: null, raceType: "single", stages: 1, stagesCompleted: 1, results: [{ result_type: "stage", stage_number: 1, rank: 2 }, { result_type: "leader", stage_number: 1, rank: 1 }] });
  assert.equal(oneDay?.stageRank, 2);
  assert.equal(oneDay?.gcRank, null);
  assert.deepEqual(oneDay?.jerseys, []);
  const notStarted = summarizeRaceNow({ raceId: "r", raceName: null, raceType: "stage_race", stages: 5, stagesCompleted: 0, results: [] });
  assert.equal(notStarted?.stageNumber, null);
  assert.equal(notStarted?.stageRank, null);
  assert.equal(summarizeRaceNow(null), null);
});

test("summarizeRecentResults: loebsdage, sejre og podier inden for 5 uger", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const rows = [
    { race_id: "a", stage_number: 1, rank: 1, imported_at: day(1) },
    { race_id: "a", stage_number: 2, rank: 3, imported_at: day(2) },
    { race_id: "a", stage_number: 2, rank: 3, imported_at: day(2) }, // dobbelt raekke taeller én gang
    { race_id: "b", stage_number: 1, rank: 40, imported_at: day(20) },
    { race_id: "c", stage_number: 1, rank: null, imported_at: day(30) }, // DNF er stadig en loebsdag
    { race_id: "d", stage_number: 1, rank: 1, imported_at: day(40) }, // uden for vinduet
  ];
  assert.deepEqual(summarizeRecentResults(rows, now), { raceDays: 4, wins: 1, podiums: 2 });
  assert.deepEqual(summarizeRecentResults([], now), { raceDays: 0, wins: 0, podiums: 0 });
});
