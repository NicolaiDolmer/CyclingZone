// backend/scripts/renderV4AnchorTable.test.mjs
// #4911: ren-funktion-tests af renderV4AnchorTable.mjs + en forward-guard der
// verificerer at doc-blokken i docs/RACE_ENGINE_RULES.md faktisk matcher den
// committede baseline (samme tjek som --check, men som en del af
// `node --test` i stedet for et separat CLI-kald).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderAnchorTable,
  replaceAnchorBlock,
  START_MARKER,
  END_MARKER,
} from "./renderV4AnchorTable.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

function fixtureBaseline() {
  return {
    main_sha: "abcdef1234567890",
    population_file: "backend/scripts/baselines/population-snapshot-2026-07-11.json",
    population_file_sha256_16: "deadbeefdeadbeef",
    population_riders: 5650,
    stages_file: "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json",
    stages_file_sha256_16: "cafebabecafebabe",
    seeds: ["s1", "s2", "s3"],
    field_size: 180,
    order_mode: "none",
    generated_at: "2026-09-06T00:00:00.000Z",
    refresh_command: "node backend/scripts/buildV4AnchorBaseline.mjs && node backend/scripts/renderV4AnchorTable.mjs --write",
    anchors: [
      {
        id: "field_cohesion_flat",
        label: "Felt-sammenhaeng, flade etaper",
        band_label: "80.0%-95.0%",
        source: "#3917-maalingen",
        v3: { value: 0.04, sampleCount: 96, verdict: "FAIL", naReason: null, spread: { min: 0.038, max: 0.041, seeds: 3 } },
        v4: { value: 0.266, sampleCount: 96, verdict: "FAIL", naReason: null, spread: { min: 0.253, max: 0.282, seeds: 3 } },
      },
      {
        id: "gt_winner_margin",
        label: "GT-vindermargin (#2415)",
        band_label: "60-480s (1-8 min)",
        source: "#2415",
        v3: { value: null, sampleCount: 0, verdict: "N/A", naReason: "kraever akkumuleret GC", spread: null },
        v4: { value: null, sampleCount: 0, verdict: "N/A", naReason: "kraever akkumuleret GC", spread: null },
      },
    ],
  };
}

test("renderAnchorTable: producerer en blok med start- og slutmarkoer", () => {
  const block = renderAnchorTable(fixtureBaseline());
  assert.ok(block.startsWith(START_MARKER));
  assert.ok(block.endsWith(END_MARKER));
});

test("renderAnchorTable: hver anker-raekke har label, baand-kilde og BEGGE motorer", () => {
  const block = renderAnchorTable(fixtureBaseline());
  assert.match(block, /Felt-sammenhaeng, flade etaper/);
  assert.match(block, /80\.0%-95\.0%/);
  assert.match(block, /#3917-maalingen/);
});

test("renderAnchorTable: PASS/FAIL-vaerdier faar spaend i parentes + verdict i [ ]", () => {
  const block = renderAnchorTable(fixtureBaseline());
  assert.match(block, /4\.0 % \(3\.8 %-4\.1 %\) \[FAIL\]/);
});

test("renderAnchorTable: N/A-celler renderes som 'n/a', ikke NaN eller tom streng", () => {
  const block = renderAnchorTable(fixtureBaseline());
  const gtRow = block.split("\n").find((l) => l.includes("GT-vindermargin"));
  assert.ok(gtRow);
  assert.match(gtRow, /\| n\/a \| n\/a \|$/);
});

test("renderAnchorTable: refresh-kommandoen fra baseline'en staar i blokken", () => {
  const block = renderAnchorTable(fixtureBaseline());
  assert.match(block, /node backend\/scripts\/buildV4AnchorBaseline\.mjs/);
});

test("replaceAnchorBlock: erstatter KUN teksten mellem markoererne, resten uroert", () => {
  const doc = `# Titel\n\nFoer.\n\n${START_MARKER}\ngammelt indhold\n${END_MARKER}\n\nEfter.\n`;
  const next = replaceAnchorBlock(doc, `${START_MARKER}\nnyt indhold\n${END_MARKER}`);
  assert.match(next, /# Titel/);
  assert.match(next, /Foer\./);
  assert.match(next, /Efter\./);
  assert.match(next, /nyt indhold/);
  assert.doesNotMatch(next, /gammelt indhold/);
});

test("replaceAnchorBlock: kaster en tydelig fejl hvis markoererne mangler", () => {
  const doc = "# Titel uden markoerer\n";
  assert.throws(() => replaceAnchorBlock(doc, "noget"), /Fandt ikke begge markoerer/);
});

test("renderAnchorTable: er en REN funktion — samme input giver byte-identisk output", () => {
  const baseline = fixtureBaseline();
  assert.equal(renderAnchorTable(baseline), renderAnchorTable(baseline));
});

// ---------------------------------------------------------------------------
// Forward-guard: doc-blokken i RACE_ENGINE_RULES.md matcher den committede
// baseline. Fejler hvis nogen retter tallene i haanden uden at koere
// renderV4AnchorTable.mjs --write, eller opdaterer baseline'en uden at
// re-rendere docs.
// ---------------------------------------------------------------------------

test("RACE_ENGINE_RULES.md's ankertabel matcher den committede baseline-JSON", () => {
  const baselinePath = join(REPO_ROOT, "backend/scripts/baselines/v4-anchor-baseline.json");
  const docPath = join(REPO_ROOT, "docs/RACE_ENGINE_RULES.md");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const docText = readFileSync(docPath, "utf8");

  const startIdx = docText.indexOf(START_MARKER);
  const endIdx = docText.indexOf(END_MARKER);
  assert.notEqual(startIdx, -1, `${START_MARKER} mangler i docs/RACE_ENGINE_RULES.md`);
  assert.notEqual(endIdx, -1, `${END_MARKER} mangler i docs/RACE_ENGINE_RULES.md`);

  const currentBlock = docText.slice(startIdx, endIdx + END_MARKER.length);
  const expectedBlock = renderAnchorTable(baseline);
  // EOL-uafhaengig sammenligning: Windows-checkouts (core.autocrlf=true)
  // normaliserer .md-filer til CRLF, mens renderAnchorTable() arbejder i LF —
  // se renderV4AnchorTable.mjs's normalizeEol()-kommentar for hvorfor.
  const stripCr = (s) => s.replace(/\r\n/g, "\n");
  assert.equal(
    stripCr(currentBlock),
    stripCr(expectedBlock),
    "docs-blokken er ude af sync med baseline'en — koer: " +
      "node backend/scripts/renderV4AnchorTable.mjs --write",
  );
});
