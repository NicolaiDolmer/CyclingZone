import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNotifications, aggregateKey, aggregateGroup } from "./groupNotifications.js";

function notif({ id, type, related_id = null, is_read = false, created_at, message = "msg", title = "t" }) {
  return { id, type, related_id, is_read, created_at, message, title };
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
