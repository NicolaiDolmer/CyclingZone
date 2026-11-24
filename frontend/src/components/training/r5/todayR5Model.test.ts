// #7947 · I dag-fanen R5: de afledte felter (status, Day load, markering) og at
// kontakten off lader den gamle fane staa uroert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NO_FILTERS, NO_GROUP, canResetFilters, resetFilterState, PROGRAM_CHOICE, RECOVERY_CHOICE, STAGE,
  dayEffort, dayFields, dayLoad, effortOf, isTraining, matchesFilters, nextSort, overviewCounts,
  bulkPlan, readStoredFlag, settledDayFields, sortR5Rows, statusKeys, teamLine, toggleAllSelection, toggleOne, trainingChoiceOf,
  writeForEffort, writeForTraining, writeStoredFlag, yourDay,
  bulkPlanLevels, effortOfIntensity, effortOfLevel, fieldEfforts, levelForDayEntry, levelOfEffort, planEffort,
  settledFieldEfforts, showsInjuryRisk, writeForLevel, writeForTrainingAtLevel,
  STATUS_TONE, assistantVerdict, statusWordKey,
  type R5Row, type SettledActivity, type SettledRow, type StatusInput,
} from "./todayR5Model.ts";
import { trainingR5On } from "./trainingPageR5Flag.ts";
import { TODAY_PANEL_MERGE_BASE } from "./todayPanelMergeBase.golden.ts";

const here = dirname(fileURLToPath(import.meta.url));

function row(over: Partial<R5Row> & { id: string }): R5Row {
  return {
    name: "A", lastname: over.id, primaryType: "climber", age: 25, form: 60, fatigue: 40, racing: false,
    program: { kind: "none", name: null }, groupId: null, fields: ["tempo", "tempo", "tempo", "tempo", "tempo"], ownDay: false,
    ...over,
  };
}

test("canResetFilters/resetFilterState (#8563): kun et aktivt filter eller oversigtsvalg kan nulstilles, og nulstillingen rydder begge", () => {
  assert.equal(canResetFilters(NO_FILTERS, null), false);
  assert.equal(canResetFilters({ ...NO_FILTERS, age: "u23" }, null), true);
  assert.equal(canResetFilters({ ...NO_FILTERS, group: NO_GROUP }, null), true);
  assert.equal(canResetFilters({ ...NO_FILTERS, type: "climber" }, null), true);
  assert.equal(canResetFilters(NO_FILTERS, "tired"), true);
  const reset = resetFilterState();
  assert.deepEqual(reset.filters, NO_FILTERS);
  assert.equal(reset.overview, null);
  assert.equal(canResetFilters(reset.filters, reset.overview), false);
});

test("TodayR5 (#8563): telefonens raekke har ingen link inde i en knap, og tomt filter har Nulstil-handlingen", () => {
  const src = readFileSync(join(here, "TodayR5.tsx"), "utf8");
  const start = src.lastIndexOf("{g.rows.map((row) => {");
  const mobileRow = src.slice(start, src.indexOf("</Fragment>", start));
  // Foerste <button> i raekken er den strakte fold-ud-knap; navnet (NameCell) staar efter den, uden for en knap.
  assert.ok(mobileRow.indexOf('data-testid="r5-row-toggle"') > -1);
  const toggleEnd = mobileRow.indexOf("/>", mobileRow.indexOf('data-testid="r5-row-toggle"'));
  assert.ok(mobileRow.indexOf("<NameCell", toggleEnd) > toggleEnd, "NameCell maa ikke ligge inde i fold-ud-knappen");
  assert.match(src, /canResetFilters\(filters, overview\)/);
  assert.match(src, /tR5\("filter\.reset"\)/);
});

// --- Indsatsen ------------------------------------------------------------------

test("effortOf: spillets sessioner paa de fire ord; aktiv restitution bor under Hvile", () => {
  assert.equal(effortOf("rest"), "rest");
  assert.equal(effortOf("recovery"), "rest");
  assert.equal(effortOf("restitution"), "rest");
  assert.equal(effortOf("endurance"), "easy");
  assert.equal(effortOf("technique"), "easy");
  assert.equal(effortOf("tempo"), "medium");
  assert.equal(effortOf("vo2max"), "hard");
  assert.equal(effortOf("itt_long"), "hard");
  assert.equal(effortOf(null), null);
  assert.equal(effortOf("ukendt"), null);
});

test("dayEffort: den hoejeste indsats blandt traeningsfelterne; etapen og tomme felter springes over", () => {
  assert.equal(dayEffort(["rest", "endurance", STAGE, "tempo", null]), "medium");
  assert.equal(dayEffort([STAGE, null]), null);
});

