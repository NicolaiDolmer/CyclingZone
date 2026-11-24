// #8081 (ejervalg 16/11): akademisiden udgave A, overblik + faner. Kun bag kontakten
// academy_page_v2_8081; slukket renderer AcademyPage præcis som før.
//
//   Overblik  Optag · Junior x/10 · U23 y/12 · Talenter. Trupgrænserne er de
//             RIGTIGE lofter (squadCaps.ts, spejl af backend/lib/squads.js SQUAD_CAPS).
//   Faner     Ugens optag · Dine talenter · Profil og alder.
//
// Fund fra design-gennemgangen (PR #8249) rettet her:
//   A1 åbner på "Dine talenter", når optaget intet har at gøre (initialAcademyTab).
//   A2 ingen saldo i sidehovedet; sidebjælken viser den allerede.
//   A3 hjælpelinjer i --text-2.
//   A4 ingen link-lignende farvet tekst; guld kun på sidens ene handling (hent ugens kandidater).
//
// #8060 (ejervalg 16/11, godkendt 17/11): Akademi-regnskab er sin egen fane (AcademyLedgerTab, pr. saeson
// med rigtige tal). Det gamle AcademyPnl under fanerne vises ikke i udgave A, fordi det taeller andre
// ryttere og ville modsige fanen; den gamle side (kontakten slukket) er uaendret.
import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import AcademyProfileCard, { type AcademyProfile, type ProfileValue } from "../AcademyProfileCard.tsx";
import { Card, Button, HeroStats as HeroStatsJs, SkeletonLines, SectionHeader as SectionHeaderJs } from "../ui/index.js";
import { EmptyState, ErrorState, PageHeader, Tabs, TabList, Tab } from "../squad/squadUi.ts";
import { TabPanel as TabPanelJs } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { GiftIcon } from "../ui/icons/index.jsx";
import { squadCapRows, type SquadCounts } from "../../lib/squadCaps.ts";
import TalentTable, { type TalentRider } from "./TalentTable.tsx";
import { useAcademyAgeFocus, type ProfileWithAgeFocus, type SaveResult } from "./useAcademyAgeFocus.ts";
import { useTalentOrigins } from "./useTalentOrigins.ts";
import { AcademyLedgerTab } from "../academy-ledger/index.ts";
import { ageFocusChoice, initialAcademyTab, ownAcademyTalents, AGE_FOCUS_MIXED, type AcademyV2Tab } from "./academyV2Model.ts";

// Kit-primitiverne er utypede .jsx; kontrakten skrives ned her (samme greb som AcademyProfileCard.tsx).
const SectionHeader = SectionHeaderJs as unknown as ComponentType<{ title: ReactNode; meta?: ReactNode }>;
const HeroStats = HeroStatsJs as unknown as ComponentType<{ items: { label: string; value: ReactNode }[]; flush?: boolean; className?: string }>;
const TabPanel = TabPanelJs as unknown as ComponentType<{ value: string; className?: string; children?: ReactNode }>;

type IntakeItem = { intakeId: string; rider: { id: string } } & Record<string, unknown>;

export interface AcademyV2Props {
  giftIntake: IntakeItem[];
  regularIntake: IntakeItem[];
  renderIntakeCard: (item: IntakeItem, opts: { showLanding: true }) => ReactNode;
  intakePull: { enabled: boolean; pulledThisWeek: boolean };
  pullBusy: boolean;
  pullError: string | null;
  onPull: () => Promise<void>;
  roster: TalentRider[];
  seasonYear: number | null;
  squadCounts: Partial<SquadCounts>;
  academyProfile: AcademyProfile | null;
  saveProfile: (profile: ProfileValue) => Promise<SaveResult>;
  refreshAcademy: () => Promise<void>;
  footer: ReactNode;
}

