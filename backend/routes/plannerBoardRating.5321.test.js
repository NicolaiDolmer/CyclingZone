// #5321 — planlægger-boardets rating-felt.
//
// Spilleren mandia1984 så samme rytter med to forskellige rating-tal. Årsagen var
// ikke to formler i backenden, men ÉT sted der regnede den ene formel på for lidt
// data: GET /api/peak-plans/board hentede kun de evne-kolonner løbsmotoren
// bruger, og planlæggerens flader regnede ratingen ud af netop det udsnit.
// `ratingForRole` springer en manglende evne over i BÅDE tæller og nævner, så et
// udsnit giver et andet tal end hele rækken.
//
// SSOT'en er GAME_DESIGN_DOCUMENT.md D-049 (ejer-valgt 11/9): rating-tallet på
// rytterkort, i tabeller og på markedet er den samme størrelse overalt.
//
// ═══ OMSKREVET EFTER #5352 (17/9) ═══
// Den første version af denne test hvilede på at løbsmotorens udsnit IKKE
// dækkede hele visnings-opskriften — sandt fordi #5268 havde givet
// teamwork/leadership vægt uden at de lå i motorens udsnit. #5352 rullede de
// fire vægte tilbage, så udsnit og opskrift i dag falder sammen, og
// selvtjekkene ("tallene skal være forskellige") blev røde selvom den fejlklasse
// de bevogter er uændret. Testerne står nu på mekanismer der ikke afhænger af
// hvad opskriften tilfældigvis indeholder lige nu:
//   1. en INJICERET delmængde af opskriftens evner giver et andet tal end hele
//      rækken (selvtjekket er lovligt, fordi injektionen garanterer forskellen),
//   2. motorens projektion (`?? 0`) giver et andet tal end den RÅ række når en
//      opskrift-evne står NULL — præcis derfor sender boardet den rå række til
//      rating-beregningen og ikke `abilities`-feltet,
//   3. boardets kolonne-udtræk er union af motor og evne-register, og den union
//      dækker også de evner der venter på at komme ind i opskriften igen
//      (PENDING_DISPLAY_ABILITIES, #5351) — dvs. motorens udsnit alene ville
//      være for snævert igen den dag de to vægte vender tilbage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ABILITY_KEYS as RACE_SIM_ABILITY_KEYS } from "../lib/raceSimulator.js";
import { REGISTRY_ABILITY_KEYS } from "../lib/abilityRegistry.js";
import { DISPLAY_RECIPES, PENDING_DISPLAY_ABILITIES, ratingForRole } from "../lib/weights/displayRecipes.js";

const API_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "api.js"), "utf8");

const recipeAbilities = [...new Set(DISPLAY_RECIPES.flatMap((r) => Object.keys(r.weights)))];

// Præcis den kolonne-liste boardet henter (api.js: `abilityCols`).
const BOARD_ABILITY_COLUMNS = [...new Set([...RACE_SIM_ABILITY_KEYS, ...REGISTRY_ABILITY_KEYS])];

// Præcis den projektion boardet lægger i payloadens `abilities`-felt (api.js:
// `for (const k of RACE_SIM_ABILITY_KEYS) ab[k] = row[k] ?? 0`). Simulatoren
// kræver tal, så en manglende/NULL evne bliver et ægte nul her — og DET er
// grunden til at rating-beregningen skal se den rå række i stedet.
const engineProjection = (row) =>
  Object.fromEntries(RACE_SIM_ABILITY_KEYS.map((k) => [k, row[k] ?? 0]));

const heaviestAbility = (recipe) =>
  Object.entries(recipe.weights).sort((a, b) => b[1] - a[1])[0][0];

