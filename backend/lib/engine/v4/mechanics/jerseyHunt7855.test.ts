// #7855 ejerens tre valg 12/11 (spec docs/superpowers/specs/2026-11-12-7855-troejejagt-ejervalg.md):
// A udbrud og jagt sammen, B evnen afgoer mod dem der kaemper, C hver spurt koster.
// Dommens scenarier som faste tests paa testportens frosne felt (to menneskehold med planer, resten
// AI-ordrer gennem produktions-adapteren). Ingen balance-tal: kun relationer (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computePassageOrder, jerseyHuntMadeToContest7855, type PassageContest } from "./bonusSeconds.ts";
import { jerseyHuntFrontWork7855, passageHuntersField7855 } from "./jerseyHunt7855.ts";
import { boundRngFor } from "../rng.ts";
import { BONUS_SECONDS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { frozenField, frozenStages } from "../testUtils/oldRevisionDigests6199.ts";
import { golden7855Digests } from "../testUtils/jerseyHunt7855Golden.ts";
import { legacyOrderFromPlan, planHasJerseyHunt, planWithoutJerseyHunt, type StagePlanLeg } from "../../../stagePlan.ts";
import { stageWorkExposure, stageCaughtBreakaway } from "../../../raceFatigue.js";
import { stageLoadV2 } from "../../../conditionModelV2.js";
import type { AbilityKey, Entrant, EngineState, RaceGroup, RiderState, StageInput, StageOutput, StagePassage } from "../types.ts";

// ── B: passagens raekkefoelge (enhed, stoej 0) ──────────────────────────────

const KEYS: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
const ab = (v: number): Record<AbilityKey, number> => Object.fromEntries(KEYS.map((k) => [k, v])) as Record<AbilityKey, number>;
const ent = (id: string, role: string, v: number): Entrant => ({ rider_id: id, abilities: ab(v), role, effort: "normal", condition: 1 } as Entrant);
const rs = (id: string, g: string): RiderState => ({ rider_id: id, group_id: g, cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 } as RiderState);

/** Et felt paa tolv (ingen lille gruppe) plus et lille udbrud foran. */
function field(riders: Entrant[], breakIds: string[] = []): { state: EngineState; entrants: Record<string, Entrant> } {
  const fill = Array.from({ length: 12 }, (_, i) => ent(`fill${i}`, "helper", 30));
  const all = [...riders, ...fill];
  const pel = all.filter((r) => !breakIds.includes(r.rider_id)).map((r) => r.rider_id);
  const groups: RaceGroup[] = [
    ...(breakIds.length ? [{ id: "brk", kind: "breakaway", origin: "breakaway", rider_ids: breakIds, gap_seconds: 0, cohesion: 1 } as RaceGroup] : []),
    { id: "pel", kind: "peloton", rider_ids: pel, gap_seconds: breakIds.length ? 120 : 0, cohesion: 1 } as RaceGroup,
  ];
  const riders2 = Object.fromEntries(all.map((r) => [r.rider_id, rs(r.rider_id, breakIds.includes(r.rider_id) ? "brk" : "pel")]));
  return { state: { km: 0, groups, riders: riders2, virtual_gc: {} } as EngineState, entrants: Object.fromEntries(all.map((r) => [r.rider_id, r])) };
}

const SPRINT: PassageContest = { contenderRoles: BONUS_SECONDS_EXTRA_TUNING.intermediateSprintContenderRoles, openContestMaxGroupSize: BONUS_SECONDS_EXTRA_TUNING.passageOpenContestMaxGroupSize };
const order = (f: ReturnType<typeof field>, contest: PassageContest) => computePassageOrder(f.state, f.entrants, boundRngFor("s"), { stream: "passage:sprint:0", qualityWeights: BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights, noiseSd: 0, contest });

test("#7855 B: jaeger mod sprinterkaptajn, evnen afgoer begge veje; han slaar kun dem der ikke koerer med", () => {
  const f = field([ent("strongSc", "sprint_captain", 90), ent("hunter", "helper", 60), ent("weakSc", "sprint_captain", 40), ent("fastHelper", "helper", 95)]);
  const with7855 = order(f, { ...SPRINT, jerseyHuntIds7855: new Set(["hunter"]) });
  assert.deepEqual(with7855.slice(0, 4), ["strongSc", "hunter", "weakSc", "fastHelper"], "staerkere kaempende foran, svagere kaempende bag, ikke-kaempende bag ham");
  const without = order(f, SPRINT);
  assert.deepEqual(without.slice(0, 3), ["strongSc", "weakSc", "fastHelper"], "uden opgaven kaemper hjaelperen ikke");
  // Styrke straffes aldrig: ingen kaempende rytter er bag en svagere jaeger alene paa grund af opgaven.
  assert.ok(with7855.indexOf("strongSc") < with7855.indexOf("hunter"));
});

test("#7855 B: fire jaegere fra samme hold slaar ikke staerkere kaempende; intet loft", () => {
  const hunters = ["h1", "h2", "h3", "h4"];
  const f = field([ent("ai1", "sprint_captain", 92), ent("ai2", "sprint_captain", 88), ent("ai3", "free_role", 85), ...hunters.map((id, i) => ent(id, "helper", 50 + i)), ent("helperNo", "helper", 80)]);
  const o = order(f, { ...SPRINT, jerseyHuntIds7855: new Set(hunters) });
  assert.deepEqual(o.slice(0, 3), ["ai1", "ai2", "ai3"]);
  assert.deepEqual(o.slice(3, 7), ["h4", "h3", "h2", "h1"], "alle fire kaemper, ordnet efter evne");
  assert.ok(o.indexOf("helperNo") > 6, "en staerkere hjaelper uden opgaven koerer ikke med");
});

test("#7855 B: #6937-bjergjaegeren staar forrest, undtagen i en gruppe med en jaeger fra etapeplanen", () => {
  const kom: PassageContest = { contenderRoles: BONUS_SECONDS_EXTRA_TUNING.komContenderRoles, openContestMaxGroupSize: BONUS_SECONDS_EXTRA_TUNING.passageOpenContestMaxGroupSize, komHunterIds: new Set(["kom6937"]) };
  const komOrder = (f: ReturnType<typeof field>, c: PassageContest) => computePassageOrder(f.state, f.entrants, boundRngFor("s"), { stream: "passage:kom:0", qualityWeights: BONUS_SECONDS_EXTRA_TUNING.komQualityWeightsBig, noiseSd: 0, contest: c });
  const f = field([ent("kom6937", "helper", 40), ent("free", "free_role", 60), ent("plan", "helper", 80)]);
  assert.deepEqual(komOrder(f, kom).slice(0, 2), ["kom6937", "free"], "uden etapeplanens jaeger: #6937 som foer");
  assert.deepEqual(komOrder(f, { ...kom, jerseyHuntIds7855: new Set(["plan"]) }).slice(0, 3), ["plan", "free", "kom6937"], "med: evnen afgoer mellem alle kaempende");
  // En jaeger i en anden gruppe roerer ikke #6937 i feltet.
  const g = field([ent("kom6937", "helper", 40), ent("free", "free_role", 60), ent("plan", "helper", 80)], ["plan"]);
  assert.deepEqual(komOrder(g, { ...kom, jerseyHuntIds7855: new Set(["plan"]) }).slice(0, 3), ["plan", "kom6937", "free"]);
});

test("#7855 C: kun dem opgaven fik til at koere med betaler; passagens felter", () => {
  const f = field([ent("helperH", "helper", 50), ent("freeH", "free_role", 50), ent("sc", "sprint_captain", 50)]);
  const contest = { ...SPRINT, jerseyHuntIds7855: new Set(["helperH", "freeH", "sc"]) };
  assert.deepEqual(jerseyHuntMadeToContest7855(f.state, f.entrants, contest), ["helperH"]);
  // I en lille gruppe (udbruddet) koerer alle med: opgaven aendrer intet dér.
  const g = field([ent("helperH", "helper", 50), ent("other", "helper", 50)], ["helperH", "other"]);
  assert.deepEqual(jerseyHuntMadeToContest7855(g.state, g.entrants, { ...SPRINT, jerseyHuntIds7855: new Set(["helperH"]) }), []);
  assert.deepEqual(passageHuntersField7855([]), {});
  assert.deepEqual(passageHuntersField7855(["b", "a"]), { hunters: ["b", "a"] });
  assert.deepEqual(passageHuntersField7855(["b", "a"], ["b", "a"]), { hunters: ["b", "a"], hunt_work_7855: ["a", "b"] });
  const work = jerseyHuntFrontWork7855([
    { kind: "sprint", hunt_work_7855: ["a"] },
    { kind: "kom", hunt_work_7855: ["a", "b"] },
    { kind: "kom", hunt_work_7855: ["b"] },
    { kind: "kom" },
  ]);
  // #7855 valg 2 (ejer 13/11, "Mindre pr. spurt"): stykket pr. spurt er sat ned, saa en spurt ikke
  // laengere koster mere end en bjergtop (dommerens S4 er et aabent ejer-valg). Hver passage koster stadig.
  const oneSprint = jerseyHuntFrontWork7855([{ kind: "sprint", hunt_work_7855: ["a"] }]).get("a")!;
  const oneTop = jerseyHuntFrontWork7855([{ kind: "kom", hunt_work_7855: ["b"] }]).get("b")!;
  assert.ok(oneSprint > 0 && oneTop > 0, "en spurt og en bjergtop koster hver sit stykke");
  assert.ok(work.get("a")! > oneSprint && work.get("b")! > oneTop, "hver ekstra passage koster oveni");
  assert.equal(jerseyHuntFrontWork7855([{ kind: "kom" }]).size, 0);
  assert.equal(jerseyHuntFrontWork7855(undefined).size, 0);
});

test("#7855 C (Codex-review): loftet paa arbejdet i front goer aldrig en passage gratis", () => {
  const sprints = (n: number) => ({ groupSnapshots: [{ km: 100, groups: [{ kind: "breakaway", rider_ids: ["h"] }] }], passages: Array.from({ length: n }, () => ({ kind: "sprint", hunt_work_7855: ["h"] })) });
  const exp = (n: number) => exposureOf(sprints(n), "flat").get("h")!;
  assert.equal(exp(0).front, exp(4).front, "andelen i front er rytterens egen; jagten holdes for sig");
  const load = (n: number, caught: boolean) => loadV2({ profileType: "flat", distanceKm: 150, stageNumber: 1, effort: "normal", exposure: { ...exp(n), caught }, rulesRevision: REV });
  for (const caught of [false, true]) {
    assert.ok(load(3, caught) > load(2, caught) && load(4, caught) > load(3, caught), `hver ekstra passage koster, ogsaa ved fuld front (caught=${caught})`);
  }
  assert.equal(exposureOf({ groupSnapshots: [{ km: 100, groups: [{ kind: "breakaway", rider_ids: ["h"] }] }] }, "flat").get("h")!.hunt7855, undefined, "uden jagt: samme form som foer");
});

// ── Motoren: dommens scenarier ──────────────────────────────────────────────

const REV = "s5_profiles_v3";
const HUMAN = new Set(["team-0", "team-1"]);
const SEEDS = ["7855-dom-a", "7855-dom-b", "7855-dom-c", "7855-dom-d", "7855-dom-e", "7855-dom-f"];
const STAGES = frozenStages();
const stageRow = (profile: string) => structuredClone(STAGES.find((r) => r.profile_type === profile)!);
const flatTwoSprints = () => {
  const row = stageRow("flat") as Record<string, unknown>;
  row["sprints"] = [{ name: "Sprint A", km: 60, kind: "intermediate" }, { name: "Sprint B", km: 120, kind: "intermediate" }, { name: "Finish", km: row["distance_km"], kind: "finish" }];
  return row;
};

type Run = { output: StageOutput; profile: string; distanceKm: number };

function runStage(row: Record<string, unknown>, seed: string, plans: Record<string, StagePlanLeg[]>, flag = true): Run {
  const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const fieldRows = frozenField();
  const rows = new Map<string, { team_id: string; stage_number: number; riders: unknown[] }>();
  for (const r of fieldRows) {
    const legs = plans[r.rider_id];
    if (!legs) continue;
    assert.ok(HUMAN.has(String(r.team_id)), "kun menneskehold har planer");
    if (!rows.has(String(r.team_id))) rows.set(String(r.team_id), { team_id: String(r.team_id), stage_number: 1, riders: [] });
    rows.get(String(r.team_id))!.riders.push({ rider_id: r.rider_id, ...legacyOrderFromPlan(legs), plan: legs, ...(planHasJerseyHunt(legs) ? { plan_no_hunt: planWithoutJerseyHunt(legs) } : {}) });
  }
  const plan = buildStageOrderPlan({
    rows: [...rows.values()],
    stageNumber: 1,
    roster: fieldRows.map((r) => ({ team_id: r.team_id as string, rider_id: r.rider_id, role: r.role, is_ai: !HUMAN.has(String(r.team_id)), abilities: r.abilities })),
    context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: { is_stage_race: true, later_stages: [] }, rules_revision: REV },
  } as Parameters<typeof buildStageOrderPlan>[0]);
  const startlist = fieldRows.map((r) => ({ ...r, role: plan.aiRoleByRider?.get(r.rider_id) ?? r.role, effort: plan.aiEffortByRider.get(r.rider_id) ?? (plans[r.rider_id] ? legacyOrderFromPlan(plans[r.rider_id]).effort : r.effort) }));
  const input = { route, startlist, orders: plan.orders, seed: `${seed}:1`, tuning: RACE_V4_TUNING, rules_revision: REV, gc_context: { status: "first_stage", stage_number: 1 }, ...(flag ? { jersey_hunt_7855: true } : {}) } as StageInput;
  return { output: simulateStageV4(input), profile: route.profile_type, distanceKm: route.distance_km };
}

