import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2888 + #2906 — Mit Hold-løftet. Begge issues handler om SAMME tabel:
//   #2888: potentiale-teksten væk, rating som tal, ryttertype over to linjer,
//          og vandret scroll må ikke kræve at man først scroller ned.
//   #2906: alle 15 evner synlige samtidig, rating-kolonne, lavere rækker.
// node --test har ingen DOM → kildekode-strukturelle guards (samme mønster som
// TeamPage.fields/ownAuctions/emptySquadCta-testene).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "public", "locales");

test("truppen bruger den KANONISKE DataTable, ikke sin egen tabel-markup (#2888)", () => {
  assert.match(src, /<DataTable\b/, "trup-tabellen skal renderes af den delte DataTable");
  assert.doesNotMatch(
    src,
    /<table\b/,
    "holdsiden må ikke have sin egen <table> længere — kolonnevalg/fold/densitet skal ligge i DataTable, så Ryttere/Rangliste/Ønskeliste arver det (#2888 accept)",
  );
});

test("rækkeklik navigerer stadig til rytterprofilen via rowProps (#1796)", () => {
  assert.match(
    src,
    /rowProps=\{\(r\) => \(\{ onClick: \(\) => navigate\(`\/riders\/\$\{r\.id\}`\)/,
    "hele rækken skal fortsat være klikbar — det var fixet for døde klik på værdi-/potentiale-cellen",
  );
});

test("trup-tabellen er dense — lavere rækker (#2906 punkt 3)", () => {
  assert.match(src, /<DataTable[\s\S]{0,400}?\bdense\b/, "DataTable skal få dense-flaget");
});

test("rating vises som TAL og kan sorteres (#2906 punkt 2 / #2888 punkt 2)", () => {
  assert.match(src, /_ovr: riderOverallRating\(r\)/, "ratingen skal dekoreres fra den DELTE riderOverallRating (1-99), ikke genberegnes lokalt");
  assert.match(src, /key: "rating"[\s\S]{0,240}?sortKey: "_ovr"/, "rating-kolonnen skal være sorterbar på _ovr");
  assert.match(src, /key: "rating"[\s\S]{0,300}?numeric: true/, "rating er numerik → højrestillet tabular (tdClass numeric)");
});

// Ejer 25/7: ratingen SKAL have farve, og den skal se ud som på rytterprofilen.
// At skalaen hælder mod gråt indtil #2890 er løst er en accepteret afvejning —
// fixet sker så ét sted (statColor), ikke i en lokal kopi her.
test("rating rendres som farveplade via den DELTE statPlateStyle (ejer 25/7)", () => {
  const ratingBlock = src.match(/key: "rating",[\s\S]{0,900}?\n {2}\};/);
  assert.ok(ratingBlock, "rating-kolonnen skal findes");
  assert.match(
    ratingBlock[0],
    /style=\{statPlateStyle\(r\._ovr\)\}/,
    "rating skal bruge samme plade-helper som rytterprofilens hero, ikke et lokalt farveudtryk",
  );
  assert.match(ratingBlock[0], /rounded-cz/, "pladen bruger systemets 5px-radius");
});

test("statPlateStyle er ÉN delt helper, ikke kopieret hex-alpha pr. flade", () => {
  const statColorSrc = readFileSync(join(__dirname, "..", "lib", "statColor.js"), "utf8");
  assert.match(statColorSrc, /export function statPlateStyle/);
  for (const rel of [
    ["..", "components", "rider", "profile", "RiderProfileHero.jsx"],
    ["..", "components", "staff", "profile", "StaffProfileHero.jsx"],
  ]) {
    const heroSrc = readFileSync(join(__dirname, ...rel), "utf8");
    assert.match(heroSrc, /statPlateStyle\(/, `${rel.at(-1)} skal bruge den delte plade-helper`);
    assert.doesNotMatch(
      heroSrc.replace(/\/\*[\s\S]*?\*\//g, ""),
      /backgroundColor: `\$\{statColor\(/,
      `${rel.at(-1)} må ikke have sin egen kopi af 16%-alpha-udtrykket`,
    );
  }
});

test("evne-tilstanden viser alle 15 evner + rating, uden de beskrivende kolonner (#2906 punkt 1)", () => {
  assert.match(src, /const abilityColumns = STATS\.map\(/, "evne-kolonnerne skal bygges af den delte STATS-liste (alle 15)");
  assert.match(
    src,
    /const abilityModeColumns = \[nameColumn, ratingColumn, typeColumn, \.\.\.abilityColumns\]/,
    "evne-tilstanden = navn + rating + type + de 15 evner; værdi/løn/status/kontrakt/handling er byttet ud",
  );
  assert.match(src, /tableMode === "abilities" \? abilityModeColumns : overviewColumns/);
});

test("evne-matricen bruger den strammeste gutter (ejer 25/7: 'for langt fra hinanden')", () => {
  const abilityBlock = src.match(/const abilityColumns = STATS\.map[\s\S]{0,900}?\n {2}\}\)\);/);
  assert.ok(abilityBlock, "abilityColumns skal findes");
  assert.match(abilityBlock[0], /tight: true/, "de 15 evne-kolonner skal bruge tight (px-1), ikke compact (px-2)");
  assert.doesNotMatch(abilityBlock[0], /compact: true/);
});

test("ryttertypen fylder ikke en bred enkeltlinje (#2888 punkt 3)", () => {
  assert.match(
    src,
    /<RiderTypeBadge primaryType=\{r\.primary_type\} secondaryType=\{r\.secondary_type\} stacked \/>/,
    "sekundærtypen skal på egen linje (stacked) — kolonnen var den bredeste i tabellen",
  );
});

// Ejer 25/7: "navnet er helligt" — typen hører hjemme i sin egen kolonne, som den
// gør alle andre steder i appen, ikke som en underlinje i navnecellen.
test("ryttertypen har sin EGEN kolonne i BEGGE tilstande (ejer 25/7)", () => {
  assert.match(src, /const typeColumn = \{[\s\S]{0,500}?key: "type"/, "typen skal være ÉN delt kolonne-definition");
  assert.match(src, /overviewColumns = \[[\s\S]*?\n {4}typeColumn,/, "overblik bruger samme definition");
});

test("potentiale vises uden kvalitativ TEKST-label nogen steder på holdsiden (#2888 punkt 1)", () => {
  const calls = [...src.matchAll(/<ScoutablePotentiale[^>]*>/g)].map((m) => m[0]);
  assert.ok(calls.length >= 2, "både trup-tabellen og handlings-modalen viser potentiale");
  for (const call of calls) {
    assert.match(
      call,
      /labelAsTitle/,
      `potentiale-teksten skal ligge i tooltip'en, ikke som synlig tekst: ${call}`,
    );
  }
});

test("kontrakt-cellen er den korte sæson-form med den fulde sætning i tooltip (#2888 punkt 4)", () => {
  assert.match(src, /squad\.headers\.contractShort/, "cellen skal vise 'S4', ikke 'Udløber efter S4' (~120px pr. række)");
  assert.match(src, /title=\{r\.contract_end_season != null \? t\("squad\.headers\.contractValue"/, "den fulde sætning skal stadig være tilgængelig som tooltip");
});

// Ejer 25/7: navnecellen skal være ren, og mobil-folden reduceret til det der
// allerede er accepteret andre steder i appen. /riders folder nation + alder.
test("navnecellen har INGEN subline — heller ikke i evne-tilstanden", () => {
  const nameBlock = src.match(/const nameColumn = \{[\s\S]*?\n {2}\};/);
  assert.ok(nameBlock, "nameColumn skal findes");
  // Kommentarer strippes — "INGEN subline" i en kommentar er ikke en subline.
  const code = nameBlock[0].replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /subline/, "ryttertypen (eller andet støj) må ikke ligge under navnet");
});

test("mobil-folden er nation + alder — samme felter som /riders allerede folder", () => {
  for (const key of ["nation", "age"]) {
    assert.match(
      src,
      new RegExp(`key: "${key}"[\\s\\S]{0,400}?fold: true`),
      `${key} foldes ind på ≤640px — præcedens fra /riders' accepterede fold`,
    );
  }
  const contractBlock = src.match(/key: "contract",[\s\S]{0,800}?\n {4}\},/);
  assert.ok(contractBlock, "kontrakt-kolonnen skal findes");
  assert.doesNotMatch(
    contractBlock[0],
    /fold: true/,
    "kontrakt foldes IKKE ind under navnet — den bliver i sin egen kolonne (ejer 25/7)",
  );
});

test("team.json har de nye nøgler i BÅDE en og da", () => {
  for (const lng of ["en", "da"]) {
    const teamJson = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
    assert.equal(typeof teamJson?.squad?.headers?.rating, "string", `${lng}: squad.headers.rating mangler`);
    assert.equal(typeof teamJson?.squad?.headers?.ratingTitle, "string", `${lng}: squad.headers.ratingTitle mangler`);
    assert.equal(typeof teamJson?.squad?.headers?.contractShort, "string", `${lng}: squad.headers.contractShort mangler`);
    assert.equal(typeof teamJson?.squad?.mode?.overview, "string", `${lng}: squad.mode.overview mangler`);
    assert.equal(typeof teamJson?.squad?.mode?.abilities, "string", `${lng}: squad.mode.abilities mangler`);
    assert.equal(typeof teamJson?.squad?.count, "string", `${lng}: squad.count mangler`);
  }
});
