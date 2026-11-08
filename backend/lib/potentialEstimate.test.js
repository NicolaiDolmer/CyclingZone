// #6110: potentiale-skønnet. Tallene i PARAMS er syntetiske testværdier, ikke
// kalibreringen (den er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatePotential, uncertaintyFor, certaintyWord, deviation, CERTAINTY_WORDS,
  validateParams, knowledgeLevel, monotoneLevel, planEstimateWrite, publicEstimateView,
  stripHiddenTalent, HIDDEN_RIDER_TALENT_COLUMNS, WRITE_REASONS,
} from "./potentialEstimate.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PARAMS = Object.freeze({
  salt: "test",
  weights: { shared: 0.6, pair: 0.6, level: 0.53 },
  clip: 2,
  minU: 1,
  words: { sureAtOrBelow: 3, fairAtOrBelow: 6 },
  scout: { maxLooks: 3, defaultTier: 1, uByLooks: [8, 5, 3], tierFactor: [1, 0.9, 0.8, 0.7, 0.6] },
  own: { firstEstimateDates: 5, staffSpeedWeight: 0.5, steps: [{ fromDates: 0, u: 7 }, { fromDates: 12, u: 4 }, { fromDates: 20, u: 2 }] },
});

const scoutKnow = (looks, tier = 3) => ({ own: false, looks, bestScoutTier: tier });

test("intet tal uden viden: fremmed uden kig og egen ung under grænsen", () => {
  assert.deepEqual(estimatePotential({ truePot: 70, currentRating: 40, riderId: "r1", teamId: "t1", knowledge: scoutKnow(0) }, PARAMS), { hidden: true });
  assert.deepEqual(estimatePotential({ truePot: 70, currentRating: 40, riderId: "r1", teamId: "t1", knowledge: { own: true, trainingDates: 4 } }, PARAMS), { hidden: true });
  assert.equal(estimatePotential({ truePot: 70, currentRating: 40, riderId: "r1", teamId: "t1", knowledge: { own: true, trainingDates: 5 } }, PARAMS).hidden, false);
});

test("stabilt: samme (rytter, hold, viden) giver altid samme tal", () => {
  const a = estimatePotential({ truePot: 72, currentRating: 50, riderId: "r9", teamId: "t3", knowledge: scoutKnow(1) }, PARAMS);
  const b = estimatePotential({ truePot: 72, currentRating: 50, riderId: "r9", teamId: "t3", knowledge: scoutKnow(1) }, PARAMS);
  assert.deepEqual(a, b);
});

test("afvigelsen er klippet, og to hold får forskellige afvigelser", () => {
  for (let i = 0; i < 2000; i++) {
    const z = deviation(`r${i}`, "t1", "s1t1", PARAMS);
    assert.ok(z >= -2 && z <= 2);
  }
  let differ = 0;
  for (let i = 0; i < 200; i++) if (deviation(`r${i}`, "tA", "s1t1", PARAMS) !== deviation(`r${i}`, "tB", "s1t1", PARAMS)) differ++;
  assert.ok(differ > 190);
});

test("skønnet glider: den faste del dominerer, så niveauerne følges ad", () => {
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < 3000; i++) {
    const a = deviation(`r${i}`, "t1", "s1t3", PARAMS), b = deviation(`r${i}`, "t1", "s2t3", PARAMS);
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  const corr = sxy / Math.sqrt(sxx * syy);
  assert.ok(corr > 0.5, `korrelation ${corr}`);
});

test("monotoni i forventning: mere viden giver mindre gennemsnitlig fejl", () => {
  const meanErr = (looks) => {
    let s = 0;
    for (let i = 0; i < 4000; i++) {
      const e = estimatePotential({ truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: `t${i % 7}`, knowledge: scoutKnow(looks) }, PARAMS);
      s += Math.abs(e.value - 60);
    }
    return s / 4000;
  };
  const e1 = meanErr(1), e2 = meanErr(2), e3 = meanErr(3);
  assert.ok(e1 > e2 && e2 > e3, `${e1} ${e2} ${e3}`);
});

