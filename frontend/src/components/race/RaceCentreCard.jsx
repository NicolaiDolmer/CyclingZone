// #3858 (bølge 2 — Race Centre, mockup-kontrakt godkendt 17/8): ét etape-kort
// på sendefladen. Tre tilstande, én gold primary-knap pr. tilstand:
//   LIVE     — rød badge (pulsende) + seneste film-linje + afspilnings-meter +
//              gold "Watch live"
//   UPCOMING — nedtælling + opstillings-status + ghost "Review tactics"
//   FINISHED — top-resultat m. egen rytter fremhævet + gold "Watch the race
//              film" + ghost "Full result"
//
// Ren præsentation: AL afledning (tilstand, afspilnings-km, podie, egen bedste)
// sker i lib/raceCentre.js og gives ind som props — komponenten regner intet ud.
// Design: hairlines, 5px radius (Card), tabular figures, stroke-ikoner, ingen
// glow/gradient/emoji (docs/design/PAGE_TEMPLATES.md).
import { Link } from "react-router";
import {
  Card,
  StatusBadge,
  ProgressMeter,
  PlayIcon,
  ClockIcon,
  FlagIcon,
} from "../ui";
import { buttonClass } from "../ui/buttonStyles.js";
import { formatNumber } from "../../lib/intl.js";

// Tidspunktet for etapens slot, altid renderet i København-tid (spillets faste
// slots) — ikke i browserens zone.
function slotTime(scheduledMs, timeZone) {
  if (!Number.isFinite(scheduledMs)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(scheduledMs));
}

function MetaLine({ children }) {
  return (
    <div className="mt-1 font-data text-3xs uppercase tracking-[.1em] text-cz-3 tabular-nums">
      {children}
    </div>
  );
}

function PodiumRow({ row, t }) {
  return (
    <li
      className={`flex items-baseline gap-3 border-t border-cz-border py-1.5 first:border-t-0 ${
        row.isOwn ? "text-cz-1" : "text-cz-2"
      }`}
    >
      <span className="w-6 shrink-0 font-data text-2xs font-semibold tabular-nums text-cz-3">
        {row.rank}
      </span>
      <span className={`min-w-0 truncate text-[13.5px] ${row.isOwn ? "font-semibold" : "font-medium"}`}>
        {row.rider_name}
      </span>
      {row.isOwn && (
        <span className="ms-auto shrink-0 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-accent-t">
          {t("raceCentre.card.yourRider")}
        </span>
      )}
    </li>
  );
}

