// Konsekvens-bevidst bekræftelse for akademi op/ned (#932 S7). Én dialog dækker
// begge retninger via direction='promote'|'demote':
//   • promote (op): akademi → senior. Viser cap-effekt (senior-trup nu → efter)
//     + ny senior-løn. Accent = guld (cz-accent).
//   • demote (ned): senior → akademi. Viser ny ungdomsløn (delta fra nuværende)
//     + akademi-cap-effekt + antal fremtidige løb der ryddes. Accent = amber
//     (cz-warning).
// Spejler AcademySignConfirmModal: overlay + cz-card-panel + useModalA11y +
// editorial dl-tabel. INGEN slop (ingen glow/gradient/emoji-ikon).
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { useModalA11y } from "../hooks/useModalA11y.js";

export function AcademyTransferConfirmModal({
  show,
  direction,            // 'promote' | 'demote'
  riderName,
  newSalary,            // promote: frossen senior-løn; demote: ungdomsløn. null = stadig indlæses.
  currentSalary = null, // vises som delta (demote)
  capLabel = null,      // "12 / 30" → "13 / 30" (promote: senior-cap; demote: akademi 3/8)
  capAfterLabel = null,
  racesCleared = null,  // demote: antal KOMMENDE løb der ryddes (entries slettes; kan være 0/null)
  racesOngoing = null,  // #3805: demote: antal IGANGVÆRENDE løb rytteren falder ud af (entry
                         // bevares, men rytteren er ikke længere løbsberettiget — kan være 0/null)
  keepsContract = false, // promote: rytteren har allerede en kontrakt (#3620)
  onCancel,
  onConfirm,
  busy = false,
}) {
  const { t } = useTranslation(["academy", "common"]);
  const dialogRef = useModalA11y(busy ? null : onCancel, show);
  if (!show) return null;

  const isPromote = direction === "promote";
  // Statiske klasser (Tailwind kan ikke se interpolerede klassenavne). Promote =
  // guld (cz-accent), demote = amber (cz-warning).
  const accentText = isPromote ? "text-cz-accent-t" : "text-cz-warning";
  const titleKey = isPromote ? "transferModal.promoteTitle" : "transferModal.demoteTitle";
  const questionKey = isPromote ? "transferModal.promoteQuestion" : "transferModal.demoteQuestion";
  const confirmKey = isPromote ? "transferModal.promoteConfirm" : "transferModal.demoteConfirm";

  // #3784: newSalary er null mens quoten (backend academy-demote-quote) stadig
  // hentes — vis "..." i stedet for et forkert 0/NaN-tal, og lås bekræft-knappen
  // så spilleren ikke kan bekræfte på et tal der endnu ikke er beregnet.
  const salaryLoading = newSalary == null;
  const newSalaryNum = Number(newSalary);
  const curSalaryNum = currentSalary != null ? Number(currentSalary) : null;
  const hasSalaryDelta = curSalaryNum != null && Number.isFinite(newSalaryNum);
  const racesNum = Number(racesCleared);
  const showRaces = !isPromote && Number.isFinite(racesNum) && racesNum > 0;
  const ongoingNum = Number(racesOngoing);
  const showOngoing = !isPromote && Number.isFinite(ongoingNum) && ongoingNum > 0;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 bg-cz-card border border-cz-border rounded-cz p-6 text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "academyTransferScaleIn 0.2s ease-out" }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="academy-transfer-title"
      >
        <h2 id="academy-transfer-title" className={`font-bold text-lg mb-2 ${accentText}`}>
          {t(`academy:${titleKey}`)}
        </h2>
        <p className="text-cz-2 text-sm mb-4">
          {t(`academy:${questionKey}`)}{" "}
          {riderName ? <span className="font-bold text-cz-1">{riderName}</span> : null}?
        </p>

        <dl className="text-sm border border-cz-border rounded-lg divide-y divide-cz-border mb-5 text-left">
          {/* Ny løn (begge retninger). Demote viser delta fra nuværende. */}
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-cz-3">
              {isPromote ? t("academy:transferModal.seniorSalaryLabel") : t("academy:transferModal.youthSalaryLabel")}
            </dt>
            <dd className="font-mono font-bold text-cz-1">
              {salaryLoading ? "..." : `${formatNumber(newSalaryNum)} CZ$`}
            </dd>
          </div>
          {hasSalaryDelta && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:transferModal.currentSalaryLabel")}</dt>
              <dd className="font-mono text-cz-2">{formatNumber(curSalaryNum)} CZ$</dd>
            </div>
          )}
          {/* Cap-effekt (nu → efter). */}
          {capLabel != null && capAfterLabel != null && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">
                {isPromote ? t("academy:transferModal.seniorCapLabel") : t("academy:transferModal.academyCapLabel")}
              </dt>
              <dd className="font-mono text-cz-2">
                {capLabel} <span className="text-cz-3" aria-hidden="true">&rarr;</span>{" "}
                <span className={`font-bold ${accentText}`}>{capAfterLabel}</span>
              </dd>
            </div>
          )}
          {/* Demote: kommende løb der ryddes (entries slettet). */}
          {showRaces && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:transferModal.racesClearedLabel")}</dt>
              <dd className="font-mono font-bold text-cz-warning">{formatNumber(racesNum)}</dd>
            </div>
          )}
          {/* #3805: demote — igangværende løb rytteren falder ud af. Entry'en
              slettes IKKE (resultat-/snapshot-invarians), men rytteren er ikke
              længere løbsberettiget som akademi-rytter, så han udgår reelt af
              feltet. Dialogen skal sige det i stedet for kun at nævne
              "kommende løb ryddet" (som er 0 for netop denne sag — #3805). */}
          {showOngoing && (
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-cz-3">{t("academy:transferModal.racesOngoingLabel")}</dt>
              <dd className="font-mono font-bold text-cz-danger">{formatNumber(ongoingNum)}</dd>
            </div>
          )}
        </dl>

        {/* Konsekvens-note pr. retning. Promote har to sandheder efter #3620:
            har rytteren allerede en kontrakt, regenereres den IKKE, så lønnen
            bliver hverken erstattet eller genberegnet. #3805: demote har nu to
            sandheder også — er rytteren midt i et løb, må teksten sige at han
            udgår af DET løb (ikke kun "kommende løb"), ellers underrapporterer
            den præcis som den bug der blev rapporteret. */}
        <p className="text-cz-3 text-xs mb-4">
          {!isPromote
            ? (showOngoing ? t("academy:transferModal.demoteNoteOngoing") : t("academy:transferModal.demoteNote"))
            : keepsContract
              ? t("academy:transferModal.promoteNoteKeepsContract")
              : t("academy:transferModal.promoteNote")}
        </p>

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
            disabled={busy || salaryLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-cz-on-accent transition-all
              disabled:opacity-60 disabled:cursor-not-allowed
              ${isPromote ? "bg-cz-accent hover:brightness-110" : "bg-cz-warning hover:brightness-110"}`}
          >
            {busy || salaryLoading ? t("common:actions.loadingShort") : t(`academy:${confirmKey}`)}
          </button>
        </div>
        <style>{`
          @keyframes academyTransferScaleIn {
            from { transform: scale(0.9); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
