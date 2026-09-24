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
  RIDER_PRODUCTION_VALUE_MODEL_KEY,
  RIDER_VALUATION_MODEL_KEY,
  loadProductionValueModel,
  loadProductionValueModelStrict,
  loadValuationModel,
  loadValuationModelById,
  loadValuationModelCached,
  loadValuationModelStrict,
  resetValuationModelCache,
  resolveValuationModelId,
} from "./riderValuationModelSelect.js";

// Ét sted at bygge en app_config-stub, så testene herunder kan koncentrere sig
// om hvilket SVAR nøglen giver, ikke om PostgREST's kæde af metoder.
function stubConfig(valueByKey, { onRead } = {}) {
  const asked = [];
  return {
    asked,
    supabase: {
      from: (table) => {
        assert.equal(table, "app_config");
        return {
          select: () => ({
            eq: (_col, key) => {
              asked.push(key);
              onRead?.(key);
              return { maybeSingle: async () => ({ data: { value: valueByKey[key] ?? null } }) };
            },
          }),
        };
      },
    },
  };
}

test("defaulten er den model der allerede kører", () => {
  assert.equal(DEFAULT_VALUATION_MODEL_ID, "v4");
});

test("kun et eksplicit 'v5' vælger den nye model", () => {
  assert.equal(resolveValuationModelId("v5"), "v5");
  assert.equal(resolveValuationModelId("V5"), "v5");
  assert.equal(resolveValuationModelId(" v5 "), "v5");
});

test("alt andet falder tilbage til v4 — også skrald", () => {
  for (const raw of [null, undefined, "", "  ", "v4", "V4", "v7", "v6-typefree", "on", "true", true, 5, {}, [], NaN]) {
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
  const { supabase, asked } = stubConfig({ [RIDER_VALUATION_MODEL_KEY]: "v5" });
  const model = await loadValuationModel(supabase);
  assert.deepEqual(asked, [RIDER_VALUATION_MODEL_KEY]);
  assert.equal(model.model_id, "v5");
});

// ── #5443 ejer-beslutning 2 (20/9 aften): to nøgler, ikke én ─────────────────
// "Løn skal ikke følge værdi." Prisen (base_value) og løngrundlaget
// (current_production_value) skal kunne stå på HVER SIN model, så v5 kan gå
// live uden at flytte fremtidige lønkrav.

test("løngrundlaget har sin egen nøgle og sin egen default", async () => {
  assert.equal(RIDER_PRODUCTION_VALUE_MODEL_KEY, "rider_production_value_model");
  assert.notEqual(RIDER_PRODUCTION_VALUE_MODEL_KEY, RIDER_VALUATION_MODEL_KEY);

  // Prisen flippet til v5, løngrundlaget urørt ⇒ løngrundlaget bliver på v4.
  const { supabase, asked } = stubConfig({ [RIDER_VALUATION_MODEL_KEY]: "v5" });
  const price = await loadValuationModel(supabase);
  const wage = await loadProductionValueModel(supabase);
  assert.equal(price.model_id, "v5");
  assert.equal(wage.model_id, undefined, "løngrundlaget må ikke følge med prisens flip");
  assert.deepEqual(asked, [RIDER_VALUATION_MODEL_KEY, RIDER_PRODUCTION_VALUE_MODEL_KEY]);
});

test("løngrundlaget kan flippes for sig — uden at røre prisen", async () => {
  const { supabase } = stubConfig({ [RIDER_PRODUCTION_VALUE_MODEL_KEY]: "v5" });
  assert.equal((await loadProductionValueModel(supabase)).model_id, "v5");
  assert.equal((await loadValuationModel(supabase)).model_id, undefined);
});

test("løngrundlagets nøgle har samme fail-safe som prisens", async () => {
  const throwing = { from: () => { throw new Error("DB nede"); } };
  assert.equal((await loadProductionValueModel(throwing)).model_id, undefined);
  for (const raw of [null, "", "v6", true, 7, {}]) {
    const { supabase } = stubConfig({ [RIDER_PRODUCTION_VALUE_MODEL_KEY]: raw });
    assert.equal(
      (await loadProductionValueModel(supabase)).model_id,
      undefined,
      `${JSON.stringify(raw)} må ikke kunne flytte løngrundlaget`
    );
  }
});

// ── Request-stiens cache (api.js's læse-flader) ─────────────────────────────

test("den cachede læsning slår kun app_config op én gang inden for TTL'en", async () => {
  resetValuationModelCache();
  let reads = 0;
  const { supabase } = stubConfig({ [RIDER_VALUATION_MODEL_KEY]: "v5" }, { onRead: () => { reads++; } });
  const a = await loadValuationModelCached(supabase);
  const b = await loadValuationModelCached(supabase);
  assert.equal(a.model_id, "v5");
  assert.equal(b.model_id, "v5");
  assert.equal(reads, 1, "to visninger må ikke koste to DB-opslag");
  resetValuationModelCache();
});

test("samtidige læsninger af-dublerer til ét opslag", async () => {
  resetValuationModelCache();
  let reads = 0;
  const { supabase } = stubConfig({ [RIDER_VALUATION_MODEL_KEY]: "v5" }, { onRead: () => { reads++; } });
  const models = await Promise.all(Array.from({ length: 25 }, () => loadValuationModelCached(supabase)));
  assert.equal(reads, 1, "25 samtidige rytterkort må ikke give 25 opslag");
  for (const m of models) assert.equal(m.model_id, "v5");
  resetValuationModelCache();
});

test("cachen udløber, så et flip slår igennem af sig selv", async () => {
  resetValuationModelCache();
  let clock = 0;
  const value = { [RIDER_VALUATION_MODEL_KEY]: "v4" };
  const { supabase } = stubConfig(value);
  const opts = { ttlMs: 1000, now: () => clock };
  assert.equal((await loadValuationModelCached(supabase, opts)).model_id, undefined);
  value[RIDER_VALUATION_MODEL_KEY] = "v5";
  assert.equal((await loadValuationModelCached(supabase, opts)).model_id, undefined, "stadig inden for TTL");
  clock += 1001;
  assert.equal((await loadValuationModelCached(supabase, opts)).model_id, "v5", "efter TTL skal flippet ses");
  resetValuationModelCache();
});

test("cachen kan ikke tænde v5 på en fejl", async () => {
  resetValuationModelCache();
  const throwing = { from: () => { throw new Error("DB nede"); } };
  assert.equal((await loadValuationModelCached(throwing)).model_id, undefined);
  resetValuationModelCache();
});

// ── Striks læsning: en kørsel der skriver HELE populationen ─────────────────
// Den lempelige fail-safe (fejl ⇒ v4) beskytter mod at v5 tænder sig selv. Den
// beskytter IKKE mod det modsatte: at et sekunds DB-hikke revaluerer hele
// markedet tilbage til v4 efter at v5 er gået live. For de to kørsler der
// skriver alle ryttere er "stop og prøv igen" det rigtige svar.

function stubError(message) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message } }) }) }),
    }),
  };
}

