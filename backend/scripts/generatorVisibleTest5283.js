// #5283 — SYNLIG test af ryttergeneratoren (fødsel uden PCM).
//
// Ejer-krav 15/9 (ordret, ved merge-go på PR #5278): "Vi skal have lavet test
// inden naeste gang der laves nye ryttere, for at se at rytter generatoren
// virker ordentligt." Gaten ligger FØR U23-ryttere genereres til AI-holdene ved
// S4-cutover (GDD D-054 §10.4).
//
// Hvad scriptet ER: en READ-ONLY rapport-generator. Den føder N ryttere
// deterministisk (fast seed) ad den NYE sti — `mode: "own-priors"`, dvs.
// spillets egne arketype-priors uden PCM-stats (#5269, GDD D-053) — kører dem
// gennem PRÆCIS den derive-kæde `deriveForRiderIds` kører i produktionen, og
// skriver en markdown-rapport med fordelinger pr. arketype og pr. evne.
//
// Hvad scriptet IKKE er og ALDRIG må blive:
//   - Ingen DB. Ingen supabase-import, ingen netværk, ingen writes. Hele
//     kæden køres in-memory på den generator-record generatoren returnerer.
//   - Ingen ændring af generatorens adfærd. Scriptet LÆSER kun. Finder det en
//     fejl, dokumenteres den i §9 "Fund" — den rettes ikke herfra.
//
// Determinisme: samme `--seed` giver den samme rapport, byte for byte (§1 i
// docs/RIDER_GENERATION.md). Derfor er rapporten en artefakt der kan
// versionsstyres og diffes mod en senere kørsel.
//
// Brug:
//   node backend/scripts/generatorVisibleTest5283.js                      (stdout)
//   node backend/scripts/generatorVisibleTest5283.js --out=docs/audits/x.md
//   node backend/scripts/generatorVisibleTest5283.js --count=1000 --seed=20260918
//
// CI-siden af den samme gate er `backend/lib/riderBirthDistribution.test.js`:
// rapporten her er til ØJNENE, testen er til maskinen. Ændrer generatoren sig,
// fejler testen; rapporten viser HVORDAN den flyttede sig.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateFictionalRiders,
  makeRng,
  STAT_KEYS,
  BIRTH_MODE_OWN_PRIORS,
} from "../lib/fictionalRiderGenerator.js";
import { generateAcademyCandidates } from "../lib/academyGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import {
  isBornFromPriors,
  deriveBirthAbilities,
  physiologySeedInputFromAbilities,
} from "../lib/riderBirthPriors.js";
import {
  drawYouthBirthAbilities,
  makeBirthRng,
  YOUTH_BIRTH_BAND,
} from "../lib/riderBirthPriors.js";
import { REGISTRY_ABILITY_KEYS, abilityMeta } from "../lib/abilityRegistry.js";
import {
  buildCapsForRider,
  MENTAL_ABILITY_TAG_CEILING,
} from "../lib/riderProgression.js";
import {
  computeRiderTypes,
  resolveRiderTypes,
  NEUTRAL_BASELINE,
  RIDER_TYPES,
} from "../lib/riderTypes.js";
import { selectTypesBaseline } from "../lib/riderTypesBaselineSelect.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { applyTypeDampening } from "../lib/riderValuationTypeDampening.js";
import { LAUNCH_REFERENCE_YEAR } from "../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lib = (f) => join(__dirname, "../lib", f);
const readJson = (f) => JSON.parse(readFileSync(lib(f), "utf8"));

// Modellerne indlæses PRÆCIS som produktionen gør det (RIDER_GENERATION.md §5):
// V4 er den kanoniske værdimodel og SKAL routes gennem applyTypeDampening, og
// unge (< 22) klassificeres mod ungdoms-baselinen (#3570).
const TYPES_BASELINE = readJson("riderTypesBaseline.json");
const YOUTH_TYPES_BASELINE = readJson("riderTypesBaselineYouth.json");
const VALUATION_MODEL = applyTypeDampening(readJson("riderValuationModelV4.json"));
const CLASSIFIER_WEIGHTS_BY_TYPE = Object.freeze(
  Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights])),
);

