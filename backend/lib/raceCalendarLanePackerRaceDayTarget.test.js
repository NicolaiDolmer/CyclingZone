// #4845 (ejer-beslutning 6/9) — SAMME ANTAL LOEBSDAGE I ALLE FIRE DIVISIONER.
//
// Ejeren ordret: "Det skal vaere samme antal dage ind i spillet. Men divisionerne behoeves
// ikke noedvendigvis at koere lige mange loeb." Loebsdage uden loeb er rene traeningsdage
// (#4846's tick-enhed). Reglen er R12 i raceCalendarLanePacker.js.
//
// Testen koerer mod den committede PROD-katalog-fixture og ikke mod et syntetisk katalog:
// hele vanskeligheden ved reglen er at en tom loebsdag kun maa ligge dér hvor INTET loeb er
// i gang (ejer-reglen 25/8 om loebsdage i traek), og hvor ofte det sker afhaenger af
// katalogets etapeloebs-laengder. Et syntetisk katalog ville goere reglen kunstigt let.

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

test("#4845: med maal har ALLE divisioner praecis lige mange loebsdage", () => {
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur));
  const { tierPlans } = plan(maal);
  const maalte = tierPlans.filter(eksaktKvote);
  assert.ok(maalte.length >= 3, "fixturen skal have mindst tre divisioner med eksakt kvote");
  for (const t of maalte) {
    assert.equal(aksen(t), maal, `tier ${t.tier} ramte ikke maalet (${aksen(t)} mod ${maal})`);
    assert.equal(t.raceDayPaddingHeld, true, `tier ${t.tier}: maalet blev ikke naaet af soegningen`);
  }
});

test("#4845: en tom loebsdag ligger ALDRIG inde i et loebs spaend (ejer-reglen 25/8)", () => {
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur));
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    const spaendPrLoeb = new Map();
    for (const s of t.pools[0].stageRows) {
      const nu = spaendPrLoeb.get(s.pool_race_id) ?? [Infinity, -Infinity];
      spaendPrLoeb.set(s.pool_race_id, [Math.min(nu[0], s.game_day), Math.max(nu[1], s.game_day)]);
    }
    const spaend = [...spaendPrLoeb.values()];
    for (const g of t.trainingGameDays ?? []) {
      const inde = spaend.find(([a, b]) => g >= a && g <= b);
      assert.equal(inde, undefined,
        `tier ${t.tier}: traeningsdag ${g} ligger inde i et loebs spaend ${JSON.stringify(inde)} — det ville vaere en hviledag midt i et etapeloeb`);
    }
  }
});

test("#4845: etapeloebenes loebsdage ligger stadig i TRAEK (R1 uae­ndret)", () => {
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur));
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    const perLoeb = new Map();
    for (const s of t.pools[0].stageRows) {
      if (!perLoeb.has(s.pool_race_id)) perLoeb.set(s.pool_race_id, []);
      perLoeb.get(s.pool_race_id).push(s.game_day);
    }
    for (const [id, gs] of perLoeb) {
      const sorteret = [...gs].sort((a, b) => a - b);
      const huller = sorteret[sorteret.length - 1] - sorteret[0] + 1 - sorteret.length;
      // Kun Grand Tours maa have huller (hviledage, GRAND_TOUR_REST_DAYS = 2).
      assert.ok(huller === 0 || (t.tier === 1 && huller <= 2),
        `tier ${t.tier} loeb ${id}: ${huller} hul(ler) i loebsdagene ${sorteret.join(",")}`);
    }
  }
});

test("#4845: en loebsdag hoerer stadig til PRAECIS een kalenderdato (#4236 uae­ndret)", () => {
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur));
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
  const maal = Math.max(...naturligeAkser(natur));
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
  const maal = Math.max(...naturligeAkser(natur)) + 24;
  const { tierPlans } = plan(maal);
  for (let i = 0; i < tierPlans.length; i++) {
    const t = tierPlans[i];
    const n = natur[i];
    assert.equal(t.naturalRaceDays, n.raceDayAxisLength, `tier ${t.tier}: det naturlige antal loebsdage aendrede sig`);
    // Loebenes REKKEFOELGE og indbyrdes afstand paa aksen skal vae­re uae­ndret. Aksen er
    // forskudt af de indsatte traeningsdage, saa vi sammenligner formen, ikke tallene.
    const form = (plan_) => {
      const per = new Map();
      for (const s of plan_.pools[0].stageRows) {
        if (!per.has(s.pool_race_id)) per.set(s.pool_race_id, []);
        per.get(s.pool_race_id).push(s.game_day);
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
  const maal = Math.max(...naturligeAkser(natur)) + 24;
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
  const maal = Math.max(...naturligeAkser(natur)) + 24;
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
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur)) + 24;
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
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur)) + 24;
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    for (const d of t.trainingGameDayRealDays ?? []) {
      assert.ok(d >= 0 && d < REAL_DAYS, `tier ${t.tier}: traeningsdag paa kalenderdato ${d} (saesonen har ${REAL_DAYS})`);
    }
  }
});

test("#4845: summarizeRaceDayAxis mod planen giver samme akse som pakkeren rapporterer", () => {
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur));
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    const s = summarizeRaceDayAxis({ stageRows: t.pools[0].stageRows, timelineLength: t.timelineLength });
    assert.equal(s.axisLength, aksen(t));
    assert.equal(s.emptyGameDays, (t.trainingGameDayCount ?? 0) + (t.restDayGameDayCount ?? 0));
  }
});
