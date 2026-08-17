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

import { useTranslation } from "react-i18next";
import { Flag } from "../../Flag";
import TeamLink from "../../TeamLink";
import { statPlateStyle } from "../../../lib/statColor";
import RiderTypeBadge from "../RiderTypeBadge";
import ScoutablePotentiale from "../ScoutablePotentiale";
import RiderValueTrendBadge from "../RiderValueTrendBadge.jsx";
import RiderBadges from "../RiderBadges";
import { retirementRiskBadgeKey } from "../../../lib/riderAge";
import { AlertTriangleIcon, CategoryTag, StarIcon } from "../../ui";

// Division-chip — ENESTE rå-hex-undtagelse (spec): brand-uafhængig divisions-blå.
const DIVISION_CHIP = "rgb(96 165 250)";

// T3 hero stat-blok (PAGE_TEMPLATES.md T3): label 10px uppercase tracking .1em
// text-3 · value data-font 20px/650 tabular · optional sub-linje. Grid (ikke
// RaceDetailPage's overflow-x-auto-række): rytter-hero'en har 5 blokke og et
// variabelt-bredt POTENTIAL-widget (stjerner+scout-knap) — en flex-scroll-række
// ville kunne skubbe den testede VALUE-blok uden for viewport på mobil
// (core-smoke.spec.js måler dens bounding-rect). Grid'en giver samme label/
// value-anatomi men wrapper sikkert i stedet for at skuble bredde ud af syne.
function HeroStat({ label, value, sub, valueClassName = "text-[20px] font-[650]", valueProps = {} }) {
  return (
    <div className="min-w-0">
      <p className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{label}</p>
      <div
        className={`font-data leading-tight text-cz-1 tabular-nums ${valueClassName}`}
        {...valueProps}
      >
        {value ?? "—"}
      </div>
      {sub}
    </div>
  );
}

// Status-banner (betinget). `banner` = { kind, ...data } fra parent. Gold-tonet for
// markeds-tilstande, amber for kontrakt-udløb, neutral for akademi.
function StatusBanner({ banner }) {
  const { t } = useTranslation("rider");
  if (!banner) return null;

  const TONES = {
    listed:  "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t",
    auction: "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t",
    academy: "bg-cz-subtle border-cz-border text-cz-2",
    expiry:  "bg-cz-warning-bg border-cz-warning/30 text-cz-warning",
  };
  const tone = TONES[banner.kind] ?? TONES.academy;

  let text = null;
  if (banner.kind === "listed")  text = t("profile.banner.listed", { price: banner.price });
  if (banner.kind === "auction") text = t("profile.banner.auction", { endsIn: banner.endsIn, highBid: banner.highBid });
  if (banner.kind === "academy") text = t("profile.banner.academy");
  if (banner.kind === "expiry")  text = t("profile.banner.expiry", { season: banner.season });
  if (!text) return null;

  return (
    <div className={`mt-4 flex items-center gap-2 rounded-cz border px-3.5 py-2.5 text-sm ${tone}`}>
      {banner.kind === "expiry" && <AlertTriangleIcon size={16} aria-hidden="true" className="flex-shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

export default function RiderProfileHero({
  rider,
  viewer = "own",                 // "own" | "scouting"
  showTeam = true,                // false når switcher-baren allerede viser holdnavnet (ejer-runde 3: aldrig dobbelt)
  overallRating,
  age,
  seasonYear = null,        // #3071: sæson-referenceår (useActiveSeasonYear) — retirementRiskBadgeKey
  typeLabel,
  divisionLabel,                  // fx "DIV 2" (null hvis ukendt)
  valueAmount,                    // "4.366" (uden CZ$-suffix)
  valueLabel,                     // fuld label til title
  valueTrendWindow = null,        // #2499: { delta, pct, actualDaysAgo, snapshotDate } | null
  salaryText,                     // præ-formateret løn, fx "CZ$ 293/år"
  isAiTeam = false,
  pendingTeam = null,             // kommende hold (handel til næste sæson) | null
  banner = null,                  // { kind, ...data }
  scouting,
  onWatchlist = false,
  onToggleWatchlist,
  onCompare,                      // () => void — navigér til /compare?ids=... (parent styrer routing)
  actions = null,                 // action-række (ReactNode) — injiceres af parent
}) {
  const { t } = useTranslation("rider");

  const teamName = rider.team?.name ?? t("header.freeAgent");
  const potentialEyebrow = viewer === "scouting"
    ? t("profile.hero.potentialScouted")
    : t("profile.hero.potentialOwn");
  const isU23 = rider.is_u25 != null && age != null && age < 23;
  const hasRating = Number.isFinite(overallRating);
  const contractText = rider.contract_end_season != null
    ? t("profile.hero.contractSeason", { season: rider.contract_end_season })
    : t("header.noContract");

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
            <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 break-words">
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
                <span aria-hidden="true" className="text-cz-accent-t">→</span>
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

      {/* Stat-række — HeroStat-anatomien (T3), grid så den wrapper sikkert på mobil.
          #3622: popularitet var kun synlig i bestyrelsen (star-score-blandingen,
          boardIdentity.calculateRiderStarScore); den rå værdi (samme kolonne, 0-100)
          vises nu som 6. hero-stat — plain tal, samme anatomi som Value/Salary/
          Kontrakt (ingen ability-farveplade — populationen er ikke evne-kalibreret,
          jf. statColor.js's fire-skala-advarsel). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 mt-5 pt-4 border-t border-cz-border">
        <HeroStat
          label={t("profile.hero.ratingEyebrow")}
          value={hasRating ? (
            /* Farveplade (ejer-feedback): samme statColor-skala som ability-tallene
               — genindfører det gamle designs instant-signal i systemets sprog.
               #2888/#2906: selve style-udtrykket er nu den delte statPlateStyle,
               så heroen, personale-heroen og trup-tabellen ikke kan drifte fra
               hinanden (samme 16%-alpha-plade var kopieret tre steder). */
            <span
              className="inline-flex items-center justify-center min-w-[38px] h-[30px] px-2 rounded-cz"
              style={statPlateStyle(overallRating)}
            >
              {overallRating}
            </span>
          ) : "—"}
        />
        <HeroStat
          label={potentialEyebrow}
          value={scouting
            ? <ScoutablePotentiale rider={rider} scouting={scouting} showScout={viewer === "scouting"} labelAsTitle hideLevel />
            : "—"}
          valueClassName="text-[15px] font-semibold"
        />
        <HeroStat
          label={t("profile.hero.valueEyebrow")}
          value={valueAmount}
          valueClassName="text-[20px] font-[650] truncate"
          valueProps={{ title: valueLabel, "data-testid": "rider-value-amount" }}
          sub={<RiderValueTrendBadge window={valueTrendWindow} className="mt-1" />}
        />
        <HeroStat label={t("profile.hero.salary")} value={salaryText ?? "—"} valueClassName="text-[20px] font-[650] truncate" />
        <HeroStat
          label={t("profile.hero.popularityEyebrow")}
          value={Number.isFinite(rider.popularity) ? rider.popularity : "—"}
          valueClassName="text-[20px] font-[650]"
        />
        <HeroStat
          label={t("profile.hero.contract")}
          value={<span className={rider.contract_end_season != null ? "text-cz-accent-t" : undefined}>{contractText}</span>}
          valueClassName="text-[20px] font-[650] truncate"
        />
      </div>

      {/* Action-række — injiceres af parent (genbruger eksisterende handlinger). */}
      {actions && <div className="mt-5 pt-5 border-t border-cz-border">{actions}</div>}
    </>
  );
}