export const DEFAULT_SEED = 20260918;
export const DEFAULT_COUNT = 1000;
export const DEFAULT_YOUTH_COUNT = 300;

// ── Statistik-hjælpere ───────────────────────────────────────────────────────
// Nearest-rank-percentil (ingen interpolation): p10 er den værdi 10 % af
// populationen ligger på eller under. Valgt frem for interpolation fordi evner
// er HELTAL — en interpoleret p90 på 43,5 findes ikke på nogen rytter.
export function percentile(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  const rank = Math.ceil(q * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))];
}

export function describe(values) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  return {
    n: xs.length,
    min: xs[0],
    p10: percentile(xs, 0.1),
    median: percentile(xs, 0.5),
    p90: percentile(xs, 0.9),
    max: xs[xs.length - 1],
    mean,
  };
}

const countBy = (rows, keyFn) => {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
};

const pct = (n, total) => (total ? (100 * n) / total : 0);
// Begge tal-formater SKAL være da-DK. Blandes `toFixed(1)` ind, betyder `.`
// to ting i samme dokument — tusindtalsseparator i `1.212.874` og decimalkomma
// i `13.8 %` — og en læser kan læse `13.8 %` som 138 %.
const fmt1 = (n) =>
  n == null
    ? "–"
    : Number(n).toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("da-DK"));

// ── Derive-kæden, spejlet ────────────────────────────────────────────────────
/**
 * Kør ÉN generator-record gennem den samme kæde `deriveForRiderIds` kører:
 * fødsels-forgrening → fysiologi → evner → bootstrap-type → caps → endelig
 * type (draw vinder) → base_value (V4).
 *
 * Spejlingen er selve pointen: en gate der kører en ANDEN kodesti end
 * produktionen vurderer en anden rytter end den der lander i DB'en — det er
 * #2065-klassen, og RIDER_GENERATION.md §8b gør spejlingen til et krav for
 * ethvert nyt kaldsted.
 */
export function deriveOne(record, index, seed, referenceYear) {
  const id = `gen5283-${seed}-${index}`;
  const age = record._meta?.age ?? null;
  const row = { ...record, id, archetype_draw: record._meta?.archetypeDraw ?? null };

  const born = isBornFromPriors(row)
    ? deriveBirthAbilities(row, { age, classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE })
    : null;
  const physiology = seedPhysiologyFromLegacy(
    born ? physiologySeedInputFromAbilities(row, born) : row,
  );
  const abilities = born ?? deriveAbilities(physiology, row, { asOfYear: referenceYear });

  const draw = row.archetype_draw;
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const capsSeed = draw?.primary
    ? { primary: draw.primary, secondary: draw.secondary || null }
    : { primary: bootstrap.primary.key, secondary: bootstrap.secondary.key };
  const caps = buildCapsForRider(
    abilities,
    { potentiale: row.potentiale, age },
    capsSeed.primary,
    capsSeed.secondary,
  );
  const typesModel = selectTypesBaseline(age, TYPES_BASELINE, YOUTH_TYPES_BASELINE);
  // rider-type-write-ok: syntetisk in-memory-rapport uden DB-rytter — typen
  // vises i rapporten og persisteres aldrig.
  const { primary, secondary } = resolveRiderTypes(draw, caps, typesModel);
  const base_value = predictBaseValue(
    { ...row, primary_type: primary.key, age },
    abilities,
    VALUATION_MODEL,
  );

  return {
    id,
    name: `${record.firstname} ${record.lastname}`,
    age,
    tier: record._meta?.tier ?? null,
    drawPrimary: draw?.primary ?? null,
    drawSecondary: draw?.secondary ?? null,
    // Klassifikatorens UAFHÆNGIGE gæt på anlægget, ud fra evnerne alene.
    // `resolveRiderTypes` lader anlægget vinde, så den ENDELIGE type er pr.
    // konstruktion lig anlægget — den kan derfor ikke måle om anlægget er
    // genkendeligt formet. Bootstrap-gættet kan: afviger det, har generatoren
    // født en rytter hvis evner ikke peger på hans egen arketype.
    bootstrapPrimary: bootstrap.primary.key,
    primaryType: primary.key,
    secondaryType: secondary.key,
    nationality_code: record.nationality_code,
    potentiale: record.potentiale,
    height: record.height,
    weight: record.weight,
    abilities,
    caps,
    base_value,
    record,
  };
}

