// #7717 · Hvorfor?: forklaringen maa kun sige det loebets haendelser baerer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeOf, riderWhy, type RiderWhyInput } from "./riderWhyModel.ts";
import type { Cast, RaceStory, StoryCheckpoint, StoryMoment } from "../components/race/stagePageV2/raceStoryModel.ts";
import type { Climb } from "../components/race/stagePageV2/stagePageV2Model.ts";

type Ev = { km: number; type: string; params?: Record<string, unknown> };

const COL: Climb = { name: "Col Test", crest_km: 80, length_km: 10, avg_gradient: 7 };

function moment(type: string, km: number, data: Record<string, unknown>, extra: Partial<StoryMoment> = {}): StoryMoment {
  return { type, key: `story.${type}`, km, race_time_s: null, importance: "key", data, ...extra };
}

/** Maalets grupper: [gruppe-id, rytter-id'er, hul, baerer resten, stoerrelse]. */
function finishAt(km: number, groups: Array<[string, string[], number, boolean, number?]>): StoryCheckpoint {
  return {
    kind: "finish", km, name: null, category: null, top: [], leader_time_s: null, leader_group_id: groups[0][0], leader_rider_ids: groups[0][1],
    groups: groups.map(([group_id, rider_ids, gap_s, includes_rest, size]) => ({ group_id, rider_ids, gap_s, includes_rest, size: size ?? rider_ids.length })),
    groups_from_km: null, interpolated: false, out_rider_ids: [], pending_rider_ids: [],
  };
}

function storyOf(moments: StoryMoment[], finish: StoryCheckpoint | null, extra: Partial<RaceStory> = {}): RaceStory {
  return {
    version: 1, timeline_version: 2, distance_km: 100, field_count: 20, precise_times: true, time_trial: false, leader_line: [],
    moments, checkpoints: finish ? [finish] : [], snapshots: [], group_spans: [], breakaway: null, ...extra,
  };
}

const gapEvent: Ev = { km: 50, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 30 } };
const start: Ev = { km: 0, type: "stage_start", params: { field_count: 20 } };

function input(riderId: string, rank: number | null, events: Ev[], story: RaceStory | null, extra: Partial<RiderWhyInput> = {}): RiderWhyInput {
  return { riderId, rank, events: [start, gapEvent, ...events], story, climbs: [COL], ...extra };
}

const split = (km: number, cause: string, rider = "a", extra: Record<string, unknown> = {}): Ev => (
  { km, type: "peloton_splits", params: { group_id: "gruppetto-1", source_group_id: "peloton-0", rider_ids: [rider], cause, gap_seconds: 40, ...extra } }
);
const splitMoment = (km: number, cause: string, rider = "a", extra: Partial<StoryMoment> = {}) => moment("peloton_splits", km, { rider_ids: [rider], cause, gap_seconds: 40 }, extra);
const behind = finishAt(100, [["finale-bunch-0", ["w"], 0, true, 15], ["gruppetto-1", ["a"], 300, false]]);

test("sat paa en stigning: stedet og den dokumenterede aarsag", () => {
  const why = riderWhy(input("a", 12, [split(75, "wprime_depleted")], storyOf([splitMoment(75, "wprime_depleted")], behind)));
  assert.deepEqual(why, { known: true, main: "dropEmpty", where: { kind: "climb", name: "Col Test" }, lead: null, leadWhere: { kind: "none" } });
});

test("hver aarsag faar sin egen saetning; en blandet aarsag paastaar ingen grund", () => {
  const mainFor = (cause: string) => riderWhy(input("a", 12, [split(75, cause)], storyOf([splitMoment(75, cause)], behind))).main;
  assert.equal(mainFor("climb_deficit"), "dropPace");
  assert.equal(mainFor("grupetto"), "dropGrupetto");
  assert.equal(mainFor("mixed"), "dropGeneric");
  assert.equal(mainFor("noget_nyt"), "dropGeneric");
});

