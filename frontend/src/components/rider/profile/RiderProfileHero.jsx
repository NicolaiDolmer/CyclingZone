// RiderProfileHero — T3 hero-bånd-indhold for rytterprofilen (#2849 bølge 5).
//
// Ren præsentations-komponent: al data + afledte flags kommer som props fra
// RiderStatsPage (data-laget genbruges 1:1). To viewer-kontekster:
//   • own      — fuld styring (rating farvet, potentiale-loft, markedsværdi+løn)
//   • scouting — rival/AI-rytter; potentiale er fuzzy (ScoutablePotentiale
//                håndterer maskering server-side), form/træthed vises IKKE her.
//
// #2849 bølge 5: komponenten ejer IKKE sin egen bg/border/padding — SIDEN ejer
// kort-rammen (bg-cz-card + hairline + guld-keyline + rounded-cz, ejer-runde
// 24/7 2. iteration: kort igen, ikke full-bleed-bånd) og back-linket over
// kortet. Indholdet her: foto-slot → Bebas-navn → CategoryTags/meta →
// stat-række (label 10px uppercase / value 20px/650 tabular). Ejer-runde 24/7:
// navn FØRST (tags er metadata), foto-slot i stedet for cirkel-avatar, rating
// som farveplade, potentiale = stjerner alene (label i tooltip, niveau-badge
// skjult), winsOn ude.
//
// Token-only: ENESTE rå hex er division-chippen (blå rgb(96 165 250), spec-
// undtagelse). Rating-farve via statColor (SSOT). Potentiale ALTID via
// ScoutablePotentiale → stjerner, aldrig et råt tal. Bebas til navn (font-
// display), Inter Tight tabular til tal (font-data). Dark mode flipper
// automatisk (alle farver er cz-tokens).

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Flag } from "../../Flag";
import TeamLink from "../../TeamLink";
import { statPlateStyle } from "../../../lib/statColor";
import RiderTypeBadge from "../RiderTypeBadge";
import BestRoleTag from "../BestRoleTag.jsx";
import ScoutablePotentiale from "../ScoutablePotentiale";
import { potentialViewOf } from "../../../lib/potentialEstimateDisplay";
import RiderBadges from "../RiderBadges";
import RiderTalentMark from "../TalentMark.tsx"; // #7879
import RiderChampionJersey from "../ChampionJersey.tsx"; // #7824
import ValueDeltaBadge from "../ValueDeltaBadge.jsx";
import { retirementRiskBadgeKey, seasonNumberFromReferenceYear } from "../../../lib/riderAge";
import { contractOfferEligibility, CONTRACT_STATE } from "../../../../../backend/lib/contractOfferEligibility.js";
import { useRiderReputation } from "../../../lib/useRiderReputation.ts";
import { riderReputationBand, riderReputationProgress, riderReputationValue } from "../../../lib/riderReputationView.ts";
import { formatNumber } from "../../../lib/intl.js";
import { squadBadgeKey } from "../../../lib/squadBadge.ts";
import { AlertTriangleIcon, CategoryTag, HeroStats, StarIcon, ChevronRightIcon, Portal } from "../../ui";

// Division-chip — ENESTE rå-hex-undtagelse (spec): brand-uafhængig divisions-blå.
const DIVISION_CHIP = "rgb(96 165 250)";

