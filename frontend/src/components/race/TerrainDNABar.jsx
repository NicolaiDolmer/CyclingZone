import { useTranslation } from "react-i18next";
import { topDemands } from "../../lib/stageTerrain.js";

// Editorial "terrain DNA"-bar: hvilke evner etapen belønner (ægte demand_vector).
// Tom/manglende demand_vector → null (ingen falsk visning — graceful degrade).
const SEG_FILL = ["bg-cz-accent", "bg-cz-2", "bg-cz-3", "bg-cz-border", "bg-cz-border"];

export default function TerrainDNABar({ demandVector, max = 5 }) {
  const { t } = useTranslation("races");
  const demands = topDemands(demandVector, max);
  if (!demands.length) return null;
  const pct = (w) => Math.round(w * 100);
  return (
    <div>
      <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold mb-1.5">
        {t("detail.terrainDna.label")}
      </p>
      <div
        className="flex h-3 rounded-cz overflow-hidden border border-cz-border"
        role="img"
        aria-label={demands.map((d) => `${t(`detail.ability.${d.ability}`)} ${pct(d.weight)}%`).join(", ")}
      >
        {demands.map((d, i) => (
          <div
            key={d.ability}
            className={SEG_FILL[i] || "bg-cz-border"}
            style={{ width: `${pct(d.weight)}%` }}
            title={`${t(`detail.ability.${d.ability}`)} ${pct(d.weight)}%`}
          />
        ))}
      </div>
      <p className="text-cz-2 text-[11px] font-mono mt-1.5 leading-relaxed">
        {demands.map((d, i) => (
          <span key={d.ability} className={i === 0 ? "text-cz-accent-t font-semibold" : ""}>
            {i > 0 && " · "}
            {t(`detail.ability.${d.ability}`)} {pct(d.weight)}%
          </span>
        ))}
      </p>
    </div>
  );
}
