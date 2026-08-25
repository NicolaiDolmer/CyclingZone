// #4239 — forward-guard. Den test der ville have fanget at fire kalender-dev-scripts
// døde på selve datoen 25/8, dagen FØR de døde.
//
// Fejlklassen (samme som #4222) er ikke "forkert dato", men "dato hardkodet uden at
// `now` også er injiceret". Derfor er den vigtigste test her ikke at defaults er
// korrekte i dag, men at de stadig er det når systemuret er langt forbi dem.

import test from "node:test";
import assert from "node:assert/strict";

import {
  arg,
  offlineCalendarFrom,
  prodCalendarFrom,
  S3_FIRST_RACE_DAY,
  FROZEN_NOW,
} from "./devCalendarArgs.mjs";

test("offline-defaults kaster ikke — heller ikke år efter de hardkodede datoer", () => {
  // Selve rådne-testen: hvis nogen fjerner `now`-injektionen, bliver denne rød med det
  // samme i stedet for på en tilfældig fremtidig dag i produktionsfejlsøgning.
  const echte = Date;
  try {
    // Frys systemuret til 5 år efter S3. En tidsafhængig default ville kaste her.
    globalThis.Date = class extends echte {
      constructor(...a) {
        return a.length ? new echte(...a) : new echte("2031-01-01T12:00:00Z");
      }
      static now() {
        return echte.parse("2031-01-01T12:00:00Z");
      }
    };
    assert.doesNotThrow(() => offlineCalendarFrom([]));
  } finally {
    globalThis.Date = echte;
  }
});

test("offline: den frosne now ligger strengt før første løbsdag", () => {
  // Guardens forudsætning. Rykker nogen S3_FIRST_RACE_DAY uden at rykke FROZEN_NOW
  // med, kaster offlineCalendarFrom — den kobling holdes eksplicit her.
  assert.ok(FROZEN_NOW < S3_FIRST_RACE_DAY, `${FROZEN_NOW} skal være før ${S3_FIRST_RACE_DAY}`);
  const { from, firstDay, nowDay } = offlineCalendarFrom([]);
  assert.equal(firstDay, S3_FIRST_RACE_DAY);
  assert.equal(nowDay, FROZEN_NOW);
  // `from` = dagen FØR første løbsdag, kl. 12 UTC.
  assert.equal(from.toISOString(), "2026-08-27T12:00:00.000Z");
});

test("offline: --first-day og --now kan overstyres, begge skrivemåder", () => {
  const a = offlineCalendarFrom(["--first-day=2027-03-08", "--now=2027-03-01"]);
  assert.equal(a.firstDay, "2027-03-08");
  assert.equal(a.from.toISOString(), "2027-03-07T12:00:00.000Z");

  const b = offlineCalendarFrom(["--first-day", "2027-03-08", "--now", "2027-03-01"]);
  assert.deepEqual(b.from, a.from);
});

test("prod-stien fryser IKKE tiden — anti-blitz-guarden er stadig i kraft", () => {
  // Det modsatte krav af den første test, og det er med vilje: mod en live sæson SKAL
  // en passeret første løbsdag afvises (27/6-blitzen). Fryser nogen `now` også her,
  // bliver denne rød.
  assert.throws(
    () => prodCalendarFrom(["--first-day=2020-01-01"]),
    /fortiden\/i dag/,
    "en første løbsdag i fortiden skal afvises på prod-stien",
  );
});

test("arg: falder tilbage når flaget mangler, og æder ikke det næste flag", () => {
  assert.equal(arg([], "first-day", "fallback"), "fallback");
  assert.equal(arg(["--json"], "first-day", "fallback"), "fallback");
  // `--first-day` uden værdi, efterfulgt af et andet flag → fallback, ikke "--json".
  assert.equal(arg(["--first-day", "--json"], "first-day", "fallback"), "fallback");
});