test("inversion: to aflæsninger på hvert sit niveau kan ikke løses for sandheden", () => {
  // Angrebet fra review på #7107: løs to aflæsninger for sandheden. Med kun en fast
  // afvigelse rammer det (næsten) præcist; med delen pr. niveau må det ikke være
  // bedre end det bedste enkelt-skøn.
  const u1 = uncertaintyFor(scoutKnow(1), PARAMS), u2 = uncertaintyFor(scoutKnow(3), PARAMS);
  let attackErr = 0, bestSingleErr = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const base = { truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: "t1" };
    const e1 = estimatePotential({ ...base, knowledge: scoutKnow(1) }, PARAMS).value;
    const e2 = estimatePotential({ ...base, knowledge: scoutKnow(3) }, PARAMS).value;
    attackErr += Math.abs((e1 * u2 - e2 * u1) / (u2 - u1) - 60);
    bestSingleErr += Math.abs(e2 - 60);
  }
  assert.ok(attackErr / N > bestSingleErr / N, `angreb ${attackErr / N} mod bedste skøn ${bestSingleErr / N}`);
});

test("deling mellem hold hjælper kun lidt: fælles del pr. rytter (ejer-valg 23/10)", () => {
  let pooled = 0, single = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let t = 0; t < 10; t++) {
      sum += estimatePotential({ truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: `t${t}`, knowledge: scoutKnow(1, 1) }, PARAMS).value;
    }
    pooled += Math.abs(sum / 10 - 60);
    single += Math.abs(estimatePotential({ truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: "t0", knowledge: scoutKnow(1, 1) }, PARAMS).value - 60);
  }
  assert.ok(pooled / N >= 0.5 * (single / N), `samlet ${pooled / N} mod enkelt ${single / N}`);
});

test("bedre scout giver mindre usikkerhed; ordet bliver aldrig mindre sikkert", () => {
  const order = (w) => CERTAINTY_WORDS.indexOf(w);
  for (const looks of [1, 2, 3]) {
    let prevU = Infinity, prevWord = -1;
    for (const tier of [1, 2, 3, 4, 5]) {
      const u = uncertaintyFor(scoutKnow(looks, tier), PARAMS);
      assert.ok(u <= prevU);
      assert.ok(order(certaintyWord(u, PARAMS)) >= prevWord);
      prevU = u; prevWord = order(certaintyWord(u, PARAMS));
    }
  }
});

test("scoutens niveau sætter loftet for sikkerheden (K2): svag scout giver aldrig Sikker", () => {
  const P = { ...PARAMS, scout: { ...PARAMS.scout, minUByTier: [3.5, 3.5, 1, 1, 1] } };
  for (const tier of [1, 2]) {
    for (const looks of [1, 2, 3]) assert.notEqual(certaintyWord(uncertaintyFor(scoutKnow(looks, tier), P), P), "sure");
  }
  assert.equal(certaintyWord(uncertaintyFor(scoutKnow(3, 3), P), P), "sure");
});

test("usikkerheden går aldrig under minU (kan altid ramme lidt ved siden af)", () => {
  assert.equal(uncertaintyFor({ own: true, trainingDates: 500, staffSpeed: 10 }, PARAMS), 2);
  assert.ok(uncertaintyFor(scoutKnow(3, 5), PARAMS) >= PARAMS.minU);
});

test("skønnet vises aldrig under nuværende rating og aldrig over 99", () => {
  for (let i = 0; i < 1000; i++) {
    const e = estimatePotential({ truePot: 60, currentRating: 59, riderId: `r${i}`, teamId: "t1", knowledge: scoutKnow(1, 1) }, PARAMS);
    assert.ok(e.value >= 59);
    const hi = estimatePotential({ truePot: 98, currentRating: 50, riderId: `r${i}`, teamId: "t1", knowledge: scoutKnow(1, 1) }, PARAMS);
    assert.ok(hi.value <= 99);
  }
});

