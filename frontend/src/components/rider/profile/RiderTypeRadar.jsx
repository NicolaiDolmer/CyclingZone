// RiderTypeRadar — Overblik-fanens ryttertype-spider (#2000 stykke 2).
//
// 8-akse radar: for hver ryttertype plottes hvor højt rytteren ville rates SOM den
// type — riderTypeRating(abilities, typeKey) fra rating-SSOT'en (lib/riderRating.js,
// SAMME model som overall-ratingen og Udvikling-fanens type-linjer). "Nu"-polygonen
// (solid guld) er dermed bygget på ægte evne-data, ikke opfundne tal.
//
// LOFT-polygon (dashed "scoutet loft") er BEVIDST UDELADT: et per-type loft kræver
// per-type potentiale-data, og den findes ikke i klienten (scouting-estimatet er ét
// OVERALL potentiale, ikke pr. type — useScouting/ScoutablePotentiale). At skalere et
// per-type loft ud fra overall-potentialet ville opfinde en form uden datagrundlag.
// Loft-laget hører til talentspejder-/Scouting-arbejdet (per-type potentiale) og
// tilføjes når den data findes. Indtil da viser radaren ærligt kun "Nu".
//
// Token-only: SVG-farver via app'ens CSS-vars (--accent/--accent-t/--border/--text-3,
// identiske med design-tokens). Dark mode flipper automatisk.

import { useTranslation } from "react-i18next";
import { riderTypeRating } from "../../../lib/riderRating.js";

// Spektrum-orden (flade spurtere → klatrere) så beslægtede typer ligger ved siden af
// hinanden og polygonen får en aflæselig form. Nøgler = RIDER_TYPE_KEYS (SSOT).
const RADAR_ORDER = [
  "sprinter", "puncheur", "brostensrytter", "baroudeur",
  "rouleur", "tt", "gc", "climber",
];

const CX = 140;
const CY = 112;
const R = 82;
const angleAt = (i, n) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

export default function RiderTypeRadar({ rider, onGoScouting }) {
  const { t } = useTranslation("rider");
  const { t: tTypes } = useTranslation("riderTypes");

  const abilities = rider?.abilities;
  if (!abilities) return null;

  const n = RADAR_ORDER.length;
  const ratings = RADAR_ORDER.map((key) => riderTypeRating(abilities, key));

  const nowPoly = RADAR_ORDER.map((_, i) => {
    const r = R * (Math.max(0, Math.min(99, ratings[i])) / 99);
    return `${(CX + Math.cos(angleAt(i, n)) * r).toFixed(1)},${(CY + Math.sin(angleAt(i, n)) * r).toFixed(1)}`;
  }).join(" ");

  const axes = RADAR_ORDER.map((_, i) => ({
    x: (CX + Math.cos(angleAt(i, n)) * R).toFixed(1),
    y: (CY + Math.sin(angleAt(i, n)) * R).toFixed(1),
  }));
  const rings = [R / 3, (2 * R) / 3, R].map((r) => r.toFixed(1));

  // Bedste type = højeste type-rating (tie-break = først i RADAR_ORDER/visnings-orden).
  const bestIdx = ratings.reduce((best, v, i) => (v > ratings[best] ? i : best), 0);
  const bestKey = RADAR_ORDER[bestIdx];

  const labels = RADAR_ORDER.map((key, i) => {
    const a = angleAt(i, n);
    const lx = CX + Math.cos(a) * (R + 13);
    const ly = CY + Math.sin(a) * (R + 13) + 3;
    const anchor = Math.cos(a) > 0.3 ? "start" : Math.cos(a) < -0.3 ? "end" : "middle";
    return { key, x: lx.toFixed(1), y: ly.toFixed(1), anchor, isBest: key === bestKey };
  });

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {t("profile.overview.radar.title")}
        </h3>
        <span className="text-[10.5px] text-cz-3">{t("profile.overview.radar.subtitle")}</span>
      </div>

      <svg viewBox="0 0 280 230" className="block w-full max-w-[430px] h-auto mx-auto mt-0.5" aria-hidden="true">
        {rings.map((r, i) => (
          <circle key={`ring-${i}`} cx={CX} cy={CY} r={r} fill="none" stroke="var(--border)" strokeWidth="1" />
        ))}
        {axes.map((ax, i) => (
          <line key={`axis-${i}`} x1={CX} y1={CY} x2={ax.x} y2={ax.y} stroke="var(--border)" strokeWidth="1" opacity="0.55" />
        ))}
        <polygon
          points={nowPoly}
          fill="rgb(var(--accent) / 0.2)"
          stroke="rgb(var(--accent-t))"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {labels.map((l) => (
          <text
            key={`label-${l.key}`}
            x={l.x}
            y={l.y}
            fontSize="8.5"
            fontWeight="700"
            letterSpacing="0.3"
            fill={l.isBest ? "rgb(var(--accent-t))" : "var(--text-3)"}
            fontFamily='"Inter Tight", "Inter Tight Fallback", system-ui, sans-serif'
            textAnchor={l.anchor}
          >
            {tTypes(`short.${l.key}`)}
          </text>
        ))}
      </svg>

      <div className="flex gap-3.5 flex-wrap justify-center mt-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-cz-2">
          <span className="w-3 h-[3px] rounded-sm bg-cz-accent-t" aria-hidden="true" />
          {t("profile.overview.radar.legendNow")}
        </span>
      </div>

      {/* Per-type potentiale-stjerner UDELADT her (samme grund som loft-polygonen:
          per-type potentiale findes ikke i klienten — kun ét overall-estimat). At vise
          overall-potentialet her ville implicere et per-type loft vi ikke har. Footer
          viser bedste type + link til Scouting; overall-potentialet står i hero'en.
          Tilføjes når per-type potentiale-data findes (talentspejder). */}
      <div className="mt-3 pt-3 border-t border-cz-border flex items-center gap-2.5 flex-wrap">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-cz-3">
          {t("profile.overview.radar.bestAs")}
        </span>
        <span className="font-bold text-[13.5px] text-cz-1">{tTypes(`types.${bestKey}`)}</span>
        <button
          type="button"
          onClick={onGoScouting}
          className="ms-auto py-1 -my-1 text-[11px] text-cz-accent-t hover:underline"
        >
          {t("profile.overview.radar.allTypes")}
        </button>
      </div>
    </div>
  );
}
