// #5283 — CI-gaten for ryttergeneratoren (fødsel uden PCM, #5269).
//
// Ejer-krav 15/9 (ved merge-go på PR #5278): "Vi skal have lavet test inden
// naeste gang der laves nye ryttere, for at se at rytter generatoren virker
// ordentligt." Gaten ligger FØR U23-ryttere genereres til AI-holdene ved
// S4-cutover (GDD D-054 §10.4).
//
// Denne fil er MASKIN-halvdelen af den gate. ØJEN-halvdelen er
// `backend/scripts/generatorVisibleTest5283.js`, som skriver den fulde
// fordelings-rapport (docs/audits/2026-09-18-generator-1000.md). Arbejdsdelingen
// er bevidst:
//
//   rapporten  siger HVORDAN populationen ser ud — den kan ikke fejle
//   testen her siger HVAD der aldrig må ændre sig — den kan kun fejle
//
// Uden testen ville rapporten stille blive forældet: ingen ville opdage at en
// refaktor flyttede fordelingen, før nogen tilfældigt kørte scriptet igen.
//
// ── HVORFOR BÅNDENE ER BREDE ─────────────────────────────────────────────────
//
// Det er en REGRESSIONS-gate, ikke en kalibrerings-gate. Båndene er sat så de
// fanger en STRUKTUREL ændring (en evne der falder ud af registret, et anlæg
// der holder op med at være formet, en PCM-stat der sniger sig tilbage ind,
// en fødsels-markør der ikke persisteres) — ikke så de fanger en bevidst
// balance-justering på et par point. Stramme bånd på balance-tal ville gøre
// enhver ejer-godkendt justering til en rød test, og så bliver gaten det man
// slukker for i stedet for det man stoler på (samme lære som G1-gulvet i
// archetypeGenerationGates.test.js, sænket 85 → 18 → 35 fordi det målte den
// forkerte ting).
//
// Der hvor et præcist tal ER kontrakten (evne-interval, NULL-frihed,
// registrets fuldstændighed, determinisme), er gaten til gengæld hård.
//
// n = 400 med fast seed: stort nok til at arketype-andelene er stabile,
// lille nok til at hele filen kører på under et sekund i CI.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdultCohort,
  buildYouthCohort,
  recognitionRate,
  completenessReport,
  clampReport,
  percentile,
  describe as describeStats,
  REQUIRED_RECORD_FIELDS,
} from "../scripts/generatorVisibleTest5283.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { MENTAL_ABILITY_TAG_CEILING } from "./riderProgression.js";
import { ABILITY_FLOOR, ABILITY_CEIL } from "./riderBirthPriors.js";
import { STAT_KEYS, BIRTH_MODE_OWN_PRIORS } from "./fictionalRiderGenerator.js";

const SEED = 20260918;
const N = 400;
const YOUTH_N = 150;

const cohort = buildAdultCohort({ seed: SEED, count: N });
const rows = cohort.rows;
const youth = buildYouthCohort({ seed: SEED, count: YOUTH_N });

const share = (n) => (100 * n) / N;

test("#5283 kohorten er født ad own-priors-stien", () => {
  assert.equal(cohort.mode, BIRTH_MODE_OWN_PRIORS);
  assert.equal(rows.length, N);
});

// ── 1. Evne-intervallet ──────────────────────────────────────────────────────
// Hård kontrakt: DB-kolonnerne er smallint med en 1-99-forventning i hele
// visnings- og motorlaget. En evne uden for intervallet er en datafejl, ikke en
// balance-afvigelse.
test("#5283 ingen evne uden for [1,99], og alle er heltal", () => {
  for (const r of [...rows, ...youth]) {
    for (const key of REGISTRY_ABILITY_KEYS) {
      const v = r.abilities[key];
      assert.ok(
        Number.isInteger(v) && v >= ABILITY_FLOOR && v <= ABILITY_CEIL,
        `${r.id}: ${key} = ${v} (skal være et heltal i [${ABILITY_FLOOR},${ABILITY_CEIL}])`,
      );
    }
  }
});

// ── 2. Registret er sandheden om hvilke evner der findes ─────────────────────
// Forward-guard for HOWTO_ADD_ABILITY-kontrakten (RIDER_GENERATION.md §8b:
// "Tilføj aldrig en evne kun det ene sted"). Lander en ny evne i registret uden
// en prior, fejler denne test i stedet for at kuldet stille fødes uden den.
test("#5283 hver nyfødt har PRÆCIS registrets evner — hverken flere eller færre", () => {
  const expected = [...REGISTRY_ABILITY_KEYS].sort();
  for (const r of [rows[0], rows[N - 1], youth[0]]) {
    const got = Object.keys(r.abilities).filter((k) => k !== "hidden_potential").sort();
    assert.deepEqual(got, expected, `${r.id}: evne-sættet afviger fra registret`);
  }
});

