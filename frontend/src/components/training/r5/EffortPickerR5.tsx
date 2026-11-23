// #7947 · Indsatsen i I dag-fanen R5: een segmenteret kontrol med ordene
// Hvile · Let · Mellem · Haard, paa holdlinjen, for en gruppe og i hver raekke.
//
// Ejer 17/11: Hvile staar til venstre for Let. Ejer 23/11: ordene skrives fuldt ud
// ("Jeg oensker ikke forkortelser i spillet"), og indsatsen har sin egen kolonne.
// Med training_effort_levels (ejer 20/11) er Let/Mellem/Haard niveauet for den valgte
// traening, og Hvile er sit eget valg uden fokus eller niveau; skaderisikoen staar kun
// paa Haard (forklaringen paa selve knappen og et ikon i raekken naar Haard er valgt).
//
// Ren praesentation: valget gives videre til TodayR5, der skriver med sidens egne
// gemme-kald. TASTE: hairline, 5px radius, ingen skygger, stroke-ikon.

import { useTranslation } from "react-i18next";
import { Segmented } from "../../ui/Segmented.jsx";
import { AlertTriangleIcon } from "../../ui/icons/index.jsx";
import { EFFORTS, type Effort } from "./todayR5Model.ts";

export default function EffortPickerR5({ value, onPick, disabled, scope, full = false, compact = false, hardHint = true, testId }: {
  /** Det trykkede valg; null = intet trykket (holdlinjen, eller rytteren foelger sit program). */
  value: Effort | null;
  onPick: (effort: Effort) => void;
  disabled: boolean;
  /** Hvem valget gaelder, til skaermlaeserens navn ("Whole team today", rytterens navn). */
  scope: string;
  full?: boolean;
  /** Smallere knapper, saa de fire ord staar paa een linje i tabellens kolonne. */
  compact?: boolean;
  /** Forklaringen paa Haard-knappen (kun med niveauerne, hvor Haard er et valg for sig). */
  hardHint?: boolean;
  testId: string;
}) {
  const { t: tR5 } = useTranslation("trainingR5"); // #7947: lazy namespace (I18nReadyGate i TrainingPage)
  return (
    <div className={full ? "flex w-full" : "inline-flex"} data-testid={testId}>
      <Segmented
        label={tR5("row.effortAria", { scope })}
        value={value ?? "none"}
        onChange={(v: Effort) => onPick(v)}
        options={EFFORTS.map((e) => ({
          value: e,
          label: tR5(`effort.${e}`),
          title: hardHint && e === "hard" ? tR5("effortPicker.hardHint") : undefined,
          disabled,
        }))}
        className={`whitespace-nowrap ${full ? "w-full [&>button]:flex-1" : ""} ${compact ? "[&>button]:px-2" : ""}`}
      />
    </div>
  );
}

/**
 * Raekkens skaderisiko-linje: vises kun naar Haard er dagens indsats. Ejer 21/11: ingen
 * procent til spilleren, kun at Haard giver oeget skaderisiko.
 */
export function HardRiskLine() {
  const { t: tR5 } = useTranslation("trainingR5");
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-cz-warning" data-testid="r5-hard-risk">
      <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0" />
      <span>{tR5("effortPicker.riskGeneric")}</span>
    </span>
  );
}

/** Samme besked som ikon i tabellens raekke (een linje); ordene i title og for skaermlaeseren. */
export function HardRiskIcon() {
  const { t: tR5 } = useTranslation("trainingR5");
  const text = tR5("effortPicker.riskGeneric");
  return (
    <span className="inline-flex shrink-0 text-cz-warning" title={text} data-testid="r5-hard-risk">
      <AlertTriangleIcon size={13} aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </span>
  );
}