export default function AcademyV2(props: AcademyV2Props) {
  const {
    giftIntake, regularIntake, renderIntakeCard, intakePull, pullBusy, pullError, onPull,
    roster, seasonYear, squadCounts, academyProfile, saveProfile, refreshAcademy, footer,
  } = props;
  const { t } = useTranslation(["academy", "academyV2"]);
  const pullOpen = intakePull.enabled && !intakePull.pulledThisWeek;
  const [tab, setTab] = useState<AcademyV2Tab>(() => initialAcademyTab({
    regularCount: regularIntake.length, giftCount: giftIntake.length, pullOpen, talentCount: roster.length,
  }));
  const showProfileTab = Boolean(academyProfile);
  const ageFocus = useAcademyAgeFocus(showProfileTab);
  const focusState = !ageFocus.error && ageFocus.state?.unlocked ? ageFocus.state : null;
  const focusLabel = (value: string | null) => (ageFocusChoice(value) === AGE_FOCUS_MIXED ? t("academyV2:v2.age.mixed") : String(value));
  async function pullAndRefreshFocus() {
    await onPull();
    await ageFocus.refresh();
  }

  async function saveWithAgeFocus(profile: ProfileWithAgeFocus) {
    const result = await ageFocus.saveProfile(profile);
    if (result.ok) await refreshAcademy();
    return result;
  }
  // Spillerens eget fanevalg vinder altid over den automatiske start-fane.
  const tabPicked = useRef(false);
  const pickTab = (next: AcademyV2Tab) => {
    tabPicked.current = true;
    setTab(next);
  };
  // Oprindelsen (egen avl) til "Dine talenter". Rosterets ryttere bærer holdets id (/academy/me).
  const { origins, failed: originsFailed } = useTalentOrigins(roster.find((r) => r.team_id)?.team_id ?? null, roster.map((r) => r.id));
  // Ejer 16/11: listen viser kun egen avl (akademi-tilbud); null = oprindelsen indlæses endnu.
  const ownTalents = ownAcademyTalents(roster, origins);
  // Start-fanen afgøres igen, når egen avl er kendt: er listen tom, åbner siden på optaget i stedet for en
  // tom talentfane (Codex #8271). Et fanevalg spilleren selv har truffet, røres aldrig.
  const ownTalentCount = ownTalents?.length ?? null;
  useEffect(() => {
    if (ownTalentCount === null || tabPicked.current) return;
    setTab(initialAcademyTab({
      regularCount: regularIntake.length, giftCount: giftIntake.length, pullOpen, talentCount: ownTalentCount,
    }));
  }, [ownTalentCount, regularIntake.length, giftIntake.length, pullOpen]);

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
    ...(focusState ? [{ label: t("academyV2:v2.stats.ageFocus"), value: focusLabel(focusState.active?.ageFocus ?? null) }] : []),
  ];

  const goToIntake = (
    <button type="button" onClick={() => pickTab("intake")} className={buttonClass({ variant: "secondary", size: "sm" })}>
      {t("academyV2:v2.talents.emptyAction")}
    </button>
  );

  return (
    <div className="max-w-[1600px] mx-auto" data-testid="academy-v2">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6">
        <section aria-label={t("academyV2:v2.overview")} data-testid="academy-v2-overview">
          <Card className="p-5">
            <HeroStats items={stats} flush />
          </Card>
        </section>

        <Tabs value={tab} onChange={(next) => pickTab(next as AcademyV2Tab)}>
          <TabList label={t("academyV2:v2.tabsLabel")} className="mb-5">
            <Tab value="intake">{t("academyV2:v2.tabs.intake")}</Tab>
            <Tab value="talents">{t("academyV2:v2.tabs.talents")}</Tab>
            <Tab value="ledger">{t("academyV2:v2.tabs.ledger")}</Tab>
            {showProfileTab ? <Tab value="profile">{t(focusState ? "academyV2:v2.tabs.profileAndAge" : "academyV2:v2.tabs.profile")}</Tab> : null}
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
                  <Button size="sm" variant="primary" onClick={pullAndRefreshFocus} disabled={pullBusy} loading={pullBusy}>
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
              <div role="status" aria-busy="true" aria-label={t("academyV2:v2.tabs.talents")}>
                <SkeletonLines lines={6} />
              </div>
            ) : (
              <TalentTable roster={ownTalents} seasonYear={seasonYear} emptyAction={goToIntake} />
            )}
          </TabPanel>

          <TabPanel value="ledger">
            <AcademyLedgerTab />
          </TabPanel>

          {showProfileTab ? (
            <TabPanel value="profile">
              {ageFocus.loading ? <SkeletonLines lines={5} /> : (
                <>
                  {ageFocus.error && <p role="status" className="mb-3 text-sm text-cz-2">{t("academyV2:v2.age.errorTitle")}</p>}
                  <AcademyProfileCard
                    profile={academyProfile}
                    onSave={saveProfile}
                    ageFocus={focusState ? { state: focusState, onSave: saveWithAgeFocus, describe: focusLabel } : null}
                  />
                </>
              )}
            </TabPanel>
          ) : null}
        </Tabs>

        {footer}
      </div>
    </div>
  );
}