// raceFatigue.js / conditionModelV2.js er JS (JSDoc-typer); kun formen vi bruger.
const exposureOf = stageWorkExposure as unknown as (output: unknown, profileType: string | null) => Map<string, { front: number; shelter: number; hunt7855?: number }>;
const caughtOf = stageCaughtBreakaway as unknown as (output: unknown, profileType: string | null) => Set<string>;
const loadV2 = stageLoadV2 as unknown as (args: Record<string, unknown>) => number;
const fatigueOf = (run: Run, id: string, effort?: string) => {
  const exposure = exposureOf(run.output, run.profile).get(id) ?? null;
  const caught = caughtOf(run.output, run.profile).has(id);
  return loadV2({ profileType: run.profile, distanceKm: run.distanceKm, stageNumber: 1, effort: effort ?? run.output.stage_plan_load_efforts?.[id] ?? "normal", exposure: exposure ? { ...exposure, caught } : null, rulesRevision: REV });
};
const passagesOf = (run: Run, kind: "sprint" | "kom") => (run.output.passages ?? []).filter((p: StagePassage) => p.kind === kind && p.km < run.distanceKm);
const timesOf = (run: Run) => run.output.results.map((r) => [r.rider_id, r.time_seconds, r.rank]);
const inBreak = (run: Run, id: string) => (run.output.groupSnapshots ?? []).some((s) => (s.groups ?? []).some((g: { kind: string; rider_ids: string[] }) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.includes(id)));

