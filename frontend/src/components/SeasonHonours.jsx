import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Flag } from "./Flag";
import RiderBadges from "./rider/RiderBadges";
import { formatNumber } from "../lib/intl";
import { topOf } from "../lib/seasonHonours";
import {
  Section, SectionHeader, EmptyState, ErrorState, Button, SkeletonLines,
  ChartLineIcon, TrophyIcon,
} from "./ui";

// #2863 — sæsonens bedste ryttere, øverst på /seasons.
//
// Ejerens model (Discord 23/7): flest point og flest sejre. Begge tal kommer fra
// get_season_honours(), der læser rider_rankings_mv, altså samme kolonner som
// rytter-ranglisten har vist hele sæsonen. Ren visning: intet her rører
// sæsonskiftet.
//
// NAVNGIVNING — ejer-beslutning 26/7: labelen siger hvad der MÅLES ("flest
// point" / "flest sejre"), ikke hvad nogen har vundet. Ordene verdensmester og
// europamester er lovet til #934/#266, der bygger VM og EM som rigtige løb;
// brugte vi dem her, ville to forskellige ryttere kunne være "verdensmester" i
// samme sæson. Ceremonien kommer derfor fra OPSÆTNINGEN, ikke fra ordene:
// guld-keyline på oversiden (samme T3-signatur som rytter-/løbs-hero'en),
// navnet i Bebas, hairline-delte nummer 2 til 5 nedenunder, og en note der
// siger hvad "sejre" tæller. Ingen skygger, ingen emoji, tabulære tal overalt.
// Fordi labelen er en optælling og ikke en titel, er den ens før og efter
// sæsonslut; det er `Foreløbig`-chippen i sektions-headeren der bærer
// forskellen. Skal det en dag være en titel, er det fire strenge i
// seasonEnd-namespacet, ikke en kodeændring.
//
// Blokken må ALDRIG kunne vælte resten af siden. Ved sæson-cutover rammer ~150
// managere /seasons samtidig via season_ended-notifikationen, så SeasonEndPage
// holder honours i sin egen state: RPC'en mangler indtil migrationen er applied
// (da rendres blokken slet ikke), og enhver anden fejl bliver til en
// fejl-tilstand INDE i kortet mens slutstilling og kalender stadig virker.

// Ikonerne beskriver MÅLINGEN, ikke en titel: en kurve for point der er samlet
// op over sæsonen, et trofæ for sejre der er kørt hjem. En globus/trøje ville
// pege på VM/EM, hvilket er præcis det navngivningen bevidst undgår.
const METRIC_ICON = { points: ChartLineIcon, wins: TrophyIcon };

function MetricValue({ metric, value, t }) {
  return (
    <p className="font-data text-[20px] font-[650] leading-tight tabular-nums text-cz-1">
      {formatNumber(value)}
      <span className="ms-1.5 font-sans text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">
        {t(`honours.unit.${metric}`)}
      </span>
    </p>
  );
}

