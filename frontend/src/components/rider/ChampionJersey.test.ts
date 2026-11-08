// #7824 · Mestertrøjernes kontrakt. Repoet kører node --test uden jsdom, så
// modellen testes direkte, og placeringen og kontakten pinnes på kilden.
// Titelreglerne testes i backend/lib/championTitles7824.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CHAMPION_TITLE_ORDER,
  CONTINENT_JERSEYS,
  continentKey,
  groupLatestSeason,
  highestTitle,
  nationCode,
  sortTitles,
} from "../../lib/championJerseyModel.ts";
import type { ChampionTitleRow } from "../../lib/championJerseyModel.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const jersey = read("ChampionJersey.tsx");
const model = read("../../lib/championJerseyModel.ts");
const cell = read("RiderNameCell.jsx");
const hero = read("profile/RiderProfileHero.jsx");
const help = read("../../pages/HelpPage.jsx");
const backend = read("../../../../backend/lib/championTitles7824.js");
const catalog = read("../../../../backend/lib/stageFlagCatalog.js");
const migration = read("../../../../database/2026-11-07-7824-champion-titles.sql");

const LANGS = ["en", "da", "es", "fr", "nl"];
const locale = (lang: string, ns: string) => JSON.parse(read(`../../../public/locales/${lang}/${ns}.json`));

const row = (title: ChampionTitleRow["title"], scope = "", season_number = 4, rider_id = "r1"): ChampionTitleRow =>
  ({ rider_id, title, scope, season_number });

test("tabeller viser den højeste titel, profilen alle i rækkefølge", () => {
  const titles = [row("national", "DK"), row("world"), row("continent", "Europe")];
  assert.equal(highestTitle(titles)?.title, "world");
  assert.deepEqual(sortTitles(titles).map((t) => t.title), ["world", "continent", "national"]);
  assert.equal(highestTitle([row("national", "BE"), row("u23_world")])?.title, "u23_world");
  assert.equal(highestTitle([]), null);
  assert.equal(highestTitle(null), null);
});

test("samme titelrækkefølge i frontend og backend", () => {
  assert.deepEqual([...CHAMPION_TITLE_ORDER], ["world", "u23_world", "continent", "national"]);
  assert.match(backend, /CHAMPION_TITLE\.WORLD,\s*CHAMPION_TITLE\.U23_WORLD,\s*CHAMPION_TITLE\.CONTINENT,\s*CHAMPION_TITLE\.NATIONAL/);
});

test("kun den nyeste sæsons titler bruges, og ukendte rækker ignoreres", () => {
  const grouped = groupLatestSeason([
    row("world", "", 3, "old"),
    row("world", "", 4, "new"),
    row("national", "DK", 4, "new"),
    { rider_id: "x", title: "rainbow", scope: "", season_number: 4 },
    null,
  ]);
  assert.deepEqual([...grouped.keys()], ["new"]);
  assert.deepEqual(grouped.get("new")?.map((t) => t.title), ["world", "national"]);
});

test("alle fem kontinenter fra countries.continent har en trøje og en tekst på alle sprog", () => {
  for (const continent of ["Europe", "Asia", "Americas", "Africa", "Oceania"]) {
    assert.ok(CONTINENT_JERSEYS[continent as keyof typeof CONTINENT_JERSEYS], continent);
    const key = continentKey(continent);
    assert.ok(key);
    for (const lang of LANGS) assert.ok(locale(lang, "rider").championJersey.continent[key as string], `${lang} ${continent}`);
  }
  assert.equal(continentKey("Atlantis"), null);
});

test("national trøje kræver en ægte landekode", () => {
  assert.equal(nationCode("DK"), "dk");
  assert.equal(nationCode(" be "), "be");
  assert.equal(nationCode(""), null);
  assert.equal(nationCode("DEN"), null);
});

test("ingen regnbuebånd: koden tegner ingen regnbuetrøje", () => {
  const code = (src: string) => src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code(jersey) + code(model), /rainbow|regnbue/i);
});

test("national trøje: flaget ligger inline-absolut over hele trøjen og beskæres ikke", () => {
  // flag-icons' .fi { position: relative } vinder ellers over en utility-klasse,
  // og flaget skubbes ned under konturen (fundet på billederne 8/11).
  assert.match(jersey, /className=\{`fi fi-\$\{code\}`\}/);
  assert.match(jersey, /position: "absolute",\s*top: 0,\s*left: 0,/);
  assert.match(jersey, /backgroundSize: "100% 100%"/);
});

test("kontakten er den samme i frontend, backend, migration og spiller-allowlisten", () => {
  assert.match(model, /CHAMPION_JERSEYS_FLAG_KEY = "champion_jerseys_7824"/);
  assert.match(backend, /CHAMPION_JERSEYS_FLAG_KEY = "champion_jerseys_7824"/);
  assert.match(migration, /'champion_jerseys_7824',\s*'"off"'::jsonb/);
  const allow = catalog.slice(catalog.indexOf("PLAYER_VISIBLE_FLAG_KEYS = Object.freeze(["));
  assert.match(allow.slice(0, allow.indexOf("]);")), /"champion_jerseys_7824"/);
});

test("slukket kontakt = titlerne hentes slet ikke", () => {
  const load = jersey.slice(jersey.indexOf("async function loadChampionTitles"), jersey.indexOf("function startLoad"));
  const flagCheck = load.indexOf("flags?.[CHAMPION_JERSEYS_FLAG_KEY] !== true) return new Map()");
  assert.ok(flagCheck > 0, "kontakten tjekkes først");
  assert.ok(load.indexOf("rider_champion_titles") > flagCheck, "tabellen læses først efter kontakten");
});

test("navnecellen: navn (med hover-ikon), trøje, status (TASTE P12)", () => {
  const link = cell.indexOf("</RiderLink>");
  const champion = cell.indexOf("<RiderChampionJersey riderId={id} />");
  const status = cell.indexOf("{children}");
  assert.ok(link > 0 && champion > link && status > champion);
});

test("profilen viser alle titler med fuld tekst", () => {
  assert.match(hero, /<RiderChampionJersey riderId=\{rider\.id\} variant="profile" \/>/);
  assert.match(jersey, /size=\{24\}/);
  assert.match(jersey, /size=\{16\}/);
});

test("Hjælp: blokken står bag kontakten og findes på alle fem sprog", () => {
  assert.match(help, /\{ id: "championJerseys", kind: "text", flag: "champion_jerseys_7824" \}/);
  for (const lang of LANGS) {
    const block = locale(lang, "help").sections.riders.blocks?.championJerseys
      ?? locale(lang, "help").sections?.riders?.championJerseys
      ?? findBlock(locale(lang, "help"), "championJerseys");
    assert.ok(block?.title && block?.text, lang);
    assert.doesNotMatch(block.text, /—/, `${lang}: ingen em-dash`);
  }
});

test("teksterne findes på alle fem sprog med samme nøgler", () => {
  const keys = (o: Record<string, unknown>, prefix = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
  const en = keys(locale("en", "rider").championJersey).sort();
  for (const lang of LANGS) assert.deepEqual(keys(locale(lang, "rider").championJersey).sort(), en, lang);
});

function findBlock(obj: unknown, key: string): { title?: string; text?: string } | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  if (rec[key] && typeof rec[key] === "object") return rec[key] as { title?: string; text?: string };
  for (const v of Object.values(rec)) {
    const hit = findBlock(v, key);
    if (hit) return hit;
  }
  return undefined;
}
