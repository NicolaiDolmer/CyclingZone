// #8081 (ejervalg 16/11): akademisiden udgave A, overblik + faner. Kun bag kontakten
// academy_page_v2_8081; slukket renderer AcademyPage præcis som før.
//
//   Overblik  Optag · Junior x/10 · U23 y/12 · Talenter · Aldersfokus. Trupgrænserne er de
//             RIGTIGE lofter (squadCaps.ts, spejl af backend/lib/squads.js SQUAD_CAPS).
//   Faner     Ugens optag · Dine talenter · Profil og alder.
//
// Fund fra design-gennemgangen (PR #8249) rettet her:
//   A1 åbner på "Dine talenter", når optaget intet har at gøre (initialAcademyTab).
//   A2 ingen saldo i sidehovedet; sidebjælken viser den allerede.
//   A3 hjælpelinjer i --text-2.
//   A4 ingen link-lignende farvet tekst; guld kun på sidens ene handling (hent ugens kandidater).
//
// Akademi-regnskabet er et separat stykke (placeringen er ikke valgt): AcademyPnl står uændret
// under fanerne, og der er ingen regnskabsfane.
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import AcademyProfileCard, { type AcademyProfile, type ProfileValue } from "../AcademyProfileCard.tsx";
import { Card, Button, HeroStats as HeroStatsJs, Spinner, SectionHeader as SectionHeaderJs } from "../ui/index.js";
import { EmptyState, ErrorState, PageHeader, Tabs, TabList, Tab } from "../squad/squadUi.ts";
import { TabPanel as TabPanelJs } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { GiftIcon } from "../ui/icons/index.jsx";
import { squadCapRows, type SquadCounts } from "../../lib/squadCaps.ts";
import TalentTable, { type TalentRider } from "./TalentTable.tsx";
import { useAcademyAgeFocus, type ProfileWithAgeFocus } from "./useAcademyAgeFocus.ts";
import { useTalentOrigins } from "./useTalentOrigins.ts";
import { ageFocusChoice, initialAcademyTab, ownAcademyTalents, AGE_FOCUS_MIXED, type AcademyV2Tab } from "./academyV2Model.ts";

// Kit-primitiverne er utypede .jsx; kontrakten skrives ned her (samme greb som AcademyProfileCard.tsx).
const SectionHeader = SectionHeaderJs as unknown as ComponentType<{ title: ReactNode; meta?: ReactNode }>;
const HeroStats = HeroStatsJs as unknown as ComponentType<{ items: { label: string; value: ReactNode }[]; flush?: boolean; className?: string }>;
const TabPanel = TabPanelJs as unknown as ComponentType<{ value: string; className?: string; children?: ReactNode }>;

type IntakeItem = { intakeId: string; rider: { id: string } } & Record<string, unknown>;

export interface AcademyV2Props {
  graduationCount: number;
  giftIntake: IntakeItem[];
  regularIntake: IntakeItem[];
  renderIntakeCard: (item: IntakeItem, opts: { showLanding: true }) => ReactNode;
  intakePull: { enabled: boolean; pulledThisWeek: boolean };
  pullBusy: boolean;
  pullError: string | null;
  onPull: () => void;
  roster: TalentRider[];
  seasonYear: number | null;
  squadCounts: Partial<SquadCounts>;
  academyProfile: AcademyProfile | null;
  refreshAcademy: () => Promise<void>;
  footer: ReactNode;
}