test("writeForEffort: et tryk bruger spillets eksisterende gemme-kald, og Haard gaetter aldrig en session", () => {
  assert.deepEqual(writeForEffort("rest", { storedFocus: "sprint", assistantFocus: null }), { kind: "write", dayType: "rest", session: null });
  assert.deepEqual(writeForEffort("easy", { storedFocus: null, assistantFocus: null }), { kind: "write", dayType: "training", session: "endurance" });
  assert.deepEqual(writeForEffort("easy", { storedFocus: "aero", assistantFocus: null }), { kind: "write", dayType: "skill", session: "aero" });
  assert.deepEqual(writeForEffort("medium", { storedFocus: "sprint", assistantFocus: null }), { kind: "write", dayType: "training", session: "tempo" });
  assert.deepEqual(writeForEffort("hard", { storedFocus: "sprint", assistantFocus: "vo2max" }), { kind: "write", dayType: "training", session: "sprint" });
  assert.deepEqual(writeForEffort("hard", { storedFocus: "tempo", assistantFocus: "vo2max" }), { kind: "write", dayType: "training", session: "vo2max" });
  assert.deepEqual(writeForEffort("hard", { storedFocus: null, assistantFocus: "endurance" }), { kind: "pick" });
});

// --- Traeningsvaelgeren (ejer 20/11) -----------------------------------------------

test("writeForEffort: den valgte traening vinder paa sin egen indsats, ellers som foer", () => {
  const base = { storedFocus: "endurance", assistantFocus: "vo2max" };
  assert.deepEqual(writeForEffort("hard", { ...base, chosenFocus: "sprint" }), { kind: "write", dayType: "training", session: "sprint" },
    "Sprint valgt, Easy trykket og saa Hard: dagen gaar tilbage til Sprint");
  assert.deepEqual(writeForEffort("easy", { ...base, chosenFocus: "technique" }), { kind: "write", dayType: "skill", session: "technique" });
  assert.deepEqual(writeForEffort("easy", { ...base, chosenFocus: "sprint" }), { kind: "write", dayType: "training", session: "endurance" },
    "Sprint findes ikke paa Let; spillets lette session bruges");
  assert.deepEqual(writeForEffort("rest", { ...base, chosenFocus: "sprint" }), { kind: "write", dayType: "rest", session: null });
  assert.deepEqual(writeForEffort("hard", { storedFocus: null, assistantFocus: null, chosenFocus: null }), { kind: "pick" });
});

test("trainingChoiceOf: Program uden egen dag; en hviledag beholder sin traening; aktiv restitution er sit eget valg", () => {
  assert.equal(trainingChoiceOf(null), PROGRAM_CHOICE);
  assert.equal(trainingChoiceOf({ focus: null, intensity: null }), PROGRAM_CHOICE);
  assert.equal(trainingChoiceOf({ focus: "sprint", intensity: "hard" }), "sprint");
  assert.equal(trainingChoiceOf({ focus: "sprint", intensity: "rest" }), "sprint", "serveren bevarer fokus paa en hviledag");
  assert.equal(trainingChoiceOf({ focus: "restitution", intensity: "recovery" }), RECOVERY_CHOICE);
});

test("writeForTraining: Program fjerner kun dagen; en traening gemmes paa sin egen indsats med sidens gemme-kald", () => {
  assert.deepEqual(writeForTraining(PROGRAM_CHOICE), { kind: "clear" });
  assert.deepEqual(writeForTraining("sprint"), { kind: "write", dayType: "training", session: "sprint" });
  assert.deepEqual(writeForTraining("cobbled_sectors"), { kind: "write", dayType: "training", session: "cobbled_sectors" });
  assert.deepEqual(writeForTraining("aero"), { kind: "write", dayType: "skill", session: "aero" });
  assert.deepEqual(writeForTraining(RECOVERY_CHOICE), { kind: "write", dayType: "recovery", session: null });
});

test("yourDay: traeningen ligger paa alle dagens ledige sessioner; loebsfeltet er aldrig ledigt; programmets felter taeller ikke", () => {
  assert.deepEqual(yourDay(["sprint", "sprint", "sprint"], "sprint"), { session: "sprint", count: 3, free: 3 });
  assert.deepEqual(yourDay([STAGE, "sprint", "sprint", "sprint", "sprint"], "sprint"), { session: "sprint", count: 4, free: 4 });
  assert.deepEqual(yourDay(["vo2max", "sprint", "sprint", "sprint", "sprint"], "sprint"), { session: "sprint", count: 4, free: 5 },
    "et programfelt vinder over dagen (spillets stige)");
  assert.equal(yourDay(["tempo", "tempo", "tempo", "tempo", "tempo"], "sprint"), null, "programmet fylder alle felter: ingen 'Your day'");
  assert.equal(yourDay(["tempo", "tempo"], null), null, "ingen egen dag");
  assert.deepEqual(yourDay(["rest", "rest", "rest"], "rest"), { session: "rest", count: 3, free: 3 });
});

// --- Dagens felter og Day load ---------------------------------------------------

test("dayFields: loebsfeltet er laast, programmets felt vinder over den gemte dag, ellers ingen dag", () => {
  const fields = dayFields({
    programSlot: (slot) => (slot === 1 ? "sprint" : null),
    planSession: "tempo",
    raceSlots: new Set([0]),
  });
  assert.deepEqual(fields, [STAGE, "sprint", "tempo", "tempo", "tempo"]);
  assert.deepEqual(dayFields({ programSlot: () => null, planSession: null, raceSlots: new Set() }), [null, null, null, null, null]);
});

