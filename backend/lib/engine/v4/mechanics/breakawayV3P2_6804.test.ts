// #6804 P2 (KUN s5_profiles_v3, slukket): realistisk forspring (#6912, K3).
// Kontrakter, ingen balance-tal (hard rule 17): hvornaar P2 gaelder, hvem der har
// jagt-interesse, at den oevre zone kun naas uden interesse, at den automatiske jagt
// baerer arbejde, og at aeldre revisioner og endagsloeb er uroerte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { s5V3AutoChaseIntensity, s5V3InterestedTeamIds, s5V3RealisticLeadApplies, s5V3RealisticLeadCeilingSeconds } from "./breakawayV3_6804.ts";
import { BREAKAWAY_CHASE_V3_TUNING, S5_V3_BREAKAWAY_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import type { GcContext, ProfileType, TimelineEvent } from "../types.ts";

const standings: GcContext = { status: "standings", stage_number: 2, leader_id: null, standings: [] };
const firstStage: GcContext = { status: "first_stage", stage_number: 1 };
const oneDay: GcContext = { status: "one_day" };
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(fixturesDir, name, "input.json"), "utf8"));

test("#6804 P2: gaelder kun under v3, i et etapeloeb og paa en profil med etapeinteressen", () => {
  assert.equal(s5V3RealisticLeadApplies({ s5ProfilesV3: true, chaseV3: true, gcContext: standings }), true);
  assert.equal(s5V3RealisticLeadApplies({ s5ProfilesV3: true, chaseV3: true, gcContext: firstStage }), true);
  assert.equal(s5V3RealisticLeadApplies({ s5ProfilesV3: true, chaseV3: true, gcContext: oneDay }), false, "endagsloeb uroert");
  assert.equal(s5V3RealisticLeadApplies({ s5ProfilesV3: true, chaseV3: false, gcContext: standings }), false, "kun med etapeinteressen");
  assert.equal(s5V3RealisticLeadApplies({ s5ProfilesV3: false, chaseV3: true, gcContext: standings }), false);
  assert.equal(s5V3RealisticLeadApplies({ chaseV3: true, gcContext: standings }), false);
  assert.equal(s5V3RealisticLeadApplies({ s5ProfilesV3: true, chaseV3: true, gcContext: null }), false);
});

test("#6804 P2: interesse = positiv etapeinteresse ELLER positivt signal; lad gaa og egne foran taeller aldrig", () => {
  const ids = s5V3InterestedTeamIds({
    interestByTeam: new Map([["t-b", 0.2], ["t-zero", 0]]),
    teamSignals: new Map([["t-a", 0.3], ["t-letgo", -0.4], ["t-own", 0.5]]),
    excludedTeamIds: new Set(["t-own"]),
  });
  assert.deepEqual(ids, ["t-a", "t-b"], "sorteret, kun positive, uden udelukkede");
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: new Map(), teamSignals: new Map([["t-letgo", -1]]) }), [], "kun lad gaa = ingen interesse");
  assert.deepEqual(s5V3InterestedTeamIds({ interestByTeam: new Map([["t-gc", 0]]), teamSignals: new Map([["t-gc", 0.1]]) }), ["t-gc"], "kun et positivt klassementssignal taeller");
});

test("#6804 P2 (K3): mellemzonen med interesse ligger under den oevre zone paa alle profiler", () => {
  const profiles: ProfileType[] = ["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles"];
  const upper = s5V3RealisticLeadCeilingSeconds("mountain", false);
  for (const p of profiles) {
    const interested = s5V3RealisticLeadCeilingSeconds(p, true);
    assert.ok(interested > 0, p);
    assert.ok(interested <= upper, `${p}: med interesse aldrig over den oevre zone`);
    assert.equal(s5V3RealisticLeadCeilingSeconds(p, false), upper, `${p}: den oevre zone er ens (aldrig over den haarde graense)`);
  }
  for (const p of BREAKAWAY_CHASE_V3_TUNING.profileTypes) assert.ok(S5_V3_BREAKAWAY_TUNING.p2.interestedLeadSecondsByProfile[p] !== undefined, `${p} har sin egen tolerance`);
});

test("#6804 P2: den automatiske jagts arbejde foelger interessen, i [0, 1]", () => {
  assert.equal(s5V3AutoChaseIntensity(0, 1), 0);
  assert.equal(s5V3AutoChaseIntensity(-1, 1), 0);
  assert.equal(s5V3AutoChaseIntensity(1, 0), 0);
  const lo = s5V3AutoChaseIntensity(0.01, 1);
  const hi = s5V3AutoChaseIntensity(0.5, 1);
  assert.ok(lo > 0 && lo <= hi && hi <= 1, "monoton og loftet");
  assert.ok(s5V3AutoChaseIntensity(100, 1) <= 1);
});

const unchased = (events: readonly TimelineEvent[]) => events.filter((e) => e.type === "breakaway_unchased");
const caughtTeams = (events: readonly TimelineEvent[]) => events.filter((e) => e.type === "breakaway_caught").flatMap((e) => (e.params.chasing_team_ids as string[] | undefined) ?? []);

test("#6804 P2: v2 og endagsloeb melder aldrig 'ingen jagt-interesse'; v3 er deterministisk", () => {
  for (const name of ["flat-massespurt", "bjerg-selektion", "mur-finale"]) {
    const input = fixture(name);
    for (const gc of [firstStage, oneDay]) {
      const v2 = simulateStageV4({ ...input, gc_context: gc, rules_revision: "s5_profiles_v2" });
      assert.equal(unchased(v2.timeline.events).length, 0, `${name} v2`);
    }
    const v3OneDay = simulateStageV4({ ...input, gc_context: oneDay, rules_revision: "s5_profiles_v3" });
    assert.equal(unchased(v3OneDay.timeline.events).length, 0, `${name} v3 endagsloeb`);
    const a: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3" }));
    const b: string = JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3" }));
    assert.equal(a, b, `${name} deterministisk`);
  }
});

test("#6804 P2: uden hold er der ingen jagt-interesse; med spurterhold paa en flad etape er der, og jagten navngives", () => {
  const input = fixture("flat-massespurt");
  // Fixturen har ingen hold: intet hold kan jage, saa motoren melder det.
  const noTeams = simulateStageV4({ ...input, gc_context: firstStage, rules_revision: "s5_profiles_v3" });
  if (noTeams.timeline.events.some((e) => e.type === "breakaway_formed")) assert.ok(unchased(noTeams.timeline.events).length <= 1, "hoejst en linje pr. udbrud");
  const withTeams = { ...input, startlist: input.startlist.map((r: Record<string, unknown>, i: number) => ({ ...r, team_id: `team-${i % 4}` })) };
  const v3 = simulateStageV4({ ...withTeams, gc_context: firstStage, rules_revision: "s5_profiles_v3" });
  assert.equal(unchased(v3.timeline.events).length, 0, "spurterholdene vil jage");
  const caught = v3.timeline.events.some((e) => e.type === "breakaway_caught");
  if (caught) assert.ok(caughtTeams(v3.timeline.events).length > 0, "den automatiske jagt baerer arbejde, saa filmen kan navngive jagtholdene");
});
