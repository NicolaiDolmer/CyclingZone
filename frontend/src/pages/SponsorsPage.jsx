import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import { projectDivisionAdjustment } from "../lib/divisionAdjustment";
import { buildSponsorPayments, projectRemainingStages } from "../lib/sponsorPayments";
import { projectOffer } from "../lib/sponsorOfferProjection";
import { reportActionFailure } from "../lib/actionTelemetry.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
import {
  BriefcaseIcon,
  Button,
  CollapsibleSection,
  EmptyState,
  ErrorState,
  HeroStats,
  PageHeader,
  PageLoader,
  ProgressMeter,
  Section,
  SectionAction,
  SectionHeader,
  SectionStack,
  Tab,
  TabList,
  TabPanel,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from "../components/ui";

const API = import.meta.env.VITE_API_URL;

// Sponsors-siden (#4265, ejer-go 6/9 paa mockuppen
// docs/design/mockups-sponsors-2026-09-06/sponsors-page-tabs.html).
//
// Hvorfor en egen side: ejer-direktiv 25/8 (#4265) "i sæson 3 skal bestyrelsen
// og sponsorer adskilles i ui" — adskillelsens kontrakt staar i
// docs/BOARD_RULES.md §5 (sponsoren bestemmer aftalens stoerrelse, bestyrelsen
// bestemmer om du faar mere eller mindre af den). Forhandlingen laa foer paa
// Board-fladen, som dermed ejede begge halvdele; den er flyttet hertil, og
// Board har nu kun et stille link.
//
// Form: T1 (max-w-4xl) + underline-faner, efter ejer-reglen "overblik foerst +
// faner ud" (PAGE_TEMPLATES.md, fold-disciplin, skaerpet 6/9). Overview er ET
// skaermbillede uden scroll; aftalens raekker, udbetalingerne og naeste saesons
// tilbud bor hver i sin fane. URL'en ER fane-tilstanden (?tab=), samme moenster
// som Klub/Planlaegning/Resultater.
//
// Guld-reglen: sidehovedets primary findes kun naar der reelt er tilbud aabne,
// og daempes til secondary paa Next season-fanen, hvor "Sign deal" er skaermens
// ene guld.
//
// Data: GET /api/sponsor/contract (kontrakt + saesonens raa transaktioner +
// puljens etapetal) og GET /api/sponsor/offers (forhandlings-tilstand).
// Ingen tal opfindes: mangler etapetallet eller raten, vises linjen ikke (P11).
const VALID_TABS = ["overview", "deal", "payments", "next"];

function money(n) {
  return `${formatNumber(n || 0)} CZ$`;
}

// Raekke-listen inde i et kort (T1-opskriften: 13.5px/500 titel + data-font
// 11px uppercase meta-linje, adskilt af 1px top-regler).
function DealRow({ label, labelSub = null, value, valueSub = null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-cz-border py-[11px]">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-cz-1">{label}</p>
        {labelSub && (
          <p className="mt-0.5 font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
            {labelSub}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-data text-[13.5px] font-medium tabular-nums text-cz-1">{value}</p>
        {valueSub && (
          <p className="mt-0.5 font-data text-3xs uppercase tracking-[.06em] text-cz-3">
            {valueSub}
          </p>
        )}
      </div>
    </div>
  );
}

function GroupRow({ label, columns }) {
  return (
    <tr>
      <td
        colSpan={columns}
        className="border-t border-cz-border px-3 pb-1.5 pt-3.5 font-data text-2xs font-medium uppercase tracking-[.08em] text-cz-3"
      >
        {label}
      </td>
    </tr>
  );
}

export default function SponsorsPage() {
  const { t } = useTranslation("sponsor");

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : "overview";

  const [contract, setContract] = useState(null);
  const [season, setSeason] = useState(null);
  const [offersState, setOffersState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [previewDivision, setPreviewDivision] = useState(null);

  function changeTab(next) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true }
    );
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const headers = await authHeaders({ json: false });
        // null = ingen brugbar session (kontrakten i lib/supabase.ts) — send ikke kaldet.
        if (!headers) throw new Error("no session");
        const [contractRes, offersRes] = await Promise.all([
          fetch(`${API}/api/sponsor/contract`, { headers }),
          fetch(`${API}/api/sponsor/offers`, { headers }),
        ]);
        if (!contractRes.ok) throw new Error(`HTTP ${contractRes.status}`);
        const contractBody = await contractRes.json();
        // Tilbuds-tilstanden er sekundaer: fejler den, skal siden stadig vise
        // kontrakten (samme degraderings-holdning som Board havde).
        const offersBody = offersRes.ok ? await offersRes.json() : null;
        if (!alive) return;
        setContract(contractBody.contract ?? null);
        setSeason(contractBody.season ?? null);
        setOffersState(offersBody);
      } catch (e) {
        console.error("SponsorsPage load failed", e);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const payments = useMemo(
    () =>
      buildSponsorPayments({
        contract,
        seasonNumber: season?.number ?? null,
        transactions: season?.transactions ?? [],
        stagesTotal: season?.stagesTotal ?? null,
      }),
    [contract, season]
  );

  const teamDivision = offersState?.teamDivision ?? null;
  const offers = offersState?.offers ?? [];
  const offersOpen = offersState?.negotiable === true && offers.length > 0;
  const upcomingSeason = offersState?.upcomingSeasonNumber ?? null;

  const divisions = useMemo(
    () =>
      Object.keys(offersState?.stageCounts?.byTier || {})
        .map(Number)
        .sort((a, b) => a - b),
    [offersState]
  );
  const activeDivision =
    previewDivision ??
    (divisions.includes(Number(teamDivision)) ? Number(teamDivision) : (divisions[0] ?? null));
  const offerStages =
    (activeDivision != null ? offersState?.stageCounts?.byTier?.[activeDivision] : null) ??
    offersState?.stageCounts?.fallbackDays ??
    null;
  const calendarDays = Number(offersState?.stageCounts?.fallbackDays) || null;
  const stagesPerDay =
    Number(offerStages) > 0 && calendarDays > 0 ? Number(offerStages) / calendarDays : null;

  const offerDivisionAdjustment = projectDivisionAdjustment({
    targetDivision: activeDivision,
    signedDivision: Number(teamDivision),
  });

  // Divisions-tillaegget paa den LOEBENDE aftale: kontrakten baerer selv den
  // division den blev prissat mod (sponsor_contracts.signed_division, #4376).
  // Mangler den, er svaret 0 — aldrig et gaet.
  const contractDivisionAdjustment = projectDivisionAdjustment({
    targetDivision: Number(teamDivision),
    signedDivision: Number(contract?.signed_division),
  });

  const remaining = projectRemainingStages({
    stagesTotal: payments.stagesTotal,
    stagesRidden: payments.stagesRidden,
    rate: payments.rate,
  });

  const clauses = contract?.bonus_clauses || [];
  const clause = (type) => clauses.find((c) => c?.type === type) || null;
  const capClause = clause("results_cap");

  async function acceptOffer(variant) {
    setAccepting(true);
    setAcceptError(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("no session");
      const res = await fetch(`${API}/api/sponsor/offers/accept`, {
        method: "POST",
        headers,
        body: JSON.stringify({ variant }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirming(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      console.error("SponsorsPage accept failed", e);
      setAcceptError(t("offers.acceptFailed"));
      reportActionFailure("sponsor_offer_accept", { reason: "request", context: { variant } });
    } finally {
      setAccepting(false);
    }
  }

  if (loading) return <PageLoader />;

  const seasonLabel =
    payments.seasonNumber != null && teamDivision != null
      ? t("page.seasonMeta", { season: payments.seasonNumber, division: teamDivision })
      : payments.seasonNumber != null
        ? t("page.seasonMetaNoDivision", { season: payments.seasonNumber })
        : null;

  const headerActions = offersOpen ? (
    <Button
      variant={tab === "next" ? "secondary" : "primary"}
      size="sm"
      onClick={() => changeTab("next")}
    >
      {t("page.chooseCta")}
    </Button>
  ) : null;

  const confirmingOffer = offers.find((o) => o.variant === confirming) || null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("page.title")}
        subtitle={
          payments.seasonNumber != null
            ? t("page.subtitle", { season: payments.seasonNumber })
            : t("page.subtitleNoSeason")
        }
        actions={headerActions}
      />

      {/* Panelerne ligger INDE i <Tabs> — TabsContext leveres af Tabs, saa en
          TabPanel udenfor ville aldrig matche og fanen stod tom. */}
      <Tabs value={tab} onChange={changeTab}>
        <TabList label={t("page.title")} className="mb-5">
          <Tab value="overview">{t("page.tab.overview")}</Tab>
          <Tab value="deal">{t("page.tab.deal")}</Tab>
          <Tab value="payments">{t("page.tab.payments")}</Tab>
          <Tab value="next">{t("page.tab.next")}</Tab>
        </TabList>

        {error ? (
          <ErrorState
            title={t("page.errorTitle")}
            description={t("page.error")}
            action={
              <Button variant="secondary" size="sm" onClick={retry}>
                {t("page.retry")}
              </Button>
            }
          />
        ) : (
          <>
            {/* ── Overview: ét skærmbillede, ingen scroll ───────────────── */}
            <TabPanel value="overview">
              {!contract ? (
                <Section>
                  <EmptyState
                    icon={<BriefcaseIcon size={26} aria-hidden="true" />}
                    title={t("page.noContract.title")}
                    description={t("page.noContract.description")}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => changeTab("next")}>
                        {t("page.noContract.action")}
                      </Button>
                    }
                  />
                </Section>
              ) : (
                <Section>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-data text-[18px] font-[650] leading-tight tracking-[-.005em] text-cz-1">
                        {contract.sponsor_name}
                      </p>
                      <p className="mt-0.5 font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                        {t("page.dealLine", {
                          variant: t(`variant.${contract.variant}`, {
                            defaultValue: contract.variant ?? "",
                          }),
                          season: contract.start_season,
                        })}
                      </p>
                    </div>
                    {seasonLabel && (
                      <span className="font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
                        {seasonLabel}
                      </span>
                    )}
                  </div>

                  <HeroStats
                    items={[
                      { label: t("page.stat.paidSoFar"), value: money(payments.total) },
                      { label: t("page.stat.guaranteed"), value: money(payments.guaranteed.total) },
                      { label: t("page.stat.earnedOnTop"), value: money(payments.earnedOnTop) },
                      ...(payments.stagesRidden != null
                        ? [
                            {
                              label: t("page.stat.stagesRidden"),
                              value:
                                payments.stagesTotal != null
                                  ? t("page.stat.stagesOf", {
                                      ridden: payments.stagesRidden,
                                      total: payments.stagesTotal,
                                    })
                                  : String(payments.stagesRidden),
                              sub:
                                payments.stagesTotal != null ? (
                                  <ProgressMeter
                                    value={payments.stagesRidden}
                                    max={payments.stagesTotal}
                                    tone="neutral"
                                    ariaLabel={t("page.stat.stagesRidden")}
                                    className="mt-1.5 max-w-[150px]"
                                  />
                                ) : null,
                            },
                          ]
                        : []),
                    ]}
                  />

                  <div className="mt-4 border-t border-cz-border pt-3.5">
                    {remaining && (
                      <p className="text-[13px] tabular-nums text-cz-1">
                        {t("page.perStageLine", {
                          rate: formatNumber(payments.rate),
                          count: remaining.left,
                          worth: formatNumber(remaining.worth),
                        })}
                      </p>
                    )}
                    <p className="mt-1.5 text-[13px] tabular-nums text-cz-2">
                      {offersOpen && upcomingSeason != null
                        ? t("page.nextSeasonOpen", { count: offers.length, season: upcomingSeason })
                        : t("page.nextSeasonClosed", {
                            season: contract.expires_after_season ?? payments.seasonNumber ?? "",
                          })}
                      <button
                        type="button"
                        onClick={() => changeTab("next")}
                        className="ms-2 inline-flex items-center gap-1 text-xs font-medium text-cz-accent-t hover:underline"
                      >
                        {t("page.goToNextSeason")}
                      </button>
                    </p>
                  </div>
                </Section>
              )}
            </TabPanel>

            {/* ── Deal: aftalens rækkeliste ─────────────────────────────── */}
            <TabPanel value="deal">
              {!contract ? (
                <Section>
                  <EmptyState
                    icon={<BriefcaseIcon size={26} aria-hidden="true" />}
                    title={t("page.noContract.title")}
                    description={t("page.noContract.description")}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => changeTab("next")}>
                        {t("page.noContract.action")}
                      </Button>
                    }
                  />
                </Section>
              ) : (
                <Section>
                  <SectionHeader
                    title={contract.sponsor_name}
                    action={
                      <SectionAction as={Link} to="/help?faq=sponsorPayoutTiming">
                        {t("page.howMoneyWorks")}
                      </SectionAction>
                    }
                  />
                  <DealRow
                    label={t("field.guaranteedBase")}
                    value={money(contract.guaranteed_base)}
                    valueSub={t("page.deal.paidDayOne")}
                  />
                  <DealRow
                    label={t("field.perRaceDay")}
                    labelSub={
                      payments.stagesTotal != null && teamDivision != null
                        ? t("page.deal.stagesInDivision", {
                            count: payments.stagesTotal,
                            division: teamDivision,
                          })
                        : null
                    }
                    value={money(contract.per_race_day_rate)}
                    valueSub={
                      payments.stagesTotal != null
                        ? t("page.deal.overTheSeason", {
                            amount: formatNumber(
                              payments.stagesTotal * (contract.per_race_day_rate || 0)
                            ),
                          })
                        : null
                    }
                  />
                  {contractDivisionAdjustment !== 0 && (
                    <DealRow
                      label={t("page.deal.divisionAdjustment")}
                      labelSub={t("page.deal.divisionAdjustmentSub", {
                        signed: contract.signed_division,
                        current: teamDivision,
                      })}
                      value={money(contractDivisionAdjustment)}
                      valueSub={t("page.deal.everySeason")}
                    />
                  )}
                  {clause("signing") && (
                    <DealRow
                      label={t("page.deal.signingBonus")}
                      labelSub={t("page.deal.signingBonusSub")}
                      value={money(clause("signing").amount)}
                    />
                  )}
                  {clause("stage_win") && (
                    <DealRow
                      label={t("page.deal.stageWinBonus")}
                      labelSub={t("page.deal.stageWinBonusSub")}
                      value={money(clause("stage_win").amount)}
                    />
                  )}
                  {clause("podium") && (
                    <DealRow
                      label={t("page.deal.podiumBonus")}
                      labelSub={t("page.deal.podiumBonusSub")}
                      value={money(clause("podium").amount)}
                      valueSub={
                        capClause
                          ? t("page.deal.capPerSeason", { amount: formatNumber(capClause.amount) })
                          : null
                      }
                    />
                  )}
                  {clause("season_objective") && (
                    <DealRow
                      label={t("page.deal.seasonObjective")}
                      labelSub={
                        clause("season_objective").objective === "top_40pct"
                          ? t("page.deal.seasonObjectiveTop40")
                          : t("page.deal.seasonObjectiveTopHalf")
                      }
                      value={money(clause("season_objective").amount)}
                    />
                  )}
                  <DealRow
                    label={t("field.length")}
                    labelSub={t("page.deal.runsThrough", { season: contract.expires_after_season })}
                    value={t("field.seasons", { count: contract.length_seasons })}
                  />
                </Section>
              )}
            </TabPanel>

            {/* ── Payments: udbetalingstabellen ─────────────────────────── */}
            <TabPanel value="payments">
              <Section>
                <SectionHeader title={t("page.payments.title")} meta={seasonLabel} />
                {payments.isEmpty ? (
                  <EmptyState
                    icon={<BriefcaseIcon size={26} aria-hidden="true" />}
                    title={t("page.payments.empty.title")}
                    description={t("page.payments.empty.description")}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => changeTab("deal")}>
                        {t("page.payments.empty.action")}
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <Table
                      aria-label={t("page.payments.title")}
                      data-sort-exempt="kvittering i fast raekkefoelge: grupperet garanteret/etaper/bonusser med totalraekke"
                    >
                      <thead>
                        <tr>
                          <Th className="min-w-[180px]">{t("page.payments.source")}</Th>
                          <Th numeric className="w-16">
                            {t("page.payments.stages")}
                          </Th>
                          <Th numeric className="w-[118px]">
                            {t("page.payments.amount")}
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.guaranteed.rows.length > 0 && (
                          <GroupRow label={t("page.payments.group.guaranteed")} columns={3} />
                        )}
                        {payments.guaranteed.rows.map((row) => (
                          <Tr key={row.kind}>
                            <Td>
                              <p className="text-[13px] text-cz-1">
                                {row.kind === "base"
                                  ? t("page.payments.row.seasonBase")
                                  : t("page.payments.row.divisionAdjustment")}
                              </p>
                              <p className="mt-px font-data text-3xs uppercase tracking-[.06em] text-cz-3">
                                {row.kind === "base"
                                  ? t("page.payments.row.seasonBaseSub")
                                  : t("page.payments.row.divisionAdjustmentSub", {
                                      division: contract?.signed_division ?? "",
                                    })}
                              </p>
                            </Td>
                            <Td numeric />
                            <Td numeric>{money(row.amount)}</Td>
                          </Tr>
                        ))}

                        {payments.stages.rows.length > 0 && (
                          <GroupRow
                            label={
                              payments.rate > 0
                                ? t("page.payments.group.stagesAt", {
                                    rate: formatNumber(payments.rate),
                                  })
                                : t("page.payments.group.stages")
                            }
                            columns={3}
                          />
                        )}
                        {payments.stages.rows.map((row) => (
                          <Tr key={row.raceId || row.createdAt}>
                            <Td>
                              <span className="text-[13px] text-cz-1">
                                {row.raceName || t("income.group.raceDays.unknownRace")}
                              </span>
                            </Td>
                            <Td numeric>{row.days ?? ""}</Td>
                            <Td numeric>{money(row.amount)}</Td>
                          </Tr>
                        ))}

                        {payments.bonuses.rows.length > 0 && (
                          <GroupRow label={t("page.payments.group.bonuses")} columns={3} />
                        )}
                        {payments.bonuses.rows.map((row) => (
                          <Tr key={row.id}>
                            <Td>
                              <p className="text-[13px] text-cz-1">
                                {row.kind === "stageWin"
                                  ? t("page.payments.row.stageWin")
                                  : row.kind === "podium"
                                    ? t("page.payments.row.podium")
                                    : row.kind === "signing"
                                      ? t("income.group.bonuses.signing")
                                      : row.kind === "objective"
                                        ? t("income.group.bonuses.objective")
                                        : t("page.payments.row.resultBonus")}
                              </p>
                              {row.raceName && (
                                <p className="mt-px font-data text-3xs uppercase tracking-[.06em] text-cz-3">
                                  {row.raceName}
                                </p>
                              )}
                            </Td>
                            <Td numeric />
                            <Td numeric>{money(row.amount)}</Td>
                          </Tr>
                        ))}

                        <tr className="border-t border-cz-border">
                          <Td className="font-semibold">{t("page.payments.total")}</Td>
                          <Td numeric className="font-semibold">
                            {payments.stagesRidden ?? ""}
                          </Td>
                          <Td numeric className="font-[650]">
                            {money(payments.total)}
                          </Td>
                        </tr>
                      </tbody>
                    </Table>
                    {payments.cap && (
                      <p className="mt-2.5 font-data text-2xs tabular-nums text-cz-3">
                        {t("income.group.bonuses.capLine", {
                          used: formatNumber(payments.cap.used),
                          limit: formatNumber(payments.cap.limit),
                        })}
                      </p>
                    )}
                  </>
                )}
              </Section>
            </TabPanel>

            {/* ── Next season: tilbuddene, inline ───────────────────────── */}
            <TabPanel value="next">
              <SectionStack>
                <Section>
                  <SectionHeader
                    title={t("page.next.title")}
                    meta={
                      offersOpen && activeDivision != null && Number(offerStages) > 0
                        ? t("page.next.meta", {
                            count: offers.length,
                            division: activeDivision,
                            stages: Number(offerStages),
                          })
                        : t("page.next.metaClosed", {
                            season: contract?.expires_after_season ?? payments.seasonNumber ?? "",
                          })
                    }
                  />

                  {!offersOpen ? (
                    <EmptyState
                      icon={<BriefcaseIcon size={26} aria-hidden="true" />}
                      title={t("page.next.empty.title", {
                        season: contract?.expires_after_season ?? payments.seasonNumber ?? "",
                      })}
                      description={t("page.next.empty.description")}
                      action={
                        <Link
                          to="/help?faq=sponsorNegotiation"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {t("page.next.empty.action")}
                        </Link>
                      }
                    />
                  ) : (
                    <>
                      {upcomingSeason != null && (
                        <p className="mb-4 text-[13px] text-cz-2">
                          {t("offers.deadline", { season: upcomingSeason })}
                        </p>
                      )}

                      <Table
                        aria-label={t("page.next.title")}
                        data-sort-exempt="fem arketype-tilbud i fast raekkefoelge (sponsorOffers.js)"
                      >
                        <thead>
                          <tr>
                            <Th className="min-w-[170px]">{t("page.next.column.sponsor")}</Th>
                            <Th numeric className="min-w-[150px]">
                              {t("field.guaranteedBase")}
                            </Th>
                            <Th numeric className="min-w-[78px]">
                              {t("field.perRaceDay")}
                            </Th>
                            <Th className="min-w-[200px]">{t("page.next.column.bonuses")}</Th>
                            <Th className="w-[104px]" />
                          </tr>
                        </thead>
                        <tbody>
                          {offers.map((offer) => {
                            const p = projectOffer(offer, offerStages);
                            const bonusLines = (offer.clauses || [])
                              .filter((c) => c?.type !== "results_cap")
                              .map((c) => {
                                const amount = formatNumber(c.amount);
                                if (c.type === "signing") return t("clause.signing", { amount });
                                if (c.type === "stage_win") return t("clause.stageWin", { amount });
                                if (c.type === "podium") {
                                  const cap = (offer.clauses || []).find(
                                    (x) => x?.type === "results_cap"
                                  );
                                  return cap
                                    ? t("clause.podiumCapped", {
                                        amount,
                                        cap: formatNumber(cap.amount),
                                      })
                                    : t("clause.podium", { amount });
                                }
                                if (c.type === "season_objective") {
                                  return t(
                                    c.objective === "top_40pct"
                                      ? "clause.seasonObjectiveTop40"
                                      : "clause.seasonObjective",
                                    { amount }
                                  );
                                }
                                return null;
                              })
                              .filter(Boolean);
                            const selected = offersState?.pendingVariant === offer.variant;
                            return (
                              <Tr key={offer.variant} className={selected ? "bg-cz-subtle" : ""}>
                                <Td>
                                  <p className="text-[13.5px] font-medium leading-tight text-cz-1">
                                    {offer.sponsorName}
                                    {selected && (
                                      <span className="ms-1.5 inline-block rounded-cz-pill border border-cz-border px-1.5 font-data text-3xs font-medium uppercase tracking-[.06em] text-cz-2">
                                        {t("offers.pending")}
                                      </span>
                                    )}
                                  </p>
                                  <p className="mt-px font-data text-3xs uppercase tracking-[.06em] text-cz-3">
                                    {t("page.next.dealType", {
                                      variant: t(`variant.${offer.variant}`, {
                                        defaultValue: offer.variant,
                                      }),
                                      count: offer.lengthSeasons,
                                    })}
                                  </p>
                                </Td>
                                <Td numeric>
                                  <span className="whitespace-nowrap">
                                    {money(offer.guaranteedBase)}
                                  </span>
                                  {p.certain !== null && (
                                    <p className="mt-0.5 font-data text-3xs leading-snug text-cz-3">
                                      {t("page.next.ifEveryStage", {
                                        amount: formatNumber(p.certain),
                                      })}
                                    </p>
                                  )}
                                </Td>
                                <Td numeric>{money(p.rate)}</Td>
                                <Td>
                                  {bonusLines.length === 0 ? (
                                    <span className="text-xs text-cz-3">
                                      {t("page.next.noBonuses")}
                                    </span>
                                  ) : (
                                    <span className="text-xs leading-snug text-cz-2">
                                      {bonusLines.join(". ")}
                                    </span>
                                  )}
                                </Td>
                                <Td className="text-right">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={accepting}
                                    onClick={() => setConfirming(offer.variant)}
                                  >
                                    {t("offers.reviewSign")}
                                  </Button>
                                </Td>
                              </Tr>
                            );
                          })}
                        </tbody>
                      </Table>

                      {acceptError && (
                        <p className="mt-3 text-[13px] text-cz-danger" role="alert">
                          {acceptError}
                        </p>
                      )}

                      {confirmingOffer && (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-accent-t/45 bg-cz-subtle px-3.5 py-3">
                          <p className="text-[13px] text-cz-1">
                            {t("offers.confirmBody", {
                              sponsor: confirmingOffer.sponsorName,
                              count: confirmingOffer.lengthSeasons,
                              season: upcomingSeason,
                            })}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={accepting}
                              onClick={() => setConfirming(null)}
                            >
                              {t("offers.cancel")}
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              loading={accepting}
                              onClick={() => acceptOffer(confirmingOffer.variant)}
                            >
                              {t("offers.signDeal")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </Section>

                {/* Prissætnings-forklaringen bag en fold: den bærer ejer-beslutninger
                  fra #2862 (enheden er en etape), #3020 (samme maksimum uanset
                  division) og #4376 (divisions-tillægget SKAL kunne ses FØR
                  underskriften). Den må ikke forsvinde med modalen, men den må
                  heller ikke stå over folden — fold-disciplinen, PAGE_TEMPLATES.md. */}
                {offersOpen && (
                  <CollapsibleSection title={t("page.next.pricingTitle")}>
                    <div className="pt-4">
                      <p className="text-[13px] text-cz-1">{t("offers.unitDefinition")}</p>
                      {Number(offerStages) > 0 &&
                        activeDivision != null &&
                        upcomingSeason != null && (
                          <p className="mt-1.5 text-[13px] tabular-nums text-cz-2">
                            {t("offers.unitCount", {
                              division: activeDivision,
                              count: Number(offerStages),
                              season: upcomingSeason,
                            })}
                            {stagesPerDay > 1.05 && (
                              <>
                                {" "}
                                {t("offers.unitPerDay", {
                                  days: calendarDays,
                                  perDay: Math.round(stagesPerDay),
                                })}
                              </>
                            )}
                          </p>
                        )}
                      {divisions.length > 1 && (
                        <div
                          className="mt-3 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label={t("offers.divisionPicker")}
                        >
                          {divisions.map((d) => {
                            const active = d === activeDivision;
                            return (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setPreviewDivision(d)}
                                className={`rounded-cz border px-2.5 py-1 text-xs tabular-nums transition-colors ${
                                  active
                                    ? "border-cz-accent-t text-cz-accent-t"
                                    : "border-cz-border text-cz-2 hover:border-cz-3"
                                }`}
                              >
                                {t("offers.divisionPill", {
                                  division: d,
                                  count: offersState?.stageCounts?.byTier?.[d] ?? 0,
                                })}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {offerDivisionAdjustment !== 0 && (
                        <p className="mt-3 text-[13px] tabular-nums text-cz-2">
                          {t(
                            offerDivisionAdjustment > 0
                              ? "offers.divisionAdjustmentUp"
                              : "offers.divisionAdjustmentDown",
                            {
                              division: activeDivision,
                              signed: Number(teamDivision),
                              amount: formatNumber(Math.abs(offerDivisionAdjustment)),
                            }
                          )}
                        </p>
                      )}
                      {divisions.length > 1 && (
                        <p className="mt-3 text-xs text-cz-3">{t("offers.divisionNote")}</p>
                      )}
                      <p className="mt-3 text-xs text-cz-3">{t("offers.boardNote")}</p>
                    </div>
                  </CollapsibleSection>
                )}
              </SectionStack>
            </TabPanel>
          </>
        )}
      </Tabs>
    </div>
  );
}
