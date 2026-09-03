// #4203 — monument-pakkeren: HVOR et monument lander.
//
// Tre regler, alle §4 i docs/CALENDAR_RULES.md, alle bindinger i pakkerens soegning
// (R9-R11 i raceCalendarLanePacker.js):
//
//   R9  et monument ligger ALDRIG inde i et Grand Tours LOEBSDAGS-spaend (game_day)
//   R10 mindst MONUMENT_MIN_CALENDAR_GAP_DAYS KALENDERDAGE mellem to nabo-monumenter
//   R11 mindst MONUMENT_MIN_CALENDAR_SPREAD_DAYS kalenderdage fra foerste til sidste
//
// AKSERNE ER FORSKELLIGE MED VILJE (§0 + §4, ejer-beslutning 3/9 = valg B): R9 maales paa
// loebsdage, fordi det er loebsdagen der binder rytteren; R10/R11 paa kalenderdage, fordi
// det er kalenderen spilleren ser. De maa aldrig blandes sammen.
//
// HVAD DER IKKE STAAR HER. Et monument har IKKE en eksklusiv loebsdag. Reglen fandtes
// (#4075, ejer-laast 21/8), men blev OPHAEVET 26/8 af #4236, fordi #4217's spaend-binding
// havde gjort den virkningsloes (0 delte ryttere maalt i alle ni monument/etapeloeb-
// kombinationer) mens den stadig rev hul i fem D1-etapeloebs loebsdage. Testen
// "#4236: et monument deler loebsdag frem for at rive hul i et etapeloeb" i
// raceCalendarLanePackerGameDayBands.test.js vogter det modsatte af eksklusivitet.
// Det #4203 tilfoejer er at to MONUMENTER aldrig deler loebsdag - det foelger af R10,
// og det maales eksplicit nedenfor.
//
// Refs #4203 #4236 #4270 #4075

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { packLaneCalendar } from "./raceCalendarLanePacker.js";
import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";
import { detectMonumentsInsideGrandTours } from "./calendarPlacementGates.js";
import {
  MONUMENT_MIN_CALENDAR_GAP_DAYS, MONUMENT_MIN_CALENDAR_SPREAD_DAYS,
} from "./calendarTierCaps.js";
import { GRAND_TOUR_MIN_STAGES } from "./grandTourRestDays.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

// ── Syntetisk D1: kvoten gaar op praecis (5 x 28 = 140 etaper) ───────────────────────
// To Grand Tours paa 17 etaper (+2 hviledage hver) + etapeloeb + endagsloeb + 5 monumenter.
// Bevidst rummelig: pointen er at maale HVOR monumenterne lander, ikke om pakningen findes.
function syntetiskD1() {
  const stageRaces = [];
  stageRaces.push({ id: "gt-a", name: "GT A", race_class: "GrandTour", stages: 17, seasonFraction: 0.15 });
  stageRaces.push({ id: "gt-b", name: "GT B", race_class: "GrandTour", stages: 17, seasonFraction: 0.60 });
  const etapeloeb = [6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3];
  etapeloeb.forEach((st, i) => stageRaces.push({
    id: `sr-${String(i).padStart(2, "0")}`, name: `SR ${i}`, race_class: "ProSeries",
    stages: st, seasonFraction: (i + 1) / (etapeloeb.length + 1),
  }));

  const oneDayRaces = [];
  // Monument-fractions i den ÆGTE monument-kronologi (Sanremo -> Ronde -> Roubaix ->
  // Liege -> Lombardia), saa identitets-tildelingen kan verificeres.
  const monumenter = [
    ["mon-sanremo", 0.10], ["mon-ronde", 0.24], ["mon-roubaix", 0.28],
    ["mon-liege", 0.32], ["mon-lombardia", 0.78],
  ];
  for (const [id, f] of monumenter) {
    oneDayRaces.push({ id, name: id, race_class: "Monuments", stages: 1, seasonFraction: f });
  }
  const antalKlassikere = 140 - stageRaces.reduce((n, r) => n + r.stages, 0) - monumenter.length;
  for (let i = 0; i < antalKlassikere; i++) {
    oneDayRaces.push({
      id: `od-${String(i).padStart(2, "0")}`, name: `OD ${i}`, race_class: "OtherWorldTourB",
      stages: 1, seasonFraction: (i + 1) / (antalKlassikere + 1),
    });
  }
  return { stageRaces, oneDayRaces };
}

