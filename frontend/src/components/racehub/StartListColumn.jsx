// Race Hub Fase 5 (#1835 / S6) — read-only startliste-kolonne for en FREMMED pulje.
// PCS-style bruttotrup: deltagende hold + udtagne ryttere (navn + flag). INGEN roller,
// form, træthed eller egnethed (#1835: kun "hvem stiller op"). Løb længere end
// horisonten ude vises låst (kun navn + nedtælling til startlisten åbner).
import { useTranslation } from "react-i18next";
import { Flag } from "../Flag.jsx";
import RaceLink from "../RaceLink.jsx";
import TeamLink from "../TeamLink";
import { LockIcon } from "../ui";

function riderLabel(r) {
  const initial = r.firstname ? `${r.firstname[0]}. ` : "";
  return `${initial}${r.lastname ?? ""}`.trim();
}

export default function StartListColumn({ column }) {
  const { t } = useTranslation("races");
  const typeLabel = column.race_type === "stage_race"
    ? t("raceType.stages", { count: column.stages })
    : t("raceType.oneDay");
  const classLabel = t(`classOption.${column.race_class}`);

  if (!column.visible) {
    return (
      <div className="border border-dashed border-cz-border rounded-cz bg-cz-subtle p-3 flex items-start gap-2.5">
        <LockIcon size={15} className="text-cz-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cz-2 truncate">{column.name}</p>
          <p className="text-[11px] text-cz-3 mt-0.5">{typeLabel} · {classLabel}</p>
          <p className="text-[11px] text-cz-3 mt-1">{t("browse.opensIn", { count: column.opensInDays })}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-cz-border rounded-cz bg-cz-card flex flex-col">
      <div className="p-3 border-b border-cz-border">
        <div className="flex items-start justify-between gap-2">
          <RaceLink id={column.id} state={{ from: "browse" }} className="text-sm font-semibold text-cz-1 hover:text-cz-accent-t transition-colors">{column.name}</RaceLink>
          {column.daysUntilStart != null && column.daysUntilStart > 0 && (
            <span className="text-[10px] uppercase tracking-wide text-cz-accent-t bg-cz-accent/10 border border-cz-accent/30 px-2 py-0.5 rounded-full flex-shrink-0">
              {t("browse.inDays", { count: column.daysUntilStart })}
            </span>
          )}
        </div>
        <p className="text-[11px] text-cz-3 mt-0.5">{typeLabel} · {classLabel} · {t("browse.teamCount", { count: column.teamCount })}</p>
      </div>

      <div className="py-1 flex-1">
        {column.teams.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-cz-3">{t("browse.noEntries")}</p>
        ) : column.teams.map((g) => (
          <div key={g.team.id} className="px-3 py-1.5 border-b border-cz-border/50 last:border-0">
            <p className="text-[11px] font-medium text-cz-2 mb-1 truncate">
              <TeamLink id={g.team.id} className="hover:text-cz-accent-t transition-colors">{g.team.name ?? t("browse.unknownTeam")}</TeamLink>
            </p>
            <div className="flex flex-wrap gap-1">
              {g.riders.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 text-[11px] text-cz-1 bg-cz-subtle rounded-full px-2 py-0.5">
                  {r.nationality_code && <Flag code={r.nationality_code} />}
                  {riderLabel(r)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-cz-border">
        <p className="text-[10px] text-cz-3 flex items-center gap-1.5">
          <LockIcon size={11} className="flex-shrink-0" aria-hidden="true" />
          {t("browse.grossOnly")}
        </p>
      </div>
    </div>
  );
}
