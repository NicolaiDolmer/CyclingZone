import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CERTAINTIES, certaintyStep } from "../../lib/potentialEstimateDisplay";
import type { Certainty, PotentialView } from "../../lib/potentialEstimateDisplay";

// #6110 Udvikling 2.0 (spec §3.4, §3.6): potentialet som ét skønnet tal + ét ord for,
// hvor sikkert skønnet er, og de to tomme tilstande. Komponenten er ren visning:
// alt kommer fra serverens `potentialView`, og den regner intet selv.

type Size = "cell" | "hero" | "report";

const NUMBER_CLASS: Record<Size, string> = {
  cell: "font-mono text-[13px]",
  hero: "font-data text-[20px] font-[650]",
  report: "font-data text-[34px] font-[650] leading-none",
};

// Samme tre tone-trin som Scouting-fanens tillids-chip, så ordene taler ét sprog.
const WORD_CLASS: Record<Certainty, string> = {
  unsure: "bg-cz-warning-bg text-cz-warning border-cz-warning/30",
  fair: "bg-cz-subtle text-cz-2 border-cz-border",
  sure: "bg-cz-success-bg text-cz-success border-cz-success/30",
};

export function CertaintyWord({ certainty }: { certainty: Certainty }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-cz border px-1.5 py-0.5 text-3xs font-medium leading-none whitespace-nowrap ${WORD_CLASS[certainty]}`}
      data-potential-certainty={certainty}
    >
      {t(`rider:potentialEstimate.certainty.${certainty}`)}
    </span>
  );
}

export function CertaintyMeter({ certainty }: { certainty: Certainty }) {
  const { t } = useTranslation();
  const step = certaintyStep(certainty);
  return (
    <div role="img" aria-label={t(`rider:potentialEstimate.certainty.${certainty}`)} data-testid="potential-certainty-meter">
      <div className="grid grid-cols-3 gap-1" aria-hidden="true">
        {CERTAINTIES.map((word, index) => (
          <span key={word} className={`h-1 rounded-cz ${index < step ? "bg-cz-1" : "bg-cz-subtle"}`} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 font-data text-3xs uppercase tracking-[.08em] text-cz-3" aria-hidden="true">
        {CERTAINTIES.map((word, index) => (
          <span key={word} className={index === 1 ? "text-center" : index === 2 ? "text-right" : ""}>
            {t(`rider:potentialEstimate.certainty.${word}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

type Props = {
  view: PotentialView;
  size?: Size;
  /** Scout-knap eller ventetid ved siden af tal eller tom tilstand. */
  action?: ReactNode;
  /** Dæmpet linje under tallet, fx "Scoutet 1 gang". */
  sub?: ReactNode;
};

export default function PotentialEstimate({ view, size = "cell", action = null, sub = null }: Props) {
  const { t } = useTranslation();

  // Ejer 12/11 (#7932): uscoutet viser kun Scout-knappen; uden knap en tankestreg.
  if (view.hidden && view.reason === "unscouted") {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap" data-testid="potential-estimate-unscouted">
        {action ?? (
          <span className="text-cz-3" title={t("rider:scouting.scoutToReveal")}>—</span>
        )}
      </span>
    );
  }

  if (view.hidden) {
    const values = { trainings: view.trainings, needed: view.trainingsNeeded };
    const full = t("rider:potentialEstimate.learning", values);
    return (
      <span className="text-xs text-cz-2 tabular-nums" title={full} data-testid="potential-estimate-learning">
        {size === "cell" ? t("rider:potentialEstimate.learningShort", values) : full}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-2 flex-wrap" data-testid="potential-estimate">
        <span
          className={`tabular-nums whitespace-nowrap text-cz-1 ${NUMBER_CLASS[size]}`}
          title={t("rider:potentialEstimate.notAFact")}
          data-potential-value={view.value}
        >
          {view.value}
        </span>
        <CertaintyWord certainty={view.certainty} />
        {action}
      </span>
      {sub && <span className="text-2xs font-normal text-cz-3">{sub}</span>}
    </span>
  );
}
