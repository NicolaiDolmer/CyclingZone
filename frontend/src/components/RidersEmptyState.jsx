// Onboarding v2 Slice 1b — empty-state øverst på RidersPage for managers med 0 ryttere.
// Forklarer filter-panelet, viser budget vs. division-minimum og giver CTA der filtrerer
// listen til ryttere ≤ balance. Slice 4 (v2.19): sekundær "Vis mig rundt"-knap starter
// tour direkte for managers der lander her uden at gå via Dashboard.
// i18n: bruger `riders` namespace (Refs #487).

// #4628 (slice 6 af #4622): kortet baerer ikke laengere en guld-keyline (fork 3:
// keyline hoerer kun til T3-heroen), knapperne er kanoniske Button-varianter i
// stedet for haandrullet guld, og de tre tips staar i en rigtig punktliste i
// stedet for et "•"-tegn foran hver linje (TASTE P7: tekst-glyffer er ikke UI).
import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { BikeIcon, Button, Section } from "./ui";

export default function RidersEmptyState({ balance, onFilterByBudget, onStartTour }) {
  const { t } = useTranslation("riders");
  const balanceLabel = formatNumber(balance ?? 0);

  return (
    <Section className="mb-4">
      <div className="flex items-start gap-2 mb-3">
        <BikeIcon size={16} className="text-cz-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-cz-1 text-sm font-semibold">{t("emptyState.title")}</p>
          <p className="text-cz-2 text-xs mt-0.5">
            {t("emptyState.intro")}
          </p>
        </div>
      </div>

      <div className="mb-3">
        <div className="bg-cz-subtle rounded-cz px-3 py-2 border border-cz-border">
          <p className="text-cz-3 text-3xs uppercase tracking-wider">{t("emptyState.balance")}</p>
          <p className="text-cz-accent-t font-data tabular-nums font-bold text-sm mt-0.5">{balanceLabel} CZ$</p>
        </div>
      </div>

      <ul className="text-cz-2 text-xs space-y-1 mb-3 list-disc ps-4 marker:text-cz-3">
        {["emptyState.tipValue", "emptyState.tipStats", "emptyState.tipBudget"].map(key => (
          <li key={key}>
            <Trans
              i18nKey={key}
              ns="riders"
              components={{ strong: <span className="text-cz-1 font-medium" /> }}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="w-full sm:w-auto" onClick={onFilterByBudget}>
          {t("emptyState.ctaFindFirst", { balance: balanceLabel })}
        </Button>
        {onStartTour && (
          <Button variant="ghost" size="sm" onClick={onStartTour}>
            {t("emptyState.ctaTour")}
          </Button>
        )}
      </div>
    </Section>
  );
}
