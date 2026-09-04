import { useMemo, useState } from "react";
import { projectDivisionAdjustment } from "../lib/divisionAdjustment";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import Modal from "./ui/Modal.jsx";
import Button from "./ui/Button.jsx";
import {
  BikeIcon,
  BriefcaseIcon,
  ClockIcon,
  CoinIcon,
  FlagIcon,
  LockIcon,
  PodiumIcon,
  TeamIcon,
  TrophyIcon,
} from "./ui/icons/index.jsx";

// #1663/#2948 · Sponsor-tilbuds-modal (præsentationel, henter ikke selv data).
// Vises fra Board-fladen. 5 arketype-kort med bonusklausuler, divisionsvælger
// med løbsdage (#2862), deadline-banner + default-regel (#1778/#2914) og
// Review & sign-bekræftelse (ejer-godkendt mockup 25/7). Valg propageres via
// onAccept(variant) efter eksplicit bekræftelse.
//
// #3020 (ejer-beslutning 27/7): divisionsskalering af loftet er UDSKUDT til
// sæson 3 (for stort et økonomi-indgreb midt i S2-valgvinduet). Denne omgang
// er copy-only: divisionNote gør eksplicit at MAKS-udbetalingen er den samme
// uanset hvilken pill man klikker, kun raten pr. etape ændrer sig — det svarer
// direkte på cuchiets Discord-spørgsmål uden at røre projections()/udbetaling.

const VARIANT_ICONS = {
  safe: LockIcon,
  loyal: BriefcaseIcon,
  racing: BikeIcon,
  results: TrophyIcon,
  ambition: FlagIcon,
  // Legacy-varianter (før #2948) — vises hvis en gammel offers-payload rammer UI'et.
  predictable: LockIcon,
  activity: BikeIcon,
  long: BriefcaseIcon,
};

const CLAUSE_ICONS = {
  signing: CoinIcon,
  stage_win: TrophyIcon,
  podium: PodiumIcon,
  season_objective: FlagIcon,
};

// Klausul-rendering: results_cap er ikke sin egen linje — den flettes ind i
// stage_win/podium-linjernes cap-tekst.
function clauseLines(clauses, t) {
  const cap = (clauses || []).find((c) => c.type === "results_cap");
  return (clauses || [])
    .filter((c) => c.type !== "results_cap")
    .map((c) => {
      const amount = formatNumber(c.amount);
      if (c.type === "signing") return { type: c.type, text: t("clause.signing", { amount }) };
      if (c.type === "stage_win") return { type: c.type, text: t("clause.stageWin", { amount }) };
      if (c.type === "podium") {
        return {
          type: c.type,
          text: cap
            ? t("clause.podiumCapped", { amount, cap: formatNumber(cap.amount) })
            : t("clause.podium", { amount }),
        };
      }
      if (c.type === "season_objective") {
        // #3192: nye tilbud bruger "top_40pct"; allerede-tegnede kontrakter kan
        // stadig bære det gamle "top_half" (frosset ved pick, aldrig ændret retroaktivt).
        const key = c.objective === "top_40pct" ? "clause.seasonObjectiveTop40" : "clause.seasonObjective";
        return { type: c.type, text: t(key, { amount }) };
      }
      return null;
    })
    .filter(Boolean);
}

