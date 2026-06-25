// Race Hub S3 — mål-løb-markering. Holdets kommende løb som markerbar liste; din
// A-kæde prioriteres til de markerede. Status-chip via delt deriveRaceStatus.
import { useTranslation } from "react-i18next";
import { toggleInList } from "../../../lib/strategyLogic.js";

export default function TargetRacePicker({ upcoming, value, onChange }) {
  const { t } = useTranslation("races");

  return (
    <section className="border border-cz-border rounded-cz bg-cz-card p-4 mb-4">
      <h2 className="text-sm font-semibold text-cz-1">{t("strategy.targets.title")}</h2>
      <p className="text-[11px] text-cz-3 mt-0.5 mb-3">{t("strategy.targets.help")}</p>

      {upcoming.length === 0 ? (
        <p className="text-xs text-cz-3 italic">{t("strategy.targets.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {upcoming.map((race) => {
            const marked = value.includes(race.id);
            return (
              <li key={race.id}>
                <button type="button" onClick={() => onChange(toggleInList(value, race.id))}
                  aria-pressed={marked}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded border text-left transition-colors ${
                    marked ? "border-cz-accent/50 bg-cz-accent/10" : "border-transparent hover:bg-cz-subtle"}`}>
                  <span className={`w-3 h-3 rounded-sm border flex-shrink-0 ${marked ? "bg-cz-accent border-cz-accent" : "border-cz-3"}`} aria-hidden="true" />
                  <span className="text-xs text-cz-1 truncate flex-1">{race.name}</span>
                  <span className="text-[10px] uppercase text-cz-3">{t(`strategy.buckets.${race.bucket}`)}</span>
                  {marked && <span className="text-[9px] uppercase tracking-wide text-cz-accent-t">{t("strategy.targets.marked")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
