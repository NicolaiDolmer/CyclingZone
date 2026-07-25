import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Flag } from "./Flag";
import RiderBadges from "./rider/RiderBadges";
import { formatNumber } from "../lib/intl";
import { championOf } from "../lib/seasonHonours";
import {
  Section, SectionHeader, EmptyState, ErrorState, Button, SkeletonLines,
  GlobeIcon, JerseyIcon, TrophyIcon,
} from "./ui";

// #2863 — kåringen af sæsonens bedste ryttere, øverst på /seasons.
//
// Ejerens model (Discord 23/7): flest point = World Champion, flest sejre =
// European Champion. Begge tal kommer fra get_season_honours(), der læser
// rider_rankings_mv, altså samme kolonner som rytter-ranglisten har vist hele
// sæsonen. Ren visning: intet her rører sæsonskiftet.
//
// Formen er en årbogs-opslag, ikke et dashboard-kort: guld-keyline på oversiden
// (samme T3-signatur som rytter-/løbs-hero'en), Bebas-navn som overskrift,
// hairline-delte nummer 2 til 5 nedenunder, og en note der siger hvad "sejre"
// tæller. Ingen skygger, ingen emoji, tabulære tal på al numerik.
//
// Kårings-blokken må ALDRIG kunne vælte resten af siden. Ved sæson-cutover
// rammer ~150 managere /seasons samtidig via season_ended-notifikationen, så
// SeasonEndPage holder honours i sin egen state: RPC'en mangler indtil
// migrationen er applied (da rendres blokken slet ikke), og enhver anden fejl
// bliver til en fejl-tilstand INDE i kortet mens slutstilling og kalender
// stadig virker.

const METRIC_ICON = { points: GlobeIcon, wins: JerseyIcon };

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

// Ét kårings-felt: titel-label, vinderen i Bebas, hold-linje, tallet, og
// nummer 2 til 5 som hairline-delte rækker.
function HonourColumn({ metric, entries, provisional, className = "" }) {
  const { t } = useTranslation("seasonEnd");
  const { champion, runnersUp, shared } = championOf(entries, metric);
  const Icon = METRIC_ICON[metric];

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={15} className="flex-shrink-0 text-cz-accent" aria-hidden="true" />
        <span className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
          {t(provisional ? `honours.leader.${metric}` : `honours.title.${metric}`)}
        </span>
      </div>

      {!champion ? (
        <p className="text-[13px] text-cz-2">{t("honours.noRider")}</p>
      ) : (
        <>
          <Link
            to={champion.riderId ? `/riders/${champion.riderId}` : "#"}
            className="font-display block break-words text-[28px] uppercase leading-[.92] text-cz-1 transition-colors hover:text-cz-accent-t sm:text-[32px]"
          >
            {champion.name}
          </Link>

          <div className="mb-3 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {champion.nationalityCode && (
              <Flag code={champion.nationalityCode} className="flex-shrink-0" />
            )}
            {champion.teamId ? (
              <Link
                to={`/teams/${champion.teamId}`}
                className="min-w-0 truncate text-[13px] text-cz-2 transition-colors hover:text-cz-accent-t"
              >
                {champion.teamName || t("honours.noTeam")}
              </Link>
            ) : (
              <span className="text-[13px] text-cz-3">{t("honours.noTeam")}</span>
            )}
            {champion.isAi && <RiderBadges badges={["ai"]} />}
          </div>

          <MetricValue metric={metric} value={champion[metric]} t={t} />

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
 * @param {boolean} props.provisional sæsonen kører stadig, så ingen er kåret endnu
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
          <HonourColumn metric="points" entries={honours.points} provisional={provisional} />
          <HonourColumn
            metric="wins"
            entries={honours.wins}
            provisional={provisional}
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
