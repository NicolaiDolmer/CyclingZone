import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNotificationLink } from "./notificationLink.js";

// #3496: tilbuds-/modbuds-/byttehandels-notifikationer skal føre til
// beslutningen (/transfers), IKKE rytterprofilen — selvom backend altid
// sætter metadata.riderId på dem (transferNotifications.js's withRider).
for (const type of [
  "transfer_offer_received",
  "transfer_offer_accepted",
  "transfer_offer_rejected",
  "transfer_offer_withdrawn",
  "transfer_counter",
]) {
  test(`#3496 ${type} med riderId lander stadig på fallbackLink (/transfers), ikke rytterprofilen`, () => {
    const link = resolveNotificationLink(
      { type, metadata: { riderId: "rider-1" }, related_id: "offer-1" },
      "/transfers",
    );
    assert.equal(link, "/transfers");
  });
}

// #3491: scout-rapport for en enkelt-rytter-undersøgelse skal lande direkte
// på scout-fanen — ikke rytterprofilens standardfane.
test("#3491 scout_report_ready (target-kind, riderId sat) deep-linker til rytterprofilens scout-fane", () => {
  const link = resolveNotificationLink(
    { type: "scout_report_ready", metadata: { riderId: "rider-2" } },
    "/scouting",
  );
  assert.equal(link, "/riders/rider-2?tab=scouting");
});

test("#3491 scout_report_ready (mission-kind, intet riderId) falder tilbage til fallbackLink", () => {
  const link = resolveNotificationLink(
    { type: "scout_report_ready", metadata: { kind: "mission" } },
    "/scouting",
  );
  assert.equal(link, "/scouting");
});

// #1486: generisk riderId-regel gælder uændret for alle andre typer.
test("#1486 en vilkårlig notifikation med metadata.riderId deep-linker til rytterprofilen", () => {
  const link = resolveNotificationLink(
    { type: "bid_received", metadata: { riderId: "rider-3" } },
    "/auctions",
  );
  assert.equal(link, "/riders/rider-3");
});

// #921: legacy "Transferrygte" bruger related_id (ingen metadata.riderId).
test("#921 transfer_interest uden metadata bruger related_id som riderId", () => {
  const link = resolveNotificationLink(
    { type: "transfer_interest", related_id: "rider-4" },
    "/transfers",
  );
  assert.equal(link, "/riders/rider-4");
});

// #1952/#3243: resultat-notifikationer deep-linker til løbets resultatside.
test("#1952/#3243 race_result og stage_result deep-linker til /races/:raceId", () => {
  assert.equal(
    resolveNotificationLink({ type: "race_result", metadata: { raceId: "race-1" } }, "/resultater"),
    "/races/race-1",
  );
  assert.equal(
    resolveNotificationLink({ type: "stage_result", related_id: "race-2" }, "/resultater"),
    "/races/race-2",
  );
});

// #2180/#3310: selection_warning deep-linker til løbets selection-anker.
test("#2180/#3310 selection_warning deep-linker til /races/:raceId#selection", () => {
  const link = resolveNotificationLink(
    { type: "selection_warning", metadata: { raceId: "race-3" } },
    "/planning?tab=calendar",
  );
  assert.equal(link, "/races/race-3#selection");
});

// #2832: season_ended bærer den AFSLUTTEDE sæsons id i related_id.
test("#2832 season_ended deep-linker til den afsluttede sæson via related_id", () => {
  const link = resolveNotificationLink({ type: "season_ended", related_id: "season-1" }, "/seasons");
  assert.equal(link, "/seasons/season-1");
});

test("ukendt type uden metadata/related_id falder tilbage til fallbackLink", () => {
  assert.equal(resolveNotificationLink({ type: "admin_notice" }, null), null);
  assert.equal(resolveNotificationLink({ type: "welcome" }, "/auctions"), "/auctions");
});
