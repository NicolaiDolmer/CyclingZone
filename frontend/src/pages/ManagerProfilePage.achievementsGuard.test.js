import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2876 — ManagerProfilePage destrukturerede achievements/season_history/
// transfer_activity direkte fra /api/managers/:id-svaret og kaldte .filter/.reduce/
// .length uguardet. Et 200-svar der mangler et af felterne (delvist svar eller en
// fremtidig kontraktændring) crashede hele siden i error boundary i stedet for at
// degradere pænt. `riders` havde allerede guarden (rawRiders || []) — samme guard
// manglede for de tre andre arrays (issue's egen backwards-check-note).
//
// Source-assertion-mønster (ingen jsdom i repoet, spejler LoginPage.a11y.test.js
// og TeamProfilePage.test.js) — vi kan ikke rendre komponenten uden en JSX-runtime,
// så vi bekræfter guard-mønstrene i selve kildeteksten.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "ManagerProfilePage.jsx"), "utf8");

test("achievements/season_history/transfer_activity destruktureres til 'raw'-navne, ikke direkte brugt (#2876)", () => {
  assert.match(
    src,
    /riders:\s*rawRiders,\s*\n\s*season_history:\s*rawSeasonHistory,\s*\n\s*achievements:\s*rawAchievements,\s*\n\s*transfer_activity:\s*rawTransferActivity,/,
    "de fire array-felter skal destruktureres om til raw-navne, så de ikke bruges direkte uguardet",
  );
});

test("alle tre arrays guardes med || [] samme mønster som riders (#2876)", () => {
  assert.match(src, /const season_history = rawSeasonHistory \|\| \[\];/, "season_history mangler || [] guard");
  assert.match(src, /const achievements = rawAchievements \|\| \[\];/, "achievements mangler || [] guard");
  assert.match(src, /const transfer_activity = rawTransferActivity \|\| \[\];/, "transfer_activity mangler || [] guard");
});

test("achievements-fanen viser en EmptyState når der ingen achievements er, ikke et blankt panel (#2876)", () => {
  assert.match(
    src,
    /Object\.keys\(achByCategory\)\.length === 0\s*\?\s*\(\s*<EmptyState icon=\{<InboxIcon size=\{32\} \/>\} title=\{t\("manager\.noAchievements"\)\}/,
    "achievements-tabpanelet skal rendre EmptyState når achByCategory er tomt",
  );
});

test("user-objektet guardes (kan være null for AI-styrede hold uden brugerkonto, #2876 backwards-check)", () => {
  assert.match(
    src,
    /\{user\?\.username \?\? t\("manager\.aiManaged"\)\}/,
    "manager-prefixet skal falde tilbage til manager.aiManaged når user er null",
  );
  assert.match(
    src,
    /\{user && \(\s*<div className="mt-2">\s*<OnlineBadge/,
    "OnlineBadge skal kun rendres når user findes (forudsætter et user-objekt)",
  );
});
