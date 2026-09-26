// #5519: Squad-fanen på U23 team- og Junior team-siden.
//
// HANDOFF 2/9 (docs/design/youth-tiers/HANDOFF.md, komponent-noter): "Squad
// page = TeamPage.jsx reused with `squad` param; DataTable columns as My Team".
// Kolonnerne og deres rækkefølge er derfor My Teams (nation · rytter · rating ·
// type · alder · potentiale · værdi · løn · kontrakt), og overskrifterne
// læses fra team-namespacet, så de to sider aldrig kalder den samme kolonne to
// ting. Rækkehandlingerne (Move up / Move down) hører til trup-flyt-slicen,
// ikke til denne side.
//
// Værdien står i --text-1 og ikke i guld-tekst som på My Team: TASTE fork 3
// forbyder guld-tal.
//
// Mobil (D-047): rating, værdi og løn, præcis som My Team (ejer 10/9).
//
// #5631 (spillere i beta-forummet 24/9: "Abilities is also missing and is only
// accessible from the My Team"): samme to kolonne-tilstande som My Team
// (Overview / Abilities, Segmented i tabellens toolbar, #2906 punkt 1), og
// Overview har nu My Teams popularitet og status, så kolonnerne står i samme
// rækkefølge på de tre trup-sider. Kun rækkehandlingen (Sell / Auction) er
// stadig My Teams alene.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import NationCell from "../rider/NationCell.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import ScoutablePotentiale from "../rider/ScoutablePotentiale.jsx";
import { useTypeColumnLabel } from "../../lib/useBestRoleDisplay.js";
import { useTableSort } from "../../lib/useTableSort.js";
import { riderNameSortKey } from "../../lib/riderColumnSort.js";
import { riderOverallRating } from "../../lib/riderRating.js";
import { statPlateStyle } from "../../lib/statColor.js";
import { getRiderMarketValue } from "../../lib/marketValues.js";
import { getRiderAge } from "../../lib/riderAge.js";
import { getCountryCode3 } from "../../lib/countryUtils.js";
import { scoutSortValue } from "../../lib/scouting.js";
import { formatNumber } from "../../lib/intl.js";
import { isRiderInjured } from "../../lib/training.js";
import { ABILITY_STATS } from "../../lib/abilities.js";
import { DataTable, RiderBadges, RiderLink, Segmented, WithBestRole, type DataTableColumn } from "./squadUi.ts";
import { ABILITY_MODE_MOBILE_DEFAULTS, useAbilityColumns } from "./abilityColumns.tsx";
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
const ABILITY_KEYS = (ABILITY_STATS as Array<{ key: string }>).map((s) => s.key);
const ACCESSORS: Record<string, (r: Row) => unknown> = {
  nationality_code: (r) => r.nationality_code,
  name: (r) => riderNameSortKey(r), // #5805: efternavn + fornavn som My Team
  _ovr: (r) => r._ovr,
  primary_type: (r) => r.primary_type,
  age: (r) => r._age,
  _scoutMid: (r) => r._scoutMid,
  _value: (r) => r._value,
  salary: (r) => r.salary,
  popularity: (r) => (Number.isFinite(r.popularity) ? r.popularity : null),
  contract_end_season: (r) => r.contract_end_season,
  ...Object.fromEntries(ABILITY_KEYS.map((k) => [k, (r: Row) => Number(r[k]) || 0])),
};
const DESC_FIRST = new Set(["_ovr", "age", "_scoutMid", "_value", "salary", "popularity", "contract_end_season", ...ABILITY_KEYS]);
const SORT_OPTS = { descFirstKeys: DESC_FIRST };
const MOBILE_DEFAULTS = ["rating", "value", "salary"];

type TableMode = "overview" | "abilities";

export default function YouthSquadTable({ riders, scouting, seasonYear, label }: {
  riders: YouthSquadRider[];
  scouting: Scouting;
  seasonYear: number | null;
  label: string;
}) {
  const { t } = useTranslation("team");
  const typeColumnLabel = useTypeColumnLabel(t("squad.headers.type")); // #5435
  const navigate = useNavigate();
  const [tableMode, setTableMode] = useState<TableMode>("overview");
  const abilityColumns = useAbilityColumns<Row>();

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

  const overviewColumns: DataTableColumn<Row>[] = [
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
    // #5631: My Teams popularitet og status (#3956 / #1482), samme plads i
    // rækkefølgen. Status viser kun skade: alders-badgen ville stå på hver
    // eneste række af en ungdomstrup, og akademi-/transfer-badgesne hører til
    // My Team.
    {
      key: "popularity",
      header: <span title={t("squad.headers.popularityTitle")}>{t("squad.headers.popularity")}</span>,
      mobileLabel: t("squad.headers.popularity"),
      sortKey: "popularity",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className="text-cz-2 font-mono text-xs">
          {Number.isFinite(r.popularity) ? String(r.popularity) : "—"}
        </span>
      ),
    },
    {
      key: "badges",
      header: t("squad.headers.badges"),
      compact: true,
      render: (r) => <RiderBadges badges={[isRiderInjured(r.injured_until) && "injured"]} />,
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

  // Evne-tilstand som på My Team: navn + rating + type + de 15 evner.
  const pick = (key: string) => overviewColumns.filter((c) => c.key === key);
  const columns = tableMode === "abilities"
    ? [...pick("name"), ...pick("rating"), ...pick("type"), ...abilityColumns]
    : overviewColumns;

  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      mobileDefaults={tableMode === "abilities" ? ABILITY_MODE_MOBILE_DEFAULTS : MOBILE_DEFAULTS}
      dense
      rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
      sort={sort}
      sortDir={sortDir}
      onSort={handleSort}
      toolbar={
        <Segmented
          className="ms-auto"
          label={t("squad.mode.ariaLabel")}
          value={tableMode}
          onChange={(next) => setTableMode(next as TableMode)}
          options={[
            { value: "overview", label: t("squad.mode.overview") },
            { value: "abilities", label: t("squad.mode.abilities") },
          ]}
        />
      }
      count={t("squad.count", { count: rows.length })}
    />
  );
}
