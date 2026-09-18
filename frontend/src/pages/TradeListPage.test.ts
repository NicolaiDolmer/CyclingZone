import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5257 — strukturelle guards for "Alle handler"-fanen. node --test kører uden
// DOM, så kontrakterne verificeres på kilden (samme mønster som
// TransfersPage.modes.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TradeListPage.tsx"), "utf8");
const transfersSrc = readFileSync(join(__dirname, "TransfersPage.jsx"), "utf8");
const backendSrc = readFileSync(
  join(__dirname, "..", "..", "..", "backend", "lib", "tradeListFeed.js"),
  "utf8",
);

test("rapport-knappen genbruger #4346-flowet — ingen ny rapport-vej", () => {
  assert.match(src, /import ReportTradeDialog from/, "skal bruge den eksisterende dialog");
  assert.match(src, /parseTransferEventId/, "event-id parses af den delte helper, ikke lokalt");
  assert.doesNotMatch(src, /player_feedback/, "frontend må aldrig skrive i fairplay-tabellen selv");
  // Selve rapport-POSTen hører hjemme i ReportTradeDialog. Her må der kun stå
  // ÉT netværkskald, feedet — matches på kaldet, ikke på stien i en kommentar.
  const calls = [...src.matchAll(/apiFetch\(\s*`([^`]*)`/g)].map((m) => m[1]);
  assert.deepEqual(calls.length, 1, `forventede ét apiFetch-kald, fandt ${calls.length}`);
  assert.match(calls[0], /^\/api\/transfers\/feed\?/);
});

test("tom tilstand har altid en vej videre (EmptyState action)", () => {
  const blocks = src.match(/<EmptyState[\s\S]*?\n\s*\/>/g) || [];
  assert.equal(blocks.length, 1, `forventede én EmptyState-blok, fandt ${blocks.length}`);
  assert.match(blocks[0], /\baction=\{/, "EmptyState uden action er et fund, ikke en variant");
});

test("D-047: sticky navnekolonne, og mobileDefaults peger kun på byttebare kolonner", () => {
  assert.match(src, /sticky:\s*true/, "navnekolonnen skal være markeret sticky (#5102)");
  const m = src.match(/mobileDefaults=\{\[([^\]]*)\]\}/);
  assert.ok(m, "mobileDefaults skal være sat eksplicit");
  const keys = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  assert.ok(keys.length >= 1 && keys.length <= 3, `1-3 mobil-kolonner, fandt ${keys.length}`);
  // En nøgle der peger på en fold-/sticky-kolonne (eller på en kolonne der er
  // blevet omdøbt) kasserer DataTable STILLE — så tabellen viser tre andre
  // kolonner end dem siden troede. Derfor tjekkes hver nøgle mod en rigtig
  // kolonne der HVERKEN er sticky eller fold.
  for (const key of keys) {
    const block = src.match(new RegExp(`key:\\s*"${key}"[\\s\\S]*?\\n    \\},`));
    assert.ok(block, `mobileDefaults peger på ukendt kolonne "${key}"`);
    assert.doesNotMatch(block[0], /fold:\s*true|sticky:\s*true/, `"${key}" kan ikke være en mobil-standardkolonne`);
  }
});

test("dybde-loftet matcher backendens TRADE_FEED_MAX_OFFSET", () => {
  const front = src.match(/const MAX_OFFSET = (\d+)/);
  const back = backendSrc.match(/export const TRADE_FEED_MAX_OFFSET = (\d+)/);
  assert.ok(front && back, "begge konstanter skal kunne læses");
  assert.equal(
    front[1],
    back[1],
    "frontend skjuler 'Vis flere' ved samme offset som serveren afviser — ellers ender knappen i en 400",
  );
});

test("fanen er wired ind i Marked som et mode, ikke som en ny side", () => {
  assert.match(transfersSrc, /"trades"/, "trades skal findes som tab-værdi");
  assert.match(transfersSrc, /tab === "trades" && \(/, "fanen skal rendere TradeListPage");
  // .tsx-modulet importeres som .js (TypeScripts konvention, samme som
  // ReportTradeDialog.js) — nye frontend-filer er .ts/.tsx, hard rule 31.
  assert.match(transfersSrc, /import TradeListPage from "\.\/TradeListPage\.js"/);
});
