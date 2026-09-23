// #5519: Squad-fanen på U23 team- og Junior team-siden.
//
// HANDOFF 2/9 (docs/design/youth-tiers/HANDOFF.md, komponent-noter): "Squad
// page = TeamPage.jsx reused with `squad` param; DataTable columns as My Team".
// Kolonnerne og deres rækkefølge er derfor My Teams (nation · rytter · rating ·
// type · alder · potentiale · værdi · løn · kontrakt), og overskrifterne
// læses fra team-namespacet, så de to sider aldrig kalder den samme kolonne to
// ting. My Teams senior-specifikke kolonner (popularitet, status, handling) er
// ikke med: status-badgesne er senior-vagter, og rækkehandlingerne (Move up /
// Move down) hører til trup-flyt-slicen, ikke til denne side.
//
// Værdien står i --text-1 og ikke i guld-tekst som på My Team: TASTE fork 3
// forbyder guld-tal.
//
// Mobil (D-047): rating, værdi og løn, præcis som My Team (ejer 10/9).
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import NationCell from "../rider/NationCell.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import ScoutablePotentiale from "../rider/ScoutablePotentiale.jsx";
import { useTypeColumnLabel } from "../../lib/useBestRoleDisplay.js";
import { useTableSort } from "../../lib/useTableSort.js";
import { riderOverallRating } from "../../lib/riderRating.js";
import { statPlateStyle } from "../../lib/statColor.js";
import { getRiderMarketValue } from "../../lib/marketValues.js";
import { getRiderAge } from "../../lib/riderAge.js";
import { getCountryCode3 } from "../../lib/countryUtils.js";
import { scoutSortValue } from "../../lib/scouting.js";
import { formatNumber } from "../../lib/intl.js";
import { DataTable, RiderLink, WithBestRole, type DataTableColumn } from "./squadUi.ts";
import type { YouthSquadRider } from "./useYouthSquad.ts";

interface Scouting {
  estimateFor: (riderId: string) => unknown;
}

interface Row extends YouthSquadRider {
  _ovr: number | null;
  _age: number | null;
  _value: number;
  _scoutMid: number | null;
}

// Modul-konstant: useTableSort re-sorterer ellers på hver render.
const ACCESSORS: Record<string, (r: Row) => unknown> = {
  nationality_code: (r) => r.nationality_code,
  name: (r) => `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
  _ovr: (r) => r._ovr,
  primary_type: (r) => r.primary_type,
  age: (r) => r._age,
  _scoutMid: (r) => r._scoutMid,
  _value: (r) => r._value,
  salary: (r) => r.salary,
  contract_end_season: (r) => r.contract_end_season,
};
const DESC_FIRST = new Set(["_ovr", "age", "_scoutMid", "_value", "salary", "contract_end_season"]);
const SORT_OPTS = { descFirstKeys: DESC_FIRST };
const MOBILE_DEFAULTS = ["rating", "value", "salary"];

export default function YouthSquadTable({ riders, scouting, seasonYear, label }: {
  riders: YouthSquadRider[];
  scouting: Scouting;
  seasonYear: number | null;
  label: string;
}) {
  const { t } = useTranslation("team");
  const typeColumnLabel = useTypeColumnLabel(t("squad.headers.type")); // #5435
  const navigate = useNavigate();

  const decorated = useMemo<Row[]>(() => riders.map((r) => {
    const ovr = riderOverallRating(r);
    return {
      ...r,
      _ovr: Number.isFinite(ovr) ? (ovr as number) : null,
      _age: getRiderAge(r.birthdate, seasonYear) ?? null,
      _value: getRiderMarketValue(r),
      _scoutMid: scoutSortValue(scouting.estimateFor(r.id)) ?? null,
    };
  }), [riders, scouting, seasonYear]);

  const { rows, sort, sortDir, handleSort } = useTableSort(decorated, ACCESSORS, SORT_OPTS);

  const columns: DataTableColumn<Row>[] = [
    {
      key: "nation",
      header: t("squad.headers.nation"),
      sortKey: "nationality_code",
      fold: true,
      foldValue: (r) => getCountryCode3(r.nationality_code) || "—",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    {
      key: "name",
      header: t("squad.headers.rider"),
      sticky: true,
      sortKey: "name",
      render: (r) => (
        <RiderLink id={r.id} stopPropagation className="text-cz-1 hover:text-cz-accent-t transition-colors">
          {r.firstname} {r.lastname}
        </RiderLink>
      ),
    },
    {
      key: "rating",
      header: <span title={t("squad.headers.ratingTitle")}>{t("squad.headers.rating")}</span>,
      mobileLabel: t("squad.headers.rating"),
      sortKey: "_ovr",
      numeric: true,
      compact: true,
      render: (r) => (r._ovr != null ? (
        <WithBestRole rider={r}>
          <span className="inline-flex items-center justify-center min-w-[30px] px-1.5 py-0.5 rounded-cz font-semibold"
            style={statPlateStyle(r._ovr)}>
            {r._ovr}
          </span>
        </WithBestRole>
      ) : <span className="text-cz-3">—</span>),
    },
    {
      key: "type",
      header: typeColumnLabel,
      sortKey: "primary_type",
      compact: true,
      render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} stacked />,
    },
    {
      key: "age",
      header: t("squad.headers.age"),
      sortKey: "age",
      numeric: true,
      compact: true,
      fold: true,
      foldValue: (r) => String(r._age ?? "—"),
      render: (r) => <span className="text-cz-2">{r._age ?? "—"}</span>,
    },
    {
      key: "potential",
      header: <span title={t("squad.headers.potentialTitle")}>{t("squad.headers.potential")}</span>,
      mobileLabel: t("squad.headers.potential"),
      sortKey: "_scoutMid",
      compact: true,
      render: (r) => <ScoutablePotentiale rider={r} scouting={scouting} labelAsTitle hideLevel />,
    },
    {
      key: "value",
      header: t("squad.headers.value"),
      sortKey: "_value",
      numeric: true,
      compact: true,
      render: (r) => <span className="text-cz-1">{formatNumber(r._value)}</span>,
    },
    {
      key: "salary",
      header: t("squad.headers.salary"),
      sortKey: "salary",
      numeric: true,
      compact: true,
      render: (r) => <span className="text-cz-2">{formatNumber(r.salary ?? 0)}</span>,
    },
    {
      key: "contract",
      header: t("squad.headers.contract"),
      sortKey: "contract_end_season",
      compact: true,
      render: (r) => (
        <span className="text-cz-2 whitespace-nowrap">
          {r.contract_end_season != null ? t("squad.headers.contractUntil", { season: r.contract_end_season }) : "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      mobileDefaults={MOBILE_DEFAULTS}
      dense
      rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
      sort={sort}
      sortDir={sortDir}
      onSort={handleSort}
      count={t("squad.count", { count: rows.length })}
    />
  );
}