test("egen rytter: flere afregnede datoer og bedre stab gør skønnet sikrere", () => {
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 6 }, PARAMS), PARAMS), "unsure");
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 13 }, PARAMS), PARAMS), "fair");
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 21 }, PARAMS), PARAMS), "sure");
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 14, staffSpeed: 1 }, PARAMS), PARAMS), "sure");
});

// ---------------------------------------------------------------------------
// Byggetrin 3: validering, kombineret viden, monotoni, gemt skøn, offentlig visning
// ---------------------------------------------------------------------------

const clone = (o) => JSON.parse(JSON.stringify(o));

test("validateParams godtager test-kalibreringen og afviser ikke-monotone tabeller", () => {
  assert.equal(validateParams(PARAMS), PARAMS);
  const bad = (mutate, re) => {
    const p = clone(PARAMS);
    mutate(p);
    assert.throws(() => validateParams(p), re);
  };
  bad((p) => { p.scout.uByLooks = [5, 8, 3]; }, /uByLooks must never increase/);
  bad((p) => { p.scout.tierFactor = [1, 1.1, 0.8, 0.7, 0.6]; }, /tierFactor must never increase/);
  bad((p) => { p.scout.minUByTier = [1, 2, 1, 1, 1]; }, /minUByTier must never increase/);
  bad((p) => { p.own.steps = [{ fromDates: 0, u: 4 }, { fromDates: 12, u: 7 }]; }, /steps\.u must never increase/);
  bad((p) => { p.own.steps = [{ fromDates: 12, u: 7 }, { fromDates: 12, u: 4 }]; }, /fromDates must be strictly increasing/);
  bad((p) => { p.words = { sureAtOrBelow: 6, fairAtOrBelow: 3 }; }, /sureAtOrBelow < fairAtOrBelow/);
  bad((p) => { p.minU = 0; }, /minU/);
  bad((p) => { p.weights = { shared: 1, pair: 1, level: 1 }; }, /sum of squares of 1/);
  bad((p) => { p.weights = { shared: 0.8, pair: 0.6, level: 0 }; }, /inversion guard/);
  bad((p) => { p.weights = { shared: 0, pair: 0.8, level: 0.6 }; }, /pooling across teams/);
  bad((p) => { p.salt = ""; }, /salt/);
  bad((p) => { p.scout.maxLooks = 4; }, /uByLooks needs/);
  assert.throws(() => validateParams(null), /invalid params/);
});

test("egen rytter beholder holdets viden fra kig før skiftet; bedste kilde vinder", () => {
  // Scoutet tre gange med god scout, før han kom til holdet; under grænsen for egne træninger.
  const k = { own: true, trainingDates: 2, looks: 3, bestScoutTier: 5 };
  assert.deepEqual(knowledgeLevel(k, PARAMS), knowledgeLevel(scoutKnow(3, 5), PARAMS));
  // Mange træninger slår ét kig med svag scout.
  const many = knowledgeLevel({ own: true, trainingDates: 25, looks: 1, bestScoutTier: 1 }, PARAMS);
  assert.equal(many.key, "own2");
  // Egen rytter uden kig og under grænsen: stadig intet tal.
  assert.equal(knowledgeLevel({ own: true, trainingDates: 2 }, PARAMS), null);
});

test("monotoneLevel: viden kan kun vokse, så ordet aldrig bliver mindre sikkert", () => {
  const stored = { knowledge_key: "own2", uncertainty: 2 };
  assert.deepEqual(monotoneLevel(stored, { key: "own1", u: 4 }), { key: "own2", u: 2 });
  assert.deepEqual(monotoneLevel(stored, { key: "s3t5", u: 1.8 }), { key: "s3t5", u: 1.8 });
  assert.deepEqual(monotoneLevel(stored, null), { key: "own2", u: 2 });
  assert.deepEqual(monotoneLevel(null, { key: "s1t1", u: 8 }), { key: "s1t1", u: 8 });
  // Samme usikkerhed fra en anden kilde er ikke ny viden: det gemte niveau bliver.
  assert.deepEqual(monotoneLevel(stored, { key: "s3t5", u: 2 }), { key: "own2", u: 2 });
});

