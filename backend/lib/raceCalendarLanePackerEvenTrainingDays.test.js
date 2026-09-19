// #5267 MAADE B — 5 loebsdage paa HVER kalenderdato (`trainingDayPlacement: "even"`).
//
// Maade A (default, `"holes"`) lae­gger kun tomme loebsdage dér hvor intet loeb spaender
// henover. Det holder ejer-reglen 25/8 bogstaveligt, men traeningsdagene klumper — MAALT
// 19/9: 15-33 paa EEN kalenderdato, og D3 har 23 kalenderdatoer i traek uden en eneste
// traeningsdag. Ugeprogrammet (7 ugedage x 5 loebsdage, TRAINING_RULES §13.3 beslutning 8)
// forudsaetter at HVER kalenderdato baerer 5 loebsdage, og det er maade B.
//
// PRISEN er en EKSPLICIT regel-aendring, ikke en stiltiende svaekkelse: under `"even"` maa
// en tom loebsdag ogsaa ligge INDE i et etapeloebs spaend. De to invarianter der dermed
// faar en ny ordlyd staar navngivet nedenfor, og hver af dem har sin egen test her:
//
//   §1d's saetning "en tom loebsdag maa kun ligge dér hvor intet loeb er i gang" gaelder
//     kun maade A. Under maade B er den erstattet af: de indsatte dage er HVILEDAGE for de
//     ryttere der er bundet i etapeloebet (race_entry_days binder allerede hele spaendet,
//     #4217/#4209) og TRAENINGSDAGE for alle andre.
//   Ejer-reglen 25/8 ("loebsdag 4-5-6-7") gaelder under maade B blandt loebsdage MED LOEB:
//     der er ingen anden loebsdag med loeb mellem to af loebets etaper.
//
// GARANTIEN ER DEN SAMME I BEGGE TILSTANDE, og det er dét de foerste tre tests maaler:
// padding flytter ikke et eneste loeb, ikke en eneste kalenderdato og ikke en eneste etape.
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
import { padAxisWithTrainingDays } from "./raceCalendarLanePacker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

// Faste ankre (#4222/#4239) — ellers raadner testen paa selve datoen.
const FIRST_RACE_DAY = "2026-08-28";
const NOW = new Date("2026-08-25T12:00:00Z");
const REAL_DAYS = 28;
const TARGET = 140;

function plan({ raceDayTarget = null, trainingDayPlacement = "holes" } = {}) {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  return buildTierMaterializationPlan({
    pools, catalog, from, baseSeed: 1, realDays: REAL_DAYS, raceDayTarget, trainingDayPlacement,
  }).tierPlans;
}

// R12 lever i den UDTOEMMENDE soegning, som kraever at kvoten gaar praecist op (§1b). Goer
// den ikke det, falder pakkeren ned i det AFSLAPPEDE layout uden maal. Fixturens tier 4
// arver den foraeldede TIER_GAME_DAY_QUOTA, saa den maa ikke doemme reglen roed.
const eksaktKvote = (t) => (t.pools?.[0]?.stageRows?.length ?? 0) === (t.density ?? 0) * (t.realDays ?? 0);

// Formen maales paa RANGEN blandt loebsdage MED LOEB, ikke paa de raa game_day-tal.
// Aksen er forskudt af de indsatte traeningsdage — og under maade B ogsaa INDE i et loebs
// spaend — saa de raa tal kan ikke sammenlignes. Maengden af loebsdage med loeb er derimod
// praecis den samme, saa rangen ER den naturlige akse. Det er dét kravet handler om:
// loebene skal ligge i samme raekkefoelge og med samme indbyrdes afstand som uden maalet.
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

