// #8297/#8298 · "Today's plan" i wireframe v6c: holdets fem planer som kort (ét valg for hele
// holdet). Samme planer, samme regler og samme handling som TeamPlanChoices7864
// (buildTeamPlan bygger dem; et valg lægger kun en kladde, gemmes af panelets guldknap).
// Det valgte kort (guld-tekst på 10 % guld) afledes af værten ud fra rytternes planer
// (teamPlanFingerprint), så det står der også efter et gem.
// På en smal flade står kortene under hinanden, og kun det valgte viser sin forklaring.
import { TEAM_PLAN_KINDS, type TeamPlanKind, type TeamPlanResult } from "../race/tacticsReady7864.ts";

export interface TeamPlanCardsProps {
  groupLabel: string;
  plans: Record<TeamPlanKind, TeamPlanResult | null>;
  active: TeamPlanKind | null;
  disabled: boolean;
  /** Kortets navn ("Ride for GC with Yamada"). */
  name: (kind: TeamPlanKind, plan: TeamPlanResult | null) => string;
  /** Kortets forklaring (wireframets tekst). */
  description: (kind: TeamPlanKind) => string;
  /** Hvorfor et kort ikke kan vælges (ingen kaptajn, ingen spurtkaptajn), ellers null. */
  unavailable: (kind: TeamPlanKind) => string | null;
  onApply: (plan: TeamPlanResult) => void;
}

export default function TeamPlanCards({ groupLabel, plans, active, disabled, name, description, unavailable, onApply }: TeamPlanCardsProps) {
  return (
    <div data-testid="team-plan-choices" role="group" aria-label={groupLabel} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] sm:gap-2">
      {TEAM_PLAN_KINDS.map((kind) => {
        const plan = plans[kind];
        const selected = active === kind;
        const why = plan ? null : unavailable(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={selected}
            disabled={disabled || !plan}
            title={why ?? undefined}
            data-testid={`team-plan-${kind}`}
            onClick={selected ? undefined : () => { if (plan) onApply(plan); }}
            className={`flex min-h-11 flex-col items-start gap-1 rounded-cz border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? "cursor-default border-cz-accent/40 bg-cz-accent/10" : "border-cz-border bg-cz-card hover:bg-cz-subtle"
            }`}
          >
            <span className={`text-sm font-semibold leading-snug ${selected ? "text-cz-accent-t" : "text-cz-1"}`}>{name(kind, plan)}</span>
            <span className={`text-xs leading-snug text-cz-2 ${selected ? "" : "hidden sm:block"}`}>{description(kind)}</span>
          </button>
        );
      })}
    </div>
  );
}
