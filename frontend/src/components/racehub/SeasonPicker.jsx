// #4102 — synlig sæson-vælger på Season-visningen (Z1 v0 havde kun ?season=
// via URL, ingen synlig indgang). Viser den aktive sæson + dens nærmeste nabo
// (næste kommende ELLER forrige afsluttede) som et segmenteret valg, samme
// hairline/5px-kontrakt som SeasonDayToggle. B7 (spec): næste sæson browses
// read-only så snart kalenderen findes; efter cutover viser samme komponent i
// stedet forrige sæson som "previous" — ingen særskilt kode-sti.
import { useTranslation } from "react-i18next";

// Sæsoner "værd at vise": den aktive + naboerne lige ved siden af (±1). Flere
// sæsoner tilbage i tiden hører til arkivet, ikke denne planlægnings-flade.
export function neighborSeasons(availableSeasons, activeNumber) {
  if (!Array.isArray(availableSeasons) || activeNumber == null) return [];
  return availableSeasons
    .filter((s) => Math.abs(s.number - activeNumber) <= 1)
    .sort((a, b) => a.number - b.number);
}

export default function SeasonPicker({ seasons, activeNumber, current, onSelect }) {
  const { t } = useTranslation("races");
  if (!seasons || seasons.length < 2) return null;
  const statusKey = (n) => (n === activeNumber ? "current" : n > activeNumber ? "upcoming" : "previous");
  return (
    <div className="inline-flex overflow-hidden rounded-cz border border-cz-border" role="group" aria-label={t("seasonView.picker.ariaLabel")}>
      {seasons.map((s) => {
        const active = s.number === current;
        return (
          <button
            key={s.number}
            type="button"
            onClick={() => { if (!active) onSelect(s.number); }}
            aria-pressed={active}
            className={`px-3 py-1 font-data text-xs whitespace-nowrap transition-colors ${
              active ? "bg-cz-sidebar font-semibold text-cz-sidebar-1" : "bg-cz-card text-cz-2 hover:text-cz-1"
            }`}
          >
            {t(`seasonView.picker.${statusKey(s.number)}`, { number: s.number })}
          </button>
        );
      })}
    </div>
  );
}
