// #6469: hvorfor udbruddet holdt eller blev hentet, og hvornaar spillerens egen ordre
// ses i udfaldet. Kontrakter paa syntetiske tidslinjer og paa motorens egne
// tidslinjer (spec 2026-10-17 P5/G7: hver udbrudssejr har mindst en aarsag).
// Ingen balance-tal (hard rule 17): kun arter, id'er og navne.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveBreakawayStories, deriveOrderImpacts, withNarrativeCauses, MAX_CAUSES_PER_BREAKAWAY } from "./narrativeCauses6469.ts";
import type { NarrativeEvent } from "./narrativeCauses6469.ts";
import { simulateStageV4 } from "../index.ts";
import type { GcContext } from "../types.ts";

const ev = (km: number, type: string, params: Record<string, unknown> = {}): NarrativeEvent => ({ km, type, params });
const formed = ev(10, "breakaway_formed", { group_id: "breakaway-0", rider_ids: ["a", "b"] });
const survived = (km = 150, riders = ["a"]) => ev(km, "breakaway_survived", { group_id: "breakaway-0", rider_ids: riders });
const sep = (km: number, seconds: number) => ev(km, "gap_update", { group_id: "breakaway-0", gap_seconds: 0, chase_group_id: "peloton-0", separation_seconds: seconds });
const kinds = (events: NarrativeEvent[]) => deriveBreakawayStories(events).flatMap((s) => s.causes.map((c) => c.kind));

test("#6469: intet hold ville jage, og holdene med interesse havde ingen ryttere", () => {
  assert.deepEqual(kinds([formed, ev(60, "breakaway_unchased", { group_id: "breakaway-0" }), survived()]), ["unchased"]);
  assert.deepEqual(kinds([formed, ev(60, "breakaway_unchased", { group_id: "breakaway-0", reason: "no_riders" }), survived()]), ["no_chasers"]);
  // En melding om et andet udbrud forklarer ikke dette.
  assert.deepEqual(kinds([formed, ev(60, "breakaway_unchased", { group_id: "breakaway-9" }), survived()]), []);
});

test("#6469: hold med egne ryttere i udbruddet og klassementsreaktioner der slap", () => {
  const story = deriveBreakawayStories([
    formed,
    ev(20, "own_riders_ahead", { team_id: "t-own", group_id: "breakaway-0", rider_ids: ["b"], reason: "chase_order" }),
    ev(40, "gc_reaction", { team_id: "t-gc", status: "started", reason: "threat", protected_rider_id: "x", rider_ids: ["a"] }),
    ev(90, "gc_reaction", { team_id: "t-gc", status: "exhausted", reason: "budget_exhausted", protected_rider_id: "x", rider_ids: ["a"] }),
    survived(),
  ])[0];
  assert.equal(story.outcome, "held");
  assert.deepEqual(story.causes, [{ kind: "own_riders_ahead", team_ids: ["t-own"] }, { kind: "reaction_spent", team_ids: ["t-gc"] }]);
  // En reaktion paa en trussel UDEN for udbruddet er ikke en aarsag til at det holdt.
  assert.deepEqual(kinds([formed, ev(90, "gc_reaction", { team_id: "t-gc", status: "exhausted", protected_rider_id: "x", rider_ids: ["z"] }), survived()]), []);
  assert.deepEqual(kinds([formed, ev(90, "gc_reaction", { team_id: "t-gc", status: "unavailable", protected_rider_id: "x", rider_ids: ["b"] }), survived()]), ["no_free_riders"]);
  assert.deepEqual(kinds([formed, ev(90, "gc_reaction", { team_id: "t-gc", status: "stopped", reason: "contained", protected_rider_id: "x", rider_ids: ["b"] }), survived()]), ["gc_contained"]);
});

