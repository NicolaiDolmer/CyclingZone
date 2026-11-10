import { Button } from '../ui/index.js';
import { TEAM_PLAN_KINDS, type TeamPlanKind, type TeamPlanResult } from './tacticsReady7864.ts';

type TFn = (key:string, options?:Record<string,unknown>)=>string;
export default function TeamPlanChoices7864({t,plans,active,disabled,onApply}:{t:TFn;plans:Record<TeamPlanKind,TeamPlanResult|null>;active:TeamPlanKind|null;disabled:boolean;onApply:(plan:TeamPlanResult)=>void}) {
  return <div data-testid="team-plan-choices" role="group" aria-label={t('stagePlan.title')} className="grid grid-cols-2 gap-2 border-b border-cz-border p-4 lg:grid-cols-5">
    {TEAM_PLAN_KINDS.map(kind=>{
      const plan=plans[kind];
      const selected=active===kind;
      const named=plan?.target?.name && ['gc','stage','sprint'].includes(kind);
      const label=named?t(`stagePlanReady.${kind}.named`,{name:plan?.target?.name}):t(`stagePlanReady.${kind}.name`);
      const reason=kind==='gc'&&!plan?t('tacticsOrders.plan.noCaptain'):kind==='sprint'&&!plan?t('racePage.tactics.sprintTrainNone'):t(`stagePlanReady.${kind}.description`);
      return <Button key={kind} variant="secondary" aria-pressed={selected} disabled={disabled||!plan} title={reason}
        data-testid={`team-plan-${kind}`} onClick={selected?undefined:()=>{if(plan)onApply(plan);}}
        className={`h-full min-h-11 w-full flex-col items-start gap-1 whitespace-normal px-3 py-2.5 text-left ${kind==='save'?'col-span-2 lg:col-span-1':''} ${selected?'border-cz-accent bg-cz-accent/10 text-cz-accent-t cursor-default':''}`}>
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-2xs font-normal leading-snug text-cz-2">{t(`stagePlanReady.${kind}.description`)}</span>
      </Button>;
    })}
  </div>;
}
