// SeasonOverview — truppens "This season" oeverst i fanen Development (#6025).
//
// Ejer-valg A 1/10: Today handler kun om i dag. Saesonens fremgang (pointene og
// kvitteringen pr. evne i fokusset) flyttes fra Today-tabellen hertil som et
// trup-overblik. Ingen ny formel: tallene er de samme som rytterens kort og den
// gamle kolonne viste (seasonPointsFor + focusAbilityReceipt i TrainingPage),
// og hver evne-linje er den samme AbilityReceiptRow.
//
// TASTE: hairline, ingen skygge, 5px radius (Card), tabular figures, ingen ikoner.

import { useTranslation } from "react-i18next";
import Card from "../ui/Card.jsx";
import AbilityReceiptRow from "./AbilityReceiptRow.jsx";

export default function SeasonOverview({ rows, note = null }) {
  const { t } = useTranslation("training");
  if (!rows?.length) return null;
  return (
    <Card className="mb-3 p-0 overflow-hidden" data-testid="training-season-overview">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-cz-border px-4 py-2.5 sm:px-5">
        <h2 className="font-data text-2xs font-semibold uppercase tracking-[.09em] text-cz-2">{t("receipt.title")}</h2>
        <p className="text-2xs text-cz-3">{note ?? t("receipt.note")}</p>
      </div>
      <div className="divide-y divide-cz-border">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5"
            data-testid="training-season-overview-row"
          >
            <div className="min-w-[160px] flex-1 sm:max-w-[240px]">
              <div className="text-[13.5px] font-medium text-cz-1">{row.name}</div>
              {row.sub ? (
                <div className="mt-0.5 font-data text-3xs uppercase tracking-[.05em] text-cz-3">{row.sub}</div>
              ) : null}
            </div>
            <div className="w-16 flex-none text-right" title={t("today.colSeasonPoints")}>
              <span className="font-data text-[13px] tabular-nums text-cz-1">
                {row.seasonPoints != null ? `+${row.seasonPoints}` : <span className="text-cz-3">—</span>}
              </span>
            </div>
            <div className="min-w-[220px] flex-[2] max-w-[460px]">
              {row.receipt?.length ? (
                row.receipt.map((r) => <AbilityReceiptRow key={r.ability} row={r} inFocus />)
              ) : (
                <span className="text-xs text-cz-3">{t("noFocus")}</span>
              )}
              {row.gainedToday > 0 && (
                <span className="mt-0.5 inline-block rounded-cz-pill border border-cz-success/30 bg-cz-success-bg px-1.5 py-0.5 text-3xs text-cz-success">
                  {t("gainedToday", { count: row.gainedToday })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
