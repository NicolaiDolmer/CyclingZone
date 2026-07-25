import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSeasonEndedToast } from "./seasonEndedToast.js";

// #2832-review (fund 2) · POST /admin/seasons/:id/end's success-toast var blind
// for season_ended_notifications-resultatet — et 0-delivered-scenarie var
// usynligt for ejeren ("✅ Sæson afsluttet" uanset om nogen faktisk blev
// notificeret). formatSeasonEndedToast er en ren funktion så vi kan låse
// alle grene uden at rendere komponenten.

test("mangler stats (undefined/null) → generisk success-besked", () => {
  assert.deepEqual(formatSeasonEndedToast(undefined), ["✅ Sæson afsluttet"]);
  assert.deepEqual(formatSeasonEndedToast(null), ["✅ Sæson afsluttet"]);
});

test("emit kastede (skipped:true fra backendens catch) → error-type med årsag synlig", () => {
  const result = formatSeasonEndedToast({ skipped: true, reason: "failed" });
  assert.match(result[0], /IKKE sendt/);
  assert.match(result[0], /failed/);
  assert.equal(result[1], "error");
});

test("eligible=0 (ingen menneske-hold, fx sæson 0) → success uden brøk-tal", () => {
  const result = formatSeasonEndedToast({ eligible: 0, delivered: 0, deduped: 0, failed: 0 });
  assert.deepEqual(result, ["✅ Sæson afsluttet — ingen menneske-hold at notificere"]);
});

test("delivered=0 med eligible>0 (total leverings-fejl) → error-type, tallene synlige (kernefund #2)", () => {
  const result = formatSeasonEndedToast({ eligible: 150, delivered: 0, deduped: 0, failed: 150 });
  assert.equal(result[0], "⚠️ Sæson afsluttet — 0/150 notificeret");
  assert.equal(result[1], "error");
});

test("normal levering (delivered>0) → success med brøk-tal, ingen type (default)", () => {
  const result = formatSeasonEndedToast({ eligible: 150, delivered: 148, deduped: 2, failed: 0 });
  assert.deepEqual(result, ["✅ Sæson afsluttet — 148/150 notificeret"]);
});

test("delvis levering under dedup/retry stadig synlig (ikke skjult som 100%)", () => {
  const result = formatSeasonEndedToast({ eligible: 150, delivered: 90, deduped: 60, failed: 0 });
  assert.equal(result[0], "✅ Sæson afsluttet — 90/150 notificeret");
});
