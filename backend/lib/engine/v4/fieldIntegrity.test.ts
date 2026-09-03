// backend/lib/engine/v4/fieldIntegrity.test.ts
// Forward-guards for #4615's to felt-invarianter: FELT-SAMMENHAENG og LAAST
// FELTSTOERRELSE.
//
// Samme formuleringsprincip som segmentLoop.load.test.ts (#4604-guarden):
// invarianterne er SKALA-uafhaengige udsagn, ikke forventede tal. Begge fejl
// de daekker blev foerst synlige mod den aegte S3-population (median-evne
// 11/99), ikke mod syntetiske fixtures med midt-skala-evner — derfor koeres
// hver invariant over hele evne-spektret 5/11/30/60/99, praecis som
// load-testen.
//
// Hvorfor de to hoerer sammen: felt-sammenhaengen maales som ANDELEN af feltet
// paa vinderens tid. Den andel er kun meningsfuld hvis naevneren er stabil —
// forsvinder eller duplikeres en rytter undervejs gennem splits, merges og
// finale-tiers, maaler ankeret noget andet end det tror. Feltstoerrelses-
// invarianten er derfor naevnerens vagt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { isMassFinishRoute } from "./finale.ts";
import { TEAM_TACTICS_ORDER_KIND } from "./mechanics/breakaway.ts";
import type { AbilityKey, Entrant, RouteV2, Segment, StageInput, TeamOrder } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** Evne-niveauerne fra #4604-load-guarden: bund, prod-median, midt, hoej, top. */
const ABILITY_LEVELS = [5, 11, 30, 60, 99];

function clamp99(n: number): number {
  return Math.max(0, Math.min(99, n));
}

/**
 * Felt paa et givet evne-NIVEAU med en indbyrdes SPREDNING omkring det. Ren
 * ensartethed (load-testens felt) ville goere sammenhaengs-invarianten triviel:
 * identiske ryttere faar identisk score og dermed identisk tid uanset hvordan
 * finalen er bygget. Spredningen er derfor det der goer testen skarp — den
 * skaleres med niveauet, saa den relative spredning er den samme i bund og top.
 */
function spreadField(count: number, level: number, prefix = "r"): Entrant[] {
  const spread = Math.max(1, Math.round(level * 0.3));
  return Array.from({ length: count }, (_, i) => {
    const offset = (i % (2 * spread + 1)) - spread;
    const abilities = {} as Record<AbilityKey, number>;
    for (const key of ABILITY_KEYS) abilities[key] = clamp99(level + offset);
    // Sprint-evnen faar sin egen, finere variation saa massespurt-finalens
    // demandvektor ser et reelt hierarki og ikke et hav af ens scorer.
    abilities.sprint = clamp99(level + spread - (i % (spread + 1)));
    return {
      rider_id: `${prefix}${String(i).padStart(3, "0")}`,
      abilities,
      role: "free_role" as const,
      effort: "normal" as const,
      condition: 1,
    };
  });
}

function flatSegment(fromKm: number, toKm: number): Segment {
  return { kind: "flat", from_km: fromKm, to_km: toKm };
}

function climbSegment(fromKm: number, toKm: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category: "1", avg_gradient: 7, top_elevation_m: 1800 };
}

function flatRoute(distanceKm = 180): RouteV2 {
  const third = distanceKm / 3;
  return {
    distance_km: distanceKm,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [flatSegment(0, third), flatSegment(third, 2 * third), flatSegment(2 * third, distanceKm)],
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm }],
  };
}

function mountainRoute(distanceKm = 160): RouteV2 {
  return {
    distance_km: distanceKm,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [flatSegment(0, 100), climbSegment(100, distanceKm)],
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm, summit_finish: true }],
  };
}

function stage(entrants: Entrant[], route: RouteV2, seed: string, orders: TeamOrder[] = []): StageInput {
  return { route, startlist: entrants, orders, seed, tuning: RACE_V4_TUNING };
}

/** Andel af feltet der deler vindertiden — samme beregning som harnessens cohesionFraction. */
function cohesionFraction(times: number[]): number {
  const min = Math.min(...times);
  return times.filter((t) => t === min).length / times.length;
}