test("#7855 B i motoren: en svag hjaelper med jagt rykker kun forbi dem der ikke koerer med", () => {
  for (const seed of SEEDS.slice(0, 4)) {
    const hunt = runStage(flatTwoSprints(), seed, { t0r3: [{ task: "hunt_points" }] });
    const tempo = runStage(flatTwoSprints(), seed, { t0r3: [{ task: "tempo" }] });
    assert.deepEqual(timesOf(hunt), timesOf(tempo), "samme indsats i loebet: samme loeb, jagten flytter kun passagepoint");
    for (const p of passagesOf(hunt, "sprint")) {
      const q = passagesOf(tempo, "sprint").find((x) => x.index === p.index)!;
      const ids = p.results.map((r) => r.rider_id);
      const before = ids.indexOf("t0r3") === -1 ? ids : ids.slice(0, ids.indexOf("t0r3"));
      assert.deepEqual(before, q.results.map((r) => r.rider_id).slice(0, before.length), `${seed} ${p.name}: foran ham de samme som uden opgaven`);
      assert.deepEqual(p.hunters, ["t0r3"]);
    }
  }
});

test("#7855 B i motoren: fire jaegere fra samme hold; de oevrige beholder deres indbyrdes orden", () => {
  const four = ["t0r2", "t0r3", "t0r4", "t0r5"];
  for (const seed of SEEDS.slice(0, 3)) {
    const hunt = runStage(flatTwoSprints(), seed, Object.fromEntries(four.map((id) => [id, [{ task: "hunt_points" }] as StagePlanLeg[]])));
    const base = runStage(flatTwoSprints(), seed, Object.fromEntries(four.map((id) => [id, [{ task: hunterTempoTask(id) }] as StagePlanLeg[]])));
    for (const p of passagesOf(hunt, "sprint")) {
      const q = passagesOf(base, "sprint").find((x) => x.index === p.index)!;
      const others = p.results.map((r) => r.rider_id).filter((id) => !four.includes(id));
      const othersBase = q.results.map((r) => r.rider_id).filter((id) => !four.includes(id));
      assert.deepEqual(others, othersBase.slice(0, others.length), `${seed} ${p.name}`);
    }
  }
});

