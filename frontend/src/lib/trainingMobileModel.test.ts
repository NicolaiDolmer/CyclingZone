import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRaceDayColumns,
  canShowScoreColumn,
  countsForRole,
  expandScrollAdjustment,
  isSingleRaceDay,
  latestScore,
  MOBILE_CARD_PEEK,
  mobileScoreCell,
  pacePerWeek,
  programGrid,
  riderShortName,
  scoreSortValue,
} from "./trainingMobileModel.ts";

// #3643 — mobilformen er tabel med dagens LOEBSDAGE som kolonner. Reglerne her
// er dem der goer formen sikker mod at loebsdags-modellen endnu ikke koerer i
// prod: aldrig nul kolonner, aldrig et haardkodet saeson-tal, og een kolonne
// naar flaget er OFF.

test("flag OFF (ingen loebsdags-tal) giver PRAECIS een kolonne", () => {
  const cols = buildRaceDayColumns();
  assert.equal(cols.length, 1);
  assert.equal(cols[0].index, 1);
  assert.equal(cols[0].state, "now");
  assert.equal(isSingleRaceDay(cols), true);
});

test("een kolonne er 'done' naar dagen er afregnet", () => {
  const [col] = buildRaceDayColumns({ settled: true });
  assert.equal(col.state, "done");
});

test("flag ON: een kolonne pr. loebsdag, med den aabne markeret", () => {
  const cols = buildRaceDayColumns({ raceDayCount: 4, currentIndex: 3 });
  assert.equal(cols.length, 4);
  assert.deepEqual(cols.map((c) => c.state), ["done", "done", "now", "upcoming"]);
  assert.equal(isSingleRaceDay(cols), false);
});

test("designet baerer 1-5 loebsdage og klamper derover", () => {
  assert.equal(buildRaceDayColumns({ raceDayCount: 1 }).length, 1);
  assert.equal(buildRaceDayColumns({ raceDayCount: 5 }).length, 5);
  // Flere end tabellen kan tegne uden vandret scroll paa 375 px: klampes, i
  // stedet for at skubbe kolonner ud over skaermkanten.
  assert.equal(buildRaceDayColumns({ raceDayCount: 9 }).length, 5);
});

test("vraevl fra serveren falder tilbage til een kolonne, aldrig nul", () => {
  for (const raceDayCount of [0, -3, Number.NaN, null, undefined]) {
    assert.equal(buildRaceDayColumns({ raceDayCount }).length, 1, String(raceDayCount));
  }
});

test("riderShortName forkorter fornavnet, ikke efternavnet", () => {
  assert.equal(riderShortName({ firstname: "Mathias", lastname: "Sørensen" }), "M. Sørensen");
  assert.equal(riderShortName({ firstname: "", lastname: "Bakker" }), "Bakker");
  assert.equal(riderShortName({ firstname: "Ada", lastname: "" }), "Ada");
  assert.equal(riderShortName(null), "");
});

test("countsForRole giver rollens evner, taettest-vejede foerst - og aldrig vaegtene", () => {
  const recipes = [{ key: "sprinter", weights: { sprint: 4, acceleration: 3, flat: 2, durability: 1 } }];
  const rows = countsForRole(recipes, "sprinter", { sprint: 71, acceleration: 58, flat: 66, durability: 44 }, ["durability"]);
  assert.deepEqual(rows.map((r) => r.ability), ["sprint", "acceleration", "flat", "durability"]);
  assert.deepEqual(rows.map((r) => r.value), [71, 58, 66, 44]);
  assert.deepEqual(rows.map((r) => r.atCap), [false, false, false, true]);
  for (const row of rows) assert.equal("weight" in row, false);
});

test("countsForRole er tom uden rolle eller uden opskrift", () => {
  assert.deepEqual(countsForRole([], null, {}, []), []);
  assert.deepEqual(countsForRole([{ key: "sprinter", weights: { sprint: 4 } }], "climber", {}, []), []);
});

