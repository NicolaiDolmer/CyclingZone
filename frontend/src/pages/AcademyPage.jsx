// AcademyPage — Akademi (#1308, UX-rework #2796).
//
// Sektioner:
//   • Graduering — banner til Graduation Day, når nogen er vokset ud af sin trup.
//   • Intake — kandidater med potentiale, signeringspris og udløbsfrist.
//   • Ungdomstrupperne — to links til U23- og Juniorsiden med antal/plads.
//   • Regnskab — AcademyPnl.
//
// #6155 (ejer 4/10 + 9/11, #7932): der findes intet akademihold. En rytter hører
// kun til senior, U23 eller junior, og de to ungdomstrupper har deres egne sider
// (youth_squad_pages). Akademiets egen rytterliste (rosteret med Promovér/Fyr)
// er derfor fjernet; flyt og fyring sker på rytterprofilen (RiderManageActions,
// "Move squad" + Release), præcis som for alle andre ryttere.
//
// #2796 (Discord 22/7): intake- og gradueringskortene bruger de samme
// primitiver som resten af appen (NationCell, RiderTypeBadge, Card, Button,
// EmptyState, PageLoader).
//
// Flag-gated: siden er kun tilgængelig via nav når enabled=true (se Layout.jsx).
// Hvis nogen alligevel navigerer hertil med flag slukket, vises en graceful
// "coming soon"-state — men KUN når flaget faktisk er slukket, ikke ved en
// backend-fejl (#2796: en 500'er viste før "Akademiet kommer snart").

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useAcademy } from "../lib/useAcademy.js";
import NationCell from "../components/rider/NationCell.jsx";
import RiderTypeBadge from "../components/rider/RiderTypeBadge.jsx";
import AcademyPnl from "../components/AcademyPnl.jsx";
import AcademyProfileCard from "../components/AcademyProfileCard.tsx"; // #6666
import {
  Card, Button, EmptyState, PageLoader, ErrorState, PageHeader,
  Section, SectionHeader, SectionAction,
} from "../components/ui";
import { getRiderMarketValue } from "../lib/marketValues.js";
import { formatNumber } from "../lib/intl.js";
import { ageForSeason, getRiderAge } from "../lib/riderAge.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { useYouthSquadPages } from "../lib/useYouthSquadPages.ts"; // #5519
import { academyLandingSquad, academyTargetSquad, squadCapRows, SQUAD_CAPS } from "../lib/squadCaps.ts"; // #5568, #6155
import { ChevronRightIcon, GiftIcon } from "../components/ui/icons/index.jsx";
import { ABILITY_KEYS, ABILITY_SHORT, flattenAbilities } from "../lib/abilities.js"; // #6666
import { riderOverallRating } from "../lib/riderRating.js";
import { statPlateStyle } from "../lib/statColor.js";

// #5844: academy_intake.source for bestyrelsens gave-kuld (backend academyIntakeSource.js).
const BOARD_GIFT_SOURCE = "board_gift";
// #6155: kun kandidater hentet med knappen har en symbolsk startværdi.
const PULL_SOURCE = "pull";

// #2796: var hardkodet Intl.NumberFormat("en-US") midt på en side der ellers
// bruger den locale-bevidste formatNumber — en dansk bruger så "45,000 CZ$" i
// løn-kolonnen og "45.000 CZ$" i headeren på samme skærm.
function formatMoney(n) {
  if (n == null) return "–";
  return formatNumber(Math.round(Number(n)), { maximumFractionDigits: 0 });
}

