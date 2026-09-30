import { RIDERS, TEST_TEAM } from "./seedData.js";

export function trainingReceiptMock(seed: Record<string, unknown>, mode: string | null) {
  if (!["complete","pending","reconciliation"].includes(mode ?? "")) return null;
  const own = RIDERS.filter(rider=>rider.team_id===TEST_TEAM.id);
  const date = "2026-09-29";
  const days = mode === "pending" ? [0,1,2] : [0,1,2,3,4];
  const todayRuns = days.map(day=>({
    id: `receipt-fixture-${day}`, tick_date:date,season_id:"receipt-season",squad:"senior",game_day:day,
    executed_by:"cron",bonus_applied:false,created_at:`2026-09-29T20:0${day}:00Z`,
    report:{condition_per_date:true,condition_settled:day===4,date_game_days:[0,1,2,3,4],
      riders:own.map((rider,index)=>({
        rider_id:rider.id,name:`${rider.firstname} ${rider.lastname}`,
        game_day:day,focus:day===4?null:"sprint",intensity:day===4?"rest":"normal",
        race_day:day===1, status:mode==="reconciliation"&&index===0&&day===2?"unknown_pending":"normal",
        settlement_status:mode==="reconciliation"&&index===0&&day===2?"needs_reconciliation":"complete",
        gains:day===1||day===3?{sprint:1}:{},
        gains_detail:day===1?{sprint:{from:54,to:55}}:day===3?{sprint:{from:55,to:56}}:{},
        progress_before:{sprint:[0.8,0.95,0.1,0.9,0.2][day]},
        progress_after:{sprint:[0.95,0.1,0.9,0.2,0.2][day]},
        condition_before_date:{form:52,fatigue:11},form:day===4?53:52,
        fatigue:day===4?19:11,fatigue_delta:day===4?8:0,injured:false,
      })),
    },
  }));
  const trainingScore = Object.fromEntries(own.map(rider=>[rider.id,{
    sessions:days.filter(day=>day!==4).map(day=>({date,seasonId:"receipt-season",gameDay:day,
      score:day===1?null:[52,0,55,56][day],raceDay:day===1})),
  }]));
  return {...seed,todayRun:todayRuns.at(-1),todayRuns,trainingScore,dailyReceiptEnabled:true};
}