// ── 3. Ingen PCM-stat må skrives ─────────────────────────────────────────────
// GDD D-053 (ejer 15/9, ordret): "Intet skal vaere vaegtet paa pcm stats mere."
// Et 0 er lige så galt som et tal: enhver kaldsted der summerer stats ville
// læse det som en ægte værdi (fictionalRiderGenerator.js' kommentar ved
// `const stats = ownPriors ? null : ...`).
test("#5283 own-priors-stien skriver ikke en eneste PCM-stat", () => {
  for (const r of rows) {
    for (const k of STAT_KEYS) {
      assert.equal(r.record[k], undefined, `${r.id}: ${k} er sat på own-priors-stien`);
    }
  }
});

// ── 4. Ingen NULL i påkrævede felter ─────────────────────────────────────────
test("#5283 ingen NULL/tomme værdier i de felter generatoren selv ejer", () => {
  const c = completenessReport(rows);
  assert.deepEqual([...c.missing.entries()], [], `manglende felter: ${[...c.missing.keys()].join(", ")}`);
  assert.equal(c.missingAbility, 0);
  assert.equal(c.statLeak, 0);
  assert.ok(REQUIRED_RECORD_FIELDS.length >= 9);
});

// ── 5. Fødsels-markøren SKAL persisteres ─────────────────────────────────────
// Uden den ville PCM-fallbacken udlede evne 1 af en NULL-stat ved næste
// heal-sweep og nulstille hele årgangen (RIDER_GENERATION.md §8b). Det er den
// enkeltfejl der kan koste et helt kuld, og den er usynlig indtil sweepet kører.
test("#5283 hver nyfødt bærer en gyldig fødsels-markør i archetype_draw.birth", () => {
  const c = completenessReport(rows);
  assert.equal(c.missingBirthMarker, 0);
  for (const r of rows.slice(0, 25)) {
    const birth = r.record._meta.archetypeDraw.birth;
    assert.equal(birth.v, 1);
    assert.ok(Number.isInteger(birth.seed) && birth.seed >= 0);
    assert.ok(Number.isInteger(birth.age), "fødsels-alderen skal med — ellers løfter en re-derive evnerne gratis");
    assert.ok(["superstar", "star", "solid", "domestique"].includes(birth.tier));
  }
});

// ── 6. Determinisme ──────────────────────────────────────────────────────────
// §1 i RIDER_GENERATION.md er en hard rule, fordi relaunch/replay skal kunne
// reproducere en population. Testen kører generatoren to gange med samme seed.
test("#5283 samme seed giver samme population", () => {
  const again = buildAdultCohort({ seed: SEED, count: 50 }).rows;
  const first = buildAdultCohort({ seed: SEED, count: 50 }).rows;
  for (let i = 0; i < 50; i++) {
    assert.equal(again[i].name, first[i].name);
    assert.deepEqual(again[i].abilities, first[i].abilities);
    assert.equal(again[i].base_value, first[i].base_value);
  }
});

test("#5283 en ANDEN seed giver en anden population", () => {
  const other = buildAdultCohort({ seed: SEED + 1, count: 50 }).rows;
  const same = other.filter((r, i) => r.name === rows[i].name).length;
  assert.ok(same < 5, `${same}/50 navne var ens på tværs af to seeds — understrømmene er sandsynligvis koblet`);
});

// ── 7. Arketype-andele inden for tolerance ───────────────────────────────────
// Ingen arketype må forsvinde, og ingen må æde populationen. Båndet [2 %, 35 %]
// er bevidst bredt: tier-vægtene er ejer-kalibrerede og flyttes med vilje, mens
// en arketype der rammer 0 eller 50 % altid er en fejl.
test("#5283 alle 8 arketyper er repræsenteret og ingen dominerer", () => {
  const counts = new Map();
  for (const r of rows) counts.set(r.drawPrimary, (counts.get(r.drawPrimary) ?? 0) + 1);
  assert.equal(counts.size, 8, `kun ${counts.size} arketyper trukket: ${[...counts.keys()].join(", ")}`);
  for (const [type, n] of counts) {
    const p = share(n);
    assert.ok(p >= 2 && p <= 35, `${type}: ${p.toFixed(1)} % (bånd 2-35 %)`);
  }
});