test("en evne paa loftet kommer altid med, ogsaa uden for limit", () => {
  const recipes = [{ key: "sprinter", weights: { sprint: 4, acceleration: 3, positioning: 2, flat: 2, durability: 1 } }];
  const rows = countsForRole(recipes, "sprinter", { sprint: 71, durability: 44 }, ["durability"], 3);
  assert.deepEqual(rows.map((r) => r.ability), ["sprint", "acceleration", "positioning", "durability"]);
  assert.equal(rows[rows.length - 1].atCap, true);
  // Ingen dubletter naar den laaste evne allerede laa inden for limit.
  const inside = countsForRole(recipes, "sprinter", {}, ["sprint"], 3);
  assert.deepEqual(inside.map((r) => r.ability), ["sprint", "acceleration", "positioning"]);
});

test("countsForRole giver null-vaerdi naar evnen mangler paa raekken", () => {
  const rows = countsForRole([{ key: "tt", weights: { time_trial: 5 } }], "tt", {}, []);
  assert.equal(rows[0].value, null);
});

test("en NULL-kolonne er 'mangler', ikke et maalt nul", () => {
  const recipes = [{ key: "tt", weights: { time_trial: 5, tempo: 2 } }];
  const rows = countsForRole(recipes, "tt", { time_trial: null, tempo: 0 }, []);
  assert.equal(rows[0].value, null, "null → —");
  assert.equal(rows[1].value, 0, "et aegte 0 er stadig et tal");
});

test("pacePerWeek er en hastighed, ikke en ankomsttid", () => {
  assert.equal(pacePerWeek({ gainedPoints: 7, daysElapsed: 14 }), 3.5);
  assert.equal(pacePerWeek({ gainedPoints: 2, daysElapsed: 21 }), 0.7);
});

test("pacePerWeek tier naar grundlaget er for tyndt", () => {
  assert.equal(pacePerWeek({ gainedPoints: 3, daysElapsed: 2 }), null);
  assert.equal(pacePerWeek({ gainedPoints: null, daysElapsed: 30 }), null);
  assert.equal(pacePerWeek({ gainedPoints: 5, daysElapsed: null }), null);
});

test("programGrid er N loebsdage x 7 ugedage", () => {
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const grid = programGrid(weekdays, buildRaceDayColumns({ raceDayCount: 4 }), () => "normal");
  assert.equal(grid.length, 4);
  for (const row of grid) assert.equal(row.length, 7);
  assert.equal(grid[2][0].raceDay, 3);
  assert.equal(grid[0][6].weekday, "sun");
});

test("programGrid falder tilbage til een raekke uden kolonner", () => {
  const grid = programGrid(["mon"], [], () => "easy");
  assert.equal(grid.length, 1);
  assert.equal(grid[0][0].intensity, "easy");
});

// #4851 — traeningsscoren paa telefonen. De tre tilstande skal vaere PRAECIS de
// samme som desktop-kolonnen viser, ellers siger to flader forskelligt om den
// samme dag.

test("mobileScoreCell: dagens tal vinder", () => {
  assert.deepEqual(mobileScoreCell({ today: 63 }), { state: "score", value: 63 });
  // En loebsdag hvor motoren FAKTISK maalte passet skal vise tallet, ikke ordet.
  assert.deepEqual(mobileScoreCell({ today: 71, todayIsRaceDay: true }), { state: "score", value: 71 });
  // 1 og 99 er gyldige tal og maa ikke falde igennem som "falsy"/ude af skala.
  assert.deepEqual(mobileScoreCell({ today: 1 }), { state: "score", value: 1 });
  assert.deepEqual(mobileScoreCell({ today: 99 }), { state: "score", value: 99 });
});

test("mobileScoreCell: loebsdag uden tal skriver 'loeb'", () => {
  assert.deepEqual(mobileScoreCell({ today: null, todayIsRaceDay: true }), { state: "race" });
});