// Codex P2 paa #8511: en afregnet dag viser kvitteringen, ogsaa naar planen redigeres bagefter.
const sessionOfTest = (a: SettledActivity): string | null =>
  a.intensity === "rest" ? "rest" : a.intensity === "recovery" ? "recovery" : (a.focus ?? null);

test("settledDayFields: en redigeret plan efter afregning aendrer hverken felter, indsats eller Day load", () => {
  const receipt: SettledRow = {
    focus: "vo2max", intensity: "hard",
    // Gemt i en anden raekkefoelge end loebsdagene: felterne foelger loebsdagen.
    activities: [
      { game_day: 13, focus: "vo2max", intensity: "hard" },
      { game_day: 11, race_day: true, focus: null, intensity: null },
      { game_day: 12, focus: "vo2max", intensity: "hard" },
      { game_day: 14, focus: null, intensity: "rest" },
      { game_day: 15, focus: "vo2max", intensity: "hard" },
    ],
  };
  const planFields = (planSession: string) => dayFields({ programSlot: () => null, planSession, raceSlots: new Set() });
  const before = settledDayFields(planFields("vo2max"), receipt, sessionOfTest);
  // Spilleren skifter dagen til let traening efter koerslen (gaelder fra i morgen).
  const afterEdit = settledDayFields(planFields("endurance"), receipt, sessionOfTest);
  assert.deepEqual(before, [STAGE, "vo2max", "vo2max", "rest", "vo2max"]);
  assert.deepEqual(afterEdit, before);
  assert.equal(dayEffort(afterEdit), dayEffort(before));
  assert.equal(dayLoad(afterEdit), dayLoad(before));
  // Uden kvitteringen ville redigeringen have flyttet visningen (det var fejlen).
  assert.notEqual(dayLoad(planFields("endurance")), dayLoad(before));
});

test("settledDayFields: ikke-koerte felter er stadig planens; uden aktiviteter gaelder raekken; ingen kvittering = planen", () => {
  const planned = dayFields({ programSlot: () => null, planSession: "tempo", raceSlots: new Set([4]) });
  const partial: SettledRow = { focus: "sprint", intensity: "hard", activities: [{ game_day: 21, focus: "sprint", intensity: "hard" }, { game_day: 22, focus: "sprint", intensity: "hard" }] };
  assert.deepEqual(settledDayFields(planned, partial, sessionOfTest), ["sprint", "sprint", "tempo", "tempo", STAGE]);
  assert.deepEqual(settledDayFields(planned, { focus: "sprint", intensity: "hard" }, sessionOfTest), ["sprint", "sprint", "sprint", "sprint", STAGE]);
  assert.deepEqual(settledDayFields(planned, null, sessionOfTest), planned);
  assert.deepEqual(settledDayFields(planned, undefined, sessionOfTest), planned);
});

// #8533 Codex P2: kun et senere felt er afregnet. Det maa ikke rykke op paa felt 1.
test("settledDayFields/settledFieldEfforts: et delvist afregnet felt lander paa sin egen loebsdag", () => {
  const planned = dayFields({ programSlot: () => null, planSession: "tempo", raceSlots: new Set([3]) });
  const gameDays = [31, 32, 33, 34, 35];
  const lateRaceOnly: SettledRow = { focus: null, intensity: null, activities: [{ game_day: 34, race_day: true, focus: null, intensity: null }] };
  assert.deepEqual(settledDayFields(planned, lateRaceOnly, sessionOfTest, gameDays), ["tempo", "tempo", "tempo", STAGE, "tempo"]);
  const secondHard: SettledRow = { focus: "sprint", intensity: "hard", activities: [{ game_day: 32, focus: "sprint", intensity: "hard" }] };
  assert.deepEqual(settledDayFields(planned, secondHard, sessionOfTest, gameDays), ["tempo", "sprint", "tempo", STAGE, "tempo"]);
  assert.deepEqual(settledFieldEfforts(secondHard, 5, gameDays), [null, "hard", null, null, null]);
  // Uden datoens loebsdage (aeldre kald) gaelder den gamle raekkefoelge uaendret.
  assert.deepEqual(settledDayFields(planned, secondHard, sessionOfTest), ["sprint", "tempo", "tempo", STAGE, "tempo"]);
  // En aktivitet uden kendt loebsdag: hele kvitteringen falder tilbage til raekkefoelgen.
  const unknownDay: SettledRow = { focus: "sprint", intensity: "hard", activities: [{ game_day: 99, focus: "sprint", intensity: "hard" }] };
  assert.deepEqual(settledDayFields(planned, unknownDay, sessionOfTest, gameDays), ["sprint", "tempo", "tempo", STAGE, "tempo"]);
});

