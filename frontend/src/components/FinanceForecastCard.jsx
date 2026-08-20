import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { renderBackendMessage } from "../lib/backendMessage";
import { AlertTriangleIcon } from "./ui";

const TIER_BADGE_CLASS = {
  green: "bg-cz-success-bg text-cz-success border-cz-success/30",
  yellow: "bg-cz-warning-bg text-cz-warning border-cz-warning/30",
  red: "bg-cz-danger-bg text-cz-danger border-cz-danger/30",
};

// #986: tone-dot erstatter de tidligere risiko-emoji. Tokeniseret, så farven
// følger temaet (emoji ignorerer dark mode) og rammer anti-slop-smagen.
const TIER_DOT_CLASS = {
  green: "bg-cz-success",
  yellow: "bg-cz-warning",
  red: "bg-cz-danger",
};

function getTierMeta(t, riskTier) {
  const tier = TIER_BADGE_CLASS[riskTier] ? riskTier : "yellow";
  return {
    key: tier,
    label: t(`forecast.tier.${tier}.label`),
    headline: t(`forecast.tier.${tier}.headline`),
    summary: t(`forecast.tier.${tier}.summary`),
    dot: TIER_DOT_CLASS[tier],
    badge: TIER_BADGE_CLASS[tier],
  };
}

