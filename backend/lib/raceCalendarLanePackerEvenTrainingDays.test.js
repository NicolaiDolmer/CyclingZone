// #5267 — 5 LOEBSDAGE PAA HVER KALENDERDATO (traeningsdagene fordelt jaevnt).
//
// Ejer-valget 20/9 ("maade B"). Den afviste vej ("maade A") lagde kun tomme loebsdage dér
// hvor intet loeb spaendte henover. Det holdt ejer-reglen 25/8 bogstaveligt, men
// traeningsdagene klumpede — MAALT 19/9: 15-33 paa EEN kalenderdato, og D3 havde 23
// kalenderdatoer i traek uden en eneste traeningsdag. Ugeprogrammet (7 ugedage x 5
// loebsdage, TRAINING_RULES §13.3) forudsaetter at HVER kalenderdato baerer 5 loebsdage.
//
// Maade A er FJERNET, ikke slaaet fra: der er ikke to varianter bag en kontakt.
//
// PRISEN er en EKSPLICIT regel-aendring, ikke en stiltiende svaekkelse: en tom loebsdag maa
// ogsaa ligge INDE i et etapeloebs spaend. De to invarianter der dermed har faaet en ny
// ordlyd staar navngivet nedenfor, og hver af dem har sin egen test her:
//
//   §1d's saetning "en tom loebsdag maa kun ligge dér hvor intet loeb er i gang" er
//     erstattet af: de indsatte dage er HVILEDAGE for de ryttere der er bundet i
//     etapeloebet (race_entry_days binder allerede hele spaendet, #4217/#4209) og
//     TRAENINGSDAGE for alle andre.
//   Ejer-reglen 25/8 ("loebsdag 4-5-6-7") laeses blandt loebsdage MED LOEB: der er ingen
//     anden loebsdag med loeb mellem to af loebets etaper.
//
// GARANTIEN: padding flytter ikke et eneste loeb, ikke en eneste kalenderdato og ikke en
// eneste etape. Det er dét de tre "uae­ndret"-tests maaler, mod den samme pakning uden maal.
//
// Testen koerer mod den committede PROD-katalog-fixture, ikke mod et syntetisk katalog:
// hele vanskeligheden er hvor mange frie positioner katalogets etapeloebs-laengder giver.
//
// Refs #5267 #4845 #4846 #4270 #4236 #4217 #4209 #3329

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";
import { packLaneCalendar, padAxisWithTrainingDays } from "./raceCalendarLanePacker.js";
import { MAX_DATES_WITHOUT_TRAINING_DAY } from "./calendarRaceDayTargets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

// Faste ankre (#4222/#4239) — ellers raadner testen paa selve datoen.
const FIRST_RACE_DAY = "2026-08-28";
const NOW = new Date("2026-08-25T12:00:00Z");
const REAL_DAYS = 28;
const TARGET = 140;

function plan({ raceDayTarget = null } = {}) {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  return buildTierMaterializationPlan({
    pools, catalog, from, baseSeed: 1, realDays: REAL_DAYS, raceDayTarget,
  }).tierPlans;
}

// Maalet naas kun i den UDTOEMMENDE soegning, som kraever at kvoten gaar praecist op (§1b).
// Goer den ikke det, falder pakkeren ned i det AFSLAPPEDE layout uden maal. Fixturens
// tier 4 arver den foraeldede TIER_GAME_DAY_QUOTA, saa den maa ikke doemme reglen roed.
const eksaktKvote = (t) => (t.pools?.[0]?.stageRows?.length ?? 0) === (t.density ?? 0) * (t.realDays ?? 0);

