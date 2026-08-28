// #4295 (ejer-beslutning 27/8): gulvet på 6 udtagne ryttere for at stille op skal være
// synligt FØR klikket — i løbssidens panel OG på dagsboardets kolonne. Repoet kører
// node --test uden DOM-renderer, så begge flader dækkes som kildekode-struktur-guards
// (samme mønster som RaceSelectionPanel.autoSelect.test.js). Den rene regel har sine egne
// adfærdstests i lib/raceSelectionLogic.test.js, og den fulde visning verificeres i
// tests/e2e/race-selection.spec.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(__dirname, "RaceSelectionPanel.jsx"), "utf8");
const column = readFileSync(join(__dirname, "..", "racehub", "RaceColumn.jsx"), "utf8");

test("#4295 panelet afleder linjen af den DELTE regel, ikke af sin egen tælling", () => {
  // To flader der hver regner selv ender med at sige hver sit om samme løb. Reglen
  // ligger i partialSquadOutlook; begge flader kalder den.
  assert.match(panel, /import \{[^}]*partialSquadOutlook[^}]*\} from "\.\.\/\.\.\/lib\/raceSelectionLogic\.js";/);
  assert.match(column, /import \{ partialSquadOutlook \} from "\.\.\/\.\.\/lib\/raceSelectionLogic\.js";/);
});

test("#4295 panelet fodrer reglen med ryttere der er frie til NETOP dette løb", () => {
  // `availableCount` (hele den raske trup) trækker aldrig bundne ryttere fra — det var
  // den utætte antagelse #4175's escape-ventil hvilede på. freeLeft gør det.
  assert.match(
    panel,
    /const freeLeft = riders\.filter\(\(r\) => !r\.injured && !boundByRider\.has\(r\.id\) && !selectedIdSet\.has\(r\.id\)\)\.length;/,
  );
  assert.match(
    panel,
    /partialSquadOutlook\(\{\s*selected: sel\.riderIds\.length, free: freeLeft, fieldMax: size\.max, raceLive,\s*\}\)/,
  );
  assert.ok(
    !/(?:data|\.\.\.\w+)\.availableCount|availableCount\s*[,}]\s*=|availableCount:/.test(panel),
    "availableCount må ikke bruges som værdi i panelet (kun nævnes i kommentaren der forklarer hvorfor)",
  );
});

test("#4295 panelet viser konsekvensen som en linje i panelet, aldrig som en toast", () => {
  assert.match(panel, /data-outlook=\{outlook\.kind\}/, "linjen bærer hvilken af de tre sætninger der vises");
  assert.match(
    panel,
    /outlook\.kind === "willNotStart" \? "text-cz-warning" : "text-cz-3"/,
    "konsekvens er text-cz-warning (ikke text-cz-danger: en delvis trup er stadig lovlig at gemme)",
  );
  assert.match(panel, /t\(`selection\.\$\{outlook\.kind === "willNotStart"/);
});

// #4295 opfølgning (blokerende fund #4301, målt 27/8): 195 af 226 hold har nul
// udtagelser, og partialSquadOutlook sagde intet for dem. Panelet skal route de to nye
// emptySelection-udfald til deres EGNE sætninger, ikke til "N pladser åbne" (tomt for 0
// valgte) eller den generiske willNotStart (som ikke siger "fri" og "til dette løb").
test("#4295 0-valgt routes til dedikerede assistantFillsEmpty/willNotStartEmpty-nøgler", () => {
  assert.match(
    panel,
    /outlook\.emptySelection \? "willNotStartEmpty" : "willNotStart"/,
    "0 valgt + for få frie ryttere må ikke genbruge den delvise willNotStart-tekst",
  );
  assert.match(
    panel,
    /outlook\.emptySelection \? "assistantFillsEmpty" : "partialHint"/,
    "0 valgt + nok frie ryttere må ikke sige 'N pladser åbne' (meningsløst ved 0 valgt)",
  );
});

test("#4295 linjen går ALDRIG i clientErrors — Gem forbliver aktiv under gulvet", () => {
  // Gulvet ligger på deltagelsen, ikke på Gem-knappen. Klienten spejler backendens
  // validateSelection præcist: kun over feltstørrelsen + kaptajn + rolle-overlap.
  assert.match(panel, /const clientErrors = validateSelectionClient\(\{ \.\.\.sel, size \}\);/);
  // Gem-knappens spærre må kun kende validateSelectionClient — outlook er ren visning.
  assert.match(panel, /const earlySaveBlockReason = earlyClientErrors\.length > 0/);
  assert.ok(
    !/earlySaveBlockReason[\s\S]{0,200}outlook/.test(panel),
    "outlook må aldrig indgå i det der blokerer Gem",
  );
});

test("#4295 dagsboardets kolonne viser samme konsekvens", () => {
  assert.match(column, /freeRiderCountForColumn\(\{ column, roster, bindingMap \}\)/,
    "kolonnen tæller frie ryttere med den delte canAddRiderToColumn-regel");
  assert.match(column, /raceLive: locked/, "et frosset løb (#1825) får ingen linje — startfeltet er afgjort");
  assert.match(column, /data-testid="column-will-not-start"/);
  assert.match(column, /t\("selection\.willNotStartShort", willNotStart\)/);
  assert.match(column, /column\.withdrawn \? null :/, "et afmeldt hold stiller allerede ikke op — ingen dobbeltbesked");
});
