import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNotificationLink, aggregateCtaKey } from "./notificationLink.js";

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

// #4759: assistant_filled_squad deep-linker til samme selection-anker som
// selection_warning (samme raceId-metadata-mønster).
test("#4759 assistant_filled_squad deep-linker til /races/:raceId#selection", () => {
  const link = resolveNotificationLink(
    { type: "assistant_filled_squad", metadata: { raceId: "race-9" } },
    "/planning?tab=calendar",
  );
  assert.equal(link, "/races/race-9#selection");
});

test("#4759 assistant_filled_squad uden metadata falder tilbage til related_id", () => {
  const link = resolveNotificationLink(
    { type: "assistant_filled_squad", related_id: "race-10" },
    "/planning?tab=calendar",
  );
  assert.equal(link, "/races/race-10#selection");
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

// #4118/#3517: forum_thread_reply bærer post_id i related_id, deep-linker
// direkte til tråden (ikke den generiske /forum-forside).
test("#4118/#3517 forum_thread_reply deep-linker til tråden via related_id", () => {
  const link = resolveNotificationLink({ type: "forum_thread_reply", related_id: "post-1" }, "/forum");
  assert.equal(link, "/forum/post-1");
});

// #5011: @-tag. related_id er trådens id; stod tagget i et svar, peger
// metadata.replyId på det konkrete indlæg, og ankeret #reply-<id> lander
// på selve svaret i stedet for øverst i en lang tråd.
test("#5011 forum_mention deep-linker til det SVAR tagget stod i", () => {
  const link = resolveNotificationLink(
    { type: "forum_mention", related_id: "post-1", metadata: { replyId: "reply-9" } },
    "/forum",
  );
  assert.equal(link, "/forum/post-1#reply-reply-9");
});

test("#5011 forum_mention i selve opslaget lander på tråden uden anker", () => {
  const link = resolveNotificationLink(
    { type: "forum_mention", related_id: "post-1", metadata: { replyId: null } },
    "/forum",
  );
  assert.equal(link, "/forum/post-1");
});

test("#5011 forum_mention uden related_id falder tilbage til forum-forsiden", () => {
  assert.equal(resolveNotificationLink({ type: "forum_mention" }, "/forum"), "/forum");
});

// #4557 (S-M2d): aabnings- og reminder-notifikationer om aarsmoedet
// deep-linker direkte til /board/meeting, ikke det generiske /board.
for (const titleCode of [
  "notif.boardMandateOpened.title",
  "notif.boardMandateT1Reminder.title",
  "notif.boardMandateT3Reminder.title",
]) {
  test(`#4557 board_update med titleCode ${titleCode} deep-linker til /board/meeting`, () => {
    const link = resolveNotificationLink(
      { type: "board_update", metadata: { titleCode } },
      "/board",
    );
    assert.equal(link, "/board/meeting");
  });
}

test("#4557 board_critical med T1-reminder-titleCode deep-linker ogsaa til /board/meeting", () => {
  const link = resolveNotificationLink(
    { type: "board_critical", metadata: { titleCode: "notif.boardMandateT1Reminder.title" } },
    "/board",
  );
  assert.equal(link, "/board/meeting");
});

test("#4557 boardMandateAutoAccepted lander PAA /board (moedet er allerede underskrevet)", () => {
  const link = resolveNotificationLink(
    { type: "board_update", metadata: { titleCode: "notif.boardMandateAutoAccepted.title" } },
    "/board",
  );
  assert.equal(link, "/board");
});

test("#4557 board_update uden boardMandate-titleCode falder tilbage til fallbackLink", () => {
  const link = resolveNotificationLink({ type: "board_update", metadata: {} }, "/board");
  assert.equal(link, "/board");
});

test("#4943 admin_notice med surveySlug deep-linker til skemaet", () => {
  const link = resolveNotificationLink(
    { type: "admin_notice", metadata: { surveySlug: "2026-09-features" } },
    null,
  );
  assert.equal(link, "/survey/2026-09-features");
});

test("#4943 admin_notice uden surveySlug foelger fallbackLink som foer", () => {
  assert.equal(resolveNotificationLink({ type: "admin_notice", metadata: {} }, null), null);
  assert.equal(resolveNotificationLink({ type: "admin_notice", metadata: { surveySlug: "" } }, null), null);
  assert.equal(
    resolveNotificationLink({ type: "board_update", metadata: { surveySlug: "x" } }, "/board"),
    "/board",
    "kun admin_notice baerer survey-linket",
  );
});

// #5384-followup: knapteksten i en udfoldet aggregat-linje. Den foerste #5384-
// ret valgte paa entry.group === "auction_bidding" og gav dermed boetten
// bid_received (saelgerens bud-stoej) teksten "Vis detaljer", selvom den linker
// til /auctions og altid har heddet "Vis auktion". Destinationen afgoer nu
// teksten, saa en ny boette ikke kan gentage fejlen.

test("#5384 aggregateCtaKey — auktions-destinationer beholder 'Vis auktion'", () => {
  // auction_bidding (auction_outbid/auction_proxy_outbid) OG bid_received
  // deler begge dette link i TYPE_CONFIG.
  assert.equal(aggregateCtaKey("/auctions"), "actions.viewAuction");
});

test("#5384 aggregateCtaKey — race_completed-destinationer faar 'Vis detaljer'", () => {
  // race_result/stage_result/career_milestone peger alle paa /resultater.
  assert.equal(aggregateCtaKey("/resultater"), "actions.viewDetails");
});

test("#5384 aggregateCtaKey — manglende link giver den generiske tekst", () => {
  assert.equal(aggregateCtaKey(null), "actions.viewDetails");
  assert.equal(aggregateCtaKey(undefined), "actions.viewDetails");
  assert.equal(aggregateCtaKey(""), "actions.viewDetails");
  assert.equal(
    aggregateCtaKey("/transfers"), "actions.viewDetails",
    "kun auktionshuset hedder 'Vis auktion'",
  );
});
