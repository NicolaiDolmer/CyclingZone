import { useTranslation } from "react-i18next";
import { topDemands, remainderWeight } from "../../lib/stageTerrain.js";

// Editorial "terrain DNA"-bar: hvilke evner etapen belønner (ægte demand_vector).
// Tom/manglende demand_vector → null (ingen falsk visning — graceful degrade).
//
// #3149 (transparens-fix): de viste vægte skal ALTID summe til 100%. Før denne
// rettelse blev randomness (motorens støj-skalar) og evner uden for top-N'et
// stille udeladt — på fx enkeltstarter summede visningen kun til 88%, og
// spillerne troede der var 12% skjult mekanik (Discord-analyse, #3149). "Resten"
// nedenfor er en ægte afledt sum (demand_vector summer altid til 1.0), aldrig et
// gættet tal. finaleFactorPct er et SEPARAT, oveni-liggende ±udsving (nedkørsel/
// positionering på tekniske finaler) — vises som egen linje, IKKE som en del af
// 100%-summen, fordi det ikke er en del af DEMAND_VECTORS' vægt-budget.
const SEG_FILL = ["bg-cz-accent", "bg-cz-2", "bg-cz-3", "bg-cz-border", "bg-cz-border"];
const REST_FILL = "bg-cz-border/60";

export default function TerrainDNABar({ demandVector, max = 5, finaleFactorPct = 0 }) {
  const { t } = useTranslation("races");
  const demands = topDemands(demandVector, max);
  if (!demands.length) return null;
  const pct = (w) => Math.round(w * 100);

  const shownPcts = demands.map((d) => pct(d.weight));
  const rawRest = remainderWeight(demandVector, demands);
  // Sidste bucket = 100 − sum(vist), så totalen ALTID rammer nøjagtigt 100%
  // (undgår afrundings-drift fra at runde hvert segment for sig).
  const restPct = rawRest > 0 ? Math.max(0, 100 - shownPcts.reduce((a, b) => a + b, 0)) : 0;

  const segments = demands.map((d, i) => ({ key: d.ability, pct: shownPcts[i], label: t(`detail.ability.${d.ability}`) }));
  if (restPct > 0) segments.push({ key: "__rest", pct: restPct, label: t("detail.terrainDna.rest") });

  return (
    <div>
      <p className="text-cz-3 text-3xs uppercase tracking-wider font-semibold mb-1.5">
        {t("detail.terrainDna.label")}
      </p>
      <div
        className="flex h-3 rounded-cz overflow-hidden border border-cz-border"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.pct}%`).join(", ")}
      >
        {segments.map((s, i) => (
          <div
            key={s.key}
            className={s.key === "__rest" ? REST_FILL : (SEG_FILL[i] || "bg-cz-border")}
            style={{ width: `${s.pct}%` }}
            title={`${s.label} ${s.pct}%`}
          />
        ))}
      </div>
      <p className="text-cz-2 text-2xs font-mono mt-1.5 leading-relaxed">
        {segments.map((s, i) => (
          <span key={s.key} className={`text-2xs ${i === 0 ? "text-cz-accent-t font-semibold" : (s.key === "__rest" ? "text-cz-3" : "")}`}>
            {i > 0 && " · "}
            {s.label} {s.pct}%
          </span>
        ))}
      </p>
      {finaleFactorPct > 0 && (
        <p className="text-cz-3 text-2xs mt-1 italic">
          {/* Math.round(...·10)/10: TECHNICAL_FINALE_WEIGHT*100 rammer flydende-komma-
              støj (3.5000000000000004) — vis ét pænt decimal, ikke motorens rå float. */}
          {t("detail.terrainDna.finaleFactor", { pct: Math.round(finaleFactorPct * 10) / 10 })}
        </p>
      )}
    </div>
  );
}
