import { Link } from "react-router-dom";

const STEP_META = {
  team_named: {
    label: "Navngiv hold og manager",
    cta: { to: "/profile", text: "Profil →" },
  },
  first_rider_owned: {
    label: "Køb din første rytter",
    cta: { to: "/riders", text: "Gå til Marked →" },
  },
  first_bid_placed: {
    label: "Afgiv dit første bud",
    cta: { to: "/auctions", text: "Se Auktioner →" },
  },
  board_plan_set: {
    label: "Vælg en bestyrelsesplan",
    cta: { to: "/board", text: "Mød bestyrelsen →" },
  },
};

export default function OnboardingProgressCard({ progress, onDismiss }) {
  if (!progress) return null;
  const { steps, completed_count, total_count } = progress;
  const pct = Math.round((completed_count / Math.max(total_count, 1)) * 100);
  const nextStep = steps.find(s => !s.done);

  return (
    <div className="mb-4 px-4 py-3 bg-cz-card border border-cz-accent/30 rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-cz-accent-t text-base">🚴</span>
            <p className="text-cz-1 text-sm font-semibold">
              Kom i gang — {completed_count}/{total_count} trin fuldført
            </p>
          </div>
          <div className="bg-cz-subtle rounded-full h-1.5 mb-3">
            <div
              className="h-1.5 bg-cz-accent rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="space-y-1.5">
            {steps.map(step => {
              const meta = STEP_META[step.key];
              if (!meta) return null;
              const isNext = !step.done && step === nextStep;
              return (
                <li key={step.key} className="flex items-center gap-2 text-xs">
                  <span className={
                    step.done ? "text-cz-success" : isNext ? "text-cz-accent-t" : "text-cz-3"
                  }>
                    {step.done ? "✓" : isNext ? "▸" : "○"}
                  </span>
                  <span className={
                    step.done
                      ? "text-cz-3 line-through"
                      : isNext
                        ? "text-cz-1 font-medium"
                        : "text-cz-2"
                  }>
                    {meta.label}
                  </span>
                  {isNext && meta.cta && (
                    <Link
                      to={meta.cta.to}
                      className="ml-auto text-cz-accent-t text-xs hover:underline font-medium"
                    >
                      {meta.cta.text}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <button
          onClick={onDismiss}
          className="text-cz-3 hover:text-cz-1 text-lg leading-none px-1 flex-shrink-0"
          aria-label="Skjul"
        >
          ×
        </button>
      </div>
    </div>
  );
}
