import test from "node:test";
import assert from "node:assert/strict";
import { SUNDAY_VALUE_FROM_HOUR } from "../../../backend/lib/sundayValueSweep.js";
import { VALUE_UPDATE_HOUR, VALUE_UPDATE_WEEKDAY, nextSundayValueUpdateUTC } from "./auctionValueUpdateWindow.js";

// #4419 co-SSOT-guard (samme disciplin som staffSeverance.parity.test.js):
// serveren ejer hvornår søndagens værdi-pipeline kører (sundayValueSweep.js),
// men frontendens #4004-varsel i bud-flowet regner tidspunktet ud selv, fordi
// backend-kode ikke må bundles ind i klienten. Da kadencen flyttede fra kl. 22
// til kl. 06, blev kun backend rettet, og varslet forsvandt tavst for hver
// auktion der lukker søndag mellem 06 og 22. Denne test binder de to tal
// sammen, så næste kadence-ændring fejler i CI i stedet for i bud-flowet.
test("frontendens VALUE_UPDATE_HOUR matcher backendens SUNDAY_VALUE_FROM_HOUR (co-SSOT)", () => {
  assert.equal(VALUE_UPDATE_HOUR, SUNDAY_VALUE_FROM_HOUR);
});

test("varslet regner med søndag, samme ugedag som backendens gate", () => {
  assert.equal(VALUE_UPDATE_WEEKDAY, 0);
  // 2026-05-05 er en tirsdag; næste refresh skal lande på en søndag.
  const next = nextSundayValueUpdateUTC(new Date("2026-05-05T10:00:00.000Z"));
  assert.equal(next.getUTCDay(), VALUE_UPDATE_WEEKDAY);
});
