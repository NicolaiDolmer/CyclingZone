// #6584 · installations-tilbuddets timing: aldrig foerste besoeg, respektér "Ikke nu".
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DISMISSALS,
  RETURN_DAYS,
  SNOOZE_DAYS,
  STORAGE_KEY,
  decideInstallOffer,
  emptyInstallState,
  localDayKey,
  parseInstallState,
  readInstallState,
  recordDismissal,
  recordInstalled,
  recordVisit,
  writeInstallState,
  type InstallContext,
  type InstallState,
} from "./installTiming.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 13, 12, 0, 0).getTime();

function ctx(overrides: Partial<InstallContext> = {}): InstallContext {
  return { now: T0, platform: "prompt", standalone: false, hasSession: true, pathname: "/dashboard", ...overrides };
}

function visitedOn(dayCount: number): InstallState {
  let state = emptyInstallState();
  for (let i = dayCount - 1; i >= 0; i -= 1) state = recordVisit(state, T0 - i * DAY);
  return state;
}

test("first visit never gets an offer", () => {
  assert.equal(decideInstallOffer(visitedOn(1), ctx()), "too-early");
});

test("many visits on the same day still count as one day", () => {
  let state = emptyInstallState();
  for (let h = 0; h < 6; h += 1) state = recordVisit(state, T0 + h * 60 * 1000);
  assert.deepEqual(state.days, [localDayKey(T0)]);
  assert.equal(decideInstallOffer(state, ctx()), "too-early");
});

test("the offer opens on the RETURN_DAYS-th distinct day", () => {
  assert.equal(decideInstallOffer(visitedOn(RETURN_DAYS - 1), ctx()), "too-early");
  assert.equal(decideInstallOffer(visitedOn(RETURN_DAYS), ctx()), "offer");
});

test("no offer without a supported install path, a session or an app route", () => {
  const ready = visitedOn(RETURN_DAYS);
  assert.equal(decideInstallOffer(ready, ctx({ platform: "none" })), "unsupported");
  assert.equal(decideInstallOffer(ready, ctx({ hasSession: false })), "no-session");
  assert.equal(decideInstallOffer(ready, ctx({ pathname: "/" })), "not-app-route");
  assert.equal(decideInstallOffer(ready, ctx({ pathname: "/login" })), "not-app-route");
  assert.equal(decideInstallOffer(ready, ctx({ platform: "ios" })), "offer");
});

test("never offered inside the installed app or after an install", () => {
  const ready = visitedOn(RETURN_DAYS);
  assert.equal(decideInstallOffer(ready, ctx({ standalone: true })), "standalone");
  assert.equal(decideInstallOffer(recordInstalled(ready), ctx()), "installed");
});

test("'Not now' snoozes for SNOOZE_DAYS, then the offer may return", () => {
  const dismissed = recordDismissal(visitedOn(RETURN_DAYS), T0);
  assert.equal(decideInstallOffer(dismissed, ctx({ now: T0 + (SNOOZE_DAYS - 1) * DAY })), "snoozed");
  assert.equal(decideInstallOffer(dismissed, ctx({ now: T0 + SNOOZE_DAYS * DAY })), "offer");
});

test("after MAX_DISMISSALS the offer never returns", () => {
  let state = visitedOn(RETURN_DAYS);
  for (let i = 0; i < MAX_DISMISSALS; i += 1) state = recordDismissal(state, T0 - 365 * DAY);
  assert.equal(decideInstallOffer(state, ctx()), "gave-up");
});

test("parser is tolerant: junk becomes an empty state, bad days are dropped", () => {
  assert.deepEqual(parseInstallState(null), emptyInstallState());
  assert.deepEqual(parseInstallState("not json"), emptyInstallState());
  assert.deepEqual(parseInstallState("[1,2]").days, []);
  const parsed = parseInstallState(JSON.stringify({ days: ["2026-10-01", 7, "x"], dismissals: -2, dismissedAt: "y", installed: "yes" }));
  assert.deepEqual(parsed, { days: ["2026-10-01"], dismissals: 0, dismissedAt: null, installed: false });
});

test("storage access is fail-closed", () => {
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readInstallState(throwing), null);
  assert.equal(readInstallState(null), null);
  assert.equal(writeInstallState(throwing, emptyInstallState()), false);

  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  const state = recordVisit(emptyInstallState(), T0);
  assert.equal(writeInstallState(storage, state), true);
  assert.ok(map.has(STORAGE_KEY));
  assert.deepEqual(readInstallState(storage), state);
});
