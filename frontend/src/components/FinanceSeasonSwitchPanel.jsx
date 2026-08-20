import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { useTableSort } from "../lib/useTableSort.js";
import SortableTh from "./ui/SortableTh.jsx";
import { Card, Button } from "./ui";

// #4011 (design-go 20/8, punkt C) — sæsonskifte-afregningen. Ny sektion på
// Finance-siden: kvitterings-flow (books close → sponsor base → upkeep →
// stab/faciliteter → akademi → "løn skifter regelsæt, ingen opkrævning" →
// slutbalance) + løn-tabel pr. rytter (nuværende kontrakt vs. S3-prognose).
//
// Data kommer FÆRDIGBEREGNET fra GET /api/finance/season-switch-preview
// (backend/lib/seasonSwitchPreview.js) — denne komponent er ren visning,
// ingen økonomi-logik. S3-lønprognosen er computeFrozenSalary 1:1, samme
// funktion salaryRecompute3645.mjs (cutover-værktøjet) kalder.

function formatSigned(value) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(value))} CZ$`;
}

const RIDER_SORT_ACCESSORS = {
  name: (r) => `${r.lastname || ""} ${r.firstname || ""}`.trim(),
  contract: (r) => r.contract_salary,
  projection: (r) => r.s3_salary_projection,
  delta: (r) => r.delta,
};

// Uden "Vis alle" ville et D2-hold med 25+ ryttere åbne panelet med en skærm-
// fyldende tabel. Standard-visningen sorterer efter |delta| og viser de mest
// betydende linjer først — samme "de 10 største ændringer"-princip som
// salaryRecompute3645.mjs's rapport bruger til at fremhæve toppen.
const COLLAPSED_ROW_COUNT = 8;

function SettlementStep({ step, t, isLast, seasonParams }) {
  const isInfoOnly = step.amount === null;
  const isZero = step.amount === 0;
  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${isLast ? "" : "border-b border-cz-border"}`}>
      <div className="min-w-0 pr-3">
        <p className={`text-xs ${isLast ? "text-cz-1 font-semibold" : "text-cz-2"}`}>
          {t(`seasonSwitch.receipt.step.${step.key}.label`, seasonParams)}
        </p>
        <p className="text-cz-3 text-2xs mt-0.5 leading-snug">
          {t(`seasonSwitch.receipt.step.${step.key}.detail`, seasonParams)}
        </p>
      </div>
      <div className="text-end flex-shrink-0">
        {!isInfoOnly && (
          <p className={`font-mono text-sm font-bold tabular-nums ${
            isZero ? "text-cz-3" : step.amount > 0 ? "text-cz-success" : "text-cz-danger"
          }`}>
            {isZero ? t("seasonSwitch.receipt.noCharge") : formatSigned(step.amount)}
          </p>
        )}
        <p className={`font-mono tabular-nums mt-0.5 ${isLast ? "text-cz-1 font-bold text-base" : "text-cz-3 text-2xs"}`}>
          {isLast
            ? `${formatNumber(step.balance_after)} CZ$`
            : t("seasonSwitch.receipt.balanceAfter", { value: formatNumber(step.balance_after) })}
        </p>
      </div>
    </div>
  );
}

export default function FinanceSeasonSwitchPanel({ data, loading }) {
  const { t } = useTranslation("finance");
  const [showAllRiders, setShowAllRiders] = useState(false);

  const rows = data?.riders?.rows ?? [];
  const { rows: sortedRows, sort, sortDir, handleSort } = useTableSort(rows, RIDER_SORT_ACCESSORS, {
    initialSort: "delta",
    initialDir: "desc",
  });
  const displayRows = showAllRiders
    ? sortedRows
    : rows.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, COLLAPSED_ROW_COUNT);

  if (loading) {
    return (
      <Card className="p-5 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          <p className="text-cz-3 text-sm">{t("seasonSwitch.loading")}</p>
        </div>
      </Card>
    );
  }
  if (!data) return null;

  const nextSeason = data.season?.next_number ?? "?";
  const currentSeason = data.season?.current_number ?? "?";
  const summary = data.riders?.summary;
  const seasonParams = { current: currentSeason, next: nextSeason };

  return (
    <>
      <Card className="p-5 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm">{t("seasonSwitch.receipt.title", { current: currentSeason, next: nextSeason })}</h2>
        <p className="text-cz-3 text-xs mt-0.5 mb-3">{t("seasonSwitch.receipt.subtitle", seasonParams)}</p>
        <div className="flex flex-col">
          {(data.settlement?.steps ?? []).map((step, idx, arr) => (
            <SettlementStep key={step.key} step={step} t={t} isLast={idx === arr.length - 1} seasonParams={seasonParams} />
          ))}
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-cz-1 font-semibold text-sm">{t("seasonSwitch.salaryTable.title")}</h2>
            <p className="text-cz-3 text-xs mt-0.5">{t("seasonSwitch.salaryTable.subtitle", { next: nextSeason })}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-cz-3 text-sm mt-3">{t("seasonSwitch.salaryTable.empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto mt-3">
              <table data-sortable className="w-full text-xs">
                <thead>
                  <tr className="border-b border-cz-border">
                    <SortableTh sortKey="name" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-2 text-start">{t("seasonSwitch.salaryTable.header.rider")}</SortableTh>
                    <SortableTh sortKey="contract" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-2 text-end">{t("seasonSwitch.salaryTable.header.contract", { current: currentSeason })}</SortableTh>
                    <SortableTh sortKey="projection" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-2 text-end">{t("seasonSwitch.salaryTable.header.projection", { next: nextSeason })}</SortableTh>
                    <SortableTh sortKey="delta" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-2 text-end">{t("seasonSwitch.salaryTable.header.delta")}</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r) => (
                    <tr key={r.id} className="border-b border-cz-border last:border-0">
                      <td className="px-3 py-2 text-cz-2 font-medium max-w-0 w-full truncate">
                        {r.firstname} {r.lastname}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-cz-2">
                        {formatNumber(r.contract_salary)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-cz-2">
                        {formatNumber(r.s3_salary_projection)}
                      </td>
                      <td className={`px-3 py-2 text-end font-mono font-bold tabular-nums ${r.delta >= 0 ? "text-cz-danger" : "text-cz-success"}`}>
                        {formatSigned(r.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {summary && (
                  <tfoot>
                    <tr className="border-t-2 border-cz-border font-semibold">
                      <td className="px-3 py-2 text-cz-1">{t("seasonSwitch.salaryTable.total")}</td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-cz-1">
                        {formatNumber(summary.total_contract_salary)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-cz-1">
                        {formatNumber(summary.total_s3_salary_projection)}
                      </td>
                      <td className={`px-3 py-2 text-end font-mono tabular-nums ${summary.total_delta >= 0 ? "text-cz-danger" : "text-cz-success"}`}>
                        {formatSigned(summary.total_delta)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {rows.length > COLLAPSED_ROW_COUNT && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => setShowAllRiders((v) => !v)}>
                  {showAllRiders
                    ? t("seasonSwitch.salaryTable.showLess")
                    : t("seasonSwitch.salaryTable.viewAll", { count: rows.length })}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