/** Samme indsats i loebet som jagten (Haard), uden jagt: tempo for hjaelpere, foelg med for frie roller. */
function hunterTempoTask(id: string): StagePlanLeg["task"] {
  return frozenField().find((r) => r.rider_id === id)!.role === "free_role" ? "follow_moves" : "tempo";
}

test("#7855 C i motoren: jagt oven paa et tempo-led er aldrig gratis", () => {
  const row = stageRow("mountain") as Record<string, unknown>;
  const tops = ((row["climbs"] as Array<Record<string, unknown>>) ?? []).map((c, i): Record<string, unknown> & { i: number } => ({ ...c, i })).filter((c) => !c["summit_finish"] && ["HC", "1", "2", "3", "4"].includes(String(c["category"])));
  const late = { at: "kom", kom_index: tops[1].i } as const;
  let paid = 0;
  for (const seed of SEEDS) {
    // #7855 valg 1 (ejer 13/11): bjergjagten ligger paa udbrudsleddet, ikke som eget led; sammenlignes
    // med samme plan uden jagten (rent udbrud, derefter tempo).
    const hunt = runStage(row, seed, { t1r2: [{ task: "breakaway", hunt: "hunt_kom" }, { task: "tempo", from: late }] });
    const tempo = runStage(row, seed, { t1r2: [{ task: "breakaway" }, { task: "tempo", from: late }] });
    assert.deepEqual(timesOf(hunt), timesOf(tempo), "samme indsats i loebet");
    assert.equal(hunt.output.stage_plan_load_efforts?.["t1r2"], "protect", "dagens haardeste led er tempo");
    const worked = passagesOf(hunt, "kom").some((p) => p.hunt_work_7855?.includes("t1r2"));
    if (worked) {
      paid++;
      assert.ok(fatigueOf(hunt, "t1r2") > fatigueOf(tempo, "t1r2"), `${seed}: hver top han koerte med om koster oveni`);
    } else {
      assert.equal(fatigueOf(hunt, "t1r2"), fatigueOf(tempo, "t1r2"));
    }
  }
  assert.ok(paid > 0, "scenariet skal ramme mindst en betalt top");
});