// Én måling: hvad der tælles, nr. 1 i Bebas, hold-linje, tallet, og nummer 2
// til 5 som hairline-delte rækker. Labelen er den SAMME før og efter sæsonslut,
// fordi "flest point" er lige sandt begge steder; det er `Foreløbig`-chippen i
// sektions-headeren der siger om tallene kan nå at flytte sig endnu.
function HonourColumn({ metric, entries, className = "" }) {
  const { t } = useTranslation("seasonEnd");
  const { leader, runnersUp, shared } = topOf(entries, metric);
  const Icon = METRIC_ICON[metric];

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={15} className="flex-shrink-0 text-cz-accent" aria-hidden="true" />
        <span className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
          {t(`honours.title.${metric}`)}
        </span>
      </div>

      {!leader ? (
        <p className="text-[13px] text-cz-2">{t("honours.noRider")}</p>
      ) : (
        <>
          <Link
            to={leader.riderId ? `/riders/${leader.riderId}` : "#"}
            className="font-display block break-words text-[28px] uppercase leading-[.92] text-cz-1 transition-colors hover:text-cz-accent-t sm:text-[32px]"
          >
            {leader.name}
          </Link>

          <div className="mb-3 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {leader.nationalityCode && (
              <Flag code={leader.nationalityCode} className="flex-shrink-0" />
            )}
            {leader.teamId ? (
              <Link
                to={`/teams/${leader.teamId}`}
                className="min-w-0 truncate text-[13px] text-cz-2 transition-colors hover:text-cz-accent-t"
              >
                {leader.teamName || t("honours.noTeam")}
              </Link>
            ) : (
              <span className="text-[13px] text-cz-3">{t("honours.noTeam")}</span>
            )}
            {leader.isAi && <RiderBadges badges={["ai"]} />}
          </div>

          <MetricValue metric={metric} value={leader[metric]} t={t} />

          {runnersUp.length > 0 && (
            <ol className="mt-4">
              {runnersUp.map((entry) => (
                <li
                  key={entry.riderId}
                  className="flex items-center gap-2.5 border-t border-cz-border py-2"
                >
                  <span className="font-data w-4 flex-shrink-0 text-2xs tabular-nums text-cz-3">
                    {entry.rank}
                  </span>
                  {entry.nationalityCode && (
                    <Flag code={entry.nationalityCode} className="flex-shrink-0" />
                  )}
                  <Link
                    to={entry.riderId ? `/riders/${entry.riderId}` : "#"}
                    className="min-w-0 flex-1 truncate text-[13px] font-medium text-cz-1 transition-colors hover:text-cz-accent-t"
                  >
                    {entry.name}
                  </Link>
                  {entry.isAi && <RiderBadges badges={["ai"]} />}
                  {/* Fast bredde + højrestilling: uden den skubbede AI-badget
                      tallet ud af den lodrette kolonne, og tabulære tal der
                      ikke står under hinanden er ikke tabulære. */}
                  <span className="font-data w-14 flex-shrink-0 text-right text-[13px] tabular-nums text-cz-2">
                    {formatNumber(entry[metric])}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* Tie-break-forklaringen står EFTER listen, hvor nr. 2 med samme tal
              er synlig. Placeret over listen ville den desuden skubbe de to
              kolonners lister ud af flugt med hinanden. */}
          {shared && (
            <p className="mt-2 text-xs text-cz-3">{t(`honours.tieBreak.${metric}`)}</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {{points: Array, wins: Array}|null} props.honours normaliseret payload
 * @param {boolean} props.loading
 * @param {boolean} props.failed  ægte fejl (IKKE "migrationen mangler")
 * @param {() => void} props.onRetry
 * @param {boolean} props.provisional sæsonen kører stadig, så tallene kan flytte sig
 * @param {number|undefined} props.seasonNumber
 */
export default function SeasonHonours({
  honours,
  loading = false,
  failed = false,
  onRetry,
  provisional = false,
  seasonNumber,
}) {
  const { t } = useTranslation("seasonEnd");

  const hasAny = (honours?.points?.length || 0) + (honours?.wins?.length || 0) > 0;

  // Chrome renderer altid; kun body swapper mellem loading/error/empty/indhold
  // (canonical states, PAGE_TEMPLATES.md).
  let body;
  if (loading) {
    body = <SkeletonLines lines={4} />;
  } else if (failed) {
    body = (
      <ErrorState
        title={t("honours.error")}
        action={
          onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          )
        }
      />
    );
  } else if (!hasAny) {
    body = (
      <EmptyState
        icon={<TrophyIcon size={26} aria-hidden="true" />}
        title={t("honours.empty.title")}
        description={t("honours.empty.body")}
      />
    );
  } else {
    body = (
      <>
        <div className="grid gap-5 md:grid-cols-2 md:gap-6">
          <HonourColumn metric="points" entries={honours.points} />
          <HonourColumn
            metric="wins"
            entries={honours.wins}
            className="border-t border-cz-border pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0"
          />
        </div>
        <p className="mt-5 border-t border-cz-border pt-3 text-xs text-cz-3">
          {t("honours.note")}
        </p>
      </>
    );
  }

  return (
    <Section borderClass="border-cz-border border-t-2 border-t-cz-accent">
      <SectionHeader
        title={t("honours.heading")}
        meta={
          provisional
            ? t("honours.metaProvisional")
            : t("honours.metaFinal", { number: seasonNumber ?? "" })
        }
      />
      {body}
    </Section>
  );
}
