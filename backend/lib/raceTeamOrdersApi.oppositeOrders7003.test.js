// #7003 (spec 2026-10-25-taktik-roller-design §3, fund 2 fra #7266): modsatte
// ordrer i den klassiske raekke (PUT team-orders uden plan) afvises med en klar
// fejlkode pr. tilfaelde, fladen spaerrer det modsatte valg (frontend-kopien
// skal give samme svar), og AI-holdene kan ikke lave modsaetningerne.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateTeamOrder,
  oppositeOrderError,
  loadStageRoleByRider,
  OPPOSITE_ORDER_ERRORS,
} from "./raceTeamOrdersApi.js";
import * as surface from "../../frontend/src/lib/oppositeOrders.js";
import { generateAiTeamOrder } from "./engine/v4/ai/aiTactics.ts";
import { CURRENT_RACE_RULES_REVISION, isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";

const NOW = new Date("2026-10-26T10:00:00Z");
const ROLES = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role", null];
const EFFORTS = ["grupetto", "save", "normal", "protect", "all_out"];
const args = (riders, roleByRider = new Map()) => ({
  order: { breakaway_stance: "neutral", riders },
  stageNumber: 2,
  stageCount: 5,
  stagesCompleted: 1,
  scheduledAt: "2026-10-26T12:00:00Z",
  teamRiderIds: new Set(riders.map((r) => r.rider_id)),
  now: NOW,
  roleByRider,
});
const rider = (effort, try_break, leadout) => ({ rider_id: "r1", effort, try_break, leadout });

test("#7003: spec §3's fire modsaetninger afvises, hver med sin egen kode", () => {
  const cases = [
    ["helper", rider("grupetto", true, false), "team_orders_grupetto_with_break"],
    ["helper", rider("grupetto", false, true), "team_orders_grupetto_with_train"],
    ["helper", rider("protect", true, false), "team_orders_work_with_break"],
    ["hunter", rider("protect", true, false), "team_orders_work_with_break"],
    ["helper", rider("normal", true, true), "team_orders_train_with_break"],
  ];
  for (const [role, r, code] of cases) {
    // Toget er kun levende paa et hold med spurtkaptajn (#7281).
    const res = validateTeamOrder(args([r], new Map([["r1", role], ["sc", "sprint_captain"]])));
    assert.equal(res.ok, false, JSON.stringify(r));
    assert.equal(res.errors[0], code, JSON.stringify([role, r]));
  }
  assert.deepEqual([...new Set(cases.map((c) => c[2]))].sort(), [...OPPOSITE_ORDER_ERRORS].sort());
});

test("#7003: det spec §3 tillader, tages stadig imod", () => {
  const ok = [
    ["helper", rider("save", true, false)], // spar + udbrud (laast 30/9)
    ["hunter", rider("all_out", true, false)], // alt ud + udbrud
    ["captain", rider("protect", true, false)], // foelg angrebene + udbrud
    ["co_captain", rider("protect", true, false)],
    ["sprint_captain", rider("protect", true, false)],
    ["free_role", rider("protect", true, false)], // koer offensivt + udbrud
    ["helper", rider("protect", false, true)], // arbejd + tog
    ["helper", rider("grupetto", false, false)],
  ];
  for (const [role, r] of ok) {
    const res = validateTeamOrder(args([r], new Map([["r1", role]])));
    assert.deepEqual(res, { ok: true, errors: [] }, JSON.stringify([role, r]));
  }
});

test("#7003: ukendt rolle spaerrer ikke arbejd + udbrud (kun hjaelper og jaeger arbejder)", () => {
  assert.equal(validateTeamOrder(args([rider("protect", true, false)])).ok, true);
});

test("#7003: en rytter med etapeplan tjekkes af planens regler, ikke af body-felterne", () => {
  const withPlan = { ...rider("grupetto", true, true), plan: [{ task: "shelter_leader" }] };
  const stagePlan = { route: { distance_km: 160, profile_type: "flat", climbs: [] }, roleByRider: new Map([["r1", "helper"]]) };
  const res = validateTeamOrder({ ...args([withPlan], new Map([["r1", "helper"]])), stagePlan });
  assert.equal(res.errors.some((e) => OPPOSITE_ORDER_ERRORS.includes(e)), false, JSON.stringify(res));
});

test("#7003: fladens kopi giver samme svar som serveren over hele gitteret", () => {
  for (const role of ROLES) {
    for (const effort of EFFORTS) {
      for (const try_break of [false, true]) {
        for (const leadout of [false, true]) {
          for (const teamHasSprintCaptain of [true, false]) {
            const r = { effort, try_break, leadout };
            const o = { teamHasSprintCaptain };
            assert.equal(surface.oppositeOrderError(r, role, o), oppositeOrderError(r, role, o), JSON.stringify([role, r, o]));
          }
        }
      }
    }
  }
});

test("#7003: fladen kan aldrig naa en tilstand serveren afviser, og spaerrer kun det der ville", () => {
  for (const role of ROLES) {
    for (const effort of EFFORTS) {
      for (const try_break of [false, true]) {
        for (const leadout of [false, true]) {
          for (const teamHasSprintCaptain of [true, false]) {
          const o = { teamHasSprintCaptain };
          const state = { effort, try_break, leadout };
          if (oppositeOrderError(state, role, o)) continue; // gyldige udgangspunkter
          const moves = [
            ["try_break", { ...state, try_break: !try_break }],
            ["leadout", { ...state, leadout: !leadout }],
            ...EFFORTS.map((e) => [e, { ...state, effort: e }]),
          ];
          for (const [choice, next] of moves) {
            const blocked = surface.blockedReasonKey(choice, state, role, o);
            const rejected = oppositeOrderError(next, role, o) !== null;
            assert.equal(blocked !== null, rejected, JSON.stringify({ role, state, choice, blocked, o }));
          }
          }
        }
      }
    }
  }
  // Et valg der allerede staar, kan altid slaas fra (gemte raekker fra foer reglen).
  assert.equal(surface.blockedReasonKey("try_break", { effort: "grupetto", try_break: true, leadout: true }, "helper"), null);
  assert.equal(surface.blockedReasonKey("leadout", { effort: "grupetto", try_break: true, leadout: true }, "helper"), null);
});

test("#7281: et doedt tog-flag spaerrer intet (holdet uden spurtkaptajn, eller rytteren er spurtkaptajnen)", () => {
  const helper = { effort: "normal", try_break: false, leadout: true };
  // Scenarie 1: spurtkaptajnen er gjort til hjaelper, og hjaelperne har stadig leadout fra rollens standard.
  const none = { teamHasSprintCaptain: false };
  assert.equal(surface.blockedReasonKey("try_break", helper, "helper", none), null);
  assert.equal(surface.blockedReasonKey("grupetto", helper, "helper", none), null);
  assert.equal(surface.oppositeOrderError({ ...helper, try_break: true }, "helper", none), null);
  assert.equal(oppositeOrderError({ ...helper, try_break: true }, "helper", none), null);
  assert.equal(oppositeOrderError({ ...helper, effort: "grupetto" }, "helper", none), null);
  // Scenarie 2: en hjaelper med gemt leadout er blevet spurtkaptajn.
  const some = { teamHasSprintCaptain: true };
  assert.equal(surface.blockedReasonKey("try_break", helper, "sprint_captain", some), null);
  assert.equal(oppositeOrderError({ ...helper, try_break: true }, "sprint_captain", some), null);
  // Et levende tog spaerrer stadig.
  assert.equal(surface.blockedReasonKey("try_break", helper, "helper", some), "tacticsOrders.blocked.notWithTrain");
  assert.equal(oppositeOrderError({ ...helper, try_break: true }, "helper", some), "team_orders_train_with_break");
});

test("#7003: hver spaerre-linje og hver fejlkode findes i alle fem sprog", () => {
  const keys = ["notWithGrupetto", "notWithWork", "notWithBreak", "notWithTrain"];
  for (const lang of ["en", "da", "fr", "es", "nl"]) {
    const races = JSON.parse(readFileSync(new URL(`../../frontend/public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    for (const k of keys) assert.equal(typeof races.tacticsOrders?.blocked?.[k], "string", `${lang} tacticsOrders.blocked.${k}`);
    for (const code of OPPOSITE_ORDER_ERRORS) assert.equal(typeof races.intention?.errors?.[code], "string", `${lang} intention.errors.${code}`);
  }
});

test("#7003: rollen paa etapen er etapens override, ellers basis-rollen", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      const q = {
        select() { return q; },
        eq(col, val) { calls.push([table, col, val]); return q; },
        in() { return Promise.resolve({ data: [{ rider_id: "r1", race_role: "captain" }], error: null }); },
      };
      return q;
    },
  };
  const map = await loadStageRoleByRider({ supabase, raceId: "race", stageNumber: 3, baseRoleByRider: new Map([["r1", "helper"], ["r2", "hunter"]]) });
  assert.equal(map.get("r1"), "captain");
  assert.equal(map.get("r2"), "hunter");
  assert.deepEqual(calls, [["race_stage_roles", "race_id", "race"], ["race_stage_roles", "stage_number", 3]]);
});

// AI-paritet (spec §10): et AI-hold med spurtkaptajn, der lader udbruddet gaa,
// sender hjaelpere i udbrud. Under den aktuelle revision koerer de ikke ogsaa i toget.
test("#7003: AI-holdene laver ikke modsaetningerne under s5_profiles_v3", () => {
  assert.equal(isS5ProfilesV3OrLater(CURRENT_RACE_RULES_REVISION), true);
  const abilities = (v) => ({ flat: v, climbing: v, sprint: v, time_trial: v, cobbles: v, hills: v, aggression: v, stamina: v, recovery: v, acceleration: v });
  const roster = [
    { rider_id: "c", role: "captain", abilities: abilities(40) },
    { rider_id: "s", role: "sprint_captain", abilities: abilities(40) },
    ...["h1", "h2", "h3", "h4", "h5"].map((id, i) => ({ rider_id: id, role: "helper", abilities: abilities(90 - i) })),
  ];
  const field = [...roster, ...Array.from({ length: 40 }, (_, i) => ({ rider_id: `f${i}`, role: "helper", abilities: abilities(60) }))];
  let sawBreak = false;
  for (const profile_type of ["flat", "hilly", "mountain"]) {
    const { order } = generateAiTeamOrder({
      team_id: "t",
      route: { profile_type, distance_km: 160, climbs: [] },
      roster,
      field,
      race: { is_stage_race: true, stage_number: 2, total_stages: 5, later_stages: [] },
      rules_revision: CURRENT_RACE_RULES_REVISION,
    });
    const roleOf = new Map(roster.map((r) => [r.rider_id, r.role]));
    for (const r of order.riders) {
      if (r.try_break) sawBreak = true;
      assert.equal(oppositeOrderError(r, roleOf.get(r.rider_id)), null, `${profile_type} ${JSON.stringify(r)}`);
    }
  }
  assert.equal(sawBreak, true, "testen skal ramme en dag hvor AI'en sender en hjaelper i udbrud");
});
