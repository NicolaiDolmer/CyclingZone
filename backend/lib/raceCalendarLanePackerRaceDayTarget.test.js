// #4845 (ejer-beslutning 6/9) — SAMME ANTAL LOEBSDAGE I ALLE FIRE DIVISIONER.
//
// Ejeren ordret: "Det skal vaere samme antal dage ind i spillet. Men divisionerne behoeves
// ikke noedvendigvis at koere lige mange loeb." Loebsdage uden loeb er rene traeningsdage
// (#4846's tick-enhed). Maalet naas som EFTERBEHANDLING (padAxisWithTrainingDays), ikke som
// en binding i soegningen — den gamle R12 er fjernet (#5267, se pakkerens doc-blok).
//
// Testen koerer mod den committede PROD-katalog-fixture og ikke mod et syntetisk katalog:
// hele vanskeligheden ved reglen er hvor mange positioner katalogets etapeloebs-laengder
// efterlader. Et syntetisk katalog ville goere reglen kunstigt let.
//
// DENNE FIL maaler MAALET (aksens laengde, kvoten, klassifikationen af tomme loebsdage).
// Selve FORDELINGEN af traeningsdagene — 5 loebsdage pr. kalenderdato, ejer-valget 20/9 —
// og den nye ordlyd af ejer-reglen 25/8 maales i raceCalendarLanePackerEvenTrainingDays.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";
import { summarizeRaceDayAxis, longestDateStreakWithoutTraining } from "./calendarRaceDayTargets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

// Fast dato + fast `now` — ellers rådner testen på selve datoen (#4222/#4239).
const FIRST_RACE_DAY = "2026-08-28";
const NOW = new Date("2026-08-25T12:00:00Z");
const REAL_DAYS = 28;

function plan(raceDayTarget = null) {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  return buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1, realDays: REAL_DAYS, raceDayTarget });
}

const aksen = (t) => t.raceDayAxisLength ?? t.timelineLength ?? 0;
const naturligeAkser = (tierPlans) => tierPlans.map(aksen);

// R12 lever i den UDTOEMMENDE soegning, som kraever at kvoten gaar praecist op
// (sum(etaper) = density x datoer, §1b). Goer den ikke det, falder pakkeren ned i det
// AFSLAPPEDE layout (layoutContiguousRelaxed), der hverken lover eksakt kvote eller et
// maal for aksen. I prod rammer alle fire divisioner kvoten eksakt (dry-run 11/9), men
// fixturens tier 4 goer ikke, saa den maa ikke doemme reglen roed.
// Fixturens tier 4 arver den foraeldede TIER_GAME_DAY_QUOTA (56 = density 2 x 28,
// CALENDAR_RULES.md §1b's "forkerte af tre") mens densiteten er 3, saa dens 56 etaper kan
// ikke fylde 3 x 28 pladser. Kriteriet herunder er density x datoer — praecis den §1b-
// afledning der ER den gyldige — og ikke `quota`-feltet.
const eksaktKvote = (t) => (t.pools?.[0]?.stageRows?.length ?? 0) === (t.density ?? 0) * (t.realDays ?? 0);

test("#4845: uden maal er pakningen UROERT — aksen er stadig et soegeresultat pr. division", () => {
  const a = naturligeAkser(plan(null).tierPlans);
  const b = naturligeAkser(plan(null).tierPlans);
  assert.deepEqual(a, b, "pakkeren skal vaere deterministisk");
  assert.ok(new Set(a).size > 1, "fixturen skal have SKAEVE akser — ellers maaler testen ingenting");
});

// S4's maal (SEASON_RACE_DAY_TARGET): 28 kalenderdatoer x D1's 5 slots. Det er ikke et
// vilkaarligt tal her: naar traeningsdagene fordeles JAEVNT, er hver datos kvote
// maal / datoer, og padding kan kun TILFOEJE loebsdage. Et maal skal derfor vaere hoejt nok
// til at kvoten daekker den TAETTESTE kalenderdatos naturlige antal loebsdage — ellers kan
// den dato ikke naa sin kvote, og aksen bliver laengere end maalet. 5 er D1's density og
// dermed loftet for hvor mange loebsdage en dato kan baere.
const MAAL = REAL_DAYS * 5;

