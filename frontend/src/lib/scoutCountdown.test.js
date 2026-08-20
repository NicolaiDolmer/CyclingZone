import test from "node:test";
import assert from "node:assert/strict";
import { msUntilReady, scoutCountdownParts, scoutReadyClock, missionReadyLabel } from "./scoutCountdown.js";

// #3548 — enheds-test af rest-tid/formatering. Selve tikket (useScoutCountdown)
// er en tynd setInterval-indpakning omkring scoutCountdownParts og testes ikke
// her; hele den ikke-trivielle adfærd ligger i de rene funktioner nedenfor.

const NOW = new Date("2026-08-14T10:00:00.000Z");

test("msUntilReady: resterende millisekunder, aldrig negativ", () => {
  assert.equal(msUntilReady("2026-08-14T10:30:00.000Z", NOW), 30 * 60_000);
  assert.equal(msUntilReady("2026-08-14T10:00:00.000Z", NOW), 0);
  // Deadline passeret (rapporten modnes ved næste hentning) — klampes til 0.
  assert.equal(msUntilReady("2026-08-14T09:45:00.000Z", NOW), 0);
});

test("msUntilReady: manglende eller ugyldigt tidspunkt giver null", () => {
  assert.equal(msUntilReady(null, NOW), null);
  assert.equal(msUntilReady(undefined, NOW), null);
  assert.equal(msUntilReady("", NOW), null);
  assert.equal(msUntilReady("not-a-timestamp", NOW), null);
});

test("msUntilReady: accepterer Date lige så vel som ISO-streng", () => {
  assert.equal(msUntilReady(new Date("2026-08-14T10:05:00.000Z"), NOW), 5 * 60_000);
});

test("scoutCountdownParts: en netop startet opgave viser den fulde ETA", () => {
  assert.deepEqual(
    scoutCountdownParts("2026-08-14T10:30:00.000Z", NOW),
    { state: "counting", minutes: 30 },
  );
});

test("scoutCountdownParts: minutter rundes op, så tallet aldrig springer et minut for tidligt", () => {
  // 29 min 30 sek tilbage skal stadig læses som "30 min", ikke "29".
  assert.deepEqual(
    scoutCountdownParts("2026-08-14T10:29:30.000Z", NOW),
    { state: "counting", minutes: 30 },
  );
  // 40 sekunder tilbage er stadig ventetid — "1 min", aldrig "0 min".
  assert.deepEqual(
    scoutCountdownParts("2026-08-14T10:00:40.000Z", NOW),
    { state: "counting", minutes: 1 },
  );
});

test("scoutCountdownParts: nedtællingen falder monotont mens opgaven kører", () => {
  const readyAt = "2026-08-14T10:30:00.000Z";
  const observed = [0, 10, 20, 25, 29].map((elapsed) => (
    scoutCountdownParts(readyAt, new Date(NOW.getTime() + elapsed * 60_000)).minutes
  ));
  assert.deepEqual(observed, [30, 20, 10, 5, 1]);
});

test("scoutCountdownParts: deadline passeret giver due-tilstanden", () => {
  assert.deepEqual(
    scoutCountdownParts("2026-08-14T10:00:00.000Z", NOW),
    { state: "due", minutes: 0 },
  );
  assert.deepEqual(
    scoutCountdownParts("2026-08-14T09:31:00.000Z", NOW),
    { state: "due", minutes: 0 },
  );
});

test("scoutCountdownParts: intet klar-tidspunkt giver null (kalderen viser den flade ETA)", () => {
  assert.equal(scoutCountdownParts(null, NOW), null);
  assert.equal(scoutCountdownParts("not-a-timestamp", NOW), null);
});

test("scoutReadyClock: UTC vises som dansk lokaltid (CEST, sommer = UTC+2)", () => {
  assert.equal(scoutReadyClock("2026-08-14T10:30:00.000Z"), "12:30");
});

test("scoutReadyClock: dansk vintertid (CET = UTC+1)", () => {
  assert.equal(scoutReadyClock("2026-01-14T10:30:00.000Z"), "11:30");
});

test("scoutReadyClock: manglende eller ugyldigt tidspunkt giver null", () => {
  assert.equal(scoutReadyClock(null), null);
  assert.equal(scoutReadyClock("not-a-timestamp"), null);
});

// #3997 — mission-modning viser nu et forventet klokkeslæt (afledt af
// afsendelsestidspunktet) i stedet for den gamle dags-granulære copy.
// NOW = 2026-08-14T10:00:00Z = 12:00 CEST, dansk kalenderdag 2026-08-14.

test("missionReadyLabel: senere i DAG (samme danske kalenderdag)", () => {
  assert.deepEqual(missionReadyLabel("2026-08-14T18:00:00.000Z", NOW), { state: "today", time: "20:00" });
});

test("missionReadyLabel: I MORGEN (næste danske kalenderdag)", () => {
  assert.deepEqual(missionReadyLabel("2026-08-15T09:00:00.000Z", NOW), { state: "tomorrow", time: "11:00" });
});

test("missionReadyLabel: sent om aftenen dansk tid regnes stadig som I DAG, ikke i morgen (UTC-dato ville ellers skifte)", () => {
  // 23:30 dansk tid (CEST) = 21:30 UTC, samme danske kalenderdag som NOW.
  assert.deepEqual(missionReadyLabel("2026-08-14T21:30:00.000Z", NOW), { state: "today", time: "23:30" });
});

test("missionReadyLabel: deadline passeret giver due-tilstanden", () => {
  assert.deepEqual(missionReadyLabel("2026-08-14T09:00:00.000Z", NOW), { state: "due" });
  assert.deepEqual(missionReadyLabel(NOW.toISOString(), NOW), { state: "due" }); // grænsen selv er due
});

test("missionReadyLabel: længere ude end i morgen (flerdages-mission) giver date-tilstanden", () => {
  const result = missionReadyLabel("2026-08-17T09:00:00.000Z", NOW);
  assert.equal(result.state, "date");
  assert.equal(result.time, "11:00");
  assert.ok(result.date instanceof Date);
});

test("missionReadyLabel: manglende eller ugyldigt tidspunkt giver null", () => {
  assert.equal(missionReadyLabel(null, NOW), null);
  assert.equal(missionReadyLabel("not-a-timestamp", NOW), null);
});
