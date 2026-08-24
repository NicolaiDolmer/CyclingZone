import test from "node:test";
import assert from "node:assert/strict";

import {
  generateFictionalRiders,
  makeRng,
  STAT_KEYS,
  toInsertPayload,
  DEFAULT_TIER_FRACTIONS,
  DEFAULT_TIER_TYPE_WEIGHTS,
  ARCHETYPES,
  ARCHETYPE_BY_TYPE,
  scaleMinTypes,
  SECONDARY_SIGNATURE_WEIGHT,
} from "./fictionalRiderGenerator.js";
import { foldNameNordic } from "./pcmRiderMatcher.js";
import { NAME_CLUSTERS } from "./fictionalRiderNames.js";
import { drawArchetypePair, DEFAULT_DISTRIBUTION, ARCHETYPE_TYPES } from "./archetypeDistribution.js";

const REF_YEAR = 2026;
const FORBIDDEN_FIELDS = ["id", "price", "market_value", "salary", "team_id", "ai_team_id", "prize_earnings_bonus"];

function gen(opts = {}) {
  return generateFictionalRiders({ seed: 42, count: 100, referenceYear: REF_YEAR, ...opts });
}

// ── Determinisme ──────────────────────────────────────────────────────────────

test("samme seed → identisk output (determinisme)", () => {
  const a = gen();
  const b = gen();
  assert.deepEqual(a.riders, b.riders);
});

test("forskellig seed → forskelligt output", () => {
  const a = gen({ seed: 1 });
  const b = gen({ seed: 2 });
  assert.notDeepEqual(a.riders, b.riders);
});