test("#4845: med maal har ALLE divisioner praecis lige mange loebsdage", () => {
  const { tierPlans } = plan(MAAL);
  const maalte = tierPlans.filter(eksaktKvote);
  assert.ok(maalte.length >= 3, "fixturen skal have mindst tre divisioner med eksakt kvote");
  for (const t of maalte) {
    assert.equal(aksen(t), MAAL, `tier ${t.tier} ramte ikke maalet (${aksen(t)} mod ${MAAL})`);
    assert.equal(t.raceDayPaddingHeld, true, `tier ${t.tier}: maalet blev ikke naaet`);
  }
});

test("#5267: et maal der er for LAVT til den taetteste kalenderdato rapporteres, ikke pyntet", () => {
  // Grunden staar ved MAAL ovenfor. Med maalet sat til D1's naturlige antal loebsdage bliver
  // kvoten pr. dato 2-3, og D1 har datoer med 4-5 naturlige loebsdage. Padding kan ikke
  // FJERNE en loebsdag, saa aksen bliver laengere end maalet — og det skal staa i
  // afvigelses-listen og faelde §1d's gate, ikke forsvinde i en afrunding.
  const { tierPlans: natur } = plan(null);
  const lavtMaal = Math.max(...naturligeAkser(natur));
  const { tierPlans } = plan(lavtMaal);
  const taettest = tierPlans.find((t) => (t.raceDayPerDateDeviations ?? []).length > 0);
  assert.ok(taettest, "fixturen skal have mindst een division hvor et lavt maal ikke kan naas");
  assert.ok(aksen(taettest) > lavtMaal, `tier ${taettest.tier}: aksen skulle vaere laengere end det for lave maal`);
  assert.equal(taettest.raceDayPaddingHeld, false, `tier ${taettest.tier}: et umuligt maal skal rapporteres som IKKE naaet`);
});

test("#5267: hver TOM loebsdag er enten en indsat traeningsdag eller en GT-hviledag", () => {
  // Klassifikationen er det der afgoer om #4846's tick maa taelle dagen. Den kan IKKE laenge
  // afgoeres af span-medlemskab alene: en indsat traeningsdag maa ligge inde i et
  // etapeloebs spaend (ejer-valget 20/9), mens en GT-hviledag ogsaa ligger der og netop
  // IKKE er en traeningsdag. Padding'en ved hvilke dage den selv lagde, og det er kilden.
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    const medLoeb = new Set(t.pools[0].stageRows.map((s) => s.game_day));
    const traening = t.trainingGameDays ?? [];
    const tomme = aksen(t) - medLoeb.size;
    assert.equal(
      traening.length + (t.restDayGameDayCount ?? 0), tomme,
      `tier ${t.tier}: ${tomme} tomme loebsdage, men ${traening.length} traeningsdage + ${t.restDayGameDayCount ?? 0} GT-hviledage`,
    );
    for (const g of traening) {
      assert.ok(!medLoeb.has(g), `tier ${t.tier}: loebsdag ${g} er baade traeningsdag og baerer et loeb`);
    }
  }
});

test("#4845: en loebsdag hoerer stadig til PRAECIS een kalenderdato (#4236 uae­ndret)", () => {
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    const datoer = new Map();
    for (const s of t.pools[0].stageRows) {
      if (!datoer.has(s.game_day)) datoer.set(s.game_day, new Set());
      datoer.get(s.game_day).add(String(s.scheduled_at).slice(0, 10));
    }
    for (const [g, d] of datoer) assert.equal(d.size, 1, `tier ${t.tier} loebsdag ${g} spaender ${d.size} datoer`);
  }
});

