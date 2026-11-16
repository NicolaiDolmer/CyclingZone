// #8260: "dit autobud holdt føringen" er en god nyhed og må ikke være rød.
// Kildekode-struktur-guard, samme mønster som NotificationsPage.boardCritical.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "NotificationsPage.jsx"), "utf8");

function entryOf(type) {
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
