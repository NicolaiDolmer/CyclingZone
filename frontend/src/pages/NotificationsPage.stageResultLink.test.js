// #3243 — stage_result-notifikationer bar allerede metadata.raceId (#2523,
// samme form som race_result/#1952) men manglede deep-link-reglen og faldt til
// den generiske config.link ("/resultater"). For et etapeløb er en ny spillers
// FØRSTE resultat-notifikation ofte en stage_result (etape 1 er kørt, GC/samlet
// resultat kommer senere) — den ekstra klik-friktion ramte altså præcis
// funnellens sværeste trin. Kildekode-struktur-guard, samme mønster som
// MyLatestResultCard.seenServerFlag.test.js — repoet kører node --test uden
// DOM-renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "NotificationsPage.jsx"), "utf8");

test("#3243 race_result OG stage_result deep-linker begge direkte til /races/:raceId", () => {
  assert.match(
    source,
    /\(n\.type === "race_result" \|\| n\.type === "stage_result"\) && \(n\.metadata\?\.raceId \|\| n\.related_id\)/,
    "click-handleren skal route begge notifikationstyper til den specifikke løbsside",
  );
});

test("#3243 stage_result har stadig en generisk fallback i TYPE_CONFIG (uændret, bruges kun hvis raceId/related_id mangler)", () => {
  assert.match(
    source,
    /stage_result:\s*\{[^}]*link:\s*"\/resultater"/,
    "TYPE_CONFIG.stage_result.link forbliver den sikre fallback — kun click-handlerens deep-link-regel ændres",
  );
});

// #2180/#3310: selection_warning havde backend live (#3280) men manglede sin
// TYPE_CONFIG-entry — faldt til DEFAULT_TYPE_CONFIG (generisk klokke, intet
// link). Kalender-boardet er en sikker fallback (uden raceId ingen deep-link
// mulig); click-handleren deep-linker til løbets selection-anker når
// metadata.raceId/related_id findes, samme mønster som race_result/stage_result.
test("selection_warning har TYPE_CONFIG-entry med kalender-fallback", () => {
  assert.match(
    source,
    /selection_warning:\s*\{[^}]*link: "\/planning\?tab=calendar"/,
    "TYPE_CONFIG.selection_warning skal have en kalender-fallback så beskeden ikke lander uden link",
  );
});

test("selection_warning deep-linker til løbets selection-anker", () => {
  assert.match(
    source,
    /selection_warning[\s\S]{0,120}\/races\/\$\{[^}]+\}#selection/,
    "click-handleren skal route selection_warning til /races/:raceId#selection når raceId/related_id findes",
  );
});
