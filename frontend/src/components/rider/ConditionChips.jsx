// ConditionChips — skadechippen paa rytterprofilen + farve-semantikken for form/traethed.
//
// #7412: chippen FORKLARER skaden. Foer stod der kun "Injured: N days left" (og i S5 slet
// ikke loebsdage, fordi aksen manglede). Nu: aarsag og sted ("Crashed, <loeb> stage N",
// "Injured in training", "Ill") og foerste raske dag ("Fit again <dato>") i stedet for den
// sidste skadede dato, som spillerne laeste som raskmeldingen.
//
// Den tidligere default-komponent (form/traethed-chips) blev ikke renderet nogen steder;
// profilens FormCard (RiderTrainingTab.jsx) tegner selv form og traethed og bruger denne chip.
// Styrtets sted hentes af useCrashOrigin.ts i FormCard og gives ind som `crash`, saa denne
// fil forbliver ren (den importeres af node-testede komponenter for farverne).

import { useTranslation } from "react-i18next";
import { injuryTimeLeft } from "../../lib/training.js";
import { formatDate } from "../../lib/intl.js";
import { injuryFitAgainDate, injuryCauseMessage } from "../../lib/injuryExplain.ts";

// Farve-semantik: form høj = grøn, lav = rød. Træthed høj = rød, lav = grøn.
export function formColor(form) {
  if (form >= 70) return "text-cz-success";
  if (form >= 40) return "text-cz-2";
  return "text-cz-danger";
}
export function fatigueColor(fatigue) {
  if (fatigue >= 70) return "text-cz-danger";
  if (fatigue >= 40) return "text-cz-2";
  return "text-cz-success";
}

/**
 * @param {{ condition: { injured_until?: string|null, injury_race_days_left?: number|null,
 *   injury_cause?: string|null }|null,
 *   crash?: { race: string|null, stage: number|null, stages: number|null }|null }} props
 */
export default function InjuryChip({ condition, crash = null }) {
  const { t } = useTranslation("rider");
  // #5462: loebsdage naar backenden har skrevet dem, ellers kalenderdage som foer.
  const injury = injuryTimeLeft(condition);
  const days = injury.count;
  if (days <= 0) return null;

  const causeMessage = injuryCauseMessage(condition?.injury_cause ?? null, crash);
  const fitAgain = injuryFitAgainDate(condition?.injured_until);
  // Paa loebsdags-aksen er injured_until rundet OP til en dato med en etape, og motoren
  // raskmelder paa loebsdagen; han kan derfor vaere rask foer datoen, aldrig efter. "ca."
  const fitAgainKey = injury.unit === "race_day" ? "condition.fitAgainApprox" : "condition.fitAgain";
  const detail = [
    causeMessage ? t(causeMessage.key, causeMessage.params) : null,
    fitAgain ? t(fitAgainKey, { date: formatDate(fitAgain, "medium") }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <span className="inline-flex items-center text-2xs px-2.5 py-1 rounded-full bg-cz-danger-bg border border-cz-danger/25 text-cz-danger">
        {injury.unit === "race_day"
          ? t("condition.injuredRaceDays", { days })
          : t("condition.injured", { days })}
      </span>
      {detail && <span className="text-2xs text-cz-3">{detail}</span>}
    </>
  );
}