/** Byg hele kohorten (voksen-stien) deterministisk. */
export function buildAdultCohort({
  seed = DEFAULT_SEED,
  count = DEFAULT_COUNT,
  referenceYear = LAUNCH_REFERENCE_YEAR,
} = {}) {
  const { riders, coverage, mode } = generateFictionalRiders({
    seed,
    count,
    referenceYear,
    mode: BIRTH_MODE_OWN_PRIORS,
  });
  return {
    mode,
    coverage,
    rows: riders.map((r, i) => deriveOne(r, i, seed, referenceYear)),
  };
}

/** Byg ungdoms-kohorten (akademi-stien = samme bånd U23-fødslen vil bruge). */
export function buildYouthCohort({
  seed = DEFAULT_SEED,
  count = DEFAULT_YOUTH_COUNT,
  referenceYear = LAUNCH_REFERENCE_YEAR,
} = {}) {
  const rng = makeRng((seed + 0x5283) >>> 0);
  const candidates = generateAcademyCandidates({
    rng,
    referenceYear,
    existingNames: new Set(),
    countOverride: count,
    mode: BIRTH_MODE_OWN_PRIORS,
  });
  // Akademi-stien returnerer `{ archetypeDraw, birthAbilities, rider }`, ikke
  // voksen-generatorens flade record med `_meta`. Formen normaliseres her, så
  // BEGGE kohorter kører gennem den samme `deriveOne` — ellers ville rapportens
  // to halvdele måle to forskellige kodestier.
  return candidates.map((c, i) => {
    const age = referenceYear - Number(String(c.rider.birthdate).slice(0, 4));
    const record = {
      ...c.rider,
      _meta: { age, tier: "youth", archetypeDraw: c.archetypeDraw, birthAbilities: c.birthAbilities },
    };
    return deriveOne(record, i, seed, referenceYear);
  });
}

// ── U23-sweep: hvad giver ungdomsbåndet ved 19-22 år? ────────────────────────
/**
 * D-054 §10.4 siger at hvert AI-hold skal have en U23-trup på 6-9 ryttere,
 * 19-22 år, født på spillets egne priors. Den eneste ungdoms-prior der findes i
 * dag er `YOUTH_BIRTH_BAND`, kalibreret til AKADEMIET (16-21).
 *
 * Denne sweep er gaten FØR den generering: den viser hvad båndet faktisk giver
 * ved hver af de fire U23-aldre, så det kan ses med øjnene om alderen stadig
 * flytter noget i den ende af intervallet.
 */
export function youthAgeSweep({ seed = DEFAULT_SEED, perAge = 200, potentiale = 3 } = {}) {
  const ages = [19, 20, 21, 22];
  return ages.map((age) => {
    const values = [];
    for (let i = 0; i < perAge; i++) {
      const abilities = drawYouthBirthAbilities({
        rng: makeBirthRng((seed + age * 1000 + i) >>> 0),
        age,
        potentiale,
        archetype: "rouleur",
        secondaryArchetype: null,
        classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE,
      });
      for (const key of REGISTRY_ABILITY_KEYS) values.push(abilities[key]);
    }
    const s = describe(values);
    const atCeil = values.filter((v) => v >= Math.round(YOUTH_BIRTH_BAND.ceil)).length;
    return { age, ...s, atCeilPct: pct(atCeil, values.length) };
  });
}

