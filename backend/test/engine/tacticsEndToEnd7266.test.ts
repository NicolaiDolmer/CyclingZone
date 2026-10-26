// #7266 (taktik-pakken, ejer 26/10): ende-til-ende for spillerens ordrer under s5_profiles_v3.
//
// Kaeden er den raceRunner koerer i prod, uden DB:
//   race_team_orders-raekke + race_stage_roles-raekke
//     -> raceStageRoles.resolveStageEntrants (+ orderEffortByRiderForStage: ordrens indsats vinder)
//     -> raceEngineV4Bridge.simulateStage (buildStageOrderPlan = teamOrdersAdapter,
//        entrantFromAbilitiesRow = entrantAdapter) -> motoren (simulateStageV4)
//
// Feltet er det anonymiserede Giro-felt (scripts/baselines/giro-field-6088-2026-10-02.json).
// For hver ordre koeres samme etape med og uden ordren (samme seed); testen gater kun
// RETNINGEN (summeret over faste seeds), aldrig hvor meget (hard rule 17). Maalingen af
// stoerrelse og stoej pr. loebsgruppe bor i scripts/dev/tacticsEffects7266.mjs (tal privat).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sortedStages, splitEntrants } from "../../scripts/dev/lib/tourScorecard.mjs";
import { breakLead } from "../../scripts/dev/tacticsEffects7266.mjs";
import { breakawayRiderIdsFromSnapshots, loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import { orderEffortByRiderForStage, resolveStageEntrants } from "../../lib/raceStageRoles.js";
import { raceConditionLoads, stageConditionWork } from "../../lib/raceFatigue.js";
import { legacyOrderFromPlan, type StagePlanLeg } from "../../lib/stagePlan.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const stages: any[] = sortedStages(data);
const REVISION = "s5_profiles_v3";
const SEEDS = [1, 2, 3];
const v4 = await loadRaceEngineV4();
const field: any[] = splitEntrants(data).entrants;
const stageOf = (n: number) => stages.find((p) => p.stage_number === n);

type OrderRow = { team_id: string; stage_number: number; breakaway_stance?: string; riders: any[] };
type RoleRow = { stage_number: number; rider_id: string; race_role: string; effort?: string };

/**
 * Én etape gennem raceRunner's kaede: raekkerne -> rolle/indsats pr. rytter -> bro -> motor.
 * `entrants` er race_entries-formen (basisrollen); raekkerne afgoer resten.
 */
function runStage({ stage, entrants, orderRows, roleRows = [], seed }: { stage: number; entrants: any[]; orderRows: OrderRow[]; roleRows?: RoleRow[]; seed: number }) {
  const overrides = new Map(roleRows.filter((r) => r.stage_number === stage).map((r) => [r.rider_id, { race_role: r.race_role, effort: r.effort ?? "normal" }]));
  const { entrants: resolved } = resolveStageEntrants(entrants, overrides, { orderEffortByRider: orderEffortByRiderForStage(orderRows, stage) });
  const profile = stageOf(stage);
  return v4.simulateStage({
    entrants: resolved, stageProfile: profile, seedString: `${data.race.id}:${stage}:e2e7266-${seed}`, stageNumber: stage,
    teamOrderRows: orderRows, isStageRace: true, raceStages: stages, squad: data.race.squad ?? null, rulesRevision: REVISION, gcStandings: null,
  });
}

const strength = (a: any) => (Number(a.climbing) || 0) + (Number(a.durability) || 0) + (Number(a.punch) || 0);
const gcStrength = (a: any) => (Number(a.climbing) || 0) + (Number(a.time_trial) || 0) + (Number(a.durability) || 0) + (Number(a.recovery) || 0);
const sprintStrength = (a: any) => (Number(a.sprint) || 0) + (Number(a.acceleration) || 0);
/** En rytter midt i feltet (skabelon til kloner). */
const midRider = field.slice().sort((a, b) => strength(a.abilities) - strength(b.abilities) || a.rider_id.localeCompare(b.rider_id))[Math.floor(field.length * 0.6)];
const strongRider = field.slice().sort((a, b) => strength(a.abilities) - strength(b.abilities) || a.rider_id.localeCompare(b.rider_id))[Math.floor(field.length * 0.9)];

/** Et menneskehold af kloner. */
function cloneRider(id: string, team: string, role: string, abilities: any) {
  return { rider_id: id, team_id: team, team_is_ai: false, race_role: role, effort: "normal", abilities };
}
const rowRider = (rider_id: string, extra: Record<string, unknown> = {}) => ({ rider_id, effort: "normal", try_break: false, leadout: false, ...extra });
const finTime = (res: any, id: string): number | null => {
  const r = (res.v4Output?.results ?? []).find((x: any) => x.rider_id === id && x.status === "finished");
  return r ? Number(r.time_seconds) : null;
};
const rankOf = (res: any, id: string, fallback: number): number => res.ranked.find((r: any) => r.rider_id === id)?.rank ?? fallback;
const attempters = (res: any): Set<string> => new Set((res.v4Output?.timeline?.events ?? []).filter((e: any) => e.type === "breakaway_attempt").flatMap((e: any) => e.params?.rider_ids ?? []));
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// ── 1. De fem indsatstrin ──────────────────────────────────────────────────

test("#7266 e2e: de fem indsatstrin naar motoren fra race_team_orders, og traetheden foelger trinnet", () => {
  const efforts = ["grupetto", "save", "normal", "protect", "all_out"];
  const ids = efforts.map((e) => `e2e-eff-${e}`);
  const twins = ids.map((id) => cloneRider(id, `team-${id}`, "free_role", strongRider.abilities));
  const behind: number[] = [];
  let compared = 0;
  for (const stage of [11, 14]) {
    const rows: OrderRow[] = [...data.orders, ...ids.map((id, i) => ({ team_id: `team-${id}`, stage_number: stage, breakaway_stance: "neutral", riders: [rowRider(id, { effort: efforts[i] })] }))];
    for (const seed of SEEDS) {
      const res = runStage({ stage, entrants: [...field, ...twins], orderRows: rows, seed });
      // Ordrens indsats er den motoren koerte (ikke basisraekkens "normal").
      ids.forEach((id, i) => assert.equal(res.efforts.get(id), efforts[i], `etape ${stage} seed ${seed}: ${id}`));
      const work = stageConditionWork({ rulesRevision: REVISION, stageNumber: stage, profileType: stageOf(stage).profile_type, v4Result: res });
      const loads = new Map(raceConditionLoads(ids, stageOf(stage).profile_type, res.efforts, REVISION, work).map((l: any) => [l.rider_id, l.load]));
      // save < normal < protect < all_out strengt. Grupetto er billigere end normal; mod spar
      // afhaenger det af dagen (grupettoen er laengere undervejs), saa den sammenligning gates ikke.
      // En fri rytter paa normal kan selv gaa med i morgenudbruddet, og en dag i udbruddet
      // koster ekstra; de par sammenlignes ikke (som #6641's dags-maaling).
      const inBreak = new Set([...breakawayRiderIdsFromSnapshots(res.v4Output?.groupSnapshots ?? [])].map(String));
      const cmp = (lo: string, hi: string) => {
        if (inBreak.has(lo) || inBreak.has(hi)) return;
        compared += 1;
        assert.ok(loads.get(hi) > loads.get(lo), `etape ${stage} seed ${seed}: ${hi} skal koste mere end ${lo}`);
      };
      for (let i = 2; i < ids.length; i++) cmp(ids[i - 1], ids[i]);
      cmp("e2e-eff-grupetto", "e2e-eff-normal");
      const g = finTime(res, "e2e-eff-grupetto");
      const n = finTime(res, "e2e-eff-normal");
      if (g != null && n != null) behind.push(g - n);
    }
  }
  assert.ok(compared >= 10, "traethedens raekkefoelge skal kunne sammenlignes paa de fleste par");
  assert.ok(behind.length > 0, "grupetto- og normal-tvillingen skal komme i maal");
  assert.ok(sum(behind) > 0, "grupetto skal samlet ende bag normal paa kuperet og bjerg");
});

// ── 2. Forsoeg udbrud (og grupetto + forsoeg udbrud) ───────────────────────

test("#7266 e2e: Forsoeg udbrud sender rytteren i morgenudbruds-forsoeget; grupetto + forsoeg aldrig", () => {
  const on = cloneRider("e2e-brk-on", "team-e2e-brk-on", "helper", midRider.abilities);
  const off = cloneRider("e2e-brk-off", "team-e2e-brk-off", "helper", midRider.abilities);
  const grp = cloneRider("e2e-brk-grp", "team-e2e-brk-grp", "helper", midRider.abilities);
  for (const stage of [3, 6, 15]) {
    const rows: OrderRow[] = [
      ...data.orders,
      { team_id: on.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [rowRider(on.rider_id, { try_break: true })] },
      { team_id: off.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [rowRider(off.rider_id)] },
      { team_id: grp.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [rowRider(grp.rider_id, { effort: "grupetto", try_break: true })] },
    ];
    for (const seed of SEEDS) {
      const att = attempters(runStage({ stage, entrants: [...field, on, off, grp], orderRows: rows, seed }));
      assert.ok(att.has(on.rider_id), `etape ${stage} seed ${seed}: ordren skal give et forsoeg`);
      assert.ok(!att.has(off.rider_id), `etape ${stage} seed ${seed}: uden ordre ingen forsoeg (hjaelper paa normal)`);
      assert.ok(!att.has(grp.rider_id), `etape ${stage} seed ${seed}: grupetto forsoeger aldrig`);
    }
  }
});

// ── 3. Sprinttog ────────────────────────────────────────────────────────────

test("#7266 e2e: sprinttoget (leadout i race_team_orders) giver spurtkaptajnen en bedre placering paa flade dage", () => {
  const bySprint = field.slice().sort((a, b) => sprintStrength(b.abilities) - sprintStrength(a.abilities) || a.rider_id.localeCompare(b.rider_id));
  const sprinter = bySprint[4];
  const team = "team-e2e-trn";
  const members = [cloneRider("e2e-trn-0", team, "sprint_captain", sprinter.abilities), ...Array.from({ length: 6 }, (_, i) => cloneRider(`e2e-trn-${i + 1}`, team, "helper", midRider.abilities))];
  const gains: number[] = [];
  for (const stage of [2, 4, 9, 17]) {
    for (const seed of SEEDS) {
      const row = (train: boolean): OrderRow => ({ team_id: team, stage_number: stage, breakaway_stance: "neutral", riders: members.map((m) => rowRider(m.rider_id, { leadout: train && m.race_role === "helper" })) });
      const last = field.length + members.length + 1;
      const withTrain = rankOf(runStage({ stage, entrants: [...field, ...members], orderRows: [...data.orders, row(true)], seed }), "e2e-trn-0", last);
      const without = rankOf(runStage({ stage, entrants: [...field, ...members], orderRows: [...data.orders, row(false)], seed }), "e2e-trn-0", last);
      gains.push(without - withTrain);
    }
  }
  assert.ok(sum(gains) > 0, `toget skal samlet give placeringer (detaljer: koer scripts/dev/tacticsEffects7266.mjs, tal kun i balance-internals)`);
});

// ── 4. Jagt-stance ──────────────────────────────────────────────────────────

/** Feltets hold med den staerkeste klassementsrytter, som menneskehold. */
function strongestTeam() {
  const byTeam = new Map<string, any[]>();
  for (const e of field) {
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id)!.push(e);
  }
  let best: { teamId: string; members: any[]; top: number } | null = null;
  for (const [teamId, members] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (members.length < 7) continue;
    const top = Math.max(...members.map((m) => gcStrength(m.abilities)));
    if (!best || top > best.top) best = { teamId, members, top };
  }
  assert.ok(best, "feltet skal have et hold med mindst 7 ryttere");
  const sorted = best!.members.slice().sort((a, b) => gcStrength(b.abilities) - gcStrength(a.abilities) || a.rider_id.localeCompare(b.rider_id));
  const team = sorted.map((m, i) => ({ ...m, team_is_ai: false, race_role: i === 0 ? "captain" : "helper" }));
  return { teamId: best!.teamId, team, rest: field.filter((e) => e.team_id !== best!.teamId) };
}

