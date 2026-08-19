// #3733 trin 1 (LÅST design 17/8 + 18/8) — korrektions-kvitteringen.
//
// Viser ALTID begge drivere på hver sin linje (Development + Market,
// design-lås 18/8 punkt 1). Denne komponent dækker KUN den globale
// niveau-korrektion (headline-type 2 fra 17/8-kommentaren); den fulde
// per-rytter Z-vægtede markedslinje (headline-type 3) er trin 2, bygges
// sammen med markedsmodellens egen Z-sweep hvis/når den består sin gate
// (ikke bygget endnu, se #3750). Development-linjen er derfor bevidst
// neutral boilerplate her — der findes ingen ugentlig udviklings-attribution
// at vise før trin 2.
//
// Ingen kvittering når intet er flyttet: `receipt` er null indtil
// niveau-korrektionen faktisk har kørt for DENNE rytter (se
// GET /api/riders/:id/level-correction-receipt) — komponenten returnerer da
// null, ingen tom boks.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, formatDate } from "../../lib/intl.js";

export default function RiderLevelCorrectionReceipt({ receipt, className = "" }) {
  const { t } = useTranslation("rider");
  const [expanded, setExpanded] = useState(false);

  if (!receipt) return null;

  const factorText = Number.isFinite(receipt.c) ? receipt.c.toFixed(3) : "—";

  return (
    <div
      className={`bg-cz-subtle border border-cz-border rounded-cz px-3 py-2.5 text-xs space-y-1 ${className}`}
      data-testid="rider-level-correction-receipt"
    >
      <p className="text-cz-2">{t("profile.levelCorrectionReceipt.developmentLine")}</p>
      <p className="text-cz-1 font-medium">{t("profile.levelCorrectionReceipt.marketLine")}</p>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-cz-accent-t text-2xs font-medium hover:underline mt-1"
      >
        {t(expanded ? "profile.levelCorrectionReceipt.detailsHide" : "profile.levelCorrectionReceipt.detailsToggle")}
      </button>

      {expanded && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs pt-1 border-t border-cz-border mt-1">
          <dt className="text-cz-3">{t("profile.levelCorrectionReceipt.anchorBefore")}</dt>
          <dd className="text-cz-1 font-mono text-right">{formatNumber(receipt.old_value)}</dd>
          <dt className="text-cz-3">{t("profile.levelCorrectionReceipt.anchorAfter")}</dt>
          <dd className="text-cz-1 font-mono text-right">{formatNumber(receipt.new_value)}</dd>
          <dt className="text-cz-3">{t("profile.levelCorrectionReceipt.factor")}</dt>
          <dd className="text-cz-1 font-mono text-right">{factorText}</dd>
          {receipt.applied_at && (
            <>
              <dt className="text-cz-3 col-span-2">{t("profile.levelCorrectionReceipt.appliedAt", { date: formatDate(receipt.applied_at) })}</dt>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
