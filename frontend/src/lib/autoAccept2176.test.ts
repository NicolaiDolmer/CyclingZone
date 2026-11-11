import test from "node:test";
import assert from "node:assert/strict";
import {
  autoAcceptEnd,
  durationMinutes,
  validAutoBid,
  reviewAutoAcceptEnd,
  validTiming,
  readAutoListing,
  findCounterAutoListing,
  readAutoAcceptErrorBody,
} from "./autoAccept2176.ts";
import { calculateAuctionEnd } from "../../../backend/lib/auctionEngine.js";
const config = {
  weekday_open_hour: 8,
  weekday_close_hour: 24,
  weekend_open_hour: 10,
  weekend_close_hour: 22,
};
test("free duration fields accept whole parts and the approved active-time bounds", () => {
  for (const [h, m] of [
    ["", "30"],
    ["0.5", "0"],
    ["-1", "60"],
    ["0", ""],
    ["0", "60"],
    ["24", "1"],
    ["0", "29"],
  ])
    assert.equal(durationMinutes(h, m), null);
  assert.equal(durationMinutes("0", "30"), 30);
  assert.equal(durationMinutes("24", "0"), 1440);
});
test("preview exactly matches calculateAuctionEnd across closing, weekends and DST", () => {
  for (const date of [
    "2026-11-09T22:30:00Z",
    "2026-11-09T23:00:00Z",
    "2026-11-13T22:30:00Z",
    "2026-03-28T20:45:00Z",
    "2026-10-24T19:45:00Z",
  ]) {
    for (const minutes of [30, 60, 1440])
      assert.equal(
        autoAcceptEnd(new Date(date), config, minutes).toISOString(),
        calculateAuctionEnd(new Date(date), {
          ...config,
          duration_hours: minutes / 60,
        }).toISOString()
      );
  }
});
test("bid must be a whole CZ$ amount at least the current auto-price", () => {
  for (const bid of [null, 0, 99, 100.5, 2147483648]) assert.equal(validAutoBid(bid, 100), false);
  assert.equal(validAutoBid(100, 100), true);
  assert.equal(validAutoBid(101, 100), true);
});

test("approved copy is complete, ICU-safe and reviewed in all five locales", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { IntlMessageFormat } = await import("intl-messageformat");
  const readLocale = async (language: string) =>
    JSON.parse(
      await readFile(
        new URL(`../../public/locales/${language}/transfers.json`, import.meta.url),
        "utf8"
      )
    );
  const source = (await readLocale("en")).autoAccept as Record<string, string>;
  const state = JSON.parse(
    await readFile(new URL("../../i18n-state.json", import.meta.url), "utf8")
  );
  const params = { price: "600 CZ$", open: "08:00", close: "24:00" };
  const placeholders = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const language of ["en", "da", "es", "fr", "nl"]) {
    const copy = (await readLocale(language)).autoAccept as Record<string, string>;
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(source).sort(), language);
    for (const [key, value] of Object.entries(copy)) {
      assert.ok(value.trim(), `${language}.${key}`);
      assert.deepEqual(placeholders(value), placeholders(source[key]), `${language}.${key}`);
      const rendered = new IntlMessageFormat(value, language).format(params);
      assert.equal(typeof rendered, "string");
      for (const name of placeholders(value))
        assert.ok(
          String(rendered).includes(params[name as keyof typeof params]),
          `${language}.${key}.${name}`
        );
      if (language !== "en")
        assert.deepEqual(
          state.languages[language].transfers[`autoAccept.${key}`],
          {
            srcHash: createHash("sha256").update(source[key], "utf8").digest("hex").slice(0, 16),
            status: "reviewed",
          },
          `${language}.${key} metadata`
        );
    }
  }
});

test("binding submit reviews a changed displayed end across the closing edge", () => {
  const cfg = {
    weekday_open_hour: 8,
    weekday_close_hour: 24,
    weekend_open_hour: 8,
    weekend_close_hour: 24,
  };
  const opened = new Date("2026-11-09T22:29:45Z");
  const clicked = new Date("2026-11-09T22:30:05Z");
  const shown = autoAcceptEnd(opened, cfg, 30);
  const review = reviewAutoAcceptEnd(shown, clicked, cfg, 30);
  assert.equal(review.changed, true);
  assert.equal(review.end.toISOString(), "2026-11-10T07:00:05.000Z");
  assert.equal(reviewAutoAcceptEnd(review.end, clicked, cfg, 30).changed, false);
});

test("unknown timing data is validated before it reaches the auction calculation", () => {
  assert.equal(validTiming(config), true);
  for (const value of [null, undefined, 8, "on", [], {}, { ...config, weekday_open_hour: "8" }])
    assert.equal(validTiming(value), false);
});
test("listing and error boundaries validate unknown API payloads", () => {
  const listing = { id: "listing-a", asking_price: 100, auto_accept_price: 200,
    seller: { id: "seller-a" }, rider: { id: "rider-a", firstname: "Ada", lastname: "Test", nationality_code: "DK" } };
  assert.equal(readAutoListing(listing)?.rider.id, "rider-a");
  assert.equal(readAutoListing({ ...listing, rider: null }), null);
  assert.equal(readAutoListing({ ...listing, auto_accept_price: "200" }), null);
  assert.deepEqual(findCounterAutoListing([listing], { rider: { id: "rider-a" } }, "seller-a"), { asking_price: 100, auto_accept_price: 200 });
  assert.equal(findCounterAutoListing([listing], { rider: { id: "rider-a" } }, "another-seller"), null);
  assert.equal(findCounterAutoListing([listing], { rider: { id: "another-rider" } }, "seller-a"), null);
  assert.equal(findCounterAutoListing([listing], { rider: { id: "rider-a" }, auto_accept_eligible: false }, "seller-a"), null);
  assert.deepEqual(readAutoAcceptErrorBody("invalid"), {});
  assert.deepEqual(readAutoAcceptErrorBody({ errorCode: "auto_accept_price_changed", errorParams: { autoAcceptPrice: 250 }, unexpected: true }),
    { errorCode: "auto_accept_price_changed", errorParams: { autoAcceptPrice: 250 } });
});
