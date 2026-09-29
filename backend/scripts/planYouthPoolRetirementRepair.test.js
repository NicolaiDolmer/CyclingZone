import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, readYouthPoolRepairPlan } from "./planYouthPoolRetirementRepair.mjs";

const GHOST = "00000000-0000-0000-0000-000000000001";
const RACING = "00000000-0000-0000-0000-000000000002";
const SPARE_1 = "00000000-0000-0000-0000-000000000101";
const SPARE_2 = "00000000-0000-0000-0000-000000000102";
const SPARE_3 = "00000000-0000-0000-0000-000000000103";

test("#4753 CLI requires two distinct UUIDs and provides no apply option", () => {
  assert.deepEqual(parseArgs([`--retired-team-id=${GHOST}`, `--pending-team-id=${RACING}`]),
    { "retired-team-id": GHOST, "pending-team-id": RACING });
  assert.throws(() => parseArgs([`--retired-team-id=${GHOST}`, `--pending-team-id=${GHOST}`]), /different/);
  assert.throws(() => parseArgs(["--apply", `--retired-team-id=${GHOST}`, `--pending-team-id=${RACING}`]), /no apply mode/);
});

test("#4753 production-shaped dry-run reads only and previews two guarded replacements", async () => {
  const base = { is_ai: true, user_id: null, is_bank: false, is_frozen: false,
    is_test_account: false, parked_at: null, retired_at: null, pending_removal_at: null,
    league_division_id: 10, u23_league_division_id: null, junior_league_division_id: null };
  const teams = [
    { ...base, id: GHOST, name: "Ghost", retired_at: "2026-09-28T08:00:00Z", league_division_id: null, u23_league_division_id: 21, junior_league_division_id: 33 },
    { ...base, id: RACING, name: "Racing", pending_removal_at: "2026-09-28T20:00:00Z", u23_league_division_id: 22, junior_league_division_id: 34 },
    { ...base, id: SPARE_1, name: "First spare" },
    { ...base, id: SPARE_2, name: "Second spare" },
    { ...base, id: SPARE_3, name: "Third spare" },
    ...Array.from({ length: 23 }, (_, i) => ({ ...base, id: `a${i}`, is_ai: false, u23_league_division_id: 21, junior_league_division_id: 33 })),
    ...Array.from({ length: 23 }, (_, i) => ({ ...base, id: `b${i}`, is_ai: false, u23_league_division_id: 22, junior_league_division_id: 34 })),
  ];
  const riders = [SPARE_1, SPARE_2, SPARE_3].flatMap((team_id) => Array.from({ length: 12 }, (_, i) => ({
    id: `${team_id}-${i}`, team_id, squad: i < 6 ? "u23" : "junior", is_academy: true, is_retired: false,
  })));
  riders.push({ id: "racing-stale", team_id: RACING, squad: "junior", is_academy: true, is_retired: false });
  const rows = {
    teams, riders,
    race_entries: [
      { id: "entry", team_id: RACING, rider_id: "racing-rider", race_id: "race" },
      { id: "stale", team_id: null, rider_id: `${SPARE_1}-0`, race_id: "race" },
      { id: "stale-target", team_id: null, rider_id: "racing-stale", race_id: "later-race" },
    ],
    races: [
      { id: "race", name: "Stage race", squad: "junior", status: "scheduled", stages_completed: 1 },
      { id: "later-race", name: "Later race", squad: "junior", status: "scheduled", stages_completed: 0 },
    ],
    race_stage_schedule: [
      { race_id: "race", stage_number: 4, scheduled_at: "2026-10-01T12:30:00Z" },
      { race_id: "later-race", stage_number: 1, scheduled_at: "2026-10-02T12:30:00Z" },
    ],
  };
  const calls = [];
  const supabase = { from(table) {
    calls.push(table);
    let selected = rows[table] || [];
    const builder = {
      select() { return builder; },
      in(field, ids) { selected = selected.filter((row) => ids.includes(row[field])); return builder; },
      order() { return builder; },
      range(from, to) { return Promise.resolve({ data: selected.slice(from, to + 1), error: null }); },
    };
    return builder;
  } };
  const result = await readYouthPoolRepairPlan({ supabase, retiredTeamId: GHOST, pendingTeamId: RACING, now: new Date("2026-09-29T12:00:00Z") });
  assert.deepEqual(result.repairs.map((r) => [r.targetId, r.replacementId, r.when]), [
    [GHOST, SPARE_2, "owner_go_now"], [RACING, SPARE_3, "after_last_race"],
  ]);
  assert.equal(result.groupCounts[21], 24);
  assert.equal(result.groupCounts[34], 24);
  assert.equal(result.readOnly, true);
  assert.equal(result.repairs[1].lastScheduledAt, "2026-10-02T12:30:00Z");
  assert.deepEqual(result.blockers, []);
  assert.ok(calls.includes("race_entries"));
});

