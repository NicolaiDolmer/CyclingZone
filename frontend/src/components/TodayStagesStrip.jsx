import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Card, Section, SectionHeader, SectionAction, StatusBadge, ClockIcon, TrophyIcon, SkeletonLines } from "./ui/index.js";
import TerrainGlyph from "./calendar/TerrainGlyph.jsx";
import StageProfileGraph from "./race/StageProfileGraph.jsx";
import { hasRouteData } from "../lib/stageRouteProfile.js";
import useTodayStages from "../hooks/useTodayStages.js";
import { formatLocalTime } from "../lib/intl.js";

// #3915 — dashboardets "Today's stages"-strip. SELVSTÆNDIG komponentfil,
// selv-hentende (kun teamId som prop) med vilje — samme mønster som
// HeroAgonyCard.jsx (#3397): DashboardPage.jsx's diff for dette modul er
// derfor 1 import-linje + 1 render-linje.
//
// Renderer STADIG intet når holdet ender uden løb i dag (ejer-valgt 18/8,
// #3915: mindst støj frem for en tom placeholder-stribe). #5389 (ejer 18/9):
// den TRANSIENTE hentnings-fase gjorde dette anderledes end 18/8-beslutningen
// forudså — komponenten gik fra "intet" til "en hel stribe med kort" EFTER
// resten af dashboardet allerede stod stille, så siden hoppede ned under
// striben hver gang. Mens `loading` er sat, reserveres nu PRÆCIS samme
// kort-højde som et rigtigt kort (samme bredde/padding), så byttet fra
// skelet til rigtige kort ikke flytter noget — kun "ingen løb i dag"-dagen
// kollapser stadig fra skelet til intet (uændret, lille, tidlig i loadet,
// IKKE koblet til dashboardets egen `loading`-gate, jf. docs/DASHBOARD_RULES.md
// §3: "et modul må aldrig kunne vælte dashboardet" — fejler/hænger dette
// kalds egen fetch, skal resten af siden stadig stå, ikke vente på den).
const STATE_TO_BADGE = { live: "raceLive", upcoming: "info", finished: "won" };

// #5389 (CodeRabbit-fund): `h-full` er en no-op her — den ydre `<div
// w-[248px]>`/`<Link>`-wrapper har ingen defineret højde for `h-full` at
// arve fra, så den garanterer INTET fælles mål mellem skelettet og et
// rigtigt kort. En delt, EKSPLICIT pixel-højde er den eneste måde de to kan
// garanteres identiske — målt på det rigtige korts faktiske indhold (titel +
// undertitel, 22px rute-graf, statuslinje, sekundær linje, alt p-4).
const TODAY_STAGE_CARD_HEIGHT = 172;

// Matcher TodayStageCard's egen ramme (w-[248px] shrink-0, Card p-4, samme
// TODAY_STAGE_CARD_HEIGHT) så bytte fra skelet til rigtigt kort ikke ændrer
// højden (#5389).
function TodayStageSkeletonCard() {
  return (
    <div className="w-[248px] shrink-0">
      <Card className="flex flex-col p-4" style={{ height: TODAY_STAGE_CARD_HEIGHT }} borderClass="border-cz-border">
        <SkeletonLines lines={4} />
      </Card>
    </div>
  );
}

function TodayStageCard({ card, t }) {
  const {
    raceId, raceName, stageNumber, totalStages, isStageRace, state,
    scheduledMs, bucket, standing, entryCount, winnerName, profile,
  } = card;
  // #3958 (ejer-mistanke bekræftet 23/8, #4107/#4108): SAMME komponent som
  // resten af appen — den ægte rute (climbs/elevation_gain_m), ikke et
  // generisk 6-vejrs kategori-piktogram. "Misvisende > manglende" (#3958):
  // uden rutedata falder den tilbage til TerrainGlyph, som er ærligt en
  // kategori-glyf og aldrig har påstået at være målt elevation.
  const hasRoute = hasRouteData(profile);
  const raceHref = `/races/${raceId}${stageNumber ? `?stage=${stageNumber}` : ""}`;
  const stageLabel = isStageRace
    ? t("races:raceCentre.stageLabel", { number: stageNumber, total: totalStages })
    : t("races:raceCentre.oneDayLabel");

  return (
    <Link to={raceHref} className="block w-[248px] shrink-0">
      <Card
        interactive
        borderClass={state === "live" ? "border-cz-danger/40" : "border-cz-border"}
        className="flex flex-col p-4"
        style={{ height: TODAY_STAGE_CARD_HEIGHT }}
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

        <div className="mt-3 text-cz-3" style={{ width: 90, height: 22 }}>
          {hasRoute
            ? <StageProfileGraph profile={profile} tier="mini" width={90} height={22} uid={`tds-${raceId}-${stageNumber}`} />
            : <TerrainGlyph bucket={bucket} width={90} height={22} />}
        </div>

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

  // #5389: en ægte "ingen løb i dag" (hentet OG bekræftet tom) renderer
  // stadig intet — #3915's mindst-støj-beslutning står uændret. Kun den
  // TRANSIENTE `loading`-fase får nu et skelet, og kun for at reservere
  // PRÆCIS den plads en rigtig stribe ville tage (samme Section-header +
  // samme kort-ramme), så resten af dashboardet ikke flytter sig når
  // stribens EGEN, uafhængige fetch bliver færdig efter resten af siden.
  if (!loading && !cards.length) return null;

  return (
    <Section className="mb-4">
      <SectionHeader
        title={t("dashboard:todayStages.title")}
        action={<SectionAction as={Link} to="/race-centre">{t("races:raceCentre.navLabel")}</SectionAction>}
      />
      {/* Vandret scroll KUN inde i striben — siden selv scroller aldrig
          vandret (mobile-kontrakt, #3915). */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {loading
          ? <TodayStageSkeletonCard />
          : cards.map((card) => (
            <TodayStageCard key={`${card.raceId}:${card.stageNumber}`} card={card} t={t} />
          ))}
      </div>
    </Section>
  );
}
