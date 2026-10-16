// #6728 fund 4-11 + 13: kildevagter, saa klipning og blandet knap-anatomi ikke kommer tilbage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

test("fund 4 + 11: forumtitler ombrydes paa mobil og klippes kun fra sm og op", () => {
  for (const rel of ["../components/ForumHighlightsCard.jsx", "ForumPage.jsx"]) {
    const src = read(rel);
    assert.match(src, /min-w-0 break-words sm:truncate text-\[13\.5px\]/, rel);
    assert.doesNotMatch(src, /min-w-0 truncate text-\[13\.5px\]/, rel);
  }
  // Forfatteren paa forumlisten maa ikke klippes ("AF DOL…").
  assert.doesNotMatch(read("ForumPage.jsx"), /<span className="truncate">\s*\{t\("list\.by"/);
});

test("fund 5: loebsnavnet paa rytterens resultater klippes ikke paa mobil", () => {
  assert.match(read("../components/rider/profile/RiderResultsTab.jsx"), /font-semibold break-words sm:truncate/);
});

test("fund 6: Byd og autobud har samme anatomi (12 px, semibold)", () => {
  const src = read("AuctionsPage.jsx");
  assert.doesNotMatch(src, /text-3xs font-bold text-cz-2/);
  assert.doesNotMatch(src, /rounded-cz text-sm font-bold/);
});

test("fund 7: traeningens assistent-raekke bruger 12 px som 'Vaelg ryttere'", () => {
  const src = read("TrainingPage.jsx");
  const i = src.indexOf('data-testid="training-assistant-row"');
  const block = src.slice(i, i + 600);
  assert.match(block, /text-start text-xs/);
  assert.doesNotMatch(block, /text-\[13px\]/);
});

test("fund 8: Auto-udfyld, Ryd dag og Ryd alt har samme anatomi og brydes ikke", () => {
  const src = read("../components/racehub/AvailableRidersPool.jsx");
  assert.match(src, /gap-1\.5 whitespace-nowrap/);
  assert.doesNotMatch(src, /text-2xs uppercase tracking-wide font-medium text-cz-accent-t/);
});

test("fund 9: loebsnavne i kalendergitteret ombrydes i stedet for at klippes", () => {
  assert.match(read("CalendarPage.jsx"), /min-w-0 break-words text-2xs font-medium/);
});

test("fund 10: synes-godt-om har samme hoejde og skrift som Citér/Rapportér (Button sm)", () => {
  const src = read("ForumPostPage.jsx");
  const block = src.slice(src.indexOf("function SupportButton"), src.indexOf("function SupportButton") + 800);
  assert.match(block, /px-3 py-1\.5 text-xs font-semibold/);
});

test("fund 13: reglernes sidemenu er bred nok fra lg", () => {
  assert.match(read("RulesPage.jsx"), /hidden md:block w-40 lg:w-52 shrink-0/);
});

test("fund 11: et langt forfatternavn uden mellemrum kan krympe og bryde (ingen vandret scroll)", () => {
  assert.match(read("ForumPage.jsx"), /<span className="min-w-0 \[overflow-wrap:anywhere\]">\s*\{t\("list\.by"/);
});