function pak() {
  const { stageRaces, oneDayRaces } = syntetiskD1();
  return packLaneCalendar({
    stageRaces, oneDayRaces, density: 5, days: 28, overlapCap: 3, spineMinStages: 15,
  });
}

function monumentRaekker(packed) {
  return packed.placements
    .filter((p) => p.race_class === "Monuments")
    .map((p) => ({
      id: p.id,
      gameDay: p.stagesPlaced[0].game_day,
      realDay: p.stagesPlaced[0].real_day,
    }))
    .sort((a, b) => a.realDay - b.realDay || a.gameDay - b.gameDay);
}

function gtLoebsdagsSpaend(packed) {
  return packed.placements
    .filter((p) => (p.stages ?? 1) >= GRAND_TOUR_MIN_STAGES)
    .map((p) => ({
      id: p.id,
      first: Math.min(...p.stagesPlaced.map((s) => s.game_day)),
      last: Math.max(...p.stagesPlaced.map((s) => s.game_day)),
    }));
}

test("#4203 R9: intet monument ligger inde i et Grand Tours løbsdags-spænd", () => {
  const packed = pak();
  assert.equal(packed.monumentRulesHeld, true, "pakningen skal findes MED monument-reglerne");

  const spaend = gtLoebsdagsSpaend(packed);
  assert.equal(spaend.length, 2, "fixturen skal have to Grand Tours, ellers tester vi ingenting");

  const inde = monumentRaekker(packed).filter(
    (m) => spaend.some((g) => m.gameDay >= g.first && m.gameDay <= g.last),
  );
  assert.deepEqual(
    inde.map((m) => `${m.id}@løbsdag ${m.gameDay}`), [],
    `monument inde i et GT-spænd (${spaend.map((g) => `${g.id} ${g.first}-${g.last}`).join(", ")})`,
  );
  assert.equal(packed.monuments.insideGrandTour, 0, "pakkerens egen diagnostik skal sige det samme");
});

test("#4203 R10: mindst to kalenderdage mellem to nabo-monumenter — og aldrig samme løbsdag", () => {
  const packed = pak();
  const mon = monumentRaekker(packed);
  assert.equal(mon.length, 5, "alle fem monumenter skal placeres");

  const forTaet = [];
  for (let i = 1; i < mon.length; i++) {
    const gap = mon[i].realDay - mon[i - 1].realDay;
    if (gap < MONUMENT_MIN_CALENDAR_GAP_DAYS) forTaet.push(`${mon[i - 1].id} -> ${mon[i].id}: ${gap} dag(e)`);
  }
  assert.deepEqual(forTaet, [], `nabopar under ${MONUMENT_MIN_CALENDAR_GAP_DAYS} kalenderdage`);
  assert.ok(packed.monuments.minGapDays >= MONUMENT_MIN_CALENDAR_GAP_DAYS);

  // Foelger af R10 (to kalenderdage imellem kan ikke rummes i een loebsdag), men maales
  // for sig: det er den halvdel af #4075 der overlevede #4236's ophaevelse.
  const loebsdage = mon.map((m) => m.gameDay);
  assert.equal(new Set(loebsdage).size, loebsdage.length, `to monumenter deler løbsdag: ${loebsdage.join(", ")}`);
});

test("#4203 R11: monumenterne spænder over mindst fjorten kalenderdage", () => {
  const packed = pak();
  const mon = monumentRaekker(packed);
  const spredning = mon[mon.length - 1].realDay - mon[0].realDay;
  assert.ok(
    spredning >= MONUMENT_MIN_CALENDAR_SPREAD_DAYS,
    `monumenterne spænder kun ${spredning} kalenderdage (krav ${MONUMENT_MIN_CALENDAR_SPREAD_DAYS})`,
  );
  assert.equal(packed.monuments.spreadDays, spredning);
});