test("dayLoad: ord fra let til meget haard; ingen dag = intet ord", () => {
  const all = (s: string) => [s, s, s, s, s];
  assert.equal(dayLoad([null, null, null, null, null]), null);
  assert.equal(dayLoad(all("rest")), "easy");
  assert.equal(dayLoad(all("recovery")), "easy");
  assert.equal(dayLoad(all("endurance")), "light");
  assert.equal(dayLoad(["tempo", "tempo", "rest", "rest", "rest"]), "light");
  assert.equal(dayLoad(["tempo", "tempo", "tempo", "rest", "rest"]), "normal");
  assert.equal(dayLoad(all("tempo")), "hard");
  assert.equal(dayLoad(all("vo2max")), "veryHard");
  // En etape taeller som haard: etape + fire hviledage er en let dag, etape + haarde felter meget haard.
  assert.equal(dayLoad([STAGE, "rest", "rest", "rest", "rest"]), "light");
  assert.equal(dayLoad([STAGE, "vo2max", "vo2max", "vo2max", "vo2max"]), "veryHard");
});

// --- Status i raekken ----------------------------------------------------------------

const calm: StatusInput = { injuredCount: 0, injuryRisk: 0, daysOver70: 0, squad: null, isAcademy: false, contractExpiring: false, retirementRisk: false };

test("statusKeys: dagens status foerst, saa truppens maerker", () => {
  assert.deepEqual(statusKeys(calm), []);
  assert.deepEqual(
    statusKeys({ ...calm, injuredCount: 2, injuryRisk: 0.2, daysOver70: 3, squad: "u23", contractExpiring: true, retirementRisk: true }),
    ["injured", "days70", "u23", "contractExpiring", "retirementRisk"],
  );
  assert.deepEqual(statusKeys({ ...calm, injuryRisk: 0.05 }), ["injuryRisk"], "hoej skaderisiko fra samme graense som den gamle raekke");
  assert.deepEqual(statusKeys({ ...calm, injuryRisk: 0.049 }), []);
  assert.deepEqual(statusKeys({ ...calm, squad: "junior", isAcademy: true, contractExpiring: true }), ["junior", "academy"], "akademi skjuler kontrakt og pension");
  assert.deepEqual(statusKeys({ ...calm, daysOver70: null }), [], "ukendt antal dage = ingen advarsel");
});

// --- Overblik, filtre og sortering ------------------------------------------------

test("overviewCounts: traener, i loeb, traette og uden program", () => {
  const rows = [
    row({ id: "a", fatigue: 75 }),
    row({ id: "b", racing: true, fields: [STAGE, "tempo", "tempo", "tempo", "tempo"], program: { kind: "program", name: "P" } }),
    row({ id: "c", fields: ["rest", "rest", "rest", "rest", "rest"], program: { kind: "group", name: "G" } }),
    row({ id: "d", fields: [null, null, null, null, null] }),
  ];
  assert.deepEqual(overviewCounts(rows, 70), { training: 1, racing: 1, tired: 1, noProgram: 2 });
  assert.equal(isTraining(rows[1]), false, "en rytter i loeb traener ikke");
});

test("matchesFilters: alder, gruppe og type", () => {
  const r = row({ id: "a", age: 22, groupId: "g1", primaryType: "sprinter" });
  assert.equal(matchesFilters(r, NO_FILTERS), true);
  assert.equal(matchesFilters(r, { ...NO_FILTERS, age: "u23" }), true);
  assert.equal(matchesFilters(r, { ...NO_FILTERS, age: "25plus" }), false);
  assert.equal(matchesFilters(r, { ...NO_FILTERS, group: "g1" }), true);
  assert.equal(matchesFilters(r, { ...NO_FILTERS, group: NO_GROUP }), false);
  assert.equal(matchesFilters(row({ id: "b" }), { ...NO_FILTERS, group: NO_GROUP }), true);
  assert.equal(matchesFilters(r, { ...NO_FILTERS, type: "climber" }), false);
  assert.equal(matchesFilters(row({ id: "c", age: null }), { ...NO_FILTERS, age: "u25" }), false, "ukendt alder falder ud af et aldersfilter");
});

test("sortR5Rows: tal med de stoerste foerst ved foerste tryk, manglende vaerdier altid sidst", () => {
  const rows = [row({ id: "a", fatigue: 30 }), row({ id: "b", fatigue: null }), row({ id: "c", fatigue: 80 })];
  const sort = nextSort(null, "fatigue");
  assert.deepEqual(sort, { key: "fatigue", dir: -1 });
  assert.deepEqual(sortR5Rows(rows, sort).map((r) => r.id), ["c", "a", "b"]);
  assert.deepEqual(sortR5Rows(rows, nextSort(sort, "fatigue")).map((r) => r.id), ["a", "c", "b"]);
  assert.deepEqual(nextSort(null, "rider"), { key: "rider", dir: 1 });
});

// --- Markering og holdlinjen -----------------------------------------------------------

test("teamLine: intet markeret = hele holdet i visningen uden loebsryttere; ellers kun de markerede", () => {
  const shown = [row({ id: "a" }), row({ id: "b", racing: true }), row({ id: "c" })];
  assert.deepEqual(teamLine(new Set(), shown), { kind: "team", ids: ["a", "c"] });
  assert.deepEqual(teamLine(new Set(["c"]), shown), { kind: "selected", ids: ["c"] });
  assert.deepEqual(teamLine(new Set(["b"]), shown), { kind: "selected", ids: [] },
    "kun en loebsrytter markeret: ingen traeningsdag, og markeringen bliver aldrig til hele holdet");
  assert.deepEqual(teamLine(new Set(["x"]), shown), { kind: "team", ids: ["a", "c"] }, "en skjult rytter tæller aldrig med");
});

