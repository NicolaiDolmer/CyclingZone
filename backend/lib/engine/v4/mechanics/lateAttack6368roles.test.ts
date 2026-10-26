// backend/lib/engine/v4/mechanics/lateAttack6368roles.test.ts
// #6368 lag 3 (ejer 26/10, KUN s5_profiles_v3): det sene soloangreb kommer kun fra
// ledere (kaptajn, delt kaptajn, spurtkaptajn) og fri rolle. En hjaelper (ogsaa paa
// Arbejd) angriber kun naar holdets kaptajn er sat; jaegeren angriber aldrig sent.
// Aeldre revisioner (uden s5ProfilesV3) er uaendrede.
import { test } from "node:test";
import assert from "node:assert/strict";

import { lateAttack, lateAttackRoleAllowed, LATE_ATTACK_LEADER_ROLES } from "./lateAttack.ts";
import type { AbilityKey, EffortLevel, EngineState, Entrant, RiderRole, RouteV2, Segment } from "../types.ts";

const KEYS: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
const ATTACK_KEYS: AbilityKey[] = ["aggression", "tempo", "endurance", "tactics"];

const climb = (from_km: number, to_km: number): Segment => ({ kind: "climb", from_km, to_km, category: "3", avg_gradient: 12, top_elevation_m: 400 });

// Kuperet etape med et vindues-segment (index 1 slutter 10 km fra maal).
const ROUTE: RouteV2 = {
  distance_km: 160, profile_type: "hilly", finale_type: "wall_finish",
  segments: [{ kind: "flat", from_km: 0, to_km: 100 }, { kind: "rolling", from_km: 100, to_km: 150 }, { kind: "flat", from_km: 150, to_km: 158.8 }, climb(158.8, 160)],
  weather: { kind: "sun", wind_exposure: 0.2 }, waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
};
const ALWAYS = () => () => 0; // lodtraekningen siger altid ja

type RiderSpec = { id: string; role: RiderRole; team: string | null; boost?: number; effort?: EffortLevel; group?: "fav" | "behind" };

function field(specs: RiderSpec[]): { state: EngineState; entrants: Record<string, Entrant> } {
  const entrants: Record<string, Entrant> = {};
  const riders: EngineState["riders"] = {};
  for (const s of specs) {
    const abilities = Object.fromEntries(KEYS.map((k) => [k, 60])) as Record<AbilityKey, number>;
    for (const k of ATTACK_KEYS) abilities[k] = 60 + (s.boost ?? 0);
    entrants[s.id] = { rider_id: s.id, abilities, role: s.role, effort: s.effort ?? "normal", condition: 1, team_id: s.team };
    riders[s.id] = { status: "racing", wprime: 1, wprimeMax: 1 } as EngineState["riders"][string];
  }
  const fav = specs.filter((s) => (s.group ?? "fav") === "fav").map((s) => s.id);
  const behind = specs.filter((s) => s.group === "behind").map((s) => s.id);
  const groups = [{ id: "peloton-0", kind: "peloton", rider_ids: fav, gap_seconds: 0, cohesion: 1 }];
  if (behind.length) groups.push({ id: "peloton-1", kind: "peloton", rider_ids: behind, gap_seconds: 90, cohesion: 1 });
  return { state: { groups, riders } as unknown as EngineState, entrants };
}

// Fem neutrale fri-rolle-ryttere fra andre hold, saa favoritgruppen er stor nok.
const FILLER: RiderSpec[] = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, role: "free_role" as RiderRole, team: `tf${i}` }));

function attack(specs: RiderSpec[], v3: boolean) {
  const { state, entrants } = field(specs);
  return lateAttack(state, { route: ROUTE, segment: ROUTE.segments[1], segmentIndex: 1, entrants, rngForStage: ALWAYS, ...(v3 ? { s5ProfilesV3: true as const } : {}) });
}
const attackerOf = (res: ReturnType<typeof attack>) => (res.events.length ? String(res.events[0].params.rider_id) : null);

// Neutral fri rolle som nr. 1 i lederfeltet: han er staerkere end fyld-rytterne, svagere end hjaelperen.
const SOLID_LEADER: RiderSpec = { id: "lead", role: "free_role", team: "tl", boost: 15 };

test("#6368 lag 3: hjaelper paa Arbejd angriber IKKE fra favoritgruppen naar kaptajnen er med", () => {
  const specs: RiderSpec[] = [...FILLER, { id: "cap", role: "captain", team: "ta" }, { id: "help", role: "helper", team: "ta", boost: 30, effort: "protect" }];
  assert.equal(attackerOf(attack(specs, false)), "help", "aeldre revisioner: den staerkeste angriber, uanset rolle");
  const res = attack(specs, true);
  assert.notEqual(attackerOf(res), "help");
  // Den staerke hjaelper er stadig nr. 2: ingen svagere rytter kommer fri fra ham.
  assert.equal(res.events.length, 0);
  assert.equal(res.state.groups.length, 1);
});

