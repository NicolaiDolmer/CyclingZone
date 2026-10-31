// ConditionChips — skadechippen paa rytterprofilen + farve-semantikken for form/traethed.
//
// #7412: chippen FORKLARER skaden. Foer stod der kun "Injured: N days left" (og i S5 slet
// ikke loebsdage, fordi aksen manglede). Nu: aarsag og sted ("Crashed, <loeb> stage N",
// "Injured in training", "Ill") og foerste raske dag ("Fit again <dato>") i stedet for den
// sidste skadede dato, som spillerne laeste som raskmeldingen.
//
// Den tidligere default-komponent (form/traethed-chips) blev ikke renderet nogen steder;
// profilens FormCard (RiderTrainingTab.jsx) tegner selv form og traethed og bruger denne chip.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { injuryTimeLeft } from "../../lib/training.js";
import { formatDate } from "../../lib/intl.js";
import { injuryFitAgainDate, injuryCauseMessage } from "../../lib/injuryExplain.js";
import { supabase } from "../../lib/supabase";

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

// Det seneste SKADENDE styrt (race_incidents er offentlig loebsinformation, RLS: alle
// authenticated, idx_race_incidents_rider_id). Kun naar skaden ER et styrt; en fejl giver
// "Crashed in a race" uden sted, aldrig et opfundet loeb.
function useCrashOrigin(riderId, enabled) {
  const key = enabled && riderId ? riderId : null;
  const [result, setResult] = useState({ key: null, crash: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    supabase
      .from("race_incidents")
      .select("stage_number, created_at, race:race_id(name, stages)")
      .eq("rider_id", key)
      .eq("kind", "crash")
      .gt("injury_days", 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = error ? null : data?.[0] ?? null;
        setResult({ key, crash: row ? { race: row.race?.name ?? null, stage: row.stage_number ?? null, stages: row.race?.stages ?? null } : null });
      }, () => { if (!cancelled) setResult({ key, crash: null }); });
    return () => { cancelled = true; };
  }, [key]);
  // Et svar for en anden rytter (eller fra foer skaden blev et styrt) vises aldrig.
  return result.key === key ? result.crash : null;
}

/**
 * @param {{ riderId: string, condition: { injured_until?: string|null,
 *   injury_race_days_left?: number|null, injury_cause?: string|null }|null }} props
 */
export default function InjuryChip({ riderId, condition }) {
  const { t } = useTranslation("rider");
  // #5462: loebsdage naar backenden har skrevet dem, ellers kalenderdage som foer.
  const injury = injuryTimeLeft(condition);
  const days = injury.count;
  const cause = condition?.injury_cause ?? null;
  const crash = useCrashOrigin(riderId, days > 0 && cause === "race_crash");
  if (days <= 0) return null;

  const causeMessage = injuryCauseMessage(cause, crash);
  const fitAgain = injuryFitAgainDate(condition?.injured_until);
  const detail = [
    causeMessage ? t(causeMessage.key, causeMessage.params) : null,
    fitAgain ? t("condition.fitAgain", { date: formatDate(fitAgain, "medium") }) : null,
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
