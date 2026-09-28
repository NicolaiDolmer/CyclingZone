// #5419 (ux, dublet #5479): "skift etape direkte fra Hold-fanen" — man skulle
// før hoppe til Etaper-fanen, klikke en etape der, og hoppe TILBAGE til
// Hold-fanen for at se rute-match/FitBar for den etape. Denne fane får nu sin
// egen linje med Etaper-fanens EGEN StageStripe (genbrugt, ikke genopfundet),
// delt om samme ?stage=-state (RaceDetailPage's `changeStage`) som Etaper-fanen
// allerede bruger — et etapeskift her opdaterer derfor PRÆCIS de samme props
// (selectedStageIndex/stageProfile/selectedStageBucket m.fl.) som ville have
// ændret sig, hvis manageren i stedet var hoppet via Etaper-fanen.
//
// Repoet kører node --test uden DOM-renderer, så kæden dækkes som
// kildekode-struktur-guards (samme mønster som RaceDetailPage.hasClassifications
// og RaceSelectionPanel.*.test.js) — den fulde visuelle adfærd verificeres i
// preview + PR-body-screenshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raceTeamTab = readFileSync(join(__dirname, "RaceTeamTab.jsx"), "utf8");
const raceDetailPage = readFileSync(join(__dirname, "..", "..", "pages", "RaceDetailPage.jsx"), "utf8");

test("#5419 RaceTeamTab genbruger StageStripe (importerer den, opfinder ingen ny etapevælger)", () => {
  assert.match(
    raceTeamTab,
    /import StageStripe from "\.\/StageStripe\.jsx";/,
    "RaceTeamTab skal importere den delte StageStripe-komponent fra samme mappe som Etaper-fanen bruger",
  );
});

test("#5419 FØR-grenen renderer StageStripe over udtagelsen, forbundet til sidens delte etape-state", () => {
  // Skal ligge i phase==="before"-grenen, EFTER den tynde profil-række (#4979,
  // uændret rækkefølge — se RaceStageProfileRow.contract.test.js) og FØR
  // RaceSelectionPanel (selve holdudtagelsen), og bruge de samme prop-navne som
  // videresendes uændret fra RaceDetailPage.
  assert.match(
    raceTeamTab,
    /if \(phase === "before"\) \{[\s\S]{0,400}<RaceStageProfileRow[\s\S]{0,700}<StageStripe\s+stages=\{stageStripeStages\}\s+activeStage=\{stageStripeActiveStage\}\s+onSelect=\{onSelectStage\}\s+times=\{stageStripeTimes\}\s*\/>[\s\S]{0,400}<RaceSelectionPanel/,
    "StageStripe skal stå i phase==='before'-grenen, mellem profil-rækken og RaceSelectionPanel, og modtage stages/activeStage/onSelect/times",
  );
});

test("#5419 de nye stribe-props har trygge defaults (renderer intet stribe-relateret uden en onSelectStage-callback)", () => {
  assert.match(
    raceTeamTab,
    /stageStripeStages = \[\],\s*\n\s*stageStripeActiveStage = null,\s*\n\s*onSelectStage = null,\s*\n\s*stageStripeTimes = null,/,
    "RaceTeamTab skal acceptere de fire stribe-props med sikre defaults (ingen krav om at kalderen altid sender dem)",
  );
  assert.match(
    raceTeamTab,
    /\{onSelectStage && \(\s*\n\s*<StageStripe/,
    "stribe-linjen skal gates bag onSelectStage, så en fremtidig kalder uden callback ikke render'er en dødt-klik-stribe",
  );
});

test("#5419 RaceDetailPage forbinder Hold-fanens stribe til DEN SAMME ?stage=/changeStage som Etaper-fanen", () => {
  // Etaper-fanens egen StageStripe-kaldested bruger `changeStage` som onSelect —
  // uændret af denne PR (regressions-vagt: samme kaldested skal stadig findes).
  assert.match(
    raceDetailPage,
    /<StageStripe stages=\{stageProfiles\} activeStage=\{stagesTabStage\} onSelect=\{changeStage\} times=\{stripeTimes\} \/>/,
    "Etaper-fanens StageStripe-kaldested skal stå uændret (samme changeStage-callback som Hold-fanen nu også bruger)",
  );
  // Hold-fanens RaceTeamTab-kaldested sender PRÆCIS samme changeStage videre som
  // onSelectStage — intet nyt etape-koncept, samme delte URL-state.
  assert.match(
    raceDetailPage,
    /<RaceTeamTab[\s\S]{0,1600}onSelectStage=\{changeStage\}/,
    "RaceTeamTab skal modtage changeStage som onSelectStage — samme funktion som Etaper-fanens StageStripe kalder",
  );
  assert.match(
    raceDetailPage,
    /<RaceTeamTab[\s\S]{0,1600}stageStripeActiveStage=\{scheduledStage\}/,
    "RaceTeamTab skal modtage scheduledStage som stripe'ns activeStage — samme kilde som FØR-fasens selectedStageIndex/profil allerede bruger",
  );
});

test("#5419 et etapeskift via changeStage rammer PRÆCIS de props der allerede fodrer FitBar/rutematch i FØR-fasen", () => {
  // Disse tre linjer er UÆNDREDE af denne PR — de læste scheduledStage FØR
  // #5419 (via Etaper-fanens hop) og gør det stadig, nu blot nemmere at nå.
  // Guarden sikrer at et klik i Hold-fanens nye stribe (som kalder changeStage,
  // der sætter ?stage= og dermed scheduledStage) rent faktisk render'er nye
  // værdier ind i RaceSelectionPanel — ikke en parallel, afkoblet etape-state.
  assert.match(
    raceDetailPage,
    /selectedStageIndex=\{selectedStageIndexForPanel\}/,
    "selectedStageIndexForPanel skal stadig fodre RaceTeamTab (og dermed RaceSelectionPanel's FitBar-beregning)",
  );
  assert.match(
    raceDetailPage,
    /selectedStageBucket=\{terrainBucket\(profileByStage\[scheduledStage\]\?\.profile_type\)\}/,
    "selectedStageBucket skal stadig afledes af scheduledStage — samme variabel StageStripe-klikket nu opdaterer direkte fra Hold-fanen",
  );
  assert.match(
    raceDetailPage,
    /const selectedStageIndexForPanel = scheduledStageNums\.indexOf\(scheduledStage\)/,
    "selectedStageIndexForPanel skal stadig udledes af scheduledStage — det er DEN variabel changeStage (nu kaldt fra Hold-fanens stribe) skriver til via ?stage=",
  );
});
