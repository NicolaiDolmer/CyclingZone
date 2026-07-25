import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState, PageLoader, Button, Card } from "../components/ui";
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
  //
  // Full-bleed-ruten (Layout FULL_BLEED_PREFIXES) giver denne rute ingen
  // padding/cap — alle grene sætter derfor selv den kanoniske T3-container
  // (#2849 bølge 5c: ejer-runde 24/7, hero er et KORT igen, se RiderStatsPage).
  const outerContainer = "max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8";
  if ((status === "loading" || facilitiesLoading) && status !== "public") return (
    <div className={outerContainer}>
      <PageLoader />
    </div>
  );
  if (status === "forbidden") return (
    <div className={outerContainer}>
      <EmptyState title={t("gate.title")} description={t("gate.description")} />
    </div>
  );
  if (status === "notfound" || status === "error" || !profile) return (
    <div className={outerContainer}>
      <EmptyState title={t("missing.title")} description={t("missing.description")} />
    </div>
  );

  const overall = profile.abilities?.overall;
  const isPublic = status === "public";

  return (
    <div>
      {/* #2849 bølge 5c (T3-revision, ejer 24/7 2. iteration): hero'en er et
          KORT igen — ikke et full-bleed bånd. Guldlinjen (T3-signatur) følger
          kortets afrundede topkant, switcheren er et indrykket kort, Back
          ligger over, og tabs står under kortet på sidens baggrund. Spejler
          RiderStatsPage/RiderProfileHero-mønstret 1:1. */}
      <div className={outerContainer}>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3"
        >
          ‹ {t("back")}
        </button>

        {!isPublic && (
          <StaffSwitcherBar current={id} roster={roster} onNavigate={(sid) => navigate(`/staff/${sid}`)} />
        )}

        <section className="bg-cz-card border border-cz-border border-t-2 border-t-cz-accent rounded-cz overflow-hidden px-4 md:px-6 pt-5 pb-5">
          <StaffProfileHero
            profile={profile}
            actions={
              // #2649 — opsig EGET staff (destruktiv, sidst i handlingsrækken).
              // Kun for det ejede staff-view (public/candidate-visning har ingen
              // handlinger) — flyttet til kortets bund efter hairline-rule
              // (T3-spec: "the view's action row sits at the card's bottom"),
              // samme sted RiderProfileHero injicerer sin action-række.
              !isPublic ? (
                <Button variant="danger" size="sm" onClick={() => setReleaseOpen(true)}>
                  {t("release.button")}
                </Button>
              ) : null
            }
          />
        </section>

        {!isPublic && <StaffProfileTabs active={tab} onChange={setTab} />}
      </div>

      <div className="max-w-5xl mx-auto pt-5 px-4 md:px-8 pb-24 md:pb-16">
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
            {tab === "overview" && <StaffAbilityColumns profile={profile} />}
            {tab === "effect" && (
              <Card className="p-4 md:p-5">
                <p className="text-[13px] text-cz-2 max-w-prose">{t("effect.body", { rating: overall })}</p>
              </Card>
            )}
            {tab === "history" && (
              <Card className="p-4 md:p-5">
                <p className="text-[13px] text-cz-2">{t("history.body")}</p>
              </Card>
            )}

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
    </div>
  );
}
