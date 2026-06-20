// ScoutablePotentiale — progression L1 (#1138) + server-side skjuling (#1162).
//
// Viser en rytters potentiale som et SCOUTET estimat (stjerne-range + kvalitativ
// label), plus en valgfri scout-knap der bruger ét slot og indsnævrer estimatet.
//
// #1162: Estimatet beregnes på SERVEREN (POST /api/scouting/estimates) — den rå
// riders.potentiale findes ikke i klienten. Egne ryttere + fuldt scoutede får et
// eksakt estimat (lo == hi) og vises som eksakte stjerner + kvalitativ tekst.
// #1242 (ejer-beslutning dokumenteret her): egne ryttere viser SAMME kvalitative
// præsentation som andres — aldrig et råt tal. Stjernerne (0,5-trin) ER den
// fulde indsigt; potentiale-skalaen er ikke spillervendt som tal.
// #1543: en ikke-egen rytter der ikke er scoutet (level 0) returnerer serveren nu
// { hidden: true } — INTET potentiale vises (intet gratis lo–hi-spænd) før et
// scout-slot er brugt. Scout-knappen vises stadig, så spilleren kan afdække det.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import PotentialeStars from "../PotentialeStars";
import { SearchIcon } from "../ui";
import { potentialLabelKey } from "../../lib/scouting";

export default function ScoutablePotentiale({ rider, scouting, showScout = false, large = false }) {
  const { t } = useTranslation();
  const { maxLevel, scout, scoutingId, slots, requestEstimates, estimateFor } = scouting;

  const riderId = rider?.id;
  useEffect(() => {
    if (riderId) requestEstimates([riderId]);
  }, [riderId, requestEstimates]);

  const estimate = estimateFor(riderId);

  // undefined = ikke hentet endnu, null = rytter uden potentiale → begge "—".
  if (estimate == null) {
    return <PotentialeStars value={null} />;
  }

  // #1543: skjult, uscoutet rytter (level 0, ikke egen) → vis ALDRIG et estimat.
  // Stjerner og kvalitativ label hentes ikke for et hidden-estimat (intet midtpunkt
  // findes); kun en neutral "ikke scoutet"-markør + den valgfrie scout-knap.
  const hidden = estimate.hidden === true;

  const level = estimate.level ?? 0;
  const remaining = slots?.remaining ?? 0;
  const busy = scoutingId === riderId;
  const canScout = remaining > 0 && level < maxLevel && !busy;

  const handleScout = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (canScout) scout(riderId);
  };

  const scoutButton = showScout && (
    <button
      type="button"
      onClick={handleScout}
      disabled={!canScout}
      title={remaining <= 0 ? t("rider:scouting.noSlots") : t("rider:scouting.scoutTitle")}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-cz border border-cz-border text-cz-2 hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
    >
      {busy ? (
        t("rider:scouting.scouting")
      ) : (
        <>
          <SearchIcon size={11} aria-hidden="true" className="flex-shrink-0" />
          {level > 0 ? t("rider:scouting.rescout") : t("rider:scouting.scout")}
        </>
      )}
      {slots && <span className="ms-1 text-cz-3">{slots.remaining}/{slots.total}</span>}
    </button>
  );

  if (hidden) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <span className="text-cz-3 text-xs whitespace-nowrap" title={t("rider:scouting.scoutToReveal")}>
          {t("rider:scouting.notScouted")}
        </span>
        {scoutButton}
      </span>
    );
  }

  const labelKey = potentialLabelKey(estimate);
  const label = labelKey ? t(`rider:scouting.label_${labelKey}`) : null;

  // Eksakt (egen rytter eller fuldt scoutet) → eksakte stjerner + kvalitativ
  // tekst. Ingen scout-knap (intet at indsnævre) og intet niveau-badge.
  if (estimate.exact || estimate.lo === estimate.hi) {
    return <PotentialeStars value={estimate.lo} label={label} birthdate={rider.birthdate} large={large} />;
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <PotentialeStars range={estimate} label={label} birthdate={rider.birthdate} large={large} />
      {level > 0 && (
        <span className="text-[10px] font-mono text-cz-3" title={t("rider:scouting.levelTitle")}>
          {level}/{maxLevel}
        </span>
      )}
      {scoutButton}
    </span>
  );
}