export default function SponsorOfferModal({
  open,
  onClose,
  offers = [],
  pendingVariant = null,
  upcomingSeasonNumber,
  stageCounts = null,
  teamDivision = null,
  onAccept,
  accepting = false,
}) {
  const { t } = useTranslation("sponsor");
  const [confirming, setConfirming] = useState(null);

  const divisions = useMemo(
    () => Object.keys(stageCounts?.byTier || {}).map(Number).sort((a, b) => a - b),
    [stageCounts]
  );
  const [selectedDivision, setSelectedDivision] = useState(null);
  const activeDivision =
    selectedDivision ?? (divisions.includes(Number(teamDivision)) ? Number(teamDivision) : divisions[0] ?? null);
  const raceDays =
    (activeDivision != null ? stageCounts?.byTier?.[activeDivision] : null) ??
    stageCounts?.fallbackDays ??
    null;
  // Sæsonens kalenderlængde (seasons.race_days_total). Bruges KUN til at forklare
  // forholdet mellem etaper og kalenderdage — spillerne læste "race day" som en
  // IRL-dag (#2862). Sætningen vises kun når der faktisk er >1 etape pr. dag, så
  // den ikke lyver hvis raceDays selv er faldet tilbage til kalenderlængden.
  const calendarDays = Number(stageCounts?.fallbackDays) || null;
  const stagesPerDay =
    Number(raceDays) > 0 && calendarDays > 0 ? Number(raceDays) / calendarDays : null;

  // #4376 · Divisions-tillaegget. Aftalen prissaettes mod holdets NUVAERENDE division;
  // ender holdet i en anden, lægges korrektionen oveni hver saeson forskellen findes.
  // Den vises HER, foer underskriften — det var spillerens eksplicitte forbehold da
  // reglen blev valgt. Kun relevant naar manageren kigger paa en anden division end sin egen.
  const divisionAdjustment = projectDivisionAdjustment({
    targetDivision: activeDivision,
    signedDivision: Number(teamDivision),
  });

  const confirmingOffer = offers.find((o) => o.variant === confirming) || null;

  function projections(offer) {
    // Nye tilbud (#2948) bærer frosne andele → projicér mod valgt divisions
    // etapetal. Legacy-payloads uden andele viser blot den lagrede rate.
    const clauses = offer.clauses || [];
    const signing = Number(clauses.find((c) => c.type === "signing")?.amount) || 0;
    const fraction = Number(offer.guaranteedFraction);
    const share = Number(offer.raceDayShare);
    if (!(fraction > 0) || !Number.isFinite(share) || !(Number(raceDays) > 0)) {
      return { rate: offer.perRaceDayRate ?? 0, raceDayPool: null, certain: null, signing, upside: 0 };
    }
    const target = Math.round(offer.guaranteedBase / fraction);
    const raceDayPool = Math.round(target * share);
    const cap = Number(clauses.find((c) => c.type === "results_cap")?.amount) || 0;
    const objective = Number(clauses.find((c) => c.type === "season_objective")?.amount) || 0;
    return {
      rate: Math.round(raceDayPool / Number(raceDays)),
      raceDayPool,
      // Det holdet faktisk får løbende ved at stille til start hver etape.
      // Underskriftsbonussen er en engangsbetaling ved aktivering og vises som
      // sin egen linje i stedet — den må ikke blandes ind her, for spilleren
      // læste totalen som en løbende udbetaling (#4416).
      certain: offer.guaranteedBase + raceDayPool,
      signing,
      // Betinget top: resultatloft + sæsonmål. Holdes UDE af "certain" så kortet
      // ikke lover penge der kræver sejre (den gamle "Maks"-linje blandede dem).
      upside: cap + objective,
    };
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      closeLabel={t("offers.choose")}
      ariaLabelledby="sponsor-offer-modal-title"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="sponsor-offer-modal-title"
            className="font-display text-2xl leading-none tracking-[.01em] text-cz-1"
          >
            {t("offers.title")}
          </h2>
          <p className="mt-1.5 text-sm text-cz-2">
            {t("offers.subtitle", { season: upcomingSeasonNumber })}
          </p>
        </div>
        {divisions.length > 1 && (
          <div className="flex gap-1.5" role="group" aria-label={t("offers.divisionPicker")}>
            {divisions.map((d) => {
              const active = d === activeDivision;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDivision(d)}
                  className={`px-2.5 py-1 rounded-cz border text-xs tabular-nums transition-colors ${
                    active
                      ? "border-cz-accent-t text-cz-accent-t"
                      : "border-cz-border text-cz-2 hover:border-cz-3"
                  }`}
                >
                  {t("offers.divisionPill", { division: d, count: stageCounts?.byTier?.[d] ?? 0 })}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* #2862: enheden forklaret med holdets egne tal. Spillerne læste "race day"
          som en kalenderdag og byggede regneark for at gætte forholdet — her står
          det direkte: hvor mange etaper divisionen kører, og hvor mange dage de
          ligger på. */}
      <div className="mb-3 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2.5">
        <div className="flex items-start gap-2">
          <BikeIcon size={15} className="mt-0.5 flex-shrink-0 text-cz-accent-t" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-cz-1">{t("offers.unitDefinition")}</p>
            {Number(raceDays) > 0 && activeDivision != null && (
              <p className="mt-1 text-xs tabular-nums text-cz-2">
                {t("offers.unitCount", {
                  division: activeDivision,
                  count: Number(raceDays),
                  season: upcomingSeasonNumber,
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
            {divisionAdjustment !== 0 && (
              <p className="mt-1 text-xs tabular-nums text-cz-2">
                {t(
                  divisionAdjustment > 0
                    ? "offers.divisionAdjustmentUp"
                    : "offers.divisionAdjustmentDown",
                  {
                    division: activeDivision,
                    signed: Number(teamDivision),
                    amount: formatNumber(Math.abs(divisionAdjustment)),
                  }
                )}
              </p>
            )}
            {divisions.length > 1 && (
              <p className="mt-1 text-xs text-cz-3">{t("offers.divisionNote")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2">
        <ClockIcon size={15} className="flex-shrink-0 text-cz-2" aria-hidden="true" />
        <p className="text-xs text-cz-2">{t("offers.deadline", { season: upcomingSeasonNumber })}</p>
      </div>

      {offers.length === 0 ? (
        <p className="text-cz-3 text-sm">{t("offers.empty")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer) => {
            const selected = pendingVariant === offer.variant;
            const Icon = VARIANT_ICONS[offer.variant] ?? BriefcaseIcon;
            const { rate, raceDayPool, certain, signing, upside } = projections(offer);
            const lines = clauseLines(offer.clauses, t);
            const fractionPct = Number(offer.guaranteedFraction) > 0
              ? Math.round(Number(offer.guaranteedFraction) * 100)
              : null;
            return (
              <div
                key={offer.variant}
                className={`bg-cz-card border rounded-cz p-4 flex flex-col gap-2.5 ${
                  selected ? "border-cz-accent-t" : "border-cz-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-cz-subtle flex items-center justify-center">
                      <Icon size={16} className="text-cz-2" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-cz-1 font-semibold text-sm leading-tight truncate">
                        {offer.sponsorName}
                      </p>
                      <p className="text-cz-3 text-xs mt-0.5">
                        {t(`variant.${offer.variant}`, { defaultValue: offer.variant })}
                      </p>
                    </div>
                  </div>
                  {selected && (
                    <span className="flex-shrink-0 px-2 py-0.5 rounded-full border border-cz-accent-t/40 text-cz-accent-t text-3xs font-medium uppercase tracking-wider">
                      {t("offers.pending")}
                    </span>
                  )}
                </div>

                {fractionPct !== null && (
                  <div
                    className="h-1 rounded-full bg-cz-subtle overflow-hidden"
                    role="img"
                    aria-label={t("offers.guaranteedShare", { pct: fractionPct })}
                  >
                    <div className="h-full bg-cz-accent" style={{ width: `${fractionPct}%` }} />
                  </div>
                )}

                {/* Regnestykket i stedet for en formel: garanteret + etaper ×
                    rate = hvad holdet får ved at stille til start. Betingede
                    bonusser står for sig, så kortet ikke lover sejrspenge. */}
                <dl className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-cz-3">{t("field.guaranteedBase")}</dt>
                    <dd className="whitespace-nowrap font-mono tabular-nums text-cz-1">
                      {formatNumber(offer.guaranteedBase)} CZ$
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-cz-3">
                      {raceDayPool !== null
                        ? t("field.raceDayMath", {
                            count: Number(raceDays) || 0,
                            rate: formatNumber(rate),
                          })
                        : t("field.perRaceDay")}
                    </dt>
                    <dd className="whitespace-nowrap font-mono tabular-nums text-cz-1">
                      {formatNumber(raceDayPool !== null ? raceDayPool : rate)} CZ$
                    </dd>
                  </div>
                  {certain !== null && (
                    <div className="flex items-center justify-between gap-2 border-t border-cz-border pt-1.5">
                      <dt className="text-cz-2">{t("field.ifYouStartEveryStage")}</dt>
                      <dd className="whitespace-nowrap font-mono tabular-nums font-semibold text-cz-1">
                        {formatNumber(certain)} CZ$
                      </dd>
                    </div>
                  )}
                  {signing > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-cz-3">{t("field.signingBonus")}</dt>
                      <dd className="whitespace-nowrap font-mono tabular-nums text-cz-2">
                        +{formatNumber(signing)} CZ$
                      </dd>
                    </div>
                  )}
                  {certain !== null && upside > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-cz-3">{t("field.bonusUpside")}</dt>
                      <dd className="whitespace-nowrap font-mono tabular-nums text-cz-2">
                        +{formatNumber(upside)} CZ$
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-cz-3">{t("field.length")}</dt>
                    <dd className="whitespace-nowrap font-mono tabular-nums text-cz-1">
                      {t("field.seasons", { count: offer.lengthSeasons })}
                    </dd>
                  </div>
                </dl>

                {lines.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {lines.map((line) => {
                      const ClauseIcon = CLAUSE_ICONS[line.type] ?? CoinIcon;
                      return (
                        <li key={line.type} className="flex items-start gap-1.5 text-xs text-cz-1">
                          <ClauseIcon size={13} className="mt-0.5 flex-shrink-0 text-cz-accent-t" aria-hidden="true" />
                          <span>{line.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-auto"
                  disabled={accepting}
                  onClick={() => setConfirming(offer.variant)}
                >
                  {t("offers.reviewSign")}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {confirmingOffer && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-accent-t/40 bg-cz-subtle px-4 py-3">
          <p className="text-sm text-cz-1">
            {t("offers.confirmBody", {
              sponsor: confirmingOffer.sponsorName,
              count: confirmingOffer.lengthSeasons,
              season: upcomingSeasonNumber,
            })}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={accepting} onClick={() => setConfirming(null)}>
              {t("offers.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={accepting}
              onClick={() => {
                onAccept?.(confirmingOffer.variant);
                setConfirming(null);
              }}
            >
              {t("offers.signDeal")}
            </Button>
          </div>
        </div>
      )}

      {/* Svarer cuchiets spørgsmål 25/7: bestyrelsens modifier rammer KUN den
          garanterede base (economyEngine gross_sponsor), ikke løbsdags-pengene
          eller bonusserne — de krediteres rå i sponsorRaceDayIncome. */}
      <p className="mt-4 flex items-start gap-1.5 text-xs text-cz-3">
        <TeamIcon size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>{t("offers.boardNote")}</span>
      </p>
    </Modal>
  );
}