test("mobileScoreCell: ingen maaling er en streg, aldrig et maalt nul", () => {
  assert.deepEqual(mobileScoreCell(null), { state: "none" });
  assert.deepEqual(mobileScoreCell(undefined), { state: "none" });
  assert.deepEqual(mobileScoreCell({}), { state: "none" });
  // `Number(null)` er 0 og finite — uden det eksplicitte null-tjek ville en
  // hviledag staa som et maalt 0 i stedet for en streg.
  assert.deepEqual(mobileScoreCell({ today: null }), { state: "none" });
  assert.deepEqual(mobileScoreCell({ today: Number.NaN }), { state: "none" });
  // Et maalt 0 findes ikke i modellen (skalaen er 1-99), men hvis det kom, er
  // det et TAL og skal vises som et - ikke skjules bag en streg.
  assert.deepEqual(mobileScoreCell({ today: 0 }), { state: "score", value: 0 });
});

// #5485 (ejer-valg A 23/9): foer dagens pas er koert, har ingen rytter et tal
// for i dag. Kolonnen skal da vise det SENESTE maalte tal (daempet), ikke en
// streg hele vejen ned.
const SPARK_WITH_REST = [
  { date: "2026-09-20", score: 48 },
  { date: "2026-09-21", score: 61 },
  // Hviledag og loebsdag har intet tal og maa aldrig blive "seneste".
  { date: "2026-09-22", score: null },
  { date: "2026-09-22", score: null, raceDay: true },
];

test("latestScore: sidste punkt MED et tal, hviledage og loebsdage springes over", () => {
  assert.equal(latestScore(SPARK_WITH_REST), 61);
  assert.equal(latestScore([]), null);
  assert.equal(latestScore(null), null);
  assert.equal(latestScore([{ date: "2026-09-22", score: null }]), null);
});

test("#5485 mobileScoreCell foer dagens pas: seneste tal, daempet; efter passet: dagens tal eller streg", () => {
  // Foer passet (settled false): seneste tal.
  assert.deepEqual(mobileScoreCell({ today: null, spark: SPARK_WITH_REST }, { settled: false }), { state: "latest", value: 61 });
  // Ingen historik: stadig en streg.
  assert.deepEqual(mobileScoreCell({ today: null, spark: [] }, { settled: false }), { state: "none" });
  // Dagens tal vinder altid, ogsaa hvis holdets todayRun endnu ikke er hentet.
  assert.deepEqual(mobileScoreCell({ today: 70, spark: SPARK_WITH_REST }, { settled: false }), { state: "score", value: 70 });
  // En loebsdag i dag er "Race", ikke gaarsdagens tal.
  assert.deepEqual(mobileScoreCell({ today: null, todayIsRaceDay: true, spark: SPARK_WITH_REST }, { settled: false }), { state: "race" });
  // Efter passet (settled true, default): intet tal = hviledag = streg.
  assert.deepEqual(mobileScoreCell({ today: null, spark: SPARK_WITH_REST }), { state: "none" });
  assert.deepEqual(mobileScoreCell({ today: null, spark: SPARK_WITH_REST }, { settled: true }), { state: "none" });
});

test("#5485 scoreSortValue: sorteringen bruger dagens tal, ellers det seneste; loeb og streg er null", () => {
  assert.equal(scoreSortValue({ state: "score", value: 70 }), 70);
  assert.equal(scoreSortValue({ state: "latest", value: 61 }), 61);
  assert.equal(scoreSortValue({ state: "race" }), null);
  assert.equal(scoreSortValue({ state: "none" }), null);
  assert.equal(scoreSortValue(null), null);
});

