import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copenhagenDayKey } from "./raceCentre.js";
import {
  seasonReceiptState,
  SEASON_RECEIPT_NOT_STARTED, SEASON_RECEIPT_RUNNING,
} from "./trainingReport.js";

// #4293 — useTrainingHistory er en React-hook, og repoet kører `node --test`
// uden DOM-renderer. Testene her er derfor todelt, samme mønster som
// useAcademyPnl.test.js:
//   • ADFÆRD: hookens dato-akse (Europe/Copenhagen) + tilstandsafledningen
//     testes gennem de to rene funktioner hooken kalder, med de FAKTISKE
//     tidspunkter fejlen opstod på.
//   • STRUKTUR: kilden assertes, så en fremtidig refaktor ikke stille kan
//     droppe den tredje tilstand og lade "+0" komme tilbage.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "useTrainingHistory.js"), "utf8");

// Prod 27/8 2026: sæson 3 stod som `active` med start_date 2026-08-28, altså
// dagen EFTER. Sæson 2 sluttede 23/8, så 24.-27/8 hørte til ingen sæson.
const S3_START = "2026-08-28";

test("#4293 aktiv sæson med start_date i morgen giver 'ikke begyndt' (prod 27/8 kl. 11)", () => {
  const today = copenhagenDayKey(Date.UTC(2026, 7, 27, 9, 0)); // 27/8 11:00 CEST
  assert.equal(today, "2026-08-27");
  assert.equal(seasonReceiptState(S3_START, today), SEASON_RECEIPT_NOT_STARTED);
});

test("#4293 sæsonen er i gang fra første minut af sin danske kalenderdag", () => {
  // 2026-08-27T22:00Z ER 28/8 kl. 00:00 i København. Med en UTC-baseret "i dag"
  // ville sæsonen stå som ikke-begyndt de første to timer af sin egen første
  // dag, mens træningen allerede kørte. Dato-aksen er kalenderdage i spillets
  // tidszone (docs/CALENDAR_RULES.md §0), ikke browserens og ikke UTC's.
  const today = copenhagenDayKey(Date.UTC(2026, 7, 27, 22, 0));
  assert.equal(today, "2026-08-28");
  assert.equal(seasonReceiptState(S3_START, today), SEASON_RECEIPT_RUNNING);
});

test("#4293 minuttet før midnat dansk tid er sæsonen stadig ikke begyndt", () => {
  const today = copenhagenDayKey(Date.UTC(2026, 7, 27, 21, 59));
  assert.equal(today, "2026-08-27");
  assert.equal(seasonReceiptState(S3_START, today), SEASON_RECEIPT_NOT_STARTED);
});

test("#4293 hooken eksponerer seasonState sammen med seasonStart", () => {
  assert.match(
    source,
    /return\s*\{[^}]*\bseasonState\b[^}]*\}/,
    "useTrainingHistory skal returnere seasonState — uden den kan fladerne ikke skelne 'ikke begyndt' fra 'i gang'",
  );
});

test("#4293 hooken afleder tilstanden af seasonReceiptState, ikke af 'har vi en dato'", () => {
  assert.match(source, /setSeasonState\(seasonReceiptState\(/, "seasonState skal komme fra seasonReceiptState");
});

test("#4293 hookens 'i dag' er en dansk kalenderdag, ikke en UTC-dag", () => {
  assert.match(
    source,
    /copenhagenDayKey\(/,
    "sammenligningsdatoen skal udledes i Europe/Copenhagen (samme akse som tick_date)",
  );
});
