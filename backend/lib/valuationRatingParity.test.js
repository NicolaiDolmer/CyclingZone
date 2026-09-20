// #5443 — FORWARD-GUARDS for den nye værdimodel (v5).
//
// De to vagter issuet kræver, som eksekverbare tests i stedet for en aftale:
//
//   (a) Værdi og rating må ALDRIG igen regne på forskellige evner.
//       Rod-årsagen bag hele #5443/#3353-sporet: værdimodellen havde sin egen
//       vægttabel (weights/valuationWeights.js), og for tidskøreren betød det
//       at PRISEN kun bevægede sig når enkeltstart bevægede sig, mens ratingen
//       spilleren så var bygget af fem evner. Vagten her sammenligner de to tal
//       direkte — ikke tabellerne, men RESULTATET.
//
//   (b) En rytters værdi må ikke kunne stå stille mens evnerne i hans rolle
//       udvikler sig. Det var den konkrete, målte skade: 849 ryttere var
//       frosset som enkeltstartsryttere og flyttede kun værdi når enkeltstart
//       steg (#5416).
//
// Vagterne kører mod den SHIPPEDE v5-model, ikke mod en fixture — det er selve
// artefaktet der skal holde. v4 er bevidst IKKE omfattet: den er den model der
// er live indtil ejeren flipper app_config-nøglen, og dens kendte svaghed er
// præcis grunden til at v5 findes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  predictBaseValue,
  valuationOutput,
  valuationTypeFor,
  VALUATION_ABILITY_COLUMNS,
} from "./riderValuation.js";
import {
  DISPLAY_RECIPES,
  DISPLAY_RECIPE_ABILITIES,
  ratingForRole,
} from "./weights/displayRecipes.js";
import { applyTypeDampening } from "./riderValuationTypeDampening.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const v5 = applyTypeDampening(
  JSON.parse(readFileSync(new URL("./riderValuationModelV5.json", import.meta.url), "utf8"))
);
const ROLES = DISPLAY_RECIPES.map((r) => r.key);

function abilities(overrides = {}) {
  const a = {};
  for (const k of VISIBLE_ABILITIES) a[k] = 50;
  return { ...a, ...overrides };
}

// ── Vagt (a): samme evner som ratingen ───────────────────────────────────────

test("#5443 vagt a: v5-modellen erklærer rating-opskrifterne som sin vægtkilde", () => {
  assert.equal(
    v5.weights_source,
    "display_recipes",
    "v5 skal læse rollens evner med rating-tallets egen opskrift — ellers er hele formel-skiftet rullet tilbage"
  );
  assert.equal(
    v5.type_source,
    "primary",
    "v5 skal regne på rytterens faktiske primær-type; den frosne valuation_type må ikke tilbage i beregningen"
  );
});

test("#5443 vagt a: værdiens rolle-output ER rating-tallet, evne for evne", () => {
  // Tre profiler pr. rolle, inkl. en med huller: en manglende kolonne og en
  // NULL skal behandles ENS af de to tal. Det var her de historisk skred fra
  // hinanden (#5321: Number(null) === 0 talte som et ægte nul i det ene tal).
  const profiles = [
    abilities(),
    abilities({ climbing: 88, time_trial: 12, positioning: 71, tactics: 9, sprint: 33 }),
    (() => { const a = abilities({ positioning: null }); delete a.tactics; return a; })(),
  ];
  for (const role of ROLES) {
    for (const ab of profiles) {
      const O = valuationOutput(ab, role, { alpha: 1, weightsSource: v5.weights_source });
      const asRating = Math.max(0, Math.min(99, Math.round(O)));
      assert.equal(
        asRating,
        ratingForRole(ab, role),
        `${role}: værdiens output og rating-tallet er ikke det samme regnestykke længere`
      );
    }
  }
});

