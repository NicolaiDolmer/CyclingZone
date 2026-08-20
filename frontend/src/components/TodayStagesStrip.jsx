import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Card, Section, SectionHeader, SectionAction, StatusBadge, ClockIcon, TrophyIcon } from "./ui";
import TerrainGlyph from "./calendar/TerrainGlyph.jsx";
import useTodayStages from "../hooks/useTodayStages.js";
import { formatLocalTime } from "../lib/intl.js";

// #3915 — dashboardets "Today's stages"-strip. SELVSTÆNDIG komponentfil,
// selv-hentende (kun teamId som prop) med vilje — samme mønster som
// HeroAgonyCard.jsx (#3397): DashboardPage.jsx's diff for dette modul er
// derfor 1 import-linje + 1 render-linje.
//
// Renderer INTET (ikke engang et tomt-state-kort) mens data hentes, eller
// hvis holdet ingen løb har i dag — det er mindst støj (ejer-valgt 18/8,
// #3915) frem for en tom placeholder-stribe allerøverst på dashboardet.
const STATE_TO_BADGE = { live: "raceLive", upcoming: "info", finished: "won" };

function TodayStageCard({ card, t }) {
  const {
    raceId, raceName, stageNumber, totalStages, isStageRace, state,
    scheduledMs, bucket, standing, entryCount, winnerName,
  } = card;
  const raceHref = `/races/${raceId}${stageNumber ? `?stage=${stageNumber}` : ""}`;
  const stageLabel = isStageRace
    ? t("races:raceCentre.stageLabel", { number: stageNumber, total: totalStages })
    : t("races:raceCentre.oneDayLabel");

  return (
    <Link to={raceHref} className="block w-[248px] shrink-0">
      <Card
        interactive
        borderClass={state === "live" ? "border-cz-danger/40" : "border-cz-border"}
        className="flex h-full flex-col p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-base uppercase leading-none text-cz-1">{raceName}</p>
            <p className="mt-1 text-2xs uppercase tracking-[.08em] text-cz-3">{stageLabel}</p>
          </div>
          <StatusBadge state={STATE_TO_BADGE[state]} emphasis={state === "live"} pulse={state === "live"} className="shrink-0">
            {t(`races:raceCentre.state.${state}`)}
          </StatusBadge>
        </div>

        <TerrainGlyph bucket={bucket} width={90} height={22} className="mt-3 text-cz-3" />

        {/* Status-linje: starttid (spillerens lokale tid) / LIVE / vindernavn. */}
        <div className="mt-3 flex min-h-[18px] items-center gap-1.5 text-[13px] text-cz-2">
          {state === "upcoming" && (
            <>
              <ClockIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
              <span className="tabular-nums">{formatLocalTime(scheduledMs)}</span>
            </>
          )}
          {state === "live" && (
            <span className="font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-danger">
              {t("races:raceCentre.state.live")}
            </span>
          )}
          {state === "finished" && (
            winnerName ? (
              <>
                <TrophyIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="truncate">{t("dashboard:todayStages.winner", { name: winnerName })}</span>
              </>
            ) : (
              <span className="text-cz-3">{t("races:raceCentre.card.noResults")}</span>
            )
          )}
        </div>

        {/* Sekundær linje: samlet placering (etapeløb) eller antal tilmeldte (endagsløb). */}
        <p className="mt-2 font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
          {isStageRace
            ? (standing
              ? t("dashboard:todayStages.standing", { rank: standing.rank, total: standing.total })
              : t("dashboard:todayStages.standingPending"))
            : t("dashboard:todayStages.entries", { count: entryCount ?? 0 })}
        </p>
      </Card>
    </Link>
  );
}

export default function TodayStagesStrip({ teamId }) {
  const { t } = useTranslation(["dashboard", "races"]);
  const { loading, cards } = useTodayStages(teamId);

  if (loading || !cards.length) return null;

  return (
    <Section className="mb-4">
      <SectionHeader
        title={t("dashboard:todayStages.title")}
        action={<SectionAction as={Link} to="/race-centre">{t("races:raceCentre.navLabel")}</SectionAction>}
      />
      {/* Vandret scroll KUN inde i striben — siden selv scroller aldrig
          vandret (mobile-kontrakt, #3915). */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {cards.map((card) => (
          <TodayStageCard key={`${card.raceId}:${card.stageNumber}`} card={card} t={t} />
        ))}
      </div>
    </Section>
  );
}