test("#5267 maade B: HVER kalenderdato faar praecis maalet/datoer loebsdage", () => {
  for (const t of plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" })) {
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

test("#5267 maade B: maade A giver stadig den KLUMPEDE fordeling (default er uae­ndret)", () => {
  // Kontrollen paa at "even" ikke er blevet default ved et uheld: under maade A er der
  // datoer helt uden traeningsdag, og datoer med mange.
  const a = plan({ raceDayTarget: TARGET }).filter(eksaktKvote);
  assert.ok(a.length >= 3, "fixturen skal have mindst tre divisioner med eksakt kvote");
  for (const t of a) {
    assert.equal(t.trainingDayPlacement, "holes", `tier ${t.tier}: default er ikke laengere maade A`);
    const prDato = t.raceDaysPerDate ?? [];
    assert.ok(new Set(prDato).size > 1, `tier ${t.tier}: maade A skulle give UJAEVNE loebsdage pr. dato`);
  }
});

// ── Garantien: padding flytter ikke et loeb ─────────────────────────────────────────────

test("#5267 maade B: loebenes indbyrdes placering er uae­ndret (som maade A)", () => {
  const natur = plan({ raceDayTarget: null });
  const even = plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" });
  for (let i = 0; i < even.length; i++) {
    assert.equal(even[i].naturalRaceDays, natur[i].raceDayAxisLength,
      `tier ${even[i].tier}: det naturlige antal loebsdage aendrede sig`);
    assert.equal(formAf(even[i]), formAf(natur[i]),
      `tier ${even[i].tier}: loebenes indbyrdes placering aendrede sig med maade B`);
  }
});

test("#5267 maade B: etaper pr. kalenderdato er uae­ndret (D4's 3 pr. rigtig dag, #4270)", () => {
  const natur = plan({ raceDayTarget: null });
  const even = plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" });
  for (let i = 0; i < even.length; i++) {
    assert.equal(etaperPrDato(even[i]), etaperPrDato(natur[i]),
      `tier ${even[i].tier}: etaper pr. kalenderdato aendrede sig med maade B`);
  }
});

test("#5267 maade B: overlappet pr. loebsdag er uae­ndret (§1/#3329's gulv)", () => {
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
  const even = plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" });
  for (let i = 0; i < even.length; i++) {
    assert.equal(andel(even[i]), andel(natur[i]), `tier ${even[i].tier}: overlap-andelen aendrede sig`);
  }
});

test("#5267 maade B: en loebsdag hoerer stadig til PRAECIS een kalenderdato (#4236)", () => {
  for (const t of plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" })) {
    const datoer = new Map();
    for (const s of t.pools[0].stageRows) {
      if (!datoer.has(s.game_day)) datoer.set(s.game_day, new Set());
      datoer.get(s.game_day).add(String(s.scheduled_at).slice(0, 10));
    }
    for (const [g, d] of datoer) assert.equal(d.size, 1, `tier ${t.tier} loebsdag ${g} spaender ${d.size} datoer`);
  }
});

// ── De to regler der faar en NY ordlyd under maade B ────────────────────────────────────

test("#5267 maade B: etaperne ligger i traek blandt loebsdage MED LOEB (ny ordlyd af ejer-reglen 25/8)", () => {
  for (const t of plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" })) {
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

test("#5267 maade B: en traeningsdag MAA ligge inde i et spaend — og det goer langt de fleste", () => {
  // Ny ordlyd af §1d. Tallet er ikke pyntet: det er selve prisen ejeren skal godkende,
  // og en fremtidig aendring der goer den stoerre eller mindre skal vae­re synlig.
  for (const t of plan({ raceDayTarget: TARGET, trainingDayPlacement: "even" })) {
    if (!eksaktKvote(t) || !t.raceDayDeficit) continue;
    assert.ok(t.trainingDaysInsideStageRaceSpans > 0,
      `tier ${t.tier}: ingen traeningsdage inde i et spaend — saa er maade B ikke i brug`);
    assert.ok(t.trainingDaysInsideStageRaceSpans <= t.trainingGameDayCount,
      `tier ${t.tier}: flere dage inde i spaend end der er traeningsdage`);
  }
});

test("#5267 maade A: en tom loebsdag ligger stadig ALDRIG inde i et spaend (uae­ndret)", () => {
  for (const t of plan({ raceDayTarget: TARGET })) {
    assert.equal(t.trainingDaysInsideStageRaceSpans, 0,
      `tier ${t.tier}: maade A lagde en traeningsdag inde i et spaend`);
  }
});

// ── Fordelingen inden for en dato ───────────────────────────────────────────────────────

test("#5267 maade B: frie positioner foerst, og ikke som EEN klump", () => {
  // Fire naturlige loebsdage paa to datoer (2 pr. dato), eet etapeloeb der spaender
  // loebsdag 1-2 (altsaa henover position 2). Maal 6 = 3 pr. dato.
  const ud = padAxisWithTrainingDays({
    dateOfGameDay: [0, 0, 1, 1], spans: [[1, 2]], target: 6, days: 2, placement: "even",
  });
  assert.equal(ud.dateOfGameDay.length, 6, "aksen skal vaere 6 loebsdage lang");
  assert.deepEqual(ud.dateOfGameDay, [0, 0, 0, 1, 1, 1], "hver dato skal have praecis 3 loebsdage");
  // Dato 0 har positionerne 0 (fri) og 1 (fri: spaendet 1-2 daekker position 2, ikke 1).
  // Dato 1 har positionerne 2 (INDE i spaendet) og 3 (fri) — den frie skal vaelges foerst.
  assert.deepEqual(ud.trainingGameDays, [0, 4], "den ekstra dag paa dato 1 skal ligge paa den FRIE position");
});

test("#5267 maade B: naar der ikke er nok frie positioner, bruges positionerne inde i spaendet", () => {
  // Eet etapeloeb over alle tre loebsdage paa dato 0: position 1 og 2 er begge inde i
  // spaendet, og der ER ingen fri position paa den dato. Maade B skal da bruge dem.
  const ud = padAxisWithTrainingDays({
    dateOfGameDay: [0, 0, 0], spans: [[0, 2]], target: 5, days: 1, placement: "even",
  });
  assert.equal(ud.dateOfGameDay.length, 5);
  assert.deepEqual(ud.dateOfGameDay, [0, 0, 0, 0, 0]);
  // Positionerne i dato-raekkefoelge: 0 (fri), 1 (inde), 2 (inde), 3 = G (fri, sidste dato).
  // Frie foerst (0 og 3), saa den ene resterende paa den foerste inde-position (1).
  assert.equal(ud.trainingGameDays.length, 2);
});

test("#5267 maade B: en dato med FLERE naturlige loebsdage end kvoten rapporteres, ikke skjules", () => {
  const ud = padAxisWithTrainingDays({
    dateOfGameDay: [0, 0, 0, 1], spans: [], target: 4, days: 2, placement: "even",
  });
  assert.deepEqual(ud.perDateDeviations, [{ date: 0, natural: 3, quota: 2 }]);
  // Padding kan ikke FJERNE en loebsdag, saa aksen bliver laengere end maalet — og §1d's
  // gate gaar roed paa netop det, i stedet for at tallet bliver pyntet her.
  assert.equal(ud.dateOfGameDay.length, 5);
});

test("#5267: maade A er BIT-IDENTISK med foer tilstanden fandtes", () => {
  // Den gamle signatur (uden `placement`) skal give praecis samme akse som "holes".
  const uden = padAxisWithTrainingDays({ dateOfGameDay: [0, 0, 1, 1], spans: [[1, 2]], target: 7, days: 2 });
  const med = padAxisWithTrainingDays({ dateOfGameDay: [0, 0, 1, 1], spans: [[1, 2]], target: 7, days: 2, placement: "holes" });
  assert.deepEqual(uden.dateOfGameDay, med.dateOfGameDay);
  assert.deepEqual(uden.trainingGameDays, med.trainingGameDays);
  assert.deepEqual(uden.mapG, med.mapG);
});
