import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState, PageLoader } from "../components/ui";
import { useStaffProfile } from "../lib/useStaffProfile.js";
import StaffSwitcherBar from "../components/staff/profile/StaffSwitcherBar.jsx";
import StaffProfileHero from "../components/staff/profile/StaffProfileHero.jsx";
import StaffProfileTabs from "../components/staff/profile/StaffProfileTabs.jsx";
import StaffAbilityColumns from "../components/staff/profile/StaffAbilityColumns.jsx";

export default function StaffProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("staff");
  const { profile, roster, status, facilitiesLoading } = useStaffProfile(id);
  const [tab, setTab] = useState("overview");

  if (status === "loading" || facilitiesLoading) return <PageLoader />;
  if (status === "forbidden") return <EmptyState title={t("gate.title")} description={t("gate.description")} />;
  if (status === "notfound" || status === "error" || !profile)
    return <EmptyState title={t("missing.title")} description={t("missing.description")} />;

  const overall = profile.abilities?.overall;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button type="button" onClick={() => navigate(-1)} className="text-[12px] text-cz-2 mb-3">
        ‹ {t("back")}
      </button>
      <StaffSwitcherBar current={id} roster={roster} onNavigate={(sid) => navigate(`/staff/${sid}`)} />
      <StaffProfileHero profile={profile} />
      <StaffProfileTabs active={tab} onChange={setTab} />
      {tab === "overview" && <StaffAbilityColumns profile={profile} />}
      {tab === "effect" && (
        <p className="text-[13px] text-cz-2 max-w-prose">{t("effect.body", { rating: overall })}</p>
      )}
      {tab === "history" && <p className="text-[13px] text-cz-2">{t("history.body")}</p>}
    </div>
  );
}
