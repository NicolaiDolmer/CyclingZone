// #8060: visningsmodellen for akademi-regnskabet pr. sæson + kildekontrakter
// for fanen (repoet kører node --test uden DOM-renderer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerLines, netTone, parseAcademyLedger, signedAmount } from "./academyLedgerModel.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

const body = {
  enabled: true,
  current: {},
  cumulative: {},
  sales: [],
  ledger: {
    seasons: [
      { seasonId: "s5", seasonNumber: 5, isCurrent: true, offerSignings: 0, youthAuctionBuys: 200, drift: 0, salesCount: 1, salesProceeds: 300, net: 100 },
      { seasonId: "s4", seasonNumber: 4, isCurrent: false, offerSignings: 40, youthAuctionBuys: 0, drift: 10, salesCount: 1, salesProceeds: 100, net: 50 },
    ],
    total: { offerSignings: 40, youthAuctionBuys: 200, drift: 10, salesCount: 2, salesProceeds: 400, net: 150 },
    currentSeasonId: "s5",
    showDrift: true,
    driftIsHistoric: true,
    poolSize: 2,
    sales: [
      { riderId: "r1", riderName: "B Auction", soldAt: "2026-10-05T10:00:00Z", price: 300, via: "auction", origin: "youthAuction", seasonId: "s5", seasonNumber: 5 },
      { riderId: "r2", riderName: null, soldAt: null, price: 100, via: "transfer", origin: "offer", seasonId: null, seasonNumber: null },
      { riderName: "uden id" },
    ],
  },
};

test("uden ledger-feltet (kontakten slukket) er der intet regnskab", () => {
  assert.equal(parseAcademyLedger({ enabled: true, current: {}, cumulative: {}, sales: [] }), null);
  assert.equal(parseAcademyLedger(null), null);
  assert.equal(parseAcademyLedger({ ledger: { seasons: "nej" } }), null);
});

test("svaret læses: sæsoner i backendens rækkefølge, salg uden id droppes", () => {
  const ledger = parseAcademyLedger(body);
  assert.ok(ledger);
  assert.deepEqual(ledger.seasons.map((s) => s.seasonNumber), [5, 4]);
  assert.equal(ledger.seasons[0].isCurrent, true);
  assert.equal(ledger.total.net, 150);
  assert.equal(ledger.sales.length, 2);
  assert.equal(ledger.sales[0].origin, "youthAuction");
  assert.equal(ledger.sales[1].via, "transfer");
  assert.equal(ledger.sales[1].riderName, null);
});

test("linjerne: drift kun når der er bogført drift, mærket historisk når den er stoppet", () => {
  assert.deepEqual(ledgerLines({ showDrift: false, driftIsHistoric: false }).map((l) => l.key),
    ["offerSignings", "youthAuctionBuys", "salesProceeds"]);
  const historic = ledgerLines({ showDrift: true, driftIsHistoric: true });
  assert.equal(historic.find((l) => l.key === "drift")?.labelKey, "driftHistoric");
  assert.equal(ledgerLines({ showDrift: true, driftIsHistoric: false }).find((l) => l.key === "drift")?.labelKey, "drift");
  for (const l of historic) assert.equal(l.sign, l.key === "salesProceeds" ? 1 : -1, l.key);
});

test("udgifter vises med minus, 0 uden minus; netto-tonen følger fortegnet", () => {
  assert.equal(signedAmount(200, -1), -200);
  assert.equal(Object.is(signedAmount(0, -1), 0), true);
  assert.equal(signedAmount(300, 1), 300);
  assert.equal(netTone(5), "positive");
  assert.equal(netTone(-5), "negative");
  assert.equal(netTone(0), "neutral");
});

test("fanen: ready-gate på det lazy namespace og hentning fra endpointet", () => {
  const tab = read("AcademyLedgerTab.tsx");
  assert.match(tab, /\{ t, ready \} = useTranslation\("academyLedger"\)/);
  assert.match(tab, /if \(!ready \|\|/);
  assert.match(tab, /<th scope="col"/, "sæsontabellen har kolonneoverskrifter");
  assert.match(tab, /tabular-nums/);
  const hook = read("useAcademyLedger.ts");
  assert.match(hook, /apiFetch\("\/api\/academy\/pnl"/);
  assert.match(hook, /finally \{\s*setLoading\(false\);/);
});

test("nøglerne findes i alle fem sprog med samme sæt", () => {
  const keysOf = (obj: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
  const locale = (l: string) => JSON.parse(readFileSync(join(here, `../../../public/locales/${l}/academyLedger.json`), "utf8"));
  const en = keysOf(locale("en"));
  for (const l of ["da", "es", "fr", "nl"]) assert.deepEqual(keysOf(locale(l)), en, l);
  const tab = read("AcademyLedgerTab.tsx");
  for (const key of ["title", "caption", "colSeason", "thisSeason", "net", "total", "salesTitle", "emptySalesTitle", "errorTitle", "retry"]) {
    assert.ok(en.includes(key), key);
    assert.match(tab, new RegExp(`t\\("${key}"`), `fanen bruger ${key}`);
  }
});