test("#6469: jagten doede ud efter en stigning (tidslinjens egen afstand)", () => {
  const events = [formed, sep(40, 300), ev(78, "kom_passage", { name: "Col X", category: "2" }), sep(80, 120), sep(120, 400), survived()];
  assert.deepEqual(deriveBreakawayStories(events)[0].causes, [{ kind: "chase_faded", climb_name: "Col X" }]);
  // Uden en top omkring vendepunktet naevnes ingen stigning.
  const flat = [formed, ev(20, "kom_passage", { name: "Tidlig top" }), sep(40, 300), sep(80, 120), sep(120, 400), survived()];
  assert.deepEqual(deriveBreakawayStories(flat)[0].causes, [{ kind: "chase_faded" }]);
  assert.deepEqual(kinds([formed, sep(40, 300), sep(80, 200), sep(140, 90), survived()]), ["chase_too_late"]);
  assert.deepEqual(kinds([formed, sep(40, 100), sep(80, 300), survived()]), ["gap_never_closed"], "kun som sidste udvej");
  // Lukket ind fra en top midtvejs (ikke under foerste maaling) er stadig at lukke ind (Codex-fund).
  assert.deepEqual(kinds([formed, sep(40, 100), sep(80, 300), sep(140, 150), survived()]), ["chase_too_late"]);
  assert.deepEqual(kinds([formed, sep(40, 100), sep(80, 300), sep(100, 150), sep(140, 320), survived()]), ["chase_faded"]);
  assert.deepEqual(kinds([formed, survived()]), [], "ingen maaling, ingen haendelse: ingen aarsag (aerlig)");
});

test("#6469: aeldre tidslinjer uden jagtafstand bruger jagtgruppens hul minus udbruddets", () => {
  const legacy = [
    formed,
    ev(40, "gap_update", { group_id: "peloton-0", gap_seconds: 300 }),
    ev(80, "gap_update", { group_id: "peloton-0", gap_seconds: 100 }),
    ev(130, "gap_update", { group_id: "peloton-0", gap_seconds: 60 }),
    survived(),
  ];
  assert.deepEqual(kinds(legacy), ["chase_too_late"]);
});

test("#6469: hentet: holdet jagede for sin klassementsrytter, og hullet faldt over stigningen", () => {
  const events = [
    formed,
    sep(40, 300),
    ev(50, "gc_reaction", { team_id: "t-gc", status: "started", reason: "threat", protected_rider_id: "x", rider_ids: ["a", "z"] }),
    ev(50, "gc_reaction", { team_id: "t-other", status: "started", reason: "threat", protected_rider_id: "y", rider_ids: ["a"] }),
    sep(80, 250),
    ev(110, "kom_passage", { name: "Col Y", category: "1" }),
    sep(112, 60),
    ev(130, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["a", "b"], chase_group_id: "peloton-0", chasing_team_ids: ["t-gc"] }),
  ];
  const story = deriveBreakawayStories(events)[0];
  assert.equal(story.outcome, "caught");
  assert.deepEqual(story.causes, [
    { kind: "gc_threat", team_ids: ["t-gc"], protected_rider_id: "x", rider_ids: ["a"] },
    { kind: "closed_on_climb", climb_name: "Col Y" },
  ], "kun hold der faktisk jagede; kun truslens ryttere i udbruddet");
});

test("#6469: hoejst to aarsager pr. udbrud, de vigtigste foerst; nyt udbrud faar sine egne", () => {
  const many = [formed, ev(30, "breakaway_unchased", { group_id: "breakaway-0" }), ev(31, "breakaway_unchased", { group_id: "breakaway-0", reason: "no_riders" }), ev(32, "own_riders_ahead", { team_id: "t", group_id: "breakaway-0", rider_ids: ["b"] }), survived()];
  assert.equal(deriveBreakawayStories(many)[0].causes.length, MAX_CAUSES_PER_BREAKAWAY);
  assert.deepEqual(kinds(many), ["unchased", "no_chasers"]);
  const two = [
    formed,
    ev(50, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["a", "b"] }),
    ev(60, "breakaway_formed", { group_id: "breakaway-1", rider_ids: ["c"], reformation: true }),
    ev(90, "breakaway_unchased", { group_id: "breakaway-1" }),
    ev(150, "breakaway_survived", { group_id: "breakaway-1", rider_ids: ["c"] }),
  ];
  const stories = deriveBreakawayStories(two);
  assert.deepEqual(stories.map((s) => [s.group_id, s.outcome]), [["breakaway-0", "caught"], ["breakaway-1", "held"]]);
  assert.deepEqual(stories[1].causes, [{ kind: "unchased" }]);
});

