import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState, PageLoader, Button } from "../components/ui";
import { useStaffProfile } from "../lib/useStaffProfile.js";
import { useStaffRelease } from "../lib/useStaffRelease.js";
import TeamLink from "../components/TeamLink.jsx";
import StaffSwitcherBar from "../components/staff/profile/StaffSwitcherBar.jsx";
import StaffProfileHero from "../components/staff/profile/StaffProfileHero.jsx";
import StaffProfileTabs from "../components/staff/profile/StaffProfileTabs.jsx";
import StaffAbilityColumns from "../components/staff/profile/StaffAbilityColumns.jsx";
import ReleaseStaffModal from "../components/staff/ReleaseStaffModal.jsx";
import { formatNumber } from "../lib/intl";

export default function StaffProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("staff");
  const { profile, roster, status, facilitiesLoading } = useStaffProfile(id);
  const { release, busy: releaseBusy } = useStaffRelease();
  const [tab, setTab] = useState("overview");
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseError, setReleaseError] = useState(null);

  // Staff-release-endpointet returnerer korte fejlkoder ({ error, severance,
  // balance }), IKKE #678's errorCode/errorParams-kontrakt — så vi mapper selv
  // til staff:release.errors.* i stedet for at bruge resolveApiError.
  async function confirmRelease() {
    setReleaseError(null);
    const r = await release(id);
    if (r.ok) {
      setReleaseOpen(false);
      navigate(-1);
      return;
    }
    if (r.error === "insufficient_funds") {
      setReleaseError(t("release.errors.insufficient_funds", { amount: formatNumber(r.severance) }));
      return;
    }
    setReleaseError(t(`release.errors.${r.error}`, { defaultValue: t("release.errors.failed") }));
  }

  // "public" = #2450 candidate-niveau fallback (staff man ikke selv ejer) —
  // stadig et gyldigt visnings-loading-forløb, ikke en fejl/forbudt-tilstand.
  if ((status === "loading" || facilitiesLoading) && status !== "public") return <PageLoader />;
  if (status === "forbidden") return <EmptyState title={t("gate.title")} description={t("gate.description")} />;
  if (status === "notfound" || status === "error" || !profile)
    return <EmptyState title={t("missing.title")} description={t("missing.description")} />;

  const overall = profile.abilities?.overall;
  const isPublic = status === "public";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button type="button" onClick={() => navigate(-1)} className="text-[12px] text-cz-2 mb-3">
        ‹ {t("back")}
      </button>
      {!isPublic && <StaffSwitcherBar current={id} roster={roster} onNavigate={(sid) => navigate(`/staff/${sid}`)} />}
      <StaffProfileHero profile={profile} />
      {isPublic ? (
        <>
          {profile.teamName && (
            <p className="text-[13px] text-cz-2 mb-4">
              {t("public.team", { team: profile.teamName })}{" "}
              <TeamLink id={profile.teamId} className="text-cz-accent-t underline underline-offset-2">
                {t("public.viewTeam")}
              </TeamLink>
            </p>
          )}
          <p className="text-[13px] text-cz-2 max-w-prose">{t("public.limitedNote")}</p>
        </>
      ) : (
        <>
          <StaffProfileTabs active={tab} onChange={setTab} />
          {tab === "overview" && <StaffAbilityColumns profile={profile} />}
          {tab === "effect" && (
            <p className="text-[13px] text-cz-2 max-w-prose">{t("effect.body", { rating: overall })}</p>
          )}
          {tab === "history" && <p className="text-[13px] text-cz-2">{t("history.body")}</p>}

          {/* #2649 — opsig EGET staff (destruktiv, sidst i handlingsrækken). */}
          <div className="mt-5 pt-4 border-t border-cz-border">
            <Button variant="danger" size="sm" onClick={() => setReleaseOpen(true)}>
              {t("release.button")}
            </Button>
          </div>
          <ReleaseStaffModal
            show={releaseOpen}
            staffName={profile.name}
            role={profile.role}
            salary={profile.salary}
            error={releaseError}
            busy={releaseBusy}
            onCancel={() => { if (!releaseBusy) setReleaseOpen(false); }}
            onConfirm={confirmRelease}
          />
        </>
      )}
    </div>
  );
}
