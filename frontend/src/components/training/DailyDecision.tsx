// DailyDecision - "Dagens beslutning" oeverst paa Today-fanen (#6110 S26, ejer-valgt
// retning A). Et kort der svarer paa "hvad skal jeg goere i dag?": 1-3 forslag
// med grund og en Use-knap pr. forslag. Use-knapperne er secondary (sidens ene
// guld-knap er "Train now"); "Use all" er en stille tekstknap.
// Intet at goere = en enkelt linje, saa kortet ikke fylder over folden.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import RiderLink from "../RiderLink.jsx";
import Button from "../ui/Button.jsx";
import { AlertTriangleIcon, CheckIcon } from "../ui/icons/index.jsx";
import { formatNumber } from "../../lib/intl.js";
import type { DecisionSuggestion } from "./DailyDecisionModel.ts";

export type DecisionRow = DecisionSuggestion & { name: string };

export default function DailyDecision({
  rows,
  onUse,
  compact = false,
}: {
  rows: DecisionRow[];
  // Skriver rytterens dag via den eksisterende hurtig-skift-sti. Returnerer naar gemt.
  onUse: (row: DecisionRow) => Promise<unknown> | unknown;
  compact?: boolean;
}) {
  const { t } = useTranslation("training");
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  async function use(list: DecisionRow[]) {
    setBusy((prev) => new Set([...prev, ...list.map((r) => r.riderId)]));
    try {
      for (const row of list) await onUse(row);
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        for (const row of list) next.delete(row.riderId);
        return next;
      });
    }
  }

  return (
    <section
      data-testid="daily-decision"
      aria-label={t("decision.title")}
      className="rounded-cz border border-cz-border bg-cz-card"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <h2 className="font-data text-[15px] font-semibold text-cz-1">{t("decision.title")}</h2>
        {rows.length > 1 && (
          <button
            type="button"
            data-testid="daily-decision-use-all"
            disabled={busy.size > 0}
            onClick={() => use(rows)}
            className="min-h-8 text-xs font-semibold text-cz-accent-t transition-colors hover:underline disabled:opacity-50"
          >
            {t("decision.useAll", { n: rows.length })}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-3 pt-1.5 text-xs text-cz-2" data-testid="daily-decision-none">
          <CheckIcon size={14} className="flex-none text-cz-3" aria-hidden="true" />
          {t("decision.none")}
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-cz-border">
          {rows.map((row) => (
            <li key={row.riderId} data-testid="daily-decision-row" className="flex items-center gap-3 px-4 py-2.5">
              <AlertTriangleIcon size={16} className="flex-none text-cz-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-semibold text-cz-1 ${compact ? "" : "truncate"}`}>
                  <RiderLink id={row.riderId} className="hover:text-cz-accent-t">{row.name}</RiderLink>
                  <span className="font-normal text-cz-2">{`: ${t("decision.recovery")}`}</span>
                </div>
                <div className={`text-2xs text-cz-3 ${compact ? "" : "truncate"}`}>
                  {t("decision.reason", { fatigue: formatNumber(Math.round(row.fatigue)) })}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="daily-decision-use"
                aria-label={t("decision.useAria", { name: row.name })}
                loading={busy.has(row.riderId)}
                disabled={busy.size > 0}
                onClick={() => use([row])}
                className="min-h-8 flex-none"
              >
                {t("decision.use")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
