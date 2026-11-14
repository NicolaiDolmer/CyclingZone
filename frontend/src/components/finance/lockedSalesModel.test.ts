// #6181 · Saelgers laaste salg: svar-rensning, "slutter om"-noeglen, Hjaelp-tvillingen,
// og beviset for at intet synligt aendrer sig, saa laenge intet er laast.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NO_LOCKED_SALES, canReuseShared, endsInKey, lockedSalesFromResponse, lockedSalesShareKey, nextLockedSales } from "./lockedSalesModel.ts";
import { isHelpBlockVisible } from "../../pages/helpFlagGates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const locale = (lng: string, ns: string) => JSON.parse(src(`../../../public/locales/${lng}/${ns}.json`));

const SALE = { id: "e1", dealType: "transfer", riders: [{ id: "r1", name: "Rytter En" }], race: { id: "x", name: "Loeb" }, endsAt: null, daysLeft: 2, amount: 1250000 };

test("lockedSalesFromResponse: summerer de gyldige salg", () => {
  const out = lockedSalesFromResponse({ total: 1, sales: [SALE, { ...SALE, id: "e2", amount: 640000 }] });
  assert.equal(out.total, 1890000);
  assert.equal(out.sales.length, 2);
});

test("lockedSalesFromResponse: tomt, fejl og skrald giver intet laast (intet renderes)", () => {
  for (const bad of [null, undefined, "x", 42, {}, { sales: null }, { total: 0, sales: [] }, { sales: [{ id: 1, amount: 5 }] }, { sales: [{ ...SALE, amount: 0 }] }]) {
    assert.equal(lockedSalesFromResponse(bad), NO_LOCKED_SALES);
  }
  assert.equal(NO_LOCKED_SALES.total, 0);
});

test("endsInKey: dage tilbage, i dag, eller intet loeb", () => {
  assert.deepEqual(endsInKey(3), { key: "lockedSalesBox.endsIn", count: 3 });
  assert.deepEqual(endsInKey(0), { key: "lockedSalesBox.endsToday" });
  assert.equal(endsInKey(null), null);
});

test("lockedSalesShareKey (Codex P1): to brugere med samme saldo deler aldrig svar", () => {
  assert.notEqual(lockedSalesShareKey("bruger-a", 500000), lockedSalesShareKey("bruger-b", 500000));
  assert.equal(lockedSalesShareKey("bruger-a", 500000), lockedSalesShareKey("bruger-a", 500000), "samme bruger og saldo deler");
  assert.notEqual(lockedSalesShareKey("bruger-a", 500000), lockedSalesShareKey("bruger-a", 600000), "ny saldo henter igen");
  const component = src("./LockedSaleEscrows.tsx");
  assert.match(component, /const key = lockedSalesShareKey\(userId, refreshKey\);/, "komponenten bruger den proevede noegle");
});

test("canReuseShared: kun samme noegle inden for vinduet, og aldrig ved en ny besked", () => {
  const shared = { key: lockedSalesShareKey("bruger-a", 500), at: 1_000 };
  assert.equal(canReuseShared(shared, shared.key, 2_000, 5_000, false), true);
  assert.equal(canReuseShared(shared, shared.key, 2_000, 5_000, true), false, "fresh henter altid paa ny");
  assert.equal(canReuseShared(shared, lockedSalesShareKey("bruger-b", 500), 2_000, 5_000, false), false);
  assert.equal(canReuseShared(shared, shared.key, 6_000, 5_000, false), false, "udloebet vindue");
  assert.equal(canReuseShared(null, shared.key, 2_000, 5_000, false), false);
});

test("nextLockedSales: en fejl beholder det sidst kendte svar; kun et gyldigt svar aendrer visningen", () => {
  const locked = lockedSalesFromResponse({ sales: [SALE] });
  const first = nextLockedSales(null, "bruger-a", locked);
  assert.deepEqual(first, { userId: "bruger-a", data: locked });
  assert.equal(nextLockedSales(first, "bruger-a", null), first, "429/500/netvaerk: linjen bliver staaende");
  assert.deepEqual(nextLockedSales(first, "bruger-a", NO_LOCKED_SALES), { userId: "bruger-a", data: NO_LOCKED_SALES }, "gyldigt tomt svar fjerner linjen");
  assert.deepEqual(nextLockedSales(first, "bruger-b", null), { userId: "bruger-b", data: NO_LOCKED_SALES }, "ny bruger arver aldrig forriges salg");
});

