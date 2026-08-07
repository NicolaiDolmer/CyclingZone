// #3505 — board_critical er notifikationstypen for de MEST handlingskrævende
// bestyrelses-hændelser (tvangssalg, bonus-mål, lag 4-6-konsekvenser fra
// boardConsequences.js), men manglede sin egen TYPE_CONFIG-entry — faldt til
// DEFAULT_TYPE_CONFIG (generisk klokke, intet link) og var samtidig filtreret
// væk fra MINE_FILTER_TYPES.board (kun board_update var listet), så filteret
// der hedder "Board" skjulte netop de kritiske board-notifikationer.
// Kildekode-struktur-guard, samme mønster som NotificationsPage.stageResultLink.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "NotificationsPage.jsx"), "utf8");

test("#3505 board_critical har TYPE_CONFIG-entry med danger-styling og /board-link", () => {
  assert.match(
    source,
    /board_critical:\s*\{[^}]*Icon:\s*AlertTriangleIcon[^}]*link:\s*"\/board"/,
    "TYPE_CONFIG.board_critical skal bruge AlertTriangleIcon (danger) og linke til /board, så klik ikke lander på DEFAULT_TYPE_CONFIG",
  );
});

test("#3505 board_critical bruger danger-farve, ikke den neutrale board_update-styling", () => {
  assert.match(
    source,
    /board_critical:\s*\{[^}]*color:\s*"text-cz-danger"/,
    "board_critical skal skille sig visuelt ud fra board_update (info-styling) da den er den mest handlingskrævende type",
  );
});

test("#3505 board_critical er inkluderet i MINE_FILTER_TYPES.board", () => {
  assert.match(
    source,
    /board:\s*\[[^\]]*"board_critical"[^\]]*\]/,
    "MINE_FILTER_TYPES.board skal indeholde board_critical, ellers skjuler Board-filteret netop de kritiske notifikationer",
  );
});
