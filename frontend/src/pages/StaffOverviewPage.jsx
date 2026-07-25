// Personale-oversigt (#2450) — alt aktivt staff på tværs af hold, filtrerbart på
// rolle/hold/kvalitet. Klik → /staff/:id (samme profil-route som klub-siden
// bruger for eget staff; useStaffProfile falder tilbage til candidate-niveau
// visning for staff man ikke selv ejer, jf. #2450-scope).
//
// #2849 bølge 2 — migreret til T2 wide-data-skabelonen (docs/design/PAGE_TEMPLATES.md):
// PageHeader-recipe, ui/DataTable (sticky navn+rolle/hold-subline, mobil-fold,
// count-linje) i stedet for den rå table-markup + hånd-rullet sticky-thead-skygge,
// canoniske SkeletonLines/EmptyState/ErrorState. Ren layout-migrering — INGEN
// ændringer i filtre, sortering, klik-til-profil eller dataflow.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useStaffDirectory } from "../lib/useStaffDirectory.js";
import { useStaffRelease } from "../lib/useStaffRelease.js";
import { supabase } from "../lib/supabase.js";
import { formatNumber } from "../lib/intl";
import { statStyle } from "../lib/statColor.js";
import {
  Card, Select, Input, EmptyState, ErrorState, Checkbox, Button,
  PageHeader, DataTable, SkeletonLines, BriefcaseIcon,
} from "../components/ui";
import { WRAP } from "../components/ui/dataTableStyles.js";
import { labelClass } from "../components/ui/fieldStyles.js";
import ReleaseStaffModal from "../components/staff/ReleaseStaffModal.jsx";

const ROLES = ["training", "scouting", "medical", "academy", "commercial"];
const TIERS = [1, 2, 3, 4, 5];

function OverallBadge({ value }) {
  return (
    <span
      className="inline-block min-w-[30px] rounded px-1.5 py-0.5 text-center font-data text-xs tabular-nums"
      style={statStyle(value)}
    >
      {value ?? "—"}
    </span>
  );
}

