// Unit-tests for countries-seed-modulet (#844 Slice 1). Ren funktion, ingen DB.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCountryRows,
  rowsToInsertSql,
  ISO2_SOURCE,
  PRESTIGE_TIER_OF,
  PRESTIGE_TIER_VALUES,
} from "./countriesSeed.js";

test("alle nationer i kildelisten får en komplet række uden warnings", () => {
  const { rows, warnings } = buildCountryRows();
  assert.equal(warnings.length, 0, `forventede 0 huller, fik: ${warnings.join("; ")}`);
  assert.equal(rows.length, ISO2_SOURCE.length);
});

test("iso2 er unik, uppercase og ISO 3166-1 alpha-2-format", () => {
  const { rows } = buildCountryRows();
  const seen = new Set();
  for (const r of rows) {
    assert.match(r.iso2, /^[A-Z]{2}$/, `ugyldigt iso2: ${r.iso2}`);
    assert.ok(!seen.has(r.iso2), `duplikat iso2: ${r.iso2}`);
    seen.add(r.iso2);
  }
});

test("alle rækker opfylder NOT NULL + akse-invarianter (matcher DB-CHECKs)", () => {
  const { rows } = buildCountryRows();
  for (const r of rows) {
    assert.ok(r.name_en && typeof r.name_en === "string", `mangler name_en: ${r.iso2}`);
    assert.ok(r.birth_weight >= 0, `birth_weight < 0: ${r.iso2}`);
    assert.ok(r.talent_ceiling > 0, `talent_ceiling <= 0: ${r.iso2}`);
    assert.ok(r.reputation >= 0 && r.reputation <= 100, `reputation udenfor 0-100: ${r.iso2}`);
    assert.ok(
      r.reputation_seed >= 0 && r.reputation_seed <= 100,
      `reputation_seed udenfor 0-100: ${r.iso2}`,
    );
    assert.equal(r.reputation, r.reputation_seed, `reputation skal starte = seed: ${r.iso2}`);
  }
});

test("tier-tildeling: S-nationer får S-værdier, ikke-nævnte falder til D", () => {
  const { rows } = buildCountryRows();
  const byIso = Object.fromEntries(rows.map((r) => [r.iso2, r]));

  for (const iso of ["BE", "FR", "IT", "ES", "NL", "SI"]) {
    assert.equal(byIso[iso]._tier, "S", `${iso} skal være S`);
    assert.equal(byIso[iso].birth_weight, PRESTIGE_TIER_VALUES.S.birth_weight);
    assert.equal(byIso[iso].talent_ceiling, PRESTIGE_TIER_VALUES.S.talent_ceiling);
  }
  // En kode der ikke er i PRESTIGE_TIER_OF skal få D-defaults.
  const unranked = ISO2_SOURCE.find((c) => !PRESTIGE_TIER_OF[c]);
  assert.ok(unranked, "forventede mindst én ikke-rangeret nation");
  assert.equal(byIso[unranked]._tier, "D");
  assert.equal(byIso[unranked].talent_ceiling, PRESTIGE_TIER_VALUES.D.talent_ceiling);
});

test("hver eksplicit tier-tildeling peger på en kode der findes i kildelisten", () => {
  const source = new Set(ISO2_SOURCE);
  for (const code of Object.keys(PRESTIGE_TIER_OF)) {
    assert.ok(source.has(code), `PRESTIGE_TIER_OF har '${code}' som ikke er i ISO2_SOURCE`);
  }
});

test("rowsToInsertSql: korrekt form + escaper ASCII-apostrof + NULL for tomt name_da", () => {
  const sql = rowsToInsertSql([
    {
      iso2: "XX",
      name_en: "O'Brienland",
      name_da: null,
      ioc_code: "OBR",
      continent: "Europe",
      birth_weight: 5,
      talent_ceiling: 0.82,
      reputation: 40,
      reputation_seed: 40,
    },
  ]);
  assert.ok(sql.includes("INSERT INTO public.countries"), "mangler INSERT-header");
  assert.ok(sql.includes("ON CONFLICT (iso2) DO NOTHING"), "mangler idempotens-klausul");
  assert.ok(sql.includes("'O''Brienland'"), "ASCII-apostrof ikke escaped");
  assert.ok(/,\s*NULL,/.test(sql), "tomt name_da skal blive NULL (ikke 'null')");
});
