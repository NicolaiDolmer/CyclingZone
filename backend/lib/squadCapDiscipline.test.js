import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TRANSFER_WINDOW_SOFT_CAP_BUFFER } from "./marketUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// #267 close-out · regression-guard. Bug'en var: auctionFinalization.js +
// 5 user-paths kaldte getIncomingSquadViolation(state) uden at sende et
// window-aware softCapBuffer, så D3-managers blev afvist i døren ved 10
// ryttere selvom transfer-vinduet var åbent. Default-arg
// `softCapBuffer = 0` matcher closed-window-semantik — så enhver NY
// callsite der tilføjes uden at tænke over vindue-state regresserer
// silently til hard-cap.
//
// Denne test parser kildekoden for ALLE getIncomingSquadViolation-calls
// og håndhæver at hver call eksplicit sætter softCapBuffer (enten
// TRANSFER_WINDOW_SOFT_CAP_BUFFER for open-window-paths eller 0 for
// closed-window-paths). En tom 2.-arg er ikke acceptabel — vi vil have
// at den next dev der introducerer en ny path bliver tvunget til at
// tage stilling.

test("TRANSFER_WINDOW_SOFT_CAP_BUFFER er stadig 2 (gameplay-spec match)", () => {
  assert.equal(
    TRANSFER_WINDOW_SOFT_CAP_BUFFER,
    2,
    "Soft-cap buffer er hardcoded til +2 i regelteksten — ændringer kræver migration + patch notes",
  );
});

const CALLSITE_FILES = [
  // #1994: rider-loan agreement accept/buyout routes removed — dropped from 4 to 2.
  { rel: "../routes/api.js", expectedCalls: 2 },
  // #2754: 2. callsite — senior-fallback for en vundet ungdomsauktion når
  // akademiet er fuldt (hard-cap, softCapBuffer: 0 — ingen transfervindue).
  { rel: "./auctionFinalization.js", expectedCalls: 2 },
  { rel: "./transferExecution.js", expectedCalls: 1 },
];

// Find each `getIncomingSquadViolation(` and capture the full call's
// argument-string via balanced-paren slicing (handles nested {}/strings).
function extractSquadCalls(source) {
  const callRegex = /getIncomingSquadViolation\s*\(/g;
  const calls = [];
  let match;
  while ((match = callRegex.exec(source)) !== null) {
    const openIdx = source.indexOf("(", match.index);
    if (openIdx === -1) continue;
    let depth = 1;
    let i = openIdx + 1;
    let inString = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (inString) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inString) inString = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    if (depth !== 0) continue;
    const args = source.slice(openIdx + 1, i - 1);
    const line = source.slice(0, match.index).split("\n").length;
    calls.push({ line, args });
  }
  return calls;
}

const ALL_CALLSITES = CALLSITE_FILES.map(({ rel, expectedCalls }) => {
  const filePath = resolve(__dirname, rel);
  const source = readFileSync(filePath, "utf8");
  const calls = extractSquadCalls(source);
  return { rel, expectedCalls, calls };
});

for (const { rel, expectedCalls, calls } of ALL_CALLSITES) {
  test(`${rel} har ${expectedCalls} getIncomingSquadViolation-callsite(s) (drift-detector)`, () => {
    assert.equal(
      calls.length,
      expectedCalls,
      `Forventet ${expectedCalls} callsites men fandt ${calls.length}. Hvis du har tilføjet/fjernet et callsite, opdater CALLSITE_FILES i squadCapDiscipline.test.js og verificér at hver call sætter softCapBuffer korrekt for sit window-context.`,
    );
  });

  for (const { line, args } of calls) {
    test(`${rel}:${line} — getIncomingSquadViolation skal sætte softCapBuffer eksplicit (#267 regression-guard)`, () => {
      assert.match(
        args,
        /\bsoftCapBuffer\s*:/,
        [
          `Callsite mangler softCapBuffer i 2. arg.`,
          `Open-window paths (auctionFinalization efter window-lookup, transfer/loan/swap-routes der allerede har gated på open === true) skal sætte 'softCapBuffer: TRANSFER_WINDOW_SOFT_CAP_BUFFER'.`,
          `Closed-window/hard-cap paths skal sætte 'softCapBuffer: 0' eksplicit så intentionen er dokumenteret.`,
          `Default-arg er bevidst 0 for unit-test-bagudkompat — production callsites SKAL vælge.`,
        ].join(" "),
      );
    });
  }
}
