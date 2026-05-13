import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDiscordWebhookUrl,
  buildGoogleSheetCsvUrl,
  parseGoogleSheetUrl,
} from "./urlSafety.js";

test("parseGoogleSheetUrl accepts docs.google.com spreadsheet URLs", () => {
  const parsed = parseGoogleSheetUrl(
    "https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=456"
  );

  assert.deepEqual(parsed, { sheetId: "abc_DEF-123", gid: "456" });
});

test("buildGoogleSheetCsvUrl pins outbound requests to docs.google.com", () => {
  const url = buildGoogleSheetCsvUrl(
    "https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=456",
    { includeGid: true }
  );

  assert.equal(
    url,
    "https://docs.google.com/spreadsheets/d/abc_DEF-123/gviz/tq?tqx=out%3Acsv&gid=456"
  );
});

test("parseGoogleSheetUrl rejects non-Google hosts and non-HTTPS URLs", () => {
  assert.throws(
    () => parseGoogleSheetUrl("https://evil.example/spreadsheets/d/abc_DEF-123/edit"),
    /docs\.google\.com/
  );
  assert.throws(
    () => parseGoogleSheetUrl("http://docs.google.com/spreadsheets/d/abc_DEF-123/edit"),
    /https/
  );
});

test("assertDiscordWebhookUrl accepts Discord webhook endpoints", () => {
  assert.equal(
    assertDiscordWebhookUrl("https://discord.com/api/webhooks/123/token"),
    "https://discord.com/api/webhooks/123/token"
  );
  assert.equal(
    assertDiscordWebhookUrl("https://discordapp.com/api/webhooks/123/token"),
    "https://discordapp.com/api/webhooks/123/token"
  );
});

test("assertDiscordWebhookUrl rejects arbitrary outbound hosts and wrong paths", () => {
  assert.throws(
    () => assertDiscordWebhookUrl("https://example.com/api/webhooks/123/token"),
    /discord\.com/
  );
  assert.throws(
    () => assertDiscordWebhookUrl("https://discord.com/api/users/@me"),
    /api\/webhooks/
  );
  assert.throws(
    () => assertDiscordWebhookUrl("http://discord.com/api/webhooks/123/token"),
    /https/
  );
});
