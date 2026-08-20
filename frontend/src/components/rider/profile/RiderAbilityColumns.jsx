// RiderAbilityColumns — Overblik-fanens evne-kolonner (#2000 stykke 2).
//
// De 15 synlige CZ-evner i 3 kort (Fysisk / Mental / Teknisk) via den delte SSOT
// (lib/abilities.js → ABILITY_CATEGORIES). Hvert kort: pinned kategori-header
// (stroke-ikon + Bebas-overskrift + antal, 2px guld-underline) og evne-rækker.
//
// TALLET = evne-niveau 1-99 (farvet via statColor-SSOT). Overblik ejer "hvem er
// rytteren" og viser kun tallet; fremdriftsbaren mod næste +1 er Træning-fanens
// kvittering (RiderTrainingTab, PR #3717) — dubletten er fjernet her (#3721).
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

// Én evne-række: navn · 1-99-tal.
function AbilityRow({ label, value }) {
  const color = statColor(value);
  return (
    <div className="flex items-center gap-[9px] py-[3.5px]">
      <span className="flex-1 min-w-0 text-2xs text-cz-2 truncate">{label}</span>
      <span
        className="font-mono tabular-nums font-bold text-[12.5px] text-right flex-none min-w-[19px]"
        style={{ color }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function RiderAbilityColumns({ abilities }) {
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
              <span className="font-mono text-3xs text-cz-3 ms-auto">
                {t("profile.overview.skillCount", { count: cat.keys.length })}
              </span>
            </div>
            {cat.keys.map((key) => (
              <AbilityRow
                key={key}
                label={t(`racePreview.derived.${key}`)}
                value={abilities[key]}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