test("bulkPlan: eet masse-kald for Hvile/Let/Mellem; Haard pr. session, ukendte springes over", () => {
  const focus: Record<string, { storedFocus: string | null; assistantFocus: string | null }> = {
    a: { storedFocus: "sprint", assistantFocus: null },
    b: { storedFocus: null, assistantFocus: "vo2max" },
    c: { storedFocus: "tempo", assistantFocus: "sprint" },
    d: { storedFocus: null, assistantFocus: null },
  };
  const of = (id: string) => focus[id];
  assert.deepEqual(bulkPlan("rest", ["a", "b"], of), { calls: [{ choice: "rest", ids: ["a", "b"] }], skipped: [] });
  assert.deepEqual(bulkPlan("medium", ["a"], of), { calls: [{ choice: "tempo", ids: ["a"] }], skipped: [] });
  assert.deepEqual(bulkPlan("easy", [], of), { calls: [], skipped: [] });
  assert.deepEqual(bulkPlan("hard", ["a", "b", "c", "d"], of), {
    calls: [{ choice: "sprint", ids: ["a", "c"] }, { choice: "vo2max", ids: ["b"] }],
    skipped: ["d"],
  });
});

test("bulkPlan med holdlinjens traening: den bruges paa sin indsats for alle, uden at nogen springes over", () => {
  const of = () => ({ storedFocus: null, assistantFocus: null });
  assert.deepEqual(bulkPlan("hard", ["a", "b"], of, "sprint"), { calls: [{ choice: "sprint", ids: ["a", "b"] }], skipped: [] });
  assert.deepEqual(bulkPlan("easy", ["a"], of, "aero"), { calls: [{ choice: "aero", ids: ["a"] }], skipped: [] });
  assert.deepEqual(bulkPlan("easy", ["a"], of, "sprint"), { calls: [{ choice: "endurance", ids: ["a"] }], skipped: [] },
    "Sprint findes ikke paa Let");
  assert.deepEqual(bulkPlan("rest", ["a"], of, "sprint"), { calls: [{ choice: "rest", ids: ["a"] }], skipped: [] });
  assert.deepEqual(bulkPlan("hard", ["a"], of, PROGRAM_CHOICE), { calls: [], skipped: ["a"] }, "Program = som i dag");
});

test("markering: pr. rytter og alle", () => {
  assert.deepEqual([...toggleOne(new Set(["a"]), "b")], ["a", "b"]);
  assert.deepEqual([...toggleOne(new Set(["a"]), "a")], []);
  assert.deepEqual([...toggleAllSelection(new Set(), ["a", "b"])], ["a", "b"]);
  assert.deepEqual([...toggleAllSelection(new Set(["a", "b"]), ["a", "b"])], []);
  assert.deepEqual([...toggleAllSelection(new Set(["a"]), ["a", "b"])], ["a", "b"]);
});

test("valget huskes pr. spiller, og et blokeret lager giver standarden", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(readStoredFlag(storage, "k"), false);
  writeStoredFlag(storage, "k", true);
  assert.equal(readStoredFlag(storage, "k"), true);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readStoredFlag(broken, "k"), false);
  assert.doesNotThrow(() => writeStoredFlag(broken, "k", true));
});

// --- Kontakten off = uaendret ------------------------------------------------------------

test("kontakten: kun et eksplicit true taender R5", () => {
  assert.equal(trainingR5On({ training_page_r5: true }), true);
  assert.equal(trainingR5On({ training_page_r5: false }), false);
  assert.equal(trainingR5On({ training_page_r5: "on" }), false);
  assert.equal(trainingR5On({}), false);
  assert.equal(trainingR5On(null), false);
});

test("kontakten off: I dag-fanens gamle indhold er praecis som paa merge-basen, og R5 monteres kun bag kontakten", () => {
  const page = readFileSync(join(here, "../../../pages/TrainingPage.jsx"), "utf8").replace(/\r\n/g, "\n");
  const golden = TODAY_PANEL_MERGE_BASE;
  const open = "      <TabPanel value=\"today\">\n      {trainingR5 ? <I18nReadyGate ns=\"trainingR5\" fallback={<TabFallback />}><Suspense fallback={<TabFallback />}><TodayR5Lazy r5={r5Today} /></Suspense></I18nReadyGate> : (\n";
  const start = page.indexOf(open);
  assert.ok(start >= 0, "I dag-panelet aabner med kontaktens gren");
  const bodyStart = start + open.length;
  const close = "\n      )}\n      </TabPanel>";
  const end = page.indexOf(close, bodyStart);
  assert.ok(end > bodyStart, "grenen lukkes lige foer panelet");
  assert.equal(page.slice(bodyStart, end) + "\n", golden, "den gamle fanes JSX er byte-identisk med merge-basen");
  // R5-komponenten naevnes kun i import, kontaktens gren og dens props.
  const mounts = page.split("\n").filter((l) => l.includes("<TodayR5Lazy"));
  assert.equal(mounts.length, 1, "R5 monteres eet sted, bag kontakten");
});

