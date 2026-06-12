// ConditionChips — kompakt form/træthed + skade-badge til rytterprofil-headeren.
//
// Vises for ALLE ryttere (condition er transparent per spildesign).
// form + fatigue er 0-100 heltal; injured_until er ISO-datostreng eller null.
// Manglende condition-rad = neutral defaults (form 50, fatigue 0, ingen skade-badge).

import { useTranslation } from "react-i18next";
import { injuryDaysLeft } from "../../lib/training.js";

// Farve-semantik: form høj = grøn, lav = rød. Træthed høj = rød, lav = grøn.
function formColor(form) {
  if (form >= 70) return "text-cz-success";
  if (form >= 40) return "text-cz-2";
  return "text-cz-danger";
}
function fatigueColor(fatigue) {
  if (fatigue >= 70) return "text-cz-danger";
  if (fatigue >= 40) return "text-cz-2";
  return "text-cz-success";
}

export default function ConditionChips({ condition }) {
  const { t } = useTranslation("rider");

  const form         = condition?.form         ?? 50;
  const fatigue      = condition?.fatigue      ?? 0;
  const injuredUntil = condition?.injured_until ?? null;
  const days         = injuryDaysLeft(injuredUntil);

  return (
    <div className="flex items-center gap-2 flex-wrap mt-2">
      {/* Form-chip */}
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-cz-subtle border border-cz-border ${formColor(form)}`}>
        <span className="text-cz-3 font-normal">{t("condition.form")}</span>
        <span className="font-mono font-bold">{form}</span>
      </span>

      {/* Træthed-chip */}
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-cz-subtle border border-cz-border ${fatigueColor(fatigue)}`}>
        <span className="text-cz-3 font-normal">{t("condition.fatigue")}</span>
        <span className="font-mono font-bold">{fatigue}</span>
      </span>

      {/* Skade-badge — vises kun hvis skadet */}
      {days > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-cz-danger-bg border border-cz-danger/30 text-cz-danger">
          {t("condition.injured", { days })}
        </span>
      )}
    </div>
  );
}
