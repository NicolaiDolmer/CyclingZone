// #7862 · Startliste-fanen: rygnumre, søgning, nationsfilter, favoritter og synlighed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPTY_START_LIST_FILTER,
  buildStartList,
  filterStartList,
  startListCount,
  startListFavouriteClasses,
  startListFavourites,
  startListNations,
  startListOpensIn,
  type StartListEntry,
} from "./v6StartListModel.ts";
import { RACE_PAGE_V6_TABS, STAGE_SCOPED_TABS, resolveV6Tab, v6Strip, v6Tabs } from "./racePageV6Model.ts";

const rider = (id: string, firstname: string, lastname: string, extra: Record<string, unknown> = {}) => ({ id, firstname, lastname, nationality_code: "DK", birthdate: "1995-05-01", primary_type: "climber", best_role_rating: 70, ...extra });
const entries: StartListEntry[] = [
  { rider_id: "r1", team_id: "tB", rider: rider("r1", "Anna", "Zeta"), team: { id: "tB", name: "Hold B" } },
  { rider_id: "r2", team_id: "tA", rider: rider("r2", "Bo", "Yde", { nationality_code: "it", birthdate: "2004-02-01" }), team: { id: "tA", name: "Hold A" } },
  { rider_id: "r3", team_id: "tA", rider: rider("r3", "Carl", "Andersen", { best_role_rating: null }), team: { id: "tA", name: "Hold A" } },
  { rider_id: "r4", team_id: "tC", rider: rider("r4", "Dan", "Moe"), team: { id: "tC", name: "Hold C" } },
  { rider_id: "r5", team_id: "tB", rider: rider("r5", "Eva", "Bech", { nationality_code: "FR" }), team: { id: "tB", name: "Hold B" } },
];

test("rygnumre pr. hold: første hold 1, 2 ..., næste hold 11, 12 ... (valg 9)", () => {
  const teams = buildStartList(entries, { myTeamId: "tB", seasonYear: 2027 });
  assert.deepEqual(teams.map((t) => t.name), ["Hold A", "Hold B", "Hold C"]);
  assert.deepEqual(teams[0].riders.map((r) => [r.bib, r.lastname]), [[1, "Andersen"], [2, "Yde"]]);
  assert.deepEqual(teams[1].riders.map((r) => [r.bib, r.lastname]), [[11, "Bech"], [12, "Zeta"]]);
  assert.deepEqual(teams[2].riders.map((r) => r.bib), [21]);
  assert.equal(teams[1].mine, true);
  assert.equal(teams[0].mine, false);
});

test("rygnumrene er ens for alle seere (eget hold flytter ikke rækkefølgen)", () => {
  const a = buildStartList(entries, { myTeamId: "tC" });
  const b = buildStartList([...entries].reverse(), { myTeamId: "tA" });
  assert.deepEqual(a.map((t) => t.riders.map((r) => [r.riderId, r.bib])), b.map((t) => t.riders.map((r) => [r.riderId, r.bib])));
});

test("et hold med flere end ni ryttere får et større spring, så numrene aldrig overlapper", () => {
  const big: StartListEntry[] = Array.from({ length: 12 }, (_, i) => ({ rider_id: `x${i}`, team_id: "tA", rider: rider(`x${i}`, "R", `N${String(i).padStart(2, "0")}`), team: { name: "Hold A" } }));
  big.push({ rider_id: "y1", team_id: "tB", rider: rider("y1", "S", "M"), team: { name: "Hold B" } });
  const teams = buildStartList(big);
  const bibs = teams.flatMap((t) => t.riders.map((r) => r.bib));
  assert.equal(new Set(bibs).size, bibs.length);
  assert.equal(teams[1].riders[0].bib, 21);
});

test("hold der har meldt fra står ikke på listen; dubletter tælles én gang", () => {
  const teams = buildStartList([...entries, entries[0]], { withdrawnTeamIds: new Set(["tC"]) });
  assert.deepEqual(teams.map((t) => t.teamId), ["tA", "tB"]);
  assert.equal(startListCount(teams), 4);
});

test("U25 følger fødselsdatoen og sæsonens år; rating er rytterens bedste rolle, ellers intet tal", () => {
  const teams = buildStartList(entries, { seasonYear: 2027 });
  const yde = teams[0].riders.find((r) => r.lastname === "Yde")!;
  const andersen = teams[0].riders.find((r) => r.lastname === "Andersen")!;
  assert.equal(yde.u25, true);
  assert.equal(andersen.u25, false);
  assert.equal(andersen.rating, null);
  assert.equal(yde.rating, 70);
  assert.equal(yde.nation, "it");
  // Uden sæsonens år gættes der ikke.
  assert.equal(buildStartList(entries)[0].riders.find((r) => r.lastname === "Yde")!.u25, false);
});

const names: Record<string, string[]> = { dk: ["Danmark", "Denmark"], it: ["Italien", "Italy"], fr: ["Frankrig", "France"] };
const nationNames = (c: string) => names[c] ?? [];