// --- Indsatsvaelgeren Let/Mellem/Haard (#7947 PR 3, #8530) ---------------------------------

test("niveau-ord: fladens Mellem er API'ets normal; Hvile er intet niveau", () => {
  assert.equal(levelOfEffort("easy"), "easy");
  assert.equal(levelOfEffort("medium"), "normal");
  assert.equal(levelOfEffort("hard"), "hard");
  assert.equal(levelOfEffort("rest"), null);
  assert.equal(levelOfEffort(null), null);
  assert.equal(effortOfLevel("normal"), "medium");
  assert.equal(effortOfLevel("medium"), null, "kun API'ets ord taeller");
  assert.equal(effortOfLevel("rest"), null);
  assert.equal(effortOfIntensity("rest"), "rest");
  assert.equal(effortOfIntensity("recovery"), "rest");
  assert.equal(effortOfIntensity("hard"), "hard");
  assert.equal(effortOfIntensity("ukendt"), null);
});

test("planEffort: rytterens egen dag er planens intensitet, ellers sessionens eget niveau", () => {
  assert.equal(planEffort({ focus: "sprint", intensity: "normal" }), "medium", "en sprint paa Mellem");
  assert.equal(planEffort({ focus: "endurance", intensity: "hard" }), "hard");
  assert.equal(planEffort({ focus: "sprint", intensity: "rest" }), "rest");
  assert.equal(planEffort({ focus: "restitution", intensity: "easy" }), "rest");
  assert.equal(planEffort({ focus: "sprint", intensity: "ukendt" }), "hard", "ukendt intensitet: sessionens eget niveau");
  assert.equal(planEffort({ focus: null, intensity: "hard" }), null);
  assert.equal(planEffort(null), null);
});

test("levelForDayEntry: laeser tolerant; en celle uden niveau-noegler aendrer intet", () => {
  assert.equal(levelForDayEntry({ session: "tempo", intensity: "normal" }, 0), null, "backend sender ikke noeglerne endnu");
  assert.equal(levelForDayEntry({ effort: "hard" }, 3), "hard");
  assert.equal(levelForDayEntry({ effort: "easy", slotEfforts: [null, "hard"] }, 1), "hard", "feltets eget vinder");
  assert.equal(levelForDayEntry({ effort: "easy", slotEfforts: [null, "hard"] }, 0), "easy", "ellers dagens");
  assert.equal(levelForDayEntry({ effort: "medium" }, 0), null, "ugyldigt ord taeller som fraevaerende");
  assert.equal(levelForDayEntry(undefined), null);
  assert.equal(levelForDayEntry("x"), null);
});

test("fieldEfforts: uden niveau er det sessionens eget (som foer); hvile ignorerer niveauet", () => {
  const fields = ["sprint", "endurance", STAGE, null, "rest"];
  assert.deepEqual(fieldEfforts(fields, () => null), ["hard", "easy", null, null, "rest"]);
  assert.deepEqual(fieldEfforts(fields, () => "easy"), ["easy", "easy", null, null, "rest"]);
  assert.deepEqual(fieldEfforts(["recovery"], () => "hard"), ["rest"]);
  assert.deepEqual(fieldEfforts(["sprint", "tempo", "technique"], () => null), ["sprint", "tempo", "technique"].map((s) => effortOf(s)));
});

test("dayEffort og dayLoad: uden efforts uaendret, med efforts det valgte niveau", () => {
  const fields = ["endurance", "endurance", "endurance", "endurance", "endurance"];
  assert.equal(dayEffort(fields), "easy");
  assert.equal(dayEffort(fields, ["hard", "easy", "easy", "easy", "easy"]), "hard");
  assert.equal(dayLoad(fields), dayLoad(fields, undefined));
  assert.equal(dayLoad(fields, fields.map(() => "hard" as const)), "veryHard", "fem hoeje felter er en meget haard dag");
  assert.equal(dayLoad(fields, fields.map(() => null)), dayLoad(fields), "et felt uden indsats falder tilbage til sessionens");
});