test("#5321: en rating regnet på et UDSNIT af opskriftens evner er et andet tal end på hele rækken", () => {
  // Injiceret mock: rollens tungeste evne står højt, resten lavt. Falder den
  // evne ud af det sæt ratingen regnes på, MÅ tallet flytte sig — selvtjekket
  // nedenfor er derfor en egenskab ved injektionen, ikke ved dagens opskrift.
  for (const recipe of DISPLAY_RECIPES) {
    const top = heaviestAbility(recipe);
    const full = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k) => [k, k === top ? 99 : 20]));
    const slice = { ...full };
    delete slice[top];
    assert.equal(ratingForRole(slice, recipe.key), 20, `${recipe.key}: udsnittet uden ${top}`);
    assert.ok(
      ratingForRole(full, recipe.key) > ratingForRole(slice, recipe.key),
      `${recipe.key}: hele rækken gav samme tal som udsnittet uden ${top}`,
    );
  }
});

test("#5321: motorens projektion (?? 0) giver et andet tal end den rå række når en opskrift-evne er NULL", () => {
  // Det er derfor boardet sender `ratingRowByRider.get(id)` (rå række) til
  // rating-beregningen og IKKE `abilities`-feltet fladerne får. En NULL-kolonne
  // springes over i den rå række, men bliver et ægte nul i motorens projektion.
  for (const recipe of DISPLAY_RECIPES) {
    const top = heaviestAbility(recipe);
    const raw = Object.fromEntries(BOARD_ABILITY_COLUMNS.map((k) => [k, k === top ? null : 60]));
    assert.equal(ratingForRole(raw, recipe.key), 60, `${recipe.key}: rå række med ${top} = NULL`);
    assert.ok(
      ratingForRole(engineProjection(raw), recipe.key) < 60,
      `${recipe.key}: projektionen trak ikke ${top}=NULL ned som et nul`,
    );
  }
});

test("#5321: boardet henter evne-kolonnerne som union af motor og evne-register", () => {
  assert.match(
    API_SOURCE,
    /new Set\(\[\.\.\.RACE_SIM_ABILITY_KEYS, \.\.\.REGISTRY_ABILITY_KEYS\]\)/,
    "planlægger-boardets kolonne-udtræk er snævret ind igen",
  );
});

test("#5321: boardets kolonne-udtræk dækker hver evne en visnings-opskrift bruger", () => {
  for (const key of recipeAbilities) {
    assert.ok(BOARD_ABILITY_COLUMNS.includes(key), `opskrift-evnen ${key} hentes ikke af boardet`);
  }
});

test("#5321: unionen dækker også de evner der venter på at komme ind i opskriften igen", () => {
  // #5352 tog teamwork/leadership ud af vægtene igen; #5351 bærer beslutningen
  // om hvornår de kommer tilbage. De ligger UDEN FOR løbsmotorens udsnit, så
  // motorens udsnit alene ville være for snævert igen den dag det sker —
  // unionen er dét der gør rettelsen holdbar, ikke et sammenfald i dag.
  assert.ok(PENDING_DISPLAY_ABILITIES.length > 0, "ingen pending evner at måle på");
  for (const key of PENDING_DISPLAY_ABILITIES) {
    assert.ok(
      !RACE_SIM_ABILITY_KEYS.includes(key),
      `${key} er kommet ind i motorens udsnit — opdatér denne vagts præmis`,
    );
    assert.ok(BOARD_ABILITY_COLUMNS.includes(key), `pending-evnen ${key} hentes ikke af boardet`);
  }
});

test("#5321: evne-registret dækker hver evne enhver visnings-opskrift bruger", () => {
  for (const key of recipeAbilities) {
    assert.ok(REGISTRY_ABILITY_KEYS.includes(key), `opskrift-evnen ${key} mangler i registret`);
  }
});

test("#5321: boardet sender ratingen færdigberegnet med i payloaden", () => {
  assert.match(
    API_SOURCE,
    /rating: ratingFromAbilities\(ratingRowByRider\.get\(r\.id\)/,
    "board-payloadens rating-felt er væk — så regner fladerne den selv igen",
  );
});
