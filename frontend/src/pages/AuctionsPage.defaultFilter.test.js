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
// #1777 — den aktive fane lever nu i URL'en (?tab=) i stedet for React-only
// useState, så browser-back fra en rytter-profil genskaber den fane manageren
// stod på. Auto-default'en må derfor IKKE overskrive en deep-linket/back-navigeret
// fane (?tab= i URL'en).
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

test("#1777 aktiv fane læses fra ?tab= URL-param (browser-back rammer rigtig fane)", () => {
  // Fanen skal udledes af searchParams.get('tab'), ikke React-only useState.
  assert.match(
    src,
    /useSearchParams/,
    "AuctionsPage skal bruge useSearchParams så fanen lever i URL'en",
  );
  assert.match(
    src,
    /const tabParam = searchParams\.get\("tab"\)/,
    "den aktive fane skal læses fra ?tab= URL-param'en",
  );
  // Default-fanen udelader param'en; ikke-default sætter ?tab= med { replace: true }.
  assert.match(
    src,
    /setSearchParams\(key === DEFAULT_FILTER \? \{\} : \{ tab: key \}, \{ replace: true \}\)/,
    "fane-valg skal skrive ?tab= (replace) og udelade param'en for default-fanen",
  );
});

test("#1777 auto-default overskriver ikke en deep-linket/back-navigeret fane", () => {
  // Auto-default'en skal bail'e ud hvis ?tab= allerede står i URL'en.
  assert.match(
    src,
    /if \(loading \|\| didDefaultFilterRef\.current \|\| tabParam\) return/,
    "auto-default'en skal springe over når en fane allerede er deep-linket via ?tab=",
  );
});