test("writeForLevel: hver session paa det trykkede niveau; Hvile uden fokus; Haard gaetter aldrig", () => {
  const none = { storedFocus: null, assistantFocus: null };
  assert.deepEqual(writeForLevel("rest", { storedFocus: "sprint", assistantFocus: "vo2max" }), { kind: "write", dayType: "rest", session: null, effort: null });
  assert.deepEqual(writeForLevel("easy", { storedFocus: "sprint", assistantFocus: null }), { kind: "write", dayType: "training", session: "sprint", effort: "easy" });
  assert.deepEqual(writeForLevel("medium", { storedFocus: "vo2max", assistantFocus: null }), { kind: "write", dayType: "training", session: "vo2max", effort: "normal" });
  assert.deepEqual(writeForLevel("hard", { storedFocus: "endurance", assistantFocus: "vo2max" }), { kind: "write", dayType: "training", session: "endurance", effort: "hard" });
  assert.deepEqual(writeForLevel("hard", { storedFocus: "aero", assistantFocus: null }), { kind: "write", dayType: "skill", session: "aero", effort: "hard" });
  assert.deepEqual(writeForLevel("hard", { storedFocus: "sprint", assistantFocus: "vo2max", chosenFocus: "threshold" }), { kind: "write", dayType: "training", session: "threshold", effort: "hard" }, "den valgte traening vinder");
  assert.deepEqual(writeForLevel("easy", none), { kind: "write", dayType: "training", session: "endurance", effort: "easy" });
  assert.deepEqual(writeForLevel("medium", none), { kind: "write", dayType: "training", session: "tempo", effort: "normal" });
  assert.deepEqual(writeForLevel("hard", none), { kind: "pick" });
  assert.deepEqual(writeForLevel("hard", { storedFocus: "rest", assistantFocus: "recovery" }), { kind: "pick" }, "hvile er ikke et fokus");
});

test("writeForTrainingAtLevel: et valg beholder dagens niveau; paa hvile eller uden dag faar det sit eget", () => {
  assert.deepEqual(writeForTrainingAtLevel("sprint", "easy"), { kind: "write", dayType: "training", session: "sprint", effort: "easy" });
  assert.deepEqual(writeForTrainingAtLevel("sprint", "medium"), { kind: "write", dayType: "training", session: "sprint", effort: "normal" });
  assert.deepEqual(writeForTrainingAtLevel("sprint", "rest"), { kind: "write", dayType: "training", session: "sprint", effort: null });
  assert.deepEqual(writeForTrainingAtLevel("sprint", null), { kind: "write", dayType: "training", session: "sprint", effort: null });
  assert.deepEqual(writeForTrainingAtLevel("aero", "hard"), { kind: "write", dayType: "skill", session: "aero", effort: "hard" });
  assert.deepEqual(writeForTrainingAtLevel(RECOVERY_CHOICE, "hard"), { kind: "write", dayType: "recovery", session: null, effort: null });
  assert.deepEqual(writeForTrainingAtLevel(PROGRAM_CHOICE, "hard"), { kind: "clear" });
});

test("bulkPlanLevels: een skrivning pr. session paa det trykkede niveau, Hvile uden fokus, Haard springer ukendte over", () => {
  const known: Record<string, { storedFocus: string | null; assistantFocus: string | null }> = {
    a: { storedFocus: "sprint", assistantFocus: null },
    b: { storedFocus: null, assistantFocus: "vo2max" },
    c: { storedFocus: null, assistantFocus: null },
  };
  const focus = (id: string) => known[id];
  assert.deepEqual(bulkPlanLevels("rest", ["a", "b"], focus), { calls: [{ choice: "rest", effort: null, ids: ["a", "b"] }], skipped: [] });
  assert.deepEqual(bulkPlanLevels("medium", ["a", "b", "c"], focus), {
    calls: [{ choice: "sprint", effort: "normal", ids: ["a"] }, { choice: "vo2max", effort: "normal", ids: ["b"] }, { choice: "tempo", effort: "normal", ids: ["c"] }],
    skipped: [],
  });
  assert.deepEqual(bulkPlanLevels("hard", ["a", "c"], focus), { calls: [{ choice: "sprint", effort: "hard", ids: ["a"] }], skipped: ["c"] });
  assert.deepEqual(bulkPlanLevels("easy", ["a", "b"], focus, "threshold"), { calls: [{ choice: "threshold", effort: "easy", ids: ["a", "b"] }], skipped: [] }, "holdlinjens traening paa et hvilket som helst niveau");
  assert.deepEqual(bulkPlanLevels("hard", [], focus), { calls: [], skipped: [] });
});

test("settledFieldEfforts: det et afregnet felt koerte paa; felter uden kvittering falder tilbage til planen", () => {
  const receipt: SettledRow = {
    activities: [
      { focus: "tempo", intensity: "hard", game_day: 2 },
      { focus: "sprint", intensity: "easy", game_day: 1 },
      { race_day: true, game_day: 3 },
    ],
  };
  assert.deepEqual(settledFieldEfforts(receipt, 5), ["easy", "hard", null, null, null]);
  assert.deepEqual(settledFieldEfforts({ focus: "sprint", intensity: "normal" }, 2), ["medium", "medium"], "aeldre kvittering uden aktiviteter gaelder alle felter");
  assert.deepEqual(settledFieldEfforts(null, 2), [null, null]);
});

test("skaderisiko vises kun paa Haard, uden procent (ejer 21/11)", () => {
  assert.equal(showsInjuryRisk("hard"), true);
  for (const e of ["rest", "easy", "medium", null] as const) assert.equal(showsInjuryRisk(e), false);
  const picker = readFileSync(join(here, "EffortPickerR5.tsx"), "utf8");
  assert.ok(!picker.includes("effortPicker.risk\""), "ingen procent-tekst til spilleren");
});