test("#7266 e2e: jagt-stance i race_team_orders giver udbruddet et mindre forspring end lad gaa paa kuperede dage", () => {
  const { teamId, team, rest } = strongestTeam();
  const others = data.orders.filter((o: any) => o.team_id !== teamId);
  const diffs: number[] = [];
  for (const stage of [3, 14, 15]) {
    for (const seed of SEEDS) {
      const lead = (stance: string) => {
        const res = runStage({ stage, entrants: [...rest, ...team], orderRows: [...others, { team_id: teamId, stage_number: stage, breakaway_stance: stance, riders: [] }], seed });
        const fin = new Map((res.v4Output?.results ?? []).filter((r: any) => r.status === "finished").map((r: any) => [r.rider_id, Number(r.time_seconds)]));
        return breakLead({ fin, out: res.v4Output }).lead;
      };
      const chase = lead("chase");
      const letGo = lead("let_go");
      if (chase != null && letGo != null) diffs.push(chase - letGo);
    }
  }
  assert.ok(diffs.length > 0, "der skal vaere udbrud at maale paa");
  assert.ok(sum(diffs) < 0, `jag skal samlet give et mindre forspring end lad gaa (detaljer: koer scripts/dev/tacticsEffects7266.mjs, tal kun i balance-internals)`);
});

