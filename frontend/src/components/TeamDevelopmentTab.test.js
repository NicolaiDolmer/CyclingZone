import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareDevRows } from "../lib/teamDevelopmentSort.js";

// #3979/#3721 (ejer-beslutning 19/8) — holdsidens sorterbare udviklings-
// status-tabel: Rider/Age/Rating/Projected/Ceiling. node --test har ingen DOM
// (samme mønster som TeamPage.squadTable/RidersPage.columns-testene) —
// compareDevRows er en ren funktion og testes direkte; resten er kilde-tekst-
// guards mod kolonne-config og i18n-nøgler.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TeamDevelopmentTab.jsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "public", "locales");

// ── compareDevRows (ren funktion) ──────────────────────────────────────────

test("compareDevRows: navnet sorterer alfabetisk (lastname-first, 'en' locale)", () => {
  const a = { firstname: "Bo", lastname: "Aabech" };
  const b = { firstname: "Anna", lastname: "Berg" };
  assert.ok(compareDevRows(a, b, "firstname", "asc") < 0, "Aabech skal komme før Berg");
  assert.ok(compareDevRows(a, b, "firstname", "desc") > 0, "desc skal vende rækkefølgen");
});

test("compareDevRows: numeriske felter sorterer højst-først i desc", () => {
  const a = { _ovr: 60 };
  const b = { _ovr: 45 };
  assert.ok(compareDevRows(a, b, "_ovr", "desc") < 0, "60 skal ligge før 45 i desc (a før b)");
  assert.ok(compareDevRows(a, b, "_ovr", "asc") > 0, "asc skal vende rækkefølgen");
});

test("compareDevRows: null (intet bånd/loft) placeres SIDST uanset retning (#3787-mønsteret)", () => {
  const withBand = { _progHi: 55 };
  const noBand = { _progHi: null };
  assert.ok(compareDevRows(withBand, noBand, "_progHi", "desc") < 0, "rytter MED bånd skal stå før i desc");
  assert.ok(compareDevRows(withBand, noBand, "_progHi", "asc") < 0, "rytter MED bånd skal stå før i asc (null altid sidst)");
  assert.equal(compareDevRows({ _loft: null }, { _loft: null }, "_loft", "desc"), 0, "to null'er er ligestillede");
});

test("komponenten bruger den DELTE komparator fra teamDevelopmentSort.js, ikke en lokal kopi", () => {
  assert.match(src, /import \{ compareDevRows \} from "..\/lib\/teamDevelopmentSort\.js"/);
});

// ── Kolonne-config (kilde-tekst-guard) ─────────────────────────────────────

test("tabellen bruger den KANONISKE DataTable, ingen egen <table>", () => {
  assert.match(src, /<DataTable\b/, "udviklings-tabellen skal renderes af den delte DataTable (T2-recipen)");
  assert.doesNotMatch(src, /<table\b/, "ingen egen tabel-markup — kolonnevalg/fold/densitet skal ligge i DataTable");
});

test("Rider-kolonnen er klikbar til profilen og sortérbar på navn", () => {
  assert.match(src, /key: "name"[\s\S]{0,120}?sortKey: "firstname"/, "navnekolonnen skal have sortKey firstname");
  assert.match(src, /<RiderLink id=\{r\.id\}/, "navnet skal linke til rytterprofilen");
});

test("Age/Rating/Projected/Ceiling er alle numeriske og sortérbare", () => {
  assert.match(src, /key: "age"[\s\S]{0,200}?sortKey: "_age"[\s\S]{0,80}?numeric: true/);
  assert.match(src, /key: "rating"[\s\S]{0,200}?sortKey: "_ovr"[\s\S]{0,80}?numeric: true/);
  assert.match(src, /key: "projected"[\s\S]{0,200}?sortKey: "_progHi"[\s\S]{0,80}?numeric: true/, "Projected skal sortere på hi (_progHi), ikke lo eller midtpunktet");
  assert.match(src, /key: "ceiling"[\s\S]{0,200}?sortKey: "_loft"[\s\S]{0,80}?numeric: true/);
});

