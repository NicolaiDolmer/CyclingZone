import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNotifications, aggregateKey } from "./groupNotifications.js";

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
