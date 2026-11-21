// #7947 PR 3 (#8530) · Indsatsvaelgeren Let | Mellem | Haard i I dag-fanen R5, paa
// holdlinjen og i hver raekke. Vises kun naar BAADE training_effort_levels og
// training_page_r5 er taendt; ellers tegner fanen sine fire knapper som foer.
//
// Tre ting er ejerens (20/11): niveauerne er spillets egne tre (ingen ny skala);
// Hvile er sit eget valg, med egen knap ved siden af og uden fokus eller niveau;
// og skaderisikoen staar kun paa Haard (en linje i raekken naar Haard er valgt, og
// en forklaring paa Haard-knappen selv).
//
// Ren praesentation: valget gives videre til TodayR5, der skriver med sidens egne
// gemme-kald. TASTE: hairline, 5px radius, ingen skygger, stroke-ikon, tabular tal.

import { useTranslation } from "react-i18next";
import { Segmented } from "../../ui/Segmented.jsx";
import { AlertTriangleIcon } from "../../ui/icons/index.jsx";
import { LEVEL_EFFORTS, injuryRiskPercent, type Effort } from "./todayR5Model.ts";

export default function EffortPickerR5({ value, onPick, disabled, scope, full = false, testId }: {
  /** Det trykkede valg (et niveau eller Hvile); null = intet trykket (holdlinjen). */
  value: Effort | null;
  onPick: (effort: Effort) => void;
  disabled: boolean;
  /** Hvem valget gaelder, til skaermlaeserens navn ("Whole team today", rytterens navn). */
  scope: string;
  full?: boolean;
  testId: string;
}) {
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  const levelValue = value && value !== "rest" ? value : "none";
  return (
    <div className={full ? "flex w-full items-stretch gap-1.5" : "inline-flex items-center gap-1.5"} data-testid={testId}>
      <Segmented
        label={tR5("effortPicker.levelAria", { scope })}
        value={levelValue}
        onChange={(v: Effort) => onPick(v)}
        options={LEVEL_EFFORTS.map((e) => ({
          value: e,
          label: tR5(`effort.${e}`),
          title: e === "hard" ? tR5("effortPicker.hardHint") : undefined,
          disabled,
        }))}
        className={full ? "flex-1 [&>button]:flex-1" : ""}
      />
      {/* Hvile er et eget valg: ingen session og intet niveau (ejer 20/11). */}
      <Segmented
        label={tR5("effortPicker.restAria", { scope })}
        value={value === "rest" ? "rest" : "none"}
        onChange={(v: Effort) => onPick(v)}
        options={[{ value: "rest", label: tR5("effort.rest"), disabled }]}
      />
    </div>
  );
}

/** Raekkens skaderisiko-linje: vises kun naar Haard er dagens indsats. */
export function HardRiskLine({ risk }: { risk: number | null | undefined }) {
  const { t: tR5 } = useTranslation("trainingR5");
  const pct = injuryRiskPercent(risk);
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-cz-warning" data-testid="r5-hard-risk">
      <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0" />
      <span className="tabular-nums">{pct === null ? tR5("effortPicker.riskGeneric") : tR5("effortPicker.risk", { pct })}</span>
    </span>
  );
}
