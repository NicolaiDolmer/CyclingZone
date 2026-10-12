// #1140 Pakke A · "Your first race"-kortet oeverst paa dashboardet for et nyt
// hold, bag flaget `first_race_card`. Ejer-godkendt mockup 12/10
// (pr-screens/1140-first-days/before-after-1140.png).
//
// Kortet svarer paa det et nyt hold ikke ved: HVILKET loeb, HVORNAAR, hvad
// sker der indtil da, og hvornaar staar resultatet her. Intet er opfundet:
// alle tider kommer fra race_stage_schedule (via DashboardPage), assistent- og
// mail-saetningerne kommer kun med naar serveren siger de er sande
// (backend/lib/firstRaceCardFlag.js).
//
// Den ENESTE guld-knap er "Set your line-up" (samme rute som TeamSelectionCtaCard).
// Er der intet at udtage (trup gemt, loeb i gang, saesonpause), er der ingen
// guld-knap. Selve beregningen bor i lib/firstRaceCardModel.js (unit-testet).
//
// Naar foerste resultat er finaliseret tager det eksisterende "Your first race
// is in the books"-kort (MyLatestResultCard, #3310) over, uaendret.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card } from "./ui";
import { buttonClass } from "./ui/buttonStyles.js";
import { formatCountdown } from "../lib/stageScheduleConfig.js";

interface Moment {
  ms: number;
  dayKey: "today" | "tomorrow" | "date";
  clock: string;
  dayLabel: string;
}

// Modellen er ren JS (lib/firstRaceCardModel.js); typen her er kun det kortet laeser.
interface FirstRaceCardModel {
  kind: "upcoming" | "started" | "pause";
  raceName?: string;
  stages?: number;
  isStageRace?: boolean;
  stageNumber?: number;
  start?: Moment | null;
  resultAt?: Moment | null;
  nextSeasonStart?: Moment | null;
  showNow?: boolean;
  selectionMissing?: boolean;
  showAssistant?: boolean;
  mentionMail?: boolean;
  showCta?: boolean;
  ctaTo?: string;
  race?: { id: string } | null;
}

interface Props {
  model: FirstRaceCardModel;
  nowMs: number;
  division?: number | string | null;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export default function FirstRaceCard({ model, nowMs, division = null }: Props) {
  const { t } = useTranslation(["dashboard", "races"]);

  // "tomorrow at 12:00" / "today at 12:00" / "on Wed 14 Oct at 12:00"
  const when = (m: Moment) => t(`dashboard:firstRace.when.${m.dayKey}`, { time: m.clock, day: m.dayLabel });
  // Venstre kolonne i tidslinjen: "Tomorrow 12:00" / "Tomorrow ~13:00"
  const at = (m: Moment, approx = false) =>
    t(`dashboard:firstRace.at.${m.dayKey}`, { time: `${approx ? "~" : ""}${m.clock}`, day: m.dayLabel });

  const raceName = model.raceName ?? "";
  const stageLine = model.isStageRace
    ? t("dashboard:firstRace.stageRaced", { number: model.stageNumber ?? 1 })
    : t("dashboard:firstRace.oneDayRaced");
  const resultLine = model.mentionMail
    ? t("dashboard:firstRace.resultMail")
    : t("dashboard:firstRace.resultHere");

  let title: string;
  if (model.kind === "pause") title = t("dashboard:firstRace.titlePause");
  else if (model.kind === "started") title = t("dashboard:firstRace.titleStarted", { race: raceName });
  else if (model.start) title = t("dashboard:firstRace.titleUpcoming", { race: raceName, when: when(model.start) });
  else title = t("dashboard:firstRace.titleSoon", { race: raceName });

  const metaParts: string[] = [];
  if (model.kind !== "pause") {
    if (model.kind === "upcoming" && model.start) metaParts.push(capitalize(formatCountdown(model.start.ms, nowMs, t)));
    metaParts.push(model.isStageRace
      ? t("dashboard:firstRace.stages", { count: model.stages ?? 1 })
      : t("dashboard:firstRace.oneDay"));
    if (division != null && division !== "") metaParts.push(t("dashboard:firstRace.division", { division }));
  }

  const rows: { key: string; label: string; text: string }[] = [];
  if (model.kind === "pause") {
    rows.push({
      key: "season",
      label: t("dashboard:firstRace.nextLabel"),
      text: model.nextSeasonStart
        ? t("dashboard:firstRace.pauseSeason", { day: model.nextSeasonStart.dayLabel })
        : t("dashboard:firstRace.pauseUnknown"),
    });
  } else {
    if (model.showNow) {
      let nowText = t("dashboard:firstRace.nowSaved");
      if (model.selectionMissing) {
        nowText = model.showAssistant ? t("dashboard:firstRace.nowAssistant") : t("dashboard:firstRace.nowPick");
      }
      rows.push({ key: "now", label: t("dashboard:firstRace.now"), text: nowText });
    }
    if (model.start) rows.push({ key: "start", label: at(model.start), text: stageLine });
    if (model.resultAt) rows.push({ key: "result", label: at(model.resultAt, true), text: resultLine });
  }

  return (
    <Card className="p-5" data-testid="first-race-card">
      <p className="text-2xs uppercase tracking-[.08em] text-cz-3 font-data">{t("dashboard:firstRace.eyebrow")}</p>
      <h2 className="font-semibold text-cz-1 text-lg mt-1.5">{title}</h2>
      {metaParts.length > 0 && (
        <p className="text-cz-3 text-xs mt-1 tabular-nums" data-testid="first-race-meta">{metaParts.join(" · ")}</p>
      )}

      {rows.length > 0 && (
        <ol className="mt-3 text-sm" data-testid="first-race-timeline">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3 border-t border-cz-border py-2.5">
              <span className="sm:w-36 shrink-0 font-semibold text-cz-1 tabular-nums">{row.label}</span>
              <span className="text-cz-2 min-w-0">{row.text}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {model.showCta && model.ctaTo && (
          <>
            <Link to={model.ctaTo} className={buttonClass({ variant: "primary", size: "sm" })} data-testid="first-race-cta">
              {t("races:discoverCta.action")}
            </Link>
            <span className="text-cz-3 text-xs">{t("dashboard:firstRace.takesAbout")}</span>
          </>
        )}
        {!model.showCta && model.kind === "pause" && (
          <Link to="/planning?tab=calendar" className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("dashboard:firstRace.openCalendar")}
          </Link>
        )}
        {!model.showCta && model.kind === "started" && model.race?.id && (
          <Link to={`/races/${model.race.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("dashboard:firstRace.viewRace")}
          </Link>
        )}
      </div>
    </Card>
  );
}
