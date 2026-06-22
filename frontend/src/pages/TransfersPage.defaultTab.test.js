import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1569 — for en ny spiller er ALLE transfer-faner tomme (ingen tilbud, swaps,
// loans, archive). Default-fanen 'received' var derfor en tom blindgyde. Fix: når
// data er loadet og alle handels-faner er tomme, defaultes til 'market'-fanen
// (hvor der faktisk er ryttere) + en kort intro-linje der forklarer fladen.
// Effekten er én-skuds, så den ikke overskriver et bevidst fane-valg eller et
// delt ?tab=-link.
//
// node --test uden DOM → kildekode-strukturel guard.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TransfersPage.jsx"), "utf8");

test("#1569 /transfers defaulter til 'market'-fanen når alle handels-faner er tomme", () => {
  assert.match(
    src,
    /setTab\("market"\)/,
    "der skal findes et setTab(\"market\") der flytter ny spiller til fanen med faktiske ryttere",
  );
});

test("#1569 market-fanen har en kort intro-linje for nye spillere", () => {
  assert.match(
    src,
    /t\("marketIntro"\)/,
    "market-fanen skal vise en intro-linje via transfers:marketIntro",
  );
});
