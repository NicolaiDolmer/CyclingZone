// Deterministic diagnostic only: synthetic cohorts, fixed dates, current production functions.
// Compares cadence and mixed timing, not historical S3 code. No DB access, injuries or staff.
// Output contains private balance measurements; never commit or paste it into public issues.
import fs from 'node:fs';
import {raceFatigueLoad, restDayFatigue} from '../../lib/raceFatigue.js';
import {raceDayProgram} from '../../lib/raceDayYield.js';
import {applyDailyTick} from '../../lib/dailyTraining.js';
import {VISIBLE_ABILITIES} from '../../lib/abilityDerivation.js';
import {nextFatigue,nextForm,conditionMultiplier,injuryRisk,RACE_DAY_ENGINE_RECOVERY_CONFIG as rec} from '../../lib/riderCondition.js';
import {resolveRaceDayBudgetDivisor} from '../../lib/trainingRaceDayTick.js';
if (!process.argv[2]) throw new Error('Provide a private output path, for example balance-internals/training-cadence-audit.json');
const start=Date.UTC(2026,8,28);const divisor=resolveRaceDayBudgetDivisor({seasonNumber:4});
function simulate({age,recovery,intensity,ticks,newCadence,dynamic,seed}){
 let abilities=Object.fromEntries(VISIBLE_ABILITIES.map(k=>[k,k==='recovery'?recovery:45]));
 const initial={...abilities};const caps=Object.fromEntries(VISIBLE_ABILITIES.map(k=>[k,Math.max(initial[k],80)]));
 let progress={},fatigue=0,form=50,riskDays=0,dayOne=null;
 for(let tick=0;tick<ticks;tick++){
 const dateStr=new Date(start+86400000*(newCadence?Math.floor(tick/5):tick)).toISOString().slice(0,10);
 const out=applyDailyTick({riderId:'synthetic-'+seed,dateStr,age,abilities,caps,progress,program:{focus:'vo2max',intensity},conditionMult:dynamic?conditionMultiplier({form,fatigue}):1,potentiale:4,primaryType:'climber',secondaryType:null,budgetDivisor:newCadence?divisor:null,hardDailyCap:newCadence?1:undefined,tickSeedKey:newCadence?'s4#gd'+tick:null});
 if(injuryRisk({intensity,fatigue})>0)riskDays++;
 abilities=out.abilities;progress=out.progress;
 fatigue=nextFatigue({fatigue,intensity,recoveryAbility:abilities.recovery,...rec});form=nextForm({form,fatigue});
 const gain=k=>abilities[k]-initial[k]+(progress[k]||0);
 if(tick===(newCadence?4:0))dayOne={fatigue,form,climbing:gain('climbing')};
 }
 const growth=VISIBLE_ABILITIES.reduce((s,k)=>s+abilities[k]-initial[k]+(progress[k]||0),0);
 return {growth,climbing:abilities.climbing-initial.climbing+(progress.climbing||0),fatigue,form,riskDays,dayOne};
}
const rows=[];
for(const dynamic of [false,true])for(const age of [18,22,28,34])for(const recovery of [20,50,80])for(const intensity of ['normal','hard','rest']){
 const sums={oldGrowth:0,newGrowth:0,oldClimbing:0,newClimbing:0,oldDayGain:0,newDayGain:0};let oldResult,newResult;
 for(let seed=0;seed<64;seed++){
 oldResult=simulate({age,recovery,intensity,ticks:31,newCadence:false,dynamic,seed});newResult=simulate({age,recovery,intensity,ticks:140,newCadence:true,dynamic,seed});
 sums.oldGrowth+=oldResult.growth;sums.newGrowth+=newResult.growth;sums.oldClimbing+=oldResult.climbing;sums.newClimbing+=newResult.climbing;sums.oldDayGain+=oldResult.dayOne.climbing;sums.newDayGain+=newResult.dayOne.climbing;
 }
 rows.push({dynamic,age,recovery,intensity,seasonGrowthRatio:sums.oldGrowth?sums.newGrowth/sums.oldGrowth:null,seasonClimbingRatio:sums.oldClimbing?sums.newClimbing/sums.oldClimbing:null,firstDateClimbingRatio:sums.oldDayGain?sums.newDayGain/sums.oldDayGain:null,oldFatigue:oldResult.fatigue,newFatigue:newResult.fatigue,oldForm:oldResult.form,newForm:newResult.form,oldFirstDate:oldResult.dayOne,newFirstDate:newResult.dayOne,newRiskDays:newResult.riskDays});
}

