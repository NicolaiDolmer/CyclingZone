// #8081 / #8036 (ejervalg 16/11): "Dine talenter" i akademisiden udgave A.
//
// Primær og sekundær ryttertype står ALTID ved talentet, fra den dag han er hentet. Det er de
// persisterede riders.primary_type/secondary_type, ikke prognosen, så de kræver intet
// kendskabs-trin. Prognosen står i sin egen kolonne på sit eget trin.
//
// Ingen rækkehandlinger (#6155): flyt og fyring sker på rytterprofilen, som for alle ryttere.
// Navnet er linket. Tabellen er DataTable med sortering på alle kolonner (TASTE 7a).
// Kun egen avl (ejer 16/11): AcademyV2 filtrerer listen, så "Kom via" fra skitse A er fjernet.
// Mobilens kolonne-chips er firkantede (5px), ikke piller: kun her, via en CSS-regel på wrapperen,
// så den delte DataTable (første indlæsning) er uændret.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import NationCell from "../rider/NationCell.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import AcademyPrognosisCell, { type AcademyPrognosis } from "../rider/AcademyPrognosisCell.tsx";
import PotentialEstimate from "../rider/PotentialEstimate.tsx";
import { PrognosisValue } from "../rider/PotentialEstimate.tsx";
import { potentialViewOf, prognosisViewOf } from "../../lib/potentialEstimateDisplay.ts";
import { DataTable, EmptyState, RiderLink, type DataTableColumn } from "../squad/squadUi.ts";
import { useTableSort } from "../../lib/useTableSort.js";
import { riderNameSortKey } from "../../lib/riderColumnSort.js";
import { getRiderAge } from "../../lib/riderAge.js";
import { getCountryCode3 } from "../../lib/countryUtils.js";
import { useTypeColumnLabel } from "../../lib/useTypeColumnLabel.ts";
import { talentSquad } from "./academyV2Model.ts";
import type { ReactNode } from "react";

export interface TalentRider {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  birthdate?: string | null;
  nationality_code?: string | null;
  primary_type?: string | null;
  secondary_type?: string | null;
  squad?: string | null;
  team_id?: string | null;
  prognosis?: AcademyPrognosis | null;
}

interface Row extends TalentRider {
  _age: number | null;
  _squad: string | null;
  _band: number | null;
  _prognosis: number | null;
}

// Modul-konstanter: useTableSort re-sorterer ellers på hver render.
const ACCESSORS: Record<string, (r: Row) => unknown> = {
  nationality_code: (r) => r.nationality_code,
  name: (r) => riderNameSortKey(r),
  primary_type: (r) => r.primary_type,
  squad: (r) => r._squad,
  age: (r) => r._age,
  prognosis: (r) => r._band,
  pacePrognosis: (r) => r._prognosis,
};
const SORT_OPTS = { descFirstKeys: new Set(["prognosis", "pacePrognosis"]) };
const MOBILE_DEFAULTS = ["type", "age", "prognosis"];

/** #8523: den samlede prognoses tal; skjult/ukendt sidst. */
function prognosisSortValue(r: TalentRider): number | null {
  const view = prognosisViewOf(r);
  return view && !view.hidden ? view.value : null;
}

/** Sortering: skønnets tal, ellers prognose-båndets bund; skjult/ukendt sidst. */
function potentialSortValue(r: TalentRider): number | null {
  const view = potentialViewOf(r);
  if (view) return view.hidden ? null : view.value;
  return r.prognosis?.band?.lo ?? null;
}

export default function TalentTable({ roster, seasonYear, emptyAction }: {
  roster: TalentRider[];
  seasonYear: number | null;
  emptyAction: ReactNode;
}) {
  const { t } = useTranslation(["academy", "academyV2"]);
  const typeColumnLabel = useTypeColumnLabel();

  const decorated = useMemo<Row[]>(() => roster.map((r) => ({
    ...r,
    _age: getRiderAge(r.birthdate, seasonYear) ?? null,
    _squad: talentSquad(r, seasonYear),
    _band: potentialSortValue(r),
    _prognosis: prognosisSortValue(r),
  })), [roster, seasonYear]);
  // #8523: med tændt flag er kolonnen potentialet (tal + ord), og den samlede prognose
  // får sin egen kolonne. Slukket findes felterne ikke, og tabellen er som før.
  const estimateOn = roster.some((r) => potentialViewOf(r) != null);
  const { rows, sort, sortDir, handleSort } = useTableSort(decorated, ACCESSORS, SORT_OPTS);

  const columns: DataTableColumn<Row>[] = [
    {
      key: "nation",
      header: t("academyV2:v2.talents.colNation"),
      sortKey: "nationality_code",
      fold: true,
      foldValue: (r) => getCountryCode3(r.nationality_code) || "–",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    {
      key: "name",
      header: t("academyV2:v2.talents.colRider"),
      sticky: true,
      sortKey: "name",
      render: (r) => (
        <RiderLink id={r.id} className="text-cz-1 hover:text-cz-accent-t transition-colors">
          {r.firstname} {r.lastname}
        </RiderLink>
      ),
    },
    {
      key: "type",
      header: typeColumnLabel,
      mobileLabel: t("academyV2:v2.talents.colType"),
      sortKey: "primary_type",
      compact: true,
      render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} stacked />,
    },
    {
      key: "squad",
      header: t("academyV2:v2.talents.colSquad"),
      sortKey: "squad",
      compact: true,
      render: (r) => <span className="text-cz-2">{r._squad ? t(`academyV2:v2.squad.${r._squad}`) : "–"}</span>,
    },
    {
      key: "age",
      header: t("academyV2:v2.talents.colAge"),
      sortKey: "age",
      numeric: true,
      compact: true,
      render: (r) => <span className="text-cz-1">{r._age ?? "–"}</span>,
    },
    {
      key: "prognosis",
      header: estimateOn ? <span title={t("riders:potentialNumber.potentialTitle")}>{t("riders:potentialNumber.potential")}</span> : t("academyV2:v2.talents.colPrognosis"),
      sortKey: "prognosis",
      render: (r) => {
        const view = potentialViewOf(r);
        if (view) return <PotentialEstimate view={view} />;
        return r.prognosis ? <AcademyPrognosisCell prognosis={r.prognosis} /> : <span className="text-cz-2">–</span>;
      },
    },
    ...(estimateOn ? [{
      key: "pacePrognosis",
      header: <span title={t("riders:potentialNumber.prognosisTitle")}>{t("riders:potentialNumber.prognosis")}</span>,
      mobileLabel: t("riders:potentialNumber.prognosis"),
      sortKey: "pacePrognosis",
      numeric: true,
      render: (r: Row) => {
        const view = prognosisViewOf(r);
        return view ? <PrognosisValue view={view} /> : <span className="text-cz-2">–</span>;
      },
    } satisfies DataTableColumn<Row>] : []),
  ];

  return (
    <div data-testid="academy-v2-talents" className="[&_.rounded-cz-pill]:rounded-cz">
      <DataTable
        label={t("academyV2:v2.tabs.talents")}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        mobileDefaults={MOBILE_DEFAULTS}
        dense
        sort={sort}
        sortDir={sortDir}
        onSort={handleSort}
        count={t("academyV2:v2.talents.count", { count: rows.length })}
        empty={(
          <EmptyState
            title={t("academyV2:v2.talents.emptyTitle")}
            description={t("academyV2:v2.talents.emptyBody")}
            action={emptyAction}
          />
        )}
      />
    </div>
  );
}
