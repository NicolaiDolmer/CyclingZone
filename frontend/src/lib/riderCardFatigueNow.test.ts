// #7801 (dom 2 paa #8054): rytterkortets klientdel for traethed lige nu.
// Slukket = 0 kald og morgenens tal; taendt = ét kald, enhver fejl = "-", svar = tallet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchRiderCardFatigueNow, riderCardFatigue } from "./riderCardFatigueNow.ts";
import type { ApiFetchResult } from "./apiFetch.ts";

const HEADERS = async () => ({ Authorization: "Bearer test" });

function fetcherReturning(result: ApiFetchResult | (() => never)) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (typeof result === "function") return result();
    return result;
  };
  return { calls, fetcher };
}

async function shown(opening: number | null, enabled: boolean, result: ApiFetchResult | (() => never)) {
  const f = fetcherReturning(result);
  const value = await fetchRiderCardFatigueNow({ riderId: "r1", enabled, apiBase: "", getHeaders: HEADERS, fetcher: f.fetcher });
  return { fatigue: riderCardFatigue(opening, enabled, value), calls: f.calls };
}

test("slukket: intet kald, og kortet viser morgenens tal som foer", async () => {
  const r = await shown(51, false, { ok: true, status: 200, data: { enabled: true, own: true, fatigue: 89 } });
  assert.equal(r.calls.length, 0);
  assert.equal(r.fatigue, 51);
  assert.equal(riderCardFatigue(51, false, "pending"), 51, "slukket venter aldrig");
});

test("taendt og svar: ét kald, og kortet viser tallet lige nu", async () => {
  const r = await shown(51, true, { ok: true, status: 200, data: { enabled: true, own: true, fatigue: 89 } });
  assert.deepEqual(r.calls, ["/api/riders/r1/fatigue-now"]);
  assert.equal(r.fatigue, 89);
});

test("taendt og enhver fejl: streg, aldrig morgenens tal", async () => {
  const failures: Array<[string, ApiFetchResult | (() => never)]> = [
    ["netvaerk", { ok: false, status: 0, data: null, networkError: true }],
    ["429", { ok: false, status: 429, data: null, limited: true }],
    ["500", { ok: false, status: 500, data: { error: "fatigue_now_failed" } }],
    ["503", { ok: false, status: 503, data: null }],
    ["401", { ok: false, status: 401, data: null, unauthorized: true }],
    ["tom krop", { ok: true, status: 200, data: null }],
    ["ugyldigt tal", { ok: true, status: 200, data: { enabled: true, own: true, fatigue: "89" } }],
    ["tallet ukendt", { ok: true, status: 200, data: { enabled: true, own: true, fatigue: null } }],
    ["ikke egen", { ok: true, status: 200, data: { enabled: true, own: false, fatigue: null } }],
    ["kast", () => { throw new Error("boom"); }],
  ];
  for (const [name, result] of failures) {
    const r = await shown(51, true, result);
    assert.equal(r.calls.length, 1, name);
    assert.equal(r.fatigue, null, name);
  }
});

test("taendt uden session: streg og intet kald", async () => {
  const f = fetcherReturning({ ok: true, status: 200, data: {} });
  const value = await fetchRiderCardFatigueNow({ riderId: "r1", enabled: true, apiBase: "", getHeaders: async () => null, fetcher: f.fetcher });
  assert.equal(riderCardFatigue(51, true, value), null);
  assert.equal(f.calls.length, 0);
});

test("taendt, men serveren siger slukket: morgenens tal som foer", async () => {
  const r = await shown(51, true, { ok: true, status: 200, data: { enabled: false } });
  assert.equal(r.fatigue, 51);
});

test("taendt og kaldet koerer endnu: streg, ikke morgenens tal", () => {
  assert.equal(riderCardFatigue(51, true, "pending"), null);
});

test("kortet henter ikke tallet i fetchRiderCard (blokerer ikke foerste visning) og laeser kontakten paa klienten", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/ui/RiderHoverCard.tsx", import.meta.url)), "utf8");
  const fetchCard = src.slice(src.indexOf("async function fetchRiderCard"), src.indexOf("const cardCache"));
  assert.ok(fetchCard.length > 0);
  assert.doesNotMatch(fetchCard, /loadFatigueNow|fatigue-now/, "fetchRiderCard maa ikke vente paa kaldet");
  assert.match(fetchCard, /fatigueLive: ownRider && riderCardFatigueNowEnabled\(\)/);
  assert.match(src, /const fatigue = useLiveFatigue\(riderId, data\)/);
  const icon = readFileSync(fileURLToPath(new URL("../components/rider/RiderNameIcon.tsx", import.meta.url)), "utf8");
  assert.match(icon, /FATIGUE_NOW_FLAG_KEY = "fatigue_now_7801"/);
  assert.match(icon, /fatigueNowSnapshot = flags\?\.\[FATIGUE_NOW_FLAG_KEY\] === true/, "kontakten kommer fra ikonets eget flag-svar");
});