function mixedSchedule({ profile, recovery, mode }) {
  const initial = Object.fromEntries(VISIBLE_ABILITIES.map(k => [k, k === 'recovery' ? recovery : 45]));
  const caps = Object.fromEntries(VISIBLE_ABILITIES.map(k => [k, Math.max(initial[k], 80)]));
  let abilities = { ...initial }, progress = {}, fatigue = 0, form = 50;
  let firstDate = null;
  const sessions = ['hard', 'hard', 'race', 'hard', 'race'];
  const stageEntryFatigues = [];
  for (let date = 0; date < 28; date++) {
    if (mode !== 'chronological-reference') {
      for (const gap of [1, 2]) {
        if (date === 0) stageEntryFatigues.push(fatigue);
        fatigue = Math.min(100, fatigue + raceFatigueLoad(profile));
        if (mode === 'gap-recovery-before-fix') {
          fatigue = restDayFatigue({ fatigue, restDays: gap, recoveryAbility: abilities.recovery, ...rec });
        }
      }
    }
    for (let slot = 0; slot < sessions.length; slot++) {
      const intensity = sessions[slot];
      if (mode === 'chronological-reference' && intensity === 'race') {
        if (date === 0) stageEntryFatigues.push(fatigue);
        fatigue = Math.min(100, fatigue + raceFatigueLoad(profile));
      }
      const program = intensity === 'race' ? raceDayProgram(profile) : { focus: 'vo2max', intensity };
      const tick = applyDailyTick({
        riderId: 'mixed-example', dateStr: new Date(start + date * 86400000).toISOString().slice(0, 10),
        age: 22, abilities, caps, progress, program,
        conditionMult: conditionMultiplier({ form, fatigue }), potentiale: 4,
        primaryType: 'climber', budgetDivisor: divisor, hardDailyCap: 1,
        tickSeedKey: 's4#gd' + (date * 5 + slot),
      });
      abilities = tick.abilities; progress = tick.progress;
      fatigue = nextFatigue({ fatigue, intensity, recoveryAbility: abilities.recovery, ...rec });
      form = nextForm({ form, fatigue });
    }
    if (date === 0) firstDate = { fatigue, form };
  }
  return {
    profile, recovery, mode, firstDate, firstDateStageEntryFatigues: stageEntryFatigues,
    end: { fatigue, form },
    growth: VISIBLE_ABILITIES.reduce((sum, k) => sum + abilities[k] - initial[k] + (progress[k] || 0), 0),
    climbingGrowth: abilities.climbing - initial.climbing + (progress.climbing || 0),
  };
}
const mixedRows = [];
for (const profile of ['flat', 'rolling', 'mountain']) {
  for (const recovery of [20, 50, 80]) {
    for (const mode of ['gap-recovery-before-fix', 'single-recovery-owner', 'chronological-reference']) {
      mixedRows.push(mixedSchedule({ profile, recovery, mode }));
    }
  }
}

fs.writeFileSync(process.argv[2],JSON.stringify({label:'Synthetic production-function cadence comparison; no injuries sampled; fixed caps/cohort inputs; no staff. Mixed examples include pre-fix, current evening and hypothetical chronological timing. Not historical S3 replay.',rows,mixedRows},null,2));
console.log('Cadence comparison written to the private output file. Review assumptions before judging balance.');
