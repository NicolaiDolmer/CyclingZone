
import {settleTrainingDateCondition} from '../../lib/trainingDateCondition.js';
import {raceFatigueLoad,restDayFatigue} from '../../lib/raceFatigue.js';
import {nextFatigue,nextForm,injuryRisk,RACE_DAY_ENGINE_RECOVERY_CONFIG as rec} from '../../lib/riderCondition.js';

// S4's stored game_day is ZERO-based. Keep mask construction with the audit,
// rather than relying on an unreviewed external conversion of its input.
export function buildStageMasks(rows) {
  const patterns = [], groups = [], stageDates = [], byPattern = new Map();
  for (const row of rows) {
    const gaps = Array(140).fill(0), stageSlots = Array(140).fill(false);
    const seen = new Set();
    for (const [day] of row.profiles) {
      if (!Number.isInteger(day) || day < 0 || day >= 140 || seen.has(day)) {
        throw new Error('Expected unique zero-based S4 game days');
      }
      seen.add(day);
    }
    for (const [first, last] of row.spans) {
      const days = [...seen].filter(day => day >= first && day <= last).sort((a, b) => a - b);
      for (let index = 0; index < days.length; index++) {
        stageSlots[days[index]] = true;
        if (index + 1 < days.length) gaps[days[index]] = days[index + 1] - days[index] - 1;
      }
    }
    const pattern = [gaps.map(gap => String.fromCharCode(65 + gap)).join(''), stageSlots.map(stage => stage ? '1' : '0').join('')];
    const key = JSON.stringify(pattern);
    if (!byPattern.has(key)) { byPattern.set(key, patterns.length); patterns.push(pattern); }
    groups.push(byPattern.get(key));
    stageDates.push(Array.from({ length: 28 }, (_, date) => stageSlots.slice(date * 5, date * 5 + 5).some(Boolean) ? '1' : '0').join(''));
  }
  return { livePatterns: { patterns, groups }, stageDates };
}
function stats(rows){
 const ordered=rows.toSorted((a,b)=>a.fatigue-b.fatigue),total=rows.reduce((s,r)=>s+r.n,0);let accumulated=0,median=0;
 for(const r of ordered){accumulated+=r.n;if(accumulated>=total/2){median=r.fatigue;break;}}
 return {n:total,median,percent70:100*rows.reduce((s,r)=>s+(r.fatigue>=70?r.n:0),0)/total};
}
function settle(mode,condition,intensities,raceLoads,recovery,dateStr,id,gaps=[]){
 if(mode==='live-cadence'){
  let fatigue=condition.fatigue,form=condition.form,risk=0;
  for(let i=0;i<raceLoads.length;i++){
   fatigue=Math.min(100,fatigue+raceLoads[i]);
   fatigue=restDayFatigue({fatigue,restDays:gaps[i]??0,recoveryAbility:recovery,...rec});
  }
  for(const intensity of intensities){
   // Probability of at least one injury on this date, conditional on arriving
   // healthy. Do not turn the sum of five risks into a single injury roll.
   risk=1-(1-risk)*(1-injuryRisk({intensity,fatigue}));
   fatigue=nextFatigue({fatigue,intensity,recoveryAbility:recovery,...rec});
   form=nextForm({form,fatigue});
  }
  return {fatigue,form,risk};
 }
 if(mode==='current-proposal'){
  let f=condition.fatigue;for(const l of raceLoads)f=Math.min(100,f+l);
  return settleTrainingDateCondition({riderId:id,dateStr,condition:{fatigue:f,form:condition.form},intensities,recoveryAbility:recovery});
 }
 let raceIndex=0;
 const slotLoads=intensities.map(intensity=>intensity==='race'?raceLoads[raceIndex++]??0:0);
 return settleTrainingDateCondition({riderId:id,dateStr,condition,intensities,raceLoads:slotLoads,recoveryAbility:recovery,recoveryConfig:rec});
}
export function auditConditionPopulation({population:p,stageDates,livePatterns}) {
const stageMask=stageDates.map(s=>s.includes('1')?'1':'0').join('');
const results=[];
for(const mode of ['live-cadence','current-proposal','normalized-total']){
 const dates=Array.from({length:28},()=>[[],[]]); const cohorts={};
 let maxUp=0,maxDown=0,expectedInjuries=0,openingBasisExpected=0,exposure=0,raceDates=0,zeroRaceDates=0,stagePeak=0,stageCrossers=0,stageRiders=0,raceCausedCrossers=0;
 let groupIndex=0;
 for(const [ai,_squad,recovery,intensity,n,startFatigue,startForm,patternIndex] of p.groups){
  let condition={fatigue:startFatigue,form:startForm},noRace={...condition},crossed=false,caused=false;
  const [schedule,rest]=p.patterns[patternIndex],stage=stageMask[groupIndex]==='1';
  if(stage)stageRiders+=n;
  for(let d=0;d<28;d++){
   const intensities=[],loads=[],gaps=[];
   for(let j=0;j<5;j++){
    const c=schedule[d*5+j];
    if(c!=='.'){loads.push(raceFatigueLoad(p.profiles[c.charCodeAt(0)-65]));intensities.push(mode==='live-cadence'&&livePatterns.patterns[livePatterns.groups[groupIndex]][1][d*5+j]!=='1'?p.intensities[intensity]:'race');gaps.push(livePatterns.patterns[livePatterns.groups[groupIndex]][0].charCodeAt(d*5+j)-65);}
    else intensities.push(rest[d]==='1'?'rest':p.intensities[intensity]);
   }
   const dateStr=new Date(Date.UTC(2026,8,28+d)).toISOString().slice(0,10);
   const settled=settle(mode,condition,intensities,loads,recovery,dateStr,'weighted-'+groupIndex,gaps);
   noRace=settle(mode,noRace,intensities,loads.map(()=>0),recovery,dateStr,'control-'+groupIndex,gaps);
   maxUp=Math.max(maxUp,settled.form-condition.form);maxDown=Math.min(maxDown,settled.form-condition.form);
   openingBasisExpected+=intensities.reduce((s,i)=>s+injuryRisk({intensity:i,fatigue:condition.fatigue}),0)/(mode==='live-cadence'?1:5)*n; expectedInjuries+=settled.risk*n;exposure+=n;
   
   condition=settled; if(loads.length){raceDates+=n;if(condition.fatigue===0)zeroRaceDates+=n;}
   if(stageDates[groupIndex][d]==='1'){stagePeak=Math.max(stagePeak,condition.fatigue);if(condition.fatigue>70){crossed=true;if(noRace.fatigue<=70)caused=true;}}
   dates[d][ai].push({fatigue:condition.fatigue,n});
  }
  const key=(ai?'ai':'human')+'-'+p.intensities[intensity]; (cohorts[key]??=[]).push({fatigue:condition.fatigue,n}); if(crossed)stageCrossers+=n;if(caused)raceCausedCrossers+=n;groupIndex++;
 }
 results.push({mode,cohorts:Object.fromEntries(Object.entries(cohorts).map(([k,v])=>[k,stats(v)])),maxUp,maxDown,injury:{commonOpeningBasisPer1000RiderDates:openingBasisExpected/exposure*1000,expectedPer1000RiderDates:expectedInjuries/exposure*1000,expectedInjuries,exposure},raceDateZeroShare:{raceDates,zeroRaceDates},g3:{stagePeak,stageRiders,stageCrossers,raceCausedCrossers,limitation:'Saved tour stage date. Counterfactual removes race loads, retaining slots and legacy gap recovery. Not injury-adjusted.'},dates:dates.map((r,i)=>({day:i+1,human:stats(r[0]),ai:stats(r[1])}))});
}
const output={assumptions:'Saved S4 selections, frozen current base plans/recovery, normal effort, weighted current conditions. No injury-driven plan changes; injury figures are hazard/roll rates, not observed production incidence. Normalized variant uses opening condition and total activity load averaged across five slots. Not historical replay.',results};
return output;
}
