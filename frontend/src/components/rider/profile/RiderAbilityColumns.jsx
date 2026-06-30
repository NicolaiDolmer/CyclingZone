// RiderAbilityColumns — Overblik-fanens evne-kolonner (#2000 stykke 2).
//
// De 15 synlige CZ-evner i 3 kort (Fysisk / Mental / Teknisk) via den delte SSOT
// (lib/abilities.js → ABILITY_CATEGORIES). Hvert kort: pinned kategori-header
// (stroke-ikon + Bebas-overskrift + antal, 2px guld-underline) og evne-rækker.
//
// To bjælke-/tal-betydninger (spec): TALLET = evne-niveau 1-99 (farvet via
// statColor-SSOT); den tynde GULD-bjælke = træningsfremgang mod næste +1
// (ability_progress 0..1). Bjælken vises KUN for egne ryttere (man træner ikke en
// rival) — for andres ryttere står track'en tom, så kolonnerne flugter. Legend
// under grid'et forklarer de to betydninger.
//
// Token-only: ingen rå hex. Farver via cz-tokens + statColor. Bebas = font-display,
// tal = font-mono tabular. Dark mode flipper automatisk via tokens.

import { useTranslation } from "react-i18next";
import { ABILITY_CATEGORIES } from "../../../lib/abilities.js";
import { statColor } from "../../../lib/statColor.js";
import IconBase from "../../ui/icons/IconBase.jsx";

// Per-kategori stroke-ikon (24×24, currentColor, width 2 — bundlet Icon-sprog,
// aldrig emoji). Pulse = fysisk, hjerne = mental, værktøj = teknisk.
const CATEGORY_ICON_PATHS = {
  physical: <path d="M6 12h3l2-5 3 9 2-4h2" />,
  mental: (
    <path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0-1 5l1 1v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0v-3l1-1a3 3 0 0 0-1-5V7a4 4 0 0 0-4-4z" />
  ),
  technical: (
    <>
      <path d="M14 4l6 6-8 8H6v-6z" />
      <path d="M11 7l6 6" />
    </>
  ),
};

// Én evne-række: navn · tynd guld-progress-bjælke (egne ryttere) · 1-99-tal.
function AbilityRow({ label, value, progressFraction, showProgress, progressHint }) {
  const color = statColor(value);
  const rawFrac = Number(progressFraction);
  const frac = Number.isFinite(rawFrac) ? Math.max(0, Math.min(1, rawFrac)) : 0;
  const pct = showProgress ? Math.round(frac * 100) : 0;
  return (
    <div className="flex items-center gap-[9px] py-[3.5px]">
      <span className="flex-1 min-w-0 text-[11.5px] text-cz-2 truncate">{label}</span>
      <div
        className="relative flex-none w-11 h-1 bg-cz-subtle rounded-full overflow-hidden"
        title={showProgress ? progressHint : undefined}
        aria-hidden="true"
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-cz-accent/75 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className="font-mono tabular-nums font-bold text-[12.5px] text-right flex-none min-w-[19px]"
        style={{ color }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function RiderAbilityColumns({ abilities, progressByKey = {}, isOwnRider = false }) {
  const { t } = useTranslation("rider");

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[13px] items-start">
        {ABILITY_CATEGORIES.map((cat) => (
          <div key={cat.key} className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
            <div className="flex items-center gap-2 pb-2 mb-1 border-b-2 border-cz-accent/50">
              <span className="flex text-cz-accent-t">
                <IconBase size={16}>{CATEGORY_ICON_PATHS[cat.key]}</IconBase>
              </span>
              <h3 className="font-display text-base leading-none tracking-[0.03em] uppercase text-cz-1 m-0">
                {t(`stats.categories.${cat.key}`)}
              </h3>
              <span className="font-mono text-[9.5px] text-cz-3 ms-auto">
                {t("profile.overview.skillCount", { count: cat.keys.length })}
              </span>
            </div>
            {cat.keys.map((key) => (
              <AbilityRow
                key={key}
                label={t(`racePreview.derived.${key}`)}
                value={abilities[key]}
                progressFraction={progressByKey[key]}
                showProgress={isOwnRider}
                progressHint={t("development.progressHint")}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend — de to bjælke/tal-betydninger holdt visuelt adskilt (spec). -mt-1
          trækker den tæt op under grid'et som en caption (design: margin-top -4px). */}
      <div className="-mt-1 flex items-center gap-1.5 flex-wrap text-[10.5px] text-cz-3">
        <span>{t("profile.overview.legend.level")}</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-1 rounded-full bg-cz-accent/75" aria-hidden="true" />
          {t("profile.overview.legend.progress")}
        </span>
      </div>
    </div>
  );
}
