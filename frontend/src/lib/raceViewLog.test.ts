import test from "node:test";
import assert from "node:assert/strict";
import { clickKind, createRaceViewLog } from "./raceViewLog.ts";

test("#7778 tid pr. sektion laegges sammen, ogsaa naar sektionen ses to gange", () => {
  const log = createRaceViewLog(0);
  log.enter("report", 100);
  log.leave("report", 400);
  log.enter("report", 1000);
  log.enter("report", 1100);
  const out = log.finish(1500);
  assert.equal(out?.ms_report, 800);
  assert.equal(out?.duration_ms, 1500);
});

test("#7778 klik taelles pr. sektion og type, og foerste klik maales fra start", () => {
  const log = createRaceViewLog(1000);
  log.click("film", "button", 1300);
  log.click("film", "button", 1400);
  log.click("your_day", "link_riders", 1500);
  const out = log.finish(2000);
  assert.equal(out?.first_click_ms, 300);
  assert.equal(out?.click_count, 3);
  assert.equal(out?.clicks_film_button, 2);
  assert.equal(out?.clicks_your_day_link_riders, 1);
});

test("#7778 scroll gemmer det dybeste punkt og gaar aldrig over 100", () => {
  const log = createRaceViewLog(0);
  log.scroll(40);
  log.scroll(20);
  log.scroll(Number.NaN);
  assert.equal(log.finish(1000)?.max_scroll_pct, 40);
  const deep = createRaceViewLog(0);
  deep.scroll(130);
  assert.equal(deep.finish(1000)?.max_scroll_pct, 100);
});

test("#7778 en meget kort visning taeller ikke", () => {
  assert.equal(createRaceViewLog(0).finish(499), null);
});

test("#7778 klik-typen bruger kun rolle og sti, aldrig tekst eller id", () => {
  assert.equal(clickKind("a", null, "/riders/abc-123"), "link_riders");
  assert.equal(clickKind("a", null, "/race-archive/1"), "link_race_archive");
  assert.equal(clickKind("a", null, "https://example.com"), "link");
  assert.equal(clickKind("button", "tab", null), "tab");
  assert.equal(clickKind("select", null, null), "field");
  assert.equal(clickKind("button", null, null), "button");
});
