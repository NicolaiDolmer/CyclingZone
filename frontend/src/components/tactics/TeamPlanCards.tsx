// #8297 · "Dagens plan" i wireframe v6c: holdets fem planer som kort (ét valg for hele
// holdet). Samme planer, samme regler og samme handling som TeamPlanChoices7864
// (buildTeamPlan bygger dem; et valg lægger kun en kladde, gemmes af panelets guldknap).
// Kun udseendet er wireframets: kort i et gitter, det valgte med guld-tekst på 10 % guld-flade.
// På en smal flade står kortene under hinanden, og kun det valgte viser sin forklaring.
import { TEAM_PLAN_KINDS, type TeamPlanKind, type TeamPlanResult } from "../race/tacticsReady7864.ts";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export interface TeamPlanCardsProps {
  t: TFn;
  plans: Record<TeamPlanKind, TeamPlanResult | null>;
  active: TeamPlanKind | null;
  disabled: boolean;
  onApply: (plan: TeamPlanResult) => void;
}

export default function TeamPlanCards({ t, plans, active, disabled, onApply }: TeamPlanCardsProps) {
  return (
    <div data-testid="team-plan-choices" role="group" aria-label={t("stagePlan.title")} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] sm:gap-2">
      {TEAM_PLAN_KINDS.map((kind) => {
        const plan = plans[kind];
        const selected = active === kind;
        const named = plan?.target?.name && ["gc", "stage", "sprint"].includes(kind);
        const label = named ? t(`stagePlanReady.${kind}.named`, { name: plan?.target?.name }) : t(`stagePlanReady.${kind}.name`);
        const reason = kind === "gc" && !plan ? t("tacticsOrders.plan.noCaptain") : kind === "sprint" && !plan ? t("racePage.tactics.sprintTrainNone") : t(`stagePlanReady.${kind}.description`);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={selected}
            disabled={disabled || !plan}
            title={reason}
            data-testid={`team-plan-${kind}`}
            onClick={selected ? undefined : () => { if (plan) onApply(plan); }}
            className={`flex min-h-11 flex-col items-start gap-0.5 rounded-cz border border-cz-border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? "cursor-default bg-cz-accent/10" : "bg-cz-card hover:bg-cz-subtle"
            }`}
          >
            <span className={`text-sm font-semibold leading-snug ${selected ? "text-cz-accent-t" : "text-cz-1"}`}>{label}</span>
            <span className={`text-xs leading-snug text-cz-2 ${selected ? "" : "hidden sm:block"}`}>{t(`stagePlanReady.${kind}.description`)}</span>
          </button>
        );
      })}
    </div>
  );
}