function formatSigned(value) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(value))} CZ$`;
}

// #3899 (låst design punkt 2): kompakt "low–high"-formattering til intervaller
// (præmie-linjen). En-dash (–), ikke em-dash — samme konvention som den
// eksisterende horizon.rangeSuffix-nøgle ("({from}–{to})").
function formatRange(low, high) {
  if (low == null || high == null) return "—";
  return `${formatNumber(low)}–${formatNumber(high)} CZ$`;
}

// #4011: sæt uden om label — "signed contracts" på løn-rækken forklarer
// hvorfor kolonnens tal ikke drifter selvom lønformlen skifter ved cutover.
function InlineBadge({ children }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border border-cz-border text-cz-3 text-3xs font-medium ms-1.5 align-middle">
      {children}
    </span>
  );
}

// #4011 (design-go 20/8, punkt A): når `dualColumn` er sat, viser rækken
// BEGGE sæsoner (S2 realiseret/kontrakt + S3 prognose) i stedet for ét tal.
// `s2Value`/value(=S3) er begge valgfrie — en manglende værdi renderer "—"
// (samme formatSigned-fallback som før), så en linje der ikke findes for én
// sæson (fx lånerente uden S2-tal) stadig holder de to kolonner justeret.
// Mobil: kun ÉN kolonne vises ad gangen, styret af forælderens segmenterede
// toggle (`activeCol`) — layoutet stacker i stedet for at klemme to tal sammen
// på en smal skærm (issue-krav "kolonner bliver segmenteret toggle").
function Row({ label, value, accent, detail, badge, dualColumn, s2Value, activeCol }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cz-border last:border-0 gap-3">
      <div className="min-w-0 pr-3">
        <p className="text-cz-2 text-xs">
          {label}
          {badge && <InlineBadge>{badge}</InlineBadge>}
        </p>
        {detail && <p className="text-cz-3 text-2xs mt-0.5 leading-snug">{detail}</p>}
      </div>
      {dualColumn ? (
        <div className="flex items-center gap-3 flex-shrink-0">
          <p className={`font-mono text-sm font-bold tabular-nums w-28 text-end ${accent} ${activeCol === "s3" ? "hidden sm:block" : ""}`}>
            {formatSigned(s2Value)}
          </p>
          <p className={`font-mono text-sm font-bold tabular-nums w-28 text-end ${accent} ${activeCol === "s2" ? "hidden sm:block" : ""}`}>
            {formatSigned(value)}
          </p>
        </div>
      ) : (
        <p className={`font-mono text-sm font-bold ${accent}`}>
          {formatSigned(value)}
        </p>
      )}
    </div>
  );
}

// #3899 (låst design punkt 2): "INTERVAL for det usikre (præmier)" — egen
// row-variant der viser low–high i stedet for ét punkttal. Samme anatomi som
// Row (label + detail venstre, tal højre) så statement-linjerne læses ens.
//
// #4011: dual-column-varianten viser S2 som ét REALISERET punkttal (allerede
// kendt, intet interval nødvendigt) og S3 som det eksisterende interval.
function RangeRow({ label, low, high, accent, detail, dualColumn, s2Value, activeCol }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cz-border last:border-0 gap-3">
      <div className="min-w-0 pr-3">
        <p className="text-cz-2 text-xs">{label}</p>
        {detail && <p className="text-cz-3 text-2xs mt-0.5 leading-snug">{detail}</p>}
      </div>
      {dualColumn ? (
        <div className="flex items-center gap-3 flex-shrink-0">
          <p className={`font-mono text-sm font-bold tabular-nums w-28 text-end ${accent} ${activeCol === "s3" ? "hidden sm:block" : ""}`}>
            {formatSigned(s2Value)}
          </p>
          <p className={`font-mono text-sm font-bold tabular-nums w-28 text-end ${accent} ${activeCol === "s2" ? "hidden sm:block" : ""}`}>
            {formatRange(low, high)}
          </p>
        </div>
      ) : (
        <p className={`font-mono text-sm font-bold tabular-nums ${accent}`}>
          {formatRange(low, high)}
        </p>
      )}
    </div>
  );
}

export default function FinanceForecastCard({
  forecast,
  loading,
  seasonsAhead = 1,
  onSeasonsAheadChange,
  // #4011 (design-go 20/8, punkt A): valgfri S2/S3-opgørelse fra
  // GET /api/finance/season-switch-preview. Uden den falder kortet tilbage
  // til det oprindelige énkolonne-layout (fx Dashboard, eller mens
  // opgørelsen stadig loader) — ingen af de eksisterende brugssteder skal
  // ændre adfærd bare fordi denne prop findes i komponenten.
  seasonSwitch,
}) {
  const { t } = useTranslation("dashboard");
  // #666: warnings emitter { messageKey, params } fra backend; renderes via
  // backendMessages-namespace for fuld locale-rendering.
  const { t: tBackend } = useTranslation("backendMessages");
  // #4011: mobil segmenteret toggle — hvilken kolonne der er synlig under
  // sm-breakpointet (begge er altid synlige fra sm og op). Default S3 (næste
  // sæson) fordi resten af kortet (hero-tallet, risk-tier) allerede handler
  // om næste sæson.
  const [activeCol, setActiveCol] = useState("s3");

  if (loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          <p className="text-cz-3 text-sm">{t("forecast.loading")}</p>
        </div>
      </div>
    );
  }
  if (!forecast) return null;

  const multiSeason = Array.isArray(forecast.forecasts) && forecast.forecasts.length > 1;

  const tier = getTierMeta(t, forecast.risk_tier);
  const netAccent =
    forecast.projected_net >= 0 ? "text-cz-success" : "text-cz-danger";
  const sponsorBreakdown = forecast.inputs?.sponsor_breakdown;
  // #3899 (låst design punkt 1): sponsor-linjen er nu TO rows (base + variabel)
  // i stedet for én kombineret. Base-detaljen navngiver kontrakten når der er
  // én (#2948); variabel-detaljen forklarer rang/point-kilden når den findes.
  const sponsorBaseDetail = sponsorBreakdown?.mode === "contract"
    ? t("forecast.sponsorDetail.contract", {
        sponsor: sponsorBreakdown.sponsor_name ?? "",
        base: formatNumber(sponsorBreakdown.base),
      })
    : sponsorBreakdown?.mode === "intro"
      ? t("forecast.sponsorDetail.intro")
      : sponsorBreakdown?.mode
        ? undefined
        : t("forecast.sponsorDetail.fallback");
  const sponsorVariableDetail = sponsorBreakdown?.mode === "variable"
    ? t("forecast.sponsorDetail.variable", {
        base: formatNumber(sponsorBreakdown.base),
        variable: formatNumber(sponsorBreakdown.variable),
      })
    : undefined;

  // #4011: kortet viser kun to kolonner når opgørelsen faktisk er hentet —
  // se prop-kommentaren ovenfor for hvorfor det er en tavs fallback og ikke
  // en fejltilstand.
  const hasSeasonSwitch = Boolean(seasonSwitch);
  const s2 = seasonSwitch?.s2;
  const currentSeasonNumber = seasonSwitch?.season?.current_number;
  const nextSeasonNumber = seasonSwitch?.season?.next_number;
  const s2ColumnLabel = t("forecast.columns.s2", { number: currentSeasonNumber ?? "?" });
  const s3ColumnLabel = t("forecast.columns.s3", { number: nextSeasonNumber ?? "?" });
  // #4011 (design-go 20/8, punkt A2): løn-rækken kombinerer den eksisterende
  // S3-forklaring med "signed contracts"-chippen, og kun i dual-column-
  // tilstanden — enkelt-kolonne-visningen (Dashboard) beholder den originale
  // tekst uændret.
  const salaryDetail = hasSeasonSwitch
    ? t("forecast.salaryDetail.seasonSwitch", { next: nextSeasonNumber ?? "?" })
    : forecast.inputs?.salary_basis === "production_s3"
      ? t("forecast.salaryDetail.productionS3")
      : undefined;
  const showUpkeepRow = hasSeasonSwitch
    ? forecast.projected_upkeep !== 0 || s2?.upkeep !== 0
    : forecast.projected_upkeep !== 0;
  // #4011 REVISION 20/8 (read-only kode-revision, punkt 4): "Stab &
  // faciliteter" er nu TO rækker i dual-column-tilstanden — facilitets-drift
  // og staff-løn er to forskellige strømme (economyEngine.chargeFacilityCosts
  // debiterer dem som to separate transaktioner). Enkelt-kolonne-visningen
  // (fx Dashboard) beholder den oprindelige kombinerede række uændret.
  const showFacilityUpkeepRow = forecast.projected_facility_upkeep !== 0 || s2?.facility_upkeep !== 0;
  const showStaffSalaryRow = forecast.projected_staff_salary !== 0 || s2?.staff_salary !== 0;
  const showStaffFacilitiesRow = forecast.projected_staff_facilities !== 0;
  const showAcademyDriftRow = hasSeasonSwitch
    ? forecast.projected_academy_drift !== 0 || s2?.academy_drift !== 0
    : forecast.projected_academy_drift !== 0;
  // #4011 REVISION 20/8 (punkt 2): S2's SEASON_START_SPONSOR-transaktion er
  // base OG rang/point-performance-bonus SAMLET i ét beløb (sponsorEngine.
  // computeVariableSponsor) — modsat S3's `sponsor_base`-felt, som er
  // UDELUKKENDE den flade/kontrakt-del. De to tal måler ikke det samme, og et
  // eksakt tilbageregnet split kræver data denne route ikke pålideligt kan
  // rekonstruere (forrige sæsons standings + den dengang aktive kontrakt +
  // den LIVE board-modifier på betalingstidspunktet, #1187). Løsningen er
  // derfor bevidst den ærlige: S2 vises som ÉT kombineret, faktisk krediteret
  // beløb under "Sponsor (base)" med en forklarende note, og "Sponsor
  // (variabel)"-rækkens S2-kolonne viser "—" i stedet for et gættet split.
  const sponsorBaseS2Detail = hasSeasonSwitch
    ? t("forecast.sponsorDetail.s2Combined")
    : undefined;
  // Løbende løbsdags-/resultat-/mål-/underskriftsbonusser — en HELT ANDEN
  // indtægtsstrøm end sponsor-basens rang/point-performance-bonus, og S3
  // forecaster den slet ikke (financeForecast.js's FINANCE_FORECAST_TYPE_
  // COVERAGE markerer alle fire reason_codes `modeled: false`). Egen række,
  // aldrig under samme label som "Sponsor (variabel)".
  const showSponsorInSeasonBonusRow = hasSeasonSwitch && s2?.sponsor_in_season_bonus !== 0;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5 mb-4">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-cz-1 font-semibold text-sm">{t("forecast.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t("forecast.subtitle")}</p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full border text-xs font-medium flex items-center gap-1.5 ${tier.badge}`}
        >
          <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${tier.dot}`} />
          <span>{tier.label}</span>
        </span>
      </div>

      {/* 2026-05-21: Sæsons-horisont selector (1-5) */}
      {typeof onSeasonsAheadChange === "function" && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-cz-3 text-xs">{t("forecast.horizon.label")}</label>
          <select
            value={seasonsAhead}
            onChange={(e) => onSeasonsAheadChange(Number.parseInt(e.target.value, 10))}
            className="bg-cz-subtle border border-cz-border text-cz-1 text-xs rounded-cz px-2 py-1"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{t("forecast.horizon.option", { count: n })}</option>
            ))}
          </select>
          {multiSeason && forecast.summary && (
            <span className="text-cz-3 text-xs">
              {t("forecast.horizon.rangeSuffix", {
                from: forecast.summary.from_season ?? "?",
                to: forecast.summary.to_season ?? "?",
              })}
            </span>
          )}
        </div>
      )}

      <div className="bg-cz-subtle border border-cz-border rounded-cz p-4 mb-4">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">
          {t("forecast.projectedLabel")}
        </p>
        <p className={`font-mono font-bold text-2xl ${netAccent}`}>
          {formatSigned(forecast.projected_net)}
        </p>
        <p className="text-cz-3 text-xs mt-1">
          {t("forecast.rangeLine", {
            low: formatSigned(forecast.confidence_low),
            high: formatSigned(forecast.confidence_high),
          })}
        </p>
        <p className="text-cz-2 text-xs mt-2 leading-snug">
          <strong>{tier.headline}.</strong> {tier.summary}
        </p>
      </div>

      {/* #3899 (låst design punkt 1): regnskabsopstilling — én linje pr. kilde
          i stedet for ét kombineret sponsor-tal. De 5 kernelinjer vises altid
          (også ved 0, fx et hold uden faciliteter/staff) så opstillingen er
          komplet; lånerente + akademi-drift forbliver betingede ekstra-linjer
          som før (uændret adfærd, ikke en del af de 5 navngivne kilder). */}
      <div className="mb-3">
        {/* #4011: kolonne-headere (desktop) / segmenteret toggle (mobil) —
            kun når opgørelsen er hentet. sm:hidden/hidden sm:flex spejler
            hver Row/RangeRow's egen sm-breakpoint-logik ovenfor. */}
        {hasSeasonSwitch && (
          <>
            <div className="hidden sm:flex items-center justify-end gap-3 mb-1.5">
              <span className="w-28 text-end text-cz-3 text-3xs uppercase tracking-wider">{s2ColumnLabel}</span>
              <span className="w-28 text-end text-cz-3 text-3xs uppercase tracking-wider">{s3ColumnLabel}</span>
            </div>
            <div className="sm:hidden flex gap-1.5 mb-2" role="tablist" aria-label={t("forecast.columns.toggleAria")}>
              {[["s2", s2ColumnLabel], ["s3", s3ColumnLabel]].map(([key, colLabel]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeCol === key}
                  onClick={() => setActiveCol(key)}
                  className={`flex-1 px-2 py-1.5 rounded-cz text-xs font-medium border transition-colors
                    ${activeCol === key
                      ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                      : "text-cz-2 border-cz-border"}`}
                >
                  {colLabel}
                </button>
              ))}
            </div>
          </>
        )}
        <Row
          label={t("forecast.row.sponsorBase")}
          value={forecast.projected_sponsor_base}
          accent="text-cz-success"
          // #4011 REVISION 20/8: dual-column viser den ærlige note i stedet
          // for kontrakt-/intro-teksten (som stadig kun beskriver S3-siden).
          detail={hasSeasonSwitch ? sponsorBaseS2Detail : sponsorBaseDetail}
          dualColumn={hasSeasonSwitch}
          s2Value={s2?.sponsor_season_start}
          activeCol={activeCol}
        />
        <Row
          label={t("forecast.row.sponsorVariable")}
          value={forecast.projected_sponsor_variable}
          accent="text-cz-success"
          detail={sponsorVariableDetail}
          dualColumn={hasSeasonSwitch}
          // #4011 REVISION 20/8: INGEN s2Value her — S2's rang/point-andel er
          // uadskilleligt foldet ind i rækken ovenfor (se sponsorBaseS2Detail).
          // Row's formatSigned-fallback viser "—", ikke et gættet tal.
          activeCol={activeCol}
        />
        {showSponsorInSeasonBonusRow && (
          <Row
            label={t("forecast.row.sponsorInSeasonBonus")}
            // S3 forecaster IKKE denne strøm (result-/løbsdag-afhængig) — value
            // forbliver undefined, Row viser "—" i S3-kolonnen.
            accent="text-cz-success"
            detail={t("forecast.sponsorDetail.inSeasonBonus")}
            dualColumn={hasSeasonSwitch}
            s2Value={s2?.sponsor_in_season_bonus}
            activeCol={activeCol}
          />
        )}
        <RangeRow
          label={t("forecast.row.prize")}
          low={forecast.prize_low}
          high={forecast.prize_high}
          accent="text-cz-success"
          detail={
            /* #981: gulv = realiseret sæson-præmie når rolling avg er lavere */
            forecast.inputs?.prize_basis === "realized_season_floor"
              ? t("forecast.prizeDetail.realizedFloor")
              : t("forecast.prizeDetail.divisionInterval")
          }
          dualColumn={hasSeasonSwitch}
          s2Value={s2?.prize}
          activeCol={activeCol}
        />
        <Row
          label={t("forecast.row.salary")}
          value={forecast.projected_salary}
          accent="text-cz-danger"
          detail={salaryDetail}
          // #4011 (design-go 20/8, punkt A2): "signed contracts"-chip på
          // løn-rækken, kun i dual-column-tilstanden — den forklarer hvorfor
          // S2-tallet ikke er en prognose men en allerede underskrevet aftale.
          badge={hasSeasonSwitch ? t("forecast.chip.signedContracts") : undefined}
          dualColumn={hasSeasonSwitch}
          s2Value={s2?.salary}
          activeCol={activeCol}
        />
        {/* #3986: divisions-upkeep laa foer gemt inde i stab/faciliteter-linjen,
            saa en D2-manager saa 164.910 hvor hans tre ansatte kostede 24.610.
            Den har nu sin egen raekke. Skjules naar den er 0 (saeson 1 udskyder
            upkeep, jf. UPKEEP_BEFORE_FIRST_RACE_ENABLED), saa vi ikke viser en
            nul-linje der ikke betyder noget. */}
        {showUpkeepRow && (
          <Row
            label={t("forecast.row.upkeep")}
            value={forecast.projected_upkeep}
            accent="text-cz-danger"
            detail={t("forecast.upkeepDetail.byDivision")}
            dualColumn={hasSeasonSwitch}
            s2Value={s2?.upkeep}
            activeCol={activeCol}
          />
        )}
        {/* #4011 REVISION 20/8 (punkt 4): to separate rækker i dual-column-
            tilstanden (facility-drift og staff-løn er forskellige strømme);
            enkelt-kolonne-visningen beholder den kombinerede række uændret. */}
        {hasSeasonSwitch ? (
          <>
            {showFacilityUpkeepRow && (
              <Row
                label={t("forecast.row.facilityUpkeep")}
                value={forecast.projected_facility_upkeep}
                accent="text-cz-danger"
                dualColumn
                s2Value={s2?.facility_upkeep}
                activeCol={activeCol}
              />
            )}
            {showStaffSalaryRow && (
              <Row
                label={t("forecast.row.staffSalary")}
                value={forecast.projected_staff_salary}
                accent="text-cz-danger"
                dualColumn
                s2Value={s2?.staff_salary}
                activeCol={activeCol}
              />
            )}
          </>
        ) : (
          showStaffFacilitiesRow && (
            <Row
              label={t("forecast.row.staffFacilities")}
              value={forecast.projected_staff_facilities}
              accent="text-cz-danger"
            />
          )
        )}
        {/* #4011: lånerente indgår ikke i sæsonskifte-opgørelsen (kun de 7
            navngivne kildelinjer har et S2-realiseret tal) — s2Value forbliver
            undefined og Row's formatSigned-fallback viser "—" i S2-kolonnen,
            så gitteret stadig holder linje med de øvrige rækker. */}
        {forecast.projected_loan_interest !== 0 && (
          <Row
            label={t("forecast.row.loanInterest")}
            value={forecast.projected_loan_interest}
            accent="text-cz-danger"
            dualColumn={hasSeasonSwitch}
            activeCol={activeCol}
          />
        )}
        {showAcademyDriftRow && (
          <Row
            label={t("forecast.row.academyDrift")}
            value={forecast.projected_academy_drift}
            accent="text-cz-danger"
            dualColumn={hasSeasonSwitch}
            s2Value={s2?.academy_drift}
            activeCol={activeCol}
          />
        )}
      </div>

      {/* #3899 (låst design punkt 3): erklæret antagelses-linje, ordret. */}
      <p className="text-cz-3 text-2xs mb-3 leading-snug">
        {t("forecast.assumption")}
      </p>

      {multiSeason && (
        <div className="bg-cz-subtle border border-cz-border rounded-cz p-3 mb-3">
          <p className="text-cz-2 font-medium text-xs mb-2">
            {t("forecast.multiSeason.title", { from: forecast.forecasts[1]?.season_number ?? "?" })}
          </p>
          <div className="overflow-x-auto">
            <table data-sort-exempt="Multi-saeson fremskrivning i kronologisk orden (1-5 raekker)" className="w-full text-xs">
              <thead>
                <tr className="text-cz-3 text-start">
                  <th className="py-1 pe-2">{t("forecast.multiSeason.headers.season")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.sponsor")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.prize")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.salary")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.interest")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.net")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.endBalance")}</th>
                  <th className="py-1 ps-2 text-end">{t("forecast.multiSeason.headers.risk")}</th>
                </tr>
              </thead>
              <tbody>
                {forecast.forecasts.map((row) => {
                  const rowTier = getTierMeta(t, row.risk_tier);
                  return (
                    <tr key={row.season_number} className="border-t border-cz-border">
                      <td className="py-1 pe-2 text-cz-1 font-medium">
                        S{row.season_number}
                        {row.is_estimate && (
                          <span className="text-cz-3 text-3xs ms-1" title={t("forecast.multiSeason.estimateTooltip")}>{t("forecast.multiSeason.estimateMark")}</span>
                        )}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-success">
                        {formatSigned(row.projected_sponsor)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono tabular-nums text-cz-success">
                        {/* #3899 (låst design punkt 4): horisont-vælgeren skal bære interval pr. sæson. */}
                        {formatRange(row.prize_low, row.prize_high)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-danger">
                        {formatSigned(row.projected_salary)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-danger">
                        {formatSigned(row.projected_loan_interest)}
                      </td>
                      <td className={`py-1 px-2 text-end font-mono font-bold ${row.projected_net >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                        {formatSigned(row.projected_net)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-1">
                        {formatNumber(row.ending_balance)} CZ$
                      </td>
                      <td className="py-1 ps-2 text-end" title={rowTier.summary}>
                        <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${rowTier.dot}`} />
                        <span className="sr-only">{rowTier.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-cz-border font-semibold">
                  <td className="py-1 pe-2 text-cz-1">{t("forecast.multiSeason.total")}</td>
                  <td colSpan={4}></td>
                  <td className={`py-1 px-2 text-end font-mono ${forecast.summary?.total_net >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                    {formatSigned(forecast.summary?.total_net ?? 0)}
                  </td>
                  <td className="py-1 px-2 text-end font-mono text-cz-1">
                    {formatNumber(forecast.summary?.ending_balance ?? 0)} CZ$
                  </td>
                  <td className="py-1 ps-2 text-end">
                    <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${getTierMeta(t, forecast.summary?.worst_risk_tier).dot}`} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-cz-3 text-2xs mt-2">
            {t("forecast.multiSeason.estimateNote")}
          </p>
        </div>
      )}

      {(forecast.warnings || []).length > 0 && (
        <div className="flex flex-col gap-2">
          {forecast.warnings.map((warn) => {
            const text = warn.messageKey
              ? renderBackendMessage(
                  { code: warn.messageKey, params: warn.params },
                  tBackend,
                  warn.message,
                )
              : warn.message;
            return (
              <div
                key={warn.code}
                className={`px-3 py-2 rounded-cz text-xs leading-snug border
                  ${warn.severity === "high"
                    ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
                    : "bg-cz-warning-bg text-cz-warning border-cz-warning/30"}`}
              >
                <AlertTriangleIcon size={13} aria-hidden="true" className="inline-block me-1 -mt-0.5" />
                {text}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-cz-3 text-xs mt-4 leading-snug">
        {t("forecast.footnote")}{" "}
        <Link to="/help?faq=forecastCalculation" className="underline hover:text-cz-1">
          {t("forecast.footnoteLink")}
        </Link>
      </p>
    </div>
  );
}

export function FinanceForecastBadge({ forecast, compact = false }) {
  const { t } = useTranslation("dashboard");
  const { t: tBackend } = useTranslation("backendMessages");
  if (!forecast) return null;
  const tier = getTierMeta(t, forecast.risk_tier);
  const netAccent =
    forecast.projected_net >= 0 ? "text-cz-success" : "text-cz-danger";

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-3xs font-medium ${tier.badge}`}
        title={tier.summary}
      >
        <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full ${tier.dot}`} />
        <span className="font-mono">{formatSigned(forecast.projected_net)}</span>
      </span>
    );
  }

  return (
    <Link
      to="/finance"
      className="block bg-cz-card border border-cz-border rounded-cz px-4 py-3 hover:bg-cz-subtle transition-all"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">
            {t("forecast.badge.label")}
          </p>
          <p className={`font-mono font-bold text-base truncate ${netAccent}`}>
            {formatSigned(forecast.projected_net)}
          </p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full border text-xs font-medium flex items-center gap-1.5 flex-shrink-0 ${tier.badge}`}
        >
          <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${tier.dot}`} />
          <span>{tier.label}</span>
        </span>
      </div>
      {forecast.warnings?.length > 0 && (
        <p className="text-cz-3 text-xs mt-1.5 truncate">
          {forecast.warnings[0].messageKey
            ? renderBackendMessage(
                { code: forecast.warnings[0].messageKey, params: forecast.warnings[0].params },
                tBackend,
                forecast.warnings[0].message,
              )
            : forecast.warnings[0].message}
        </p>
      )}
    </Link>
  );
}