test("#7855 C kalibrering: en hel dags jagt alene ligger ved prisordet Haard, aldrig under", () => {
  const flat = stageRow("flat");
  for (const seed of SEEDS.slice(0, 3)) {
    const hunt = runStage(flat, seed, { t0r2: [{ task: "hunt_points" }] });
    const tempo = runStage(flat, seed, { t0r2: [{ task: "tempo" }] });
    const middel = runStage(flat, seed, { t0r2: [{ task: "shelter_leader" }] });
    const h = fatigueOf(hunt, "t0r2");
    assert.ok(h >= fatigueOf(tempo, "t0r2"), `${seed}: aldrig under Haard`);
    assert.ok(Math.abs(h - fatigueOf(tempo, "t0r2")) < Math.abs(h - fatigueOf(middel, "t0r2")), `${seed}: naermere Haard end Middel`);
  }
});

// ── Frikortet (dom 2): jagten er aldrig en billigere vej til samme loeb ───────

const huntWorked = (run: Run, id: string) => [...passagesOf(run, "sprint"), ...passagesOf(run, "kom")].filter((p) => p.hunt_work_7855?.includes(id)).length;

test("#7855 frikort (dom 2): fri rolle og sprinterkaptajn betaler aldrig mindre med jagt end for samme loeb uden opgaven", () => {
  // De kaemper om passagerne i forvejen, saa opgaven giver dem samme loeb som foelg med (samme indsats).
  // #7855 valg 1 (ejer 13/11): bjergjagten findes kun paa udbrudsleddet, saa den sammenlignes med rent udbrud.
  const cases: Array<{ id: string; role: string; task: "hunt_points" | "hunt_kom"; profiles: string[]; plan: StagePlanLeg[]; base: StagePlanLeg[] }> = [
    { id: "t0r1", role: "sprint_captain", task: "hunt_points", profiles: ["flat", "hilly", "mountain"], plan: [{ task: "hunt_points" }], base: [{ task: "follow_moves" }] },
    { id: "t0r4", role: "free_role", task: "hunt_points", profiles: ["flat", "hilly", "mountain"], plan: [{ task: "hunt_points" }], base: [{ task: "follow_moves" }] },
    { id: "t0r4", role: "free_role", task: "hunt_kom", profiles: ["hilly", "mountain"], plan: [{ task: "breakaway", hunt: "hunt_kom" }], base: [{ task: "breakaway" }] },
  ];
  for (const c of cases) {
    assert.equal(frozenField().find((r) => r.rider_id === c.id)!.role, c.role);
    for (const profile of c.profiles) {
      for (const seed of SEEDS.slice(0, 3)) {
        const label = `${c.role} ${c.task} ${profile} ${seed}`;
        const hunt = runStage(stageRow(profile), seed, { [c.id]: c.plan });
        const follow = runStage(stageRow(profile), seed, { [c.id]: c.base });
        assert.ok(hunt.output.stage_plan_load_efforts?.[c.id], `${label}: planen er gyldig`);
        assert.ok([...passagesOf(hunt, "sprint"), ...passagesOf(hunt, "kom")].some((p) => p.hunters?.includes(c.id)), `${label}: han jager`);
        assert.deepEqual(timesOf(hunt), timesOf(follow), `${label}: samme loeb som foelg med`);
        assert.ok(fatigueOf(hunt, c.id) >= fatigueOf(follow, c.id), `${label}: jagten er aldrig billigere end foelg med`);
      }
    }
  }
});

