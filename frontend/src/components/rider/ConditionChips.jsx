// ConditionChips — kompakt form/træthed + skade-badge til rytterprofil-headeren.
//
// Vises for ALLE ryttere (condition er transparent per spildesign).
// form + fatigue er 0-100 heltal; injured_until er ISO-datostreng eller null.
// Manglende condition-rad = neutral defaults (form 50, fatigue 0, ingen skade-badge).

import { useTranslation } from "react-i18next";
import { injuryTimeLeft } from "../../lib/training.js";
import { formatDate } from "../../lib/intl.js";

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
  // #5462: loebsdage naar backenden har skrevet dem, ellers kalenderdage som foer.
  // Chippen er lille, saa datoen bor i title'en — "ca." staar dér, ikke i badget.
  // Title'en gates paa unit === "race_day" praecis som de tre traenings-flader:
  // approxDate er sat i BEGGE grene, men paa kalenderdags-stien (flag off) er
  // injured_until en PRAECIS slutdato, saa "ca."-teksten ville baade vaere ny,
  // ugated UI og faktuelt forkert for alle skadede ryttere i dagens tilstand.
  const injury       = injuryTimeLeft(condition);
  const days         = injury.count;

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
        <span
          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-cz-danger-bg border border-cz-danger/30 text-cz-danger"
          title={injury.unit === "race_day" && injury.approxDate
            ? t("condition.injuredApprox", { date: formatDate(injury.approxDate, "medium") })
            : undefined}
        >
          {injury.unit === "race_day"
            ? t("condition.injuredRaceDays", { days })
            : t("condition.injured", { days })}
        </span>
      )}
    </div>
  );
}
