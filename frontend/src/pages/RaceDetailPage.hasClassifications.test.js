// #2818 (ejer-afgørelse 21/8, genbekræftet 23/7 i PR #2821): bjerg- og
// pointkonkurrencer er per definition akkumulerende over flere dage — de findes
// KUN i etapeløb. Paris-Roubaix og Milano-Sanremo har ingen prikket trøje, kun
// én vinder. Ruten må gerne vise kategoriserede stigninger og mellemsprintens
// position (ægte klassikere annoncerer også Koppenberg og Poggio), men der må
// ikke stå point/bonussekunder "på spil" på et endagsløb, fordi det løfte
// aldrig indfries — backendens racePassages.js gater allerede korrekt på
// isStageRace (racePassages.js:56), men det gør intet ved fladen, der skal
// undlade at LOVE en konkurrence der ikke findes.
//
// Repoet kører node --test uden DOM-renderer, så kæden dækkes som
// kildekode-struktur-guards (samme mønster som RaceSelectionPanel.*.test.js):
// RaceDetailPage → StageDetailPanel/StageProfileSlot → StageProfileCard →
// StageProfileGraph + StageWaypointReadout. Den fulde visuelle adfærd
// verificeres i preview (VITE_PREVIEW_MOCK=1, race-done-1) og i
// docs/... PR-body-screenshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raceDetailPage = readFileSync(join(__dirname, "RaceDetailPage.jsx"), "utf8");
const stageDetailPanel = readFileSync(join(__dirname, "..", "components", "race", "StageDetailPanel.jsx"), "utf8");
const stageProfileCard = readFileSync(join(__dirname, "..", "components", "race", "StageProfileCard.jsx"), "utf8");
const stageProfileGraph = readFileSync(join(__dirname, "..", "components", "race", "StageProfileGraph.jsx"), "utf8");
const stageWaypointReadout = readFileSync(join(__dirname, "..", "components", "race", "StageWaypointReadout.jsx"), "utf8");

test("#2818 RaceDetailPage afleder hasClassifications af race_type, aldrig hardcoded true for et løb der kan være enkeltdags", () => {
  // Den KOMMENDE etape (planlægning) og den foldede sektion (løb i gang) skal
  // begge spørge race_type — IKKE bare antage stage_race, fordi
  // StageDetailPanel/StageProfileSlot bruges af begge race-typer.
  const scheduledMatches = [...raceDetailPage.matchAll(/hasClassifications=\{race\.race_type === "stage_race"\}/g)];
  assert.ok(
    scheduledMatches.length >= 2,
    "forventede mindst 2 steder (kommende-etape-panel + foldet udtagelses-sektion) hvor hasClassifications afledes af race.race_type — ikke hardcodes",
  );
});

test("#2818 det afsluttede endagsløbs-resultat sætter hasClassifications={false} eksplicit (aldrig default-true)", () => {
  // Efter et endagsløb er kørt renders StageProfileSlot i grenen
  // `hasAnyResults && !isStageRace` — her findes intet race_type-udtryk at
  // læne sig op ad (grenen betyder allerede "ikke etapeløb"), så false skal
  // stå eksplicit i JSX'en, ikke som defaultprop.
  assert.match(
    raceDetailPage,
    /hasAnyResults && !isStageRace[\s\S]{0,400}<StageProfileSlot[^>]*hasClassifications=\{false\}/,
    "den afsluttede enkeltdags-gren skal sætte hasClassifications={false} eksplicit på StageProfileSlot",
  );
});

test("#2818 hasClassifications-prop'en tråder helt igennem StageDetailPanel → StageProfileCard → graf + readout", () => {
  assert.match(stageDetailPanel, /hasClassifications = true,/, "StageDetailPanel skal acceptere prop'en (default true = etapeløbs-adfærd uændret)");
  assert.match(stageDetailPanel, /hasClassifications=\{hasClassifications\}/, "StageDetailPanel skal videresende prop'en til StageProfileCard");

  assert.match(
    stageProfileCard,
    /export default function StageProfileCard\(\{[^}]*hasClassifications = true[^}]*\}\)/,
    "StageProfileCard skal acceptere prop'en (default true)",
  );
  assert.match(stageProfileCard, /<StageProfileGraph[\s\S]{0,300}hasClassifications=\{hasClassifications\}/, "grafen skal modtage prop'en");
  assert.match(stageProfileCard, /<StageWaypointReadout[^>]*hasClassifications=\{hasClassifications\}/, "readouten skal modtage prop'en");
});

test("#2818 StageWaypointReadout undertrykker 'AT STAKE'-kolonnen (og dermed bonussekunder) uden klassementer", () => {
  // Early return FØR passageResultsForWaypoint kaldes — ingen point-/bonus-tal
  // må nå frem til DOM'en for et endagsløb, uanset hvad passages indeholder.
  assert.match(
    stageWaypointReadout,
    /if \(!hasClassifications\) \{\s*return \(/,
    "skal early-return en terræn-only visning når hasClassifications er false",
  );
  assert.match(
    stageWaypointReadout,
    /t\("detail\.route\.atStake"\)/,
    "'AT STAKE'/'PÅ SPIL'-teksten skal fortsat findes for etapeløb (regressions-vagt: findes stadig i koden)",
  );
  // "AT STAKE"-linjen (t("detail.route.atStake")) ligger EFTER early-return'en,
  // dvs. den kan aldrig nås når hasClassifications er false.
  const earlyReturnIdx = stageWaypointReadout.indexOf("if (!hasClassifications)");
  const atStakeIdx = stageWaypointReadout.indexOf('t("detail.route.atStake")');
  assert.ok(earlyReturnIdx >= 0 && atStakeIdx > earlyReturnIdx, "atStake-visningen skal ligge efter (dvs. uden for) !hasClassifications-early-return'en");
});

test("#2818 StageProfileGraph tegner stadig stigninger/mellemsprint på endagsløb, men uden point-/bonus-labels", () => {
  // Kategori-skiltet (HC/1/2/3/4), navnet, højden og gradienten er UBETINGEDE —
  // de tegnes altid når der er en stigning, fordi ruten er ægte information.
  assert.doesNotMatch(
    stageProfileGraph,
    /\{hasClassifications &&[\s\S]{0,80}c\.category\}/,
    "kategori-skiltet må ikke gates på hasClassifications — en klassiker viser stadig kategorien",
  );
  // Point-tallet ved en stigning (Np) OG sprintmarkørens "Np · +Ns" skal begge
  // gates bag hasClassifications.
  assert.match(
    stageProfileGraph,
    /\{hasClassifications && \(\s*<text[\s\S]{0,300}\}p[\s\S]{0,20}<\/text>/,
    "stignings-point-labelen skal gates bag hasClassifications",
  );
  assert.match(
    stageProfileGraph,
    /\{full && hasClassifications && \(\s*<text[\s\S]{0,300}sprintMarker/,
    "sprintmarkørens point/bonus-tekst skal gates bag hasClassifications",
  );
});