test("#5443 vagt a: alle evner i en rating-opskrift hentes af værdi-kørslen", () => {
  for (const ability of DISPLAY_RECIPE_ABILITIES) {
    assert.ok(
      VALUATION_ABILITY_COLUMNS.includes(ability),
      `${ability} indgår i en rating-opskrift men hentes ikke af værdi-kørslens select — ` +
      "værdien ville regne på et andet evne-sæt end rating-tallet"
    );
  }
});

// ── Vagt (b): værdien må ikke kunne stå stille ───────────────────────────────

test("#5443 vagt b: hver evne i rollens opskrift flytter rytterens værdi", () => {
  for (const role of ROLES) {
    const recipe = DISPLAY_RECIPES.find((r) => r.key === role);
    const rider = { primary_type: role, potentiale: 3, age: 24 };
    const base = predictBaseValue(rider, abilities(), v5);
    assert.ok(base > 0, `${role}: ingen basisværdi at sammenligne med`);
    for (const ability of Object.keys(recipe.weights)) {
      const bumped = predictBaseValue(rider, abilities({ [ability]: 60 }), v5);
      assert.ok(
        bumped > base,
        `${role}: +10 på ${ability} flytter ikke værdien. Evnen tæller i rytterens rating, ` +
        "så en rytter kan udvikle sig i sin egen rolle uden at blive mere værd"
      );
    }
  }
});

test("#5443 vagt b: den frosne valuation_type kan ikke længere holde værdien fast", () => {
  // Rytteren ER klatrer, men bærer et frossent enkeltstarts-stempel (#3345).
  // Under v5 skal stemplet være uden virkning: værdien følger klatrerens evner.
  const ab = abilities({ climbing: 80, time_trial: 40 });
  const frozen = { primary_type: "climber", valuation_type: "tt", potentiale: 3, age: 24 };
  const clean = { primary_type: "climber", potentiale: 3, age: 24 };

  assert.equal(valuationTypeFor(frozen, v5), "climber");
  assert.equal(
    predictBaseValue(frozen, ab, v5),
    predictBaseValue(clean, ab, v5),
    "valuation_type påvirker stadig v5's værdi — frysningen er ikke ude af beregningen"
  );

  // Og: klatre-evnen skal flytte prisen for netop den rytter. Det var den
  // konkrete klage (#5416) — værdien rørte sig kun når enkeltstart steg.
  const better = predictBaseValue(frozen, abilities({ climbing: 90, time_trial: 40 }), v5);
  assert.ok(better > predictBaseValue(frozen, ab, v5));
});

// ── De to kaldeveje sender det samme rytter-grundlag ─────────────────────────

test("#5443: sæson-transitionen henter de samme værdi-felter som søndagskørslen", async () => {
  const { SEASON_RIDER_COLUMNS } = await import("./riderProgressionEngine.js");
  const cols = SEASON_RIDER_COLUMNS.split(",").map((c) => c.trim());
  // Felterne værdi-funktionerne kan læse på et rytter-objekt. Søndagskørslen
  // sender hele rækken videre (riderValueRefresh `withType`); sæson-transitionen
  // bygger sit eget objekt, og hvert felt der mangler dér er en tavs divergens
  // mellem to kaldeveje der skriver til de SAMME kolonner.
  for (const field of ["primary_type", "secondary_type", "valuation_type", "potentiale", "birthdate"]) {
    assert.ok(cols.includes(field), `${field} mangler i sæson-transitionens rytter-select`);
  }
});

// ── Ingen utilsigtet ikrafttræden ────────────────────────────────────────────

test("#5443: v4 er urørt — dens kæde læser stadig den frosne type", () => {
  const v4 = applyTypeDampening(
    JSON.parse(readFileSync(new URL("./riderValuationModelV4.json", import.meta.url), "utf8"))
  );
  assert.equal(v4.weights_source, undefined, "v4 må ikke have fået v5's vægtkilde");
  assert.equal(v4.type_source, undefined, "v4 må ikke have fået v5's type-kilde");
  assert.equal(
    valuationTypeFor({ primary_type: "climber", valuation_type: "tt" }, v4),
    "tt",
    "v4's #3345-kæde er ændret — merge ville flytte værdier af sig selv"
  );
});
