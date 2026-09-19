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
// docs/RIDER_GENERATION.md). Derfor kan to kørsler diffes mod hinanden uden at
// rapporten ligger i git — og det SKAL den ikke: den er præcise balance-tal, og
// hard rule 17 (#3436) holder dem ude af det offentligt læsbare repo. Skriv den
// til `balance-internals/` (gitignoreret) eller lever den i chatten.
//
// Brug:
//   node backend/scripts/generatorVisibleTest5283.js                      (stdout)
//   node backend/scripts/generatorVisibleTest5283.js --out=../balance-internals/x.md
//   node backend/scripts/generatorVisibleTest5283.js --count=1000 --seed=20260918
//   node backend/scripts/generatorVisibleTest5283.js --u23=400   (§8d-varianterne)
//   node backend/scripts/generatorVisibleTest5283.js --tuning=../balance-internals/u23-band-tuning.json
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
  U23_BIRTH_BAND,
  U23_BIRTH_AGE_MIN,
  U23_BIRTH_AGE_MAX,
  BIRTH_ARCHETYPE_KEYS,
  statLevelToAbility,
  statPointsToAbility,
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
/** Træk pr. alder pr. bånd-variant i §8d (#5376). */
export const DEFAULT_U23_PER_AGE = 200;
// Loft, ikke en balance-grænse: sweepet er 4 varianter × 4 aldre × hele
// evne-registret pr. træk, så et fejlindtastet stort tal er en kørsel der
// aldrig bliver færdig. Rigeligt til enhver stikprøve rapporten har brug for.
export const MAX_U23_PER_AGE = 100_000;

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
 * ved hver af U23-fødselsaldrene, så det kan ses med øjnene om alderen stadig
 * flytter noget i den ende af intervallet.
 *
 * `band` er en PARAMETER og ikke en konstant: siden #5376 findes der TO bånd —
 * akademiets (referencen: hvorfor U23 skulle have sit eget) og U23-fødslens
 * produktions-bånd. Begge måles ad præcis samme kodesti, ellers måler de to
 * tabeller to forskellige ryttere (#2065).
 */
export function youthAgeSweep({
  seed = DEFAULT_SEED,
  perAge = 200,
  potentiale = 3,
  band = YOUTH_BIRTH_BAND,
} = {}) {
  const ceilInt = Math.round(band.ceil);
  return U23_BIRTH_AGES.map((age) => {
    const values = [];
    for (let i = 0; i < perAge; i++) {
      const abilities = drawYouthBirthAbilities({
        rng: makeBirthRng((seed + age * 1000 + i) >>> 0),
        age,
        potentiale,
        archetype: "rouleur",
        secondaryArchetype: null,
        classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE,
        band,
      });
      for (const key of REGISTRY_ABILITY_KEYS) values.push(abilities[key]);
    }
    const s = describe(values);
    const atCeil = values.filter((v) => v >= ceilInt).length;
    return { age, ceil: ceilInt, ...s, atCeilPct: pct(atCeil, values.length) };
  });
}

// ── Forward-guard: mætning pr. alder på PRODUKTIONS-båndet (#5376) ───────────
/**
 * Den ene ting U23-båndet blev bygget for, er at ALDEREN skal flytte noget hele
 * vejen gennem fødselsintervallet. Guarden måler præcis det på det bånd
 * produktionen faktisk føder på, og siger til hvis mætningen kommer snigende
 * igen — fx hvis nogen senere sænker loftet, gør rampen stejlere, eller
 * akademiets forankring flyttes (U23-båndet ARVER den).
 *
 * To måder det kan gå galt, begge dækket:
 *   1. Medianen står stille fra ét år til det næste → alderen er holdt op med
 *      at betyde noget, uanset hvor pænt resten af rækken ser ud.
 *   2. En stor del af evne-værdierne ligger på loftet → klipningen er tilbage.
 *
 * Ren måling. Returnerer fundene; det er kaldstedet (rapporten eller testen)
 * der afgør hvad de skal bruges til.
 *
 * @returns {{age:number, reason:"flad-median"|"maettet", atCeilPct:number, median:number}[]}
 */
export function u23ProductionBandGuard({
  seed = DEFAULT_SEED,
  perAge = 200,
  potentiale = 3,
  band = U23_BIRTH_BAND,
  maxAtCeilPct = U23_GUARD_MAX_AT_CEIL_PCT,
} = {}) {
  const sweep = youthAgeSweep({ seed, perAge, potentiale, band });
  const breaches = [];
  sweep.forEach((s, i) => {
    if (i > 0 && s.median - sweep[i - 1].median <= 0) {
      breaches.push({ age: s.age, reason: "flad-median", atCeilPct: s.atCeilPct, median: s.median });
    } else if (s.atCeilPct > maxAtCeilPct) {
      breaches.push({ age: s.age, reason: "maettet", atCeilPct: s.atCeilPct, median: s.median });
    }
  });
  return breaches;
}

// ── U23-fødselsbåndets varianter (#5376) ─────────────────────────────────────
// Dette afsnit ER det designkort ejeren valgte ud fra 18/9. Det bliver stående
// efter valget: uden det er "vi løftede loftet" en påstand uden det alternativ
// den blev valgt frem for. Hver variant køres gennem PRÆCIS den samme
// `drawYouthBirthAbilities` produktionen kalder — et forslag der måles ad en
// anden kodesti end den der senere fødes på, måler en anden rytter (#2065).
//
// BINDENDE for hele afsnittet:
//   - `YOUTH_BIRTH_BAND` er AKADEMIETS bånd og RØRES IKKE. Hver variant er et
//     NYT, frosset objekt afledt af det. Akademiets mætning ved 16-21 er en
//     TILSIGTET invariant (G5, #3561/#2064 §2a: en ungdomsrytters nuværende
//     evne må ikke løfte `ability_caps` over hans potentiale-loft) og skal
//     blive stående uændret.
//   - Varianterne her er stadig KUN målinger. Den vedtagne A lever som
//     `U23_BIRTH_BAND` i `riderBirthPriors.js` (produktionen læser DEN), og
//     intet kaldsted læser objekterne nedenfor.
//   - Sweepets tal hører til `balance-internals/` (gitignoreret), aldrig i
//     repoet, i en PR-body eller i en issue-kommentar (hard rule 17, #3436).
//
// Aldrene er IKKE frit valgte. De følger `riderSeasonAge.js`: U23 er sæson-
// alder < 23 (`isU23ForReferenceYear`), så Graduation Day falder ved 23 og de
// fire fødselsaldre er 19-22. U25 er sæson-alder ≤ 25 (UCI-reglen, ejer 2/9) og
// rører ikke fødslen. Akademi-nedrykning gælder kun ≤ 21 — derfor OVERLAPPER
// 19-21 akademiets interval, og det er præcis dér en variant enten kan bevare
// akademiets fordeling eller bevidst afvige fra den.
// Intervallet kommer fra truppens egne aldersgrænser via `riderBirthPriors.js`
// (som læser `squads.js`), ikke fra en liste skrevet her: flytter ejeren en
// trup-grænse, følger fødselsaldrene med i stedet for at stå tilbage som en kopi.
export const U23_BIRTH_AGES = Object.freeze(
  Array.from({ length: U23_BIRTH_AGE_MAX - U23_BIRTH_AGE_MIN + 1 }, (_, i) => U23_BIRTH_AGE_MIN + i),
);
/** Øverste alder akademiet selv dækker — grænsen C's loft-rampe starter over. */
export const ACADEMY_TOP_AGE = 21;
/** Yngste U23-fødselsalder; B forankres her, så akademi-overlappet holdes fast. */
export const U23_ENTRY_AGE = U23_BIRTH_AGES[0];

// Forward-guardens tålegrænse for hvor stor en del af evne-værdierne der må
// ligge på PRODUKTIONS-båndets loft ved en given alder. Det er en GUARD-tærskel
// (hvornår siger vi fra), ikke en balance-knap: den siger intet om hvor højt
// loftet skal ligge, kun at klipningen ikke må blive dominerende igen.
export const U23_GUARD_MAX_AT_CEIL_PCT = 25;

/** Afledt bånd — ALTID et nyt frosset objekt, aldrig en mutation af akademiets. */
const derivedBand = (overrides) => Object.freeze({ ...YOUTH_BIRTH_BAND, ...overrides });

// ── Kalibrerings-tallene ligger UDEN FOR repoet (hard rule 17, #3436) ────────
// HVOR højt et loft og HVOR stejl en rampe hvert forslag har, ER selve den
// balance-beslutning ejeren skal træffe (#5376) — og repoet er offentligt
// læsbart. Derfor står STRUKTUREN her (hvilken knap hver variant drejer på, og
// hvordan den forankres), mens VÆRDIERNE læses fra en lokal, gitignoreret fil:
//
//   balance-internals/u23-band-tuning.json
//
// Enhederne er PCM-stat-enheder — samme sprog `YOUTH_BIRTH_BAND` selv er
// skrevet i (`statLevelToAbility` / `statPointsToAbility`): et stat-NIVEAU er
// et loft på PCM-skalaen, stat-POINT er et tillæg. Filen kan også udpeges med
// `--tuning=<sti>` eller miljøvariablen `CZ_U23_BAND_TUNING`.
//
// Mangler filen, renderes §8d som det kvalitative kort UDEN måletabel. Det er
// med vilje: et designkort med opdigtede tal er værre end et uden tal.
export const U23_TUNING_FIELDS = Object.freeze({
  aCeilStatLevel: "A: loftet, som stat-NIVEAU",
  bPerYearStatPoints: "B: alders-rampe, stat-point pr. år over 16",
  bCeilStatLevel: "B: loftet, som stat-NIVEAU",
  bSpreadFactor: "B: faktor på akademiets spredning (`sd` + `startLuckSd`)",
  cCeilStatPointsPerYearOverAcademy:
    "C: stat-point loftet vokser pr. år over akademiets øverste alder",
});

/** Sti-etiketten der vises i rapporten — repo-relativ, så den er ens på alle maskiner. */
export const U23_TUNING_LABEL = "balance-internals/u23-band-tuning.json";
export const U23_TUNING_PATH = resolve(__dirname, "..", "..", U23_TUNING_LABEL);

/**
 * Læs kalibrerings-filen. Returnerer `null` hvis den ikke findes — det er en
 * normal tilstand (enhver der ikke sidder med ejerens lokale mappe), ikke en
 * fejl. Er filen der, valideres HVERT felt: et manglende eller ikke-numerisk
 * felt ville ellers give `NaN` i et bånd, og sweepet ville vise "–" i hver
 * celle som om båndet ikke kunne måles.
 */
export function loadU23Tuning({ path = process.env.CZ_U23_BAND_TUNING || U23_TUNING_PATH } = {}) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path}: ugyldig JSON — ${err.message}`, { cause: err });
  }
  const tuning = {};
  for (const [field, meaning] of Object.entries(U23_TUNING_FIELDS)) {
    const value = parsed?.[field];
    if (!Number.isFinite(value)) {
      throw new Error(
        `${path}: feltet \`${field}\` (${meaning}) skal være et tal — fik ${JSON.stringify(value)}`,
      );
    }
    tuning[field] = value;
  }
  if (tuning.bSpreadFactor <= 0) {
    throw new Error(`${path}: \`bSpreadFactor\` skal være > 0 — fik ${tuning.bSpreadFactor}`);
  }
  return Object.freeze(tuning);
}