/** Realistiske hold-ordrer: 6 hold, blandede stances, hver med en try_break-rytter. */
function ordersForField(entrants: Entrant[], teamCount = 6): TeamOrder[] {
  const stances = ["chase", "neutral", "let_go"];
  return Array.from({ length: teamCount }, (_, teamIndex) => {
    const members = entrants.filter((_, i) => i % teamCount === teamIndex);
    return {
      team_id: `t${teamIndex}`,
      kind: TEAM_TACTICS_ORDER_KIND,
      params: {
        breakaway_stance: stances[teamIndex % stances.length],
        riders: members.map((entrant, i) => ({
          rider_id: entrant.rider_id,
          effort: "normal",
          try_break: i === 0,
        })),
      },
    };
  });
}

// ── Invariant 1: laast feltstoerrelse ────────────────────────────────────────
// Lige saa mange i maal som paa startlisten, hver rytter praecis én gang, og
// placeringerne er en komplet permutation 1..N. Grupper dannes, splittes,
// smelter sammen og bliver til placerings-tiers hele vejen igennem — hvert af
// de skridt kan tabe eller duplikere en rytter, og fejlen ville vise sig som
// et forskudt anker-tal laenge foer nogen saa aarsagen.

test("#4615 laast feltstoerrelse: alle der starter, kommer i maal — paa alle evne-niveauer og terraener", () => {
  for (const level of ABILITY_LEVELS) {
    for (const route of [flatRoute(), mountainRoute()]) {
      const entrants = spreadField(60, level);
      const output = simulateStageV4(stage(entrants, route, `4615-size-${level}-${route.profile_type}`));

      assert.equal(
        output.results.length,
        entrants.length,
        `evne-niveau ${level} (${route.profile_type}): ${output.results.length} i maal mod ${entrants.length} paa startlisten`,
      );
      const seen = new Set(output.results.map((r) => r.rider_id));
      assert.equal(seen.size, entrants.length, `evne-niveau ${level} (${route.profile_type}): dublet-rytter i resultatet`);
      for (const entrant of entrants) {
        assert.ok(seen.has(entrant.rider_id), `evne-niveau ${level}: ${entrant.rider_id} mangler i resultatet`);
      }
      const ranks = output.results.map((r) => r.rank).sort((a, b) => a - b);
      assert.deepEqual(
        ranks,
        Array.from({ length: entrants.length }, (_, i) => i + 1),
        `evne-niveau ${level} (${route.profile_type}): placeringerne er ikke en komplet permutation 1..N`,
      );
    }
  }
});

test("#4615 laast feltstoerrelse: holdordrer aendrer ikke hvor mange der kommer i maal", () => {
  for (const level of ABILITY_LEVELS) {
    const entrants = spreadField(60, level);
    const withOrders = simulateStageV4(stage(entrants, flatRoute(), `4615-size-orders-${level}`, ordersForField(entrants)));
    const withoutOrders = simulateStageV4(stage(entrants, flatRoute(), `4615-size-orders-${level}`));

    assert.equal(withOrders.results.length, entrants.length, `evne-niveau ${level}: feltet skrumpede med ordrer`);
    assert.equal(withoutOrders.results.length, entrants.length, `evne-niveau ${level}: feltet skrumpede uden ordrer`);
    // Gruppe-tids-invarianten (mor-spec §3.2) skal ogsaa holde MED ordrer:
    // en holdordre maa aldrig give to ryttere i samme maal-gruppe hver sin tid.
    const timeByGroup = new Map<string, number>();
    for (const result of withOrders.results) {
      const known = timeByGroup.get(result.group_id);
      if (known === undefined) timeByGroup.set(result.group_id, result.time_seconds);
      else assert.equal(result.time_seconds, known, `evne-niveau ${level}: delt gruppe ${result.group_id} har to tider`);
    }
  }
});

// ── Invariant 2: felt-sammenhaeng ────────────────────────────────────────────
// Et massespurt-opgoer afgoeres paa PLACERING, ikke paa tid: den ankomne pulje
// deler vindertiden. FOER #4615 fik hver af de 20 bedst placerede sin egen
// tids-tier, saa naesten ingen delte vindertiden — 0,6 % maalt mod et baand paa
// 80-95 %. Det var en mekanisk konsekvens af at raekkefolgen kun kunne udtrykkes
// gennem tiden, ikke en modelleret hale af afhaegtede ryttere.
//
// Invarianten er formuleret som en EGENSKAB, ikke et tal: paa en etape hvor
// feltet ankommer samlet deler mere end halvdelen vindertiden. Havde den staaet
// som "= 0,87", ville den hverken have fanget den oprindelige fejl eller
// overlevet den foerste kalibrering.

