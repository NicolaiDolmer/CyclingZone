// #8069: startTour() skal give en allerede monteret <OnboardingTour> besked, saa
// "Vis mig rundt" paa samme side viser touren straks (foer: foerst efter sideskift).
import { test } from "node:test";
import assert from "node:assert/strict";

test("startTour gemmer tilstanden og sender TOUR_START_EVENT", async () => {
  const store = new Map<string, string>();
  const events: string[] = [];
  const g = globalThis as any;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  g.window = { dispatchEvent: (e: Event) => { events.push(e.type); return true; } };
  try {
    const { startTour, readTour, TOUR_START_EVENT } = await import("./onboardingTour.js");
    startTour("finance");
    assert.deepEqual(readTour(), { page: "finance", step: 0 });
    assert.deepEqual(events, [TOUR_START_EVENT]);
  } finally {
    delete g.localStorage;
    delete g.window;
  }
});
