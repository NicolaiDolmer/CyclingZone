// #2886 — "How your team did" viste kun holdets SENESTE løb. En spiller bad på
// Discord om at se flere løb end det seneste, med point og præmiepenge pr. løb,
// plus sæson-akkumulerede totaler. Kortet renderer nu en "Tidligere løb"-liste
// og en sæson-total i bunden.
//
// Kildekode-struktur-guard (samme mønster som
// MyLatestResultCard.seenServerFlag.test.js) — repoet kører node --test uden
// DOM-renderer, så testene låser de kontrakter der er dyre at opdage i prod:
// data-kontrakten, mobil-layoutet (ingen vandret scroll) og design-reglerne.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "MyLatestResultCard.jsx"), "utf8");
const en = JSON.parse(
  readFileSync(join(__dirname, "../../public/locales/en/dashboard.json"), "utf8")
);
const da = JSON.parse(
  readFileSync(join(__dirname, "../../public/locales/da/dashboard.json"), "utf8")
);

test("#2886 kortet læser history + season_totals fra endpointets payload", () => {
  assert.match(
    source,
    /history\s*=\s*\[\]/,
    "history skal defaulte til tom liste, så et gammelt/degraderet svar ikke vælter kortet",
  );
  assert.match(
    source,
    /season_totals:\s*seasonTotals\s*=\s*null/,
    "season_totals skal defaulte til null (sektionen skjules frem for at vise 0 point)",
  );
});

test("#2886 begge nye sektioner er betingede — et svar uden historik renderer det oprindelige kort uændret", () => {
  assert.match(source, /\{history\.length > 0 && \(/, "historik-sektionen skal være betinget af mindst ét tidligere løb");
  assert.match(source, /\{seasonTotals && \(/, "sæson-totalen skal kun rendere når serveren har leveret den");
});

test("#2886 historikken foldes ved 5 rækker med en show all/show less-toggle", () => {
  assert.match(source, /const COLLAPSED_HISTORY_ROWS = 5;/);
  assert.match(
    source,
    /historyExpanded \? history : history\.slice\(0, COLLAPSED_HISTORY_ROWS\)/,
    "kun de første rækker vises indtil manageren folder ud",
  );
  assert.match(source, /aria-expanded=\{historyExpanded\}/, "toggle-knappen skal annoncere sin tilstand");
});

test("#2886 mobil (54,9% af besøg): løbsnavnet truncater — tal-kolonnen må ikke skabe vandret scroll", () => {
  const row = source.slice(source.indexOf("function HistoryRow"), source.indexOf("export default"));
  assert.match(row, /flex-1 min-w-0[^"]*truncate/, "løbsnavnet skal være det element der giver plads (min-w-0 + truncate)");
  assert.doesNotMatch(row, /overflow-x|whitespace-nowrap on the row/, "rækken må ikke introducere vandret scroll");
  assert.equal((row.match(/flex-shrink-0/g) || []).length, 2, "rang- og tal-kolonnen skal begge være faste, så navnet er det eneste der giver efter");
});

test("#2886 design: tabular figures på al ny numerik, data-font, ingen emoji/skygger/rounded-2xl", () => {
  const added = source.slice(source.indexOf("function HistoryRow"));
  const numericSpans = added.match(/font-data[^"]*/g) || [];
  assert.ok(numericSpans.length >= 6, "de nye tal skal bruge data-fonten");
  for (const cls of numericSpans) {
    // Meta-labels (uppercase-overskrifter) er ikke tal og skal ikke have tabular-nums.
    if (cls.includes("uppercase")) continue;
    assert.match(cls, /tabular-nums/, `numerisk klasse uden tabular-nums: "${cls}"`);
  }
  assert.doesNotMatch(source, /rounded-2xl|shadow-|drop-shadow/, "ingen AI-slop-flader");
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "ingen emoji i player-facing markup");
});

test("#2886 i18n: alle nye nøgler findes i BÅDE en og da, EN uden em-dash", () => {
  for (const key of ["pointsShort", "thisRace", "earlier", "showAll", "showLess", "season", "seasonRaces"]) {
    assert.ok(en.cards.myResult[key], `en/dashboard.json mangler cards.myResult.${key}`);
    assert.ok(da.cards.myResult[key], `da/dashboard.json mangler cards.myResult.${key}`);
    assert.doesNotMatch(en.cards.myResult[key], /—/, `em-dash i player-copy: ${key}`);
    assert.doesNotMatch(da.cards.myResult[key], /—/, `em-dash i player-copy: ${key}`);
  }
  // Hver nøgle kortet slår op skal findes i katalogerne (fanger tastefejl).
  for (const [, key] of source.matchAll(/t\("dashboard:cards\.myResult\.(\w+)"/g)) {
    assert.ok(en.cards.myResult[key], `kortet slår cards.myResult.${key} op, men den findes ikke i en/dashboard.json`);
    assert.ok(da.cards.myResult[key], `kortet slår cards.myResult.${key} op, men den findes ikke i da/dashboard.json`);
  }
});