test("#4203: monumenterne beholder deres indbyrdes kronologi (Sanremo → … → Lombardia)", () => {
  const packed = pak();
  const raekkefoelge = monumentRaekker(packed).map((m) => m.id);
  assert.deepEqual(
    raekkefoelge,
    ["mon-sanremo", "mon-ronde", "mon-roubaix", "mon-liege", "mon-lombardia"],
    "identiteterne skal paasaettes i seasonFraction-raekkefoelge inden for monument-gruppen",
  );
});

test("#4203: reglerne rører ikke de øvrige invarianter (kvote, tæthed, cap, intet tabt)", () => {
  const packed = pak();
  assert.equal(packed.emptyDays, 0, "ingen tom kalenderdag");
  assert.ok(packed.load.every((n) => n === 5), `tætheden skal være 5 hver dag: ${packed.load.join(",")}`);
  assert.ok(packed.maxOverlap <= 3, `overlap-cap brudt: ${packed.maxOverlap}`);
  assert.deepEqual(packed.unplaced, []);
  assert.deepEqual(packed.leftoverSingles, []);
  assert.equal(packed.placements.reduce((n, p) => n + p.stagesPlaced.length, 0), 140);
});

test("#4203: deterministisk — to kørsler giver identisk monument-placering", () => {
  assert.deepEqual(pak().monuments, pak().monuments);
});

test("#4203: uden monumenter er reglerne inaktive og pakningen uændret", () => {
  const { stageRaces, oneDayRaces } = syntetiskD1();
  const udenMonumenter = oneDayRaces
    .filter((r) => r.race_class !== "Monuments")
    .concat(oneDayRaces.filter((r) => r.race_class === "Monuments")
      .map((r) => ({ ...r, race_class: "OtherWorldTourA" })));
  const packed = packLaneCalendar({
    stageRaces, oneDayRaces: udenMonumenter, density: 5, days: 28, overlapCap: 3, spineMinStages: 15,
  });
  assert.equal(packed.monumentRulesHeld, false, "ingen monumenter ⇒ intet monument-bundet forsøg");
  assert.equal(packed.monuments.count, 0);
  assert.equal(packed.emptyDays, 0);
});

// ── Mod prods eget katalog: den kalender S4 faktisk ville faa ────────────────────────

test("#4203 mod prod-kataloget: D1's fem monumenter er ude af GT-vinduerne og korrekt spredt", () => {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: "2026-09-28", now: new Date("2026-09-20T12:00:00Z") });
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, realDays: 28 });
  const plan = tierPlans.find((p) => p.tier === 1);
  const pool = plan.pools[0];

  // Selve den gate der stopper --apply (calendarPlacementGates.js), koert paa planens
  // to-akse-form - ikke en gentagelse af pakkerens egen regnemaade.
  assert.deepEqual(
    detectMonumentsInsideGrandTours({ tier: 1, raceRows: pool.raceRows, stageRows: pool.stageRows }),
    [],
  );

  const meta = new Map(pool.raceRows.map((r) => [r.pool_race_id, r]));
  const datoer = pool.stageRows
    .filter((s) => meta.get(s.pool_race_id)?.race_class === "Monuments")
    .map((s) => ({ navn: meta.get(s.pool_race_id).name, d: String(s.scheduled_at).slice(0, 10) }))
    .sort((a, b) => a.d.localeCompare(b.d));

  assert.equal(datoer.length, 5, "D1 skal have alle fem monumenter");
  for (let i = 1; i < datoer.length; i++) {
    const gap = (Date.parse(datoer[i].d) - Date.parse(datoer[i - 1].d)) / 86_400_000;
    assert.ok(
      gap >= MONUMENT_MIN_CALENDAR_GAP_DAYS,
      `${datoer[i - 1].navn} (${datoer[i - 1].d}) og ${datoer[i].navn} (${datoer[i].d}) ligger ${gap} dag(e) fra hinanden`,
    );
  }
  const spredning = (Date.parse(datoer[4].d) - Date.parse(datoer[0].d)) / 86_400_000;
  assert.ok(spredning >= MONUMENT_MIN_CALENDAR_SPREAD_DAYS, `spredning ${spredning} dage`);

  assert.equal(plan.monumentRulesHeld, true, "D1's pakning skal findes MED reglerne aktive");
});

