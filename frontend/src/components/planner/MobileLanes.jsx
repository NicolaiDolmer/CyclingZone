// Season Planner — mobilt stakket spor (spec §5.3): master-brættet er 3-kolonne på
// desktop; på mobil bliver hver lane et kort man tapper for at åbne skuffen. En
// vandret løb-strip øverst giver adgang til race-fokus. Alt tap-mål ≥24px (a11y).
import { useTranslation } from "react-i18next";
import { riderOverallRating } from "../../lib/riderRating";
import { dateToOrdinal, formatOrdinalShort, statusMeta, riderTypeKey, riderShortName } from "./plannerShared";

export default function MobileLanes({ riders, races, filter, today, onSelectRace, onSelectRider }) {
  const { t } = useTranslation("planner");
  const months = t("months", { returnObjects: true });
  const nowOrd = dateToOrdinal(today);

  const visRaces = (races || [])
    .filter((r) => r.date && (filter === "all" || r.isMine))
    .map((r) => ({ ...r, ord: dateToOrdinal(r.date) }))
    .filter((r) => r.ord != null && (nowOrd == null || r.ord >= nowOrd - 3))
    .sort((a, b) => a.ord - b.ord)
    .slice(0, 30);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {visRaces.map((r) => (
          <button
            key={r.id}
            className="shrink-0 min-h-[44px] px-3 py-1.5 rounded-cz border border-cz-border bg-cz-card text-left hover:bg-cz-subtle"
            onClick={() => onSelectRace(r.id)}
          >
            <div className="text-[11px] text-cz-1 font-medium whitespace-nowrap">{r.name}</div>
            <div className="text-[9.5px] text-cz-2">{formatOrdinalShort(r.ord, months)} · {t(`terrain.${r.terrain}`)}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {(riders || []).map((rd) => {
          const ovr = riderOverallRating({ ...rd.abilities, primary_type: rd.primaryType });
          const typeKey = riderTypeKey(rd.primaryType);
          const used = (rd.peaks || []).length;
          const risky = (rd.peaks || []).some((p) => p.status === "at_risk");
          const chip = used ? statusMeta(risky ? "at_risk" : ((rd.peaks || []).some((p) => p.status === "on_track") ? "on_track" : "pending")) : null;
          return (
            <button
              key={rd.id}
              className="min-h-[44px] flex items-center gap-3 p-2.5 rounded-cz border border-cz-border bg-cz-card text-left hover:bg-cz-subtle"
              onClick={() => onSelectRider(rd.id)}
            >
              <span className="font-mono text-[10px] text-cz-2 w-7">{rd.nationality || "—"}</span>
              <span className="w-9 h-9 rounded-cz bg-cz-1 flex items-center justify-center shrink-0" style={{ background: "var(--text-1)" }}>
                <span className="font-mono text-[13px] font-medium" style={{ color: "rgb(var(--accent))" }}>{ovr}</span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-cz-1 font-medium truncate">{riderShortName(rd)}</span>
                <span className="block text-[10.5px] text-cz-2">{typeKey ? t(typeKey) : rd.primaryType}</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                {[0, 1].map((k) => <span key={k} className="w-2.5 h-2.5 rounded-full" style={{ background: k < used ? "rgb(var(--accent))" : "transparent", border: `1.4px solid ${k < used ? "rgb(var(--accent-t))" : "var(--text-3)"}` }} />)}
              </span>
              {chip && (
                <span className="text-[9.5px] shrink-0" style={{ color: chip.tone === "warn" ? "rgb(var(--accent-t))" : "rgb(var(--accent-t))" }}>{chip.glyph}</span>
              )}
              <i className="ti ti-chevron-right text-[16px] text-cz-3 shrink-0" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