// ── 5. Delt kaptajn (race_stage_roles) ──────────────────────────────────────

test("#7266 e2e: delt kaptajn fra race_stage_roles paa et hold med 8 ryttere placerer sig bedre end som hjaelper", () => {
  const { teamId, team, rest } = strongestTeam();
  const eight = team.slice(0, 8);
  assert.equal(eight.length, 8);
  const coId = eight[1].rider_id;
  const others = data.orders.filter((o: any) => o.team_id !== teamId);
  const gains: number[] = [];
  for (const stage of [11, 12, 13, 16]) {
    for (const seed of SEEDS) {
      const last = rest.length + eight.length + 1;
      const run = (role: string) => rankOf(runStage({ stage, entrants: [...rest, ...eight], orderRows: others, roleRows: [{ stage_number: stage, rider_id: coId, race_role: role }], seed }), coId, last);
      gains.push(run("helper") - run("co_captain"));
    }
  }
  assert.ok(sum(gains) > 0, `delt kaptajn skal samlet placere sig bedre end som hjaelper (detaljer: koer scripts/dev/tacticsEffects7266.mjs, tal kun i balance-internals)`);
});

// ── 6. Etapeplanen (stage_plan_v1-motoren) ──────────────────────────────────

/** Alle kuperede og bjergetaper i Giro-feltet (der hvor planens skift skal kunne maerkes). */
const HILLY_AND_MOUNTAIN = stages.filter((p) => ["hilly", "medium_mountain", "mountain", "high_mountain"].includes(p.profile_type)).map((p) => p.stage_number);
const planRider = (id: string, legs: StagePlanLeg[]) => ({ rider_id: id, ...legacyOrderFromPlan(legs), plan: legs });
const legEvents = (res: any, id: string) => (res.v4Output?.timeline?.events ?? []).filter((e: any) => e.type === "stage_plan_leg" && e.params?.rider_id === id);

