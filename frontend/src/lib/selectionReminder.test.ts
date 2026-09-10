// #4983 — nav-tone og nedtælling for den synlige udtagelses-påmindelse.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSelectionReminder,
  resolveNavDotTone,
  deadlineCountdown,
  EMPTY_SELECTION_REMINDER,
} from "./selectionReminder.ts";

const RACE = {
  id: "r1",
  name: "Tour de Preview",
  deadline_at: "2026-09-11T18:00:00.000Z",
  hours_until: 30,
  entry_count: 0,
  target_size: 6,
  tone: "warning" as const,
};

test("normalizeSelectionReminder: tomt/ugyldigt svar bliver til ingen påmindelse", () => {
  assert.deepEqual(normalizeSelectionReminder(null), { ...EMPTY_SELECTION_REMINDER });
  assert.deepEqual(normalizeSelectionReminder({ tone: "urgent" }), { ...EMPTY_SELECTION_REMINDER });
  assert.equal(normalizeSelectionReminder({ races: "nope" }).tone, "none");
});

test("normalizeSelectionReminder: fravalgt påmindelse er slukket, uanset løbene i svaret", () => {
  const out = normalizeSelectionReminder({ enabled: false, tone: "urgent", races: [RACE] });
  assert.equal(out.enabled, false);
  assert.equal(out.tone, "none");
  assert.equal(out.races.length, 0);
});

test("normalizeSelectionReminder: ukendt tone falder til none i stedet for at farve fladen", () => {
  const out = normalizeSelectionReminder({
    tone: "critical", races: [{ ...RACE, tone: "critical" }], count: 1,
  });
  assert.equal(out.tone, "none");
  assert.equal(out.races[0].tone, "none");
});

test("normalizeSelectionReminder: gyldigt svar bæres igennem med vinduerne", () => {
  const out = normalizeSelectionReminder({
    enabled: true, tone: "urgent", count: 2,
    races: [{ ...RACE, tone: "urgent" }, RACE],
    window_hours: 36, urgent_hours: 24,
  });
  assert.equal(out.tone, "urgent");
  assert.equal(out.count, 2);
  assert.equal(out.window_hours, 36);
  assert.equal(out.urgent_hours, 24);
});

test("resolveNavDotTone: kun punkter med dot: true markeres", () => {
  const tones = { "/planning": "urgent" as const };
  assert.equal(resolveNavDotTone({ to: "/planning", dot: true }, tones), "urgent");
  assert.equal(resolveNavDotTone({ to: "/planning" }, tones), "none");
  assert.equal(resolveNavDotTone({ to: "/team", dot: true }, tones), "none");
  assert.equal(resolveNavDotTone(null, tones), "none");
  assert.equal(resolveNavDotTone({ to: "/planning", dot: true }, null), "none");
});

test("deadlineCountdown: minutter under en time, timer under to døgn, dage derover", () => {
  assert.deepEqual(deadlineCountdown(0.5), { unit: "minutes", value: 30 });
  assert.deepEqual(deadlineCountdown(5.9), { unit: "hours", value: 5 });
  assert.deepEqual(deadlineCountdown(47.9), { unit: "hours", value: 47 });
  assert.deepEqual(deadlineCountdown(50), { unit: "days", value: 2 });
});

test("deadlineCountdown: rundes ALTID ned, så påmindelsen aldrig lover mere tid end der er", () => {
  assert.deepEqual(deadlineCountdown(1.99), { unit: "hours", value: 1 });
  assert.deepEqual(deadlineCountdown(0.02), { unit: "minutes", value: 1 });
});

test("deadlineCountdown: passeret frist er 'past', ikke et negativt tal", () => {
  assert.deepEqual(deadlineCountdown(0), { unit: "past", value: 0 });
  assert.deepEqual(deadlineCountdown(-3), { unit: "past", value: 0 });
  assert.deepEqual(deadlineCountdown(Number.NaN), { unit: "past", value: 0 });
});
