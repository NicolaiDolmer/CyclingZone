// ScoutablePotentiale — progression L1 (#1138).
//
// Viser en rytters potentiale som et SCOUTET estimat (stjerne-range + kvalitativ
// label) i stedet for det eksakte tal, plus en valgfri scout-knap der bruger ét
// slot og indsnævrer estimatet. Egne ryttere + fuldt scoutede vises eksakt.
//
// Estimatet beregnes lokalt (display-lag v1) ud fra (sand potentiale + scout-
// niveau + per-manager seed) — se frontend/src/lib/scouting.js.

import { useTranslation } from "react-i18next";
import PotentialeStars from "../PotentialeStars";
import { estimatePotentialRange, potentialLabelKey } from "../../lib/scouting";

const CURRENT_YEAR = new Date().getFullYear();

export default function ScoutablePotentiale({ rider, scouting, showScout = false, large = false }) {
  const { t } = useTranslation();
  const { teamId, maxLevel, levelFor, scout, scoutingId, slots } = scouting;

  if (rider?.potentiale == null) {
    return <PotentialeStars value={null} />;
  }

  const age = rider.birthdate ? CURRENT_YEAR - new Date(rider.birthdate).getFullYear() : null;
  const riderTeamId = rider.team_id ?? rider.team?.id ?? null;
  const isOwn = riderTeamId && teamId && riderTeamId === teamId;
  const level = levelFor(rider.id);

  // Egne ryttere + fuldt scoutede → eksakt visning (klassisk).
  if (isOwn || level >= maxLevel) {
    return <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} large={large} showValue={isOwn} />;
  }

  const range = estimatePotentialRange(rider.potentiale, level, age, rider.id, teamId, maxLevel);
  if (!range) {
    return <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} large={large} />;
  }
  const labelKey = potentialLabelKey(range);
  const label = labelKey ? t(`rider:scouting.label_${labelKey}`) : null;

  const remaining = slots?.remaining ?? 0;
  const busy = scoutingId === rider.id;
  const canScout = remaining > 0 && level < maxLevel && !busy;

  const handleScout = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (canScout) scout(rider.id);
  };

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <PotentialeStars range={range} label={label} birthdate={rider.birthdate} large={large} />
      {level > 0 && (
        <span className="text-[10px] font-mono text-cz-3" title={t("rider:scouting.levelTitle")}>
          {level}/{maxLevel}
        </span>
      )}
      {showScout && (
        <button
          type="button"
          onClick={handleScout}
          disabled={!canScout}
          title={remaining <= 0 ? t("rider:scouting.noSlots") : t("rider:scouting.scoutTitle")}
          className="text-[11px] px-2 py-0.5 rounded border border-cz-border text-cz-2 hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {busy
            ? t("rider:scouting.scouting")
            : `🔍 ${level > 0 ? t("rider:scouting.rescout") : t("rider:scouting.scout")}`}
          {slots && <span className="ms-1 text-cz-3">{slots.remaining}/{slots.total}</span>}
        </button>
      )}
    </span>
  );
}