test("indsatsvaelgeren: kun et eksplicit true taender den, og effort sendes kun naar den er valgt", () => {
  const todayR5 = readFileSync(join(here, "TodayR5.tsx"), "utf8");
  assert.match(todayR5, /const levelsOn = r5\.effortLevels === true/, "kun et eksplicit true taender vaelgeren");
  const hook = readFileSync(join(here, "../../../lib/useTraining.js"), "utf8");
  assert.match(hook, /effort \? \{ dayType, session, effort \} : \{ dayType, session \}/, "effort sendes kun naar den er valgt");
  assert.match(hook, /setEffortLevels\(.*\)\.effortLevels === true\)/, "manglende felt = slukket");
});

// --- En linje pr. rytter (#7947, ejer 23/11) ------------------------------------

test("status som ord: hvert maerke har sin fulde tekst i begge sprog, aldrig en forkortelse", () => {
  const keys = ["injured", "injuryRisk", "days70", "u23", "junior", "academy", "contractExpiring", "retirementRisk"] as const;
  for (const key of keys) assert.ok(STATUS_TONE[key], `tone for ${key}`);
  assert.equal(STATUS_TONE.injured, "danger");
  assert.equal(statusWordKey("injured"), null, "skaden har spillets egen skadebesked");
  assert.equal(statusWordKey("days70"), null, "dagene over graensen har status.days70 med tal");
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const loc = JSON.parse(readFileSync(join(here, `../../../../public/locales/${lang}/trainingR5.json`), "utf8"));
    for (const key of keys) {
      const k = statusWordKey(key);
      if (!k) continue;
      const word = k.split(".").reduce((o: Record<string, unknown>, p) => o?.[p] as Record<string, unknown>, loc) as unknown as string;
      assert.equal(typeof word, "string", `${lang}: ${k}`);
      assert.doesNotMatch(word, /^(U23|JR|ACAD|AKAD|EXP|UDLØB|35\+)$/i, `${lang}: ${key} skrives fuldt ud`);
      assert.ok(word.length >= 5, `${lang}: ${key} er et ord, ikke en forkortelse (${word})`);
    }
  }
  const da = JSON.parse(readFileSync(join(here, "../../../../public/locales/da/trainingR5.json"), "utf8"));
  assert.equal(da.row.status.injuryRisk, "Høj skaderisiko");
  assert.deepEqual([da.effort.rest, da.effort.easy, da.effort.medium, da.effort.hard], ["Hvile", "Let", "Mellem", "Hård"]);
});

test("assistentens dom: enig, forslag med eet tryk, eller ingen dom", () => {
  const base = { decided: true, racing: false, recoverySuggested: false, noDay: false, smartFocus: "sprint" };
  assert.deepEqual(assistantVerdict(base), { kind: "agrees" });
  assert.deepEqual(assistantVerdict({ ...base, recoverySuggested: true }), { kind: "suggests", choice: RECOVERY_CHOICE }, "aktiv restitution vinder");
  assert.deepEqual(assistantVerdict({ ...base, noDay: true }), { kind: "suggests", choice: "sprint" }, "uden dag: assistentens egen traening");
  assert.equal(assistantVerdict({ ...base, noDay: true, smartFocus: null }), null, "intet grundlag, ingen dom");
  assert.equal(assistantVerdict({ ...base, decided: false }), null, "dagen er koert eller beslutningen er slukket");
  assert.equal(assistantVerdict({ ...base, racing: true, recoverySuggested: true }), null, "loeb vinder over traening");
});

test("TodayR5 en linje: navnecellen er kun flag + navn; status, traening, indsats og menu har egne kolonner", () => {
  const src = readFileSync(join(here, "TodayR5.tsx"), "utf8");
  const name = src.slice(src.indexOf("function NameCell("), src.indexOf("\n}\n", src.indexOf("function NameCell(")));
  assert.doesNotMatch(name, /Status|RiderBadges|row\.status/, "intet andet end flag og navn i navnecellen");
  assert.doesNotMatch(src, /RiderBadges/, "ingen korte maerker (U23/JR/AKAD) paa fanen");
  for (const key of ["row.col.status", "row.col.training", "row.col.effort"]) assert.ok(src.includes(`tR5("${key}")`), key);
  assert.doesNotMatch(src, /group-hover\/row:flex|top-full/, "Din dag er ingen boble oven paa naeste raekke");
  assert.match(src, /<span className="sr-only"><RowNote /, "Din dag staar i raekken for skaermlaeseren og synligt i den udfoldede raekke");
  assert.doesNotMatch(src, /<SortTh k=\{null\} label=\{tR5\("row\.col\.training"\)\} cls="w-\[(?:[1-9]\d?|1[0-5]\d)px\]"/, "Traening-kolonnen har plads til hele navnet");
  assert.doesNotMatch(src, /<TypeCell[^>]*stacked|RiderTypeBadge[^>]*stacked/, "typen paa een linje");
  assert.match(src, /data-testid="r5-row-menu"/);
  const picker = readFileSync(join(here, "EffortPickerR5.tsx"), "utf8");
  assert.match(picker, /EFFORTS\.map/, "Hvile, Let, Mellem og Haard i een kontrol");
});