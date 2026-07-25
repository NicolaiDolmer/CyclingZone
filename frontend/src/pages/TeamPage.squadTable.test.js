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

test("rating-tallet bærer IKKE statColor-pladen (#2890 er ikke løst endnu)", () => {
  const ratingBlock = src.match(/key: "rating",[\s\S]{0,600}?\n {2}\};/);
  assert.ok(ratingBlock, "rating-kolonnen skal findes");
  assert.doesNotMatch(
    ratingBlock[0],
    /statStyle|statColor/,
    "farveskalaen er fejl-ankret (#2890) → en farvet rating-celle ville rendre næsten alle menneskehold-ryttere grå",
  );
});

test("evne-tilstanden viser alle 15 evner + rating, uden de beskrivende kolonner (#2906 punkt 1)", () => {
  assert.match(src, /const abilityColumns = STATS\.map\(/, "evne-kolonnerne skal bygges af den delte STATS-liste (alle 15)");
  assert.match(
    src,
    /const abilityModeColumns = \[nameColumn, ratingColumn, \.\.\.abilityColumns\]/,
    "evne-tilstanden = navn + rating + de 15 evner; værdi/løn/status/kontrakt/handling er byttet ud, så alle 15 tal er synlige samtidig",
  );
  assert.match(src, /tableMode === "abilities" \? abilityModeColumns : overviewColumns/);
});

test("ryttertypen fylder ikke en bred enkeltlinje (#2888 punkt 3)", () => {
  assert.match(
    src,
    /<RiderTypeBadge primaryType=\{r\.primary_type\} secondaryType=\{r\.secondary_type\} stacked \/>/,
    "sekundærtypen skal på egen linje (stacked) — kolonnen var den bredeste i tabellen",
  );
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

test("sekundære kolonner foldes ind i navnecellen på mobil (T2-recipen, 54,9 % mobiltrafik)", () => {
  for (const key of ["nation", "age", "contract"]) {
    assert.match(
      src,
      new RegExp(`key: "${key}"[\\s\\S]{0,400}?fold: true`),
      `${key}-kolonnen skal folde ind i den pinnede navnecelles underlinje på ≤640px i stedet for at tvinge vandret scroll`,
    );
  }
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