test("#7855 valg 3: hver passage opgaven faar en hjaelper til at koere med om, koster oveni samme indsats uden opgaven", () => {
  // #7855 valg 1 (ejer 13/11): bjergjagten findes kun paa udbrudsleddet, saa den sammenlignes med rent udbrud.
  const cases: Array<{ id: string; task: "hunt_points" | "hunt_kom"; rows: Array<() => Record<string, unknown>>; plan: StagePlanLeg[]; base: StagePlanLeg[] }> = [
    { id: "t0r2", task: "hunt_points", rows: [() => stageRow("flat"), flatTwoSprints, () => stageRow("hilly"), () => stageRow("mountain")], plan: [{ task: "hunt_points" }], base: [{ task: "tempo" }] },
    { id: "t1r2", task: "hunt_kom", rows: [() => stageRow("hilly"), () => stageRow("mountain")], plan: [{ task: "breakaway", hunt: "hunt_kom" }], base: [{ task: "breakaway" }] },
  ];
  let paid = 0;
  for (const c of cases) {
    for (const row of c.rows) {
      for (const seed of SEEDS.slice(0, 3)) {
        const hunt = runStage(row(), seed, { [c.id]: c.plan });
        const tempo = runStage(row(), seed, { [c.id]: c.base });
        assert.deepEqual(timesOf(hunt), timesOf(tempo), "samme indsats i loebet: samme loeb");
        const label = `${c.task} ${hunt.profile} ${seed}`;
        if (huntWorked(hunt, c.id) > 0) {
          paid++;
          assert.ok(fatigueOf(hunt, c.id) > fatigueOf(tempo, c.id), `${label}: han spurtede mere og betaler mere`);
        } else {
          assert.ok(fatigueOf(hunt, c.id) >= fatigueOf(tempo, c.id), `${label}: aldrig billigere`);
        }
      }
    }
  }
  assert.ok(paid > 0, "scenarierne skal ramme betalte passager");
});