/**
 * De tre forslag + dagens bånd som referencerække.
 *
 * `bandFor(age, tuning)` er en FUNKTION og ikke et fladt objekt af to grunde:
 * C's loft afhænger af alderen, og alle tal kommer udefra. Baseline og A/B
 * returnerer det samme objekt for alle aldre; kun C varierer.
 *
 * Teksterne er KVALITATIVE med vilje ("højere loft", "stejlere rampe"): en
 * kvalitativ beskrivelse af en mekanik må gerne stå i repoet, et præcist tal
 * må ikke (hard rule 17).
 */
export const U23_BAND_VARIANT_SPECS = Object.freeze([
  Object.freeze({
    key: "baseline",
    label: "I dag — akademiets bånd brugt som det er",
    summary:
      "U23-fødslen genbruger `YOUTH_BIRTH_BAND` uændret. Referencerækken, ikke et forslag.",
    tradeoff:
      "Ingen ny kode og ingen risiko for akademiet — men båndet er kalibreret til 16-21, og i den øvre ende af U23-intervallet er loftet mættet, så alderen holder op med at flytte noget.",
    // Referencerækken er dagens bånd og har derfor ingen kalibrering at læse.
    needsTuning: false,
    bandFor: () => YOUTH_BIRTH_BAND,
  }),
  Object.freeze({
    key: "a-loeft-loftet",
    label: "A — løft loftet, behold rampen",
    summary:
      "Én knap: U23-stien får et højere loft, mens forankring, alders-rampe og spredning er akademiets. Alders-rampen findes allerede; det var kun klipningen mod loftet der fjernede dens virkning.",
    tradeoff:
      "Mindst mulig ny mekanik og mindst mulig overflade at vedligeholde. Til gengæld ændrer den fordelingen på HELE U23-intervallet, også i de tre år (19-21) der overlapper akademiet — en akademi-graduand og en nyfødt U23-rytter på samme alder trækkes derefter forskelligt.",
    needsTuning: true,
    bandFor: (age, tuning) => {
      const ceil = statLevelToAbility(tuning.aCeilStatLevel);
      return derivedBand({ ceil, ceilBoosted: ceil });
    },
  }),
  Object.freeze({
    key: "b-eget-baand",
    label: "B — eget U23-bånd med egen rampe og spredning",
    summary:
      "U23 får sit eget bånd, forankret så indgangsalderen (19) lander præcis hvor akademiets bånd gør i dag, og med en stejlere alders-rampe og bredere spredning derefter. Akademiets bånd er urørt og lever videre ved siden af.",
    tradeoff:
      "Mest kontrol: alder og potentiale kan gøres til at betyde præcis så meget som ejeren vil, uafhængigt af akademiet. Prisen er to bånd at holde i sync og en fordeling der fanner tydeligt ud over de fire år — den ældste U23-rytter bliver markant stærkere end den yngste.",
    needsTuning: true,
    bandFor: (age, tuning) => {
      const perYearOver16 = statPointsToAbility(tuning.bPerYearStatPoints);
      const ceil = statLevelToAbility(tuning.bCeilStatLevel);
      return derivedBand({
        // Forankret i U23_ENTRY_AGE: den stejlere rampe trækkes ud af
        // grundniveauet, så alder 19 giver NØJAGTIG samme udgangspunkt som i
        // dag og kun 20-22 fanner ud. Uden denne modregning ville en stejlere
        // rampe også løfte indgangsalderen, og så ville forslaget flytte to
        // ting på én gang.
        baseAt16:
          YOUTH_BIRTH_BAND.baseAt16 -
          (U23_ENTRY_AGE - 16) * (perYearOver16 - YOUTH_BIRTH_BAND.perYearOver16),
        perYearOver16,
        sd: YOUTH_BIRTH_BAND.sd * tuning.bSpreadFactor,
        startLuckSd: YOUTH_BIRTH_BAND.startLuckSd * tuning.bSpreadFactor,
        ceil,
        ceilBoosted: ceil,
      });
    },
  }),
  Object.freeze({
    key: "c-alders-rampet-loft",
    label: "C — alders-rampet loft, akademiets fordeling bevaret til og med 21",
    summary:
      "Båndet er akademiets, men loftet vokser med alderen OVER akademiets øverste alder. Ved 19-21 er fordelingen bit for bit den samme som i dag; kun den ældste årgang får luft.",
    tradeoff:
      "Den mest skånsomme: overlappet med akademiet er bevist uændret, så G5 og akademiets kalibrering ikke kan flytte sig som sideeffekt. Til gengæld løser den kun toppen af intervallet — er mætningen også et problem længere nede, gør C ikke noget ved det.",
    needsTuning: true,
    bandFor: (age, tuning) => {
      const yearsOverAcademy = Math.max(0, Number(age) - ACADEMY_TOP_AGE);
      // Identitet, ikke en kopi: de aldre C ikke rører, SKAL køre på præcis det
      // samme objekt som baseline, så kontinuitets-testen kan bevise det.
      if (!yearsOverAcademy) return YOUTH_BIRTH_BAND;
      const ceil =
        YOUTH_BIRTH_BAND.ceil +
        yearsOverAcademy * statPointsToAbility(tuning.cCeilStatPointsPerYearOverAcademy);
      return derivedBand({ ceil, ceilBoosted: ceil });
    },
  }),
]);

