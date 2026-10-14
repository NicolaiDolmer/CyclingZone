// backend/scripts/dev/seasonCalendarGatesOffline.test.js
// #6367: S5-kalenderen (det låste vindue 28/10 → lørdag 28/11) overholder de låste regler
// mod den committede katalog-fixture — samme kæde som buildSeasonCalendar's tørkørsel.
// Ingen DB, intet netværk.
import test from "node:test";
import assert from "node:assert/strict";

import { runOfflineSeasonGates } from "./seasonCalendarGatesOffline.mjs";
import { SEASON_RACE_DAY_TARGET } from "../../lib/calendarRaceDayTargets.js";

// Benchmark-gatens del (4) dømmer motoren (#6362), ikke kalenderen: den er rød indtil
// ejeren har valgt enkeltstarts-sporet og afhænger ikke af generatoren.
const MOTOR_PART = /S5 \(4\) motor/;

test("#6367: S5's låste vindue er grønt på alle kalender-gates uden override (fixturen)", async () => {
  const r = await runOfflineSeasonGates({ seasonNumber: 5, firstDay: "2026-10-28", lastDay: "2026-11-28" });
  assert.equal(r.plan.profileModel, "s5");
  assert.equal(r.realDays, 32);
  assert.deepEqual(r.hard.filter((b) => !MOTOR_PART.test(b)), [], "hårde gates");
  assert.deepEqual(r.overridable, [], "override-bare gates (K-B sæson, §6b)");
  assert.deepEqual(r.tierCompositionDrift, [], "§6 pr. division");
});

test("#6367: §1d — S5 har sit eget mål, og alle fire divisioner rammer det", async () => {
  assert.equal(SEASON_RACE_DAY_TARGET[5], 32 * 5, "32 løbsdatoer × D1's 5 slots (§1e-b)");
  const r = await runOfflineSeasonGates({ seasonNumber: 5, firstDay: "2026-10-28", lastDay: "2026-11-28" });
  assert.equal(r.raceDayTarget, SEASON_RACE_DAY_TARGET[5]);
  assert.deepEqual(Object.values(r.axisByTier), [160, 160, 160, 160]);
  assert.deepEqual(r.raceDayEquality, []);
});