// ── 8. Anlægget skal være FORMET, ikke bare skrevet ned ──────────────────────
// Den endelige type er pr. konstruktion lig anlægget (resolveRiderTypes lader
// anlægget vinde, #3588), så den kan ikke måle noget. Klassifikatorens
// uafhængige gæt kan: falder genkendelses-raten, er signaturen udvandet.
// Gulvet 70 % ligger godt under det målte niveau (84,2 % ved n = 1.000) og
// fanger et strukturelt tab, ikke en justering.
test("#5283 klassifikatoren genfinder anlægget hos mindst 70 % af rytterne", () => {
  const { pct } = recognitionRate(rows);
  assert.ok(pct >= 70, `genkendelses-rate ${pct.toFixed(1)} % (gulv 70 %)`);
});

// Diagonalen: en sprinter SKAL sprinte bedre end resten af feltet, en klatrer
// klatre bedre, og så videre. Marginen er i dag 24-50 evne-point (målt over
// alle syv signaturer, n = 400); gulvet 15 ligger under den laveste og fanger
// derfor et TAB af signaturen, ikke en justering af den.
const SIGNATURE_MARGIN = 15;

test("#5283 hver arketypes signaturevne står klart over feltets median", () => {
  const signatureOf = {
    sprinter: "sprint",
    climber: "climbing",
    tt: "time_trial",
    puncheur: "punch",
    brostensrytter: "cobblestone",
    baroudeur: "aggression",
    gc: "climbing",
  };
  for (const [archetype, ability] of Object.entries(signatureOf)) {
    const sub = rows.filter((r) => r.drawPrimary === archetype);
    if (sub.length < 10) continue;
    const own = describeStats(sub.map((r) => r.abilities[ability])).median;
    const others = rows.filter((r) => r.drawPrimary !== archetype);
    const rest = describeStats(others.map((r) => r.abilities[ability])).median;
    assert.ok(
      own - rest >= SIGNATURE_MARGIN,
      `${archetype}: median ${ability} = ${own}, resten af feltet = ${rest} (margin ${own - rest}, gulv ${SIGNATURE_MARGIN}) — signaturen er udvandet`,
    );
  }
});

// ── 9. Lofterne for de mentale evner (D-056) ─────────────────────────────────
// `MENTAL_ABILITY_TAG_CEILING` er et VÆKST-loft i `youthAbilityCap`, ikke et
// fødsels-loft: en rytter KAN fødes over det (han kan bare ikke træne evnen
// videre). Gaten låser derfor ikke "aldrig over loftet" — det ville være
// forkert — men at andelen bliver lille, så loftet stadig betyder noget.
test("#5283 kun en lille andel fødes over de mentale lofter (D-056)", () => {
  for (const [ability, ceiling] of Object.entries(MENTAL_ABILITY_TAG_CEILING)) {
    const over = rows.filter((r) => r.abilities[ability] > ceiling).length;
    assert.ok(
      share(over) <= 10,
      `${ability}: ${share(over).toFixed(1)} % fødes over loftet ${ceiling} (loft 10 %)`,
    );
  }
});

// `aggression` har BEVIDST intet loft (#5297, GDD D-056): den er baroudeurens
// signaturevne, og et loft på 70 skar netop den signatur ned til
// håndværksniveau mens alle andre arketyper beholdt en uloftet signatur.
// Forward-guard mod at den sniger sig tilbage ind i tabellen.
test("#5283 aggression står uden for loft-tabellen (#5297)", () => {
  assert.equal(MENTAL_ABILITY_TAG_CEILING.aggression, undefined);
  assert.deepEqual(Object.keys(MENTAL_ABILITY_TAG_CEILING).sort(), ["leadership", "tactics", "teamwork"]);
});

// ── 10. De to alders-afvigelser (D-053 / D-030) ──────────────────────────────
// D-053: taktik og aggression må hverken bygge på alder eller på en anden evne.
// D-030/D-052: lederskab MÅ bruge alder, og topper sent.
// Målt som en korrelation med alderen over hele kohorten: leadership skal
// stige med alderen, tactics og aggression må ikke.
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