// ── Kompletthed: hvad MÅ ikke mangle på en nyfødt ────────────────────────────
// Listen er de kolonner generatoren selv ejer. `base_value`, `id`, `team_id`
// osv. udelades bevidst af generatoren (DB/backfill ejer dem) og hører derfor
// ikke til her — se kommentaren ved `riders.push` i fictionalRiderGenerator.js.
export const REQUIRED_RECORD_FIELDS = Object.freeze([
  "firstname",
  "lastname",
  "nationality_code",
  "birthdate",
  "height",
  "weight",
  "potentiale",
  "popularity",
  "uci_points",
]);

export function completenessReport(rows) {
  const missing = new Map();
  let missingAbility = 0;
  let statLeak = 0;
  let missingBirthMarker = 0;

  for (const r of rows) {
    for (const f of REQUIRED_RECORD_FIELDS) {
      const v = r.record[f];
      if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) {
        missing.set(f, (missing.get(f) ?? 0) + 1);
      }
    }
    for (const key of REGISTRY_ABILITY_KEYS) {
      if (!Number.isInteger(r.abilities?.[key])) missingAbility++;
    }
    // #5269/D-053: own-priors-stien må ALDRIG skrive en PCM-stat. Et 0 er lige
    // så galt som et tal — enhver kaldsted der summerer stats ville læse det
    // som en ægte værdi.
    for (const k of STAT_KEYS) {
      if (r.record[k] !== undefined && r.record[k] !== null) statLeak++;
    }
    const birth = r.record._meta?.archetypeDraw?.birth;
    if (!birth || !Number.isInteger(birth.seed) || !birth.tier || !(Number(birth.v) >= 1)) {
      missingBirthMarker++;
    }
  }
  return { missing, missingAbility, statLeak, missingBirthMarker };
}