test("H2: faldende stab-fart, der skifter til en lige så god kilde, flytter ikke tallet (Codex-fund)", () => {
  // Egen rytter med både træninger og kig; stab-farten falder bagefter, så egne
  // træninger alene ville give et dårligere niveau end kiggene med samme usikkerhed.
  const P = { ...PARAMS, own: { ...PARAMS.own, steps: [{ fromDates: 0, u: 7 }, { fromDates: 12, u: 4.5 }, { fromDates: 20, u: 2 }] } };
  const tie = uncertaintyFor(scoutKnow(2, 3), P);
  P.own.steps[1].u = tie; // gør egne træninger (trin 1) præcis lige så sikre som kiggene
  const before = { own: true, trainingDates: 10, staffSpeed: 1, looks: 2, bestScoutTier: 3 };
  const after = { ...before, staffSpeed: 0 };
  const lvBefore = knowledgeLevel(before, P);
  assert.equal(lvBefore.key, "own1");
  const first = planEstimateWrite({ stored: null, truePot: 70, riderId: "rx", teamId: "tx", knowledge: before, trigger: "sunday", paramsVersion: "v", now: NOW }, P).row;
  const next = planEstimateWrite({ stored: first, truePot: 70, riderId: "rx", teamId: "tx", knowledge: after, trigger: "sunday", paramsVersion: "v", now: NOW }, P);
  assert.equal(next.action, "keep");
});

const NOW = "2026-11-08T03:00:00.000Z";
const plan = (over) => planEstimateWrite({
  stored: null, truePot: 70, riderId: "r1", teamId: "t1", knowledge: scoutKnow(1),
  trigger: "new_knowledge", paramsVersion: "test-v1", now: NOW, ...over,
}, PARAMS);

test("planEstimateWrite: første kig skriver en række med tal, ord og serverfelter", () => {
  const res = plan({});
  assert.equal(res.action, "write");
  assert.equal(res.changed, false);
  const est = estimatePotential({ truePot: 70, currentRating: 1, riderId: "r1", teamId: "t1", knowledge: scoutKnow(1) }, PARAMS);
  assert.equal(res.row.value, est.value);
  assert.equal(res.row.certainty, est.certainty);
  assert.equal(res.row.uncertainty, est.u);
  assert.equal(res.row.knowledge_key, "s1t3");
  assert.equal(res.row.ceiling_at_write, 70);
  assert.equal(res.row.write_reason, "new_knowledge");
  assert.equal(res.row.params_version, "test-v1");
  assert.equal(res.row.previous_value, null);
  assert.equal(res.row.computed_at, NOW);
  assert.ok(WRITE_REASONS.includes(res.row.write_reason));
});

test("planEstimateWrite: uden viden og uden gemt række skrives intet", () => {
  assert.deepEqual(plan({ knowledge: scoutKnow(0) }), { action: "none" });
});

test("H2 stabilitet: uden ny viden og med uændret loft står tallet stille", () => {
  const first = plan({}).row;
  assert.equal(plan({ stored: first }).action, "keep");
  assert.equal(plan({ stored: first, trigger: "sunday" }).action, "keep");
  assert.equal(plan({ stored: first, trigger: "team_change" }).action, "keep");
  assert.equal(plan({ stored: first, trigger: "backfill", knowledge: scoutKnow(3) }).action, "keep");
  // Et nyt kig flytter ikke tallet, fordi loftet har flyttet sig; kun søndagen gør.
  assert.equal(plan({ stored: first, truePot: 74 }).action, "keep");
  const sunday = plan({ stored: first, truePot: 74, trigger: "sunday" });
  assert.equal(sunday.action, "write");
  assert.equal(sunday.row.ceiling_at_write, 74);
  assert.equal(sunday.row.knowledge_key, first.knowledge_key);
});