test("makeRng er deterministisk og i [0,1)", () => {
  const r1 = makeRng(7);
  const r2 = makeRng(7);
  for (let i = 0; i < 50; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

// ── Kontrakt: hvad må/ikke må sættes ──────────────────────────────────────────

test("count respekteres", () => {
  assert.equal(gen({ count: 37 }).riders.length, 37);
});

test("pcm_id er ALTID null (egen-rytter-markør)", () => {
  for (const r of gen().riders) assert.equal(r.pcm_id, null);
});

test("generated-/auto-kolonner sættes ALDRIG", () => {
  for (const r of gen().riders) {
    for (const f of FORBIDDEN_FIELDS) {
      assert.equal(r[f], undefined, `feltet ${f} må ikke være sat`);
    }
  }
});

test("NOT NULL-felter er udfyldt", () => {
  for (const r of gen().riders) {
    assert.equal(typeof r.firstname, "string");
    assert.ok(r.firstname.length > 0);
    assert.equal(typeof r.lastname, "string");
    assert.ok(r.lastname.length > 0);
  }
});

// ── Feltværdier ───────────────────────────────────────────────────────────────

test("nationality_code er gyldig ISO2 (to store bogstaver)", () => {
  for (const r of gen().riders) assert.match(r.nationality_code, /^[A-Z]{2}$/);
});

test("alle 14 stats til stede som heltal i [50,85] (ægte PCM-skala)", () => {
  for (const r of gen().riders) {
    for (const key of STAT_KEYS) {
      assert.equal(typeof r[key], "number");
      assert.ok(Number.isInteger(r[key]), `${key} skal være heltal`);
      assert.ok(r[key] >= 50 && r[key] <= 85, `${key}=${r[key]} uden for [50,85]`);
    }
  }
});

// Forward-guard (#1122): den ægte PCM-skala er HÅRDT [50,85]; en fiktiv stat
// udenfor ville clampe evnerne til 1/99 ved kilden (abilityDerivation.js). Stor
// N fanger sjældne gaussiske haler som en 100-rytter-batch kan misse.
test("stat-skala holder [50,85] over stor population (forward-guard)", () => {
  const { riders } = generateFictionalRiders({ seed: 999, count: 3000, referenceYear: REF_YEAR });
  let min = Infinity;
  let max = -Infinity;
  for (const r of riders) {
    for (const key of STAT_KEYS) {
      if (r[key] < min) min = r[key];
      if (r[key] > max) max = r[key];
    }
  }
  assert.ok(min >= 50, `mindste stat ${min} < 50`);
  assert.ok(max <= 85, `største stat ${max} > 85`);
});

test("birthdate er YYYY-MM-DD og is_u25 er konsistent", () => {
  for (const r of gen().riders) {
    assert.match(r.birthdate, /^\d{4}-\d{2}-\d{2}$/);
    const birthYear = Number(r.birthdate.slice(0, 4));
    assert.equal(r.is_u25, birthYear > REF_YEAR - 25);
    const age = REF_YEAR - birthYear;
    assert.ok(age >= 18 && age <= 39, `urealistisk alder ${age}`);
  }
});

test("potentiale er 0.5-trin i [1.0, 6.0]", () => {
  for (const r of gen().riders) {
    assert.ok(r.potentiale >= 1.0 && r.potentiale <= 6.0);
    assert.equal((r.potentiale * 2) % 1, 0, "skal være multiplum af 0.5");
  }
});

test("height/weight er realistiske og uci_points >= 1", () => {
  for (const r of gen().riders) {
    assert.ok(r.height >= 165 && r.height <= 196);
    assert.ok(r.weight >= 50 && r.weight <= 100);
    assert.ok(r.uci_points >= 1);
  }
});

// ── Navne-unikhed (§3-fælden) ─────────────────────────────────────────────────

test("genererede navne er internt unikke (foldet)", () => {
  const { riders } = gen({ count: 200 });
  const folded = riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`));
  assert.equal(new Set(folded).size, folded.length, "fandt foldede navne-dubletter");
});

test("respekterer existingFoldedNames — ingen kollision med 'eksisterende' DB-navne", () => {
  const first = gen({ seed: 11, count: 100 });
  const existing = new Set(
    first.riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)),
  );
  // #3416: settet MUTERES af kaldet — assert mod et frosset snapshot af FØR-tilstanden.
  const preExisting = new Set(existing);
  const second = gen({ seed: 22, count: 100, existingFoldedNames: existing });
  for (const r of second.riders) {
    const key = foldNameNordic(`${r.firstname} ${r.lastname}`);
    assert.ok(!preExisting.has(key), `kolliderede med eksisterende navn: ${key}`);
  }
});

test("#3416-regression: to kald der DELER samme set giver aldrig overlappende navne (kerne+hale-mønstret)", () => {
  // Præcis buildWeakStarterPool-mønstret fra aiTeamGenerator/starterSquadAllocator:
  // to separate kald (kerne, hale) med SAMME set-instans. Før fixet kopierede
  // generatoren settet, så halen ikke kendte kernens navne — prod endte med 21 hold
  // med navne-dubletter, som væltede rytter-sletning (race_results_entrant_unique).
  const shared = new Set();
  const core = gen({ seed: 31, count: 80, existingFoldedNames: shared });
  const tail = gen({ seed: 32, count: 80, existingFoldedNames: shared });
  const coreNames = new Set(core.riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));
  for (const r of tail.riders) {
    const key = foldNameNordic(`${r.firstname} ${r.lastname}`);
    assert.ok(!coreNames.has(key), `hale-kaldet genbrugte kernens navn: ${key}`);
  }
  // Og settet er akkumuleret (kontrakten som kaldsstederne hviler på).
  assert.ok(shared.size >= 160, "det delte set skal indeholde begge kalds navne");
});

// ── Garanteret nationalitets-repræsentation ───────────────────────────────────

test("garanterede ikke-vestlige nationer er repræsenteret", () => {
  const { riders } = gen({ count: 60 });
  const nats = new Set(riders.map((r) => r.nationality_code));
  for (const iso of ["CN", "JP", "KR", "CO", "DZ", "ER"]) {
    assert.ok(nats.has(iso), `mangler garanteret nation ${iso}`);
  }
});

// ── Arketype ↔ stats korrelerer ───────────────────────────────────────────────

test("arketyper booster signatur-stats over andre arketyper (aggregeret)", () => {
  const { riders } = generateFictionalRiders({ seed: 5, count: 800, referenceYear: REF_YEAR });
  const avg = (archetype, key) => {
    const subset = riders.filter((r) => r._meta.archetype === archetype);
    return subset.reduce((s, r) => s + r[key], 0) / subset.length;
  };
  assert.ok(avg("sprinter", "stat_sp") > avg("climber", "stat_sp") + 5);
  assert.ok(avg("climber", "stat_bj") > avg("sprinter", "stat_bj") + 5);
  assert.ok(avg("tt", "stat_tt") > avg("sprinter", "stat_tt") + 5);
  assert.ok(avg("brostensrytter", "stat_bro") > avg("climber", "stat_bro") + 5);
});

// Rolle-svaghed ON (ejer-beslutning): off-type-stats dæmpes, så typen bliver skarp.
test("rolle-svagheder dæmper off-type-stats (signatur ≫ dæmpet)", () => {
  const { riders } = generateFictionalRiders({ seed: 5, count: 800, referenceYear: REF_YEAR });
  const avg = (archetype, key) => {
    const subset = riders.filter((r) => r._meta.archetype === archetype);
    return subset.reduce((s, r) => s + r[key], 0) / subset.length;
  };
  // climber dæmper stat_sp (sprint) → klart under dens boostede stat_bj (bjerg).
  assert.ok(avg("climber", "stat_bj") > avg("climber", "stat_sp") + 10);
  // sprinter dæmper stat_bj → klart under dens boostede stat_sp.
  assert.ok(avg("sprinter", "stat_sp") > avg("sprinter", "stat_bj") + 10);
});

// ── Tier-kvote (eksakt — løser star-rate-punktet) ─────────────────────────────

test("tier-kvote er eksakt ved launch-skala (12/60/230/498 @ 800)", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const byTier = {};
  for (const r of riders) byTier[r._meta.tier] = (byTier[r._meta.tier] || 0) + 1;
  assert.equal(byTier.superstar, 12);
  assert.equal(byTier.star, 60);
  assert.equal(byTier.solid, 230);
  assert.equal(byTier.domestique, 498);
});

test("tier-kvote summerer altid til count (også ved skæve tal)", () => {
  for (const count of [37, 113, 500, 1234]) {
    const { riders } = generateFictionalRiders({ seed: 3, count, referenceYear: REF_YEAR });
    const total = riders.length;
    assert.equal(total, count);
    const tiers = new Set(riders.map((r) => r._meta.tier));
    assert.ok(tiers.has("domestique"), "domestique-tier (rest) skal altid findes");
  }
});

// ── Type-gulv på sjældne typer (etape-variation) ──────────────────────────────

test("sjældne typer holder globalt gulv (gc≥30, sprinter≥40 @ 800)", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const byType = {};
  for (const r of riders) byType[r._meta.archetype] = (byType[r._meta.archetype] || 0) + 1;
  assert.ok(byType.gc >= 30, `gc=${byType.gc} under gulv 30`);
  assert.ok(byType.sprinter >= 40, `sprinter=${byType.sprinter} under gulv 40`);
  // Alle 8 typer skal være repræsenteret (dybde i hver disciplin).
  for (const t of ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"]) {
    assert.ok((byType[t] || 0) > 0, `type ${t} mangler helt`);
  }
});

// ── #3570/S2: gulvet skalerer med count (små træk må ikke degenerere) ─────────
//
// REGRESSIONSVAGT FOR EN LIVE BUG. Gulvene (gc≥30, sprinter≥40) er kalibreret mod
// et 800-rytter-felt, men blev håndhævet som absolutte tal pr. generator-kald.
// Trup-stierne kalder generatoren med count 4/8/16 (#1560, #1820, #2065), og der
// promoverede gulvet HELE trækket: 100 % sprinter+gc, 0 af de øvrige seks
// arketyper. Hver ny manager fik en start-trup trukket som 73 % sprinter / 27 % gc.
//
// Grænserne herunder er PRÆREGISTRERET før måling (S2/PREREG.md):
//   • distinkte arketyper pr. træk ≥ 88 % af det ANALYTISKE optimum for netop
//     det count, Σ_t (1−(1−p_t)^count) under ejerens knaphedsmål. Ved count=8
//     giver formlen 5,14 → port 4,52 (præcis den præregistrerede 4,50); ved
//     count=4 er optimum 3,27 → port 2,88 (mere end 4 distinkte KAN ikke findes
//     i et træk på 4, så en fast port ville være matematisk umulig).
//   • alle 8 arketyper med andel ≥ 3,0 % poolet (ejerens laveste mål er 9 %).
//   • L1 mod knaphedsmålene ≤ 40 pp (count=800 ligger på ~22 — porten er ~2×).
// Dagens (pre-fix) kode: count=4 → 1,82 distinkte · count=8 → 1,99 · count=16 →
// 2,00, i alle tre tilfælde 6 arketyper på 0 % og L1 152.

const SCARCITY_TARGET = {
  sprinter: 15, tt: 9, climber: 17, puncheur: 13,
  brostensrytter: 9, baroudeur: 11, rouleur: 17, gc: 9,
};
const S2_GATES = { distinctFraction: 0.88, minSharePct: 3.0, maxL1: 40 };

// Forventet antal DISTINKTE arketyper i et træk på `count`, hvis trækket fulgte
// ejerens knaphedsmål perfekt. Ren sandsynlighedsregning — ingen måling.
function targetExpectedDistinct(count) {
  return Object.values(SCARCITY_TARGET)
    .reduce((s, target) => s + (1 - (1 - target / 100) ** count), 0);
}

function archetypeDrawStats(count, calls) {
  const pooled = {};
  let n = 0;
  let distinctSum = 0;
  for (let k = 0; k < calls; k++) {
    const { riders } = generateFictionalRiders({ seed: (2026 + k * 7919) >>> 0, count, referenceYear: REF_YEAR });
    const arch = riders.map((r) => r._meta.archetype);
    for (const a of arch) pooled[a] = (pooled[a] || 0) + 1;
    n += arch.length;
    distinctSum += new Set(arch).size;
  }
  const share = {};
  let l1 = 0;
  for (const t of Object.keys(SCARCITY_TARGET)) {
    share[t] = (100 * (pooled[t] || 0)) / n;
    l1 += Math.abs(share[t] - SCARCITY_TARGET[t]);
  }
  return { share, l1, meanDistinct: distinctSum / calls };
}

function assertS2Gates(label, count, stats, { coverageFloors = {} } = {}) {
  const floor = S2_GATES.distinctFraction * targetExpectedDistinct(count);
  assert.ok(
    stats.meanDistinct >= floor,
    `${label}: kun ${stats.meanDistinct.toFixed(2)} distinkte arketyper i snit pr. træk (port ${floor.toFixed(2)})`,
  );
  for (const [t, s] of Object.entries(stats.share)) {
    const gate = coverageFloors[t] ?? S2_GATES.minSharePct;
    assert.ok(
      s >= gate,
      `${label}: arketypen '${t}' fylder kun ${s.toFixed(2)} % (port ${gate} %)`,
    );
  }
  assert.ok(
    stats.l1 <= S2_GATES.maxL1,
    `${label}: L1 mod knaphedsmålene er ${stats.l1.toFixed(1)} pp (port ${S2_GATES.maxL1})`,
  );
}

test("#3570/S2 DEFEKT-VAGT: count=8 (ny managers kerne-trup) degenererer ikke", () => {
  assertS2Gates("count=8", 8, archetypeDrawStats(8, 600));
});

// DOKUMENTERET UNDTAGELSE (S2, 10/8): den fulde dæknings-port (alle 8 arketyper
// ≥ 3 %) er MATEMATISK UOPNÅELIG ved count=4 for enhver kandidat der respekterer
// tier-koblingen. Tier-kvoten ved count=4 er {solid: 1, domestique: 3}, og `gc`
// findes kun i superstar/star/solid-vægtene → gc's STRUKTURELLE loft er
// 1 × (2/22) / 4 = 2,27 %. Målt: 2,29 % (= 101 % af loftet). Porten sættes derfor
// for gc til 88 % af det strukturelle loft (2,0 %), præcis samme 0,88-princip som
// distinkt-porten. Kun en kandidat der DROPPER tier-koblingen kan nå 3 % — og den
// ændrer relaunch-populationen, hvilket ikke er tilladt. Se S2/RAPPORT-S2.md.
test("#3570/S2 DEFEKT-VAGT: count=4 (hale-puljen) degenererer ikke", () => {
  assertS2Gates("count=4", 4, archetypeDrawStats(4, 1200), { coverageFloors: { gc: 2.0 } });
});

test("#3570/S2 DEFEKT-VAGT: count=16 (AI-holdenes hale) degenererer ikke", () => {
  assertS2Gates("count=16", 16, archetypeDrawStats(16, 400));
});

test("#3570/S2 SUND REFERENCE: samme porte består ved count=800", () => {
  // Beviser at porten ikke bare er 'alt fejler' — den kalibrerede sti passerer.
  assertS2Gates("count=800", 800, archetypeDrawStats(800, 8));
});

test("#3570/S2: skaleringen er identitet ved kalibrerings-referencen (800)", () => {
  assert.deepEqual(scaleMinTypes(800), { gc: 30, sprinter: 40 });
  // Under ~13 ryttere runder begge gulve til 0 → intet gulv håndhæves.
  assert.deepEqual(scaleMinTypes(8), {});
  assert.deepEqual(scaleMinTypes(4), {});
  // Halvt felt → halve gulve.
  assert.deepEqual(scaleMinTypes(400), { gc: 15, sprinter: 20 });
});

// ── Coverage-rapport ──────────────────────────────────────────────────────────

test("coverage rapporterer cluster-fordeling og evt. fallback", () => {
  const { coverage } = gen({ count: 100 });
  const totalByCluster = Object.values(coverage.byCluster).reduce((s, n) => s + n, 0);
  assert.equal(totalByCluster, 100);
  assert.equal(typeof coverage.fallbackNationalities, "object");
});

// ── A3: Arketype-skæv fysiologi på hver rytter (#1122) ───────────────────────

test("#1122 hver rytter får en arketype-konsistent _meta.physiology (deterministisk)", () => {
  const a = generateFictionalRiders({ seed: 2026, count: 60, referenceYear: 2026 });
  const b = generateFictionalRiders({ seed: 2026, count: 60, referenceYear: 2026 });
  assert.deepEqual(a.riders.map((r) => r._meta.physiology), b.riders.map((r) => r._meta.physiology));
  for (const r of a.riders) {
    assert.ok(r._meta.physiology && Number.isFinite(r._meta.physiology.ftp_wkg), `mangler physiology for ${r._meta.archetype}`);
    assert.ok(Number.isFinite(r._meta.physiology.aero), "mangler aero-metric");
  }
});

test("#1122 climber-arketyper har i snit højere ftp_wkg end sprinter-arketyper", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: 2026 });
  const avg = (type) => {
    const xs = riders.filter((r) => r._meta.archetype === type).map((r) => r._meta.physiology.ftp_wkg);
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  assert.ok(avg("climber") > avg("sprinter"), `climber ftp_wkg ${avg("climber").toFixed(2)} ikke > sprinter ${avg("sprinter").toFixed(2)}`);
});

test("#1122 _meta.physiology fjernes af toInsertPayload (ikke en riders-kolonne)", () => {
  const { riders } = generateFictionalRiders({ seed: 1, count: 5, referenceYear: 2026 });
  for (const row of toInsertPayload(riders)) {
    assert.ok(!("physiology" in row) && !("_meta" in row), "physiology/_meta lækkede ind i INSERT-payload");
  }
});

// ── #3606: anlægget overlever ind i INSERT-payloaden ──────────────────────────
// Generatoren trækker en arketype og former hele rytteren efter den; før #3606
// blev trækket kastet væk af toInsertPayload, så klassifikatoren måtte gætte typen
// bagefter — rodårsagen bag #3570. Testene fejler UDEN rettelsen (payloaden havde
// slet ingen archetype_draw).

test("#3606 toInsertPayload bærer det TRUKNE anlæg som archetype_draw", () => {
  const { riders } = generateFictionalRiders({ seed: 4242, count: 60, referenceYear: REF_YEAR });
  const payload = toInsertPayload(riders);
  assert.equal(payload.length, riders.length);
  for (let i = 0; i < payload.length; i++) {
    const draw = payload[i].archetype_draw;
    assert.ok(draw, `rytter ${i} mangler archetype_draw i INSERT-payloaden`);
    assert.equal(
      draw.primary, riders[i]._meta.archetype,
      "det persisterede anlæg skal være DET TRUKNE, ikke et gæt",
    );
    assert.ok(ARCHETYPE_BY_TYPE[draw.primary], `ukendt arketype '${draw.primary}'`);
  }
});

test("#3606 anlæggets form matcher akademi-stiens præcist (primary/secondary)", () => {
  // academyGenerator.js' drawArchetypePair er SSOT for formen; academyIntake.js
  // skriver dens retur direkte til archetype_draw. Voksen-generatoren skal skrive
  // NØJAGTIG samme nøglesæt, ellers læser resolveRiderTypes/caps-kæden to former.
  const academyShape = drawArchetypePair(makeRng(7));
  const { riders } = generateFictionalRiders({ seed: 99, count: 40, referenceYear: REF_YEAR });
  for (const row of toInsertPayload(riders)) {
    assert.deepEqual(
      Object.keys(row.archetype_draw).sort(), Object.keys(academyShape).sort(),
      "archetype_draw's nøglesæt afviger fra akademi-stiens",
    );
    // #3634: sekundæren er ikke længere null — kroppen formes nu efter BEGGE
    // anlæg (blendArchetypeShape), så der ER en anden arketype at persistere.
    assert.ok(
      ARCHETYPE_BY_TYPE[row.archetype_draw.secondary],
      `ukendt sekundær arketype '${row.archetype_draw.secondary}'`,
    );
    assert.notEqual(row.archetype_draw.secondary, row.archetype_draw.primary);
  }
});

// ── #3634: voksen-stiens anlæg er FULDT (den lækage der fyldte 24 ryttere/døgn) ──
//
// Indtil 16/8 skrev generatoren `secondary: null`. Klassifikatoren udfyldte
// `riders.secondary_type` alligevel, så kolonnen var aldrig NULL — det korrekte
// mål er `archetype_draw->>'secondary'`. 72 ryttere blev født uden anker på tre
// døgn, alle via startholds-stien til nye menneskeejede hold. Samme rod driver
// #3631's skævhed: gættet trak mod alrounder-stats (rouleur 29,5 % + sprinter
// 24,2 % = 53,7 % mod tilsigtet 30,3 %).
//
// 100 %, ingen tolerance — nøjagtig samme invariant akademi-stien fik i #3632.

test("#3634-invariant: ALLE voksen-genererede ryttere fødes med en sekundær ≠ primær", () => {
  const { riders } = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const uden = riders.filter((r) => {
    const d = r._meta.archetypeDraw;
    return !d?.secondary || d.secondary === d.primary;
  });
  assert.equal(
    uden.length, 0,
    `${uden.length}/${riders.length} ryttere født uden gyldigt sekundært anlæg ` +
    `(fx ${JSON.stringify(uden[0]?._meta?.archetypeDraw)}) — se #3634`,
  );
});

test("#3634-invariant: gælder også de SMÅ træk (start-trup count=8, AI-hale count=4)", () => {
  // Den faktiske lækage-sti: buildWeakStarterPool kalder med count 4/8, ikke 800.
  // Gulv-håndhævelsen (ENSURE_MIN_TYPES) kan overskrive en primær type EFTER
  // trækket, så sekundæren skal trækkes bagefter — ellers kan de to falde sammen.
  for (const count of [4, 8, 16]) {
    for (let seed = 1; seed <= 50; seed++) {
      const { riders } = generateFictionalRiders({ seed, count, referenceYear: REF_YEAR });
      for (const r of riders) {
        const d = r._meta.archetypeDraw;
        assert.ok(d?.secondary, `count=${count} seed=${seed}: rytter uden sekundær`);
        assert.notEqual(d.secondary, d.primary, `count=${count} seed=${seed}: sekundær = primær`);
      }
    }
  }
});

// #3631: sekundæren trækkes fra DEFAULT_DISTRIBUTION (samme kilde som akademiet),
// ikke af klassifikator-gættet. Målt i prod FØR fixet: sprinter 33,7 % / rouleur
// 24,8 % i toppen mod brostensrytter 3,1 % i bunden — en faktor 11. Porten her er
// et BÅND, ikke et punkt: fordelingen er betinget af "≠ primær" og renormaliseret,
// så den kan ikke ramme DEFAULT_DISTRIBUTION eksakt.
test("#3631: sekundær-fordelingen følger DEFAULT_DISTRIBUTION (ingen type under 3 % eller over 20 %)", () => {
  const pooled = {};
  let n = 0;
  for (let k = 0; k < 400; k++) {
    const { riders } = generateFictionalRiders({ seed: (2026 + k * 7919) >>> 0, count: 8, referenceYear: REF_YEAR });
    for (const r of riders) {
      pooled[r._meta.archetypeDraw.secondary] = (pooled[r._meta.archetypeDraw.secondary] || 0) + 1;
      n++;
    }
  }
  let l1 = 0;
  for (const t of ARCHETYPE_TYPES) {
    const pct = (100 * (pooled[t] || 0)) / n;
    l1 += Math.abs(pct - DEFAULT_DISTRIBUTION[t]);
    assert.ok(pct >= 3, `sekundær '${t}' fylder kun ${pct.toFixed(2)} % (port 3 %; prod før fixet: brostensrytter 3,1 %)`);
    assert.ok(pct <= 20, `sekundær '${t}' fylder ${pct.toFixed(2)} % (port 20 %; prod før fixet: sprinter 33,7 %)`);
  }
  assert.ok(l1 <= 8, `L1 mod DEFAULT_DISTRIBUTION er ${l1.toFixed(1)} pp (port 8 pp)`);
});

// FORWARD-GUARD for vægten. `SECONDARY_SIGNATURE_WEIGHT` er MÅLT til det højeste
// tal der holder alle seks separations-gates positive på HVER af 40 målte seeds
// (0,15 fejlede 1/40, 0,20 fejlede 14/40 — se konstantens kommentar). Gaten her
// måler den bindende margin direkte, så en hævet vægt fejler med det samme i
// stedet for at bide i en tilfældig seed senere.
test("#3634 forward-guard: bi-type-vægten æder ikke rolle-svagheden (bindende margin > 0 på flere seeds)", () => {
  const SEPARATIONER = [
    ["sprinter", "stat_sp", "sprinter", "stat_bj", 10],
    ["climber", "stat_bj", "climber", "stat_sp", 10],
    ["sprinter", "stat_sp", "climber", "stat_sp", 5],
    ["climber", "stat_bj", "sprinter", "stat_bj", 5],
  ];
  for (const seed of [5, 17, 2026]) {
    const { riders } = generateFictionalRiders({ seed, count: 800, referenceYear: REF_YEAR });
    const avg = (arche, key) => {
      const sub = riders.filter((r) => r._meta.archetype === arche);
      return sub.reduce((s, r) => s + r[key], 0) / sub.length;
    };
    for (const [aType, aKey, bType, bKey, krav] of SEPARATIONER) {
      const margin = avg(aType, aKey) - avg(bType, bKey) - krav;
      assert.ok(
        margin > 0,
        `seed ${seed}: ${aType}.${aKey} − ${bType}.${bKey} har margin ${margin.toFixed(2)} mod kravet +${krav}. ` +
        `Er SECONDARY_SIGNATURE_WEIGHT (${SECONDARY_SIGNATURE_WEIGHT}) hævet? Kør scripts/simSecondaryArchetype3634.js først — se #3634.`,
      );
    }
  }
});

// Negativ-test (designprincip: en gate skal kunne SE forskellen den bevogter).
// Vægten skal faktisk forme kroppen — er optionen tavst ignoreret, er hele
// #3634-rettelsen reduceret til at skrive en løsrevet sekundær ind i anlægget,
// præcis det issuet advarer imod ("et evne-loft i en retning kroppen ikke peger").
test("#3634 NEGATIV-TEST: secondarySignatureWeight former faktisk statsene", () => {
  const uden = generateFictionalRiders({ seed: 5, count: 400, referenceYear: REF_YEAR, secondarySignatureWeight: 0 });
  const med = generateFictionalRiders({ seed: 5, count: 400, referenceYear: REF_YEAR, secondarySignatureWeight: 0.5 });
  // Anlægget er det SAMME (sekundæren trækkes fra en egen rng-understrøm), så
  // enhver forskel i statsene kommer fra vægten alene.
  assert.deepEqual(
    med.riders.map((r) => r._meta.archetypeDraw), uden.riders.map((r) => r._meta.archetypeDraw),
    "vægten må ikke ændre selve trækket — kun hvordan kroppen formes efter det",
  );
  const forskelle = med.riders.filter((r, i) => STAT_KEYS.some((k) => r[k] !== uden.riders[i][k]));
  assert.ok(
    forskelle.length > med.riders.length * 0.5,
    `kun ${forskelle.length}/${med.riders.length} ryttere fik andre stats af vægten — er optionen ignoreret?`,
  );
});

test("#3606 kaldere med et _meta UDEN archetypeDraw er uændrede (bagudkompatibel)", () => {
  const [row] = toInsertPayload([{ firstname: "A", lastname: "B", _meta: { age: 23 } }]);
  assert.ok(!("archetype_draw" in row), "må ikke opfinde et anlæg der aldrig blev trukket");
  assert.ok(!("_meta" in row));
});

// ── Komposition-override (#1420 mix-presets) ──────────────────────────────────
// generateFictionalRiders skal kunne tage tierFractions + tierTypeWeights, så
// dev-tooling kan variere feltets blanding. Default (ingen override) = uændret.

const countByArchetype = (riders) => {
  const by = {};
  for (const r of riders) by[r._meta.archetype] = (by[r._meta.archetype] || 0) + 1;
  return by;
};
const countByTier = (riders) => {
  const by = {};
  for (const r of riders) by[r._meta.tier] = (by[r._meta.tier] || 0) + 1;
  return by;
};

test("default-konstanter er eksporteret med forventet form", () => {
  // Brugt af presets-modulet til at bygge skews oven på.
  assert.equal(typeof DEFAULT_TIER_FRACTIONS.superstar, "number");
  assert.equal(DEFAULT_TIER_FRACTIONS.superstar, 12 / 800);
  assert.equal(DEFAULT_TIER_FRACTIONS.star, 60 / 800);
  assert.equal(DEFAULT_TIER_FRACTIONS.solid, 230 / 800);
  assert.equal(DEFAULT_TIER_FRACTIONS.domestique, undefined, "domestique er rest, ikke en fraktion");
  assert.ok(DEFAULT_TIER_TYPE_WEIGHTS.superstar, "tier-type-vægte eksporteret");
  assert.equal(typeof DEFAULT_TIER_TYPE_WEIGHTS.superstar.gc, "number");
});

test("eksplicit default-override === ingen override (byte-identisk determinisme)", () => {
  const plain = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const explicit = generateFictionalRiders({
    seed: 2026, count: 800, referenceYear: REF_YEAR,
    tierFractions: DEFAULT_TIER_FRACTIONS,
    tierTypeWeights: DEFAULT_TIER_TYPE_WEIGHTS,
  });
  assert.deepEqual(explicit.riders, plain.riders);
});

test("skewet tierTypeWeights flytter realiseret type-fordeling (sprinter op)", () => {
  const base = generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR });
  const sprintHeavy = {};
  for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
    sprintHeavy[tier] = { ...weights, sprinter: (weights.sprinter ?? 1) * 5 };
  }
  const skewed = generateFictionalRiders({
    seed: 2026, count: 800, referenceYear: REF_YEAR, tierTypeWeights: sprintHeavy,
  });
  const baseSprint = countByArchetype(base.riders).sprinter || 0;
  const skewSprint = countByArchetype(skewed.riders).sprinter || 0;
  assert.ok(skewSprint > baseSprint + 50,
    `forventede markant flere sprintere ved skew (base ${baseSprint} → skew ${skewSprint})`);
});

