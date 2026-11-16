// #8260: "dit autobud holdt føringen" er en god nyhed og må ikke være rød.
// Kildekode-struktur-guard, samme mønster som NotificationsPage.boardCritical.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "NotificationsPage.jsx"), "utf8");

function entryOf(type: string): string {
  const m = source.match(new RegExp(`\\n  ${type}:\\s*\\{[^}]*\\}`));
  assert.ok(m, `TYPE_CONFIG skal have en entry for ${type}`);
  return m[0];
}

test("#8260 auction_proxy_outbid er neutral: ingen danger-farve og ikke advarselsikon", () => {
  const entry = entryOf("auction_proxy_outbid");
  assert.doesNotMatch(entry, /danger/, "auction_proxy_outbid må ikke bruge cz-danger");
  assert.doesNotMatch(entry, /AlertTriangleIcon/, "auction_proxy_outbid må ikke bruge advarselsikon");
});

test("#8260 auction_outbid (tabt føring) forbliver rød", () => {
  const entry = entryOf("auction_outbid");
  assert.match(entry, /text-cz-danger/);
  assert.match(entry, /AlertTriangleIcon/);
});

test("#8260 kun autoBidRaised er neutral; stoppet/annulleret/udtømt autobud bevarer rød config", () => {
  const fn = source.match(/function proxyLeadHeldConfig[\s\S]*?\r?\n}\r?\n/);
  assert.ok(fn, "proxyLeadHeldConfig skal findes");
  assert.match(fn[0], /type === "auction_proxy_outbid"/);
  assert.match(fn[0], /titleCode !== "notif\.autoBidRaised\.title"/);
  assert.match(fn[0], /return TYPE_CONFIG\.auction_outbid/);
});

test("#8260 både enkelt-rækker og samlede bøtter går gennem proxyLeadHeldConfig", () => {
  assert.match(source, /proxyLeadHeldConfig\(notification\.type, notification\.metadata\)/);
  assert.match(source, /proxyLeadHeldConfig\(entry\.type, entry\.sample_metadata\)/);
});