function eligibleRosterFixture({ injury = null, pending = false } = {}) {
  const base = { is_ai:true,user_id:null,is_bank:false,is_frozen:false,is_test_account:false,
    parked_at:null,retired_at:null,pending_removal_at:null,league_division_id:10,
    u23_league_division_id:null,junior_league_division_id:null };
  const rows = {
    teams:[{...base,id:GHOST,retired_at:'2026-09-28T08:00:00Z',u23_league_division_id:21,junior_league_division_id:33},
      {...base,id:RACING,pending_removal_at:'2026-09-28T20:00:00Z',u23_league_division_id:22,junior_league_division_id:34},
      ...[SPARE_1,SPARE_2,SPARE_3].map(id=>({...base,id})),
      ...Array.from({length:23},(_,i)=>({...base,id:`a${i}`,is_ai:false,u23_league_division_id:21,junior_league_division_id:33})),
      ...Array.from({length:23},(_,i)=>({...base,id:`b${i}`,is_ai:false,u23_league_division_id:22,junior_league_division_id:34}))],
    riders:[SPARE_1,SPARE_2,SPARE_3].flatMap(team_id=>Array.from({length:12},(_,i)=>({
      id:`${team_id}-${i}`,team_id,squad:i<6?'u23':'junior',is_academy:true,is_retired:false,
      pending_team_id:pending && team_id===SPARE_1 && i===6 ? RACING : null }))),
    rider_condition:injury ? [{rider_id:`${SPARE_1}-6`,injured_until:injury}] : [],
    race_entries:[],races:[],race_stage_schedule:[],
  };
  return {from(table){let selected=rows[table]||[];const q={
    select(){return q;},order(){return q;},in(field,ids){selected=selected.filter(row=>ids.includes(row[field]));return q;},
    range(from,to){return Promise.resolve({data:selected.slice(from,to+1),error:null});}};return q;}};
}

for (const scenario of [
  { name:'injured on Copenhagen date',injury:'2026-09-29',expected:SPARE_2 },
  { name:'recovered before Copenhagen date',injury:'2026-09-28',expected:SPARE_1 },
  { name:'pending transfer',pending:true,expected:SPARE_2 },
]) {
  test(`#4753 dry-run counts eligible starters: ${scenario.name}`,async()=>{
    const result=await readYouthPoolRepairPlan({supabase:eligibleRosterFixture(scenario),
      retiredTeamId:GHOST,pendingTeamId:RACING,now:new Date('2026-09-28T22:30:00Z')});
    assert.equal(result.repairs.find(row=>row.targetId===GHOST).replacementId,scenario.expected);
  });
}

test('#4753 dry-run requires an explicit clock',async()=>{
  await assert.rejects(readYouthPoolRepairPlan({supabase:eligibleRosterFixture(),retiredTeamId:GHOST,pendingTeamId:RACING}),/Explicit valid now/);
});
