import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAUSE_LEVELS,
  isAuctionsBlocked,
  isMarketBlocked,
  isActionBlockedDuringMarketPause,
  shiftCalculatedEnd,
  buildPauseErrorBody,
} from "./marketPause.js";

test("PAUSE_LEVELS exposes the three allowed values", () => {
  assert.deepEqual([...PAUSE_LEVELS], ["none", "auctions", "all"]);
});

test("isAuctionsBlocked is true for 'auctions' and 'all'", () => {
  assert.equal(isAuctionsBlocked("none"), false);
  assert.equal(isAuctionsBlocked("auctions"), true);
  assert.equal(isAuctionsBlocked("all"), true);
});

test("isMarketBlocked is true only for 'all'", () => {
  assert.equal(isMarketBlocked("none"), false);
  assert.equal(isMarketBlocked("auctions"), false);
  assert.equal(isMarketBlocked("all"), true);
});

test("isActionBlockedDuringMarketPause allows cleanup actions", () => {
  assert.equal(isActionBlockedDuringMarketPause("archive"), false);
  assert.equal(isActionBlockedDuringMarketPause("withdraw"), false);
  assert.equal(isActionBlockedDuringMarketPause("reject"), false);
  assert.equal(isActionBlockedDuringMarketPause("cancel"), false);
});

test("isActionBlockedDuringMarketPause blocks state-progressing actions", () => {
  assert.equal(isActionBlockedDuringMarketPause("accept"), true);
  assert.equal(isActionBlockedDuringMarketPause("accept_counter"), true);
  assert.equal(isActionBlockedDuringMarketPause("counter"), true);
  assert.equal(isActionBlockedDuringMarketPause("confirm"), true);
  assert.equal(isActionBlockedDuringMarketPause("new_offer"), true);
  assert.equal(isActionBlockedDuringMarketPause("buyout"), true);
});

test("shiftCalculatedEnd shifts forward by elapsed pause duration", () => {
  const original = "2026-05-09T18:00:00.000Z";
  const pausedAt = "2026-05-09T16:00:00.000Z";
  const resumedAt = "2026-05-09T16:30:00.000Z"; // 30 min pause
  const shifted = shiftCalculatedEnd(original, pausedAt, resumedAt);
  assert.equal(shifted, "2026-05-09T18:30:00.000Z");
});

test("shiftCalculatedEnd preserves remaining time across pause", () => {
  // Auction had 2h left when paused. After 4h pause it should still have 2h left.
  const pausedAt = "2026-05-09T12:00:00.000Z";
  const original = "2026-05-09T14:00:00.000Z"; // 2h after paused_at
  const resumedAt = "2026-05-09T16:00:00.000Z"; // paused for 4h
  const shifted = shiftCalculatedEnd(original, pausedAt, resumedAt);
  const remainingMs = new Date(shifted).getTime() - new Date(resumedAt).getTime();
  assert.equal(remainingMs, 2 * 60 * 60 * 1000);
});

test("shiftCalculatedEnd returns unchanged when pausedAt missing", () => {
  const original = "2026-05-09T18:00:00.000Z";
  assert.equal(shiftCalculatedEnd(original, null, "2026-05-09T16:30:00.000Z"), original);
  assert.equal(shiftCalculatedEnd(original, undefined, "2026-05-09T16:30:00.000Z"), original);
});

test("shiftCalculatedEnd returns unchanged when resumedAt is before pausedAt", () => {
  // Should never happen in production but guard against negative shifts.
  const original = "2026-05-09T18:00:00.000Z";
  const pausedAt = "2026-05-09T16:00:00.000Z";
  const resumedAt = "2026-05-09T15:00:00.000Z";
  assert.equal(shiftCalculatedEnd(original, pausedAt, resumedAt), original);
});

test("buildPauseErrorBody includes reason when given", () => {
  const body = buildPauseErrorBody({ scope: "auctions", reason: "Race-fix igang" });
  assert.equal(body.code, "market_paused");
  assert.equal(body.scope, "auctions");
  assert.match(body.error, /Auktioner er midlertidigt pauset/);
  assert.match(body.error, /Race-fix igang/);
});

test("buildPauseErrorBody works without reason", () => {
  const body = buildPauseErrorBody({ scope: "market" });
  assert.equal(body.code, "market_paused");
  assert.equal(body.scope, "market");
  assert.match(body.error, /Markedet er midlertidigt pauset/);
});
