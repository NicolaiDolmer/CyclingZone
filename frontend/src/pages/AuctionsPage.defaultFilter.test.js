import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1569 — for en ny spiller er "Min situation" ALTID tom (de fører ingen auktioner
// og sælger ingen), så /auctions åbnede på en tom fane og lignede et dødt marked.
// Fix: når data er loadet og mySituationCount===0, defaultes filteret til 'all'-
// fanen, så fladen åbner med de faktiske auktioner. Effekten er én-skuds (kører
// kun før manageren selv har rørt en fane), så vi ikke kæmper mod et bevidst valg.
//
// node --test uden DOM → kildekode-strukturel guard.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "AuctionsPage.jsx"), "utf8");

test("#1569 /auctions defaulter til 'all'-fanen når manageren ingen situation har", () => {
  // En effekt skal sætte filter til 'all' når manageren ingen situation har.
  assert.match(
    src,
    /setFilter\("all"\)/,
    "der skal findes et setFilter(\"all\") der flytter ny spiller til den fane med faktiske auktioner",
  );
  // Default-flytningen skal være betinget på en tom situation (boolsk mySituation
  // udledt af samme diskriminator som render) OG at vi stadig står på 'my-situation'.
  assert.match(
    src,
    /if \(!mySituation && filter === "my-situation"\) setFilter\("all"\)/,
    "default-til-'all' skal kun ske når situationen er tom og fanen stadig er 'my-situation'",
  );
});

test("#1569 auto-default kører kun ÉN gang (ref-guard mod at kæmpe mod manuelt valg)", () => {
  assert.match(
    src,
    /didDefaultFilterRef/,
    "en ref skal sikre at auto-default'en kun kører én gang og ikke overskriver et bevidst fane-valg",
  );
});
