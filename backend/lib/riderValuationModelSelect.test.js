// #5443 — model-valget må aldrig kunne tænde sig selv.
//
// Hele PR'ens kontrakt er "merge ændrer ingen rytterværdi". Den kontrakt holdes
// af ÉN funktion: resolveValuationModelId. Fejler den åbent (vælger v5 på noget
// der ikke er et eksplicit 'v5'), revalueres hele populationen ved næste
// søndagskørsel uden at nogen har trykket på noget.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VALUATION_MODEL_ID,
  RIDER_VALUATION_MODEL_KEY,
  loadValuationModel,
  loadValuationModelById,
  resolveValuationModelId,
} from "./riderValuationModelSelect.js";

test("defaulten er den model der allerede kører", () => {
  assert.equal(DEFAULT_VALUATION_MODEL_ID, "v4");
});

test("kun et eksplicit 'v5' vælger den nye model", () => {
  assert.equal(resolveValuationModelId("v5"), "v5");
  assert.equal(resolveValuationModelId("V5"), "v5");
  assert.equal(resolveValuationModelId(" v5 "), "v5");
});

test("alt andet falder tilbage til v4 — også skrald", () => {
  for (const raw of [null, undefined, "", "  ", "v4", "V4", "v6", "on", "true", true, 5, {}, [], NaN]) {
    assert.equal(
      resolveValuationModelId(raw),
      "v4",
      `${JSON.stringify(raw)} må ikke kunne vælge en anden model end v4`
    );
  }
});

test("modellerne kan indlæses og bærer hver sin identitet", () => {
  const v4 = loadValuationModelById("v4");
  const v5 = loadValuationModelById("v5");
  assert.equal(Number(v4.version), 4);
  assert.equal(Number(v5.version), 4, "v5 er stadig V4-kontrakten (karriere-NPV), ikke et nyt filformat");
  assert.equal(v5.model_id, "v5");
  assert.equal(v5.weights_source, "display_recipes");
  assert.equal(v5.type_source, "primary");
  assert.equal(v5.type_dampening, "off");
  assert.notEqual(v4.weights_source, "display_recipes");
});

test("en DB-fejl vælger v4, ikke v5", async () => {
  const throwing = { from: () => { throw new Error("DB nede"); } };
  const model = await loadValuationModel(throwing);
  assert.equal(model.model_id, undefined, "en læsefejl må ikke kunne tænde v5");
});

test("nøglen der læses er den nøgle migrationen seeder", async () => {
  let asked = null;
  const supabase = {
    from: (table) => {
      assert.equal(table, "app_config");
      return {
        select: () => ({
          eq: (_col, key) => { asked = key; return { maybeSingle: async () => ({ data: { value: "v5" } }) }; },
        }),
      };
    },
  };
  const model = await loadValuationModel(supabase);
  assert.equal(asked, RIDER_VALUATION_MODEL_KEY);
  assert.equal(model.model_id, "v5");
});