test("#7266 e2e: etapeplanen skifter ved de sidste km, koster det haardeste led, og angrebet ender oftere foran end spar hele dagen", () => {
  const on = cloneRider("e2e-pln-on", "team-e2e-pln-on", "free_role", strongRider.abilities);
  const off = cloneRider("e2e-pln-off", "team-e2e-pln-off", "free_role", strongRider.abilities);
  const onLegs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }];
  const offLegs: StagePlanLeg[] = [{ task: "stay_sheltered" }];
  const signs: number[] = [];
  for (const stage of HILLY_AND_MOUNTAIN) {
    const rows: OrderRow[] = [
      ...data.orders,
      { team_id: on.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [planRider(on.rider_id, onLegs)] },
      { team_id: off.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [planRider(off.rider_id, offLegs)] },
    ];
    for (const seed of SEEDS) {
      const res = runStage({ stage, entrants: [...field, on, off], orderRows: rows, seed });
      const ev = legEvents(res, on.rider_id);
      assert.ok(ev.some((e: any) => e.params.reason === "final_km" && e.params.task === "attack"), `etape ${stage} seed ${seed}: skiftet ved de sidste km skal ske`);
      assert.equal(legEvents(res, off.rider_id).length, 0, "en kaede med ét led skifter aldrig");
      assert.equal(res.efforts.get(on.rider_id), "all_out", "belastningen er det haardeste led han koerte");
      assert.equal(res.efforts.get(off.rider_id), "save");
      const a = finTime(res, on.rider_id);
      const b = finTime(res, off.rider_id);
      if (a != null && b != null) signs.push(Math.sign(a - b));
    }
  }
  assert.ok(sum(signs) < 0, `angrebet fra de sidste km skal oftere ende foran end bag (detaljer: koer scripts/dev/tacticsEffects7266.mjs, tal kun i balance-internals)`);
});

test("#7266 e2e: etapeplanen skifter til grupetto naar hjaelperen er sat, og han ruller ind bag tvillingen", () => {
  const on = cloneRider("e2e-drp-on", "team-e2e-drp-on", "helper", midRider.abilities);
  const off = cloneRider("e2e-drp-off", "team-e2e-drp-off", "helper", midRider.abilities);
  const onLegs: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "grupetto", from: { at: "dropped" } }];
  const offLegs: StagePlanLeg[] = [{ task: "shelter_leader" }];
  let fired = 0;
  const signs: number[] = [];
  for (const stage of HILLY_AND_MOUNTAIN) {
    const rows: OrderRow[] = [
      ...data.orders,
      { team_id: on.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [planRider(on.rider_id, onLegs)] },
      { team_id: off.team_id, stage_number: stage, breakaway_stance: "neutral", riders: [planRider(off.rider_id, offLegs)] },
    ];
    for (const seed of SEEDS) {
      const res = runStage({ stage, entrants: [...field, on, off], orderRows: rows, seed });
      if (legEvents(res, on.rider_id).some((e: any) => e.params.reason === "dropped" && e.params.task === "grupetto")) fired += 1;
      const a = finTime(res, on.rider_id);
      const b = finTime(res, off.rider_id);
      if (a != null && b != null) signs.push(Math.sign(a - b));
    }
  }
  assert.ok(fired > 0, "skiftet ved \"sat\" skal ske paa hoejfjeldet");
  assert.ok(sum(signs) > 0, `grupetto efter "sat" skal oftere ende bag end foran (detaljer: koer scripts/dev/tacticsEffects7266.mjs, tal kun i balance-internals)`);
});