export default function RaceCentreCard({
  card,
  t,
  timeZone,
  filmLine = null,
  playbackPercent = 0,
  countdownLabel = null,
  selection = null,
  podium = [],
  ownBest = null,
  hasFilm = false,
}) {
  const { raceId, raceName, state, scheduledMs, stageLabel, divisionLabel } = card;
  const raceHref = `/races/${raceId}${card.stageNumber ? `?stage=${card.stageNumber}` : ""}`;

  return (
    <Card className="flex flex-col p-5" borderClass={state === "live" ? "border-cz-danger/40" : "border-cz-border"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={raceHref}
            className="block truncate font-display text-[22px] uppercase leading-none text-cz-1 hover:text-cz-accent-t"
          >
            {raceName}
          </Link>
          <MetaLine>
            {[stageLabel, divisionLabel, slotTime(scheduledMs, timeZone)].filter(Boolean).join("  ·  ")}
          </MetaLine>
        </div>
        {state === "live" ? (
          <StatusBadge state="raceLive" emphasis pulse className="shrink-0">
            {t("raceCentre.state.live")}
          </StatusBadge>
        ) : state === "upcoming" ? (
          <StatusBadge state="info" className="shrink-0">
            {t("raceCentre.state.upcoming")}
          </StatusBadge>
        ) : (
          <StatusBadge state="won" className="shrink-0">
            {t("raceCentre.state.finished")}
          </StatusBadge>
        )}
      </div>

      <div className="mt-4 min-h-[64px] flex-1">
        {state === "live" && (
          <>
            {filmLine ? (
              <p className="flex items-baseline gap-3 text-[13.5px] leading-snug text-cz-1">
                <span className="w-14 shrink-0 font-data text-2xs tabular-nums text-cz-3">
                  {t("detail.film.km", { value: formatNumber(filmLine.km) })}
                </span>
                <span className="min-w-0">{t(`detail.film.event.${filmLine.key}`, filmLine.params)}</span>
              </p>
            ) : (
              <p className="text-[13.5px] leading-snug text-cz-2">{t("raceCentre.card.liveNoFilm")}</p>
            )}
            <ProgressMeter
              className="mt-4"
              value={playbackPercent}
              max={100}
              ariaLabel={t("raceCentre.card.playbackProgress")}
            />
          </>
        )}

        {state === "upcoming" && (
          <>
            <div className="flex items-baseline gap-2">
              <ClockIcon size={14} aria-hidden="true" className="translate-y-0.5 text-cz-3" />
              <span className="font-data text-[20px] font-[650] leading-none tabular-nums text-cz-1">
                {countdownLabel}
              </span>
            </div>
            {/* Opstillings-linjen findes KUN på egne løb: en manager har ingen
                trup i en anden divisions løb, så "status ukendt" ville være
                støj i presse-striben, ikke information. */}
            {card.isOwn && (
              <div className="mt-3 flex items-baseline gap-2 text-[13px] text-cz-2">
                <FlagIcon size={13} aria-hidden="true" className="translate-y-0.5 text-cz-3" />
                {selection
                  ? t(
                    selection.complete ? "raceCentre.card.lineupReady" : "raceCentre.card.lineupIncomplete",
                    { selected: selection.selected, max: selection.max },
                  )
                  : t("raceCentre.card.lineupUnknown")}
              </div>
            )}
          </>
        )}

        {state === "finished" && (
          <>
            {podium.length ? (
              <ul>
                {podium.map((row) => (
                  <PodiumRow key={`${row.rank}-${row.rider_id}`} row={row} t={t} />
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] leading-snug text-cz-2">{t("raceCentre.card.noResults")}</p>
            )}
            {ownBest && !podium.some((row) => row.isOwn) && (
              <p className="mt-3 border-t border-cz-border pt-2 font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
                {t("raceCentre.card.yourBest", { rank: ownBest.rank, rider: ownBest.rider_name })}
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-cz-border pt-3">
        {/* Gold er forbeholdt managerens EGNE løb: "Watch live" og "Watch the
            race film" er hans dag. Andre divisioners løb er presse-lag og får
            en stille indgang, så guldet ikke inflateres på tværs af striben. */}
        {state === "live" && (card.isOwn ? (
          <Link to={raceHref} className={buttonClass({ variant: "primary", size: "sm" })}>
            <PlayIcon size={14} aria-hidden="true" />
            {t("raceCentre.action.watchLive")}
          </Link>
        ) : (
          <Link to={raceHref} className={buttonClass({ variant: "ghost", size: "sm" })}>
            {t("raceCentre.action.viewRace")}
          </Link>
        ))}
        {state === "upcoming" && (
          <Link to={raceHref} className={buttonClass({ variant: "ghost", size: "sm" })}>
            {t(card.isOwn ? "raceCentre.action.reviewTactics" : "raceCentre.action.viewRace")}
          </Link>
        )}
        {state === "finished" && (
          <>
            <Link to={raceHref} className={buttonClass({ variant: "ghost", size: "sm" })}>
              {t("raceCentre.action.fullResult")}
            </Link>
            {hasFilm && card.isOwn && (
              <Link to={raceHref} className={buttonClass({ variant: "primary", size: "sm" })}>
                <PlayIcon size={14} aria-hidden="true" />
                {t("raceCentre.action.watchFilm")}
              </Link>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