test("#6469: et udbrud der deler sig, kan baade blive hentet og holde hjem (Codex-fund)", () => {
  const events = [
    formed,
    ev(60, "breakaway_dropped", { group_id: "chase-1", from_group_id: "breakaway-0", rider_ids: ["b"] }),
    ev(70, "breakaway_unchased", { group_id: "breakaway-0" }),
    ev(90, "breakaway_caught", { group_id: "chase-1", rider_ids: ["b"] }),
    ev(150, "breakaway_survived", { group_id: "breakaway-0", rider_ids: ["a"] }),
  ];
  const stories = deriveBreakawayStories(events);
  assert.deepEqual(stories.map((s) => [s.outcome, s.survivor_ids]), [["caught", []], ["held", ["a"]]]);
  assert.deepEqual(stories[1].causes, [{ kind: "unchased" }]);
  // Overlever under et nyt gruppe-id: stadig dagens udbrud, og spillerens "Alt ud" ses.
  const renamed = [formed, ev(60, "peloton_splits", { group_id: "split-9", rider_ids: ["a"] }), ev(150, "breakaway_survived", { group_id: "split-9", rider_ids: ["a"] })];
  assert.deepEqual(deriveOrderImpacts(renamed, { ownRiderIds: ["a"], effortByRider: new Map([["a", "all_out"]]) }).map((o) => o.kind), ["all_out_stayed_away"]);
});

test("#6469: aarsagerne udledes i loebets raekkefoelge, selv naar filmen har flyttet udfaldet til et km-spaend (Codex-fund)", () => {
  // Filmens liste: indhentningen staar ved spaendets start (km 100), motoren skrev den ved km 130.
  const shown = [
    formed,
    sep(40, 300),
    { km: 100, recorded_km: 130, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a", "b"] } },
    sep(112, 250),
    ev(120, "kom_passage", { name: "Col Z" }),
    sep(128, 40),
  ];
  const out = withNarrativeCauses(shown);
  const at = out.findIndex((e) => e?.type === "breakaway_caught");
  assert.deepEqual(out[at + 1]?.params, { group_id: "breakaway-0", outcome: "caught", cause: "closed_on_climb", climb_name: "Col Z" });
});

test("#6469: spillerens egen 'Alt ud' ses kun naar udfaldet viser det, kun for egne ryttere", () => {
  const finish = ev(150, "finish", { top: [{ rider_id: "w", rank: 1, gap: 0 }, { rider_id: "ada", rank: 2, gap: 0 }, { rider_id: "q", rank: 3, gap: 40 }] });
  const climb = ev(140, "kom_passage", { name: "Sidste top", top: [{ rider_id: "w" }, { rider_id: "ada" }] });
  const effort = new Map([["ada", "all_out"], ["bo", "save"], ["a", "all_out"], ["cy", "protect"]]);
  const events = [formed, survived(120, ["a"]), climb, finish];
  assert.deepEqual(
    deriveOrderImpacts(events, { ownRiderIds: ["ada", "bo", "a"], effortByRider: effort }).map(({ kind, rider_id, climb_name }) => ({ kind, rider_id, climb_name })),
    [{ kind: "all_out_stayed_away", rider_id: "a", climb_name: undefined }, { kind: "all_out_held_on", rider_id: "ada", climb_name: "Sidste top" }],
  );
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: ["bo"], effortByRider: effort }), [], "spar kraefter: intet udsagn");
  assert.deepEqual(deriveOrderImpacts([formed, survived(120, ["cy"]), climb, finish], { ownRiderIds: ["cy"], effortByRider: effort }), [], "arbejd eller angrib er ikke 'alt ud'");
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: [], effortByRider: effort }), [], "andres ryttere: aldrig");
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: ["ada"], effortByRider: null }), [], "ingen ordre-data");
  // Ikke blandt de foerste over toppen: kun udfaldet siges, aldrig stigningen (Codex-fund).
  const otherTop = ev(140, "kom_passage", { name: "Sidste top", top: [{ rider_id: "w" }] });
  assert.deepEqual(deriveOrderImpacts([otherTop, finish], { ownRiderIds: ["ada"], effortByRider: effort }).map(({ kind, climb_name }) => [kind, climb_name]), [["all_out_held_on", undefined]]);
  // Hele feltet i samme tid (massespurt) er ikke at "holde hjul".
  const bunch = ev(150, "finish", { top: [{ rider_id: "w", rank: 1, gap: 0 }, { rider_id: "ada", rank: 2, gap: 0 }] });
  assert.deepEqual(deriveOrderImpacts([climb, bunch], { ownRiderIds: ["ada"], effortByRider: effort }), []);
});