// Formen maales paa RANGEN blandt loebsdage MED LOEB, ikke paa de raa game_day-tal.
// Aksen er forskudt af de indsatte traeningsdage — ogsaa INDE i et loebs spaend — saa de
// raa tal kan ikke sammenlignes. Maengden af loebsdage med loeb er derimod praecis den
// samme, saa rangen ER den naturlige akse. Det er dét kravet handler om: loebene skal
// ligge i samme raekkefoelge og med samme indbyrdes afstand som uden maalet.
const formAf = (p) => {
  const medLoeb = [...new Set(p.pools[0].stageRows.map((s) => s.game_day))].sort((a, b) => a - b);
  const rang = new Map(medLoeb.map((g, i) => [g, i]));
  const per = new Map();
  for (const s of p.pools[0].stageRows) {
    if (!per.has(s.pool_race_id)) per.set(s.pool_race_id, []);
    per.get(s.pool_race_id).push(rang.get(s.game_day));
  }
  return [...per.entries()]
    .map(([id, gs]) => {
      const sorteret = [...gs].sort((a, b) => a - b);
      return { id, start: sorteret[0], relativ: sorteret.map((g) => g - sorteret[0]).join(",") };
    })
    .sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
    .map((l) => `${l.id}:${l.relativ}`)
    .join("|");
};