export default function StaffOverviewPage() {
  const { t } = useTranslation("staffOverview");
  const { t: tStaff } = useTranslation("staff");
  const navigate = useNavigate();
  const [includeAi, setIncludeAi] = useState(false);
  const { staff, enabled, loading, error, refresh } = useStaffDirectory({ includeAi });
  const { release, busy: releaseBusy } = useStaffRelease();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [minTier, setMinTier] = useState("");
  const [myTeamId, setMyTeamId] = useState(null);
  const [releasingRow, setReleasingRow] = useState(null); // #2649 — row Release-knappen blev åbnet fra
  const [releaseError, setReleaseError] = useState(null);

  // #2649: samme fejlkode-mapping som StaffProfilePage.jsx (endpointet returnerer
  // korte koder, ikke #678's errorCode/errorParams-kontrakt).
  async function confirmRelease() {
    if (!releasingRow) return;
    setReleaseError(null);
    const r = await release(releasingRow.id);
    if (r.ok) {
      setReleasingRow(null);
      await refresh();
      return;
    }
    if (r.error === "insufficient_funds") {
      setReleaseError(tStaff("release.errors.insufficient_funds", { amount: formatNumber(r.severance) }));
      return;
    }
    setReleaseError(tStaff(`release.errors.${r.error}`, { defaultValue: tStaff("release.errors.failed") }));
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle()
        .then(({ data }) => setMyTeamId(data?.id ?? null));
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((row) => {
      if (roleFilter && row.role !== roleFilter) return false;
      if (minTier && row.tier < Number(minTier)) return false;
      if (q && !row.name.toLowerCase().includes(q) && !(row.teamName ?? "").toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => b.overall - a.overall);
  }, [staff, search, roleFilter, minTier]);

  if (loading) return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("page.title")} />
      <div className={`${WRAP} p-5`}>
        <SkeletonLines lines={6} />
      </div>
    </div>
  );

  if (!enabled) return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("page.title")} />
      <EmptyState title={t("disabled.title")} description={t("disabled.description")} />
    </div>
  );

  if (error) return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("page.title")} />
      <ErrorState
        title={t("error.title")}
        description={t("error.description")}
        action={
          <Button size="sm" variant="secondary" onClick={refresh}>
            {t("error.retry", { defaultValue: "Try again" })}
          </Button>
        }
      />
    </div>
  );

  const columns = [
    {
      key: "name",
      header: t("table.name"),
      sticky: true,
      render: (row) => (
        <>
          <span>{row.name}</span>
          {row.teamId === myTeamId && (
            <span
              className="ms-2 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}
            >
              {t("table.mine")}
            </span>
          )}
        </>
      ),
      // #2849: rolle + hold var tidligere egne (altid synlige) kolonner — konsolideret
      // i den sticky navnecelles subline (T2-recept: "navn + rolle/hold-subline").
      subline: (row) => (
        <>
          {tStaff(`roles.${row.role}`)} · {row.teamName ?? "—"}
          {row.isAiTeam && <> · {t("table.ai")}</>}
        </>
      ),
    },
    {
      key: "division",
      header: t("table.division"),
      fold: true,
      foldValue: (row) => row.division ?? "—",
      render: (row) => row.division ?? "—",
    },
    {
      key: "tier",
      header: t("table.tier"),
      numeric: true,
      render: (row) => `T${row.tier}`,
    },
    {
      key: "specialization",
      header: t("table.specialization"),
      fold: true,
      foldValue: (row) => (row.topSpecialization ? tStaff(`axes.${row.topSpecialization}`) : "—"),
      render: (row) => (row.topSpecialization ? tStaff(`axes.${row.topSpecialization}`) : "—"),
    },
    {
      key: "overall",
      header: t("table.overall"),
      numeric: true,
      render: (row) => <OverallBadge value={row.overall} />,
    },
    {
      key: "salary",
      header: t("table.salary"),
      numeric: true,
      render: (row) => formatNumber(row.salary),
    },
    {
      key: "actions",
      header: t("table.actions"),
      numeric: true,
      render: (row) => (
        row.teamId === myTeamId ? (
          <Button
            variant="danger"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setReleasingRow(row); }}
          >
            {tStaff("release.button")}
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle", { count: formatNumber(filtered.length) })} />

      {/* Filter-bar (T2-recept): search Input + op til 3 Selects + Checkbox */}
      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="staff-search" className={labelClass()}>{t("filters.search")}</label>
          <Input id="staff-search" size="sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("filters.searchPlaceholder")} />
        </div>
        <div>
          <label htmlFor="staff-role" className={labelClass()}>{t("filters.role")}</label>
          <Select id="staff-role" size="sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">{t("filters.allRoles")}</option>
            {ROLES.map((r) => <option key={r} value={r}>{tStaff(`roles.${r}`)}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="staff-min-tier" className={labelClass()}>{t("filters.minTier")}</label>
          <Select id="staff-min-tier" size="sm" value={minTier} onChange={(e) => setMinTier(e.target.value)}>
            <option value="">{t("filters.anyTier")}</option>
            {TIERS.map((tier) => <option key={tier} value={tier}>{`T${tier}+`}</option>)}
          </Select>
        </div>
        <div className="flex items-end pb-2">
          <Checkbox id="staff-include-ai" checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)} label={t("filters.includeAi")} />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState icon={<BriefcaseIcon size={26} aria-hidden="true" />} title={t("table.emptyFiltered")} />
      ) : (
        <DataTable
          label={t("page.title")}
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          rowProps={(row) => ({ onClick: () => navigate(`/staff/${row.id}`), className: "cursor-pointer" })}
          count={t("table.count", {
            filtered: formatNumber(filtered.length),
            total: formatNumber(staff.length),
            defaultValue: `Showing ${formatNumber(filtered.length)} of ${formatNumber(staff.length)} staff`,
          })}
        />
      )}

      <ReleaseStaffModal
        show={Boolean(releasingRow)}
        staffName={releasingRow?.name}
        role={releasingRow?.role}
        salary={releasingRow?.salary}
        error={releaseError}
        busy={releaseBusy}
        onCancel={() => { if (!releaseBusy) { setReleasingRow(null); setReleaseError(null); } }}
        onConfirm={confirmRelease}
      />
    </div>
  );
}
