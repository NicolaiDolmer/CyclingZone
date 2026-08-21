// Bekræft-dialog for akademi-fyring (#4009, ejer-ja 20/8). Viser buyout-gebyret
// som speed-bump FØR bekræftelse — samme princip som rytterprofilens/holdsidens
// senior-fyr-panel (#1719), bare som en fokuseret dialog i stedet for et inline
// panel, da akademi-rosteret er en tæt DataTable-række uden plads til et
// udvidet panel. Spejler AcademyTransferConfirmModal's struktur (overlay +
// cz-card-panel + useModalA11y + editorial dl-tabel), men danger-accent i
// stedet for guld/amber — fyring er destruktiv, ikke en oprykning.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { useModalA11y } from "../hooks/useModalA11y.js";

export function AcademyReleaseConfirmModal({
  show,
  riderName,
  fee = null,        // null = stadig indlæses
  balance = null,
  affordable = null, // false → knappen låses, samme mønster som manage.release
  onCancel,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["academy", "common"]);
  const dialogRef = useModalA11y(busy ? null : onCancel, show);
  if (!show) return null;

  const feeLoading = fee == null;
  const feeNum = Number(fee);
  const cannotAfford = affordable === false;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "academyReleaseScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="academy-release-title"
      >
        <h2 id="academy-release-title" className="font-bold text-lg mb-2 text-cz-danger">
          {t("academy:releaseModal.title")}
        </h2>
        <p className="text-cz-2 text-sm mb-4">
          {t("academy:releaseModal.question")}{" "}
          {riderName ? <span className="font-bold text-cz-1">{riderName}</span> : null}?
        </p>

        <dl className="text-sm border border-cz-border rounded-lg divide-y divide-cz-border mb-5 text-left">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">{t("academy:releaseModal.feeLabel")}</dt>
            <dd className="font-mono font-bold text-cz-danger">
              {feeLoading ? "..." : `${formatNumber(feeNum)} CZ$`}
            </dd>
          </div>
          {balance != null && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:releaseModal.balanceLabel")}</dt>
              <dd className="font-mono text-cz-2">{formatNumber(Number(balance))} CZ$</dd>
            </div>
          )}
        </dl>

        <p className="text-cz-3 text-xs mb-4">
          {!feeLoading && feeNum === 0 ? t("academy:releaseModal.freeHint") : t("academy:releaseModal.feeHint")}
        </p>
        {cannotAfford && (
          <p className="text-cz-danger text-xs mb-4">{t("academy:releaseModal.cannotAfford")}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || feeLoading || cannotAfford}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white transition-all
              disabled:opacity-60 disabled:cursor-not-allowed bg-cz-danger hover:brightness-110"
          >
            {busy || feeLoading ? t("common:actions.loadingShort") : t("academy:releaseModal.confirm")}
          </button>
        </div>
        <style>{`
          @keyframes academyReleaseScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