export default function AcademyV2(props: AcademyV2Props) {
  const {
    graduationCount, giftIntake, regularIntake, renderIntakeCard, intakePull, pullBusy, pullError, onPull,
    roster, seasonYear, squadCounts, academyProfile, refreshAcademy, footer,
  } = props;
  const { t } = useTranslation(["academy", "academyV2"]);
  const pullOpen = intakePull.enabled && !intakePull.pulledThisWeek;
  const [tab, setTab] = useState<AcademyV2Tab>(() => initialAcademyTab({
    regularCount: regularIntake.length, giftCount: giftIntake.length, pullOpen, talentCount: roster.length,
  }));
  const ageFocus = useAcademyAgeFocus(Boolean(academyProfile));
  const showProfileTab = Boolean(academyProfile);
  // Skitse A: "Kom via" i "Dine talenter". Rosterets ryttere bærer holdets id (/academy/me).
  const { origins, failed: originsFailed } = useTalentOrigins(roster.find((r) => r.team_id)?.team_id ?? null, roster.map((r) => r.id));
  // Ejer 16/11: listen viser kun egen avl (akademi-tilbud); null = oprindelsen indlæses endnu.
  const ownTalents = ownAcademyTalents(roster, origins);

  const focusNow = ageFocus.state?.active?.ageFocus ?? null;
  const focusLabel = (value: string | null) => (ageFocusChoice(value) === AGE_FOCUS_MIXED ? t("academyV2:v2.age.mixed") : String(value));
  const squadRows = squadCapRows(squadCounts);
  const stats = [
    { label: t("academyV2:v2.stats.intake"), value: String(regularIntake.length) },
    ...squadRows.map((row) => ({
      label: t(`academyV2:v2.stats.${row.squad}`),
      // TASTE: tallet står neutralt (guld/farve kun til sidens ene handling); en fuld trup får ordet "Fuld" i --text-2.
      value: (
        <>
          {t("squadLinks.count", { used: row.used, max: row.max })}
          {row.full && <span className="ms-2 font-sans text-xs font-medium text-cz-2">{t("academyV2:v2.stats.full")}</span>}
        </>
      ),
    })),
    { label: t("academyV2:v2.stats.talents"), value: ownTalents ? String(ownTalents.length) : "–" },
    ...(showProfileTab ? [{ label: t("academyV2:v2.stats.ageFocus"), value: ageFocus.state ? focusLabel(focusNow) : "–" }] : []),
  ];

  const goToIntake = (
    <button type="button" onClick={() => setTab("intake")} className={buttonClass({ variant: "secondary", size: "sm" })}>
      {t("academyV2:v2.talents.emptyAction")}
    </button>
  );

  async function saveWithAgeFocus(profile: ProfileWithAgeFocus) {
    const res = await ageFocus.saveProfile(profile);
    // Profilkortets aktive/ventende linjer kommer fra /academy/me: hent dem igen efter et gem.
    if (res.ok) await refreshAcademy();
    return res;
  }

  return (
    <div className="max-w-[1600px] mx-auto" data-testid="academy-v2">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6">
        {graduationCount > 0 && (
          <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-cz-1">{t("graduationBanner.title", { count: graduationCount })}</p>
              <p className="mt-1 text-xs text-cz-2">{t("graduationBanner.body")}</p>
            </div>
            <Link to="/academy/graduation" className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}>
              {t("graduationBanner.action")}
            </Link>
          </Card>
        )}

        <section aria-label={t("academyV2:v2.overview")} data-testid="academy-v2-overview">
          <Card className="p-5">
            <HeroStats items={stats} flush />
          </Card>
        </section>

        <Tabs value={tab} onChange={(next) => setTab(next as AcademyV2Tab)}>
          <TabList label={t("academyV2:v2.tabsLabel")} className="mb-5">
            <Tab value="intake">{t("academyV2:v2.tabs.intake")}</Tab>
            <Tab value="talents">{t("academyV2:v2.tabs.talents")}</Tab>
            {showProfileTab ? <Tab value="profile">{t("academyV2:v2.tabs.profile")}</Tab> : null}
          </TabList>

          <TabPanel value="intake" className="space-y-6">
            {giftIntake.length > 0 && (
              <section data-testid="academy-board-gift">
                <SectionHeader title={t("boardGift.heading")} meta={t("boardGift.meta", { count: giftIntake.length })} />
                <p className="mb-4 flex items-start gap-2 text-xs text-cz-2">
                  <GiftIcon size={14} className="mt-px shrink-0 text-cz-2" aria-hidden="true" />
                  <span>{t("boardGift.context")}</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {giftIntake.map((item) => renderIntakeCard(item, { showLanding: true }))}
                </div>
              </section>
            )}
            <section>
              {pullOpen && (
                <Card className={`p-5 flex flex-col items-start gap-3${regularIntake.length > 0 ? " mb-4" : ""}`}>
                  <h3 className="text-sm font-semibold text-cz-1">{t("intakePull.title")}</h3>
                  <p className="text-xs text-cz-2 max-w-md">{t("intakePull.description")}</p>
                  <p className="text-xs text-cz-2">{t("intakePull.deadlineNote")}</p>
                  {pullError && <p className="text-xs text-cz-danger">{pullError}</p>}
                  <Button size="sm" variant="primary" onClick={onPull} disabled={pullBusy} loading={pullBusy}>
                    {t("intakePull.pullBtn")}
                  </Button>
                </Card>
              )}
              {regularIntake.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {regularIntake.map((item) => renderIntakeCard(item, { showLanding: true }))}
                </div>
              ) : pullOpen ? null : (
                <EmptyState
                  title={t("emptyIntakeTitle")}
                  description={intakePull.enabled ? t("intakePull.emptyAfterPull") : t("emptyIntake")}
                  action={<Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>{t("emptyAction")}</Link>}
                />
              )}
            </section>
          </TabPanel>

          <TabPanel value="talents">
            {ownTalents === null && originsFailed ? (
              <ErrorState title={t("academyV2:v2.talents.errorTitle")} description={t("academyV2:v2.talents.errorBody")} />
            ) : ownTalents === null ? (
              <div className="flex justify-center py-10" role="status" aria-busy="true" aria-label={t("academyV2:v2.tabs.talents")}><Spinner /></div>
            ) : (
              <TalentTable roster={ownTalents} seasonYear={seasonYear} emptyAction={goToIntake} origins={origins} />
            )}
          </TabPanel>

          {showProfileTab ? (
            <TabPanel value="profile">
              {ageFocus.loading ? (
                <div className="flex justify-center py-10" role="status" aria-busy="true" aria-label={t("academyV2:v2.tabs.profile")}><Spinner /></div>
              ) : ageFocus.error || !ageFocus.state ? (
                <ErrorState title={t("academyV2:v2.age.errorTitle")} description={t("academyV2:v2.age.errorBody")} />
              ) : (
                <AcademyProfileCard
                  profile={academyProfile}
                  onSave={(p: ProfileValue) => saveWithAgeFocus({ origins: p.origins, types: p.types, ageFocus: null })}
                  ageFocus={{
                    state: ageFocus.state,
                    onSave: saveWithAgeFocus,
                    describe: (value: string | null) => focusLabel(value),
                  }}
                />
              )}
            </TabPanel>
          ) : null}
        </Tabs>

        {footer}
      </div>
    </div>
  );
}
