// #8254: billedsættet for punkt 4-8 skal kunne aflæses mod PR #8226 og wireframen. Bogstaverne A-C
// betyder det samme som i PR #8226 og anbefalingen står på samme bogstav; hvert punkt har mindst én
// variant "som wireframen"; punkt 4 tages i begge tilstande (profil vist og skjult).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, PR8226_RECOMMENDED, POINTS, VARIANTS, configFor, shotName, statesFor } from "./variants.ts";
import { RACE, RIDERS, SELECTED } from "./data.ts";

/** Navnene på A-C i PR #8226's tabel (punkt 4-8), som bogstaverne skal blive ved med at betyde. */
const PR8226_NAMES: Record<string, string> = {
  "4a": "Som runde 3",
  "4b": "Lille profil + vælger i løbshovedet",
  "4c": "Profilen foldet helt væk",
  "5a": "\"Efter løbet\" (som i dag)",
  "5b": "\"Træthed ved mål\" med +-bjælke",
  "5c": "Fjern kolonnen indtil planen tæller",
  "6a": "Som runde 3",
  "6b": "Udtagne øverst + advarsel",
  "6c": "Formtop som kolonne i truppen",
  "7a": "Som runde 3",
  "7b": "Formtop-mærke + payback i status, rutematch som bjælke",
  "7c": "B + rolle som chip (fælles med taktik)",
  "8a": "Som runde 3",
  "8b": "Hovedets guld følger visningen",
  "8c": "Fælles gem-bjælke nederst",
};

test("punkt 4-8, bogstaverne A-C har samme navn som i PR #8226, og D findes kun som wireframen", () => {
  assert.deepEqual(Object.keys(POINTS).map(Number), [4, 5, 6, 7, 8]);
  for (const [id, name] of Object.entries(PR8226_NAMES)) assert.equal(VARIANTS.find((v) => v.id === id)?.name, name, id);
  for (const v of VARIANTS.filter((x) => x.letter === "D")) assert.equal(v.wireframe, true, `${v.id} er D uden at være wireframen`);
});

test("anbefalingen står på samme bogstav som i PR #8226, præcis én pr. punkt", () => {
  for (const p of Object.keys(POINTS).map(Number)) {
    const rec = VARIANTS.filter((v) => v.point === p && v.recommended);
    assert.deepEqual(
      rec.map((v) => v.letter),
      [PR8226_RECOMMENDED[p]],
      `punkt ${p}`,
    );
  }
});

test("hvert punkt har mindst én variant som wireframen", () => {
  for (const p of Object.keys(POINTS).map(Number)) assert.ok(VARIANTS.some((v) => v.point === p && v.wireframe), `punkt ${p}`);
});

test("punkt 4 tages med profilen vist og skjult, resten i én tilstand", () => {
  for (const v of VARIANTS) {
    const states = statesFor(v);
    if (v.point === 4) {
      assert.deepEqual(states, ["vist", "skjult"]);
      assert.equal(configFor(v, "skjult").profileHidden, true);
      assert.equal(configFor(v, "vist").profileHidden, false);
    } else assert.deepEqual(states, [null]);
  }
  const names = VARIANTS.flatMap((v) => statesFor(v).map((s) => shotName(v, s)));
  assert.equal(new Set(names).size, names.length);
});

test("grundlaget er wireframen: kun billedets punkt afviger fra BASE", () => {
  const owner: Record<number, Array<keyof typeof BASE>> = {
    4: ["head", "profileHidden"],
    5: ["after"],
    6: ["view", "peak"],
    7: ["table"],
    8: ["view", "save", "squadDirty"],
  };
  for (const v of VARIANTS) {
    const cfg = configFor(v, statesFor(v)[0]);
    for (const k of Object.keys(BASE) as Array<keyof typeof BASE>) {
      if (k === "focus" || owner[v.point].includes(k)) continue;
      assert.equal(cfg[k], BASE[k], `${v.id}: ${k} hører til et andet punkt`);
    }
    assert.equal(cfg.focus, v.point);
  }
});

test("hver caption er én sætning med både fordel og ulempe", () => {
  for (const v of VARIANTS) {
    assert.match(v.line, /^Fordel: .+; ulempe: .+\.$/, v.id);
    assert.ok(!/\.\s+\S/.test(v.line.replace(/\b(ca|pr|\d+)\. /g, "")), `${v.id} er mere end én sætning`);
  }
});

test("samme trup i alle visninger: præcis løbets antal udtaget, og kun de udtagne har rolle og plan", () => {
  assert.equal(SELECTED.length, RACE.squadSize);
  for (const r of RIDERS) {
    assert.equal(Boolean(r.role), r.selected, `${r.id} rolle`);
    assert.equal(Boolean(r.plan), r.selected, `${r.id} plan`);
  }
});

test("indsats i planen er en af de faste indstillinger Let, Normal, Hård (v6-valg 16)", () => {
  for (const r of SELECTED) for (const [, e] of r.plan ?? []) assert.ok(["Let", "Normal", "Hård"].includes(e), `${r.id}: ${e}`);
});
