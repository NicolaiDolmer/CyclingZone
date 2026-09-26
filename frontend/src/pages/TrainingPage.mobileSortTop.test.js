import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5805 (ejer 26/9): på telefonen står sorteringen ØVERST ved træningstabellen,
// ikke under den. Den bor i tabellens egen kolonne-header (rytter-kolonnen), så
// den ikke tilføjer en række over tabellen: mindst 8 ryttere skal stadig stå på
// første skærm (#5485, e2e 5485-training-overview-tabs). Kontrakten her:
// kontrollen sendes i sortSlot (header-udgaven), TrainingMobileToday sender den
// videre som tabellens riderHeader, og tabellen tegner den i <thead>.
const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");
const mobileDir = join(__dirname, "../components/training/mobile");
const today = readFileSync(join(mobileDir, "TrainingMobileToday.tsx"), "utf8");
const roster = readFileSync(join(mobileDir, "TrainingMobileRoster.tsx"), "utf8");

test("#5805 mobil-sorteringen sendes i sortSlot som header-udgaven, ikke i assistantSlot", () => {
  assert.match(page, /sortSlot=\{\s*<RosterMobileSortControl\s+header\b/);
  assert.doesNotMatch(page, /assistantSlot=\{[^}]*<RosterMobileSortControl/);
});

test("#5805 TrainingMobileToday lægger sortSlot i tabellens header, ikke som egen række", () => {
  assert.match(today, /riderHeader=\{sortSlot\}/);
  // Ingen fritstående {sortSlot} over tabellen: det kostede to ryttere på
  // første skærm (CI på PR #5810: 6 i stedet for 8).
  assert.doesNotMatch(today, /^\s*\{sortSlot\}\s*$/m);
});

test("#5805 TrainingMobileRoster tegner riderHeader i <thead> før rækkerne", () => {
  // Kun selve tabel-markuppen: filens kommentar-hoved nævner også <tbody>.
  const markup = roster.slice(roster.indexOf("<table "));
  const theadAt = markup.indexOf("<thead>");
  const headerAt = markup.indexOf("{riderHeader ?? t(\"colRider\")}");
  const tbodyAt = markup.indexOf("<tbody>");
  assert.ok(theadAt > -1 && headerAt > -1 && tbodyAt > -1);
  assert.ok(theadAt < headerAt && headerAt < tbodyAt, "sorteringen skal stå i tabellens header");
});