/**
 * Bind kalibreringen til specs'ene. Uden kalibrerings-fil returneres KUN
 * referencerækken: et forslag hvis tal ingen har valgt, kan ikke måles, og en
 * opdigtet stand-in ville gøre designkortet misvisende i præcis den ene ting
 * det skal bruges til.
 */
export function buildU23BandVariants(tuning = loadU23Tuning()) {
  return Object.freeze(
    U23_BAND_VARIANT_SPECS.filter((spec) => !spec.needsTuning || tuning).map((spec) =>
      Object.freeze({
        key: spec.key,
        label: spec.label,
        summary: spec.summary,
        tradeoff: spec.tradeoff,
        bandFor: (age) => spec.bandFor(age, tuning),
      }),
    ),
  );
}

/**
 * Kør hver variant gennem hver U23-alder og mål mætningen.
 *
 * Sweepet trækker over ALLE arketyper og fire potentiale-trin, ikke kun én
 * arketype som §8b: en signatur-evne får et boost oven i grundniveauet og
 * rammer derfor loftet FØRST. Måltes kun én arketype, ville mætningen se
 * mildere ud end den bliver i en rigtig trup.
 *
 * "På loftet %" måles mod VARIANTENS eget loft — det er hele pointen: et
 * forslag der hæver loftet skal bedømmes på om det stadig klipper, ikke på
 * hvor mange der ligger over akademiets gamle grænse.
 */
