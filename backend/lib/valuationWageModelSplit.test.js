// #5443 ejer-beslutning 2 (20/9 aften) — LØNNEN VENTER.
//
// Ordret fra ejeren: "Løn skal ikke følge værdi, løn skal følge potentielle
// resultater + omdømme + evner og den slags ting."
//
// Løngrundlaget er `riders.current_production_value` (CPV) og lønnen en fast
// andel af det (ECONOMY_RULES §2, #3989). CPV regnes af SAMME modelkæde som
// prisen, så en tænding af v5 ville også flytte fremtidige lønkrav — midt i
// kontraktforlængelserne ved sæsonskiftet. Beslutningen: prisen må gå på v5,
// løngrundlaget bliver på v4, indtil ejeren flipper sin EGEN nøgle
// (`rider_production_value_model`).
//
// DET ER DEN KONTRAKT DENNE FIL BEVISER, og den er svær at holde ved review
// alene: de to tal beregnes en linje fra hinanden, af den samme funktion, på
// det samme rytter-objekt. Vagten måler derfor RESULTATET over en
// fixture-population: med pris=v5 og løn=v4 skal hver enkelt CPV være
// BIT-IDENTISK med i dag, mens base_value følger v5.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { recomputeRiderValue, selectChangedValueUpdates, refreshChangedRiderValues } from "./riderValueRefresh.js";
import { applyTypeDampening } from "./riderValuationTypeDampening.js";
import {
  RIDER_PRODUCTION_VALUE_MODEL_KEY,
  RIDER_VALUATION_MODEL_KEY,
} from "./riderValuationModelSelect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readModel = (name) => applyTypeDampening(JSON.parse(readFileSync(join(__dirname, name), "utf8")));
const V4 = readModel("riderValuationModelV4.json");
const V5 = readModel("riderValuationModelV5.json");
const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaselineYouth.json"), "utf8"));

