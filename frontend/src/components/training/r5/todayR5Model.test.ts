// #7947 · I dag-fanen R5: de afledte felter (status, Day load, markering) og at
// kontakten off lader den gamle fane staa uroert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NO_FILTERS, NO_GROUP, PROGRAM_CHOICE, RECOVERY_CHOICE, STAGE,
  dayEffort, dayFields, dayLoad, effortOf, isTraining, matchesFilters, nextSort, overviewCounts,
  bulkPlan, readStoredFlag, settledDayFields, sortR5Rows, statusKeys, teamLine, toggleAllSelection, toggleOne, trainingChoiceOf,
  writeForEffort, writeForTraining, writeStoredFlag, yourDay,
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
