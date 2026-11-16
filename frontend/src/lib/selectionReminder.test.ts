// #4983 — nav-tone og nedtælling for den synlige udtagelses-påmindelse.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSelectionReminder,
  resolveNavDotTone,
  deadlineCountdown,
  pickHeaderRace,
  hasHeaderDeadline,
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

// CodeRabbit-fund (#5108): et svar med `tone: "warning"` og en ubrugelig række
// slap igennem. Boksen linkede så til /races/undefined og viste tomme felter.
test("normalizeSelectionReminder: null i races kasserer HELE svaret", () => {
  const out = normalizeSelectionReminder({
    enabled: true, tone: "warning", count: 1, races: [null], window_hours: 36, urgent_hours: 24,
  });
  assert.equal(out.tone, "none");
  assert.equal(out.count, 0);
  assert.equal(out.races.length, 0);
  // Vinduerne er stadig serverens — kun løbene kasseres.
  assert.equal(out.window_hours, 36);
  assert.equal(out.urgent_hours, 24);
});

test("normalizeSelectionReminder: en halv række kasserer hele svaret", () => {
  const partial = [
    { ...RACE, id: undefined },
    { ...RACE, id: "" },
    { ...RACE, name: undefined },
    { ...RACE, deadline_at: undefined },
    { ...RACE, deadline_at: "ikke en dato" },
    { ...RACE, hours_until: "30" },
    { ...RACE, hours_until: Number.NaN },
    { ...RACE, entry_count: null },
    { ...RACE, target_size: undefined },
  ];
  for (const race of partial) {
    const out = normalizeSelectionReminder({ enabled: true, tone: "urgent", count: 2, races: [RACE, race] });
    assert.equal(out.tone, "none", `ugyldig række slap igennem: ${JSON.stringify(race)}`);
    assert.equal(out.races.length, 0);
  }
});

test("normalizeSelectionReminder: de valgfrie felter er stadig valgfrie", () => {
  // race_class/min_size/will_not_start er valgfrie i kontrakten — de må ikke
  // kunne kassere et ellers gyldigt svar.
  const out = normalizeSelectionReminder({ enabled: true, tone: "warning", count: 1, races: [RACE] });
  assert.equal(out.races.length, 1);
  assert.equal(out.tone, "warning");
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

// #8069 T01 + Codex-review #8317
test("pickHeaderRace: roed tone vaelger tidligste roede loeb, ikke et tidligere gult", () => {
  const race = (id: string, hours_until: number, tone: "warning" | "urgent") =>
    ({ id, name: id, deadline_at: "2026-11-17T00:00:00Z", hours_until, entry_count: 5, target_size: 8, tone });
  const base = { enabled: true, count: 2, window_hours: 36, urgent_hours: 24 };
  assert.equal(pickHeaderRace({ ...base, tone: "urgent", races: [race("gul", 4, "warning"), race("roed", 8, "urgent")] })?.id, "roed");
  assert.equal(pickHeaderRace({ ...base, tone: "warning", races: [race("b", 30, "warning"), race("a", 12, "warning")] })?.id, "a");
  assert.equal(pickHeaderRace({ ...base, tone: "none", races: [] }), null);
});

// #8069 T01: ingen frist -> ingen undertitel (ellers et tomt <p> i PageHeader)
test("hasHeaderDeadline: kun naar paamindelsen er aktiv og har loeb", () => {
  assert.equal(hasHeaderDeadline(EMPTY_SELECTION_REMINDER), false);
  assert.equal(hasHeaderDeadline(null), false);
  assert.equal(hasHeaderDeadline({ ...EMPTY_SELECTION_REMINDER, tone: "warning", races: [] }), false);
  assert.equal(hasHeaderDeadline({ ...EMPTY_SELECTION_REMINDER, enabled: false, tone: "warning", races: [{ id: "r", name: "r", deadline_at: "x", hours_until: 1, entry_count: 1, target_size: 8, tone: "warning" }] }), false);
  assert.equal(hasHeaderDeadline({ ...EMPTY_SELECTION_REMINDER, tone: "warning", races: [{ id: "r", name: "r", deadline_at: "x", hours_until: 1, entry_count: 1, target_size: 8, tone: "warning" }] }), true);
});
