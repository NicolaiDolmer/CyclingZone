import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNotifications, aggregateKey, aggregateGroup } from "./groupNotifications.js";

function notif({ id, type, related_id = null, is_read = false, created_at, message = "msg", title = "t", metadata = null }) {
  return { id, type, related_id, is_read, created_at, message, title, metadata };
}

// #5384-followup: præcis den metadata-form backenden faktisk skriver —
// notificationService.js (race_result/stage_result) og careerFirsts.js
// (career_milestone) lægger begge løbsnavnet i messageParams.race.
function withRace(race, extra = {}) {
  return { raceId: "race-1", messageParams: { race, ...extra } };
}

test("groupNotifications — tom liste giver tom liste", () => {
  assert.deepEqual(groupNotifications([]), []);
  assert.deepEqual(groupNotifications(null), []);
  assert.deepEqual(groupNotifications(undefined), []);
});

test("groupNotifications — single auction_outbid bliver ikke aggregeret", () => {
  const input = [notif({ id: "1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" })];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "single");
  assert.equal(result[0].notification.id, "1");
});

test("groupNotifications — flere outbid på samme auktion aggregeres med tæller", () => {
  const input = [
    notif({ id: "3", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z", message: "seneste" }),
    notif({ id: "2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z", message: "først" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "aggregate");
  assert.equal(result[0].count, 3);
  assert.equal(result[0].latest_at, "2026-05-15T12:00:00Z");
  assert.equal(result[0].earliest_at, "2026-05-15T10:00:00Z");
  assert.equal(result[0].sample_message, "seneste");
  assert.equal(result[0].related_id, "auc-A");
});

test("groupNotifications — outbid fra forskellige auktioner aggregeres separat", () => {
  const input = [
    notif({ id: "1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" }),
    notif({ id: "2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:01:00Z" }),
    notif({ id: "3", type: "auction_outbid", related_id: "auc-B", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "4", type: "auction_outbid", related_id: "auc-B", created_at: "2026-05-15T11:01:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  const aggA = result.find((r) => r.related_id === "auc-A");
  const aggB = result.find((r) => r.related_id === "auc-B");
  assert.equal(aggA.count, 2);
  assert.equal(aggB.count, 2);
});

test("groupNotifications — outbid skjules hvis auktionen har auction_won", () => {
  const input = [
    notif({ id: "won", type: "auction_won", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
    notif({ id: "ob2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "ob1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "single");
  assert.equal(result[0].notification.type, "auction_won");
});

test("groupNotifications — outbid skjules hvis auktionen har auction_lost", () => {
  const input = [
    notif({ id: "lost", type: "auction_lost", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
    notif({ id: "ob1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "ob2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].notification.type, "auction_lost");
});

test("groupNotifications — outbid på ANDEN auktion ikke skjules selvom won findes for første", () => {
  const input = [
    notif({ id: "won", type: "auction_won", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
    notif({ id: "obB1", type: "auction_outbid", related_id: "auc-B", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "obB2", type: "auction_outbid", related_id: "auc-B", created_at: "2026-05-15T12:30:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  const aggB = result.find((r) => r.kind === "aggregate");
  assert.equal(aggB.related_id, "auc-B");
  assert.equal(aggB.count, 2);
});

test("groupNotifications — any_unread sand hvis mindst én er ulæst", () => {
  const input = [
    notif({ id: "1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z", is_read: true }),
    notif({ id: "2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z", is_read: false }),
  ];
  const result = groupNotifications(input);
  assert.equal(result[0].any_unread, true);
});

test("groupNotifications — any_unread falsk hvis alle er læst", () => {
  const input = [
    notif({ id: "1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z", is_read: true }),
    notif({ id: "2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z", is_read: true }),
  ];
  const result = groupNotifications(input);
  assert.equal(result[0].any_unread, false);
});

test("groupNotifications — sortering DESC efter effektivt timestamp", () => {
  const input = [
    notif({ id: "other", type: "bid_received", created_at: "2026-05-15T11:30:00Z" }),
    notif({ id: "ob1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "ob2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, "aggregate");
  assert.equal(result[0].latest_at, "2026-05-15T12:00:00Z");
  assert.equal(result[1].kind, "single");
  assert.equal(result[1].notification.id, "other");
});

test("groupNotifications — outbid uden related_id falder igennem som single", () => {
  const input = [
    notif({ id: "1", type: "auction_outbid", related_id: null, created_at: "2026-05-15T10:00:00Z" }),
    notif({ id: "2", type: "auction_outbid", related_id: null, created_at: "2026-05-15T11:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, "single");
  assert.equal(result[1].kind, "single");
});

test("aggregateKey — deterministisk", () => {
  assert.equal(aggregateKey("auction_outbid", "abc"), "auction_outbid|abc");
});

// #2401/#2208 — bid_received (sælgers "nyt bud"-besked) skal aggregeres og
// termineres på samme måde som auction_outbid, så en travl auktion ikke
// spammer sælgeren med flere separate/dobbelte bekræftelses-beskeder.

test("groupNotifications — flere bid_received på samme auktion aggregeres med tæller", () => {
  const input = [
    notif({ id: "3", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z", message: "seneste bud" }),
    notif({ id: "2", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "1", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z", message: "første bud" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "aggregate");
  assert.equal(result[0].count, 3);
  assert.equal(result[0].sample_message, "seneste bud");
  assert.equal(result[0].related_id, "auc-A");
});

test("groupNotifications — bid_received skjules helt når auktionen er solgt (auction_won)", () => {
  const input = [
    notif({ id: "won", type: "auction_won", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z", message: "Solgt for 50000 CZ$" }),
    notif({ id: "b2", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "b1", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
  ];
  const result = groupNotifications(input);
  // Kun ÉN konsolideret besked tilbage — den endelige "solgt for X CZ$".
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "single");
  assert.equal(result[0].notification.type, "auction_won");
  assert.equal(result[0].notification.message, "Solgt for 50000 CZ$");
});

test("groupNotifications — bid_received skjules når auktionen annulleres (auction_lost)", () => {
  const input = [
    notif({ id: "lost", type: "auction_lost", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
    notif({ id: "b1", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].notification.type, "auction_lost");
});

test("groupNotifications — bid_received på ANDEN, stadig aktiv auktion forbliver aggregeret", () => {
  const input = [
    notif({ id: "won", type: "auction_won", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
    notif({ id: "bB1", type: "bid_received", related_id: "auc-B", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "bB2", type: "bid_received", related_id: "auc-B", created_at: "2026-05-15T12:30:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  const aggB = result.find((r) => r.kind === "aggregate");
  assert.equal(aggB.related_id, "auc-B");
  assert.equal(aggB.count, 2);
});

// #4981 — auction_proxy_outbid ("dit autobud hævede sig og beholdt føringen",
// tilføjet i PR #5363) deler auktion med auction_outbid og opstår i samme
// budkrig. De to typer skal derfor samles i ÉN bøtte pr. auktion, så en aktiv
// byder får én indbakke-linje pr. auktion, ikke én pr. udfordring.

test("aggregateGroup — outbid-typerne deler bøtte, bid_received har sin egen", () => {
  assert.equal(aggregateGroup("auction_outbid"), "auction_bidding");
  assert.equal(aggregateGroup("auction_proxy_outbid"), "auction_bidding");
  assert.equal(aggregateGroup("bid_received"), "bid_received");
  assert.equal(aggregateGroup("auction_won"), null);
  assert.equal(aggregateGroup("ukendt_type"), null);
});

test("groupNotifications — flere auction_proxy_outbid på samme auktion bliver ÉN linje", () => {
  const input = [
    notif({ id: "p4", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:30:00Z", message: "seneste haevning" }),
    notif({ id: "p3", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "p2", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T11:30:00Z" }),
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z", message: "foerste haevning" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "aggregate");
  assert.equal(result[0].count, 4);
  assert.equal(result[0].key, aggregateKey("auction_bidding", "auc-A"));
  assert.equal(result[0].sample_message, "seneste haevning");
  assert.equal(result[0].earliest_at, "2026-05-15T11:00:00Z");
});

test("groupNotifications — enkelt auction_proxy_outbid aggregeres ikke", () => {
  const input = [notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" })];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "single");
  assert.equal(result[0].notification.id, "p1");
});

test("groupNotifications — outbid og proxy_outbid på SAMME auktion ender i én fælles gruppe", () => {
  const input = [
    notif({ id: "p2", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "o1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "aggregate");
  assert.equal(result[0].group, "auction_bidding");
  assert.equal(result[0].count, 3);
  assert.deepEqual(result[0].type_counts, { auction_proxy_outbid: 2, auction_outbid: 1 });
});

test("groupNotifications — et reelt tab af føringen som nyeste besked bestemmer gruppens tekst", () => {
  const input = [
    notif({ id: "o1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z", title: "Du blev overbudt", message: "du er ikke laengere foerende" }),
    notif({ id: "p2", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z", title: "Dit autobud beholdt foeringen", message: "du foerer stadig" }),
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  // Nyeste besked er tabet af føringen — den må ALDRIG skjules bag
  // "du fører stadig"-teksten fra en ældre autobud-hævning.
  assert.equal(result[0].type, "auction_outbid");
  assert.equal(result[0].sample_title, "Du blev overbudt");
  assert.equal(result[0].sample_message, "du er ikke laengere foerende");
});

test("groupNotifications — nyeste autobud-hævning bestemmer teksten når føringen er genvundet", () => {
  const input = [
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z", title: "Dit autobud beholdt foeringen" }),
    notif({ id: "o1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z", title: "Du blev overbudt" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result[0].type, "auction_proxy_outbid");
  assert.equal(result[0].sample_title, "Dit autobud beholdt foeringen");
  // Tælleren på de reelle tab er stadig aflæselig for UI'et.
  assert.equal(result[0].type_counts.auction_outbid, 1);
});

test("groupNotifications — proxy_outbid skjules når auktionen er vundet eller tabt", () => {
  for (const terminator of ["auction_won", "auction_lost"]) {
    const input = [
      notif({ id: "end", type: terminator, related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
      notif({ id: "p2", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
      notif({ id: "o1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
      notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" }),
    ];
    const result = groupNotifications(input);
    assert.equal(result.length, 1, `terminator ${terminator} skulle skjule hele bud-bøtten`);
    assert.equal(result[0].kind, "single");
    assert.equal(result[0].notification.type, terminator);
  }
});

test("groupNotifications — auction_sold terminerer kun sælgerens bid_received, ikke byderens bud-bøtte", () => {
  const input = [
    notif({ id: "sold", type: "auction_sold", related_id: "auc-A", created_at: "2026-05-15T13:00:00Z" }),
    notif({ id: "b1", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "b2", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T11:30:00Z" }),
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:00:00Z" }),
    notif({ id: "p2", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T12:30:00Z" }),
  ];
  const result = groupNotifications(input);
  const agg = result.find((r) => r.kind === "aggregate");
  assert.equal(agg.group, "auction_bidding");
  assert.equal(agg.count, 2);
  assert.equal(result.some((r) => r.kind === "single" && r.notification.type === "bid_received"), false);
});

test("groupNotifications — proxy_outbid uden related_id falder igennem som single", () => {
  const input = [
    notif({ id: "1", type: "auction_proxy_outbid", related_id: null, created_at: "2026-05-15T10:00:00Z" }),
    notif({ id: "2", type: "auction_proxy_outbid", related_id: null, created_at: "2026-05-15T11:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, "single");
  assert.equal(result[1].kind, "single");
});

test("groupNotifications — bud-bøtter for forskellige auktioner holdes adskilt", () => {
  const input = [
    notif({ id: "a1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" }),
    notif({ id: "a2", type: "auction_outbid", related_id: "auc-A", created_at: "2026-05-15T10:30:00Z" }),
    notif({ id: "b1", type: "auction_proxy_outbid", related_id: "auc-B", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "b2", type: "auction_proxy_outbid", related_id: "auc-B", created_at: "2026-05-15T11:30:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  assert.equal(result.find((r) => r.related_id === "auc-A").count, 2);
  assert.equal(result.find((r) => r.related_id === "auc-B").count, 2);
});

// #5384 — race_result (#1952) og career_milestone (#3398, Maiden Win Engine)
// deler related_id = race.id og fyrer begge når en managers rytter vinder sin
// FØRSTE sejr i det løb der lige blev afviklet. Samme bøtte-mønster som
// #4981 (auction_bidding): ÉN linje pr. løb i stedet for to.

test("aggregateGroup — race_result, stage_result og career_milestone deler bøtten race_completed", () => {
  assert.equal(aggregateGroup("race_result"), "race_completed");
  assert.equal(aggregateGroup("stage_result"), "race_completed");
  assert.equal(aggregateGroup("career_milestone"), "race_completed");
});

test("groupNotifications — race_result og career_milestone for SAMME løb samles til én linje", () => {
  const input = [
    notif({ id: "cm1", type: "career_milestone", related_id: "race-A", created_at: "2026-09-15T14:00:05Z", title: "Maiden win", message: "Rytter X vandt for foerste gang" }),
    notif({ id: "rr1", type: "race_result", related_id: "race-A", created_at: "2026-09-15T14:00:00Z", title: "Race result is in", message: "Se resultatet" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "aggregate");
  assert.equal(result[0].group, "race_completed");
  assert.equal(result[0].count, 2);
  // #5384-followup (ejer 19/9): career_milestone er nyeste (14:00:05), men
  // ansigtet er RESULTATET — linjen handler om løbet, ikke om at en milepæl
  // tilfældigvis blev skrevet fem sekunder senere.
  assert.equal(result[0].type, "race_result");
  assert.equal(result[0].sample_title, "Race result is in");
  assert.deepEqual(result[0].extra_items.map((i) => i.id), ["cm1"]);
  assert.deepEqual(result[0].type_counts, { career_milestone: 1, race_result: 1 });
});

test("groupNotifications — race_result uden nogen career_milestone forbliver single (ingen dobbelt-besked at loese)", () => {
  const input = [notif({ id: "rr1", type: "race_result", related_id: "race-B", created_at: "2026-09-15T14:00:00Z" })];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "single");
  assert.equal(result[0].notification.type, "race_result");
});

test("groupNotifications — race_completed-boetter for FORSKELLIGE loeb holdes adskilt", () => {
  const input = [
    notif({ id: "rr1", type: "race_result", related_id: "race-A", created_at: "2026-09-15T14:00:00Z" }),
    notif({ id: "cm1", type: "career_milestone", related_id: "race-A", created_at: "2026-09-15T14:00:05Z" }),
    notif({ id: "cm2", type: "career_milestone", related_id: "race-B", created_at: "2026-09-16T09:00:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  const aggA = result.find((r) => r.related_id === "race-A");
  const single = result.find((r) => r.kind === "single");
  assert.equal(aggA.count, 2);
  assert.equal(single.notification.related_id, "race-B");
});

test("groupNotifications — stage_result (mellem-etape) og career_milestone samme etape samles", () => {
  const input = [
    notif({ id: "sr1", type: "stage_result", related_id: "gt-1", created_at: "2026-09-15T14:00:00Z", title: "Stage result is in" }),
    notif({ id: "cm1", type: "career_milestone", related_id: "gt-1", created_at: "2026-09-15T14:00:03Z", title: "Maiden win" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].group, "race_completed");
  assert.equal(result[0].count, 2);
});

// Reviewer-fund (#5384-followup): stage_result deler related_id = race.id på
// tværs af ALLE etaper i et flerdages-løb (notificationService.js linje 727),
// så uden en dags-dimension i nøglen ville et 21-etapers grand tour kollapse
// til ÉN "race_completed"-linje for hele løbets varighed. #2523's formål (én
// notifikation PR. ETAPE, for at undgå flerdages-stilhed) skal stå ved magt.

test("groupNotifications — stage_result på FORSKELLIGE dage for SAMME løb forbliver separate linjer", () => {
  const input = [
    notif({ id: "s1", type: "stage_result", related_id: "gt-1", created_at: "2026-09-01T14:00:00Z", title: "Stage 1" }),
    notif({ id: "s2", type: "stage_result", related_id: "gt-1", created_at: "2026-09-02T14:00:00Z", title: "Stage 2" }),
    notif({ id: "s3", type: "stage_result", related_id: "gt-1", created_at: "2026-09-03T14:00:00Z", title: "Stage 3" }),
  ];
  const result = groupNotifications(input);
  // Tre forskellige dage → tre separate linjer, ikke ét aggregat med count=3.
  assert.equal(result.length, 3);
  assert.ok(result.every((r) => r.kind === "single"), "hver etape-dag skal stå for sig selv, ikke gemme sig bag en tæller");
  assert.deepEqual(
    result.map((r) => r.notification.id),
    ["s3", "s2", "s1"],
    "sortering DESC efter created_at — den nyeste etape øverst",
  );
});

test("groupNotifications — sidste etapes race_result + career_milestone SAMME dag samles stadig, uden at sluge tidligere etaper", () => {
  const input = [
    notif({ id: "s1", type: "stage_result", related_id: "gt-1", created_at: "2026-09-01T14:00:00Z", title: "Stage 1" }),
    notif({ id: "s2", type: "stage_result", related_id: "gt-1", created_at: "2026-09-02T14:00:00Z", title: "Stage 2" }),
    notif({ id: "rr", type: "race_result", related_id: "gt-1", created_at: "2026-09-03T14:00:00Z", title: "Race result is in" }),
    notif({ id: "cm", type: "career_milestone", related_id: "gt-1", created_at: "2026-09-03T14:00:05Z", title: "Maiden win" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 3, "2 separate etape-dage + 1 samlet slutdags-aggregat");
  const finalDay = result.find((r) => r.kind === "aggregate");
  assert.equal(finalDay.count, 2);
  // #5384-followup (ejer 19/9): ansigtet er RESULTATET, ikke den nyeste
  // besked — derfor race_result her, selvom milepælen kom 5 sekunder senere.
  assert.equal(finalDay.type, "race_result");
  const singles = result.filter((r) => r.kind === "single");
  assert.equal(singles.length, 2);
  assert.deepEqual(singles.map((r) => r.notification.id).sort(), ["s1", "s2"]);
});

test("groupNotifications — race_completed-aggregatets `key` inkluderer dagen, så to dage af samme løb ikke deler React-nøgle", () => {
  const input = [
    notif({ id: "s1a", type: "stage_result", related_id: "gt-1", created_at: "2026-09-01T14:00:00Z" }),
    notif({ id: "cm1", type: "career_milestone", related_id: "gt-1", created_at: "2026-09-01T14:00:05Z" }),
    notif({ id: "s2a", type: "stage_result", related_id: "gt-1", created_at: "2026-09-02T14:00:00Z" }),
    notif({ id: "cm2", type: "career_milestone", related_id: "gt-1", created_at: "2026-09-02T14:00:05Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  const keys = result.map((r) => r.key);
  assert.equal(new Set(keys).size, 2, "de to dages aggregater skal have HVER SIN unikke key");
});

test("groupNotifications — bid_received blandes ikke ind i bud-bøtten", () => {
  const input = [
    notif({ id: "s1", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T10:00:00Z" }),
    notif({ id: "s2", type: "bid_received", related_id: "auc-A", created_at: "2026-05-15T10:30:00Z" }),
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T11:00:00Z" }),
    notif({ id: "p2", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-05-15T11:30:00Z" }),
  ];
  const result = groupNotifications(input);
  assert.equal(result.length, 2);
  assert.equal(result.find((r) => r.group === "bid_received").count, 2);
  assert.equal(result.find((r) => r.group === "auction_bidding").count, 2);
});

// ── #5384-followup (ejer 19/9, "ret titlen først") ───────────────────────────
// Bøtten race_completed brugte den NYESTE besked som ansigt. Fordi milepælen
// skrives få sekunder efter resultatet, hed linjen "Maiden win (×2)" med
// teksten om ÉN rytters første sejr — læsbart som to første sejre, og løbet
// (det der faktisk skete) var helt væk. Ansigtet skal være løbet.

test("groupNotifications — race_completed: resultatet er ansigtet, selvom milepælen er nyest", () => {
  const input = [
    notif({
      id: "rr", type: "race_result", related_id: "race-1",
      created_at: "2026-09-19T14:00:00Z",
      title: "Race result is in", message: "Amstel Classic has been run. View the result.",
      metadata: withRace("Amstel Classic"),
    }),
    notif({
      id: "cm", type: "career_milestone", related_id: "race-1",
      created_at: "2026-09-19T14:00:05Z",
      title: "Maiden win", message: "Lars Vermeulen won for the first time in Amstel Classic.",
      metadata: withRace("Amstel Classic", { rider: "Lars Vermeulen" }),
    }),
  ];
  const [entry] = groupNotifications(input);
  assert.equal(entry.kind, "aggregate");
  assert.equal(entry.type, "race_result", "ikon/farve følger resultatet, ikke milepælen");
  assert.equal(entry.sample_title, "Race result is in");
  assert.equal(entry.sample_message, "Amstel Classic has been run. View the result.");
  assert.equal(entry.sample_metadata.messageParams.race, "Amstel Classic");
  assert.equal(entry.race_name, "Amstel Classic", "titlen bygges på struktureret data, ikke på fritekst");
});

test("groupNotifications — race_completed: hver milepæl bliver sin egen ekstra linje", () => {
  const input = [
    notif({
      id: "rr", type: "race_result", related_id: "race-1", created_at: "2026-09-19T14:00:00Z",
      message: "Amstel Classic has been run.", metadata: withRace("Amstel Classic"),
    }),
    notif({
      id: "cm1", type: "career_milestone", related_id: "race-1", created_at: "2026-09-19T14:00:05Z",
      message: "Lars Vermeulen won for the first time in Amstel Classic.",
      metadata: withRace("Amstel Classic"),
    }),
    notif({
      id: "cm2", type: "career_milestone", related_id: "race-1", created_at: "2026-09-19T14:00:07Z",
      message: "Ada Pedersen reached their first career podium: Amstel Classic.",
      metadata: withRace("Amstel Classic"),
    }),
  ];
  const [entry] = groupNotifications(input);
  assert.equal(entry.type, "race_result");
  assert.deepEqual(
    entry.extra_items.map((i) => i.id),
    ["cm2", "cm1"],
    "begge milepæle vises som egne linjer, nyeste først — ingen (×N) der skjuler den ene",
  );
  assert.equal(entry.count, 3, "count bevares i datalaget; det er SIDEN der ikke viser tælleren");
});

test("groupNotifications — race_completed uden struktureret løbsnavn (narrativ besked) falder tilbage til resultatets egen titel", () => {
  const input = [
    notif({
      id: "rr", type: "race_result", related_id: "race-1", created_at: "2026-09-19T14:00:00Z",
      title: "Krogh takes the sprint", message: "Amstel Classic has been run. You placed 2nd.",
      // #3399-narrativ-grenen: metadata bærer INTET messageParams.race.
      metadata: { raceId: "race-1", narrative: true },
    }),
    notif({
      id: "cm", type: "career_milestone", related_id: "race-1", created_at: "2026-09-19T14:00:05Z",
      title: "Maiden win", message: "Lars Vermeulen won for the first time.",
      metadata: { raceId: "race-1", riderId: "r-1", messageParams: { rider: "Lars Vermeulen", count: 50 } },
    }),
  ];
  const [entry] = groupNotifications(input);
  assert.equal(entry.race_name, null, "aldrig et navn parset ud af fritekst-beskeden");
  assert.equal(entry.type, "race_result");
  assert.equal(entry.sample_title, "Krogh takes the sprint", "resultatets egen titel bliver ansigtet");
  assert.deepEqual(entry.extra_items.map((i) => i.id), ["cm"]);
});

test("groupNotifications — race_completed med KUN milepæle bruger nyeste milepæl som ansigt og resten som ekstra linjer", () => {
  const input = [
    notif({
      id: "cm1", type: "career_milestone", related_id: "race-1", created_at: "2026-09-19T14:00:00Z",
      title: "First podium", message: "Ada Pedersen reached their first career podium: Amstel Classic.",
      metadata: withRace("Amstel Classic"),
    }),
    notif({
      id: "cm2", type: "career_milestone", related_id: "race-1", created_at: "2026-09-19T14:00:05Z",
      title: "Maiden win", message: "Lars Vermeulen won for the first time in Amstel Classic.",
      metadata: withRace("Amstel Classic"),
    }),
  ];
  const [entry] = groupNotifications(input);
  assert.equal(entry.type, "career_milestone");
  assert.equal(entry.sample_title, "Maiden win", "nyeste milepæl er ansigtet når intet resultat findes");
  assert.equal(
    entry.race_name, null,
    '"<løb>: resultatet er klar" må ikke stå over en linje hvor intet resultat er kommet ind',
  );
  assert.deepEqual(entry.extra_items.map((i) => i.id), ["cm1"]);
});

test("groupNotifications — auktions-bøtter er uændrede: nyeste besked som ansigt, ingen ekstra linjer", () => {
  const input = [
    notif({ id: "o1", type: "auction_outbid", related_id: "auc-A", created_at: "2026-09-19T10:00:00Z", title: "Outbid" }),
    notif({ id: "p1", type: "auction_proxy_outbid", related_id: "auc-A", created_at: "2026-09-19T11:00:00Z", title: "Autobid held" }),
  ];
  const [entry] = groupNotifications(input);
  assert.equal(entry.group, "auction_bidding");
  assert.equal(entry.type, "auction_proxy_outbid", "#4981: den nyeste beskeds type styrer stadig auktions-linjen");
  assert.equal(entry.sample_title, "Autobid held");
  assert.equal(entry.race_name, null);
  assert.deepEqual(entry.extra_items, []);
});
