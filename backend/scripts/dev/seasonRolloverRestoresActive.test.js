import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #4228 forward-guard.
//
// Den 25/8 2026 stod spillet uden aktiv saeson i ca. fire timer. Wipe og regen
// naegter begge at koere medmindre saesonen staar som 'upcoming', saa saeson 3
// blev sat tilbage kl. ~07:30 — og ingen satte den til 'active' igen. Imens var
// alders-visningen, ranglisten, den daglige traening og akademi-flytningen nede
// for ALLE spillere, fordi 30+ kaldesteder spoerger paa `.eq("status","active")`.
//
// Foer #4228 sagde scriptet blot "saet den foerst" og noevnte aldrig at saette
// den tilbage. Det var en instruktion til et menneske, ikke en garanti. Denne
// vagt fejler hvis garantien forsvinder igen.
//
// Kildekode-strukturel test, samme moenster som seasonZeroFilter.test.js: scriptet
// er en CLI med prod-sideeffekter og kan ikke koeres i en unit-test.

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "seasonRollover.mjs"),
  "utf8",
);

test("#4228: scriptet saetter selv saesonen til 'upcoming' i stedet for at bede operatoeren om det", () => {
  assert.match(
    SRC,
    /update\(\{\s*status:\s*["']upcoming["']\s*\}\)/,
    "seasonRollover skal selv aabne nedetids-vinduet, saa det ikke afhaenger af at nogen husker det",
  );
  assert.doesNotMatch(
    SRC,
    /Saet den foerst|Sæt den først/,
    "den gamle formulering bad operatoeren flippe status i haanden og sagde intet om at flippe tilbage",
  );
});

test("#4228: status genskabes til 'active' i en finally-blok", () => {
  assert.match(SRC, /\bfinally\s*\{/, "genskabelsen skal ligge i finally, ikke paa den glade sti");
  assert.match(
    SRC,
    /update\(\{\s*status:\s*["']active["']\s*\}\)/,
    "scriptet skal saette saesonen tilbage til 'active'",
  );

  // Genskabelsen SKAL kaldes fra finally. Ligger den kun i den glade sti, ville en
  // fejlet koersel efterlade spillet slukket - praecis 25/8-haendelsen.
  const finallyBlok = SRC.slice(SRC.search(/\bfinally\s*\{/));
  assert.match(
    finallyBlok,
    /genskabAktiv\s*\(\s*\)/,
    "finally-blokken skal kalde genskabelsen",
  );
});

test("#4228: en saeson der IKKE var aktiv i forvejen bliver ikke taendt", () => {
  // At slukke et live system for at stoppe er i orden; at TAENDE et er ejer-only
  // (ejer-mandat, bidt haardt 27/6). Scriptet maa derfor kun genskabe en tilstand
  // det selv har aendret.
  assert.match(SRC, /varAktivFoerRollover|varAktivFørRollover/, "scriptet skal huske indgangstilstanden");
  assert.match(
    SRC,
    /if\s*\(\s*!sattTilUpcoming\s*\)\s*return/,
    "genskabelsen skal vaere en no-op naar scriptet ikke selv slukkede saesonen",
  );
});

test("#4228: en fejlet genskabelse er hoejlydt, ikke tavs", () => {
  assert.match(
    SRC,
    /KUNNE IKKE SÆTTE SÆSONEN TILBAGE|KUNNE IKKE SAETTE SAESONEN TILBAGE/,
    "fejler UPDATE'et, skal operatoeren faa besked om at spillet stadig er slukket",
  );
  assert.match(
    SRC,
    /update seasons set status='active'/,
    "og faa den praecise SQL til at rette op i haanden",
  );
});