const etaperPrDato = (p) => {
  const m = new Map();
  for (const s of p.pools[0].stageRows) {
    const d = String(s.scheduled_at).slice(0, 10);
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  return [...m.entries()].sort().map(([d, n]) => `${d}:${n}`).join(" ");
};

// ── Kravet ──────────────────────────────────────────────────────────────────────────────

test("#5267: HVER kalenderdato faar praecis maalet/datoer loebsdage", () => {
  for (const t of plan({ raceDayTarget: TARGET })) {
    if (!eksaktKvote(t)) continue;
    const prDato = t.raceDaysPerDate ?? [];
    assert.equal(prDato.length, REAL_DAYS, `tier ${t.tier}: ${prDato.length} datoer maalt, ${REAL_DAYS} forventet`);
    const forventet = TARGET / REAL_DAYS;
    for (let d = 0; d < prDato.length; d++) {
      assert.equal(prDato[d], forventet, `tier ${t.tier} dato ${d}: ${prDato[d]} loebsdage, ${forventet} forventet`);
    }
    assert.equal(t.raceDayAxisLength, TARGET, `tier ${t.tier}: aksen ramte ikke maalet`);
    assert.deepEqual(t.raceDayPerDateDeviations ?? [], [],
      `tier ${t.tier}: en dato har FLERE naturlige loebsdage end kvoten — 5-5 kan da ikke holde`);
  }
});

test("#5267: traeningsrytmen — ingen lang stime af datoer uden en traeningsdag", () => {
  // Selve grunden til at ejeren valgte denne vej. Under den afviste maade A var tallene
  // 16/11/23/11 datoer. Testen doemmer nu mod gatens eget loft (SSOT), ikke et haardkodet 1:
  // #5802 (26/9) satte Grand Tours i rigtig raekkefoelge (Giro -> Tour -> Vuelta), og D1's
  // laengste stime gik dermed fra 1 til 2 datoer - PRAECIS loftet, som scorecardet og
  // --apply-gaten allerede tillader. Et haardkodet 1 her ville doemme strengere end gaten.
  for (const t of plan({ raceDayTarget: TARGET })) {
    if (!eksaktKvote(t)) continue;
    assert.ok((t.longestDateStreakWithoutTraining ?? 99) <= MAX_DATES_WITHOUT_TRAINING_DAY,
      `tier ${t.tier}: ${t.longestDateStreakWithoutTraining} kalenderdatoer i traek uden en traeningsdag`);
  }
});

// ── Garantien: padding flytter ikke et loeb ─────────────────────────────────────────────

test("#5267: loebenes indbyrdes placering er uae­ndret", () => {
  const natur = plan({ raceDayTarget: null });
  const medMaal = plan({ raceDayTarget: TARGET });
  for (let i = 0; i < medMaal.length; i++) {
    assert.equal(medMaal[i].naturalRaceDays, natur[i].raceDayAxisLength,
      `tier ${medMaal[i].tier}: det naturlige antal loebsdage aendrede sig`);
    assert.equal(formAf(medMaal[i]), formAf(natur[i]),
      `tier ${medMaal[i].tier}: loebenes indbyrdes placering aendrede sig af maalet`);
  }
});

test("#5267: etaper pr. kalenderdato er uae­ndret (D4's 3 pr. rigtig dag, #4270)", () => {
  const natur = plan({ raceDayTarget: null });
  const medMaal = plan({ raceDayTarget: TARGET });
  for (let i = 0; i < medMaal.length; i++) {
    assert.equal(etaperPrDato(medMaal[i]), etaperPrDato(natur[i]),
      `tier ${medMaal[i].tier}: etaper pr. kalenderdato aendrede sig af maalet`);
  }
});

test("#5267: overlappet pr. loebsdag er uae­ndret (§1/#3329's gulv)", () => {
  const andel = (p) => {
    const per = new Map();
    for (const s of p.pools[0].stageRows) {
      if (!per.has(s.game_day)) per.set(s.game_day, new Set());
      per.get(s.game_day).add(s.pool_race_id);
    }
    const alle = [...per.values()];
    return alle.length ? alle.filter((s) => s.size >= 2).length / alle.length : 0;
  };
  const natur = plan({ raceDayTarget: null });
  const medMaal = plan({ raceDayTarget: TARGET });
  for (let i = 0; i < medMaal.length; i++) {
    assert.equal(andel(medMaal[i]), andel(natur[i]), `tier ${medMaal[i].tier}: overlap-andelen aendrede sig`);
  }
});

test("#5267: en loebsdag hoerer stadig til PRAECIS een kalenderdato (#4236)", () => {
  for (const t of plan({ raceDayTarget: TARGET })) {
    const datoer = new Map();
    for (const s of t.pools[0].stageRows) {
      if (!datoer.has(s.game_day)) datoer.set(s.game_day, new Set());
      datoer.get(s.game_day).add(String(s.scheduled_at).slice(0, 10));
    }
    for (const [g, d] of datoer) assert.equal(d.size, 1, `tier ${t.tier} loebsdag ${g} spaender ${d.size} datoer`);
  }
});

// ── De to regler der har faaet en NY ordlyd ─────────────────────────────────────────────

test("#5267: etaperne ligger i traek blandt loebsdage MED LOEB (ny ordlyd af ejer-reglen 25/8)", () => {
  for (const t of plan({ raceDayTarget: TARGET })) {
    const medLoeb = [...new Set(t.pools[0].stageRows.map((s) => s.game_day))].sort((a, b) => a - b);
    const rang = new Map(medLoeb.map((g, i) => [g, i]));
    const perLoeb = new Map();
    for (const s of t.pools[0].stageRows) {
      if (!perLoeb.has(s.pool_race_id)) perLoeb.set(s.pool_race_id, []);
      perLoeb.get(s.pool_race_id).push(rang.get(s.game_day));
    }
    for (const [id, r] of perLoeb) {
      const sorteret = [...r].sort((a, b) => a - b);
      const huller = sorteret[sorteret.length - 1] - sorteret[0] + 1 - sorteret.length;
      // Kun Grand Tours maa have huller, og kun deres hviledage (GRAND_TOUR_REST_DAYS = 2).
      // En tom loebsdag TAELLER IKKE som et hul: den er ikke en loebsdag med loeb.
      assert.ok(huller === 0 || (t.tier === 1 && huller <= 2),
        `tier ${t.tier} loeb ${id}: ${huller} hul(ler) blandt loebsdage MED loeb`);
    }
  }
});

test("#5267: en traeningsdag MAA ligge inde i et spaend — og det goer langt de fleste", () => {
  // Ny ordlyd af §1d. Tallet er ikke pyntet: det er selve prisen ejeren godkendte 20/9,
  // og en fremtidig aendring der goer den stoerre eller mindre skal vae­re synlig.
  for (const t of plan({ raceDayTarget: TARGET })) {
    if (!eksaktKvote(t) || !t.raceDayDeficit) continue;
    assert.ok(t.trainingDaysInsideStageRaceSpans > 0,
      `tier ${t.tier}: ingen traeningsdage inde i et spaend — saa er fordelingen ikke jaevn`);
    assert.ok(t.trainingDaysInsideStageRaceSpans <= t.trainingGameDayCount,
      `tier ${t.tier}: flere dage inde i spaend end der er traeningsdage`);
  }
});

// ── Fordelingen inden for en dato ───────────────────────────────────────────────────────

test("#5267: frie positioner foerst, og ikke som EEN klump", () => {
  // Fire naturlige loebsdage paa to datoer (2 pr. dato), eet etapeloeb der spaender
  // loebsdag 1-2 (altsaa henover position 2). Maal 6 = 3 pr. dato.
  const ud = padAxisWithTrainingDays({
    dateOfGameDay: [0, 0, 1, 1], spans: [[1, 2]], target: 6, days: 2,
  });
  assert.equal(ud.dateOfGameDay.length, 6, "aksen skal vaere 6 loebsdage lang");
  assert.deepEqual(ud.dateOfGameDay, [0, 0, 0, 1, 1, 1], "hver dato skal have praecis 3 loebsdage");
  // Dato 0 har positionerne 0 (fri) og 1 (fri: spaendet 1-2 daekker position 2, ikke 1).
  // Dato 1 har positionerne 2 (INDE i spaendet) og 3 (fri) — den frie skal vaelges foerst.
  assert.deepEqual(ud.trainingGameDays, [0, 4], "den ekstra dag paa dato 1 skal ligge paa den FRIE position");
});

test("#5267: naar der ikke er nok frie positioner, bruges positionerne inde i spaendet", () => {
  // Eet etapeloeb over alle tre loebsdage paa dato 0: position 1 og 2 er begge inde i
  // spaendet, og der ER ingen fri position paa den dato ud over 0 og G.
  const ud = padAxisWithTrainingDays({
    dateOfGameDay: [0, 0, 0], spans: [[0, 2]], target: 5, days: 1,
  });
  assert.equal(ud.dateOfGameDay.length, 5);
  assert.deepEqual(ud.dateOfGameDay, [0, 0, 0, 0, 0]);
  // Positionerne i dato-raekkefoelge: 0 (fri), 1 (inde), 2 (inde), 3 = G (fri, sidste dato).
  // Frie foerst (0 og 3), saa den ene resterende paa den foerste inde-position (1).
  assert.equal(ud.trainingGameDays.length, 2);
});

test("#5267: en dato med FLERE naturlige loebsdage end kvoten rapporteres, ikke skjules", () => {
  const ud = padAxisWithTrainingDays({
    dateOfGameDay: [0, 0, 0, 1], spans: [], target: 4, days: 2,
  });
  assert.deepEqual(ud.perDateDeviations, [{ date: 0, natural: 3, quota: 2 }]);
  // Padding kan ikke FJERNE en loebsdag, saa aksen bliver laengere end maalet — og §1d's
  // gate gaar roed paa netop det, i stedet for at tallet bliver pyntet her.
  assert.equal(ud.dateOfGameDay.length, 5);
});

test("#5267: et maal der ikke er et heltal afvises hoejlydt (CodeRabbit 15/9)", () => {
  // En brok kan pr. konstruktion ikke rammes af en akse der taelles i hele loebsdage.
  // Foer fixet gled den igennem og gav tavst en anden akse end den der blev bedt om.
  for (const ugyldigt of [140.5, Infinity]) {
    assert.throws(
      () => packLaneCalendar({
        stageRaces: [], oneDayRaces: [{ id: "a", stages: 1 }],
        density: 1, days: 2, overlapCap: 1, raceDayTarget: ugyldigt,
      }),
      /raceDayTarget skal vaere 0 eller et positivt heltal/,
      `${ugyldigt} skulle vaere afvist`,
    );
  }
});
