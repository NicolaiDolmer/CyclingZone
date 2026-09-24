// #5631 (plan S7/S8): stillingen i én ungdomsgruppe.
//
// Samme T2-tabel (DataTable) som seniorstillingen på /standings: placering og
// holdnavn i den sticky navnecelle, tal højrestillet med tabular figures, eget
// hold markeret med `cz-me` (index.css, ejer-valg 30/8), aldrig guld. Ingen
// op/ned-zoner: ungdoms-op/nedrykning kører først fra S5, og en zone her ville
// love en oprykning der ikke findes (TASTE P11). Ingen præmie-kolonne: ungdom
// v1 har ingen præmiepenge (YOUTH_RULES §2.3).
//
// Holdnavnet vises som truppens navn ("<Klub> U23" / "<Klub> Juniors"), samme
// streng som trup-sidens titel, så et hold hedder det samme begge steder.
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";
import { DataTable, type DataTableColumn } from "./squadUi.ts";
import type { YouthStandingRow, YouthStandingsSquad } from "../../lib/youthRankingsClient.ts";

// D-047: mobil = navn + point, sejre og podier.
const MOBILE_DEFAULTS = ["points", "wins", "podiums"];

export default function YouthStandingsTable({ squad, rows, myTeamId, label, toolbar }: {
  squad: YouthStandingsSquad;
  rows: YouthStandingRow[];
  myTeamId: string | null;
  label: string;
  toolbar?: ReactNode;
}) {
  const { t } = useTranslation("squad");
  const navigate = useNavigate();

  const columns: DataTableColumn<YouthStandingRow>[] = [
    {
      key: "team",
      header: t("standings.headers.team"),
      sticky: true,
      render: (r) => (
        <span className="inline-flex items-baseline gap-2 min-w-0">
          <span className="w-5 shrink-0 text-right font-data tabular-nums text-cz-3">{r.rank ?? "–"}</span>
          <span className="text-cz-1">
            {r.teamName ? t(`page.title.${squad}`, { team: r.teamName }) : t(`page.fallbackTitle.${squad}`)}
          </span>
        </span>
      ),
    },
    {
      key: "races",
      header: t("standings.headers.races"),
      numeric: true,
      compact: true,
      render: (r) => <span className="text-cz-2">{formatNumber(r.races)}</span>,
    },
    {
      key: "wins",
      header: t("standings.headers.wins"),
      numeric: true,
      compact: true,
      render: (r) => <span className={r.wins > 0 ? "text-cz-2" : "text-cz-3"}>{formatNumber(r.wins)}</span>,
    },
    {
      key: "podiums",
      header: t("standings.headers.podiums"),
      numeric: true,
      compact: true,
      render: (r) => <span className={r.podiums > 0 ? "text-cz-2" : "text-cz-3"}>{formatNumber(r.podiums)}</span>,
    },
    {
      key: "points",
      header: t("standings.headers.points"),
      numeric: true,
      compact: true,
      render: (r) => <span className="font-semibold text-cz-1">{formatNumber(r.points)}</span>,
    },
  ];

  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.teamId}
      mobileDefaults={MOBILE_DEFAULTS}
      rowProps={(r) => ({
        onClick: () => navigate(`/teams/${r.teamId}`),
        className: `cursor-pointer${r.teamId === myTeamId ? " cz-me" : ""}`,
        "data-testid": r.teamId === myTeamId ? "youth-standings-me" : undefined,
      })}
      toolbar={toolbar}
      count={t("standings.count", { count: rows.length })}
    />
  );
}