// ── Markdown-rendering ───────────────────────────────────────────────────────
function table(header, rows) {
  const head = `| ${header.join(" | ")} |`;
  const sep = `|${header.map(() => "---").join("|")}|`;
  return [head, sep, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function shareTable(rows, keyFn, label) {
  const counts = [...countBy(rows, keyFn).entries()].sort((a, b) => b[1] - a[1]);
  return table(
    [label, "Antal", "Andel %"],
    counts.map(([k, n]) => [k ?? "(ingen)", String(n), fmt1(pct(n, rows.length))]),
  );
}

function abilityTable(rows) {
  return table(
    ["Evne", "Kategori", "Min", "p10", "Median", "p90", "Max", "Gns."],
    REGISTRY_ABILITY_KEYS.map((key) => {
      const s = describe(rows.map((r) => r.abilities[key]));
      return [
        key,
        abilityMeta(key)?.category ?? "–",
        String(s.min),
        String(s.p10),
        String(s.median),
        String(s.p90),
        String(s.max),
        fmt1(s.mean),
      ];
    }),
  );
}

function ceilingTable(rows) {
  const keys = Object.keys(MENTAL_ABILITY_TAG_CEILING);
  return table(
    ["Evne", "Loft (D-056)", "Født over loftet", "Andel %", "Max født"],
    keys.map((key) => {
      const ceil = MENTAL_ABILITY_TAG_CEILING[key];
      const over = rows.filter((r) => r.abilities[key] > ceil).length;
      const s = describe(rows.map((r) => r.abilities[key]));
      return [key, String(ceil), String(over), fmt1(pct(over, rows.length)), String(s.max)];
    }),
  );
}

/**
 * Hvor ofte genfinder klassifikatoren rytterens eget anlæg ud fra evnerne
 * alene? Det er det ENESTE tal i rapporten der måler om generatoren FORMER en
 * arketype — alt andet måler kun hvad den skrev ned.
 */
export function recognitionRate(rows) {
  const hit = rows.filter((r) => r.bootstrapPrimary === r.drawPrimary).length;
  return { hit, n: rows.length, pct: pct(hit, rows.length) };
}

function recognitionTable(rows) {
  const archetypes = [...new Set(rows.map((r) => r.drawPrimary))].sort();
  return table(
    ["Anlæg", "n", "Genfundet", "Andel %", "Hyppigste forveksling"],
    archetypes.map((a) => {
      const sub = rows.filter((r) => r.drawPrimary === a);
      const hit = sub.filter((r) => r.bootstrapPrimary === a).length;
      const wrong = [...countBy(sub.filter((r) => r.bootstrapPrimary !== a), (r) => r.bootstrapPrimary).entries()]
        .sort((x, y) => y[1] - x[1])[0];
      return [
        a,
        String(sub.length),
        String(hit),
        fmt1(pct(hit, sub.length)),
        wrong ? `${wrong[0]} (${wrong[1]})` : "–",
      ];
    }),
  );
}

/**
 * Hvor stor en andel af alle evne-værdier lander på gulvet (1) eller loftet (99)?
 * En høj gulv-andel betyder at fordelingen er klippet, ikke formet: to ryttere
 * med vidt forskellige priors ender med det samme tal, og forskellen mellem dem
 * forsvinder ud af spillet.
 */
export function clampReport(rows) {
  let floor = 0;
  let ceil = 0;
  let total = 0;
  const floorByAbility = new Map();
  for (const r of rows) {
    for (const key of REGISTRY_ABILITY_KEYS) {
      const v = r.abilities[key];
      total++;
      if (v <= 1) {
        floor++;
        floorByAbility.set(key, (floorByAbility.get(key) ?? 0) + 1);
      }
      if (v >= 99) ceil++;
    }
  }
  return { floor, ceil, total, floorByAbility };
}

function archetypeAbilityMatrix(rows, keys) {
  const archetypes = [...new Set(rows.map((r) => r.drawPrimary))].sort();
  return table(
    ["Arketype", "n", ...keys],
    archetypes.map((a) => {
      const sub = rows.filter((r) => r.drawPrimary === a);
      return [
        a,
        String(sub.length),
        ...keys.map((k) => String(describe(sub.map((r) => r.abilities[k])).median)),
      ];
    }),
  );
}

function valueByTier(rows) {
  const tiers = [...new Set(rows.map((r) => r.tier))];
  return table(
    ["Tier", "n", "Min", "Median", "p90", "Max"],
    tiers.map((t) => {
      const s = describe(rows.filter((r) => r.tier === t).map((r) => r.base_value));
      return [
        t,
        String(rows.filter((r) => r.tier === t).length),
        fmtInt(s?.min),
        fmtInt(s?.median),
        fmtInt(s?.p90),
        fmtInt(s?.max),
      ];
    }),
  );
}

function sampleTable(rows, n = 15) {
  const step = Math.max(1, Math.floor(rows.length / n));
  const picks = [];
  for (let i = 0; i < rows.length && picks.length < n; i += step) picks.push(rows[i]);
  const keys = ["climbing", "sprint", "time_trial", "flat", "punch", "endurance", "aggression", "tactics", "teamwork", "leadership"];
  return table(
    ["Navn", "Alder", "Tier", "Anlæg", "Type", "Pot.", ...keys, "Værdi"],
    picks.map((r) => [
      r.name,
      String(r.age),
      r.tier,
      r.drawPrimary,
      r.primaryType,
      String(r.potentiale),
      ...keys.map((k) => String(r.abilities[k])),
      fmtInt(r.base_value),
    ]),
  );
}

export function renderReport({ seed, count, referenceYear, adult, youth }) {
  const rows = adult.rows;
  const c = completenessReport(rows);
  const ages = describe(rows.map((r) => r.age));
  const pots = describe(rows.map((r) => r.potentiale));
  const values = describe(rows.map((r) => r.base_value));
  const signature = ["climbing", "sprint", "time_trial", "flat", "punch", "cobblestone", "tempo", "aggression"];
  const recog = recognitionRate(rows);
  const clamped = clampReport(rows);
  const sweep = youthAgeSweep({ seed });

  const findings = [];
  // U23-gaten, det vigtigste fund i rapporten: båndet er kalibreret til
  // AKADEMIET (16-21), og D-054 §10.4 vil bruge det ved 19-22.
  const saturated = sweep.filter((s) => s.atCeilPct >= 50);
  if (saturated.length) {
    findings.push(
      `**U23 (D-054 §10.4):** ungdomsbåndets loft på ${Math.round(YOUTH_BIRTH_BAND.ceil)} evne-point er mættet ved ` +
      `${saturated.map((s) => `alder ${s.age} (${fmt1(s.atCeilPct)} % af evne-værdierne på loftet)`).join(", ")}. ` +
      "Båndet er kalibreret til AKADEMIET (16-21), hvor mætningen er en tilsigtet invariant (G5, #3561/#2064 §2a: " +
      "en ungdomsrytters NUVÆRENDE evne må ikke løfte `ability_caps` over hans potentiale-loft). Bruges det SOM DET ER " +
      "til U23-trupperne, fødes 19-22-årige praktisk talt ens, og alderen holder op med at betyde noget i netop den ende " +
      "af intervallet U23-kalenderen kører i. **Dokumenteret, ikke rettet** — et nyt eller udvidet bånd er en " +
      "balance-beslutning der hører til U23-generings-sporet, ikke til denne test.",
    );
  }
  if (clamped.floor / clamped.total > 0.05) {
    const worst = [...clamped.floorByAbility.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    findings.push(
      `${fmt1(pct(clamped.floor, clamped.total))} % af alle evne-værdier lander på GULVET (1). ` +
      `Værst: ${worst.map(([k, n]) => `\`${k}\` ${fmt1(pct(n, rows.length))} % af rytterne`).join(", ")}. ` +
      "Det er ikke nyt med #5269: `domestique`-tieren fødes omkring evne 9 med spredning 9,8 (spejling af PCM-stien, RIDER_GENERATION.md §8b), " +
      "så en dæmpet evne rammer gulvet med det samme. Konsekvensen er at to domestiques med forskellige priors kan få samme tal, og forskellen forsvinder ud af spillet. " +
      "Dokumenteret her, IKKE rettet: en ændring af gulvet flytter hele populationen og er en ejer-beslutning.",
    );
  }
  for (const [f, n] of c.missing) findings.push(`\`${f}\` mangler på ${n} af ${rows.length} ryttere.`);
  if (c.missingAbility) findings.push(`${c.missingAbility} evne-værdier er ikke heltal.`);
  if (c.statLeak) findings.push(`${c.statLeak} PCM-stat-felter er sat på own-priors-stien (skal være helt udeladt, D-053).`);
  if (c.missingBirthMarker) findings.push(`${c.missingBirthMarker} ryttere mangler en gyldig fødsels-markør i \`archetype_draw.birth\`.`);
  for (const key of Object.keys(MENTAL_ABILITY_TAG_CEILING)) {
    const ceil = MENTAL_ABILITY_TAG_CEILING[key];
    const over = rows.filter((r) => r.abilities[key] > ceil).length;
    if (over) {
      findings.push(
        `${over} ryttere (${fmt1(pct(over, rows.length))} %) fødes med \`${key}\` over loftet ${ceil} (D-056). ` +
        `Loftet er et VÆKST-loft (\`youthAbilityCap\`), ikke et fødsels-loft: træningen lægger kun til, så ingen rytter mister evne — men de kan ikke træne evnen videre.`,
      );
    }
  }

  return [
    `# Synlig test af ryttergeneratoren — ${count.toLocaleString("da-DK")} ryttere (#5283)`,
    "",
    "> Read-only. Ingen DB, ingen prod-mutation, ingen ændring af generatorens adfærd.",
    `> Reproducér: \`node backend/scripts/generatorVisibleTest5283.js --seed=${seed} --count=${count}\``,
    "",
    "## 1. Hvad der er kørt",
    "",
    table(
      ["Parameter", "Værdi"],
      [
        ["Fødselssti", `\`${adult.mode}\` — spillets egne arketype-priors, ingen PCM-stats (#5269, GDD D-053)`],
        ["Seed", String(seed)],
        ["Antal", String(count)],
        ["Referenceår", String(referenceYear)],
        ["Derive-kæde", "fødsels-forgrening → fysiologi → evner → bootstrap-type → caps → endelig type → base_value (V4 + type-dæmpning)"],
        ["Ungdoms-kohorte", `${youth.length} akademi-kandidater ad samme prior-sti (ungdomsbåndet)`],
      ],
    ),
    "",
    "SSOT denne rapport måler imod:",
    "",
    "- `docs/RIDER_GENERATION.md` §1 (determinisme), §6 (derive-kæden), §8b (fødsel uden PCM, fødsels-markøren, spejlings-kravet)",
    "- `docs/GAME_DESIGN_DOCUMENT.md` D-053 (taktik/aggression bygger hverken på alder eller anden evne), D-056 (de mentale evners lofter), D-030/D-052 (lederskab må bruge alder), D-054 §10.4 (U23-trupper fødes på egne priors)",
    "- `docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md` §10.4",
    "",
    "## 2. Fordeling pr. arketype",
    "",
    "**Anlæg** (`archetype_draw.primary`) er det generatoren TRAK. Den ENDELIGE type er pr. konstruktion den samme: `resolveRiderTypes` lader anlægget vinde over klassifikatoren (#3588). Derfor står klassifikatorens UAFHÆNGIGE gæt nedenfor i stedet — det er det eneste tal der måler om anlægget faktisk er FORMET i evnerne.",
    "",
    shareTable(rows, (r) => r.drawPrimary, "Anlæg"),
    "",
    shareTable(rows, (r) => r.tier, "Tier"),
    "",
    `Klassifikatoren genfinder anlægget hos **${fmtInt(recog.hit)} af ${fmtInt(recog.n)}** ryttere (${fmt1(recog.pct)} %) ud fra evnerne alene.`,
    "",
    recognitionTable(rows),
    "",
    "## 3. Fordeling pr. evne",
    "",
    abilityTable(rows),
    "",
    "## 4. Lofterne for de mentale evner (D-056)",
    "",
    "`aggression` står bevidst UDEN loft (#5297, D-056): den er baroudeurens signaturevne, og et loft på 70 skar hans signatur 23 point ned til håndværksniveau mens alle andre arketyper beholdt en uloftet signatur.",
    "",
    ceilingTable(rows),
    "",
    "## 5. Signatur-evner pr. arketype (median)",
    "",
    "Diagonalen skal være tydelig: en sprinters `sprint` skal ligge markant over en klatrers, og omvendt. Er den ikke det, er anlægget ikke formet.",
    "",
    archetypeAbilityMatrix(rows, signature),
    "",
    "## 6. Alder, potentiale og værdi",
    "",
    table(
      ["Akse", "Min", "p10", "Median", "p90", "Max", "Gns."],
      [
        ["Alder", String(ages.min), String(ages.p10), String(ages.median), String(ages.p90), String(ages.max), fmt1(ages.mean)],
        ["Potentiale", String(pots.min), String(pots.p10), String(pots.median), String(pots.p90), String(pots.max), fmt1(pots.mean)],
        ["base_value", fmtInt(values.min), fmtInt(values.p10), fmtInt(values.median), fmtInt(values.p90), fmtInt(values.max), fmtInt(values.mean)],
      ],
    ),
    "",
    valueByTier(rows),
    "",
    "## 7. Kompletthed (ingen huller i data)",
    "",
    table(
      ["Tjek", "Resultat"],
      [
        ["Påkrævede felter uden værdi", c.missing.size ? [...c.missing].map(([k, n]) => `${k}: ${n}`).join(", ") : "0"],
        ["Evner der ikke er heltal", String(c.missingAbility)],
        ["PCM-stat-felter sat (skal være 0)", String(c.statLeak)],
        ["Ryttere uden gyldig fødsels-markør", String(c.missingBirthMarker)],
        ["Evner pr. rytter", `${REGISTRY_ABILITY_KEYS.length} (hele registret)`],
        ["Evne-værdier på gulvet (1)", `${fmtInt(clamped.floor)} af ${fmtInt(clamped.total)} (${fmt1(pct(clamped.floor, clamped.total))} %)`],
        ["Evne-værdier på loftet (99)", `${fmtInt(clamped.ceil)} af ${fmtInt(clamped.total)} (${fmt1(pct(clamped.ceil, clamped.total))} %)`],
      ],
    ),
    "",
    "## 8. Ungdomsbåndet (den sti U23-truppene vil bruge)",
    "",
    `${youth.length} kandidater, samme seed-familie. U23-fødslen (D-054 §10.4) trækker i det SAMME bånd (\`YOUTH_BIRTH_BAND\`), blot ved alder 19-22 i stedet for akademiets 16-21.`,
    "",
    table(
      ["Akse", "Min", "p10", "Median", "p90", "Max"],
      [
        ["Alder", ...["min", "p10", "median", "p90", "max"].map((k) => String(describe(youth.map((r) => r.age))[k]))],
        ["Potentiale", ...["min", "p10", "median", "p90", "max"].map((k) => String(describe(youth.map((r) => r.potentiale))[k]))],
        ["base_value", ...["min", "p10", "median", "p90", "max"].map((k) => fmtInt(describe(youth.map((r) => r.base_value))[k]))],
      ],
    ),
    "",
    abilityTable(youth),
    "",
    "### 8b. Båndet ved U23-aldrene (19-22)",
    "",
    `\`YOUTH_BIRTH_BAND\` har et hårdt loft på ${Math.round(YOUTH_BIRTH_BAND.ceil)} evne-point (spejling af akademiets \`statCeil\` 54). Alders-rampen giver ${fmt1(YOUTH_BIRTH_BAND.perYearOver16)} point pr. år over 16 oven på et grundniveau på ${fmt1(YOUTH_BIRTH_BAND.baseAt16)}. Tabellen nedenfor er 200 træk pr. alder (rouleur, potentiale 3) og viser hvor stor en andel af evne-værdierne der rammer loftet:`,
    "",
    table(
      ["Alder", "Min", "Median", "p90", "Max", "På loftet %"],
      sweep.map((s) => [String(s.age), String(s.min), String(s.median), String(s.p90), String(s.max), fmt1(s.atCeilPct)]),
    ),
    "",
    "## 9. Fund",
    "",
    findings.length
      ? findings.map((f) => `- ${f}`).join("\n")
      : "- Ingen. Alle påkrævede felter er sat, alle evner er heltal i \\[1,99], ingen PCM-stat er skrevet, og alle ryttere bærer en gyldig fødsels-markør.",
    "",
    "## 10. Stikprøve",
    "",
    sampleTable(rows),
    "",
  ].join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const get = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return {
    seed: Number(get("seed", DEFAULT_SEED)),
    count: Number(get("count", DEFAULT_COUNT)),
    youthCount: Number(get("youth", DEFAULT_YOUTH_COUNT)),
    referenceYear: Number(get("year", LAUNCH_REFERENCE_YEAR)),
    out: get("out", null),
  };
}

export function main(argv = process.argv.slice(2)) {
  const { seed, count, youthCount, referenceYear, out } = parseArgs(argv);
  const adult = buildAdultCohort({ seed, count, referenceYear });
  const youth = buildYouthCohort({ seed, count: youthCount, referenceYear });
  const md = renderReport({ seed, count, referenceYear, adult, youth });
  if (out) {
    const target = resolve(process.cwd(), out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, md, "utf8");
    process.stdout.write(`skrevet: ${target}\n`);
  } else {
    process.stdout.write(md);
  }
  return md;
}

// Kør KUN når filen er entry point. Testen importerer den samme modul-graf, og
// et bredere tjek (fx `argv[1].endsWith(...)`) ville få rapporten til at køre
// midt i en testkørsel.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
