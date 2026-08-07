// #3520 (spillerforslag, carpediemjbp): klik på rytternavnet i holdudtagelsen skal
// åbne en profil-popup — checkboxen bliver eneste vælger. Kildekode-struktur-guard
// (samme mønster som RaceSelectionPanel.autoSelect.test.js — repoet kører
// node --test uden DOM-renderer, ingen @testing-library her).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RaceSelectionPanel.jsx"), "utf8");
const modalSource = readFileSync(
  join(__dirname, "..", "rider", "RiderMiniProfileModal.jsx"),
  "utf8",
);

test("#3520 mobil-listen: checkboxen har sin egen aria-label og toggler stadig via toggleRider", () => {
  assert.match(
    source,
    /<input\s*\n\s*type="checkbox"\s*\n\s*checked=\{checked\}\s*\n\s*disabled=\{disabled\}\s*\n\s*aria-label=\{rider\.name\}\s*\n\s*onChange=\{\(\) => update\(toggleRider\(sel, rider\.id, size\.max\)\)\}/,
    "checkboxen skal beholde toggleRider-onChange OG have sin egen aria-label, nu hvor labelen ikke længere wrapper navnet",
  );
});

test("#3520 mobil-listen: navnet er en knap der åbner profil-popup, IKKE en del af checkbox-labelen", () => {
  assert.match(
    source,
    /<button\s*\n\s*type="button"\s*\n\s*onClick=\{\(\) => setProfileRider\(rider\)\}\s*\n\s*aria-label=\{t\("selection\.riderProfile\.viewProfile", \{ name: rider\.name \}\)\}[\s\S]{0,400}>\s*\n\s*\{rider\.name\}\s*\n\s*<\/button>/,
    "navnet skal være en <button> med aria-label der kalder setProfileRider — ikke toggleRider",
  );
});

test("#3520 desktop-tabellen: checkbox-labelen wrapper KUN inputtet (ikke navnet længere)", () => {
  assert.match(
    source,
    /<label className=\{`flex items-center \$\{disabled \? "cursor-not-allowed" : "cursor-pointer"\}`\}>\s*\n\s*<input\s*\n\s*type="checkbox"\s*\n\s*checked=\{checked\}\s*\n\s*disabled=\{disabled\}\s*\n\s*aria-label=\{rider\.name\}\s*\n\s*onChange=\{\(\) => update\(toggleRider\(sel, rider\.id, size\.max\)\)\}[\s\S]{0,120}\/>\s*\n\s*<\/label>/,
    "desktop checkbox-labelen skal kun indeholde <input> — navnet er flyttet ud som sibling-knap",
  );
});

test("#3520 desktop-tabellen: navnet er en knap der åbner profil-popup", () => {
  assert.match(
    source,
    /<button\s*\n\s*type="button"\s*\n\s*onClick=\{\(\) => setProfileRider\(rider\)\}\s*\n\s*aria-label=\{t\("selection\.riderProfile\.viewProfile", \{ name: rider\.name \}\)\}/,
    "desktop-tabellens navn skal også være en knap der kalder setProfileRider",
  );
});

test("#3520 profileRider-state initialiseres til null og rører aldrig sel/udtagelsen", () => {
  assert.match(
    source,
    /const \[profileRider, setProfileRider\] = useState\(null\);/,
    "profileRider skal være sit eget state, adskilt fra sel (udtagelsen)",
  );
  // Ingen kald i komponenten skal sætte `sel` fra profileRider — søg efter en evt.
  // util-funktion der kobler dem sammen (ville være en regression af AC'et).
  assert.doesNotMatch(
    source,
    /setSel\([^)]*profileRider/,
    "profileRider må aldrig bruges til at ændre sel — popuppen er ren visning",
  );
});

test("#3520 modalen renderes med rider=profileRider og en onClose der nulstiller til null (ikke sel)", () => {
  assert.match(
    source,
    /<RiderMiniProfileModal\s*\n\s*rider=\{profileRider\}[\s\S]{0,300}onClose=\{\(\) => setProfileRider\(null\)\}/,
    "RiderMiniProfileModal skal styres af profileRider/setProfileRider alene",
  );
});

test("#3520 RiderMiniProfileModal bruger useModalA11y (Escape-luk + klik-udenfor + focus-trap)", () => {
  assert.match(
    modalSource,
    /useModalA11y\(active \? onClose : null, active\)/,
    "modalen skal genbruge den delte a11y-hook i stedet for at opfinde sin egen Escape/fokus-håndtering",
  );
  assert.match(
    modalSource,
    /role="dialog"[\s\S]{0,40}aria-modal="true"/,
    "modalen skal sætte role=dialog + aria-modal=true på panelet",
  );
  assert.match(
    modalSource,
    /onClick=\{onClose\}/,
    "klik på backdroppen skal lukke modalen uden at ændre udtagelsen",
  );
});

test("#3520 RiderMiniProfileModal renderer intet uden en rider (lukket-tilstand)", () => {
  assert.match(
    modalSource,
    /if \(!rider\) return null;/,
    "modalen skal returnere null når ingen rider er valgt (profileRider === null)",
  );
});

test("#3520 RiderMiniProfileModal panelet er fuld-skærm på mobil og en centreret kort-modal fra sm+ (T3-hero-signatur)", () => {
  assert.match(
    modalSource,
    /w-full h-full sm:h-auto sm:w-full sm:max-w-md/,
    "panelet skal fylde hele skærmen under sm (fuld-skærms sheet) og blive en begrænset kort-bredde fra sm og op",
  );
  assert.match(
    modalSource,
    /border-t-2 border-t-cz-accent/,
    "T3-hero-signaturen (2px guld-keyline på kortets topkant) skal være til stede, jf. PAGE_TEMPLATES.md",
  );
});
