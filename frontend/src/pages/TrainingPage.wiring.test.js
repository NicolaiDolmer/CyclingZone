import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-string-guard for de tre #1480-krav på træningssiden:
//   1) vis ryttertype  2) gruppér efter type  3) rediger flere ad gangen.
// Spejler StatBar-guard-mønstret (RidersPage.statBar.test.js).
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");

test("#1480.1 roster-query henter ryttertype-kolonnerne", () => {
  assert.match(
    src,
    /\.select\("id, firstname, lastname, primary_type, secondary_type"\)/,
    "querien skal hente primary_type/secondary_type så typen kan vises",
  );
});

test("#1480.1 hver række renderer en RiderTypeBadge", () => {
  assert.match(src, /import RiderTypeBadge from/);
  assert.match(
    src,
    /<RiderTypeBadge primaryType=\{rider\.primary_type\} secondaryType=\{rider\.secondary_type\} \/>/,
  );
});

test("#1480.2 group-by-type-toggle styrer grupperet visning via groupRidersByType", () => {
  assert.match(src, /import \{ groupRidersByType, UNTYPED_KEY \} from/);
  assert.match(src, /groupByType\s*\?\s*groupRidersByType\(riders\)/);
  assert.match(src, /t\("groupByType"\)/);
});

test("#1480.3 multi-select + bulk-apply via setPlanBulk", () => {
  assert.match(src, /setPlanBulk/, "skal bruge bulk-handleren");
  assert.match(src, /handleBulkApply/);
  assert.match(src, /t\("bulkApply"/);
  // Select-all + per-række checkbox.
  assert.match(src, /toggleSelectAll/);
  assert.match(src, /toggleSelect\(rider\.id\)/);
});

// #1894 variant 1: hint under fokus-dropdown for ryttere UDEN plan — viser hvilket
// fokus assistenten rent faktisk træner dem med (backend-leveret smartDefaultFocus,
// ingen frontend-dublet af type→fokus-reglen).
test("#1894.1 smart-fokus-hint vises for ryttere uden plan, kun fra backend-leveret data", () => {
  assert.match(src, /smartDefaultFocus/, "skal bruge useTraining's smartDefaultFocus-map");
  assert.match(src, /t\("smartFocusHint"/);
  assert.match(src, /!plan\?\.focus\s*&&\s*smartDefaultFocus\[rider\.id\]/, "hint kun uden aktiv plan");
});

// #1894 variant 3: bulk-barens fokus-select har en "smart"-mode-mulighed der
// resolves server-side (frontend sender blot focus="smart").
test("#1894.3 bulk-select har smart-fokus-mulighed + viser skipped-med-plan", () => {
  assert.match(src, /<option value="smart">\{t\("bulkSmartFocusOption"\)\}<\/option>/);
  assert.match(src, /bulkSmartSkippedHasPlan/);
  assert.match(src, /skippedHasPlan/);
});

// #1895 PR 1: ugentlig træningsrytme — panel med 7 dags-selects + gem/nulstil,
// wired mod useTraining's setWeekPlan/clearWeekPlan (aldrig frontend-fokus-logik).
test("#1895 ugerytme-panel har 7 ugedags-selects + gem/nulstil wired mod useTraining", () => {
  assert.match(src, /weekPlan, savingWeekPlan, setWeekPlan, clearWeekPlan/, "skal destrukturere ugerytme-state fra useTraining");
  assert.match(src, /t\("weekRhythmTitle"\)/);
  assert.match(src, /WEEKDAY_KEYS\.map\(\(weekday\)/, "skal rendere én select pr. WEEKDAY_KEYS-nøgle");
  assert.match(src, /handleSaveWeekPlan/);
  assert.match(src, /handleResetWeekPlan/);
  assert.match(src, /setWeekPlan\(days\)/, "gem skal kalde useTraining's setWeekPlan");
  assert.match(src, /clearWeekPlan\(\)/, "nulstil skal kalde useTraining's clearWeekPlan");
});

test("#1895/#2438 roster-rækker viser altid dagens effektive intensitet + kilde, når holdet har en ugerytme (ren visning)", () => {
  assert.match(src, /resolveDayIntensityDisplay/, "skal genbruge den delte lagdelings-funktion (samme regel som motoren)");
  assert.match(src, /resolveDayIntensitySource/, "#2438: skal genbruge kilde-funktionen (individualPlan/ownSetting/teamRhythm)");
  assert.match(src, /teamRhythmActive/, "hint vises altid når holdet HAR en ugerytme (ikke kun ved 'differs')");
  // #2438: hint-nøglen er dynamisk (todayHintKey) og skelner nu mellem individuel
  // ugeplan, rytterens egen eksplicitte plan (der overtrumfer rytmen) og holdrytmen.
  assert.match(src, /t\(todayHintKey,/);
  assert.match(src, /weekRhythmTodayHint"/);
  assert.match(src, /weekRhythmTodayHintPlan"/, "#2438: ny variant for rytterens egen indstilling, der overtrumfer holdrytmen");
});

// ── #1895 PR 2: individuel ugeplan pr. rytter (rider_id-override) ─────────────
test("#1895.2 individuel ugeplan wired mod useTraining's riderWeekPlans/setRiderWeekPlan/clearRiderWeekPlan", () => {
  assert.match(
    src,
    /riderWeekPlans, savingRiderWeekPlanId, setRiderWeekPlan, clearRiderWeekPlan/,
    "skal destrukturere pr-rytter-ugeplan-state fra useTraining",
  );
  assert.match(src, /handleSaveRiderWeekPlan/);
  assert.match(src, /handleRemoveRiderWeekPlan/);
  assert.match(src, /setRiderWeekPlan\(riderId, days\)/, "gem skal kalde useTraining's setRiderWeekPlan");
  assert.match(src, /clearRiderWeekPlan\(riderId\)/, "fjern skal kalde useTraining's clearRiderWeekPlan");
});

test("#1895.2 roster-tabellen har en toggle-knap pr. rytter til individuel ugeplan", () => {
  assert.match(src, /toggleRiderWeekPlan\(rider\.id\)/);
  assert.match(src, /t\("individualWeekPlanToggleOpen"\)/);
});

test("#1895.2 ryttere MED egen ugeplan markeres i rosteret (badge)", () => {
  assert.match(src, /hasOwnWeekPlan/, "skal beregne om rytteren har egen override");
  assert.match(src, /t\("individualWeekPlanBadge"\)/);
});

test("#1895.2 dagens-hint tager højde for rytter-override (samme opløsningsrækkefølge som motoren)", () => {
  assert.match(src, /riderOverrideDays/, "skal sende rytterens egen override til resolveDayIntensityDisplay");
  assert.match(src, /weekRhythmTodayHintOwn/);
});