test("menuen opdaterer sig selv: ved sideskift, fokus og ny besked, og alle steder faar samme svar", () => {
  const component = src("./LockedSaleEscrows.tsx");
  assert.match(component, /\}, \[refreshKey, pathname\]\);/, "sideskift henter igen");
  assert.match(component, /window\.addEventListener\("focus", refresh\);/);
  assert.match(component, /window\.addEventListener\(LOCKED_SALES_REFRESH_EVENT, refreshFresh\);/);
  assert.match(component, /const refreshFresh = \(\) => \{ void loadLockedSales\(refreshKey, \{ fresh: true \}\); \};/, "en ny besked genbruger aldrig det delte svar");
  assert.match(component, /if \(gen !== generation \|\| current\.session\?\.user\?\.id !== userId\) return;/, "et forsinket svar fra en anden session vises aldrig");
  assert.match(component, /for \(const listener of listeners\) listener\(latest\.data\);/, "hvert svar gaar til alle steder paa skaermen");
  assert.match(component, /return res\.ok \? lockedSalesFromResponse\(res\.data\) : null;/, "en fejl er ikke 'intet laast'");
  const layout = src("../Layout.jsx").replace(/\r\n/g, "\n");
  assert.match(layout, /channel\.on\("postgres_changes", \{ event: "\*", schema: "public", table: "notifications"[^\n]*\n\s*async \(\) => \{\n\s*window\.dispatchEvent\(new Event\(LOCKED_SALES_REFRESH_EVENT\)\);/, "en ny besked henter de laaste salg igen");
});

test("kontakten slukket: Hjaelp viser dagens tekst, aldrig tvillingen; taendt: omvendt", () => {
  const off = { sale_escrow_enabled: false };
  const on = { sale_escrow_enabled: true };
  assert.equal(isHelpBlockVisible("transfers", "midRaceTransfers", off), true);
  assert.equal(isHelpBlockVisible("transfers", "midRaceTransfersEscrow", off), false);
  assert.equal(isHelpBlockVisible("transfers", "midRaceTransfers", on), false);
  assert.equal(isHelpBlockVisible("transfers", "midRaceTransfersEscrow", on), true);
  // Ukendt flag-svar (ingen raekke) er slukket, ligesom pengelaasen selv.
  assert.equal(isHelpBlockVisible("transfers", "midRaceTransfers", {}), true);
});

test("kontakten slukket: menu, dashboard og Oekonomi viser kun det ekstra, naar noget er laast", () => {
  const component = src("./LockedSaleEscrows.tsx");
  assert.match(component, /if \(total <= 0\) return null;/, "linjen under saldoen skjules uden laaste salg");
  assert.match(component, /if \(data\.total <= 0\) return null;/, "boksen skjules uden laaste salg");
  const layout = src("../Layout.jsx");
  const dashboard = src("../../pages/DashboardPage.jsx");
  const finance = src("../../pages/FinancePage.jsx");
  assert.match(layout, /<LockedSalesLine refreshKey=\{balance\}/);
  assert.match(dashboard, /<LockedSalesLine refreshKey=\{\/\*\* @type \{any\} \*\/ \(team\)\?\.balance\}/);
  assert.match(finance, /<LockedSalesLine refreshKey=\{\/\*\* @type \{any\} \*\/ \(team\)\?\.balance\}/);
  assert.match(finance, /<LockedSaleEscrows refreshKey=\{\/\*\* @type \{any\} \*\/ \(team\)\?\.balance\} \/>/);
  // Saldo-tallet selv er uroert: det er stadig det, holdet kan bruge.
  assert.match(layout, /\{formatNumber\(balance\)\} CZ\$/);
  assert.match(finance, /\{formatNumber\(team\?\.balance \|\| 0\)\} CZ\$/);
});

test("ejerens ord (EN + DA) staar ordret i oversaettelserne", () => {
  const en = locale("en", "finance");
  const da = locale("da", "finance");
  assert.equal(en.balance.lockedSales, "+{value} CZ$ locked");
  assert.equal(da.balance.lockedSales, "+{value} CZ$ låst");
  assert.equal(en.lockedSalesBox.heading, "Locked until transfer");
  assert.equal(da.lockedSalesBox.heading, "Låst til holdskifte");
  assert.equal(en.lockedSalesBox.payout, "Paid out when the rider changes teams");
  assert.equal(da.lockedSalesBox.payout, "Udbetales, når rytteren skifter hold");
  assert.match(da.lockedSalesBox.endsIn, /other \{slutter om # dage\}/);
  assert.match(en.lockedSalesBox.endsIn, /other \{ends in # days\}/);
  const daMsg = locale("da", "backendMessages").notif.saleEscrow;
  assert.equal(daMsg.lockedMessage, "{riderName} er solgt for {price} CZ$. Pengene er låst og udbetales, når han skifter hold efter sit etapeløb.");
  assert.equal(daMsg.releasedMessage, "{riderName} har skiftet hold. {amount} CZ$ er nu på din saldo.");
  for (const lng of ["en", "da", "es", "fr", "nl"]) {
    const f = locale(lng, "finance");
    assert.ok(f.balance.lockedSales && f.lockedSalesBox.heading && f.lockedSalesBox.payout && f.lockedSalesBox.endsIn && f.lockedSalesBox.endsToday, `${lng}: finance-noegler`);
    const b = locale(lng, "backendMessages").notif.saleEscrow;
    assert.ok(b.lockedMessage && b.releasedTitle && b.releasedMessage, `${lng}: beskeder`);
    assert.ok(locale(lng, "help").sections.transfers.midRaceTransfersEscrow.text, `${lng}: hjaelp`);
  }
});