export function u23VariantSweep({
  seed = DEFAULT_SEED,
  perAge = DEFAULT_U23_PER_AGE,
  variants = buildU23BandVariants(),
} = {}) {
  // `perAge` er loop-grænsen. Et NaN eller et 0 giver en tom stikprøve, og
  // rapporten ville så vise "–" i hver celle som om båndet ikke kunne måles;
  // et Infinity ville få kørslen til at hænge i stedet for at sige fra. Begge
  // dele er værre end en fejl, fordi designkortet er det ejeren beslutter ud
  // fra — så den forkerte værdi stoppes her, ikke i tabellen.
  if (!Number.isInteger(perAge) || perAge < 1 || perAge > MAX_U23_PER_AGE) {
    throw new Error(
      `u23VariantSweep: perAge skal være et helt tal i [1,${MAX_U23_PER_AGE}] — fik ${perAge}`,
    );
  }
  return variants.map((variant) => ({
    key: variant.key,
    label: variant.label,
    summary: variant.summary,
    tradeoff: variant.tradeoff,
    ages: U23_BIRTH_AGES.map((age) => {
      const band = variant.bandFor(age);
      const ceilInt = Math.round(band.ceil);
      const values = [];
      let atCeil = 0;
      for (let i = 0; i < perAge; i++) {
        const abilities = drawYouthBirthAbilities({
          // Samme seed-familie pr. (alder, i) på tværs af varianter, så to
          // varianter sammenlignes på de SAMME træk. Ellers ville en del af
          // forskellen mellem to rækker bare være to forskellige stikprøver.
          rng: makeBirthRng((seed + age * 1000 + i) >>> 0),
          age,
          potentiale: 2 + (i % 4),
          archetype: BIRTH_ARCHETYPE_KEYS[i % BIRTH_ARCHETYPE_KEYS.length],
          secondaryArchetype: null,
          classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE,
          band,
        });
        for (const key of REGISTRY_ABILITY_KEYS) {
          const v = abilities[key];
          values.push(v);
          if (v >= ceilInt) atCeil++;
        }
      }
      return {
        age,
        ceil: ceilInt,
        ...describe(values),
        atCeilPct: pct(atCeil, values.length),
      };
    }),
  }));
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

/**
 * Mætning pr. alder pr. variant — designkortets ene tabel.
 *
 * Den afgørende kolonne er IKKE "På loftet %", men "Δ median" : hvor meget ét
 * års aldersforskel faktisk flytter. Står den på 0, er alderen holdt op med at
 * betyde noget uanset hvor pænt resten af rækken ser ud.
 */
function u23VariantTable(sweep) {
  const rows = [];
  for (const variant of sweep) {
    for (const a of variant.ages) {
      const prev = variant.ages.find((x) => x.age === a.age - 1);
      rows.push([
        variant.label,
        String(a.age),
        String(a.ceil),
        String(a.median),
        String(a.p90),
        String(a.max),
        fmt1(a.atCeilPct),
        prev ? fmt1(a.median - prev.median) : "–",
      ]);
    }
  }
  return table(
    ["Variant", "Alder", "Loft", "Median", "p90", "Max", "På loftet %", "Δ median vs. året før"],
    rows,
  );
}

// Den kvalitative halvdel af kortet. Den kan ALTID renderes: den indeholder
// ingen tal, kun hvad hver variant gør og hvad den koster.
function u23VariantSummaryTable(specs) {
  return table(
    ["Variant", "Hvad den gør", "Hvad den koster"],
    specs.map((v) => [v.label, v.summary, v.tradeoff]),
  );
}

export function renderReport({
  seed,
  count,
  referenceYear,
  adult,
  youth,
  u23PerAge = 200,
  u23Tuning = loadU23Tuning(),
}) {
  const rows = adult.rows;
  const c = completenessReport(rows);
  const ages = describe(rows.map((r) => r.age));
  const pots = describe(rows.map((r) => r.potentiale));
  const values = describe(rows.map((r) => r.base_value));
  const signature = ["climbing", "sprint", "time_trial", "flat", "punch", "cobblestone", "tempo", "aggression"];
  const recog = recognitionRate(rows);
  const clamped = clampReport(rows);
  const sweep = youthAgeSweep({ seed });
  // Samme sweep på det bånd U23-fødslen FAKTISK bruger (#5376, variant A).
  const productionSweep = youthAgeSweep({ seed, band: U23_BIRTH_BAND });
  const productionBreaches = u23ProductionBandGuard({ seed });
  // Uden kalibrerings-fil er der kun referencerækken at måle — så springes
  // måletabellen over, og §8d viser den kvalitative side af kortet alene.
  const variantSweep = u23Tuning
    ? u23VariantSweep({ seed, perAge: u23PerAge, variants: buildU23BandVariants(u23Tuning) })
    : null;

  const findings = [];
  // Forward-guarden (#5376): det bånd U23-fødslen FAKTISK bruger, skal lade
  // alderen flytte noget hele vejen gennem fødselsintervallet. Bliver den flad
  // eller mættet igen — fx fordi akademiets forankring flyttede, og U23-båndet
  // arver den — står det som et fund her, ikke som noget nogen skal opdage selv.
  if (productionBreaches.length) {
    findings.push(
      "**U23-produktionsbåndet (D-054 §10.4) er brudt.** " +
      `${productionBreaches.map((b) => b.reason === "flad-median"
        ? `alderen flytter ikke medianen ved ${b.age - 1} → ${b.age}`
        : `alder ${b.age} har for stor en del af evne-værdierne på loftet`).join("; ")}. ` +
      "Båndet blev bygget netop for at alderen skal betyde noget gennem hele intervallet (ejer-valg 18/9, #5376). " +
      "U23-båndet ARVER akademiets forankring, rampe og spredning, så et brud her kan også skyldes en ændring på " +
      "akademi-siden. **Skal rettes før U23-truppene genereres**, ikke efter.",
    );
  }
  // Referencen: hvorfor U23-båndet overhovedet skulle findes. Akademiets bånd er
  // kalibreret til 16-21, hvor mætningen er en TILSIGTET invariant (G5,
  // #3561/#2064 §2a), og netop dét loft klipper i den øvre ende af U23-intervallet.
  const saturated = sweep.filter((s) => s.atCeilPct >= 50);
  if (saturated.length) {
    findings.push(
      "**Akademiets bånd kan ikke bruges til U23-fødsel (referencen bag #5376).** " +
      `Loftet er mættet ved ${saturated.map((s) => `alder ${s.age} (${fmt1(s.atCeilPct)} % af evne-værdierne på loftet)`).join(", ")}. ` +
      "Mætningen er tilsigtet på akademi-siden (G5, #3561/#2064 §2a: en ungdomsrytters NUVÆRENDE evne må ikke løfte " +
      "`ability_caps` over hans potentiale-loft) og akademiets bånd står derfor UÆNDRET. Det er præcis derfor " +
      "U23-fødslen fik sit eget bånd (§8c) i stedet for at låne akademiets.",
    );
  }
  // §8d's ene konklusion, skrevet ud så den ikke skal læses ud af tabellen:
  // en variant duer kun hvis alderen stadig flytter medianen ved HVERT trin.
  for (const variant of variantSweep ?? []) {
    if (variant.key === "baseline") continue;
    const flat = variant.ages.filter((a, i) => i > 0 && a.median - variant.ages[i - 1].median <= 0);
    if (flat.length) {
      findings.push(
        `**U23-variant "${variant.label}" (§8d, fravalgt):** alderen flytter ikke medianen ved ` +
        `${flat.map((a) => `${a.age - 1} → ${a.age}`).join(", ")}. Varianten løser ikke det den er foreslået for.`,
      );
    }
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
    "## 8. Ungdoms-fødslen: akademiets bånd og U23-båndet",
    "",
    `${youth.length} akademi-kandidater, samme seed-familie. Akademiet er dér ryttere FØDES i spillet (16 år, \`YOUTH_BIRTH_BAND\`). U23-fødslen (D-054 §10.4) er en ENGANGS-generering ved S4-cutover og trækker siden #5376 i sit EGET bånd — se §8c.`,
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
    `### 8b. AKADEMIETS bånd ved U23-aldrene (${U23_BIRTH_AGES[0]}-${U23_BIRTH_AGES[U23_BIRTH_AGES.length - 1]}) — referencen`,
    "",
    `Referencerækken, ikke produktionen: sådan ville U23-fødslen se ud hvis den lånte akademiets bånd. \`YOUTH_BIRTH_BAND\` har et hårdt loft på ${Math.round(YOUTH_BIRTH_BAND.ceil)} evne-point (spejling af akademiets \`statCeil\` 54). Alders-rampen giver ${fmt1(YOUTH_BIRTH_BAND.perYearOver16)} point pr. år over 16 oven på et grundniveau på ${fmt1(YOUTH_BIRTH_BAND.baseAt16)}. Tabellen nedenfor er 200 træk pr. alder (rouleur, potentiale 3) og viser hvor stor en andel af evne-værdierne der rammer loftet:`,
    "",
    table(
      ["Alder", "Min", "Median", "p90", "Max", "På loftet %"],
      sweep.map((s) => [String(s.age), String(s.min), String(s.median), String(s.p90), String(s.max), fmt1(s.atCeilPct)]),
    ),
    "",
    "### 8c. U23-fødselsbåndet i produktion (ejer-valgt 18/9, #5376)",
    "",
    "`U23_BIRTH_BAND` er det bånd U23-truppene til AI-holdene rent faktisk fødes på. Ejeren valgte variant A: **løft loftet, behold rampen** — forankring, alders-rampe og spredning ARVES fra akademiets bånd, og loftet er det eneste der afviger. Akademiets bånd og dets mætnings-invariant (G5, #3561/#2064 §2a) er uændret; ryttere fødes fortsat som 16-årige i akademiet, og dette bånd bruges kun til engangs-genereringen ved S4-cutover.",
    "",
    "Samme sweep som §8b, samme seed-familie, samme kodesti — kun båndet er skiftet, så de to tabeller kan sammenlignes række for række:",
    "",
    table(
      ["Alder", "Loft", "Min", "Median", "p90", "Max", "På loftet %"],
      productionSweep.map((s) => [String(s.age), String(s.ceil), String(s.min), String(s.median), String(s.p90), String(s.max), fmt1(s.atCeilPct)]),
    ),
    "",
    `**Forward-guard.** Den afgørende egenskab er at medianen stiger ved HVERT alderstrin og at loftet ikke klipper dominerende (tålegrænse ${U23_GUARD_MAX_AT_CEIL_PCT} % af evne-værdierne). \`u23ProductionBandGuard()\` måler begge dele, og et brud lander i §9 — også hvis årsagen er en ændring på akademi-siden, som U23-båndet arver fra. Status i denne kørsel: ${productionBreaches.length ? `**BRUDT** ved ${productionBreaches.map((b) => `alder ${b.age}`).join(", ")}` : `**holder** ved alle ${U23_BIRTH_AGES.length} aldre`}.`,
    "",
    "### 8d. Mætning pr. alder pr. variant — designkortet der førte til valget (#5376)",
    "",
    "Historik, ikke en åben beslutning: kortet nedenfor er det ejeren valgte ud fra 18/9. Variant A er siden bygget som produktions-bånd (§8c); B og C er fravalgt og står her så begrundelsen kan læses igen.",
    "",
    `Dagens akademi-bånd plus de tre forslag, kørt gennem PRÆCIS samme \`drawYouthBirthAbilities\` som produktionen bruger, ved hver af de ${U23_BIRTH_AGES.length} U23-fødselsaldre. **Ejeren valgte A 18/9**; den lever nu som \`U23_BIRTH_BAND\` (§8c).`,
    "",
    `Aldrene kommer fra \`riderSeasonAge.js\` og er ikke frit valgte: U23 er sæson-alder < 23, så Graduation Day falder ved 23 og fødselsintervallet er ${U23_BIRTH_AGES[0]}-${U23_BIRTH_AGES[U23_BIRTH_AGES.length - 1]}. U25 (sæson-alder ≤ 25, UCI-reglen, ejer 2/9) rører ikke fødslen. Akademi-nedrykning gælder kun til og med ${ACADEMY_TOP_AGE} — derfor OVERLAPPER ${U23_BIRTH_AGES[0]}-${ACADEMY_TOP_AGE} akademiets eget interval, og det er dér en variant enten bevarer akademiets fordeling eller bevidst afviger fra den.`,
    "",
    "**Akademiets bånd røres ikke.** Hver variant er et nyt, afledt bånd; `YOUTH_BIRTH_BAND` og dets mætnings-invariant (G5, #3561/#2064 §2a) står uændret — også efter at A er vedtaget. Objekterne her er stadig kun målinger; produktionen læser `U23_BIRTH_BAND`.",
    "",
    u23VariantSummaryTable(U23_BAND_VARIANT_SPECS),
    "",
    ...(variantSweep
      ? [
          `${u23PerAge} træk pr. alder pr. variant, fordelt over alle arketyper og fire potentiale-trin (en signatur-evne får et boost oven i grundniveauet og rammer loftet først — måltes kun én arketype, ville mætningen se mildere ud end i en rigtig trup). Samme seed-familie pr. (alder, træk) på tværs af varianter, så rækkerne sammenlignes på de samme træk.`,
          "",
          "Den afgørende kolonne er **Δ median vs. året før**, ikke \"På loftet %\": står Δ på 0, er alderen holdt op med at betyde noget, uanset hvor pænt resten af rækken ser ud. \"På loftet %\" måles mod variantens EGET loft.",
          "",
          u23VariantTable(variantSweep),
          "",
        ]
      : [
          `**Måletabellen er ikke med.** Forslagenes præcise tal — loft, rampe, spredning — er balance-tal og ligger derfor i den gitignorerede \`${U23_TUNING_LABEL}\`, ikke i repoet (hard rule 17, #3436: repoet er offentligt læsbart). Filen blev ikke fundet, så kun kortets kvalitative side er renderet.`,
          "",
          `Opret den med felterne nedenfor — eller peg på en anden sti med \`--tuning=<sti>\` — og kør rapporten igen:`,
          "",
          table(
            ["Felt", "Betydning"],
            Object.entries(U23_TUNING_FIELDS).map(([field, meaning]) => [`\`${field}\``, meaning]),
          ),
          "",
        ]),
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
/** Streng heltals-parser: `Number()` slipper NaN, 0, brøker og Infinity igennem. */
export function positiveIntArg(raw, name, max = MAX_U23_PER_AGE) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`--${name} skal være et helt tal i [1,${max}] — fik "${raw}"`);
  }
  return n;
}

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
    // `--u23` er den ENE CLI-værdi der styrer en loop-grænse. Den parses
    // strengt her, så en tastefejl bliver en fejlbesked med det samme i
    // stedet for en tom eller uendelig kørsel.
    u23PerAge: positiveIntArg(get("u23", String(DEFAULT_U23_PER_AGE)), "u23"),
    // Sti til den gitignorerede kalibrerings-fil til §8d. Tallene må ikke ligge
    // i repoet (hard rule 17, #3436), så de kommer udefra.
    tuning: get("tuning", null),
    out: get("out", null),
  };
}

export function main(argv = process.argv.slice(2)) {
  const { seed, count, youthCount, referenceYear, u23PerAge, tuning, out } = parseArgs(argv);
  const adult = buildAdultCohort({ seed, count, referenceYear });
  const youth = buildYouthCohort({ seed, count: youthCount, referenceYear });
  // En UDPEGET sti der ikke findes er en tastefejl, ikke en normal tilstand:
  // den skal sige fra, ikke stille og roligt rendere kortet uden måletabel.
  let u23Tuning;
  if (tuning) {
    const path = resolve(process.cwd(), tuning);
    u23Tuning = loadU23Tuning({ path });
    if (!u23Tuning) throw new Error(`--tuning: filen findes ikke — ${path}`);
  } else {
    u23Tuning = loadU23Tuning();
  }
  const md = renderReport({ seed, count, referenceYear, adult, youth, u23PerAge, u23Tuning });
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
