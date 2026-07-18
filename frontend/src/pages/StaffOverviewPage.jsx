// Personale-oversigt (#2450) — alt aktivt staff på tværs af hold, filtrerbart på
// rolle/hold/kvalitet. Klik → /staff/:id (samme profil-route som klub-siden
// bruger for eget staff; useStaffProfile falder tilbage til candidate-niveau
// visning for staff man ikke selv ejer, jf. #2450-scope).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useStaffDirectory } from "../lib/useStaffDirectory.js";
import { useStaffRelease } from "../lib/useStaffRelease.js";
import { supabase } from "../lib/supabase.js";
import { formatNumber } from "../lib/intl";
import { statStyle } from "../lib/statColor.js";
import { Card, Select, Input, EmptyState, PageLoader, Checkbox, Button } from "../components/ui";
import ReleaseStaffModal from "../components/staff/ReleaseStaffModal.jsx";

const ROLES = ["training", "scouting", "medical", "academy", "commercial"];
const TIERS = [1, 2, 3, 4, 5];

function OverallBadge({ value }) {
  return (
    <span className="inline-block min-w-[30px] text-center text-xs font-mono px-1.5 py-0.5 rounded" style={statStyle(value)}>
      {value ?? "—"}
    </span>
  );
}

function StaffRow({ row, isMine, onSelect, onRelease, t, tStaff }) {
  return (
    <tr onClick={() => onSelect(row)} className="border-b border-cz-border hover:bg-cz-subtle cursor-pointer transition-colors">
      <td className="px-3 py-2.5">
        <span className="text-cz-1 font-medium">{row.name}</span>
        {isMine && <span className="ms-2 px-1.5 py-[1px] rounded-cz-pill bg-cz-accent/15 text-cz-accent-t text-[10px] uppercase tracking-wide">{t("table.mine")}</span>}
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell text-cz-2 text-xs">{tStaff(`roles.${row.role}`)}</td>
      <td className="px-3 py-2.5 text-cz-2 text-xs">
        {row.teamName ?? "—"}
        {row.isAiTeam && <span className="ms-1 text-cz-3 text-[10px] uppercase">{t("table.ai")}</span>}
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell text-cz-2 text-xs">{row.division ?? "—"}</td>
      <td className="px-2 py-2.5 text-center text-cz-2 text-xs font-mono">T{row.tier}</td>
      <td className="px-3 py-2.5 hidden sm:table-cell text-cz-2 text-xs">
        {row.topSpecialization ? tStaff(`axes.${row.topSpecialization}`) : "—"}
      </td>
      <td className="px-2 py-2.5 text-center"><OverallBadge value={row.overall} /></td>
      <td className="px-3 py-2.5 text-right text-cz-2 text-xs font-mono">{formatNumber(row.salary)}</td>
      <td className="px-3 py-2.5 text-right">
        {isMine && (
          <Button
            variant="danger"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onRelease(row); }}
          >
            {tStaff("release.button")}
          </Button>
        )}
      </td>
    </tr>
  );
}

export default function StaffOverviewPage() {
  const { t } = useTranslation("staffOverview");
  const { t: tStaff } = useTranslation("staff");
  const { t: tCommon } = useTranslation("common");
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

  if (loading) return <PageLoader />;
  if (!enabled) return <EmptyState title={t("disabled.title")} description={t("disabled.description")} />;
  if (error) return <EmptyState title={t("error.title")} description={t("error.description")} />;

  return (
    <div className="max-w-full">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
        <p className="text-cz-3 text-sm">{t("page.subtitle", { count: formatNumber(filtered.length) })}</p>
      </div>

      <div className="max-w-[1600px] mb-4">
        <Card className="p-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-cz-3 text-[10px] uppercase tracking-wider">{t("filters.search")}</span>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("filters.searchPlaceholder")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-cz-3 text-[10px] uppercase tracking-wider">{t("filters.role")}</span>
              <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="">{t("filters.allRoles")}</option>
                {ROLES.map((r) => <option key={r} value={r}>{tStaff(`roles.${r}`)}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-cz-3 text-[10px] uppercase tracking-wider">{t("filters.minTier")}</span>
              <Select value={minTier} onChange={(e) => setMinTier(e.target.value)}>
                <option value="">{t("filters.anyTier")}</option>
                {TIERS.map((tier) => <option key={tier} value={tier}>{`T${tier}+`}</option>)}
              </Select>
            </label>
            <label className="flex items-center gap-2 pb-2">
              <Checkbox checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)} />
              <span className="text-cz-2 text-xs">{t("filters.includeAi")}</span>
            </label>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="w-full text-xs" data-sort-exempt="fixed sort by rating desc; column sort not built in #2450 scope">
            <thead className="sticky top-0 z-10 bg-cz-card shadow-sm">
              <tr className="border-b border-cz-border">
                <th className="px-3 py-3 text-left font-medium uppercase tracking-wider">{t("table.name")}</th>
                <th className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.role")}</th>
                <th className="px-3 py-3 text-left font-medium uppercase tracking-wider">{t("table.team")}</th>
                <th className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.division")}</th>
                <th className="px-2 py-3 text-center font-medium uppercase tracking-wider">{t("table.tier")}</th>
                <th className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.specialization")}</th>
                <th className="px-2 py-3 text-center font-medium uppercase tracking-wider">{t("table.overall")}</th>
                <th className="px-3 py-3 text-right font-medium uppercase tracking-wider">{t("table.salary")}</th>
                <th className="px-3 py-3 text-right font-medium uppercase tracking-wider">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-cz-3 text-sm">{tCommon("controls.noFilterResults")}</td></tr>
              ) : filtered.map((row) => (
                <StaffRow key={row.id} row={row} isMine={row.teamId === myTeamId}
                  onSelect={(r) => navigate(`/staff/${r.id}`)} onRelease={setReleasingRow} t={t} tStaff={tStaff} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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
