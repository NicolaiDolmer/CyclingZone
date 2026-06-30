// RiderOverviewPhysiology — Overblik-fanens compacte fysiologi-teaser (#2000 stykke 2).
//
// Tre nøgletal (FTP / VO₂max / Pmax) fra rider.physiology (GET /api/riders/:id) +
// et link til den dybe Fysiologi-fane (watt-kurve, zoner, benchmarks).
//
// BEVIDST UDEN "vs division-snit"-bjælker: et divisions-fysiologi-benchmark findes
// ikke i klienten (ingen endpoint — kun backend-sim-scripts beregner divisions-snit).
// At tegne en magnitude-bjælke uden et ægte snit-mærke ville vildlede. Den
// benchmarkede visning (bjælker + divisions-tick + watt-kurve) hører til den
// dedikerede Fysiologi-fane, der bygges som et senere stykke — og hvis den skal vise
// divisions-snit, kræver det først et benchmark-endpoint. Her vises de rå tal ærligt.
//
// Token-only; tal = font-mono tabular. Skjules helt hvis fysiologi-profilen mangler.

import { useTranslation } from "react-i18next";

// Universelle forkortelser (oversættes ikke, jf. abilities.js' korte labels).
const STAT_DEFS = [
  { key: "ftp_wkg", label: "FTP", unit: "W/kg", digits: 1 },
  { key: "vo2max_power_wkg", label: "VO₂max", unit: "W/kg", digits: 1 },
  { key: "pmax_watts", label: "Pmax", unit: "W", digits: 0 },
];

function fmt(value, digits) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return digits > 0 ? num.toFixed(digits) : Math.round(num).toLocaleString("da-DK");
}

export default function RiderOverviewPhysiology({ physiology, weight, onGoFysiologi }) {
  const { t } = useTranslation("rider");
  if (!physiology) return null;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {t("profile.overview.physio.title")}
        </h3>
        {Number.isFinite(Number(weight)) && (
          <span className="text-[10.5px] text-cz-3 font-mono tabular-nums">
            {t("profile.overview.physio.weight", { kg: Math.round(Number(weight)) })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {STAT_DEFS.map((s) => (
          <div key={s.key} className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] text-cz-2">{s.label}</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono tabular-nums font-bold text-[15px] text-cz-1">
                {fmt(physiology[s.key], s.digits)}
              </span>
              <span className="text-[10px] text-cz-3">{s.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onGoFysiologi}
        className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-cz-accent-t hover:underline bg-transparent border-0 p-0"
      >
        {t("profile.overview.physio.link")}
      </button>
    </div>
  );
}