test("#5283 lederskab stiger med alderen, taktik og aggression gør ikke (D-053/D-030)", () => {
  const ages = rows.map((r) => r.age);
  const corr = (key) => pearson(ages, rows.map((r) => r.abilities[key]));
  // Målt: leadership 0,214 — tactics 0,057 — aggression 0,058 (n = 400, seed
  // 20260918). Bånd 0,12 / 0,15 ligger imellem de to grupper, så testen skiller
  // "har en alders-rampe" fra "har ingen" uden at låse rampens hældning.
  const lead = corr("leadership");
  assert.ok(lead > 0.12, `leadership/alder-korrelation ${lead.toFixed(3)} — alders-rampen (AGE_CURVED) mangler`);
  for (const key of ["tactics", "aggression"]) {
    const c = corr(key);
    assert.ok(Math.abs(c) < 0.15, `${key}/alder-korrelation ${c.toFixed(3)} — D-053 siger ingen alders-kobling`);
  }
});

// ── 11. Fordelingen er spredt, ikke klippet ──────────────────────────────────
// Gulv-andelen er i dag 13,8 % (n = 1.000) og er en ARVET egenskab fra
// domestique-tierens niveau (evne 9, sd 9,8 — spejlingen af PCM-stien). Den er
// dokumenteret som et fund i rapporten, ikke rettet her. Loftet 25 % fanger en
// FORVÆRRING: falder hele populationen mod gulvet, er spredningen væk og to
// forskellige ryttere bliver det samme tal.
test("#5283 fordelingen kollapser ikke mod gulvet", () => {
  const { floor, ceil, total } = clampReport(rows);
  assert.ok((100 * floor) / total <= 25, `${((100 * floor) / total).toFixed(1)} % af evnerne på gulvet (loft 25 %)`);
  assert.ok((100 * ceil) / total <= 2, `${((100 * ceil) / total).toFixed(1)} % af evnerne på loftet (loft 2 %)`);
});

test("#5283 spændet mellem p10 og p90 er reelt for de fysiske signaturevner", () => {
  for (const key of ["climbing", "sprint", "time_trial", "flat"]) {
    const s = describeStats(rows.map((r) => r.abilities[key]));
    assert.ok(s.p90 - s.p10 >= 20, `${key}: p90−p10 = ${s.p90 - s.p10} (gulv 20)`);
  }
});

// ── 12. Alder og potentiale ──────────────────────────────────────────────────
test("#5283 alders- og potentiale-fordelingen holder sig i spillets bånd", () => {
  const ages = describeStats(rows.map((r) => r.age));
  assert.ok(ages.min >= 16 && ages.max <= 45, `alder ${ages.min}-${ages.max}`);
  assert.ok(ages.median >= 24 && ages.median <= 31, `median-alder ${ages.median}`);
  const pots = describeStats(rows.map((r) => r.potentiale));
  assert.ok(pots.min >= 1 && pots.max <= 6, `potentiale ${pots.min}-${pots.max}`);
});

// ── 13. Ungdomsbåndet ────────────────────────────────────────────────────────
// G5-invarianten (#3561/#2064 §2a): en ungdomsrytters NUVÆRENDE evne må aldrig
// løfte `ability_caps` over det loft hans potentiale tillader. Konkret betyder
// det at ungdoms-evnerne mætter lavt. Testen låser mætningen — og dermed også
// det fund rapporten beskriver: båndet er kalibreret til akademiet (16-21) og
// er allerede mættet ved U23-aldrene (D-054 §10.4).
test("#5283 ungdomsbåndet mætter lavt (G5-invarianten)", () => {
  const all = [];
  for (const r of youth) for (const key of REGISTRY_ABILITY_KEYS) all.push(r.abilities[key]);
  const sorted = all.slice().sort((a, b) => a - b);
  assert.ok(Math.max(...all) <= 20, `ungdoms-max ${Math.max(...all)} (loft 20)`);
  assert.ok(percentile(sorted, 0.5) <= 12, `ungdoms-median ${percentile(sorted, 0.5)}`);
});

// ── 14. Værdikæden skal give et tal ──────────────────────────────────────────
// En rytter uden `base_value` er usælgelig og usynlig på markedet. V4-kæden
// skal give et positivt tal for hver eneste nyfødt.
test("#5283 hver nyfødt prissættes af V4-kæden", () => {
  for (const r of rows) {
    assert.ok(Number.isFinite(r.base_value) && r.base_value > 0, `${r.id}: base_value = ${r.base_value}`);
  }
  const byTier = (t) => describeStats(rows.filter((r) => r.tier === t).map((r) => r.base_value));
  // Ordenen mellem tiers er selve pointen med tier-inddelingen; de konkrete
  // beløb er balance og låses IKKE her.
  assert.ok(byTier("superstar").median > byTier("star").median);
  assert.ok(byTier("star").median > byTier("solid").median);
  assert.ok(byTier("solid").median > byTier("domestique").median);
});