test("ny viden skriver; en dårligere kilde bagefter skriver ikke", () => {
  const first = plan({}).row;
  const better = plan({ stored: first, knowledge: scoutKnow(3, 5) });
  assert.equal(better.action, "write");
  assert.ok(better.row.uncertainty < first.uncertainty);
  // Et senere kig med en svagere scout må ikke gøre skønnet mindre sikkert.
  const worse = plan({ stored: better.row, knowledge: scoutKnow(2, 1) });
  assert.equal(worse.action, "keep");
});

test("ændret siden sidst: forrige tal og ord gemmes kun, når skønnet faktisk ændrer sig", () => {
  let found = false;
  for (let i = 0; i < 200 && !found; i++) {
    const first = plan({ riderId: `r${i}` }).row;
    const next = plan({ riderId: `r${i}`, stored: first, knowledge: scoutKnow(3, 5) });
    if (next.changed) {
      found = true;
      assert.equal(next.row.previous_value, first.value);
      assert.equal(next.row.previous_certainty, first.certainty);
      assert.equal(next.row.changed_at, NOW);
    }
  }
  assert.ok(found, "mindst én rytter skal få et ændret skøn ved bedre viden");
  // Søndagen skriver (loftet er flyttet), men tal og ord er de samme: forrige-felterne
  // bæres uændret videre, så "ændret siden sidst" ikke nulstilles af en ny skrivning.
  const fresh = plan({}).row;
  const stored = { ...fresh, ceiling_at_write: 71, previous_value: 50, previous_certainty: "unsure", changed_at: "2026-11-01T03:00:00.000Z" };
  const same = plan({ stored, trigger: "sunday" });
  assert.equal(same.action, "write");
  assert.equal(same.changed, false);
  assert.equal(same.row.value, fresh.value);
  assert.equal(same.row.previous_value, 50);
  assert.equal(same.row.previous_certainty, "unsure");
  assert.equal(same.row.changed_at, "2026-11-01T03:00:00.000Z");
});

test("holdskifte: det nye hold får sit eget skøn (eget seed) med den viden det havde", () => {
  const a = plan({ teamId: "tA", knowledge: scoutKnow(2) });
  const b = plan({ teamId: "tB", knowledge: { own: true, trainingDates: 0, looks: 2, bestScoutTier: 3 }, trigger: "team_change" });
  assert.equal(b.action, "write");
  assert.equal(b.row.knowledge_key, a.row.knowledge_key);
  let differ = 0;
  for (let i = 0; i < 200; i++) {
    const x = plan({ riderId: `r${i}`, teamId: "tA" }).row.value;
    const y = plan({ riderId: `r${i}`, teamId: "tB", trigger: "team_change" }).row.value;
    if (x !== y) differ++;
  }
  assert.ok(differ > 50, `${differ} af 200 skøn er forskellige mellem to hold`);
});

test("planEstimateWrite afviser ukendt trigger, manglende version og loft uden for skalaen", () => {
  assert.throws(() => plan({ trigger: "daily" }), /unknown trigger/);
  assert.throws(() => plan({ paramsVersion: "" }), /paramsVersion/);
  assert.throws(() => plan({ now: undefined }), /now/);
  assert.throws(() => plan({ truePot: 0 }), /1-99/);
  assert.throws(() => plan({ truePot: Number.NaN }), /1-99/);
});

