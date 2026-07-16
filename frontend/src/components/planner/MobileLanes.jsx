// Season Planner — mobilt stakket spor (spec §5.3): master-brættet er 3-kolonne på
// desktop; på mobil bliver hver lane et kort man tapper for at åbne skuffen. En
// vandret løb-strip øverst giver adgang til race-fokus. Alt tap-mål ≥24px (a11y).
import { useTranslation } from "react-i18next";
import { riderOverallRating } from "../../lib/riderRating";
import { statStyle } from "../../lib/statColor";
import { Flag } from "../Flag";
import RiderTypeBadge from "../rider/RiderTypeBadge";
import { dateToOrdinal, formatRaceDateLabel, statusMeta, riderShortName } from "./plannerShared";

export default function MobileLanes({ riders, races, filter, today, selectedRaceId, selectedRiderId, onSelectRace, onSelectRider }) {
  const { t } = useTranslation("planner");
  const months = t("months", { returnObjects: true });
  const nowOrd = dateToOrdinal(today);

  const visRaces = (races || [])
    .filter((r) => r.date && (filter === "all" || r.isMine))
    .map((r) => ({ ...r, ord: dateToOrdinal(r.date) }))
    .filter((r) => r.ord != null && (nowOrd == null || r.ord >= nowOrd - 3))
    .sort((a, b) => a.ord - b.ord)
    .slice(0, 30);

  // #2519 item 4: samme "planlægger mod"-tydelighed som desktop — mobil har
  // ingen drag, så kilden er udelukkende den valgte rytter-lane (skuffen åben).
  const selectedRider = selectedRiderId ? (riders || []).find((r) => r.id === selectedRiderId) : null;
  const ridersPeaks = (selectedRider?.peaks || [])
    .map((p) => ({ ...p, ord: dateToOrdinal(p.windowStart) }))
    .filter((p) => p.ord != null)
    .sort((a, b) => a.ord - b.ord);
  const chosenPeak = ridersPeaks.find((p) => (nowOrd == null ? true : p.ord >= nowOrd)) || ridersPeaks[0];
  const planningTarget = chosenPeak ? (races || []).find((r) => r.id === chosenPeak.targetRaceId) : null;

  return (
    <div className="flex flex-col gap-3">
      {planningTarget && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-cz border border-cz-accent-t bg-cz-subtle text-[11px] text-cz-1">
          <i className="ti ti-target-arrow text-[13px] text-cz-accent-t" aria-hidden="true" />
          <span>{t("planningTowards.label", { race: planningTarget.name, date: formatRaceDateLabel(planningTarget, months) })}</span>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {visRaces.map((r) => {
          const isTarget = r.id === planningTarget?.id;
          const isSelected = r.id === selectedRaceId;
          return (
            <button
              key={r.id}
              className={`shrink-0 min-h-[44px] px-3 py-1.5 rounded-cz border text-left hover:bg-cz-subtle ${isTarget || isSelected ? "border-cz-accent-t bg-cz-subtle" : "border-cz-border bg-cz-card"}`}
              onClick={() => onSelectRace(r.id)}
            >
              <div className="text-[11px] text-cz-1 font-medium whitespace-nowrap">{r.name}</div>
              <div className="text-[9.5px] text-cz-2">{formatRaceDateLabel(r, months)} · {t(`terrain.${r.terrain}`)}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {(riders || []).map((rd) => {
          const ovr = riderOverallRating({ ...rd.abilities, primary_type: rd.primaryType });
          const peaks = rd.peaks || [];
          const used = peaks.length;
          const risky = peaks.some((p) => p.status === "at_risk");
          const chip = used ? statusMeta(risky ? "at_risk" : (peaks.some((p) => p.status === "on_track") ? "on_track" : "pending")) : null;
          // #2455: mobil-first — samme "forslag indtil accepteret"-signal som
          // desktop master-canvasset, ellers opdages featuren aldrig på mobil.
          const hasSuggestion = peaks.some((p) => p.isSuggestion);
          const laneSelected = rd.id === selectedRiderId;
          return (
            <button
              key={rd.id}
              className={`min-h-[44px] flex items-center gap-3 p-2.5 rounded-cz border text-left hover:bg-cz-subtle ${laneSelected ? "border-cz-accent-t bg-cz-subtle" : "border-cz-border bg-cz-card"}`}
              onClick={() => onSelectRider(rd.id)}
            >
              <span className="w-7 shrink-0 flex items-center justify-center">
                {rd.nationality ? <Flag code={rd.nationality} className="text-[14px]" /> : <span className="font-mono text-[10px] text-cz-2">—</span>}
              </span>
              {/* #2447: OVR-badge farvet efter samme evne-gradient som alle andre
                  rating-visninger (statStyle, SSOT) — den gamle faste --text-1/accent-
                  kombination blev til en næsten-hvid bund med gult tal (ulæselig) i
                  dark mode. */}
              <span className="w-9 h-9 rounded-cz flex items-center justify-center shrink-0 font-mono text-[13px] font-medium" style={statStyle(ovr)}>
                {ovr}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-cz-1 font-medium truncate">{riderShortName(rd)}</span>
                {rd.primaryType && (
                  <span className="block mt-0.5">
                    <RiderTypeBadge primaryType={rd.primaryType} secondaryType={rd.secondaryType} size="sm" />
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                {[0, 1].map((k) => {
                  const tp = peaks[k];
                  const filled = k < used;
                  return (
                    <span
                      key={k} className="w-2.5 h-2.5 rounded-full"
                      style={{
                        background: filled && !tp?.isSuggestion ? "rgb(var(--accent))" : "transparent",
                        border: `1.4px ${tp?.isSuggestion ? "dashed" : "solid"} ${filled ? "rgb(var(--accent-t))" : "var(--text-3)"}`,
                      }}
                    />
                  );
                })}
              </span>
              {/* #2447: on_track/at_risk brugte tidligere samme farve i begge grene
                  (kopiér-fejl) — "god" status skal ikke råbe lige så meget som "risiko".
                  #2455: et forslag erstatter status-glyffen med ✦ (samme princip som
                  desktop) indtil manageren har accepteret/ændret mindst én peak. */}
              {hasSuggestion ? (
                <span className="text-[9.5px] shrink-0" style={{ color: "rgb(var(--accent-t))" }} title={t("assistant.badge")}>✦</span>
              ) : chip && (
                <span className="text-[9.5px] shrink-0" style={{ color: chip.tone === "good" ? "rgb(var(--accent))" : "rgb(var(--accent-t))" }}>{chip.glyph}</span>
              )}
              <i className="ti ti-chevron-right text-[16px] text-cz-3 shrink-0" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