test("#4203 mod prod-kataloget: monument-rækkefølgen er Sanremo → Ronde → Roubaix → Liège → Lombardia", () => {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: "2026-09-28", now: new Date("2026-09-20T12:00:00Z") });
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, realDays: 28 });
  const pool = tierPlans.find((p) => p.tier === 1).pools[0];
  const meta = new Map(pool.raceRows.map((r) => [r.pool_race_id, r]));

  const navne = pool.stageRows
    .filter((s) => meta.get(s.pool_race_id)?.race_class === "Monuments")
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    .map((s) => meta.get(s.pool_race_id).name);

  // Katalogets date_text: Milano-Riviera 21/3 · De Vlaamse Ronde 5/4 · L'Enfer du Nord
  // 12/4 · La Doyenne des Ardennes 26/4 · La Classica d'Autunno 10/10.
  assert.deepEqual(navne, [
    "Milano–Riviera", "De Vlaamse Ronde", "L'Enfer du Nord",
    "La Doyenne des Ardennes", "La Classica d'Autunno",
  ]);
});

test("#4203: er reglerne uopfyldelige, siger pakkeren det — den lyver ikke grønt", () => {
  // En saeson paa 10 kalenderdage kan pr. konstruktion ikke give fem monumenter en
  // spredning paa 14 dage (R11). Basis-pakningen er derimod fint loesbar, saa vi maaler
  // praecis det vi vil maale: hvad sker der naar monument-reglerne IKKE kan holdes.
  const DAGE = 10, TAETHED = 5;
  const stageRaces = [{ id: "gt-a", name: "GT A", race_class: "GrandTour", stages: 17, seasonFraction: 0.3 }];
  [5, 5, 4, 4].forEach((st, i) => stageRaces.push({
    id: `sr-${i}`, name: `SR ${i}`, race_class: "ProSeries", stages: st, seasonFraction: (i + 1) / 5,
  }));
  const oneDayRaces = [];
  for (let i = 0; i < 5; i++) {
    oneDayRaces.push({ id: `mon-${i}`, name: `Mon ${i}`, race_class: "Monuments", stages: 1, seasonFraction: (i + 1) / 6 });
  }
  const rest = DAGE * TAETHED - stageRaces.reduce((n, r) => n + r.stages, 0) - 5;
  for (let i = 0; i < rest; i++) {
    oneDayRaces.push({ id: `od-${String(i).padStart(2, "0")}`, name: `OD ${i}`, race_class: "OtherWorldTourB", stages: 1, seasonFraction: (i + 1) / (rest + 1) });
  }

  const packed = packLaneCalendar({
    stageRaces, oneDayRaces, density: TAETHED, days: DAGE, overlapCap: 3, spineMinStages: 15,
  });

  assert.equal(packed.monumentRulesHeld, false, "reglerne kan ikke holdes paa 10 dage");
  const medRegler = packed.solveAttempts.find((f) => f.rules === true);
  assert.equal(medRegler?.ok, false, "det monument-bundne forsøg skal rapporteres som mislykket");
  assert.equal(packed.solveAttempts.some((f) => f.rules === false && f.ok), true, "andet forsøg leverer kalenderen");

  // Kalenderen bygges alligevel - ellers ville en placerings-regel koste den EKSAKTE
  // kvote (§1b) - men afvigelsen er SYNLIG i pakkerens egen diagnostik og faelder
  // scorecardets §4-maaling. Det er forskellen paa en fallback og en fortielse.
  assert.ok(
    packed.monuments.spreadDays < MONUMENT_MIN_CALENDAR_SPREAD_DAYS,
    "afvigelsen skal kunne maales, ikke forsvinde i fallbacken",
  );
  assert.equal(packed.monuments.count, 5, "ingen monumenter tabes af fallbacken");
  assert.equal(packed.emptyDays, 0, "den eksakte kvote maa ikke betales for en placerings-regel");
  assert.deepEqual(packed.unplaced, []);
  assert.deepEqual(packed.leftoverSingles, []);
});
