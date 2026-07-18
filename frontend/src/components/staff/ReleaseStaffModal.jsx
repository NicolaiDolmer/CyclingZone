// #2649 — bekræftelses-dialog for "Release staff" (staff-profil + -oversigt).
// Ejer-godkendt mockup 18/7: titel "Release [navn]?", brødtekst om øjeblikkelig
// ansættelses-slut + severance, en tre-rækkers opsummering (severance som minus/
// rød, ugentlig løn frigjort som plus/grøn, rolle-slot åbnes med det samme), og
// knapperne "Keep him/her" (neutral) / "Release for $X" (rød, primær).
// Spejler AcademyTransferConfirmModal.jsx's struktur (overlay + cz-card-panel +
// useModalA11y + editorial dl-tabel) — INGEN slop (ingen glow/gradient/emoji).
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import { staffWeeklyWage, staffReleaseSeverance, STAFF_RELEASE_SEVERANCE_WEEKS } from "../../lib/staffSeverance.js";

export default function ReleaseStaffModal({
  show,
  staffName,
  role,       // fx "training" — bruges til rolle-slot-rækken + t("roles.<role>")
  salary,     // sæson-løn — severance/ugentlig løn afledes herfra (samme formel som backend)
  error,      // fejlbesked (fx utilstrækkelige midler) — vises i stedet for handling
  busy = false,
  onCancel,
  onConfirm,
}) {
  const { t } = useTranslation("staff");
  const dialogRef = useModalA11y(busy ? null : onCancel, Boolean(show));
  if (!show) return null;

  const weeklyWage = staffWeeklyWage(salary);
  const severance = staffReleaseSeverance(salary);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 max-w-sm w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-staff-title"
      >
        <h2 id="release-staff-title" className="font-display uppercase text-lg text-cz-1 mb-2">
          {t("release.title", { name: staffName })}
        </h2>
        <p className="text-cz-2 text-sm mb-4">{t("release.body")}</p>

        <dl className="text-sm border border-cz-border rounded-lg divide-y divide-cz-border mb-4 text-left">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">{t("release.severanceLabel", { multiplier: STAFF_RELEASE_SEVERANCE_WEEKS, weeklyWage: formatNumber(weeklyWage) })}</dt>
            <dd className="font-mono font-bold text-cz-danger">−{formatNumber(severance)} CZ$</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">{t("release.wagesFreedLabel")}</dt>
            <dd className="font-mono font-bold text-cz-success">+{formatNumber(weeklyWage)} CZ$</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">{t("release.slotLabel", { role: t(`roles.${role}`) })}</dt>
            <dd className="font-mono text-cz-1">{t("release.slotValue")}</dd>
          </div>
        </dl>

        {error && (
          <p className="text-cz-danger text-xs mb-4" role="alert">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold
              bg-cz-subtle text-cz-2 border border-cz-border hover:text-cz-1 transition-colors disabled:opacity-50"
          >
            {t("release.keepButton")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold bg-cz-danger text-white
              hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? t("release.confirmBusy") : t("release.confirmButton", { amount: formatNumber(severance) })}
          </button>
        </div>
      </div>
    </div>
  );
}
