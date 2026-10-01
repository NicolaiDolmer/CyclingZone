// #5843: Calendar- og Results-fanen på U23-/Junior-siderne og Youth races.
//
// T2-tabel (DataTable) som stillingen. Hver række åbner den eksisterende
// løbsside: Calendar → Hold-fanen (samme udtagelsespanel som senior, filtreret
// på løbets trup af serveren), Results → resultat-fanen. Ingen guld-knap her;
// handlingen er rækken selv plus et sekundært link (TASTE: én gold pr. view).
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { SkeletonLines } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { formatDateTime, formatNumber } from "../../lib/intl.js";
import { DataTable, ErrorState, type DataTableColumn } from "./squadUi.ts";
import { YouthRacesEmptyState } from "./SquadEmptyStates.tsx";
import { useYouthRaces } from "./useYouthRaces.ts";
import { youthSelectionOpen, type YouthRaceItem } from "../../lib/youthRaceCalendar.ts";
import type { YouthSquad } from "../../lib/youthSquadPages.ts";

const LINK_SM = `${buttonClass({ variant: "secondary", size: "sm" })} inline-flex whitespace-nowrap`;
const MOBILE_DEFAULTS = ["team", "action"];

// #5944: trainOnly = truppen er sat til "Train only"; kommende ulåste løb uden felt
// vises som "Not entered · training".
export default function YouthRacesTab({ squad, tab, trainOnly = false }: { squad: YouthSquad; tab: "calendar" | "results"; trainOnly?: boolean }) {
  const { t } = useTranslation("squad");
  const navigate = useNavigate();
  const { status, calendar, results, reload } = useYouthRaces(squad);

  if (status === "loading") return <SkeletonLines lines={6} />;
  if (status === "error") {
    return (
      <ErrorState
        title={t("youthRaces.error.title")}
        description={t("youthRaces.error.description")}
        action={
          <button type="button" onClick={() => { void reload(); }} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("error.retry")}
          </button>
        }
      />
    );
  }
  if (status === "no_pool") {
    return <div data-testid="youth-races-no-pool"><YouthRacesEmptyState squad={squad} tab={tab} noPool /></div>;
  }
  const rows = tab === "calendar" ? calendar : results;
  if (rows.length === 0) return <div data-testid="youth-races-empty"><YouthRacesEmptyState squad={squad} tab={tab} /></div>;

  const hrefFor = (r: YouthRaceItem) => `/races/${r.id}?tab=${tab === "calendar" ? "team" : "results"}`;

  const isTraining = (r: YouthRaceItem) => trainOnly && youthSelectionOpen(r) && r.selection === "none";

  const teamCell = (r: YouthRaceItem) => {
    if (tab === "results") {
      return r.riders > 0
        ? <span className="text-cz-2">{t("youthRaces.team.rode", { count: r.riders })}</span>
        : <span className="text-cz-3">{t("youthRaces.team.none")}</span>;
    }
    if (r.selection === "none") return <span className="text-cz-3">{t(isTraining(r) ? "youthRaces.team.training" : "youthRaces.team.none")}</span>;
    return (
      <span className="text-cz-2">
        {t(r.selection === "auto" ? "youthRaces.team.auto" : "youthRaces.team.manual", { count: r.riders })}
      </span>
    );
  };

  const statusText = (r: YouthRaceItem) => {
    if (r.status === "completed") return t("youthRaces.status.completed");
    if (!youthSelectionOpen(r)) return t("youthRaces.status.live");
    return t("youthRaces.status.open");
  };

  const columns: DataTableColumn<YouthRaceItem>[] = [
    {
      key: "race",
      header: t("youthRaces.headers.race"),
      sticky: true,
      render: (r) => (
        <span className="flex flex-col min-w-0">
          <span className="text-cz-1 truncate">{r.name}</span>
          <span className="text-xs text-cz-3 font-data tabular-nums">
            {r.startsAt ? formatDateTime(r.startsAt) : "–"}
            {r.stages > 1 ? ` · ${t("youthRaces.stages", { count: r.stages })}` : ""}
          </span>
          <span className="text-xs text-cz-2">{statusText(r)}</span>
        </span>
      ),
    },
    {
      key: "team",
      header: t("youthRaces.headers.team"),
      compact: true,
      render: teamCell,
    },
    {
      key: "action",
      header: <span className="sr-only">{t("youthRaces.headers.action")}</span>,
      compact: true,
      render: (r) => (
        <Link
          to={hrefFor(r)}
          className={LINK_SM}
          onClick={(e) => e.stopPropagation()}
          data-testid={`youth-race-action-${r.id}`}
        >
          {tab === "results"
            ? t("youthRaces.action.results")
            : youthSelectionOpen(r) && !isTraining(r)
              ? t(r.selection === "none" ? "youthRaces.action.pick" : "youthRaces.action.edit")
              : t("youthRaces.action.view")}
        </Link>
      ),
    },
  ];

  return (
    <div>
      {tab === "calendar" && <p className="mb-3 text-[13px] text-cz-2">{t("youthRaces.calendarHint")}</p>}
      <DataTable
        label={t(`tabs.${tab}`)}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        mobileDefaults={MOBILE_DEFAULTS}
        rowProps={(r) => ({
          onClick: () => navigate(hrefFor(r)),
          className: "cursor-pointer",
          "data-testid": `youth-race-row-${r.id}`,
        })}
        count={t("youthRaces.count", { count: rows.length })}
      />
    </div>
  );
}
