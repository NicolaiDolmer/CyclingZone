import { test } from "node:test";
import assert from "node:assert/strict";
import { findSupersededUnreadIds } from "./supersededUnread.js";
import { groupNotifications } from "../../lib/groupNotifications.js";

function n(id, type, related_id, is_read = false) {
  return { id, type, related_id, is_read, created_at: "2026-10-08T10:00:00Z", title: "t", message: "m" };
}

test("tom/ugyldig input giver ingen id'er", () => {
  assert.deepEqual(findSupersededUnreadIds([]), []);
  assert.deepEqual(findSupersededUnreadIds(null), []);
});

test("ulæst overbudt på en afgjort auktion findes (den skjulte '2 ulæste')", () => {
  const list = [
    n("o1", "auction_outbid", "auc-1"),
    n("o2", "auction_proxy_outbid", "auc-1"),
    n("end", "auction_lost", "auc-1"),
  ];
  assert.deepEqual(findSupersededUnreadIds(list).sort(), ["o1", "o2"]);
});

test("rører ikke: aktiv auktion, anden auktion, allerede læst, andre typer", () => {
  const list = [
    n("active", "auction_outbid", "auc-active"),
    n("other", "auction_outbid", "auc-2"),
    n("read", "auction_outbid", "auc-1", true),
    n("race", "race_result", "auc-1"),
    n("end", "auction_won", "auc-1"),
    n("end2", "auction_lost", "auc-2-andet"),
  ];
  assert.deepEqual(findSupersededUnreadIds(list), []);
});

test("auction_sold afgør kun bid_received, ikke en overbudt-besked", () => {
  const list = [
    n("b", "bid_received", "auc-1"),
    n("o", "auction_outbid", "auc-1"),
    n("sold", "auction_sold", "auc-1"),
  ];
  assert.deepEqual(findSupersededUnreadIds(list), ["b"]);
});

test("paritet: præcis de ulæste rækker indbakken ikke viser (groupNotifications)", () => {
  const list = [
    n("o1", "auction_outbid", "auc-1"),
    n("b1", "bid_received", "auc-1"),
    n("end", "auction_lost", "auc-1"),
    n("o2", "auction_outbid", "auc-2"),
    n("o3", "auction_outbid", "auc-2"),
    n("tr", "transfer_offer_received", null),
  ];
  const visible = new Set();
  for (const entry of groupNotifications(list)) {
    if (entry.kind === "single") visible.add(entry.notification.id);
    else for (const item of entry.items) visible.add(item.id);
  }
  const hiddenUnread = list.filter((x) => !x.is_read && !visible.has(x.id)).map((x) => x.id).sort();
  assert.deepEqual(findSupersededUnreadIds(list).sort(), hiddenUnread);
});