test("striks læsning STOPPER kørslen ved en ægte DB-fejl", async () => {
  await assert.rejects(
    () => loadValuationModelStrict(stubError("statement timeout")),
    /app_config\.rider_valuation_model/,
    "en søndagskørsel må ikke revaluere hele populationen på en gættet model"
  );
  await assert.rejects(
    () => loadProductionValueModelStrict(stubError("statement timeout")),
    /app_config\.rider_production_value_model/
  );
  await assert.rejects(() => loadValuationModelStrict(null), /ingen supabase-klient/);
});

test("striks læsning behandler en MANGLENDE række som v4, ikke som en fejl", async () => {
  // Før migrationen er kørt findes nøglen ikke. Det er ikke en fejl — det er
  // præcis den tilstand defaulten findes for.
  const { supabase } = stubConfig({});
  assert.equal((await loadValuationModelStrict(supabase)).model_id, undefined);
  assert.equal((await loadProductionValueModelStrict(supabase)).model_id, undefined);
});

test("striks læsning giver v4 på en ukendt værdi, og v5 på et eksplicit 'v5'", async () => {
  const skrald = stubConfig({ [RIDER_VALUATION_MODEL_KEY]: "v9" });
  assert.equal((await loadValuationModelStrict(skrald.supabase)).model_id, undefined);
  const flippet = stubConfig({ [RIDER_VALUATION_MODEL_KEY]: "v5" });
  assert.equal((await loadValuationModelStrict(flippet.supabase)).model_id, "v5");
});
