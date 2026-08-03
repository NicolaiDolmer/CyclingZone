// #2464/#3191 — delt "X% under/over vurdering"-indikator: pris (bud eller
// udbudspris) mod rytterens estimerede markedsværdi (computeBidValueDelta,
// lib/marketValues.js). Oprindeligt kun på Auktioner (#2464, mod
// auction.current_price); løftet ud til en delt komponent og genbrugt på
// Transferlisten (#3191, mod listing.asking_price) — paritet mellem de to
// sider af samme marked.
//
// Ren præsentations-komponent: kalderen beregner selv `valueDelta` via
// computeBidValueDelta(price, rider) og sender resultatet ind (null → skjules).
// `ns` vælger hvilken i18n-namespace nøglerne (valueDelta.under/over/at/title)
// læses fra — begge namespaces bærer identisk ordlyd, samme mønster som andre
// delte tekster på tværs af auctions.json/transfers.json (fx "estSalary").
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";

const VALUE_DELTA_CLASS = {
  under: "text-cz-success",
  over: "text-cz-warning",
  at: "text-cz-3",
};

export default function ValueDeltaBadge({ valueDelta, ns = "auctions", as: Tag = "span", className = "" }) {
  const { t } = useTranslation(ns);
  if (!valueDelta) return null;

  return (
    <Tag
      className={`font-mono ${VALUE_DELTA_CLASS[valueDelta.direction] ?? VALUE_DELTA_CLASS.at} ${className}`}
      title={t("valueDelta.title", { amount: formatNumber(valueDelta.value) })}
      data-testid="value-delta-badge"
    >
      {t(`valueDelta.${valueDelta.direction}`, { pct: valueDelta.pct })}
    </Tag>
  );
}
