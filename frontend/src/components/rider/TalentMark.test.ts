// #7879 · Talentmærkets kontrakt. Repoet kører node --test uden jsdom, så
// placeringen og kontakten pinnes på kilden; reglerne bag mærkerne testes i
// backend/lib/talentMarks7879.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const mark = read("TalentMark.tsx");
const cell = read("RiderNameCell.jsx");
const hero = read("profile/RiderProfileHero.jsx");
const help = read("../../pages/HelpPage.jsx");
const backend = read("../../../../backend/lib/talentMarks7879.js");
const catalog = read("../../../../backend/lib/stageFlagCatalog.js");

const LANGS = ["en", "da", "es", "fr", "nl"];
const locale = (lang: string, ns: string) => JSON.parse(read(`../../../public/locales/${lang}/${ns}.json`));

test("kontakten er den samme i frontend, backend og spiller-allowlisten", () => {
  assert.match(mark, /TALENT_MARKS_FLAG_KEY = "talent_marks_7879"/);
  assert.match(backend, /TALENT_MARKS_FLAG_KEY = "talent_marks_7879"/);
  const allow = catalog.slice(catalog.indexOf("PLAYER_VISIBLE_FLAG_KEYS = Object.freeze(["));
  assert.match(allow.slice(0, allow.indexOf("]);")), /"talent_marks_7879"/);
});

test("slukket kontakt = mærkerne hentes slet ikke", () => {
  const load = mark.slice(mark.indexOf("async function loadTalentMarks"), mark.indexOf("function ensureLoaded"));
  const flagCheck = load.indexOf("flags?.[TALENT_MARKS_FLAG_KEY] !== true) return new Map()");
  assert.ok(flagCheck > 0, "kontakten tjekkes først");
  assert.ok(load.indexOf("rider_talent_marks") > flagCheck, "tabellen læses først efter kontakten");
});

test("navnecellen: nation, navn, mærke, status (TASTE P12)", () => {
  const link = cell.indexOf("</RiderLink>");
  const talent = cell.indexOf("<RiderTalentMark riderId={id} />");
  const status = cell.indexOf("{children}");
  assert.ok(link > 0 && talent > link && status > talent);
});

test("profilen viser den fulde tekst i 24 px under navnet", () => {
  assert.match(hero, /<RiderTalentMark riderId=\{rider\.id\} variant="profile" \/>/);
  assert.match(mark, /<Icon size=\{24\} \/>/);
  assert.match(mark, /<Icon size=\{16\} \/>/);
});

test("et tryk på mærket i en klikbar række åbner ikke rytteren", () => {
  assert.match(mark, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); e\.preventDefault\(\); \}\}/);
  assert.match(mark, /<Tooltip label=\{`\$\{name\}: \$\{short\}`\}/);
});

test("ikonerne bruger tokens, ingen rå hex (TASTE §3)", () => {
  // Et issue-nummer (#7879) er ikke en farve: kun tokens med et hex-bogstav tæller.
  assert.doesNotMatch(mark, /#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/);
});

test("Hjælp-blokken følger kontakten", () => {
  assert.match(help, /\{ id: "talentMarks", kind: "text", flag: "talent_marks_7879" \}/);
});

test("teksterne findes på alle fem sprog", () => {
  for (const lang of LANGS) {
    const r = locale(lang, "rider").talentMark;
    for (const key of ["name", "short", "full", "fullNoType"]) assert.ok(r?.topTalent?.[key], `${lang} topTalent.${key}`);
    for (const key of ["name", "short", "full"]) assert.ok(r?.nextGen?.[key], `${lang} nextGen.${key}`);
    assert.ok(r?.helpLink, `${lang} helpLink`);
    assert.match(r.topTalent.full, /\{type\}/, `${lang} topTalent.full bruger typen`);
    const h = locale(lang, "help").sections.riders.talentMarks;
    assert.ok(h?.title && h?.text, `${lang} help talentMarks`);
    assert.doesNotMatch(`${JSON.stringify(r)} ${h.text}`, /—/, `${lang}: ingen em-dash`);
  }
});

test("ingen tekst lover potentiale: mærket måles på rating og synlig fremgang", () => {
  const en = locale("en", "rider").talentMark;
  assert.match(en.topTalent.full, /rating/);
  assert.match(en.nextGen.full, /ability bars/);
});