test("hvad der foerte til det: en dag i udbruddet og den daarlige dag", () => {
  const caught: Ev = { km: 60, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a"] } };
  const breakaway = { morning_rider_ids: ["a"], outcomes: { a: "caught" as const } };
  const events = [caught, split(75, "climb_deficit")];
  const moments = [moment("breakaway_formed", 10, { rider_ids: ["a"] }), moment("breakaway_caught", 60, { rider_ids: ["a"] }), splitMoment(75, "climb_deficit")];
  assert.equal(riderWhy(input("a", 12, events, storyOf(moments, behind, { breakaway }))).lead, "afterBreak");
  // Review 6/11: hentet efter faa km er ikke "en dag i udbruddet".
  const short = [moment("breakaway_formed", 58, { rider_ids: ["a"] }), moment("breakaway_caught", 60, { rider_ids: ["a"] }), splitMoment(75, "climb_deficit")];
  assert.equal(riderWhy(input("a", 12, events, storyOf(short, behind, { breakaway }))).lead, null);
  const rainy = [...moments, moment("bad_day", 100, { rider_id: "a", reason: "weather", weather: "rain" })];
  assert.equal(riderWhy(input("a", 12, events, storyOf(rainy, behind, { breakaway }))).lead, "badDayRain");
});

test("en rytter i frontgruppen blev aldrig sat, selvom han var tabt undervejs", () => {
  const front = finishAt(100, [["finale-bunch-0", ["a", "w"], 0, true, 15]]);
  const events = [split(75, "climb_deficit"), { km: 90, type: "group_merged", params: { group_id: "gruppetto-1", into_group_id: "peloton-0", rider_ids: ["a"] } }];
  const why = riderWhy(input("a", 4, events, storyOf([splitMoment(75, "climb_deficit")], front)));
  assert.equal(why.main, "front");
  assert.notEqual(why.main, "dropPace");
});

test("et split frem er et angreb, aldrig et tab", () => {
  const forward = split(75, "attack", "a", { gap_seconds: -20 });
  const why = riderWhy(input("a", 12, [forward], storyOf([moment("peloton_splits", 75, { rider_ids: ["a"], cause: "attack", gap_seconds: -20 })], behind)));
  assert.equal(why.known, false);
});

test("uheld: tidstab taeller kun hvis han ikke kom tilbage til feltet", () => {
  const crash: Ev = { km: 40, type: "incident", params: { rider_id: "a", kind: "crash", outcome: "time_loss" } };
  const m = moment("incident", 40, { rider_id: "a", kind: "crash", outcome: "time_loss" });
  assert.equal(riderWhy(input("a", 12, [crash], storyOf([m], behind))).main, "crashLoss");
  // Codex: en sammenlaegning med en gruppe laengere tilbage er ikke at vaere kommet tilbage.
  const merged = moment("group_merged", 55, { rider_ids: ["a"], into_group_id: "gruppetto-1" });
  assert.equal(riderWhy(input("a", 12, [crash], storyOf([m, merged], behind))).main, "crashLoss");
  // Review 6/11: tilbage i feltet og sat senere: faldet er aarsagen, ikke styrtet.
  const back: Ev = { km: 55, type: "group_merged", params: { group_id: "chase-1", into_group_id: "peloton-0", rider_ids: ["a"] } };
  const later = riderWhy(input("a", 12, [crash, back, split(75, "climb_deficit")], storyOf([m, splitMoment(75, "climb_deficit")], behind)));
  assert.equal(later.main, "dropPace");
  const inBunch = finishAt(100, [["finale-winner-0", ["w"], 0, false], ["finale-tier-1", ["a"], 4, true, 15]]);
  const sprint = moment("sprint_decided", 100, { winner_rider_id: "w" });
  assert.equal(riderWhy(input("a", 12, [crash], storyOf([m, sprint], inBunch))).main, "bunchBehindSprint");
});

test("vinderen: spurten, det alene angreb, og aldrig et angreb han ikke kom alene fra", () => {
  const front = finishAt(100, [["finale-winner-0", ["a", "b"], 0, false], ["peloton-0", ["c"], 30, true, 15]]);
  assert.equal(riderWhy(input("a", 1, [], storyOf([moment("sprint_decided", 100, { winner_rider_id: "a" })], front))).main, "wonSprint");
  const attack = moment("finale_attack", 78, { rider_ids: ["a"] });
  assert.equal(riderWhy(input("a", 1, [], storyOf([attack], front))).main, "won");
  const alone = finishAt(100, [["finale-winner-0", ["a"], 0, false], ["peloton-0", ["c"], 30, true, 15]]);
  const why = riderWhy(input("a", 1, [], storyOf([attack], alone)));
  assert.equal(why.main, "wonAttack");
  assert.deepEqual(why.where, { kind: "climb", name: "Col Test" });
  // Codex: finalens enkeltgruppe beviser ikke, at et hentet angreb holdt.
  const caught = moment("breakaway_caught", 88, { rider_ids: ["a"] });
  assert.equal(riderWhy(input("a", 1, [], storyOf([attack, caught], alone))).main, "won");
  const groupCaught = moment("group_merged", 88, { group_id: "attack-1", rider_ids: [] });
  const groupAttack = moment("finale_attack", 78, { rider_ids: ["a"], group_id: "attack-1" });
  assert.equal(riderWhy(input("a", 1, [], storyOf([groupAttack, groupCaught], alone))).main, "won");
});

test("en rytter der vandt tid paa stigningen, forklares ikke med dagens form alene", () => {
  const finish = finishAt(100, [["breakaway-0", ["w"], 0, false], ["solo-1", ["a"], 300, false], ["peloton-0", ["c"], 400, true, 15]]);
  const moments = [moment("all_out_gain", 80, { rider_id: "a" }), moment("bad_day", 100, { rider_id: "a", reason: "fatigue" })];
  const why = riderWhy(input("a", 3, [], storyOf(moments, finish)));
  assert.equal(why.main, "allOutGain");
  assert.deepEqual(why.where, { kind: "climb", name: "Col Test" });
  assert.equal(why.lead, "badDayFatigue");
});

test("udbruddet der holdt hjem, og feltet bag det", () => {
  const finish = finishAt(100, [["breakaway-0", ["a"], 0, false], ["peloton-0", ["c"], 200, true, 15]]);
  const breakaway = { morning_rider_ids: ["a"], outcomes: { a: "survived" as const } };
  assert.equal(riderWhy(input("a", 1, [], storyOf([], finish, { breakaway }))).main, "survived");
  assert.equal(riderWhy(input("c", 3, [], storyOf([], finish, { breakaway }))).main, "pelotonBehindBreak");
  assert.equal(riderWhy(input("c", 3, [], storyOf([], finish))).main, "pelotonBehind");
});

test("udgaaet: aarsagen fra uheldet, stedet hvis det kendes, og ellers ikke kendt", () => {
  const crash = moment("incident", 75, { rider_id: "a", kind: "crash", outcome: "abandoned" });
  const dnf = { status: "dnf" as const };
  assert.deepEqual(riderWhy(input("a", null, [], storyOf([crash], behind), { ...dnf, reasonKey: "crash" })).where, { kind: "climb", name: "Col Test" });
  assert.equal(riderWhy(input("a", null, [], null, { ...dnf, reasonKey: "crash" })).main, "abandonedCrash");
  assert.equal(riderWhy(input("a", null, [], null, { ...dnf, reasonKey: "abandoned" })).known, false);
  const late = riderWhy(input("a", null, [split(75, "climb_deficit")], storyOf([splitMoment(75, "climb_deficit")], behind), { ...dnf, reasonKey: "time_limit" }));
  assert.equal(late.main, "timeLimit");
  assert.equal(late.lead, "afterDrop");
  assert.deepEqual(late.leadWhere, { kind: "climb", name: "Col Test" });
});

test("mangler data, er svaret ikke kendt", () => {
  assert.equal(riderWhy(input("a", 5, [], null)).known, false, "ingen historie");
  assert.equal(riderWhy(input("a", 5, [], storyOf([], null))).known, false, "intet maal i loggen");
  assert.equal(riderWhy(input("a", 5, [], storyOf([], behind, { time_trial: true }))).known, false, "tidskoersel uden kendt profil");
  assert.equal(riderWhy({ riderId: "a", rank: 5, events: [start], story: storyOf([], behind), climbs: [] }).known, false, "ingen gruppe-log");
  assert.equal(riderWhy(input(null as unknown as string, 5, [], storyOf([], behind))).known, false, "ingen rytter");
  assert.equal(riderWhy(input("a", 12, [], storyOf([], behind))).known, false, "gruppe bag fronten uden nogen haendelse");
});

// #7717: enkeltstarten. Ingen grupper; kun uheld, dagens ben og ruten, og kun naar det passer til placeringen.
const ittEvents = (...extra: Ev[]): Ev[] => [{ km: 0, type: "stage_start", params: { field_count: 40, profile_type: "itt", distance_km: 24 } }, ...extra];
const ittStory = (moments: StoryMoment[] = []) => storyOf(moments, null, { time_trial: true, distance_km: 24, field_count: 40 });
const dayWord = (word: string, extra: Record<string, unknown> = {}): Ev => ({ km: 24, type: "day_word", params: { rider_id: "a", word, ...extra } });
const FITS = new Map<string, number | null>([["a", 30], ["b", 20], ["c", 20], ["d", 12]]);
const ittWhy = (rank: number | null, events: Ev[] = [], moments: StoryMoment[] = [], routeFits: RiderWhyInput["routeFits"] = null, riderId = "a") => riderWhy({ riderId, rank, events: ittEvents(...events), story: ittStory(moments), climbs: [], routeFits });

test("#7717 enkeltstart: motorens daarlige dag er aarsagen, ogsaa vejret som type", () => {
  assert.equal(ittWhy(30, [], [moment("bad_day", 24, { rider_id: "a", reason: "fatigue" })]).main, "badDayFatigue");
  assert.equal(ittWhy(30, [], [moment("bad_day", 24, { rider_id: "a", reason: "weather", weather: "rain" })]).main, "badDayRain");
  assert.equal(ittWhy(30, [dayWord("bad", { reason: "form" })]).main, "badDayForm");
  assert.equal(ittWhy(30, [dayWord("bad", { reason: "weather", weather: "wind" })]).main, "badDayWind");
  assert.equal(ittWhy(30, [], [moment("bad_day", 24, { rider_id: "b", reason: "fatigue" })]).known, false, "en andens daarlige dag");
});

test("#7717 enkeltstart: uheld med tidstab forklarer foer dagen", () => {
  const crash = moment("incident", 12, { rider_id: "a", kind: "crash", outcome: "time_loss" });
  const bad = moment("bad_day", 24, { rider_id: "a", reason: "form" });
  const why = ittWhy(30, [], [crash, bad]);
  assert.equal(why.main, "crashLoss");
  assert.equal(why.lead, "badDayForm");
  assert.equal(ittWhy(30, [], [moment("incident", 12, { rider_id: "a", kind: "mechanical", outcome: "time_loss" })]).main, "mechanicalLoss");
  assert.equal(ittWhy(30, [], [moment("incident", 12, { rider_id: "a", kind: "crash", outcome: "protected_three_km_rule" })]).known, false);
});

test("#7717 enkeltstart: en god dag siges kun, naar resultatet ikke modsiger den", () => {
  assert.equal(ittWhy(3, [dayWord("great")]).main, "ttDayGreat");
  assert.equal(ittWhy(15, [dayWord("good")]).main, "ttDayGood");
  assert.equal(ittWhy(35, [dayWord("great")]).known, false, "langt nede kan en god dag ikke vaere forklaringen");
});

test("#7717 enkeltstart: ruten sammenlignes med holdkammeraterne og skal passe til placeringen", () => {
  assert.deepEqual(ittWhy(4, [], [], FITS), { known: true, main: "ttRouteGood", where: { kind: "none" }, lead: null, leadWhere: { kind: "none" } });
  assert.equal(ittWhy(35, [], [], FITS, "d").main, "ttRouteBad");
  assert.equal(ittWhy(35, [], [], FITS).known, false, "ruten passede ham, men han sluttede langt nede");
  assert.equal(ittWhy(4, [], [], FITS, "d").known, false, "ruten passede ham ikke, men han kom langt frem");
  assert.equal(ittWhy(20, [], [], FITS).known, false, "midt i feltet er ruten ikke forklaringen");
  assert.equal(ittWhy(4, [], [], null).known, false, "uden rute-match siges intet (andre holds ryttere)");
  assert.equal(ittWhy(4, [], [], new Map([["a", 30]])).known, false, "ingen holdkammerater at sammenligne med");
});

test("#7717 enkeltstart: dag og rute i samme saetning; vinderen faar aldrig en daarlig dag", () => {
  const bad = moment("bad_day", 24, { rider_id: "d", reason: "form" });
  const worst = riderWhy({ riderId: "d", rank: 35, events: ittEvents(), story: ittStory([bad]), climbs: [], routeFits: FITS });
  assert.equal(worst.main, "badDayForm");
  assert.equal(worst.lead, "ttRouteBad");
  const best = ittWhy(2, [dayWord("great")], [], FITS);
  assert.equal(best.main, "ttDayGreat");
  assert.equal(best.lead, "ttRouteGood");
  assert.equal(ittWhy(1, [], [moment("bad_day", 24, { rider_id: "a", reason: "form" })]).main, "ttFastest");
  assert.equal(ittWhy(1).main, "ttFastest");
});

test("#7717 enkeltstart: ingen aarsag i data giver ingen forklaring; holdtidskoersel er uroert", () => {
  assert.equal(ittWhy(20).known, false);
  assert.equal(ittWhy(2).known, false, "en fin placering alene er ikke en aarsag");
  const ttt: Ev = { km: 0, type: "stage_start", params: { field_count: 40, profile_type: "ttt", distance_km: 24 } };
  const why = riderWhy({ riderId: "a", rank: 1, events: [ttt, dayWord("great")], story: ittStory(), climbs: [], routeFits: FITS });
  assert.equal(why.known, false);
});

test("#7717 enkeltstart: udgaaet foelger stadig udgaaet-grenen", () => {
  const crash = moment("incident", 12, { rider_id: "a", kind: "crash", outcome: "abandoned" });
  const why = riderWhy({ riderId: "a", rank: null, status: "dnf", reasonKey: "crash", events: ittEvents(), story: ittStory([crash]), climbs: [] });
  assert.equal(why.main, "abandonedCrash");
});

test("stedet: et km-spaend siger kun en stigning hvis hele stykket ligger paa den", () => {
  const story = storyOf([], null);
  const on = moment("x", 72, {}, { km_span: { from: 72, to: 79 } });
  const off = moment("x", 50, {}, { km_span: { from: 50, to: 79 } });
  assert.deepEqual(placeOf(on, story, [COL]), { kind: "climb", name: "Col Test" });
  assert.deepEqual(placeOf(off, story, [COL]), { kind: "none" });
  assert.deepEqual(placeOf(moment("x", 97, {}), story, [COL]), { kind: "finale" });
  assert.deepEqual(placeOf(moment("x", 30, {}), story, [COL]), { kind: "none" });
  const unnamed = { ...COL, name: null };
  assert.deepEqual(placeOf(moment("x", 75, {}), story, [unnamed]), { kind: "lastClimb" });
  assert.deepEqual(placeOf(moment("x", 75, {}), story, [unnamed, { ...COL, crest_km: 95 }]), { kind: "someClimb" });
});

const locale = (lang: string) => JSON.parse(readFileSync(new URL(`../../public/locales/${lang}/races.json`, import.meta.url), "utf8")).stagePageV2.why;

test("teksten baerer aldrig tal, og hvert udfald har en saetning paa alle sprog", () => {
  const source = readFileSync(new URL("./riderWhyModel.ts", import.meta.url), "utf8");
  const mains = [...(/export type WhyMain =([\s\S]*?);/.exec(source)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
  const leads = [...(/export type WhyLead =([\s\S]*?);/.exec(source)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.ok(mains.length > 20 && leads.length > 5);
  for (const lang of ["en", "da", "fr", "es", "nl"]) {
    const why = locale(lang);
    assert.deepEqual(Object.keys(why.main).sort(), [...mains].sort(), lang);
    assert.deepEqual(Object.keys(why.lead).sort(), [...leads].sort(), lang);
    for (const text of [...Object.values(why.main), ...Object.values(why.lead), ...Object.values(why.where), why.attackedWith, why.attackedWithMore] as string[]) {
      assert.doesNotMatch(text, /\d|\{\{/, `${lang}: ${text}`);
      assert.doesNotMatch(text, /\{(km|gap|time|seconds|rank)\b/, `${lang}: ${text}`);
    }
  }
});

test("kontakten slukket: 'Your day' tegner ingen knap og spoerger kun flaget", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const card = read("../components/race/stagePageV2/YourDayCard.tsx");
  const tab = read("../components/race/stagePageV2/StageTabV2.tsx");
  assert.match(card, /why: whyRows = null/);
  assert.match(card, /\{rowWhy && <RiderWhyButton/);
  assert.match(tab, /whyEnabled && !storyError \? \{/);
  assert.match(tab, /\} : null\), \[whyEnabled/);
  const flag = read("./riderWhyFlag.ts");
  assert.match(flag, /useState\(false\)/);
  assert.match(flag, /=== true/);
});

test("Codex: et angreb bag et overlevende udbrud kaldes ikke mislykket", () => {
  const finish = finishAt(100, [["breakaway-0", ["w"], 0, false], ["solo-1", ["a"], 60, false], ["peloton-0", ["c"], 120, true, 15]]);
  const attack = moment("finale_attack", 78, { rider_ids: ["a"] });
  assert.notEqual(riderWhy(input("a", 2, [], storyOf([attack], finish))).main, "attackBehind");
  const caught = moment("group_caught", 90, { rider_ids: ["a"] });
  assert.equal(riderWhy(input("a", 2, [], storyOf([attack, caught], finish))).main, "attackBehind");
});

const castOf = (mine: string[], names: Record<string, string>): Cast => ({
  nameOf: (id) => names[id] ?? null, mine: new Set(mine), rankOf: () => null, finishers: [],
});
const NAMES = { a: "Own", b: "Bravo", c: "Charlie", d: "Delta" };
const inBreak = finishAt(100, [["breakaway-0", ["w", "a"], 0, false], ["peloton-0", ["c"], 120, true, 15]]);

test("#7754: egen rytter faar navnene paa dem han angreb sammen med, uden tal", () => {
  const formed = moment("breakaway_formed", 10, { rider_ids: ["a", "b", "c"] });
  const cast = castOf(["a"], NAMES);
  assert.deepEqual(riderWhy(input("a", 2, [], storyOf([formed], inBreak), { cast })).companions, { names: "Bravo, Charlie", more: false });
  const bigger = moment("breakaway_formed", 10, { rider_ids: ["a", "b", "c", "d"] });
  assert.deepEqual(riderWhy(input("a", 2, [], storyOf([bigger], inBreak), { cast })).companions, { names: "Bravo, Charlie", more: true });
});

test("#7754: kun egne ryttere, og kun naar forklaringen er kendt", () => {
  const formed = moment("breakaway_formed", 10, { rider_ids: ["a", "b"] });
  assert.equal("companions" in riderWhy(input("a", 2, [], storyOf([formed], inBreak), { cast: castOf([], NAMES) })), false);
  assert.equal("companions" in riderWhy(input("a", 2, [], storyOf([formed], inBreak))), false);
  const unknown = riderWhy(input("a", 2, [], storyOf([formed], null), { cast: castOf(["a"], NAMES) }));
  assert.equal(unknown.known, false);
  assert.equal("companions" in unknown, false);
});

test("#7754: hvad haendelserne ikke beviser, siges ikke", () => {
  const cast = castOf(["a"], NAMES);
  const companionsFrom = (m: StoryMoment) => riderWhy(input("a", 2, [], storyOf([m], inBreak), { cast })).companions;
  assert.equal(companionsFrom(moment("breakaway_formed", 10, { rider_ids: ["a"] })), undefined, "alene");
  assert.equal(companionsFrom(moment("breakaway_formed", 10, { rider_ids: ["b", "c"] })), undefined, "ikke med");
  assert.equal(companionsFrom(moment("breakaway_formed", 10, { rider_ids: ["a", "x"] })), undefined, "ukendt navn");
  assert.equal(companionsFrom(moment("finale_attack", 90, { kind: "carried_gap_held", rider_ids: ["a", "b"] })), undefined, "bogfoering");
  assert.equal(companionsFrom(moment("group_merged", 50, { rider_ids: ["a", "b"] })), undefined, "kom til senere");
  assert.deepEqual(companionsFrom(moment("finale_attack", 90, { direction: "descent", rider_ids: ["a", "b"] })), { names: "Bravo", more: false });
});

test("#7754: det seneste faelles angreb taeller", () => {
  const moments = [moment("breakaway_formed", 10, { rider_ids: ["a", "b"] }), moment("finale_attack", 90, { direction: "descent", rider_ids: ["a", "c"] })];
  assert.equal(riderWhy(input("a", 2, [], storyOf(moments, inBreak), { cast: castOf(["a"], NAMES) })).companions?.names, "Charlie");
});

test("Codex: tilbageslag findes ogsaa, naar stedet er praecist (exact_km)", () => {
  const why = riderWhy(input("a", 12, [split(90, "wprime_depleted", "a", { exact_km: 75 })], storyOf([splitMoment(75, "wprime_depleted")], behind)));
  assert.deepEqual(why.where, { kind: "climb", name: "Col Test" });
});