test("Rating rendres som farveplade via den DELTE statPlateStyle (samme sprog som Squad-fanen)", () => {
  assert.match(src, /style=\{statPlateStyle\(r\._ovr\)\}/, "rating skal bruge samme plade-helper som SquadTab/rytterprofilens hero");
});

test("INGEN pace-kolonne — traeningsscoren (#3564) er ikke bygget endnu", () => {
  assert.doesNotMatch(src, /key: "pace"/, "pace-kolonnen hører til #3564, som ikke er bygget");
});

test("data genbruges fra useScouting — ingen ny fetch-logik, kun requestEstimates/estimateFor", () => {
  assert.match(src, /scouting\.requestEstimates\(riderIds\)/, "estimater skal hentes via den DELTE useScouting-hook (batched)");
  assert.match(src, /scouting\.estimateFor\(r\.id\)/, "estimatet skal læses via den DELTE estimateFor, ikke et lokalt fetch");
  assert.doesNotMatch(src, /fetch\(/, "ingen egen fetch-logik — batching/dedupe ligger allerede i useScouting.js");
});

test("ryttere uden bånd viser 'no forecast yet' i muted, ingen tankestreg i selve teksten", () => {
  const projectedBlock = src.match(/key: "projected",[\s\S]{0,700}?\n {4}\},/);
  assert.ok(projectedBlock, "projected-kolonnen skal findes");
  assert.match(projectedBlock[0], /development\.noForecast/, "no-bånd-grenen skal bruge development.noForecast-nøglen");
  assert.match(projectedBlock[0], /text-cz-3/, "no-bånd-teksten skal være muted (text-cz-3)");
});

// ── i18n ────────────────────────────────────────────────────────────────────

test("team.json har development-nøglerne i BÅDE en og da", () => {
  for (const lng of ["en", "da"]) {
    const teamJson = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
    assert.equal(typeof teamJson?.tabs?.development, "string", `${lng}: tabs.development mangler`);
    assert.equal(typeof teamJson?.development?.headers?.projected, "string", `${lng}: development.headers.projected mangler`);
    assert.equal(typeof teamJson?.development?.headers?.ceiling, "string", `${lng}: development.headers.ceiling mangler`);
    assert.equal(typeof teamJson?.development?.noForecast, "string", `${lng}: development.noForecast mangler`);
  }
});

test("noForecast-teksten indeholder ikke em-dash (tankestreg-fri per brief)", () => {
  for (const lng of ["en", "da"]) {
    const teamJson = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
    assert.doesNotMatch(teamJson.development.noForecast, /—/, `${lng}: noForecast må ikke indeholde em-dash`);
  }
});

// ── Type-kolonnen (tester-feedback 20/8, #3798) ────────────────────────────

test("compareDevRows: primary_type sorterer alfabetisk paa noeglen, null sidst", () => {
  const a = { primary_type: "climber" };
  const b = { primary_type: "sprinter" };
  const nil = { primary_type: null };
  assert.ok(compareDevRows(a, b, "primary_type", "asc") < 0, "climber skal staa foer sprinter i asc");
  assert.ok(compareDevRows(a, b, "primary_type", "desc") > 0, "desc skal vende raekkefoelgen");
  assert.ok(compareDevRows(a, nil, "primary_type", "asc") < 0, "null skal altid sidst (asc)");
  assert.ok(compareDevRows(a, nil, "primary_type", "desc") < 0, "null skal altid sidst (desc)");
  assert.equal(compareDevRows(nil, { primary_type: null }, "primary_type", "asc"), 0, "to null'er er ligestillede");
});

test("Type-kolonnen findes, sorterer paa primary_type og bruger den kanoniske RiderTypeBadge", () => {
  assert.match(src, /key: "type"[\s\S]{0,200}?sortKey: "primary_type"/, "type-kolonnen skal sortere paa primary_type");
  assert.match(src, /<RiderTypeBadge primaryType=\{r\.primary_type\} secondaryType=\{r\.secondary_type\} stacked \/>/,
    "typen skal renderes af RiderTypeBadge (ejer 25/7: aldrig i navnecellen)");
});