test("#4615 felt-sammenhaeng: et samlet felt deler vindertiden i en massefinale — paa alle evne-niveauer", () => {
  for (const level of ABILITY_LEVELS) {
    const entrants = spreadField(120, level);
    const output = simulateStageV4(stage(entrants, flatRoute(), `4615-cohesion-${level}`));
    const cohesion = cohesionFraction(output.results.map((r) => r.time_seconds));
    assert.ok(
      cohesion > 0.5,
      `evne-niveau ${level}: kun ${(cohesion * 100).toFixed(1)} % af feltet paa vinderens tid i en massefinale`,
    );
  }
});

test("#4615 felt-sammenhaeng: lige tid giver stadig entydige, evne-ordnede placeringer", () => {
  for (const level of ABILITY_LEVELS) {
    const entrants = spreadField(60, level);
    const output = simulateStageV4(stage(entrants, flatRoute(), `4615-order-${level}`));
    const winnerTime = Math.min(...output.results.map((r) => r.time_seconds));
    const sharing = output.results.filter((r) => r.time_seconds === winnerTime);
    assert.ok(sharing.length > 1, `evne-niveau ${level}: massefinalen gav ingen delt vindertid at teste raekkefolgen paa`);

    // Placeringerne inden for den delte tid skal vaere sammenhaengende 1..k —
    // altsaa afgjort af finalens raekkefolge, ikke af et alfabetisk opgoer.
    const ranksInBunch = sharing.map((r) => r.rank).sort((a, b) => a - b);
    assert.deepEqual(
      ranksInBunch,
      Array.from({ length: sharing.length }, (_, i) => i + 1),
      `evne-niveau ${level}: den delte vindertid gav ikke placeringerne 1..${sharing.length}`,
    );
    // Vinderen maa ikke bare vaere den foerste i alfabetet: med et reelt
    // sprint-hierarki i feltet skal en af de staerkeste sprintere vinde.
    const winner = output.results.find((r) => r.rank === 1)!;
    const bySprint = [...entrants].sort((a, b) => b.abilities.sprint - a.abilities.sprint);
    const topSprintCut = bySprint[Math.floor(entrants.length * 0.2)].abilities.sprint;
    const winnerSprint = entrants.find((e) => e.rider_id === winner.rider_id)!.abilities.sprint;
    assert.ok(
      winnerSprint >= topSprintCut,
      `evne-niveau ${level}: vinderen (${winner.rider_id}, sprint ${winnerSprint}) er ikke i feltets bedste sprint-femtedel`,
    );
  }
});

// En SELEKTIV finale maa ikke faa massespurtens delte tid: bjergetapens
// tidsforskelle er aegte, og det er dem bjerg-ankeret maaler.
test("#4615 felt-sammenhaeng: en selektiv finale beholder reelle tidsforskelle", () => {
  assert.equal(isMassFinishRoute(flatRoute()), true, "en flad bunch_sprint-etape er en massefinale");
  assert.equal(isMassFinishRoute(mountainRoute()), false, "en bjergetape med topankomst er IKKE en massefinale");

  for (const level of ABILITY_LEVELS) {
    const entrants = spreadField(60, level);
    const output = simulateStageV4(stage(entrants, mountainRoute(), `4615-selective-${level}`));
    const times = output.results.map((r) => r.time_seconds);
    const distinct = new Set(times);
    assert.ok(
      distinct.size > 1,
      `evne-niveau ${level}: bjergetapen gav hele feltet samme tid — selektionen er forsvundet`,
    );
  }
});

// ── Determinisme med ordrer ──────────────────────────────────────────────────
// Ordrerne maa ikke braekke §2 invariant 1: samme input, byte-identisk output.

test("#4615 determinisme: samme ordrer giver byte-identisk output", () => {
  const entrants = spreadField(48, 30);
  const orders = ordersForField(entrants);
  const a = simulateStageV4(stage(entrants, flatRoute(), "4615-determinism", orders));
  const b = simulateStageV4(stage(entrants, flatRoute(), "4615-determinism", orders));
  assert.deepEqual(a, b, "to identiske koersler med ordrer gav forskelligt output");
});