test("#6368 lag 3: hjaelper paa Arbejd angriber naar kaptajnen er sat (ikke i gruppen)", () => {
  const specs: RiderSpec[] = [...FILLER, { id: "cap", role: "captain", team: "ta", group: "behind" }, { id: "help", role: "helper", team: "ta", boost: 30, effort: "protect" }];
  assert.equal(attackerOf(attack(specs, true)), "help");
  // Kaptajn ude af loebet taeller som sat.
  const { state, entrants } = field([...FILLER, { id: "cap", role: "captain", team: "ta" }, { id: "help", role: "helper", team: "ta", boost: 30 }]);
  const abandoned ={ ...state, riders: { ...state.riders, cap: { ...state.riders.cap, status: "abandoned" as const } } } as EngineState;
  assert.equal(lateAttackRoleAllowed("help", state.groups[0].rider_ids, abandoned, entrants), true);
  assert.equal(lateAttackRoleAllowed("help", state.groups[0].rider_ids, state, entrants), false);
});

test("#6368 lag 3: ledere og fri rolle kan stadig angribe sent", () => {
  for (const role of ["captain", "co_captain", "sprint_captain", "free_role"] as RiderRole[]) {
    assert.ok(LATE_ATTACK_LEADER_ROLES.has(role));
    const specs: RiderSpec[] = [...FILLER, { id: "boss", role, team: "ta", boost: 30 }, { id: "help", role: "helper", team: "ta" }];
    const res = attack(specs, true);
    assert.equal(attackerOf(res), "boss", role);
    assert.equal(res.state.groups.length, 2, `${role}: angriberen er sin egen gruppe`);
  }
});

test("#6368 lag 3: jaegeren angriber ikke sent; den bedste tilladte rytter gaar i stedet, maalt mod nr. 2 i gruppen", () => {
  // Jaegeren er staerkest; den frie rytter er nr. 2 og maales mod jaegeren -> intet forspring.
  const blocked = attack([...FILLER, { id: "hunt", role: "hunter", team: "th", boost: 30 }, SOLID_LEADER], true);
  assert.equal(blocked.events.length, 0, "en staerkere jaeger i gruppen svarer paa angrebet");
  // Svag jaeger: den frie rytter angriber, og forspringet maales mod jaegeren (nr. 2), ikke mod fyldet.
  const weakHunter = attack([...FILLER, { id: "hunt", role: "hunter", team: "th", boost: 10 }, SOLID_LEADER], true);
  const noHunter = attack([...FILLER, SOLID_LEADER], true);
  assert.equal(attackerOf(weakHunter), "lead");
  assert.equal(attackerOf(noHunter), "lead");
  assert.ok(Number(weakHunter.events[0].params.gained_seconds) <= Number(noHunter.events[0].params.gained_seconds), "nr. 2 er den staerkeste anden rytter");
});

test("#6368 lag 3: hjaelper uden hold-id eller uden kaptajn paa holdet bliver hos gruppen", () => {
  const noTeam = field([...FILLER, { id: "help", role: "helper", team: null, boost: 30 }]);
  assert.equal(lateAttackRoleAllowed("help", noTeam.state.groups[0].rider_ids, noTeam.state, noTeam.entrants), false);
  const noCaptain = field([...FILLER, { id: "help", role: "helper", team: "ta", boost: 30 }, { id: "sc", role: "sprint_captain", team: "ta" }]);
  assert.equal(lateAttackRoleAllowed("help", noCaptain.state.groups[0].rider_ids, noCaptain.state, noCaptain.entrants), false);
  // Delt kaptajn binder ogsaa hjaelperen.
  const co = field([...FILLER, { id: "help", role: "helper", team: "ta", boost: 30 }, { id: "co", role: "co_captain", team: "ta" }]);
  assert.equal(lateAttackRoleAllowed("help", co.state.groups[0].rider_ids, co.state, co.entrants), false);
});

test("#6368 lag 3: en anden holds kaptajn binder ikke hjaelperen", () => {
  const specs: RiderSpec[] = [...FILLER, { id: "capA", role: "captain", team: "ta", group: "behind" }, { id: "capB", role: "captain", team: "tb" }, { id: "help", role: "helper", team: "ta", boost: 30 }];
  assert.equal(attackerOf(attack(specs, true)), "help");
});

test("#6368 lag 3: uden s5ProfilesV3 er angrebet uaendret (samme angriber og forspring)", () => {
  const specs: RiderSpec[] = [...FILLER, { id: "cap", role: "captain", team: "ta" }, { id: "help", role: "helper", team: "ta", boost: 30, effort: "protect" }, { id: "hunt", role: "hunter", team: "th", boost: 20 }];
  const res = attack(specs, false);
  assert.equal(attackerOf(res), "help");
  assert.ok(Number(res.events[0].params.gained_seconds) > 0);
});
