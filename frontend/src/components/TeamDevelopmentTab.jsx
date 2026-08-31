import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import RiderLink from "./RiderLink";
import RiderTypeBadge from "./rider/RiderTypeBadge";
import { statPlateStyle } from "../lib/statColor";
import { riderOverallRating } from "../lib/riderRating";
import { getRiderAge } from "../lib/riderAge";
import { cycleSortState } from "../lib/riderSort";
import { compareDevRows } from "../lib/teamDevelopmentSort.js";
import { DataTable, EmptyState, BikeIcon } from "./ui";

// #3979/#3721 (ejer-beslutning 19/8, "Begge, A foerst" superseded samme
// eftermiddag af "bundles med #3798, en stor opdatering") — holdsidens LETTE
// udviklings-tabel. Variant B fra mockuppen: rating (nu) ved siden af
// prognose ("lo-hi", #3746) og loft, sortérbar, INGEN pace-kolonne (#3564 er
// ikke bygget endnu — se issuets kommentar 19/8 15:17).
//
// Data genbruges 1:1 fra useScouting() (samme hook som ScoutablePotentiale/
// SquadTab bruger) — ingen nyt endpoint, ingen ny hente-logik. Estimatet
// leverer { now, prog:{lo,hi}, loft } for egne ryttere (isOwn ⇒ maxLevel,
// backend/routes/api.js's POST /api/scouting/estimates). Ryttere uden bånd
// (defensiv gren — mangler primary_type/evne-data, se ScoutablePotentiale.jsx's
// samme fallback) viser rating alene + "no forecast yet" i muted, INGEN
// tankestreg i selve teksten (kun den kanoniske "—"-tomværdi-glyf i Loft-
// cellen, tilladt per tone-check-em-dash.mjs's tomværdi-undtagelse).
//
// `riders` = holdets NUVÆRENDE senior+akademi-trup (TeamPage.jsx's
// `currentRiders`, samme array SquadTab/TeamStatsTab allerede får).
export default function TeamDevelopmentTab({ riders, scouting, seasonYear }) {
  const { t } = useTranslation("team");
  const navigate = useNavigate();
  const [sort, setSort] = useState("_progHi");
  const [sortDir, setSortDir] = useState("desc");

  const riderIds = riders.map((r) => r.id);
  const riderIdsKey = riderIds.join(",");

  // Samme batched request-mønster som ScoutablePotentiale (useScouting.js's
  // requestEstimates dedupliker + batcher selv) — men denne tabel renderer
  // ikke ScoutablePotentiale pr. række (egen lo-hi/loft-visning), så den skal
  // selv bede om estimaterne for hele truppen når fanen mountes.
  useEffect(() => {
    if (riderIds.length > 0) scouting.requestEstimates(riderIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- riderIdsKey er den stabile streng-proxy for riderIds (nyt array-ref hver render); scouting-context'et er stabilt
  }, [riderIdsKey]);

  function handleSort(key) {
    const next = cycleSortState({ sort, dir: sortDir }, key);
    setSort(next.sort);
    setSortDir(next.dir);
  }

  // Dekorerer rækkerne med de sammenlignelige tal (samme princip som SquadTab's
  // _ovr/_scoutMid) — DataTable/sortComparatoren kender ikke selv til estimate-
  // objektets form.
  const decorated = useMemo(() => riders.map((r) => {
    const ovr = riderOverallRating(r);
    const estimate = scouting.estimateFor(r.id);
    // undefined = ikke hentet endnu, null = intet potentiale, hidden = skjult
    // (defensivt her — egne ryttere er altid isOwn/maxLevel server-side).
    const band = estimate && !estimate.hidden ? (estimate.prog ?? estimate.ceil) : null;
    const hasBand = Boolean(band && Number.isFinite(band.lo) && Number.isFinite(band.hi));
    const loft = estimate && !estimate.hidden && Number.isFinite(estimate.loft) ? estimate.loft : null;
    return {
      ...r,
      _age: getRiderAge(r.birthdate, seasonYear),
      _ovr: Number.isFinite(ovr) ? ovr : null,
      _band: hasBand ? band : null,
      _progHi: hasBand ? band.hi : null,
      _loft: loft,
      // #4039: samme forbi-peak-dæmpning som hero/scouting-fanen — loftet er
      // stadig absolut, kun forklaringen (tooltip) skifter.
      _pastPeak: estimate?.pastPeak === true,
    };
  }), [riders, scouting, seasonYear]);

  const rows = useMemo(() => {
    const result = [...decorated];
    result.sort((a, b) => compareDevRows(a, b, sort, sortDir));
    return result;
  }, [decorated, sort, sortDir]);

  const columns = [
    {
      key: "name",
      header: t("squad.headers.rider"),
      sticky: true,
      sortKey: "firstname",
      render: (r) => (
        <RiderLink id={r.id} stopPropagation className="text-cz-1 hover:text-cz-accent-t transition-colors">
          {r.firstname} {r.lastname}
        </RiderLink>
      ),
    },
    {
      key: "age",
      header: t("squad.headers.age"),
      sortKey: "_age",
      numeric: true,
      compact: true,
      fold: true,
      foldValue: (r) => String(r._age ?? "—"),
      render: (r) => <span className="text-cz-2">{r._age ?? "—"}</span>,
    },
    // Tester-feedback 20/8 (#3798): uden typen skal spilleren gætte hvilken
    // rolle prognosen/loftet gælder. Samme kanoniske kolonne som SquadTab
    // (ejer 25/7: typen står ALTID i sin egen kolonne, aldrig i navnecellen).
    {
      key: "type",
      header: t("squad.headers.type"),
      sortKey: "primary_type",
      compact: true,
      render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} stacked />,
    },
    {
      key: "rating",
      header: <span title={t("squad.headers.ratingTitle")}>{t("squad.headers.rating")}</span>,
      sortKey: "_ovr",
      numeric: true,
      compact: true,
      render: (r) => (r._ovr != null ? (
        <span className="inline-flex items-center justify-center min-w-[30px] px-1.5 py-0.5 rounded-cz font-semibold"
          style={statPlateStyle(r._ovr)}>
          {r._ovr}
        </span>
      ) : <span className="text-cz-3">—</span>),
    },
    {
      key: "projected",
      header: <span title={t("development.headers.projectedTitle")}>{t("development.headers.projected")}</span>,
      sortKey: "_progHi",
      numeric: true,
      compact: true,
      render: (r) => (r._band ? (
        <span className="font-mono tabular-nums text-cz-1">{r._band.lo}–{r._band.hi}</span>
      ) : (
        <span className="text-cz-3 text-xs whitespace-nowrap">{t("development.noForecast")}</span>
      )),
    },
    {
      key: "ceiling",
      header: <span title={t("development.headers.ceilingTitle")}>{t("development.headers.ceiling")}</span>,
      sortKey: "_loft",
      numeric: true,
      compact: true,
      // #4039: samme forbi-peak-dæmpning i tooltippen som hero/scouting-fanen —
      // tallet er uændret, kun forklaringen af HVORFOR skifter.
      render: (r) => (
        <span
          className="font-mono tabular-nums text-cz-2"
          title={r._loft != null && r._pastPeak ? t("rider:scouting.loftPastPeakTitle", { value: r._loft }) : undefined}
        >
          {r._loft ?? "—"}
        </span>
      ),
    },
  ];

  if (riders.length === 0) {
    return (
      <EmptyState
        icon={<BikeIcon size={26} aria-hidden="true" />}
        title={t("squad.emptyState")}
        description={t("squad.emptyStateBody")}
      />
    );
  }

  return (
    <DataTable
      label={t("tabs.development")}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      dense
      rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
      sort={sort}
      sortDir={sortDir}
      onSort={handleSort}
      count={t("squad.count", { count: rows.length })}
    />
  );
}
