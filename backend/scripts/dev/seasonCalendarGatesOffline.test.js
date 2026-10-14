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

// §1d-målet for S5 er en EJER-BESLUTNING (spillervendt) og står ikke i
// SEASON_RACE_DAY_TARGET før ejerens go. Generatorens regelefterlevelse måles med
// forslaget sat eksplicit, som `--race-day-target 160` på CLI'en.
const S5_PROPOSED_RACE_DAY_TARGET = 32 * 5; // 32 løbsdatoer × D1's 5 slots (§1e-b)

test("#6367: S5's låste vindue er grønt på alle kalender-gates uden override (fixturen)", async () => {
  const r = await runOfflineSeasonGates({
    seasonNumber: 5, firstDay: "2026-10-28", lastDay: "2026-11-28", raceDayTarget: S5_PROPOSED_RACE_DAY_TARGET,
  });
  assert.equal(r.plan.profileModel, "s5");
  assert.equal(r.realDays, 32);
  assert.deepEqual(r.hard.filter((b) => !MOTOR_PART.test(b)), [], "hårde gates");
  assert.deepEqual(r.overridable, [], "override-bare gates (K-B sæson, §6b)");
  assert.deepEqual(r.tierCompositionDrift, [], "§6 pr. division");
});

test("#6367: §1d — S5's mål er ikke sat uden ejer-go", () => {
  assert.equal(SEASON_RACE_DAY_TARGET[5], undefined, "ejer-beslutning: tilføj først S5-tallet efter ejerens ordrette go");
});

test("#6367: §1d — med forslaget (160) rammer alle fire divisioner det", async () => {
  const r = await runOfflineSeasonGates({
    seasonNumber: 5, firstDay: "2026-10-28", lastDay: "2026-11-28", raceDayTarget: S5_PROPOSED_RACE_DAY_TARGET,
  });
  assert.equal(r.raceDayTarget, S5_PROPOSED_RACE_DAY_TARGET);
  assert.deepEqual(Object.values(r.axisByTier), [160, 160, 160, 160]);
  assert.deepEqual(r.raceDayEquality, []);
});