test("tierFractions override ændrer tier-kvoterne (elite-dense)", () => {
  const base = countByTier(
    generateFictionalRiders({ seed: 2026, count: 800, referenceYear: REF_YEAR }).riders,
  );
  const dense = countByTier(
    generateFictionalRiders({
      seed: 2026, count: 800, referenceYear: REF_YEAR,
      tierFractions: { superstar: 0.06, star: 0.16, solid: 0.35 },
    }).riders,
  );
  assert.ok(dense.superstar > base.superstar * 2,
    `elite-dense skal have markant flere superstars (base ${base.superstar} → ${dense.superstar})`);
  assert.equal(dense.superstar, Math.round(0.06 * 800));
  // Stadig en gyldig population: summerer til count.
  const total = Object.values(dense).reduce((s, n) => s + n, 0);
  assert.equal(total, 800);
});

// ── C1: ARCHETYPES + ARCHETYPE_BY_TYPE eksporteret ───────────────────────────

test("ARCHETYPES eksporteret med boost/damp pr. type", () => {
  assert.ok(Array.isArray(ARCHETYPES) && ARCHETYPES.length === 8);
  assert.ok(ARCHETYPE_BY_TYPE.climber?.boost?.stat_bj > 0);
});

test("override bevarer kontrakten (stats i [50,85], pcm_id null)", () => {
  const { riders } = generateFictionalRiders({
    seed: 7, count: 400, referenceYear: REF_YEAR,
    tierFractions: { superstar: 0.06, star: 0.16, solid: 0.35 },
    tierTypeWeights: (() => {
      const w = {};
      for (const [tier, weights] of Object.entries(DEFAULT_TIER_TYPE_WEIGHTS)) {
        w[tier] = { ...weights, climber: (weights.climber ?? 1) * 2 };
      }
      return w;
    })(),
  });
  for (const r of riders) {
    assert.equal(r.pcm_id, null);
    for (const key of STAT_KEYS) {
      assert.ok(r[key] >= 50 && r[key] <= 85, `${key}=${r[key]} uden for [50,85]`);
    }
  }
});

