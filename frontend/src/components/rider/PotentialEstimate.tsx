import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CERTAINTIES, certaintyStep, prognosisTitleKey } from "../../lib/potentialEstimateDisplay";
import type { Certainty, PotentialView, PrognosisView } from "../../lib/potentialEstimateDisplay";

// #6110 Udvikling 2.0 (spec §3.4, §3.6): potentialet som ét skønnet tal + ét ord for,
// hvor sikkert skønnet er, og de to tomme tilstande. Komponenten er ren visning:
// alt kommer fra serverens `potentialView`, og den regner intet selv.

type Size = "cell" | "hero" | "report";

const NUMBER_CLASS: Record<Size, string> = {
  cell: "font-mono text-[13px]",
  hero: "font-data text-[20px] font-[650]",
  report: "font-data text-[34px] font-[650] leading-none",
};

// Ejer 20/11 (#8523): "Potentiale 74 · Rimelig". Ordet står som almindelig tekst efter
// en prik, ikke som en chip. Usikker er afdæmpet, "Sikker" er toppen af skalaen.
const WORD_CLASS: Record<Certainty, string> = {
  unsure: "text-cz-3",
  fair: "text-cz-2",
  sure: "text-cz-success",
};

export function CertaintyWord({ certainty }: { certainty: Certainty }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 text-xs font-medium whitespace-nowrap ${WORD_CLASS[certainty]}`}
      data-potential-certainty={certainty}
    >
      <span aria-hidden="true" className="text-cz-3">·</span>
      {t(`rider:potentialEstimate.certainty.${certainty}`)}
    </span>
  );
}

// Navnet er "Potentiale" med undertitlen "spejderens skøn" (ejer 20/11, #8523). Undertitlen
// står dæmpet efter navnet, hvor der er plads; en smal tabeloverskrift har navnet og
// lægger undertitlen i tooltip'en (potentialTitle).
export function PotentialLabel() {
  const { t } = useTranslation();
  return (
    <>
      {t("rider:profile.scouting.potentialLabel")}
      <span className="ml-1.5 font-normal normal-case tracking-normal text-cz-3" data-testid="potential-subtitle">
        {t("riders:potentialNumber.potentialSubtitle")}
      </span>
    </>
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

// #8523 (spec 2026-11-20 §5): den samlede prognose for egne ryttere. Ét tal, ingen
// interval og intet sikkerhedsord: det er en fremskrivning af farten, ikke et skøn.
// Forklaringen ("fortsætter du den nuværende fart ...") ligger i tooltip'en.
export function PrognosisValue({ view, size = "cell" }: { view: PrognosisView; size?: Size }) {
  const { t } = useTranslation();
  if (view.hidden) {
    const pastPeak = view.reason === "pastPeak";
    return (
      <span
        className="text-xs text-cz-3 whitespace-nowrap"
        title={t(prognosisTitleKey(view))}
        data-testid="prognosis-hidden"
        data-prognosis-hidden={view.reason}
      >
        {pastPeak ? t("riders:potentialNumber.prognosisPastPeak") : "—"}
      </span>
    );
  }
  return (
    <span
      className={`tabular-nums whitespace-nowrap text-cz-1 ${NUMBER_CLASS[size]}`}
      title={t(prognosisTitleKey(view))}
      data-testid="prognosis-value"
      data-prognosis-value={view.value}
      {...(view.learning ? { "data-prognosis-learning": "true" } : {})}
    >
      {/* #8604: mens trend-prognosen læres, står tallet som "ca." med usikkerheden i tooltip'en. */}
      {view.learning ? t("riders:potentialNumber.approx", { value: view.value }) : view.value}
    </span>
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

  // Ejer 20/11 (#8523): andres ryttere viser intet uden scouting, kun "?" (afløser
  // tankestregen fra #7932), med Scout-knappen ved siden af, når den findes.
  // AI-holdenes ryttere kan ikke scoutes: "?" uden knap og med forklaringen.
  if (view.hidden && (view.reason === "unscouted" || view.reason === "aiTeam")) {
    const aiTeam = view.reason === "aiTeam";
    return (
      <span className="inline-flex items-center gap-2 flex-wrap" data-testid="potential-estimate-unscouted" data-potential-hidden={view.reason}>
        <span
          className={`tabular-nums text-cz-3 ${NUMBER_CLASS[size]}`}
          title={aiTeam ? t("riders:potentialNumber.aiTeamTitle") : t("rider:scouting.scoutToReveal")}
        >
          ?
        </span>
        {aiTeam ? null : action}
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

  // Ejer 27/11 (#8873): "Tekst skal ikke vises i talfelterne ... Ved potentiale kan det være et
  // tooltip". Feltet viser kun tallet; sikkerheden (Usikker/Rimelig/Sikker) står i tooltip'en.
  // Usikker vises stadig afdæmpet. Det sande tal vises aldrig, kun skønnet.
  const unsure = view.certainty === "unsure";
  const certaintyWord = t(`rider:potentialEstimate.certainty.${view.certainty}`);
  return (
    <span className="inline-flex flex-col gap-1">
      <span className={`inline-flex items-baseline gap-x-1.5 gap-y-1 ${size === "cell" ? "flex-nowrap" : "flex-wrap"}`} data-testid="potential-estimate">
        <span
          className={`tabular-nums whitespace-nowrap ${unsure ? "text-cz-3" : "text-cz-1"} ${NUMBER_CLASS[size]}`}
          title={`${certaintyWord}. ${t("rider:potentialEstimate.notAFact")}`}
          data-potential-value={view.value}
          data-potential-certainty={view.certainty}
        >
          {view.value}
        </span>
        {action}
      </span>
      {sub && <span className="text-2xs font-normal text-cz-3">{sub}</span>}
    </span>
  );
}