// ── Fixture-population ──────────────────────────────────────────────────────
// Bred nok til at ramme begge modellers grene: unge og gamle, høj og lav
// potentiale, alle otte anlæg, og en rytter med et frossent stempel fra en
// ANDEN type end sin egen (#3345 — netop den gruppe v5 flytter mest).
const ABILITY_KEYS_FIXTURE = [
  "climbing", "time_trial", "prolog", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilitiesAt(level, bumps = {}) {
  const a = {};
  for (const k of ABILITY_KEYS_FIXTURE) a[k] = level;
  return { ...a, ...bumps };
}

const ROLES = ["gc", "climber", "sprinter", "tt", "rouleur", "puncheur", "brostensrytter", "domestique"];

const POPULATION = [];
let n = 0;
for (const role of ROLES) {
  for (const age of [19, 24, 31, 37]) {
    for (const potentiale of [2, 4.5, 6]) {
      n += 1;
      POPULATION.push({
        rider: {
          id: `fx-${n}`,
          age,
          potentiale,
          archetype_draw: { primary: role, secondary: null },
          // Hver tredje rytter bærer et frossent stempel fra en anden type.
          valuation_type: n % 3 === 0 ? ROLES[(ROLES.indexOf(role) + 3) % ROLES.length] : undefined,
        },
        abilities: abilitiesAt(20 + (n % 5) * 14, {
          climbing: 15 + (n % 7) * 11,
          sprint: 12 + (n % 6) * 13,
          time_trial: 18 + (n % 4) * 17,
          positioning: 22 + (n % 5) * 9,
          tactics: 17 + (n % 8) * 7,
        }),
      });
    }
  }
}

const OPTS = { youthBaseline };

test("fixture-populationen er stor nok til at bevise noget", () => {
  assert.ok(POPULATION.length >= 90, `kun ${POPULATION.length} fixtures`);
});

test("#5443: med pris=v5 og løn=v4 er CPV bit-identisk med i dag", () => {
  let pricesMoved = 0;
  for (const { rider, abilities } of POPULATION) {
    const idag = recomputeRiderValue(rider, abilities, baseline, V4, OPTS);
    const delt = recomputeRiderValue(rider, abilities, baseline, V5, { ...OPTS, productionModel: V4 });

    assert.equal(
      delt.current_production_value,
      idag.current_production_value,
      `${rider.id}: løngrundlaget flyttede sig da prisen skiftede model — lønnen skulle vente (ejer-beslutning 2)`
    );
    if (delt.base_value !== idag.base_value) pricesMoved += 1;
  }
  assert.ok(
    pricesMoved > POPULATION.length / 2,
    `kun ${pricesMoved}/${POPULATION.length} priser flyttede sig — så testen beviser ikke at CPV stod stille MENS prisen skiftede`
  );
});

test("#5443: prisen følger v5 præcis som hvis begge stod på v5", () => {
  for (const { rider, abilities } of POPULATION) {
    const beggeV5 = recomputeRiderValue(rider, abilities, baseline, V5, OPTS);
    const delt = recomputeRiderValue(rider, abilities, baseline, V5, { ...OPTS, productionModel: V4 });
    assert.equal(delt.base_value, beggeV5.base_value, `${rider.id}: prisen blev ikke v5's`);
    assert.equal(delt.primary_type, beggeV5.primary_type);
    assert.equal(delt.secondary_type, beggeV5.secondary_type);
  }
});

test("#5443: vagten har tænder — v5 ville flytte løngrundlaget hvis nøglerne var ét", () => {
  // Uden opdelingen (begge på v5) SKAL løngrundlaget bevæge sig for en stor del
  // af populationen. Gør den ikke det, er testen ovenfor tom.
  let cpvMoved = 0;
  for (const { rider, abilities } of POPULATION) {
    const idag = recomputeRiderValue(rider, abilities, baseline, V4, OPTS);
    const beggeV5 = recomputeRiderValue(rider, abilities, baseline, V5, OPTS);
    if (beggeV5.current_production_value !== idag.current_production_value) cpvMoved += 1;
  }
  assert.ok(
    cpvMoved > POPULATION.length / 2,
    `kun ${cpvMoved}/${POPULATION.length} løngrundlag ville flytte sig under v5 — vagten beviser intet`
  );
});

test("#5443: udelades productionModel, er adfærden PRÆCIS som før parameteren fandtes", () => {
  for (const { rider, abilities } of POPULATION) {
    assert.deepEqual(
      recomputeRiderValue(rider, abilities, baseline, V5, OPTS),
      recomputeRiderValue(rider, abilities, baseline, V5, { ...OPTS, productionModel: null }),
      `${rider.id}: null-productionModel ændrer adfærd`
    );
  }
});

test("#5443: selectChangedValueUpdates fører løn-modellen helt igennem", () => {
  const rows = POPULATION.slice(0, 20).map(({ rider }) => ({
    ...rider, primary_type: null, secondary_type: null, base_value: -1, current_production_value: -1,
  }));
  const abilityByRider = new Map(POPULATION.slice(0, 20).map(({ rider, abilities }) => [rider.id, abilities]));
  const updates = selectChangedValueUpdates(rows, abilityByRider, baseline, V5, new Map(), youthBaseline, V4);
  assert.equal(updates.length, rows.length);
  for (const u of updates) {
    const { rider, abilities } = POPULATION.find((p) => p.rider.id === u.id);
    const forventet = recomputeRiderValue(rider, abilities, baseline, V5, { ...OPTS, productionModel: V4 });
    assert.equal(u.base_value, forventet.base_value);
    assert.equal(u.current_production_value, forventet.current_production_value);
  }
});

// ── End-to-end: søndagskørslen læser TO nøgler, ikke én ─────────────────────

function stubSupabase({ config, riders, abilityRows }) {
  const writes = [];
  const configReads = [];
  const page = (rows) => ({ range: async () => ({ data: rows, error: null }) });
  return {
    writes,
    configReads,
    supabase: {
      from(table) {
        if (table === "app_config") {
          return {
            select: () => ({
              eq: (_c, key) => {
                configReads.push(key);
                return { maybeSingle: async () => ({ data: { value: config[key] ?? null }, error: null }) };
              },
            }),
          };
        }
        if (table === "seasons") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { number: 3 }, error: null }) }) }) };
        }
        if (table === "riders") {
          return {
            select: () => ({ order: () => page(riders), eq: () => ({ order: () => page(riders) }) }),
            update: (patch) => ({ eq: async (_c, id) => { writes.push({ id, ...patch }); return { error: null }; } }),
          };
        }
        if (table === "rider_derived_abilities") {
          return { select: () => ({ order: () => page(abilityRows) }) };
        }
        throw new Error(`uventet tabel i stub: ${table}`);
      },
    },
  };
}