test("score-kolonnen holder budgettet 'navn + hoejst 3 datakolonner'", () => {
  // Flaget OFF ⇒ een loebsdags-kolonne ⇒ der er plads (1 + score = 2).
  assert.equal(canShowScoreColumn(buildRaceDayColumns()), true);
  assert.equal(canShowScoreColumn(buildRaceDayColumns({ raceDayCount: 2 })), true);
  // 3+ loebsdage ⇒ scoren ville vaere den 4. datakolonne og presse tabellen
  // ud over 375 px. Den falder ud af TABELLEN og staar i kortet i stedet.
  assert.equal(canShowScoreColumn(buildRaceDayColumns({ raceDayCount: 3 })), false);
  assert.equal(canShowScoreColumn(buildRaceDayColumns({ raceDayCount: 5 })), false);
  assert.equal(canShowScoreColumn([]), true);
  assert.equal(canShowScoreColumn(null), true);
});

// ── Kortet folder ud lige under rytteren (#3643, ejer 21/9) ─────────────────
//
// Maalene nedenfor er en telefon paa 412x915 med den faste bundnavigation
// (MobileQuickNav, 56 px) — altsaa `safeBottom = 915 - 56 = 859`.

const SAFE_BOTTOM = 915 - 56;

test("intet at rette: raekken og kortets foerste linje staar allerede synlige", () => {
  assert.equal(
    expandScrollAdjustment({ rowTop: 300, rowBottom: 356, cardBottom: 700, safeBottom: SAFE_BOTTOM }),
    0,
  );
});

test("raekken er hoppet op over kanten (et kort OVER den lukkede) — rul op til den", () => {
  // Det er hele grunden til at funktionen findes: den raekke fingeren lige ramte
  // maa ikke forsvinde ud af syne fordi hoejden over den forsvandt.
  assert.equal(
    expandScrollAdjustment({ rowTop: -120, rowBottom: -64, cardBottom: 400, safeBottom: SAFE_BOTTOM }),
    -120,
  );
});

test("kortets top er gemt bag bundnavigationen — rul praecis saa langt ned", () => {
  // rowBottom 850 + 44 px udsyn = 894, som er 35 px under den synlige kant.
  assert.equal(
    expandScrollAdjustment({ rowTop: 800, rowBottom: 850, cardBottom: 1400, safeBottom: SAFE_BOTTOM }),
    35,
  );
});

test("et kort lavere end udsynet kraever kun at kortet selv er synligt", () => {
  // Kortet slutter 860 — 1 px bag bundnav'en. Der rulles 1 px, ikke 44.
  assert.equal(
    expandScrollAdjustment({ rowTop: 790, rowBottom: 840, cardBottom: 860, safeBottom: SAFE_BOTTOM }),
    1,
  );
});

test("raekken vejer tungere end kortets udsyn: der rulles aldrig saa langt at raekken ryger ud over toppen", () => {
  // Uden loftet ville der blive rullet 40 px ned og raekkens top (20) havne paa
  // -20. Svaret er derfor 20: raekkens top lander praecis paa kanten.
  assert.equal(
    expandScrollAdjustment({ rowTop: 20, rowBottom: 855, cardBottom: 1500, safeBottom: SAFE_BOTTOM }),
    20,
  );
});

test("et sidehoved der ligger oven paa indholdet kan flytte den oeverste kant", () => {
  assert.equal(
    expandScrollAdjustment({ rowTop: 30, rowBottom: 86, cardBottom: 400, safeTop: 64, safeBottom: SAFE_BOTTOM }),
    -34,
  );
});

test("maalinger der ikke er tal giver 0 i stedet for et NaN-scroll", () => {
  assert.equal(
    expandScrollAdjustment({ rowTop: Number.NaN, rowBottom: 10, cardBottom: 20, safeBottom: SAFE_BOTTOM }),
    0,
  );
  assert.equal(
    expandScrollAdjustment({ rowTop: 10, rowBottom: 20, cardBottom: 30, safeBottom: Number.POSITIVE_INFINITY }),
    0,
  );
});

test("udsynet er det samme 44 px tryk-maal fladen bruger i forvejen (#1602)", () => {
  assert.equal(MOBILE_CARD_PEEK, 44);
});
