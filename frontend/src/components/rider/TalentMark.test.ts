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
  const load = mark.slice(mark.indexOf("async function loadTalentMarks"), mark.indexOf("function startLoad"));
  const flagCheck = load.indexOf("flags?.[TALENT_MARKS_FLAG_KEY] !== true) return new Map()");
  assert.ok(flagCheck > 0, "kontakten tjekkes først");
  assert.ok(load.indexOf("rider_talent_marks") > flagCheck, "tabellen læses først efter kontakten");
});

test("en åben side får friske mærker, så længe nogen lytter", () => {
  const sub = mark.slice(mark.indexOf("function subscribe"), mark.indexOf("const getSnapshot"));
  assert.match(sub, /setInterval\(ensureFresh, TALENT_MARKS_CHECK_MS\)/);
  assert.match(sub, /listeners\.size === 0[\s\S]*clearInterval\(refreshTimer\)/);
});

test("kun en ny viewer nulstiller mærkerne, ikke fokus på fanen", () => {
  const watch = mark.slice(mark.indexOf("function watchViewer"), mark.indexOf("function ensureFresh"));
  assert.match(watch, /next !== viewerId/);
  assert.ok(watch.indexOf("if (!changed) return;") < watch.indexOf("generation += 1"), "samme viewer stopper før nulstilling");
});

test("navnecellen: nation, navn, mærke, status (TASTE P12)", () => {
  const link = cell.indexOf("</RiderLink>");
  const talent = cell.indexOf("<RiderTalentMark riderId={id} />");
  const status = cell.indexOf("{children}");
  assert.ok(link > 0 && talent > link && status > talent);
});

test("profilen viser ikon i 24 px og kun navnet, forklaringen i tooltippen (#7951)", () => {
  assert.match(hero, /<RiderTalentMark riderId=\{rider\.id\} variant="profile" \/>/);
  assert.match(mark, /<Icon size=\{24\} \/>/);
  assert.match(mark, /<Icon size=\{16\} \/>/);
  const profile = mark.slice(mark.indexOf('if (variant === "profile")'), mark.lastIndexOf("<Tooltip label"));
  assert.match(profile, /<Tooltip label=\{`\$\{name\}: \$\{text\}`\}/);
  assert.doesNotMatch(profile, /<Link|\{text\}/);
});

test("et tryk på mærket i en klikbar række åbner ikke rytteren", () => {
  assert.match(mark, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); e\.preventDefault\(\); \}\}/);
  assert.match(mark, /<Tooltip label=\{`\$\{name\}: \$\{text\}`\}/);
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
    for (const mark of ["topTalent", "nextGen"]) {
      for (const key of ["name", "text"]) assert.ok(r?.[mark]?.[key], `${lang} ${mark}.${key}`);
      assert.deepEqual(Object.keys(r[mark]).sort(), ["name", "text"], `${lang} ${mark}: kun navn og én sætning`);
    }
    const h = locale(lang, "help").sections.riders.talentMarks;
    assert.ok(h?.title && h?.text, `${lang} help talentMarks`);
    assert.doesNotMatch(`${JSON.stringify(r)} ${h.text}`, /—/, `${lang}: ingen em-dash`);
  }
});

test("spillerteksten har ingen procenter, vinduer eller vægte (hard rule 17, ejer 8/11)", () => {
  for (const lang of LANGS) {
    const r = locale(lang, "rider").talentMark;
    const h = locale(lang, "help").sections.riders.talentMarks;
    const visible = [r.topTalent.text, r.nextGen.text, h.text].join(" ");
    // Det eneste tal i teksten er aldersgrænsen "23" (Toptalent er under 23).
    const numbers = visible.match(/\d+/g) ?? [];
    assert.ok(numbers.every((n) => n === "23"), `${lang}: kun 23 må stå som tal, fandt ${numbers.join(",")}`);
    assert.doesNotMatch(visible, /%/, `${lang}: ingen procenter`);
  }
});

test("ingen tekst lover potentiale eller forklarer reglen", () => {
  const en = locale("en", "rider").talentMark;
  assert.equal(en.topTalent.text, "one of the biggest talents under 23.");
  assert.equal(en.nextGen.text, "a junior making strong progress.");
  assert.doesNotMatch(JSON.stringify(locale("en", "help").sections.riders.talentMarks), /potential/i);
});

test("tooltip og profil bruger samme korte sætning, ingen typeopslag", () => {
  assert.doesNotMatch(mark, /riderTypes|fullNoType|talentMark\.[a-zA-Z]+\.(short|full)\b/);
  assert.match(mark, /talentMark\.topTalent\.text/);
  assert.match(mark, /talentMark\.nextGen\.text/);
});

test("backend: andele, vinduer og vægte læses fra private_config, ikke fra koden", () => {
  assert.match(backend, /readPrivateConfigEntry\(supabase, TALENT_MARKS_PARAMS_KEY/);
  assert.doesNotMatch(backend, /TOP_TALENT_SHARE|NEXT_GEN_SHARE|PROGRESS_WINDOW_DAYS|RECENT_WINDOW_DAYS/);
});
