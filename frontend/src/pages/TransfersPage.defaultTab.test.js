import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1569 — for en ny spiller er ALLE transfer-faner tomme (ingen tilbud, swaps,
// archive). Default-fanen 'received' var derfor en tom blindgyde. Fix: når
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

// #4628 (slice 6 af #4622): #1569's intro-linje er flyttet til Hjaelp. TASTE P9
// ("kort paa fladen, manualer i Hjaelp") + audit 2026-09 taeller prosa mellem
// faner og filter som chrome foer data. Det #1569 loeste — at en ny spiller ikke
// lander i en tom blindgyde — loeses fortsat af default-fane-skiftet ovenfor.
test("#4628 market-fanen har ingen intro-prosa paa fladen", () => {
  assert.doesNotMatch(
    src,
    /t\("marketIntro"\)/,
    "manualen bor i help.json ('What is the transfer system?'), ikke mellem faner og filter",
  );
});

// #4628: fladen maa kun have ÉT sorterings-idiom paa desktop. De otte
// sorterings-chips + evne-dropdownen er erstattet af tabellens egne
// kolonneoverskrifter; MarketSortControl (sm:hidden) giver mobil-paritet.
test("#4628 markedet har ét sorterings-idiom pr. viewport", () => {
  assert.doesNotMatch(src, /MARKET_SORT_BUTTONS/, "sorterings-chip-raekken skal vaere fjernet");
  assert.doesNotMatch(src, /marketSort\.abilityPlaceholder/, "evne-sorterings-dropdownen skal vaere fjernet");
  assert.match(src, /function MarketSortControl\(/, "mobil-sorteringen skal findes");
  assert.match(src, /sm:hidden/, "MarketSortControl er kun synlig under sm-breakpointet");
});

// #4628 (TASTE fork 4): hver tom tilstand skal have en handling. EmptyState
// logger console.error i DEV uden `action`.
test("#4628 alle EmptyState paa /transfers har en action-prop", () => {
  // Blokken slutter ved et `/>` alene paa sin egen linje — inline-ikonets `/>`
  // staar altid midt paa en linje og maa ikke afslutte matchet.
  const blocks = src.match(/<EmptyState[\s\S]*?\n\s*\/>/g) || [];
  assert.ok(blocks.length >= 5, `forventede mindst 5 EmptyState-blokke, fandt ${blocks.length}`);
  for (const block of blocks) {
    assert.match(block, /\baction=\{/, `EmptyState uden action:\n${block}`);
  }
});