test("søgning på rytter, hold og nation (navn på begge sprog og koden)", () => {
  const teams = buildStartList(entries);
  const q = (query: string) => filterStartList(teams, { ...EMPTY_START_LIST_FILTER, query }, nationNames).flatMap((t) => t.riders.map((r) => r.riderId));
  assert.deepEqual(q("yde"), ["r2"]);
  assert.deepEqual(q("italy"), ["r2"]);
  assert.deepEqual(q("frankrig"), ["r5"]);
  assert.deepEqual(q("hold"), ["r3", "r2", "r5", "r1", "r4"]);
  assert.deepEqual(q("hold a it"), ["r2"]);
  assert.deepEqual(q("ingen"), []);
});

test("nationsfilter og Mit hold; hold uden ryttere tilbage udelades", () => {
  const teams = buildStartList(entries, { myTeamId: "tB" });
  const dk = filterStartList(teams, { ...EMPTY_START_LIST_FILTER, nation: "dk" });
  assert.deepEqual(dk.map((t) => t.teamId), ["tA", "tB", "tC"]);
  assert.equal(startListCount(dk), 3);
  const mine = filterStartList(teams, { ...EMPTY_START_LIST_FILTER, mineOnly: true });
  assert.deepEqual(mine.map((t) => t.teamId), ["tB"]);
  assert.equal(filterStartList(teams, { query: "", mineOnly: true, nation: "it" }).length, 0);
  assert.deepEqual(startListNations(teams, (c) => nationNames(c)[1] ?? ""), [
    { code: "dk", name: "Denmark" }, { code: "fr", name: "France" }, { code: "it", name: "Italy" },
  ]);
});

test("feltet åbner som divisionernes startlister: inden for horisonten, ellers dage til det åbner", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 10, 16, 12);
  assert.equal(startListOpensIn(null, now), null);
  assert.equal(startListOpensIn(now + 3 * day, now), null);
  assert.equal(startListOpensIn(now - day, now), null);
  assert.equal(startListOpensIn(now + 10 * day, now), 3);
  assert.equal(startListOpensIn(now + 7 * day + 1000, now), 1);
});

const res = [
  { result_type: "leader", stage_number: 2, rank: 2, rider_id: "r2", finish_time: "+0:12", rider: { firstname: "Bo", lastname: "Yde", nationality_code: "IT", team: { id: "tA", name: "Hold A" } } },
  { result_type: "leader", stage_number: 2, rank: 1, rider_id: "r1", finish_time: "4:10:00", rider: { firstname: "Anna", lastname: "Zeta", nationality_code: "DK", team: { id: "tB", name: "Hold B" } } },
  { result_type: "points_day", stage_number: 2, rank: 1, rider_id: "r5", rider: { firstname: "Eva", lastname: "Bech", team: { id: "tB", name: "Hold B" } } },
  { result_type: "leader", stage_number: 1, rank: 1, rider_id: "r4", finish_time: "2:00:00", rider: { firstname: "Dan", lastname: "Moe", team: { id: "tC", name: "Hold C" } } },
];

test("favoritter pr. klassement efter den senest kørte etape, med resultatlinje (valg 10)", () => {
  const gc = startListFavourites(res, { stagesCompleted: 2, cls: "gc", myTeamId: "tB" });
  assert.deepEqual(gc.map((f) => [f.rank, f.name, f.gap, f.mine]), [[1, "Anna Zeta", null, true], [2, "Bo Yde", "+0:12", false]]);
  assert.equal(gc[1].nation, "it");
  assert.equal(gc[1].teamName, "Hold A");
  assert.deepEqual(startListFavourites(res, { stagesCompleted: 2, cls: "points" }).map((f) => f.riderId), ["r5"]);
  assert.deepEqual(startListFavouriteClasses(res, 2), ["gc", "points"]);
});

test("før første etape er der ingen favoritter (ingen synlige resultater i løbet)", () => {
  assert.deepEqual(startListFavourites(res, { stagesCompleted: 0, cls: "gc" }), []);
  assert.deepEqual(startListFavouriteClasses(res, 0), []);
});

test("faneplanen har Startliste; Hold følger etapen i striben (valg 13)", () => {
  assert.ok((RACE_PAGE_V6_TABS as readonly string[]).includes("start"));
  assert.ok(v6Tabs().includes("start"));
  assert.equal(resolveV6Tab("start", { ridden: false, isStageRace: true }), "start");
  assert.ok(STAGE_SCOPED_TABS.includes("team"));
  assert.deepEqual(v6Strip({ activeTab: "team", isStageRace: true, selectedStage: 3, tacticsStage: 4 }), { selected: 3, target: "page" });
  assert.deepEqual(v6Strip({ activeTab: "start", isStageRace: true, selectedStage: 3, tacticsStage: 4 }), { selected: 3, target: "open" });
});

test("fanen viser aldrig andre holds roller, form eller rutematch", () => {
  const src = readFileSync(new URL("./V6StartList.tsx", import.meta.url), "utf8");
  const model = readFileSync(new URL("./v6StartListModel.ts", import.meta.url), "utf8");
  for (const text of [src, model]) {
    assert.doesNotMatch(text, /race_role|\bform\b.*select|fatigue|route_?match|\bfit\b/);
  }
});