test("#7855 valg 3: to betalte spurter koster mere end én", () => {
  let compared = 0;
  for (const seed of SEEDS.slice(0, 3)) {
    const one = runStage(stageRow("flat"), seed, { t0r2: [{ task: "hunt_points" }] });
    const oneBase = runStage(stageRow("flat"), seed, { t0r2: [{ task: "tempo" }] });
    const two = runStage(flatTwoSprints(), seed, { t0r2: [{ task: "hunt_points" }] });
    const twoBase = runStage(flatTwoSprints(), seed, { t0r2: [{ task: "tempo" }] });
    if (huntWorked(two, "t0r2") <= huntWorked(one, "t0r2")) continue;
    compared++;
    assert.ok(fatigueOf(two, "t0r2") - fatigueOf(twoBase, "t0r2") > fatigueOf(one, "t0r2") - fatigueOf(oneBase, "t0r2"), `${seed}: flere betalte spurter, hoejere pris oven paa samme indsats`);
  }
  assert.ok(compared > 0, "scenariet skal ramme en etape med flere betalte spurter");
});

test("#7855 A: udbrud og bjergjagt fra start; samme loeb, og jagten gaelder ogsaa foerste top", () => {
  const row = stageRow("mountain") as Record<string, unknown>;
  let made = 0;
  let missed = 0;
  for (const seed of SEEDS) {
    const both = runStage(row, seed, { t1r2: [{ task: "breakaway", hunt: "hunt_kom" }] });
    const plain = runStage(row, seed, { t1r2: [{ task: "breakaway" }] });
    assert.deepEqual(timesOf(both), timesOf(plain), "jagten aendrer ikke udbrudsforsoeget eller loebet");
    assert.equal(both.output.stage_plan_load_efforts?.["t1r2"], "normal", "udbrudsleddets indsats");
    const first = passagesOf(both, "kom")[0];
    assert.ok(first.hunters?.includes("t1r2"), `${seed}: jagten gaelder fra start, ogsaa foerste top`);
    if (inBreak(both, "t1r2")) {
      made++;
    } else {
      // Ikke med i udbruddet: han koerer om pointene fra sin gruppe (feltet), hvor opgaven fik ham med.
      missed++;
      assert.ok(passagesOf(both, "kom").some((p) => p.hunt_work_7855?.includes("t1r2")), `${seed}: koerer med fra feltet`);
      assert.ok(fatigueOf(both, "t1r2") > fatigueOf(plain, "t1r2"), `${seed}: og det koster`);
    }
  }
  assert.ok(made > 0 && missed > 0, "begge udfald skal daekkes af frøene");
});

test("#7855 A: tilbagefaldet uden kontakten er et rent udbrud (bit-identisk med udbrud uden jagt)", () => {
  const row = stageRow("mountain") as Record<string, unknown>;
  for (const seed of SEEDS.slice(0, 2)) {
    const off = runStage(row, seed, { t1r2: [{ task: "breakaway", hunt: "hunt_kom" }] }, false);
    const plain = runStage(row, seed, { t1r2: [{ task: "breakaway" }] }, false);
    assert.deepEqual(off.output.results, plain.output.results);
    assert.deepEqual(off.output.passages, plain.output.passages);
  }
});

// ── Frossen golden fra merge-basen ──────────────────────────────────────────

test("#7855 slukket og taendt uden valgt jagt: bit-identisk med merge-basen (alle profiler, etapeloeb og endagsloeb, AI-hold)", () => {
  const frozen = JSON.parse(readFileSync(new URL("../../../__fixtures__/jerseyHunt7855Golden.json", import.meta.url), "utf8"));
  assert.match(frozen.sourceCommit, /^[0-9a-f]{40}$/);
  const off = golden7855Digests(false);
  assert.deepEqual(Object.keys(off).sort(), Object.keys(frozen.off).sort(), "samme scenarier");
  assert.deepEqual(off, frozen.off);
  assert.deepEqual(golden7855Digests(true), frozen.onNoHunt);
});
