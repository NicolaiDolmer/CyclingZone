// #5636: Race Centre-kortets afmeldt-gren. Samme mønster som
// RaceStageProfileRow.contract.test.js: repoet kører node --test uden jsdom,
// så komponent-kontrakten pinnes på kilden i stedet for et RTL-render.
//
// Hvad der pinnes, og hvorfor:
//   1. Et afmeldt hold (selection.withdrawn) viser "Withdrawn", ALDRIG
//      "Line-up ready"/"incomplete" — afmeldt hold stiller ikke op (#4306),
//      og entries bevares ved afmelding, så uden denne gren så et afmeldt
//      hold stadig sit gamle "Line-up ready".
//   2. Den afmeldte gren tjekkes FØR complete/incomplete-forgreningen, så en
//      fremtidig omskrivning ikke ved et uheld lader lineupReady vinde.
//   3. `selection === null` (intet svar — limited/unauthorized) falder
//      stadig til lineupUnknown, uændret af denne fix.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RaceCentreCard.jsx"), "utf8");

test("afmeldt hold viser withdrawn-nøglen, ikke lineupReady/Incomplete", () => {
  assert.match(source, /selection\.withdrawn\s*\n?\s*\?\s*t\("raceCentre\.card\.withdrawn"\)/);
});

test("withdrawn-tjekket står FØR complete/incomplete-forgreningen", () => {
  const selectionBlock = source.slice(
    source.indexOf("card.isOwn && ("),
    source.indexOf("card.isOwn && (") + 900,
  );
  const withdrawnAt = selectionBlock.indexOf("selection.withdrawn");
  const readyAt = selectionBlock.indexOf("raceCentre.card.lineupReady");
  assert.ok(withdrawnAt > 0, "withdrawn-tjekket skal findes i opstillings-linjen");
  assert.ok(readyAt > 0, "lineupReady-nøglen skal stadig findes");
  assert.ok(withdrawnAt < readyAt, "withdrawn skal afgøres før lineupReady/Incomplete");
});

test("intet svar (selection null) falder stadig til lineupUnknown", () => {
  assert.match(source, /:\s*t\("raceCentre\.card\.lineupUnknown"\)/);
});

test("opstillings-linjen er stadig scopet til egne løb (card.isOwn)", () => {
  assert.match(source, /\{card\.isOwn && \(/);
});
