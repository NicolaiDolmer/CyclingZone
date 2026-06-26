// Race Hub Fase 5 (#1835 / S6) — pulje-vælger til read-only browse. Genbruger
// standings-tier-farverne (divisionColors, #671 anti-drift). scope="division" låser
// til managerens egen tier; "others" viser alle tiers. Den valgte pulje landes via
// ?pool i URL'en (DivisionStartLists ejer state).
import { useTranslation } from "react-i18next";
import { divColor } from "../../lib/divisionColors.js";

export default function PoolPicker({ pools = [], selected, ownPoolId, lockTier = null, onSelect }) {
  const { t } = useTranslation("races");
  if (!pools.length) return null;
  const allTiers = [...new Set(pools.map((p) => p.tier))].sort((a, b) => a - b);
  const tiers = lockTier != null ? allTiers.filter((x) => x === lockTier) : allTiers;
  const selectedTier = selected?.tier ?? tiers[0];
  const tierPools = pools.filter((p) => p.tier === selectedTier).sort((a, b) => a.pool_index - b.pool_index);
  const poolLabel = (p) => p.label || t("browse.poolN", { n: p.pool_index + 1 });
  const selectTier = (tier) => {
    const first = pools.filter((p) => p.tier === tier).sort((a, b) => a.pool_index - b.pool_index)[0];
    if (first) onSelect(first.id);
  };

  return (
    <div className="mb-3">
      {tiers.length > 1 && (
        <div className="flex gap-1.5 mb-2 flex-wrap" role="tablist" aria-label={t("browse.divisionPicker")}>
          {tiers.map((tier) => {
            const active = tier === selectedTier;
            return (
              <button key={tier} type="button" onClick={() => selectTier(tier)} aria-selected={active}
                className={`px-3 py-1.5 rounded-cz text-xs font-medium border transition-colors ${active ? "text-cz-1" : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}
                style={active ? { backgroundColor: divColor(tier, 0.1), borderColor: divColor(tier, 0.3), color: divColor(tier) } : {}}>
                {t("browse.division", { n: tier })}
              </button>
            );
          })}
        </div>
      )}
      {tierPools.length > 1 && (
        <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label={t("browse.poolPicker")}>
          {tierPools.map((p) => {
            const active = selected?.id === p.id;
            const isOwn = ownPoolId != null && p.id === ownPoolId;
            return (
              <button key={p.id} type="button" onClick={() => onSelect(p.id)} aria-selected={active}
                className={`px-3 py-1.5 rounded-cz text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${active ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40" : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}>
                {poolLabel(p)}
                {isOwn && <span className="text-[9px] uppercase tracking-wide text-cz-accent-t">· {t("browse.you")}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