test("#4845: kvoten er uroert — maalet flytter loebsdage, ikke etaper (§1b)", () => {
  const { tierPlans: natur } = plan(null);
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (let i = 0; i < tierPlans.length; i++) {
    assert.equal(
      tierPlans[i].pools[0].stageRows.length, natur[i].pools[0].stageRows.length,
      `tier ${tierPlans[i].tier}: antallet af etaper aendrede sig med maalet`,
    );
    if (!eksaktKvote(tierPlans[i])) continue;
    const prDato = new Map();
    for (const s of tierPlans[i].pools[0].stageRows) {
      const d = String(s.scheduled_at).slice(0, 10);
      prDato.set(d, (prDato.get(d) ?? 0) + 1);
    }
    const taetheder = new Set(prDato.values());
    assert.equal(taetheder.size, 1, `tier ${tierPlans[i].tier}: kalenderdagene har ikke samme tae­thed (${[...taetheder].join(",")})`);
  }
});

// ── #5267: maalet flytter IKKE et eneste loeb ───────────────────────────────────────────

test("#5267: den NATURLIGE pakning er BIT-IDENTISK med og uden loebsdags-maal", () => {
  // Det er hele fixet. Foer #5267 re-soegte R12 placeringen saa snart der var sat et maal,
  // og MAALT 18/9 faldt mindste-overlap-gulvet (§1/#3329) i alle fire divisioner af netop
  // den grund. Naar maalet kun tilfoejer tomme loebsdage, kan det pr. konstruktion ikke
  // flytte et loeb - og denne test er dét krav skrevet som en assertion.
  const { tierPlans: natur } = plan(null);
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (let i = 0; i < tierPlans.length; i++) {
    const t = tierPlans[i];
    const n = natur[i];
    assert.equal(t.naturalRaceDays, n.raceDayAxisLength, `tier ${t.tier}: det naturlige antal loebsdage aendrede sig`);
    // Loebenes REKKEFOELGE og indbyrdes afstand paa aksen skal vae­re uae­ndret. Aksen er
    // forskudt af de indsatte traeningsdage — ogsaa INDE i et loebs spaend — saa formen
    // maales paa RANGEN blandt loebsdage MED LOEB, ikke paa de raa game_day-tal. Maengden
    // af loebsdage med loeb er praecis den samme, saa rangen ER den naturlige akse.
    const form = (plan_) => {
      const medLoeb = [...new Set(plan_.pools[0].stageRows.map((s) => s.game_day))].sort((a, b) => a - b);
      const rang = new Map(medLoeb.map((g, i) => [g, i]));
      const per = new Map();
      for (const s of plan_.pools[0].stageRows) {
        if (!per.has(s.pool_race_id)) per.set(s.pool_race_id, []);
        per.get(s.pool_race_id).push(rang.get(s.game_day));
      }
      const lister = [...per.entries()].map(([id, gs]) => {
        const sorteret = [...gs].sort((a, b) => a - b);
        return { id, start: sorteret[0], relativ: sorteret.map((g) => g - sorteret[0]).join(",") };
      }).sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
      return lister.map((l) => `${l.id}:${l.relativ}`).join("|");
    };
    assert.equal(form(t), form(n), `tier ${t.tier}: loebenes indbyrdes placering aendrede sig med maalet`);
  }
});

test("#5267: antallet af ETAPER pr. kalenderdato er uroert af maalet (D4's 3 pr. dag, #4270)", () => {
  const { tierPlans: natur } = plan(null);
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (let i = 0; i < tierPlans.length; i++) {
    const tael = (p) => {
      const m = new Map();
      for (const s of p.pools[0].stageRows) {
        const d = String(s.scheduled_at).slice(0, 10);
        m.set(d, (m.get(d) ?? 0) + 1);
      }
      return [...m.entries()].sort().map(([d, n]) => `${d}:${n}`).join(" ");
    };
    assert.equal(tael(tierPlans[i]), tael(natur[i]), `tier ${tierPlans[i].tier}: etaper pr. kalenderdato aendrede sig`);
  }
});