// Status-banner (betinget). `banner` = { kind, ...data } fra parent. Gold-tonet for
// auktion. #6934: kontrakt-udløb og akademi har ikke længere bjælke
// (kontrakt-feltet og U23/Junior-mærket i chip-rækken bærer dem). #7951: "listed"
// er heller ikke en bjælke; salget står ved handlingen (ForSaleStatus).
//
// #2748: "finalSeason" er DEFINITIVT (motoren har allerede besluttet pensionen,
// bare ikke anvendt den endnu), til forskel fra retirementRiskBadgeKey-badget
// (RiderBadges, se navnetagget ovenfor) der kun viser SANDSYNLIGHED. Den får
// derfor sin egen visning — eyebrow-titel + brødtekst, guld venstre-kant, samme
// mønster som RiderDevelopmentTab.jsx's ReadingCard — i stedet for den delte
// TONES/tekst-linje resten af banner-kinds bruger.
function StatusBanner({ banner }) {
  const { t } = useTranslation("rider");
  if (!banner) return null;

  if (banner.kind === "finalSeason") {
    return (
      <div className="mt-4 bg-cz-card border border-cz-border border-l-2 border-l-cz-accent rounded-cz py-[15px] px-[17px]">
        <span className="font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-accent-t">
          {t("profile.banner.finalSeasonTitle")}
        </span>
        <p className="mt-[7px] mb-0 text-[12.5px] text-cz-2 leading-[1.55]">
          {t("profile.banner.finalSeason", { season: banner.season })}
        </p>
      </div>
    );
  }

  if (banner.kind !== "auction") return null;

  return (
    <div className="mt-4 flex items-center gap-2 rounded-cz border border-cz-accent/30 bg-cz-accent/10 px-3.5 py-2.5 text-sm tabular-nums text-cz-accent-t">
      <span>{t("profile.banner.auction", { endsIn: banner.endsIn, highBid: banner.highBid })}</span>
    </div>
  );
}

// #7951: salgsstatus ved købshandlingen, aldrig en bjælke i toppen (T3). #3490:
// samme "X% under/over vurdering"-indikator som Transferlisten; null skjuler den.
// Over vurdering er fare her, ikke advarsel: advarslens ravgul læses som guld (TASTE P3).
function ForSaleStatus({ price, valueDelta }) {
  const { t } = useTranslation("rider");
  return (
    <div className="w-full font-data tabular-nums sm:ms-auto sm:w-auto sm:text-right" data-testid="rider-for-sale">
      <p className="text-sm text-cz-2 sm:whitespace-nowrap">
        {t("profile.hero.forSale")} <span className="font-[650] text-cz-1">{price}</span>
      </p>
      <ValueDeltaBadge
        valueDelta={valueDelta}
        ns="transfers"
        as="p"
        className={`mt-0.5 text-xs font-data! ${valueDelta?.direction === "over" ? "text-cz-danger!" : ""}`}
      />
    </div>
  );
}

