import { useTranslation } from "react-i18next";
import { statColor } from "../../../lib/statColor.js";
import { staffColumnsFor } from "../../../lib/staffAbilities.js";
import Tooltip from "../../ui/Tooltip.jsx";

function AbilityRow({ label, value }) {
  return (
    <div className="flex items-center gap-[9px] py-[3.5px]">
      <span className="flex-1 min-w-0 text-[11.5px] text-cz-2 truncate">{label}</span>
      <span className="font-mono tabular-nums font-bold text-[12.5px] text-right flex-none min-w-[19px]"
        style={{ color: statColor(value) }}>
        {Number.isFinite(value) ? value : "—"}
      </span>
    </div>
  );
}

export default function StaffAbilityColumns({ profile }) {
  const { t } = useTranslation("staff");
  const cols = staffColumnsFor(profile.role);
  const ab = profile.abilities || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-[13px] items-start">
      {cols.map((col) => (
        <div key={col.key} className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
          <div className="flex items-center gap-2 pb-2 mb-1 border-b-2 border-cz-accent/50">
            {col.key === "levels" ? (
              <Tooltip label={t("columns.levelsTooltip")}>
                <h3 className="font-display text-base leading-none tracking-[0.03em] uppercase text-cz-1 m-0 underline decoration-dotted decoration-cz-3 cursor-help">
                  {t(`columns.${col.key}`)}
                </h3>
              </Tooltip>
            ) : (
              <h3 className="font-display text-base leading-none tracking-[0.03em] uppercase text-cz-1 m-0">
                {t(`columns.${col.key}`)}
              </h3>
            )}
            <span className="font-mono text-[9.5px] text-cz-3 ms-auto">{col.axisKeys.length}</span>
          </div>
          {col.axisKeys.map((axis) => (
            <AbilityRow key={axis} label={t(`axes.${axis}`)} value={ab[col.source]?.[axis]} />
          ))}
        </div>
      ))}
    </div>
  );
}