test("#5267: overlappet pr. loebsdag er uroert af maalet (§1/#3329's gulv maales paa den naturlige pakning)", () => {
  const { tierPlans: natur } = plan(null);
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  const andel = (p) => {
    const per = new Map();
    for (const s of p.pools[0].stageRows) {
      if (!per.has(s.game_day)) per.set(s.game_day, new Set());
      per.get(s.game_day).add(s.pool_race_id);
    }
    const alle = [...per.values()];
    return alle.length ? alle.filter((s) => s.size >= 2).length / alle.length : 0;
  };
  for (let i = 0; i < tierPlans.length; i++) {
    assert.equal(andel(tierPlans[i]), andel(natur[i]), `tier ${tierPlans[i].tier}: overlap-andelen aendrede sig med maalet`);
  }
});

test("#5267: traeningsdagene fordeles over saa mange kalenderdatoer som muligt", () => {
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  const { tierPlans: hoejerePlans } = plan(maal + REAL_DAYS);
  for (const t of tierPlans) {
    if (!t.raceDayDeficit || !eksaktKvote(t)) continue;
    // Datoen kommer fra pakkeren selv (trainingGameDayRealDays). En tom loebsdag har ingen
    // raekke i stageRows, saa den maa ALDRIG udledes af naboernes datoer (§0's akse-faelde).
    const datoer = t.trainingGameDayRealDays ?? [];
    assert.ok(datoer.length > 0, `tier ${t.tier}: ingen traeningsdage rapporteret trods budget ${t.raceDayDeficit}`);
    const distinkte = new Set(datoer).size;
    // Round-robin over de frie positioner: hver fri position skal have faaet mindst een
    // traeningsdag foer nogen faar sin anden. Naar budgettet er stoerre end antallet af
    // frie positioner, er ALLE positioner derfor i brug - og antallet af beroerte datoer
    // er det hoejeste kataloget tillader. Stabler nogen en dag alt paa een position, gaar
    // denne test roedt i stedet for at det opdages i en live saeson.
    if (t.raceDayDeficit >= t.freeAxisPositions && t.freeAxisPositions >= 2) {
      assert.ok(distinkte >= 2, `tier ${t.tier}: ${t.freeAxisPositions} frie positioner, men traeningsdagene ramte kun ${distinkte} dato(er)`);
    }
    // Et HOEJERE maal maa aldrig give FAERRE beroerte datoer (round-robin, ikke stabling).
    const hoejere = hoejerePlans.find((x) => x.tier === t.tier);
    assert.ok(
      new Set(hoejere.trainingGameDayRealDays ?? []).size >= distinkte,
      `tier ${t.tier}: et hoejere maal gav faerre traeningsdatoer`,
    );
    // §1e-tallet skal vae­re det samme som en uafhae­ngig maaling paa datoerne.
    assert.equal(
      t.longestDateStreakWithoutTraining,
      longestDateStreakWithoutTraining({ days: REAL_DAYS, trainingRealDays: datoer }),
      `tier ${t.tier}: pakkerens §1e-tal stemmer ikke med en uafhae­ngig maaling`,
    );
  }
});

test("#5267: en traeningsdag ligger aldrig paa en kalenderdato uden for saesonen", () => {
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    for (const d of t.trainingGameDayRealDays ?? []) {
      assert.ok(d >= 0 && d < REAL_DAYS, `tier ${t.tier}: traeningsdag paa kalenderdato ${d} (saesonen har ${REAL_DAYS})`);
    }
  }
});

test("#4845: summarizeRaceDayAxis mod planen giver samme akse som pakkeren rapporterer", () => {
  const maal = MAAL;
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    const s = summarizeRaceDayAxis({ stageRows: t.pools[0].stageRows, timelineLength: t.timelineLength });
    assert.equal(s.axisLength, aksen(t));
    assert.equal(s.emptyGameDays, (t.trainingGameDayCount ?? 0) + (t.restDayGameDayCount ?? 0));
  }
});
