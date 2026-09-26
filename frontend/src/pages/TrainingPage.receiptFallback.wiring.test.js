// #5539-fix (ejer 26/9, PR #5782): kvitteringens "+N %"-kolonne og gold-segment
// skal bygge på den SENESTE kørsel, ikke kun dagens (todayRun findes først ved
// tick kl. 20). Source-string-guard for BEGGE flader (/training + rytterprofilens
// Training-fane), så ingen af dem glider tilbage til todayRun-only og "—" hele
// dagen. Selve fallback-logikken er unit-testet i lib/trainingReport.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");
const tab = readFileSync(join(__dirname, "..", "components", "rider", "profile", "RiderTrainingTab.jsx"), "utf8");

test("#5539-fix /training: kvitteringens kilde er latestReceiptRun(todayRun, history.runs)", () => {
  assert.match(page, /const receiptRun = latestReceiptRun\(todayRun, history\.runs\);/);
  assert.match(page, /const receiptRowByRider = useMemo\(\(\) => reportRowsByRider\(receiptRun\), \[receiptRun\]\);/);
});

test("#5539-fix /training: BEGGE focusAbilityReceipt-kald (desktop-roster + mobilkort) bruger seneste kørsel + dag", () => {
  const calls = page.match(/focusAbilityReceipt\((?:plan\?\.focus|planFor\(riderId\)\?\.focus), \{[\s\S]*?\n\s*\}\);/g) ?? [];
  assert.equal(calls.length, 2, "forventer præcis to focusAbilityReceipt-kald");
  for (const call of calls) {
    assert.match(call, /progressBefore: receiptRowByRider\[/);
    assert.match(call, /gainsToday: receiptRowByRider\[/);
    assert.match(call, /gainDay: receiptDay/);
    assert.doesNotMatch(call, /todayRowByRider/, "må ikke falde tilbage til todayRun-only");
  }
});

test("#5539-fix rytterprofil: SeasonReceiptCard bruger seneste kørsel fra trainingHistory.runs + dag", () => {
  assert.match(tab, /const receiptRun = latestReceiptRun\(todayRun, trainingHistory\?\.runs\);/);
  assert.match(tab, /const runRow = reportRowsByRider\(receiptRun\)\[rider\.id\] \?\? null;/);
  assert.match(tab, /const gainDay = receiptGainDay\(receiptRun\?\.tick_date, copenhagenDayKey\(nowMs\)\);/);
  assert.match(tab, /gainsToday,\s*\n\s*gainDay,\s*\n\s*\}\)\.map/);
  assert.doesNotMatch(tab, /todayRun\?\.report\?\.riders\?\.find/, "må ikke falde tilbage til todayRun-only");
});