function e2eFixtures() {
  const slice = POPULATION.slice(0, 24);
  return {
    riders: slice.map(({ rider }) => ({
      id: rider.id,
      primary_type: null,
      secondary_type: null,
      valuation_type: rider.valuation_type ?? null,
      base_value: -1,
      current_production_value: -1,
      // Sæson-anker 3 ⇒ ageForSeason(birthdate, 3) skal give rider.age.
      birthdate: `${2028 - rider.age}-05-05`,
      potentiale: rider.potentiale,
      archetype_draw: rider.archetype_draw,
    })),
    abilityRows: slice.map(({ rider, abilities }) => ({ rider_id: rider.id, ability_caps: null, ...abilities })),
  };
}

test("#5443: søndagskørslen slår BEGGE nøgler op", async () => {
  const { riders, abilityRows } = e2eFixtures();
  const { supabase, configReads } = stubSupabase({
    config: { [RIDER_VALUATION_MODEL_KEY]: "v5" }, riders, abilityRows,
  });
  await refreshChangedRiderValues(supabase, { youthBaseline });
  assert.ok(configReads.includes(RIDER_VALUATION_MODEL_KEY), "prisens nøgle blev ikke læst");
  assert.ok(configReads.includes(RIDER_PRODUCTION_VALUE_MODEL_KEY), "løngrundlagets nøgle blev ikke læst");
});

test("#5443: søndagskørslen med pris=v5 skriver v5-priser og v4-løngrundlag", async () => {
  const { riders, abilityRows } = e2eFixtures();
  const { supabase, writes } = stubSupabase({
    // Kun prisen flippet. Løn-nøglen mangler helt ⇒ fail-safe v4.
    config: { [RIDER_VALUATION_MODEL_KEY]: "v5" }, riders, abilityRows,
  });
  const res = await refreshChangedRiderValues(supabase, { youthBaseline });
  assert.equal(res.written, writes.length);
  assert.ok(writes.length > 0, "ingen skrivninger at kontrollere");

  const byId = new Map(writes.map((w) => [w.id, w]));
  for (const { rider, abilities } of POPULATION.slice(0, 24)) {
    const w = byId.get(rider.id);
    if (!w) continue;
    const prisV5 = recomputeRiderValue({ ...rider, valuation_type: rider.valuation_type ?? null }, abilities, baseline, V5, OPTS);
    const lonV4 = recomputeRiderValue({ ...rider, valuation_type: rider.valuation_type ?? null }, abilities, baseline, V4, OPTS);
    assert.equal(w.base_value, prisV5.base_value, `${rider.id}: prisen er ikke v5's`);
    assert.equal(w.current_production_value, lonV4.current_production_value, `${rider.id}: løngrundlaget er ikke v4's`);
  }
});

test("#5443: flippes løn-nøglen OGSÅ, følger løngrundlaget med over", async () => {
  const { riders, abilityRows } = e2eFixtures();
  const { supabase, writes } = stubSupabase({
    config: { [RIDER_VALUATION_MODEL_KEY]: "v5", [RIDER_PRODUCTION_VALUE_MODEL_KEY]: "v5" },
    riders, abilityRows,
  });
  await refreshChangedRiderValues(supabase, { youthBaseline });
  const byId = new Map(writes.map((w) => [w.id, w]));
  let checked = 0;
  for (const { rider, abilities } of POPULATION.slice(0, 24)) {
    const w = byId.get(rider.id);
    if (!w) continue;
    const beggeV5 = recomputeRiderValue({ ...rider, valuation_type: rider.valuation_type ?? null }, abilities, baseline, V5, OPTS);
    assert.equal(w.current_production_value, beggeV5.current_production_value);
    checked += 1;
  }
  assert.ok(checked > 0);
});
