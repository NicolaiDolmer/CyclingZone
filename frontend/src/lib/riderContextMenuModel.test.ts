// #7858 · Hoejreklik-menuen: valgene pr. ejerskab (ejer-godkendt menu 7/11).
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRiderContextMenu, isContextMenuKey, nextMenuIndex, placeContextMenu, riderMenuOwnership,
  type RiderMenuInput,
} from "./riderContextMenuModel.ts";

function input(extra: Partial<RiderMenuInput> = {}): RiderMenuInput {
  return {
    riderId: "r1",
    viewerTeamId: "team-a",
    riderTeamId: "team-b",
    loaded: true,
    onWatchlist: false,
    canMessageManager: true,
    currentRaceId: null,
    ...extra,
  };
}

const keys = (i: RiderMenuInput) => buildRiderContextMenu(i).map((x) => x.key);

test("alle ryttere: profil, sammenlign, resultater, altid foerst", () => {
  for (const i of [input(), input({ riderTeamId: "team-a" }), input({ viewerTeamId: null }), input({ loaded: false })]) {
    assert.deepEqual(keys(i).slice(0, 3), ["profile", "compare", "results"]);
  }
  const items = buildRiderContextMenu(input());
  assert.equal(items[0].href, "/riders/r1");
  assert.equal(items[1].href, "/compare?ids=r1");
  assert.equal(items[2].href, "/riders/r1?tab=results");
});

test("foer data er hentet: kun valgene for alle (ingen gaet paa ejerskab)", () => {
  assert.deepEqual(keys(input({ loaded: false })), ["profile", "compare", "results"]);
  assert.equal(riderMenuOwnership(input({ loaded: false })), "unknown");
});

test("andens rytter: oenskeliste, bud, scout, skriv til manageren", () => {
  assert.deepEqual(keys(input()), ["profile", "compare", "results", "watchlistAdd", "bid", "scout", "message"]);
  assert.deepEqual(keys(input({ onWatchlist: true })), ["profile", "compare", "results", "watchlistRemove", "bid", "scout", "message"]);
  const scout = buildRiderContextMenu(input()).find((x) => x.key === "scout");
  assert.equal(scout?.href, "/riders/r1?tab=scouting");
});

test("andens rytter: AI-hold faar ingen besked, fri rytter intet bud og ingen besked", () => {
  assert.equal(keys(input({ canMessageManager: false })).includes("message"), false);
  const free = keys(input({ riderTeamId: null }));
  assert.equal(free.includes("bid"), false);
  assert.equal(free.includes("message"), false);
  assert.equal(free.includes("scout"), true);
});

test("andens rytter: ukendt oenskeliste-status viser hverken til eller fra", () => {
  const k = keys(input({ onWatchlist: null }));
  assert.equal(k.includes("watchlistAdd") || k.includes("watchlistRemove"), false);
});

test("egen rytter: transferliste, forlaeng, afskedig (sidst og som fare); ingen bud/scout/besked", () => {
  const own = buildRiderContextMenu(input({ riderTeamId: "team-a" }));
  assert.deepEqual(own.map((x) => x.key), ["profile", "compare", "results", "transferList", "extend", "dismiss"]);
  const dismiss = own.at(-1);
  assert.equal(dismiss?.key, "dismiss");
  assert.equal(dismiss?.danger, true);
  // Afskedigelse foerer til profilen, hvor RiderManageActions bekraefter.
  assert.equal(dismiss?.href, "/riders/r1");
  assert.equal(own.find((x) => x.key === "transferList")?.href, "/riders/r1?sell=1");
});

test("egen rytter i et loeb: ret plan og skift rolle peger paa loebets taktik", () => {
  const own = buildRiderContextMenu(input({ riderTeamId: "team-a", currentRaceId: "race-9" }));
  assert.deepEqual(own.map((x) => x.key), ["profile", "compare", "results", "plan", "role", "transferList", "extend", "dismiss"]);
  assert.equal(own.find((x) => x.key === "plan")?.href, "/races/race-9?tab=tactics");
});

test("pensioneret rytter: kun valgene for alle, ogsaa paa eget hold", () => {
  assert.deepEqual(keys(input({ isRetired: true })), ["profile", "compare", "results"]);
  assert.deepEqual(keys(input({ isRetired: true, riderTeamId: "team-a" })), ["profile", "compare", "results"]);
});

test("ikke logget ind / intet hold: kun valgene for alle", () => {
  assert.deepEqual(keys(input({ viewerTeamId: null })), ["profile", "compare", "results"]);
  assert.equal(riderMenuOwnership(input({ viewerTeamId: null })), "none");
});

test("hold-id sammenlignes som tekst", () => {
  assert.equal(riderMenuOwnership({ viewerTeamId: "7", riderTeamId: 7 as unknown as string, loaded: true }), "own");
});

test("loebsfilm er aldrig et valg", () => {
  const all = [input(), input({ riderTeamId: "team-a", currentRaceId: "x" })].flatMap(keys);
  assert.equal(all.some((k) => /film|playback|story/i.test(k)), false);
});

test("tastatur: Shift+F10 og kontekst-tasten aabner; piletaster ruller rundt", () => {
  assert.equal(isContextMenuKey({ key: "ContextMenu" }), true);
  assert.equal(isContextMenuKey({ key: "F10", shiftKey: true }), true);
  assert.equal(isContextMenuKey({ key: "F10" }), false);
  assert.equal(nextMenuIndex(-1, 4, "ArrowDown"), 0);
  assert.equal(nextMenuIndex(3, 4, "ArrowDown"), 0);
  assert.equal(nextMenuIndex(0, 4, "ArrowUp"), 3);
  assert.equal(nextMenuIndex(2, 4, "Home"), 0);
  assert.equal(nextMenuIndex(0, 4, "End"), 3);
  assert.equal(nextMenuIndex(0, 0, "ArrowDown"), -1);
});

test("placeContextMenu: ved markoeren, flipper ved kanten og bliver i vinduet", () => {
  const vp = { width: 1280, height: 800 };
  assert.deepEqual(placeContextMenu({ x: 100, y: 100 }, { width: 256, height: 300 }, vp), { top: 100, left: 100 });
  assert.deepEqual(placeContextMenu({ x: 1200, y: 700 }, { width: 256, height: 300 }, vp), { top: 400, left: 944 });
  const tiny = placeContextMenu({ x: 5, y: 5 }, { width: 256, height: 300 }, { width: 200, height: 200 });
  assert.equal(tiny.left, 8);
  assert.equal(tiny.top, 8);
});
