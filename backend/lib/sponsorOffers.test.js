import test from "node:test";
import assert from "node:assert/strict";
import { generateOffers, SPONSOR_NAME_POOL, FULL_CALENDAR_DAYS } from "./sponsorOffers.js";

const ctx = { teamId: "team-1", seasonNumber: 2, renownTargetValue: 520000 };

test("genererer præcis 3 tilbud", () => {
  assert.equal(generateOffers(ctx).length, 3);
});

test("er deterministisk på samme input (ingen reroll ved reload)", () => {
  assert.deepEqual(generateOffers(ctx), generateOffers(ctx));
});

test("forskellige hold/sæsoner → forskellige navne", () => {
  const a = generateOffers(ctx).map((o) => o.sponsorName);
  const b = generateOffers({ ...ctx, teamId: "team-2" }).map((o) => o.sponsorName);
  assert.notDeepEqual(a, b);
});

test("hver variant ≈ renownTarget ved fuld kalender (±2%)", () => {
  for (const o of generateOffers(ctx)) {
    const total = o.guaranteedBase + o.perRaceDayRate * FULL_CALENDAR_DAYS;
    assert.ok(Math.abs(total - ctx.renownTargetValue) / ctx.renownTargetValue < 0.02,
      `${o.variant}: total ${total} vs target ${ctx.renownTargetValue}`);
  }
});

test("varianterne har stigende per-dag-andel (forudsigelig < sikker < aktivitets-drevet)", () => {
  const byVariant = Object.fromEntries(generateOffers(ctx).map((o) => [o.variant, o]));
  assert.ok(byVariant.predictable.perRaceDayRate < byVariant.activity.perRaceDayRate);
  assert.ok(byVariant.predictable.lengthSeasons === 1);
  assert.ok(byVariant.long.lengthSeasons === 3);
});

test("navne kommer fra puljen", () => {
  for (const o of generateOffers(ctx)) assert.ok(SPONSOR_NAME_POOL.includes(o.sponsorName));
});
