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
import { summarizeRaceDayAxis, maxEmptyGameDaysPerDate } from "./calendarRaceDayTargets.js";

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

test("#4845: traeningsdagene klumper ikke paa faa kalenderdatoer", () => {
  const { tierPlans: natur } = plan(null);
  const maal = Math.max(...naturligeAkser(natur));
  const { tierPlans } = plan(maal);
  for (const t of tierPlans) {
    if (!t.raceDayDeficit || !eksaktKvote(t)) continue;
    const loft = maxEmptyGameDaysPerDate({ budget: t.raceDayDeficit, days: REAL_DAYS });
    // Datoen kommer fra pakkeren selv (trainingGameDayRealDays). En tom loebsdag har ingen
    // raekke i stageRows, saa den maa ALDRIG udledes af naboernes datoer (§0's akse-faelde).
    const prDato = new Map();
    for (const d of t.trainingGameDayRealDays ?? []) prDato.set(d, (prDato.get(d) ?? 0) + 1);
    assert.equal(prDato.size > 0, true, `tier ${t.tier}: ingen traeningsdage rapporteret trods budget ${t.raceDayDeficit}`);
    for (const [d, n] of prDato) {
      assert.ok(n <= loft, `tier ${t.tier}: ${n} traeningsdage paa kalenderdag ${d} (loft ${loft})`);
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