// -- #4180: navne-RNG er adskilt fra stat-RNG --------------------------------
//
// Foer #4180 traak navnene fra hovedstroemmen, og antallet af traek afhang af
// hvor mange navne-KOLLISIONER der opstod. Laengere lister -> faerre kollisioner
// -> forskudt stroem -> hver eneste rytter fik andre stats. Denne test er
// forward-guarden: en ren tilfoejelse til navnelisterne maa aendre navne og
// INTET andet.
test("#4180: udvidelse af navnelisterne aendrer navne, men ikke en eneste stat", () => {
  const fingerprint = (r) => {
    const { firstname: _firstname, lastname: _lastname, ...rest } = r;
    return JSON.stringify(rest, Object.keys(rest).sort());
  };
  const run = () => generateFictionalRiders({ seed: 2026, count: 400, referenceYear: REF_YEAR }).riders;

  const before = run();
  const added = [];
  try {
    // Praecis den klasse af aendring #4178/#4179 laver: rene tilfoejelser til
    // hvert cluster, ingen fjernelse eller omdoebning.
    for (const key of Object.keys(NAME_CLUSTERS)) {
      const cluster = NAME_CLUSTERS[key];
      for (let i = 0; i < 10; i++) {
        cluster.first.push(`Zzfirst${key}${i}`);
        cluster.last.push(`Zzlast${key}${i}`);
      }
      added.push({ cluster, n: 10 });
    }
    const after = run();

    assert.equal(after.length, before.length);
    const statDiffs = before.filter((r, i) => fingerprint(r) !== fingerprint(after[i]));
    assert.equal(
      statDiffs.length, 0,
      `${statDiffs.length} ryttere fik aendrede stats af en ren navne-tilfoejelse - navne-rng laekker ind i hovedstroemmen igen`,
    );
    // Sanity: testen ville vaere tom hvis navnene heller ikke aendrede sig.
    const nameDiffs = before.filter((r, i) => r.firstname !== after[i].firstname || r.lastname !== after[i].lastname);
    assert.ok(nameDiffs.length > 0, "navnene aendrede sig slet ikke - testen maaler ingenting");
  } finally {
    for (const { cluster, n } of added) {
      cluster.first.length -= n;
      cluster.last.length -= n;
    }
  }
});

test("#4180: navne-understroemmen aendrer ikke determinismen (samme seed -> samme output)", () => {
  const a = generateFictionalRiders({ seed: 7, count: 200, referenceYear: REF_YEAR }).riders;
  const b = generateFictionalRiders({ seed: 7, count: 200, referenceYear: REF_YEAR }).riders;
  assert.deepEqual(a, b);
});