function ReputationEventList({ events = [], open, onClose, dialogRef, position }) {
  const { t } = useTranslation("rider");
  const closeButtonRef = useRef(null);
  const focusSetRef = useRef(false);
  const rows = Array.isArray(events) ? events : [];
  const desktop = typeof window !== "undefined" && window.innerWidth >= 640;
  useEffect(() => {
    if (!open) {
      focusSetRef.current = false;
    } else if ((!desktop || position) && !focusSetRef.current && closeButtonRef.current) {
      closeButtonRef.current.focus();
      focusSetRef.current = true;
    }
  }, [open, desktop, position]);
  if (!open || (desktop && !position)) return null;
  const handleDialogKeyDown = (event) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button:not([disabled]), a[href]:not([aria-disabled='true'])");
    if (!focusable?.length) return;
    const controls = Array.from(focusable);
    const activeIndex = controls.indexOf(document.activeElement);
    const nextIndex = (activeIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault();
    controls[nextIndex].focus();
  };
  return (
    <Portal>
      <div ref={dialogRef} id="rider-reputation-details" role="dialog" aria-modal="true" aria-labelledby="rider-reputation-dialog-title" onKeyDown={handleDialogKeyDown} style={position ? { top: position.top, left: position.left, maxHeight: position.maxHeight } : undefined} className="fixed bottom-[76px] left-4 right-4 z-overlay max-h-[calc(100dvh-120px)] overflow-y-auto rounded-cz border border-cz-border bg-cz-card px-3.5 py-3 sm:bottom-auto sm:left-auto sm:right-auto sm:w-[320px] sm:z-dropdown">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p id="rider-reputation-dialog-title" className="font-data text-3xs font-semibold uppercase tracking-widest text-cz-3">{t("profile.reputation.whyTitle")}</p>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="text-xs text-cz-3 underline underline-offset-2">{t("profile.reputation.close")}</button>
        </div>
        {rows.length ? (
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {rows.map((event, index) => {
              const label = t(`profile.reputation.events.${event.event_kind}`, {
                defaultValue: t("profile.reputation.events.fallback"),
              });
              const raceName = event.race?.name || t("profile.reputation.unknownRace");
              return (
                <li key={`${event.dedupe_key || event.event_kind || "event"}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 text-xs">
                  <span className="font-data tabular-nums text-cz-1">+{formatNumber(Number(event.form_points || 0), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  <span className="min-w-0 truncate text-cz-2">{label}</span>
                  <span className="col-start-2 min-w-0 truncate font-data text-3xs uppercase tracking-[.06em] text-cz-3">{raceName}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-cz-3">{t("profile.reputation.noEvents")}</p>
        )}
        <p className="mt-2 border-t border-cz-border pt-2 text-xs text-cz-2">{t("profile.reputation.weighting")}</p>
        <Link to="/help?section=riders" onClick={onClose} className="mt-1 inline-block text-xs text-cz-accent-t underline underline-offset-2">{t("profile.reputation.help")}</Link>
      </div>
    </Portal>
  );
}

export default function RiderProfileHero({
  rider,
  viewer = "own",                 // "own" | "scouting"
  showTeam = true,                // false når switcher-baren allerede viser holdnavnet (ejer-runde 3: aldrig dobbelt)
  overallRating,
  bestRoleKey = null,             // #5435: rollen bag overallRating
  age,
  seasonYear = null,        // #3071: sæson-referenceår (useActiveSeasonYear) — retirementRiskBadgeKey
  typeLabel,
  divisionLabel,                  // fx "DIV 2" (null hvis ukendt)
  valueLabel,                     // fuldt beløb med CZ$, fx "4.366 CZ$"
  salaryText,                     // præ-formateret løn, fx "293 CZ$"
  isAiTeam = false,
  pendingTeam = null,             // kommende hold (handel til næste sæson) | null
  banner = null,                  // { kind, ...data }
  scouting,
  onWatchlist = false,
  onToggleWatchlist,
  onCompare,                      // () => void — navigér til /compare?ids=... (parent styrer routing)
  actions = null,                 // action-række (ReactNode) — injiceres af parent
  reputationEvents = [],
}) {
  const { t } = useTranslation("rider");
  const [reputationOpen, setReputationOpen] = useState(false);
  const [reputationPosition, setReputationPosition] = useState(null);
  const reputationTriggerRef = useRef(null);
  const reputationDetailsRef = useRef(null);
  const reputationWasOpenRef = useRef(false);
  useEffect(() => {
    if (reputationOpen) {
      reputationWasOpenRef.current = true;
    } else if (reputationWasOpenRef.current) {
      reputationWasOpenRef.current = false;
      reputationTriggerRef.current?.focus();
    }
  }, [reputationOpen]);
  useEffect(() => {
    if (!reputationOpen) return undefined;
    const positionPopover = () => {
      if (window.innerWidth < 640) {
        setReputationPosition(null);
        return;
      }
      const anchor = reputationTriggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      setReputationPosition({
        top: anchor.bottom + 8,
        left: Math.max(12, Math.min(anchor.right - 320, window.innerWidth - 332)),
      });
    };
    const closeWhenOutside = (event) => {
      const target = event.target;
      if (reputationTriggerRef.current?.contains(target) || reputationDetailsRef.current?.contains(target)) return;
      setReputationOpen(false);
      setReputationPosition(null);
    };
    const closeOnScroll = (event) => {
      if (event.target instanceof Node && reputationDetailsRef.current?.contains(event.target)) return;
      setReputationOpen(false);
      setReputationPosition(null);
    };
    const closeOnResize = () => {
      setReputationOpen(false);
      setReputationPosition(null);
    };
    positionPopover();
    document.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [reputationOpen]);
  useEffect(() => {
    if (!reputationOpen || !reputationPosition || !reputationDetailsRef.current || !reputationTriggerRef.current) return;
    const anchor = reputationTriggerRef.current.getBoundingClientRect();
    const panelHeight = reputationDetailsRef.current.getBoundingClientRect().height;
    const margin = 12;
    const gap = 8;
    const belowTop = anchor.bottom + gap;
    const top = belowTop + panelHeight <= window.innerHeight - margin
      ? belowTop
      : Math.max(margin, anchor.top - panelHeight - gap);
    const maxHeight = Math.max(160, window.innerHeight - top - margin);
    setReputationPosition((current) => current && current.top === top && current.maxHeight === maxHeight
      ? current
      : { ...current, top, maxHeight });
  }, [reputationOpen, reputationPosition]);
  const reputationOn = useRiderReputation();

  const teamName = rider.team?.name ?? t("header.freeAgent");
  // #6110: tal + ord er potentialet, ikke en prognose.
  const potentialEyebrow = potentialViewOf(scouting?.estimateFor?.(rider?.id))
    ? t("profile.scouting.potentialLabel")
    : viewer === "scouting"
      ? t("profile.hero.potentialScouted")
      : t("profile.hero.potentialOwn");
  // #6934: truppen (riders.squad) afgør U23/Junior-mærket; alders-U23 er kun fallback når squad mangler (en senior-trup-rytter under 23 får intet U23-mærke).
  const squadKey = squadBadgeKey(rider.squad);
  const isU23 = rider.squad == null && rider.is_u25 != null && age != null && age < 23;
  const hasRating = Number.isFinite(overallRating);
  const ratingPlate = hasRating ? (
    <span
      className="inline-flex items-center justify-center min-w-[38px] h-[30px] px-2 rounded-cz"
      style={statPlateStyle(overallRating)}
    >
      {overallRating}
    </span>
  ) : null;
  // #6638: "Season 3" midt i saeson 4 lignede en fri rytter. En udloebet kontrakt
  // paa et hold siges nu ud (frigives ved skiftet), og en fri agent viser aldrig et
  // efterladt saesonnummer.
  const contractOffer = contractOfferEligibility({
    teamId: rider.team_id,
    contractEndSeason: rider.contract_end_season,
    activeSeasonNumber: seasonNumberFromReferenceYear(seasonYear),
  });
  const hasContractSeason = rider.contract_end_season != null && contractOffer.state !== CONTRACT_STATE.FREE_AGENT;
  const contractText = contractOffer.awaitingRelease
    ? t("profile.hero.contractExpired")
    : hasContractSeason
      ? t("profile.hero.contractSeason", { season: rider.contract_end_season })
      : t("header.noContract");
  // #6934: udløber kontrakten ved dette sæsonskifte, står det i feltet (ikon + kort tekst), ikke i en bjælke.
  const contractExpiresNow = contractOffer.state === CONTRACT_STATE.FINAL_SEASON;
  const contractSub = contractExpiresNow ? (
    <p className="text-2xs text-cz-warning mt-1 inline-flex items-center gap-1" data-testid="rider-contract-expires">
      <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0" />
      {t("profile.hero.contractExpires")}
    </p>
  ) : contractOffer.awaitingRelease ? (
    <p className="text-2xs text-cz-3 mt-1">{t("profile.hero.contractExpiredSub")}</p>
  ) : null;
  const reputationValue = riderReputationValue(rider, reputationOn);
  // Niveauet (Ukendt..Legende) hører kun til omdømmet: off/shadow viser popularitet uden label.
  const reputationBand = reputationOn ? riderReputationBand(reputationValue) : null;
  const reputationProgress = reputationOn ? riderReputationProgress(reputationValue) : null;
  const reputationSub = (
    <>
      {reputationProgress && (
        <span className="mt-1 block max-w-28">
          <span className="block h-1 overflow-hidden rounded-cz bg-cz-subtle" aria-hidden="true">
            <span className="block h-full bg-cz-2" style={{ width: `${reputationProgress.percent}%` }} />
          </span>
          <span className="mt-1 block font-data text-2xs text-cz-3 tabular-nums">
            <span className="inline-flex items-center gap-0.5">
            {t("profile.reputation.progressTo", { value: reputationProgress.current, target: reputationProgress.target, band: t(`profile.reputation.band.${reputationProgress.nextBand}`) })}
              <ChevronRightIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
            </span>
          </span>
        </span>
      )}
    </>
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
        <div className="flex items-start gap-4 sm:gap-5 min-w-0">
          {/* Foto-slot (ejer-feedback bølge 5: cirkel-avataren var for lille som
              anker) — kvadratisk ramme m. initialer, klar til rigtige fotos. */}
          <div className="mt-1 w-20 h-20 sm:w-24 sm:h-24 flex-none bg-cz-subtle border border-cz-border rounded-cz flex flex-col items-center justify-center gap-0.5">
            <span aria-hidden="true" className="font-display text-[26px] sm:text-[30px] leading-none text-cz-2">
              {(rider.firstname?.[0] ?? "")}{(rider.lastname?.[0] ?? "")}
            </span>
            <span className="font-data text-3xs uppercase tracking-[.14em] text-cz-3">{t("profile.hero.photoFallback")}</span>
          </div>
          <div className="min-w-0">
            {/* Navnet øverst (ejer-feedback: sidens vigtigste ord først; tags er metadata) */}
            <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 wrap-break-word">
              {rider.firstname} {rider.lastname}
            </h1>

            {/* CategoryTags + data-font meta-linje — UNDER navnet */}
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {rider.primary_type
                ? <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} size="md" />
                : <CategoryTag>{typeLabel}</CategoryTag>}
              {divisionLabel && (
                <span
                  className="text-3xs uppercase font-bold tracking-wide px-2 py-0.5 rounded-cz-pill text-white"
                  style={{ backgroundColor: DIVISION_CHIP }}
                >
                  {divisionLabel}
                </span>
              )}
              {squadKey && <CategoryTag>{t(`header.${squadKey}`)}</CategoryTag>}
              {isU23 && <CategoryTag>{t("header.u23")}</CategoryTag>}
              <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 inline-flex items-center gap-1.5">
                {rider.nationality_code && (
                  <span className="inline-flex items-center gap-1 normal-case">
                    <Flag code={rider.nationality_code} /> {rider.nationality_code}
                  </span>
                )}
                {age != null && <span>{t("header.ageYears", { age })}</span>}
                {rider.height != null && <span>{t("header.heightCm", { height: rider.height })}</span>}
                {rider.weight != null && <span>{t("header.weightKg", { weight: rider.weight })}</span>}
              </span>
              {/* #2943: samme pensions-risiko-badge/mønster som auktionsfladen
                  (RiderBadges/retirementRiskBadgeKey) — diskret advarsel, ikke
                  en spærre. Uafhængig af U23-tagget ovenfor (aldrig begge). */}
              <RiderBadges badges={[retirementRiskBadgeKey(rider, seasonYear)]} />
            </div>
            {/* #7951: mærker er ikon + ét ord; forklaringen står i tooltippen og i Hjælp. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 empty:hidden sm:mt-2.5 sm:gap-y-1" data-testid="rider-hero-marks">
              <RiderChampionJersey riderId={rider.id} variant="profile" />
              <RiderTalentMark riderId={rider.id} variant="profile" />
            </div>

            {/* Hold (+ AI-tag) — kun når switcher-baren ikke allerede bærer
                holdnavnet i toppen (ejer-runde 3: navnet må aldrig stå dobbelt) */}
            {showTeam && (
              <p className="text-cz-2 text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
                <TeamLink id={rider.team?.id} className="hover:text-cz-accent-t transition-colors">{teamName}</TeamLink>
                {isAiTeam && (
                  <span className="text-3xs uppercase font-bold tracking-wide bg-cz-subtle text-cz-3 border border-cz-border px-1 py-0.5 rounded-cz">
                    {t("profile.hero.aiTag")}
                  </span>
                )}
              </p>
            )}

            {/* Kommende hold (handel til næste sæson) */}
            {pendingTeam && (
              <p className="text-cz-2 text-xs mt-1.5 inline-flex items-center gap-1.5">
                <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-accent-t" />
                <span className="text-cz-3">{t("header.nextSeasonPrefix")}</span>
                <TeamLink id={pendingTeam.id} className="font-semibold text-cz-accent-t hover:underline">{pendingTeam.name}</TeamLink>
              </p>
            )}
          </div>
        </div>

        {/* Actions right — sekundære ikon-knapper (T3: "one secondary + the view's
            one primary"). Den store handlings-klynge (bud/salg/auktion) sidder
            under stat-rækken, da den ikke passer T3's kompakte header-actions-slot. */}
        <div className="flex items-center gap-1 flex-none">
          {onToggleWatchlist && (
            <button
              onClick={onToggleWatchlist}
              title={onWatchlist ? t("header.watchlistRemove") : t("header.watchlistAdd")}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-cz border transition-colors
                ${onWatchlist ? "border-cz-accent/40 text-cz-accent-t bg-cz-accent/5" : "border-cz-border text-cz-3 hover:text-cz-2"}`}
            >
              <StarIcon size={16} aria-hidden="true" fill={onWatchlist ? "currentColor" : "none"} />
            </button>
          )}
          {onCompare && (
            <button
              onClick={onCompare}
              title={t("header.compareTitle")}
              className="min-h-[44px] px-3 flex items-center justify-center rounded-cz border border-cz-border text-xs font-semibold text-cz-3 hover:text-cz-2 transition-colors"
            >
              {t("header.compare")}
            </button>
          )}
        </div>
      </div>

      <StatusBanner banner={banner} />

      {/* Stat-række: T3's HeroStats. To kolonner på mobil (seks tal = tre rækker, ingen
          klippede beløb), og fra sm brydes rækken hellere end at scrolle inde i kortet.
          #3622: værdien i Omdømme/Popularitet er bevidst uden ability-farveplade;
          populationen er ikke evne-kalibreret (statColor.js). */}
      <HeroStats
        className="max-sm:grid-cols-2 max-sm:gap-x-3 sm:flex-wrap sm:gap-y-4 sm:overflow-visible"
        items={[
          {
            label: t("profile.hero.bestRoleEyebrow"),
            /* Farveplade (statColor) + rollenavnet som samme chip som i tabellerne (#5435). */
            value: hasRating ? (
              bestRoleKey ? (
                <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
                  {ratingPlate}
                  <BestRoleTag role={bestRoleKey} variant="full" className="truncate" testId="rider-hero-best-role" />
                </span>
              ) : ratingPlate
            ) : "—",
          },
          {
            label: potentialEyebrow,
            value: scouting ? (
              <span className="inline-block max-w-56 whitespace-normal text-[15px] font-semibold">
                <ScoutablePotentiale rider={rider} scouting={scouting} showScout={viewer === "scouting"} labelAsTitle hideLevel hideNotScouted estimateSize="hero" showLooks={viewer === "scouting"} />
              </span>
            ) : "—",
          },
          {
            label: t("profile.hero.valueEyebrow"),
            value: <span className="block wrap-break-word" title={valueLabel} data-testid="rider-value-amount">{valueLabel}</span>,
          },
          {
            label: t("profile.hero.salary"),
            value: <span className="block wrap-break-word">{salaryText ?? "—"}</span>,
          },
          {
            label: t(reputationOn ? "profile.hero.reputationEyebrow" : "profile.hero.popularityEyebrow"),
            value: reputationOn ? (
              <>
                <button
                  type="button"
                  ref={reputationTriggerRef}
                  className="block min-h-11 cursor-pointer whitespace-normal rounded-cz text-left transition-colors hover:text-cz-2 hover:underline hover:decoration-cz-border hover:underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cz-2"
                  onClick={() => setReputationOpen((isOpen) => {
                    if (isOpen) setReputationPosition(null);
                    return !isOpen;
                  })}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && reputationOpen) {
                      setReputationOpen(false);
                      setReputationPosition(null);
                    }
                  }}
                  aria-expanded={reputationOpen}
                  aria-controls="rider-reputation-details"
                  aria-haspopup="dialog"
                >
                  {reputationBand ? t(`profile.reputation.band.${reputationBand}`) : reputationValue == null ? "—" : Math.round(reputationValue)}
                  {reputationSub}
                </button>
                <ReputationEventList events={reputationEvents} open={reputationOpen} onClose={() => { setReputationOpen(false); setReputationPosition(null); }} dialogRef={reputationDetailsRef} position={reputationPosition} />
              </>
            ) : reputationValue == null ? "—" : Math.round(reputationValue),
          },
          {
            label: t("profile.hero.contract"),
            value: contractText,
            sub: contractSub,
          },
        ]}
      />

      {/* Action-række: injiceres af parent. #7951: salget står til højre for knapperne. */}
      {actions && (
        <div className="mt-5 flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-cz-border pt-5">
          <div className="min-w-0 flex-1 basis-64">{actions}</div>
          {banner?.kind === "listed" && <ForSaleStatus price={banner.price} valueDelta={banner.valueDelta} />}
        </div>
      )}
    </>
  );
}