// #7381: testens egen stand-in for frontendens StageOrderEfforts (indsatser + taskAt).
// Opgaven ved km er her blot den seneste (fraKm, opgave) strengt foer km; den rigtige
// opslagsregel (stage_plan_leg-events) testes i frontend (allOutStoryPlan7381.test.ts).
function planEfforts(effort: Array<[string, string]>, plans: Record<string, Array<[number, string]>>) {
  return Object.assign(new Map(effort), {
    taskAt(_events: readonly NarrativeEvent[], id: string, km: number): string | null {
      const legs = plans[id];
      if (!legs) return null;
      return legs.filter(([from], i) => i === 0 || from < km).at(-1)?.[1] ?? null;
    },
  });
}

test("#7381: plan-rytter paa angreb i et udbrud der holdt, faar 'Alt ud holdt udbruddet'", () => {
  const finish = ev(150, "finish", { top: [{ rider_id: "a", rank: 1, gap: 0 }, { rider_id: "q", rank: 2, gap: 40 }] });
  const events = [formed, survived(150, ["a"]), finish];
  const efforts = planEfforts([], { a: [[0, "attack"]] });
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: ["a"], effortByRider: efforts }).map(({ kind, rider_id }) => [kind, rider_id]), [["all_out_stayed_away", "a"]]);
  // Opgaven da udbruddet holdt taeller: angreb efter et forsoeg-led giver ogsaa historien.
  assert.equal(deriveOrderImpacts(events, { ownRiderIds: ["a"], effortByRider: planEfforts([], { a: [[0, "breakaway"], [90, "attack"]] }) }).length, 1);
  // Forsoeg (normal indsats) eller et skift vaek fra angreb foer udfaldet: ingen historie.
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: ["a"], effortByRider: planEfforts([], { a: [[0, "breakaway"]] }) }), []);
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: ["a"], effortByRider: planEfforts([], { a: [[0, "attack"], [140, "ride_for_result"]] }) }), []);
  // Andres ryttere: aldrig, ogsaa med en plan.
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: [], effortByRider: efforts }), []);
});

test("#7381: plan-rytter der foerst skiftede til angreb efter at udbruddet blev hentet, faar ingen historie", () => {
  const caught = ev(80, "breakaway_caught", { group_id: "breakaway-0", rider_ids: ["a", "b"] });
  const finish = ev(150, "finish", { top: [{ rider_id: "w", rank: 1, gap: 0 }, { rider_id: "a", rank: 2, gap: 0 }, { rider_id: "q", rank: 3, gap: 40 }] });
  const efforts = planEfforts([], { a: [[0, "follow_moves"], [90, "attack"]] });
  assert.deepEqual(deriveOrderImpacts([formed, caught, finish], { ownRiderIds: ["a"], effortByRider: efforts }), []);
  assert.deepEqual(withNarrativeCauses([formed, caught, finish], { ownRiderIds: ["a"], effortByRider: efforts }).filter((e) => e?.type === "order_impact"), []);
});

test("#7381: uden plan er alt som foer, ogsaa naar ordrerne kan slaa planer op", () => {
  const finish = ev(150, "finish", { top: [{ rider_id: "w", rank: 1, gap: 0 }, { rider_id: "ada", rank: 2, gap: 0 }, { rider_id: "q", rank: 3, gap: 40 }] });
  const events = [formed, survived(120, ["a"]), finish];
  const plain = new Map([["a", "all_out"], ["ada", "all_out"], ["bo", "save"]]);
  const withLookup = planEfforts([...plain], {});
  for (const efforts of [plain, withLookup]) {
    assert.deepEqual(
      deriveOrderImpacts(events, { ownRiderIds: ["a", "ada", "bo"], effortByRider: efforts }).map(({ kind, rider_id }) => [kind, rider_id]),
      [["all_out_stayed_away", "a"], ["all_out_held_on", "ada"]],
    );
  }
  assert.deepEqual(deriveOrderImpacts(events, { ownRiderIds: ["a"], effortByRider: planEfforts([["a", "save"]], {}) }), [], "spar kraefter uden plan: intet");
});

