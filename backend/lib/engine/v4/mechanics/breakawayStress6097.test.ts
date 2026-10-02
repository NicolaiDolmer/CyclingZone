// #6097 (ejer 2/10): "alle hold maa gerne forsoege, men alle skal ikke lykkes".
// STRESSTEST af det omstridte morgenudbrud under orders_gc_v2: hvert hold (AI og
// menneske er for motoren det samme, en team_tactics-ordre) har én rytter med
// "Forsoeg udbrud" paa hver etape. Udbruddet skal stadig have en realistisk
// stoerrelse (kamp om pladserne + det faste loft), og ikke alle forsoeg lykkes.
// Testen laaser adfaerden paa et realistisk stort felt (20 hold x 7 ryttere)
// over flere seeds og tre terraentyper. Tallene i loftet er motorens egne
// (mechanics/breakaway.ts), ikke kalibrerings-tal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "../index.ts";
import { TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
import type { AbilityKey, Entrant, RiderRole, StageInput, TeamOrder } from "../types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
function fixtureInput(name: string): StageInput {
  return JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;
}

const TEAMS = 20;
const PER_TEAM = 7;
const REALISTIC_MIN = 4;
const REALISTIC_MAX = 8;

/** Deterministisk felt: fixture-rytternes evner fordelt paa 20 hold med lille variation. */
function stressInput(fixture: string, seed: string): StageInput {
  const base = fixtureInput(fixture);
  const templates = base.startlist;
  const startlist: Entrant[] = [];
  const orders: TeamOrder[] = [];
  for (let t = 0; t < TEAMS; t++) {
    const teamId = `team-${String(t).padStart(2, "0")}`;
    let attacker: string | null = null;
    for (let i = 0; i < PER_TEAM; i++) {
      const tpl = templates[(t * PER_TEAM + i) % templates.length];
      const riderId = `${teamId}-r${i}`;
      const role: RiderRole = i === 0 ? "captain" : i === 1 ? "sprint_captain" : "helper";
      const abilities = {} as Record<AbilityKey, number>;
      for (const [k, v] of Object.entries(tpl.abilities)) {
        abilities[k as AbilityKey] = Math.max(1, Math.min(99, Number(v) + (((t * 7 + i * 13) % 11) - 5)));
      }
      startlist.push({ rider_id: riderId, abilities, role, effort: "normal", condition: 1, team_id: teamId });
      if (role === "helper" && attacker === null) attacker = riderId;
    }
    orders.push({
      team_id: teamId,
      kind: TEAM_TACTICS_ORDER_KIND,
      params: {
        // Halvdelen af holdene vil jage, resten er neutrale: alle forsoeger alligevel.
        breakaway_stance: t % 2 === 0 ? "chase" : "neutral",
        riders: [{ rider_id: attacker, effort: "normal", try_break: true, leadout: false }],
      },
    });
  }
  return { ...base, startlist, orders, seed, rules_revision: "orders_gc_v2" };
}

for (const fixture of ["flat-massespurt", "punch-finale-forspring", "bjerg-selektion"]) {
  test(`#6097 stresstest (${fixture}): alle ${TEAMS} hold forsoeger, kun en realistisk stoerrelse kommer afsted`, () => {
    for (let s = 0; s < 8; s++) {
      const out = simulateStageV4(stressInput(fixture, `stress-6097-${fixture}-${s}`));
      const attempt = out.timeline.events.find((e) => e.type === "breakaway_attempt");
      assert.ok(attempt, "der er et morgenforsoeg");
      const attempted = attempt.params.rider_ids as string[];
      const escaped = attempt.params.escaped_rider_ids as string[];
      // Alle hold forsoegte (én rytter hver).
      assert.equal(attempted.length, TEAMS);
      assert.equal(new Set(attempted.map((id) => id.slice(0, 7))).size, TEAMS);
      // Alle skal ikke lykkes, og udbruddet har en realistisk stoerrelse.
      assert.ok(escaped.length < attempted.length, `ikke alle lykkes (seed ${s})`);
      assert.ok(escaped.length >= REALISTIC_MIN && escaped.length <= REALISTIC_MAX, `stoerrelse ${escaped.length} (seed ${s})`);
      const formed = out.timeline.events.find((e) => e.type === "breakaway_formed");
      assert.deepEqual(formed ? [...(formed.params.rider_ids as string[])].sort() : [], [...escaped].sort());
      // Ingen kaptajn kom med (ingen af dem havde en ordre).
      for (const id of escaped) assert.ok(!id.endsWith("-r0") && !id.endsWith("-r1"), `${id} er ikke en kaptajn`);
      assert.equal(out.results.length, TEAMS * PER_TEAM);
    }
  });
}