test("H4: den offentlige visning indeholder kun tal, ord og ændret-siden-sidst", () => {
  const row = { ...plan({}).row, previous_value: 66, previous_certainty: "unsure", changed_at: NOW };
  const view = publicEstimateView(row, { currentRating: 40 });
  assert.deepEqual(Object.keys(view).sort(), ["certainty", "changedAt", "hidden", "previousCertainty", "previousValue", "value"]);
  for (const leak of ["uncertainty", "knowledge_key", "ceiling_at_write", "u", "params_version"]) assert.ok(!(leak in view));
  assert.equal(view.value, row.value);
  assert.deepEqual(publicEstimateView(null), { hidden: true });
  assert.deepEqual(publicEstimateView({ value: 70, certainty: "meget" }), { hidden: true });
});

test("visningen lægger gulvet ved nuværende rating uden at skrive rækken om", () => {
  const row = { ...plan({}).row, value: 60 };
  assert.equal(publicEstimateView(row, { currentRating: 64 }).value, 64);
  assert.equal(publicEstimateView(row, { currentRating: 50 }).value, 60);
  assert.equal(row.value, 60);
});

test("ændret-siden-sidst sammenligner de viste tal, ikke de gemte (Codex P2)", () => {
  const base = { ...plan({}).row, certainty: "fair", previous_certainty: "fair", changed_at: NOW };
  // Gulvet skjuler 60 → 61 under rating 64: spilleren så 64 begge gange, ingen ændring.
  const masked = publicEstimateView({ ...base, value: 61, previous_value: 60 }, { currentRating: 64 });
  assert.equal(masked.value, 64);
  assert.equal(masked.previousValue, null);
  assert.equal(masked.changedAt, null);
  // En synlig stigning over gulvet vises som før, med det tidligere VISTE tal.
  const visible = publicEstimateView({ ...base, value: 70, previous_value: 60 }, { currentRating: 64 });
  assert.equal(visible.previousValue, 64);
  assert.equal(visible.changedAt, NOW);
  // Et nyt sikkerheds-ord er en synlig ændring, selv når tallet er det samme.
  const word = publicEstimateView({ ...base, value: 61, previous_value: 60, previous_certainty: "unsure" }, { currentRating: 64 });
  assert.equal(word.previousCertainty, "unsure");
  assert.equal(word.changedAt, NOW);
});

test("stripHiddenTalent fjerner de skjulte talent-kolonner og lader resten stå", () => {
  const row = { id: "r1", firstname: "A", base_talent: 71, talent_ceiling: 74, potentiale: 4 };
  const safe = stripHiddenTalent(row);
  for (const col of HIDDEN_RIDER_TALENT_COLUMNS) assert.ok(!(col in safe));
  assert.equal(safe.firstname, "A");
  assert.equal(row.base_talent, 71, "originalen muteres ikke");
  assert.equal(stripHiddenTalent(null), null);
});

test("migrationen matcher lib'en: ord, skrive-årsager, skjulte kolonner og server-only tabel", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(resolve(here, "../../database/2026-11-04-6110-potential-estimates.sql"), "utf8");
  for (const w of CERTAINTY_WORDS) assert.match(sql, new RegExp(`'${w}'`));
  for (const r of WRITE_REASONS) assert.match(sql, new RegExp(`'${r}'`));
  for (const col of HIDDEN_RIDER_TALENT_COLUMNS) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col} smallint`));
    assert.doesNotMatch(sql, new RegExp(`GRANT SELECT \\([^)]*${col}`), `${col} må aldrig grantes til klienten`);
  }
  assert.match(sql, /REVOKE SELECT \(base_talent, talent_ceiling\) ON public\.riders FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /ALTER TABLE public\.rider_potential_estimates ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.rider_potential_estimates FROM PUBLIC, anon, authenticated, service_role;/);
  assert.doesNotMatch(sql, /CREATE POLICY/, "tabellen er kun for serveren: ingen policies");
  // Kolonnerne i rækken fra planEstimateWrite findes alle i tabellen.
  for (const col of Object.keys(plan({}).row)) assert.match(sql, new RegExp(`\\n  ${col}\\s`), `kolonnen ${col} mangler i migrationen`);
});