test("#6469: linjerne indsaettes lige efter udfaldet; input uroert; uden udbrud samme indhold", () => {
  const events = [formed, ev(60, "breakaway_unchased", { group_id: "breakaway-0" }), survived(), ev(150, "finish", { top: [] })];
  const frozen = JSON.stringify(events);
  const out = withNarrativeCauses(events);
  assert.equal(JSON.stringify(events), frozen);
  assert.deepEqual(out.map((e) => e?.type), ["breakaway_formed", "breakaway_unchased", "breakaway_survived", "breakaway_cause", "finish"]);
  assert.deepEqual(out[3], { km: 150, type: "breakaway_cause", params: { group_id: "breakaway-0", outcome: "held", cause: "unchased" } });
  const plain = [ev(0, "stage_start"), ev(150, "finish", { top: [] })];
  assert.deepEqual(withNarrativeCauses(plain), plain);
});

test("#6469 fog of war: aarsager og ordre-linjer baerer aldrig et tal", () => {
  const events = [formed, sep(40, 300), ev(78, "kom_passage", { name: "Col X" }), sep(80, 120), sep(120, 400), ev(121, "own_riders_ahead", { team_id: "t", group_id: "breakaway-0", rider_ids: ["b"] }), survived()];
  for (const e of withNarrativeCauses(events, { ownRiderIds: ["a"], effortByRider: new Map([["a", "all_out"]]) })) {
    if (e?.type !== "breakaway_cause" && e?.type !== "order_impact") continue;
    for (const [key, value] of Object.entries(e.params ?? {})) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) assert.notEqual(typeof v, "number", `${e.type}.${key}`);
    }
  }
});

// ── Motorens egne tidslinjer (G7) ─────────────────────────────────────────────
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(fixturesDir, name, "input.json"), "utf8"));
const firstStage: GcContext = { status: "first_stage", stage_number: 1 };

test("#6469 G7: hver udbrudssejr i motorens egne v3-tidslinjer har mindst en aarsag; deterministisk", () => {
  let held = 0;
  for (const name of ["flat-massespurt", "bjerg-selektion", "punch-finale-forspring"]) {
    const input = fixture(name);
    for (const teams of [0, 4]) {
      const startlist = teams ? input.startlist.map((r: Record<string, unknown>, i: number) => ({ ...r, team_id: `team-${i % teams}` })) : input.startlist;
      const out = simulateStageV4({ ...input, startlist, gc_context: firstStage, rules_revision: "s5_profiles_v3" });
      const events = out.timeline.events as NarrativeEvent[];
      const stories = deriveBreakawayStories(events);
      assert.deepEqual(stories, deriveBreakawayStories(events), `${name}: samme tidslinje, samme svar`);
      for (const story of stories) {
        if (story.outcome !== "held") continue;
        held++;
        assert.ok(story.causes.length >= 1, `${name} (hold=${teams}): udbrudssejr uden aarsag`);
      }
      // Hver udfalds-haendelse for et morgen-udbrud er dækket af en historie.
      const outcomes = events.filter((e) => e?.type === "breakaway_survived").length;
      assert.equal(stories.filter((s) => s.outcome === "held").length, outcomes, name);
    }
  }
  assert.ok(held > 0, "fixturerne indeholder mindst en udbrudssejr");
});

test("#6469 context: the actual ITT engine fixture never produces a group-order story", () => {
  const input = fixture("itt-solo");
  const output = simulateStageV4({ ...input, rules_revision: "s5_profiles_v3" });
  const winner = output.results.find(r => r.rank === 1)!.rider_id;
  assert.deepEqual(deriveOrderImpacts(output.timeline.events, { ownRiderIds: [winner], effortByRider: new Map([[winner, "all_out"]]) }), []);
});
test("#6469 context: ITT, hilly ITT and TTT reject breakaway stories, including inconsistent old events", () => {
  for (const profile of ["itt", "itt_hilly", "ttt"]) {
    const events = [ev(0, "stage_start", { profile_type: profile }), formed, ev(40, "breakaway_unchased", { group_id: "breakaway-0" }), survived(), ev(150, "finish", { win_type: profile === "ttt" ? "ttt_win" : "itt_win", top: [{ rider_id: "a", rank: 1, gap: 0 }, { rider_id: "q", rank: 2, gap: 40 }] })];
    assert.deepEqual(deriveBreakawayStories(events), [], profile);
    const shown = withNarrativeCauses(events, { ownRiderIds: ["a"], effortByRider: new Map([["a", "all_out"]]) });
    assert.equal(shown.some(e => /^breakaway_/.test(e?.type ?? "") || e?.type === "order_impact"), false, profile);
  }
});
