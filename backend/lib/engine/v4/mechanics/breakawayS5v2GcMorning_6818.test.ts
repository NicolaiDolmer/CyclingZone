// backend/lib/engine/v4/mechanics/breakawayS5v2GcMorning_6818.test.ts
// #6818 (ejer 21/10, KUN s5_profiles_v2): ryttere der ligger godt i klassementet eller
// har klassementspotentiale, gaar ikke i morgenudbrud. Strukturelle invarianter, ingen
// kalibrerede tal (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { S5_MORNING_GC_EXCLUSION, s5MorningGcBlockedRiders } from "./breakaway.ts";
import type { AbilityKey, Entrant, GcContext } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function entrant(id: string, team: string, level: number, role = "helper"): Entrant {
  return { rider_id: id, abilities: Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>, role, effort: "normal", condition: 1, team_id: team } as Entrant;
}

/** Tre staerke klassementsryttere + 30 svage hjaelpere; en svag hjaelper (h0) foerer klassementet. */
function field(): Record<string, Entrant> {
  const out: Record<string, Entrant> = { s1: entrant("s1", "A", 90, "captain"), s2: entrant("s2", "B", 88, "captain"), s3: entrant("s3", "C", 86, "captain") };
  for (let i = 0; i < 30; i++) out[`h${i}`] = entrant(`h${i}`, `T${i % 6}`, 40);
  return out;
}
function standings(order: string[], stage = 4): GcContext {
  return { status: "standings", stage_number: stage, leader_id: order[0], standings: order.map((id, i) => ({ rider_id: id, rank: i + 1, gap_seconds: i * 30 })) } as GcContext;
}

test("#6818: stillingens top blokeres, ogsaa en svag hjaelper der foerer klassementet", () => {
  const entrants = field();
  const order = ["h0", "h1", "s1", "h2", "s2", "h3", "h4", "h5", "h6", "h7", ...Object.keys(entrants).filter((id) => !["h0", "h1", "s1", "h2", "s2", "h3", "h4", "h5", "h6", "h7"].includes(id))];
  const blocked = s5MorningGcBlockedRiders({ gcContext: standings(order), entrants }, Object.keys(entrants));
  for (const id of order.slice(0, S5_MORNING_GC_EXCLUSION.excludeGcRankAtMost)) assert.ok(blocked.has(id), `rang <= ${S5_MORNING_GC_EXCLUSION.excludeGcRankAtMost}: ${id}`);
});

test("#6818: klassementspotentiale blokeres uden for stillingens top, men kun inden for raekkevidde", () => {
  const entrants = field();
  const others = Object.keys(entrants).filter((id) => id !== "s3");
  // s3 nr. 16 (7 min efter): uden for top-10, men kan stadig komme til at ligge godt.
  const near = [...others.slice(0, 15), "s3", ...others.slice(15)];
  const blockedNear = s5MorningGcBlockedRiders({ gcContext: standings(near), entrants }, Object.keys(entrants));
  assert.ok(blockedNear.has("s3"), "klassementsevnen inden for raekkevidde goer ham farlig");
  assert.equal(blockedNear.has("h29"), false, "en svag rytter langt nede er fri");
  // s3 sidst (16 min efter): kan ikke laengere komme til at ligge godt -> fri.
  const far = [...others, "s3"];
  assert.ok((standings(far) as Extract<GcContext, { status: "standings" }>).standings.at(-1)!.gap_seconds > S5_MORNING_GC_EXCLUSION.potentialMaxGapSeconds);
  assert.equal(s5MorningGcBlockedRiders({ gcContext: standings(far), entrants }, Object.keys(entrants)).has("s3"), false, "langt nede er han ingen klassementstrussel");
});

test("#6818: foerste etape (alle lige) maales paa evne; de svage er frie", () => {
  const entrants = field();
  const gc = { status: "standings", stage_number: 1, leader_id: null, standings: Object.keys(entrants).map((id) => ({ rider_id: id, rank: 1, gap_seconds: 0 })), threat_model: "s5", first_stage: true } as GcContext;
  const blocked = s5MorningGcBlockedRiders({ gcContext: gc, entrants }, Object.keys(entrants));
  assert.ok(blocked.has("s1") && blocked.has("s2") && blocked.has("s3"));
  assert.equal(blocked.size, S5_MORNING_GC_EXCLUSION.excludeGcRankAtMost, "kun evnens top, ikke hele det lige klassement");
});

test("#6818: et klassement foert af svage hjaelpere blokerer aldrig hele feltet", () => {
  const entrants = field();
  const helpersFirst = [...Object.keys(entrants).filter((id) => id.startsWith("h")), "s1", "s2", "s3"];
  const blocked = s5MorningGcBlockedRiders({ gcContext: standings(helpersFirst), entrants }, Object.keys(entrants));
  assert.ok(blocked.size <= 2 * S5_MORNING_GC_EXCLUSION.excludeGcRankAtMost, "hoejst stillingens top + evnens top");
  assert.ok(blocked.has("h0"), "foereren");
  assert.equal(blocked.has("s1"), false, "den staerkeste er 16 min nede: uden for raekkevidde");
  assert.equal(blocked.has("h29"), false, "en svag rytter uden for begge toppe kan stadig gaa");
});

test("#6818: endagsloeb og loeb uden stilling blokerer ingen", () => {
  const entrants = field();
  assert.equal(s5MorningGcBlockedRiders({ gcContext: null, entrants }, Object.keys(entrants)).size, 0);
  assert.equal(s5MorningGcBlockedRiders({ gcContext: { status: "one_day" } as GcContext, entrants }, Object.keys(entrants)).size, 0);
});