// #6666 punkt 1: en hentet kandidat viser sine NUVÆRENDE evner (backend sender
// kun registrets evne-felter, aldrig potentiale). Kortet viser rating-pladen i
// hans egen rolle + hans tre stærkeste evner; hele profilen ses efter underskrift.
function pullCandidateAbilities(item) {
  if (!item?.rider_derived_abilities) return null;
  const flat = flattenAbilities({ ...item.rider, rider_derived_abilities: item.rider_derived_abilities });
  const top = ABILITY_KEYS
    .map((key) => ({ key, value: flat[key] }))
    .filter((a) => Number.isFinite(a.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const rating = riderOverallRating(flat);
  if (top.length === 0 && !Number.isFinite(rating)) return null;
  return { rating: Number.isFinite(rating) ? rating : null, top };
}

function daysUntil(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

// #6155: én række pr. ungdomstrup i "Dine ungdomstrupper" (link til trupsiden).
const SQUAD_PAGE_PATH = { u23: "/squads/u23", junior: "/squads/junior" };

export default function AcademyPage() {
  const { t } = useTranslation("academy");
  // #3071: sæson-referenceår til alders-visning (intake) — se riderAge.js.
  const seasonYear = useActiveSeasonYear();
  // #5519: med U23/Junior-siderne tændt erstatter links Youth squads-kortet (3a).
  const youthSquadPagesOn = useYouthSquadPages();
  const {
    enabled, squads, intake, graduations, balance,
    intakePull, loading, error, signCandidate, rejectCandidate,
    pullIntake, academyProfile, saveProfile,
  } = useAcademy();
  // #5844: bestyrelsens gave-kuld ("A thank-you from the board") vises i sin
  // egen sektion og tæller IKKE med i ugens optag: pull-knappen afgøres kun af
  // de normale tilbud, så gaven aldrig skjuler ugens hentning.
  const giftIntake = useMemo(() => (intake ?? []).filter((i) => i.source === BOARD_GIFT_SOURCE), [intake]);
  const regularIntake = useMemo(() => (intake ?? []).filter((i) => i.source !== BOARD_GIFT_SOURCE), [intake]);

  // Per-kandidat in-flight state + fejlbeskeder.
  const [actionState, setActionState] = useState({}); // { [riderId]: "signing"|"rejecting"|null }
  const [actionErrors, setActionErrors] = useState({}); // { [riderId]: string | null }

  // #3550: pull-knappens egen in-flight/fejl-state (ikke per-kandidat).
  const [pullBusy, setPullBusy] = useState(false);
  const [pullError, setPullError] = useState(null);

  // #5568: pladserne tælles PR. UNGDOMSTRUP (U23 / junior) mod squadCaps.ts.
  // #6155: en kandidat spærres kun, når ALLE de trupper han kan lande i er fulde
  // (academyLandingSquad: fuld juniortrup → U23, når han er ung nok og der er plads).
  const squadCounts = { u23: squads?.u23?.used ?? null, junior: squads?.junior?.used ?? null };
  const squadRows = squadCapRows(squadCounts);

  // #6155: kun signeringens fejl er tilbage; flyt/fyr sker på rytterprofilen.
  function mapActionError(err) {
    if (err === "academy_full") return t("error.academyFull");
    if (err === "not_offered") return t("error.notOffered");
    // #2796: begge faldt før igennem til den generiske besked (+ Sentry-500).
    if (err === "insufficient_balance") return t("error.insufficientBalance");
    // #6264: signing-fee ville bruge penge låst i auktionsbud.
    if (err === "insufficient_available_balance") return t("error.insufficientAvailableBalance");
    if (err === "already_assigned") return t("error.alreadyAssigned");
    // #4213: stale tilbud — rytteren er i mellemtiden ejet af et andet hold.
    if (err === "rider_owned") return t("error.riderOwned");
    return t("error.generic");
  }

  async function handleSign(riderId) {
    setActionState(prev => ({ ...prev, [riderId]: "signing" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await signCandidate(riderId);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  async function handleReject(riderId) {
    setActionState(prev => ({ ...prev, [riderId]: "rejecting" }));
    setActionErrors(prev => ({ ...prev, [riderId]: null }));
    const result = await rejectCandidate(riderId);
    if (!result.ok) {
      setActionErrors(prev => ({ ...prev, [riderId]: mapActionError(result.error) }));
    }
    setActionState(prev => ({ ...prev, [riderId]: null }));
  }

  // #3550: hent ugens akademi-kuld (pull-intake).
  async function handlePullIntake() {
    setPullBusy(true);
    setPullError(null);
    const result = await pullIntake();
    if (!result.ok) {
      setPullError(t("intakePull.errorFailed"));
    }
    setPullBusy(false);
  }

  // Loading — PageLoader reserverer højde (#1794 CLS).
  if (loading) return <PageLoader label={t("title")} />;

  // #2796: en backend-fejl efterlod `enabled` false og ramte derfor "kommer
  // snart"-grenen nedenfor — spilleren fik at vide at featuren ikke fandtes.
  // Fejl vises nu som fejl; "kommer snart" er forbeholdt et slukket flag.
  // #2849 bølge 6: Academy stod på den editoriale 38px-header uden at være på
  // ejer-godkendelseslisten for editorial-headers (kun Klub/ScoutingCentral/
  // SeasonPlanner) — bragt til T1's kanoniske PageHeader (docs/design/PAGE_TEMPLATES.md).
  // #3454: fejl-/disabled-staterne er selv læse-tunge (en enkelt besked), men
  // deler containerbredde med sidens hovedindhold nedenfor, så bredden ikke
  // hopper når en fejl løses ved retry — samme mønster som RidersPage's
  // fejl-gren.
  if (error) {
    return (
      <div className="max-w-[1600px] mx-auto">
        <PageHeader title={t("title")} />
        <ErrorState title={t("error.loadTitle")} description={t("error.loadBody")} />
      </div>
    );
  }

  // Flag slukket
  if (!enabled) {
    return (
      <div className="max-w-[1600px] mx-auto">
        <PageHeader title={t("title")} />
        {/* #4628 (TASTE fork 4): en tom tilstand uden vej videre er et fund —
            EmptyState kraever nu `action` (#4625). */}
        <EmptyState
          title={t("disabledTitle")}
          description={t("disabledNote")}
          action={
            <Link to="/roadmap" className={buttonClass({ variant: "secondary", size: "sm" })}>
              {t("disabledAction")}
            </Link>
          }
        />
      </div>
    );
  }

  // #5844: ét intake-kort. Delt af det normale optag og bestyrelsens gave-kuld,
  // så de to aldrig driver fra hinanden (samme sign/afvis, samme trup-spærring).
  const renderIntakeCard = (item) => {
    const rider = item.rider;
    const isBoardGift = item.source === BOARD_GIFT_SOURCE;
    const isPull = item.source === PULL_SOURCE;
    const age = getRiderAge(rider.birthdate, seasonYear);
    const busy = actionState[rider.id] != null;
    const err = actionErrors[rider.id];
    const potential = item.potentialEstimate;
    const abilitiesNow = isPull ? pullCandidateAbilities(item) : null;
    // #2796: tilbuddet udløber efter 7 dage (academyIntakeExpirySweep) —
    // hjælpeteksten har lovet det siden #2627, men kortet viste det aldrig.
    const expiryDays = daysUntil(item.expiresAt);
    const expirySoon = expiryDays != null && expiryDays <= 2;
    // Signeringsprisen er backend-beregnet (samme udtryk som debiteringen),
    // så kortet ikke spejler en økonomi-regel der kan drive fra hinanden.
    const fee = item.signingFee;
    const tooExpensive = fee != null && balance != null && fee > balance;
    // #5568: targetSquad (aldersplaceringen) kommer fra backend, samme valg
    // som signeringen; mangler det, afgør sæsonalderen det med samme regel.
    // #6155: er hans trup fuld, lander han på U23, når han er ung nok og der
    // er plads (academyLandingSquad, spejl af signeringens prøve-rækkefølge).
    const targetSquad = item.targetSquad ?? academyTargetSquad(rider.birthdate, seasonYear);
    const landing = academyLandingSquad(targetSquad, ageForSeason(rider.birthdate, seasonYear), squadCounts);
    const isFull = landing.full;
    const blockedBoth = isFull && landing.options.length > 1;
    const fullTooltip = blockedBoth
      ? t("fullTooltipBoth")
      : targetSquad === "junior"
        ? t("fullTooltipJunior", { max: SQUAD_CAPS.junior })
        : t("fullTooltipU23", { max: SQUAD_CAPS.u23 });
    const fullNote = blockedBoth ? t("fullNoteBoth") : targetSquad === "junior" ? t("fullNoteJunior") : t("fullNoteU23");

    return (
      <Card key={item.intakeId} className="p-4 flex flex-col gap-3">
        {/* Navn + nationalitet. #3142: INGEN RiderLink her — en 'offered'
            intake-kandidat er bevidst skjult for den almindelige rytter-DB
            via RLS (database/2026-06-22-hide-intake-riders-from-db.sql,
            #1743), så /riders/:id ville altid give "rider not found" for
            netop denne rytter, uanset hvilket hold der klikker. Navnet er
            derfor almindelig tekst indtil kandidaten er signeret/afvist; på
            U23-/Juniorsiden linker han som alle andre. */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-snug truncate text-cz-1">
              {rider.firstname} {rider.lastname}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {rider.nationality_code && <NationCell code={rider.nationality_code} />}
              {age != null && (
                <span className="text-xs text-cz-3">{t("ageLabel", { age })}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {item.is_serious && (
              <span className="text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-cz-pill bg-cz-accent/15 text-cz-accent-t">
                {t("seriousBadge")}
              </span>
            )}
            {expiryDays != null && (
              <span
                title={t("expiryTooltip")}
                className={`text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-cz-pill ${expirySoon ? "bg-cz-danger-bg text-cz-danger" : "bg-cz-subtle text-cz-2 border border-cz-border"}`}
              >
                {expiryDays <= 0 ? t("expiryToday") : t("expiryDays", { days: expiryDays })}
              </span>
            )}
          </div>
        </div>

        <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} className="self-start" />

        {abilitiesNow && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="intake-abilities-now">
            <span className="text-xs text-cz-3">{t("intakePull.abilitiesNow")}</span>
            {abilitiesNow.rating != null && (
              <span
                className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-cz px-1.5 font-data text-xs tabular-nums"
                style={statPlateStyle(abilitiesNow.rating)}
              >
                {abilitiesNow.rating}
              </span>
            )}
            {abilitiesNow.top.map(({ key, value }) => (
              <span key={key} className="font-data text-3xs tabular-nums text-cz-1">
                <span className="text-cz-3">{ABILITY_SHORT[key]}</span> {value}
              </span>
            ))}
          </div>
        )}

        {/* #2454/#3746: potentiale i RATING-point, samme enhed som resten
            af spillet. `prog` er prognose-båndets navn; `ceil` er en
            alias (samme tal) for ældre klient-cache.
            #5844 (ejer 28/9): ALDRIG stjerner i akademiet. Mangler båndet
            (kandidatens afledte evner er ikke klar, jf. #5818), står der en
            ærlig tekst i stedet for et stjerne-fallback. */}
        {/* #6666 punkt 1: en hentet kandidat viser basis; potentialet læres
            gennem træning efter underskrift (backend sender intet bånd). */}
        {item.potentialLearned && (
          <div className="flex items-center gap-2" data-testid="intake-potential-learned">
            <span className="text-xs text-cz-3">{t("potential")}</span>
            <span className="text-xs text-cz-2">{t("potentialLearned")}</span>
          </div>
        )}
        {!item.potentialLearned && (item.potentialBand || potential) && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-cz-3">{t("potential")}</span>
            {item.potentialBand ? (
              <span className="font-mono tabular-nums text-[13px] text-cz-1">
                {(item.potentialBand.prog ?? item.potentialBand.ceil).lo}
                –{(item.potentialBand.prog ?? item.potentialBand.ceil).hi}
              </span>
            ) : (
              <span className="text-xs text-cz-3" data-testid="intake-potential-pending">{t("potentialPending")}</span>
            )}
          </div>
        )}

        {/* #2796: Signér var et irreversibelt køb uden synlig pris.
            #3550: pull-mode viser markedsværdien som PROVISORISK (symbolsk
            startværdi, ejer-beslutning 19/8 punkt 2) + en lønforhåndsvisning
            (1 sæsons intro-kontrakt), og forklarer at den rigtige værdi
            sættes ved førstkommende søndags-opdatering (punkt 5). */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs border-t border-cz-border pt-2">
          <dt className="text-cz-3">{isPull ? t("intakePull.provisionalValue") : t("colValue")}</dt>
          <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(getRiderMarketValue(rider))} CZ$</dd>
          <dt className="text-cz-3">{t("signingFee")}</dt>
          {/* #5844: bestyrelsens gave signes gratis (backend sender signingFee 0). */}
          <dd className={`text-right font-data tabular-nums font-semibold ${tooExpensive ? "text-cz-danger" : "text-cz-1"}`}>
            {isBoardGift && fee === 0 ? t("boardGift.free") : `${formatMoney(fee)} CZ$`}
          </dd>
          {intakePull.enabled && (
            <>
              <dt className="text-cz-3">{t("intakePull.wageOneSeason")}</dt>
              <dd className="text-right font-data tabular-nums text-cz-1">{formatMoney(item.wagePreview)} CZ$</dd>
            </>
          )}
        </dl>
        {isPull && (
          <p className="text-3xs text-cz-3">{t("intakePull.valuationNote")}</p>
        )}

        {/* #6155: juniortruppen er fuld, men U23 har plads: sig hvor han kommer hen,
            FØR det irreversible klik. */}
        {landing.movedToU23 && (
          <p className="text-xs text-cz-2" data-testid="intake-lands-u23">{t("landsOnU23")}</p>
        )}

        {/* Fejlbesked */}
        {err && <p className="text-xs text-cz-danger">{err}</p>}

        {/* Handlingsknapper */}
        {/* #4628: samme guld-rationering som gradueringskortene —
            tre "Signer"-kort gav tre guld-knapper (audit 2026-09). */}
        <div className="flex gap-2 mt-auto pt-1">
          <Button size="sm" variant="secondary" className="flex-1"
            onClick={() => handleSign(rider.id)}
            disabled={busy || isFull || tooExpensive}
            loading={actionState[rider.id] === "signing"}
            title={isFull ? fullTooltip : tooExpensive ? t("error.insufficientBalance") : undefined}>
            {t("signBtn")}
          </Button>
          <Button size="sm" variant="ghost" className="flex-1"
            onClick={() => handleReject(rider.id)}
            disabled={busy} loading={actionState[rider.id] === "rejecting"}>
            {t("rejectBtn")}
          </Button>
        </div>

        {/* Blokerings-forklaring under knapperne */}
        {isFull && !err && (
          <p className="text-3xs text-cz-3 text-center">{fullNote}</p>
        )}
        {!isFull && tooExpensive && !err && (
          <p className="text-3xs text-cz-danger text-center">{t("error.insufficientBalance")}</p>
        )}
      </Card>
    );
  };

  // #3454: T2 (max-w-[1600px]). Layout.jsx's WIDE_CONTENT_ROUTES matcher
  // /academy, så shellen giver fuld bredde til denne cap; kandidatkortene står
  // i et tre-kolonne-grid og regnskabet i to kolonner.
  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Saldo + slot-tæller er ren status-tekst (intet Select/Button) — samme
          dokumenterede afvigelse fra action-cluster-kontrakten "max 1 select +
          1 primary" som ActivityPage's lastUpdated-tidsstempel, fordi siden ikke
          har nogen primær header-handling at vise ved siden af. */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {balance != null && (
              <span className="font-data text-sm tabular-nums text-cz-2">
                {t("balance", { amount: formatMoney(balance) })}
              </span>
            )}
            {/* #5568: "U23 5/12 · Junior 3/10" — loftet pr. trup, ikke ét akademital. */}
            <span className="font-data text-sm tabular-nums text-cz-2" data-testid="academy-squad-caps">
              {squadRows.map((row, i) => (
                <span key={row.squad}>
                  {i > 0 && <span className="text-cz-3" aria-hidden="true"> · </span>}
                  <span
                    className={row.full ? "text-cz-warning" : undefined}
                    title={row.full
                      ? (row.squad === "junior" ? t("fullTooltipJunior", { max: row.max }) : t("fullTooltipU23", { max: row.max }))
                      : undefined}
                  >
                    {row.squad === "junior"
                      ? t("slotsJunior", { used: row.used, max: row.max })
                      : t("slotsU23", { used: row.used, max: row.max })}
                  </span>
                </span>
              ))}
            </span>
          </div>
        }
      />

      <div className="space-y-6">
      {/* GRADUATION DAY-BANNER (#2491) — selve valget bor nu paa sin egen T1-side
          (/academy/graduation, ejer-godkendt mockup 3g). Her staar kun banneret,
          og KUN naar der er nogen at traeffe valg om.

          Den gamle blok — ét kort pr. rytter med tre knapper — er slettet, ikke
          gemt bag et flag: to flader med samme irreversible valg er praecis den
          dobbelt-flade HANDOFF pkt. 8 forbyder ("banner on Academy only, plus
          the Inbox notification"). Kortene kunne desuden hverken vise
          rating-plade, potentiale-baand eller traenerens vurdering, og havde
          ingen faelles bekraeftelse. */}
      {graduations.length > 0 && (
        <section>
          <SectionHeader title={t("graduationHeading")} />
          <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-cz-1">
                {t("graduationBanner.title", { count: graduations.length })}
              </p>
              <p className="mt-1 text-xs text-cz-2">{t("graduationBanner.body")}</p>
            </div>
            <Link
              to="/academy/graduation"
              className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}
            >
              {t("graduationBanner.action")}
            </Link>
          </Card>
        </section>
      )}

      {/* #5844: "A thank-you from the board" — bestyrelsens engangs-kuld (10
          tilbud: 5 U23-alder + 5 junior-alder). Samme kort og samme sign/afvis
          som det normale optag; eneste forskel er gratis signing og 14 dages
          frist. Ingen guld-knap her (TASTE §3: ét guld pr. view — pull-knappen
          nedenfor kan være sidens eneste). */}
      {giftIntake.length > 0 && (
        <section data-testid="academy-board-gift">
          <SectionHeader
            title={t("boardGift.heading")}
            meta={t("boardGift.meta", { count: giftIntake.length })}
          />
          <p className="mb-4 flex items-start gap-2 text-xs text-cz-2">
            <GiftIcon size={14} className="mt-px shrink-0 text-cz-3" aria-hidden="true" />
            <span>{t("boardGift.context")}</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {giftIntake.map(renderIntakeCard)}
          </div>
        </section>
      )}

      {/* INTAKE-sektion */}
      <section>
        <SectionHeader title={t("intakeHeading")} />

        {/* #3550 (ejer-beslutning 19/8, ungdomspakken): pull-baseret intake.
            intakePull.enabled=false (default indtil cutover-flip 23/8) → uændret
            visning (auto-drip-tomtilstand nedenfor). enabled=true viser en
            hent-knap så længe ugens kuld ikke er hentet. */}
        {/* #6155: knappen vises uanset åbne tilbud (kun ugens hentning afgør det)
            og står over de eksisterende kort. */}
        {intakePull.enabled && !intakePull.pulledThisWeek && (
          <Card className={`p-5 flex flex-col items-start gap-3${regularIntake.length > 0 ? " mb-4" : ""}`}>
            <h3 className="text-sm font-semibold text-cz-1">{t("intakePull.title")}</h3>
            <p className="text-xs text-cz-2 max-w-md">{t("intakePull.description")}</p>
            <p className="text-3xs uppercase tracking-wide text-cz-3">{t("intakePull.deadlineNote")}</p>
            {pullError && <p className="text-xs text-cz-danger">{pullError}</p>}
            <Button size="sm" variant="primary" onClick={handlePullIntake} disabled={pullBusy} loading={pullBusy}>
              {t("intakePull.pullBtn")}
            </Button>
          </Card>
        )}
        {regularIntake.length === 0 && intakePull.enabled && !intakePull.pulledThisWeek ? null
          : regularIntake.length === 0 && intakePull.enabled ? (
          <EmptyState
            title={t("emptyIntakeTitle")}
            description={t("intakePull.emptyAfterPull")}
            action={
              <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        ) : regularIntake.length === 0 ? (
          <EmptyState
            title={t("emptyIntakeTitle")}
            description={t("emptyIntake")}
            action={
              <Link to="/auctions" className={buttonClass({ variant: "secondary", size: "sm" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {regularIntake.map(renderIntakeCard)}
          </div>
        )}
      </section>

      {/* #6666: akademiets profil (låses op af akademi-faciliteten). Står lige
          under optaget, fordi den styrer næste uges kuld. */}
      {intakePull.enabled && academyProfile && (
        <AcademyProfileCard profile={academyProfile} onSave={saveProfile} />
      )}

      {/* UNGDOMSTRUP-links — #6155 (ejer 4/10, forslag A): akademiets egen rytterliste er væk. Der
          findes intet akademihold; de signerede talenter står på U23- eller
          juniorholdet, så siden peger derhen med antal/plads pr. trup (samme
          squadCapRows som headeren). Rækkerne er links, ingen knapper: sidens
          eneste guld-knap er stadig ugens hentning (TASTE §3). */}
      {youthSquadPagesOn && (
      <Section data-testid="academy-squad-links">
        <SectionHeader title={t("squadLinks.title")} />
        <p className="mb-2 text-xs text-cz-2">{t("squadLinks.description")}</p>
        <div className="divide-y divide-cz-border">
          {squadRows.map((row) => (
            <Link
              key={row.squad}
              to={SQUAD_PAGE_PATH[row.squad]}
              className="group py-[13px] flex items-center justify-between gap-3 hover:bg-cz-subtle -mx-2 px-2 rounded-cz transition-colors"
              data-testid={`academy-squad-link-${row.squad}`}
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-cz-1 group-hover:text-cz-accent-t">
                  {t(`squadLinks.${row.squad}`)}
                </span>
                {row.full && (
                  <span className="block text-xs text-cz-warning mt-0.5">{t("squadLinks.full")}</span>
                )}
              </span>
              <span className="shrink-0 flex items-center gap-2">
                <span className={`font-data text-sm tabular-nums ${row.full ? "text-cz-warning" : "text-cz-2"}`}>
                  {t("squadLinks.count", { used: row.used, max: row.max })}
                </span>
                <ChevronRightIcon size={14} className="text-cz-3" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </Section>
      )}

      {/* YOUTH SQUADS-kort (#4618, slice 0 af epic #2492) — "Kommer snart"-rammen
          for Junior team og U23 team, jf. docs/YOUTH_RULES.md §3 og artboard 3b
          (docs/design/youth-tiers/HANDOFF.md beslutning 10). Ingen
          nye nav-punkter, ingen tomme tabeller, ingen tal — kun en pille
          (FacilityTrackCard-mønstret) + én sætning pr. trup + ét roadmap-link
          (P11 "ingenting opdigtet", TASTE.md).
          Beskrivelseslinjen er en fuld sætning, ikke en meta-label, så den
          IKKE bruger PAGE_TEMPLATES' uppercase-11px-meta-stil (den stil er til
          korte labels/tal, ikke løbende tekst) — samme valg som
          FacilityTrackCard's egen "coming soon"-linje (text-xs text-cz-2).
          #5519 (artboard 3a): med kontakten youth_squad_pages tændt ER
          trupperne ægte og bor i menuen lige efter My Team, så kortet
          forsvinder (og #6155's links ovenfor tager over). Slukket = kortet. */}
      {!youthSquadPagesOn && (
      <Section>
        <SectionHeader
          title={t("youthSquads.title")}
          action={<SectionAction as={Link} to="/roadmap">{t("youthSquads.roadmap")}</SectionAction>}
        />
        <div className="divide-y divide-cz-border">
          {[
            { key: "junior", title: t("youthSquads.junior.title"), description: t("youthSquads.junior.description") },
            { key: "u23", title: t("youthSquads.u23.title"), description: t("youthSquads.u23.description") },
          ].map((row) => (
            <div key={row.key} className="py-[13px] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-cz-1">{row.title}</p>
                <p className="text-xs text-cz-2 mt-0.5">{row.description}</p>
              </div>
              <span className="shrink-0 text-3xs uppercase tracking-wide rounded-cz px-[7px] py-[2px] text-cz-accent-t bg-cz-accent/10">
                {t("youthSquads.comingSoon")}
              </span>
            </div>
          ))}
        </div>
      </Section>
      )}

      {/* Akademi-regnskab (#2485) — P&L for udvikl-og-sælg. */}
      <AcademyPnl />
      </div>
    </div>
  );
}
