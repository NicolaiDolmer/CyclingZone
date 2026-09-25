import { useTranslation } from "react-i18next";
import { Section, SectionHeader, SectionAction, EmptyState, ClipboardIcon, ProgressMeter } from "../../components/ui";
import { endSentence, formatGoalValue, formatShortDate, resolveGoalTitle } from "./boardroomFormat.js";
import { goalProgressPct } from "../../components/board/goalProgress.js";
import { BonusOfferStripe, BonusAcceptedLine } from "./BonusOffer.jsx";
import StatusPill from "./StatusPill.jsx";

// #4557 (overblik + faner) · Mandatet som RESUMÉ paa overblikket: én linje der
// siger konklusionen, maalene i én kompakt raekke, og bonus-striben. Hele
// mandatkortet (ejere, kvitteringer, tilbuddet i fuld laengde) bor i Mandat-
// fanen, som den quiet action herfra fører til.
//
// Fold-disciplin (PAGE_TEMPLATES §Fold-disciplin, ejer-regel 6/9): overblikket
// er tillidskortet + dette kort + to resumé-linjer. Intet tredje stablet kort.

// Hvilket maal er vaerst stillet lige nu? Bruges til resumé-linjens anden
// saetning ("The club ranking is behind at 46 against a target of 40"). Ren
// laesning af `status` — ingen ny beregning, ingen opdigtede tal.
const STATUS_SEVERITY = { behind: 3, failed: 3, at_risk: 2, on_track: 1, achieved: 0 };

export function findWorstGoal(goals = []) {
  let worst = null;
  for (const goal of goals) {
    const severity = STATUS_SEVERITY[goal?.status] ?? 1;
    if (severity < 2) continue;
    if (!worst || severity > (STATUS_SEVERITY[worst.status] ?? 1)) worst = goal;
  }
  return worst;
}

function GoalSummary({ goal, t }) {
  const achieved = Number(goal.achievedDisplay);
  const target = Number(goal.targetDisplay ?? goal.target);
  const hasNumbers = Number.isFinite(achieved) && Number.isFinite(target);
  const pct = goal.status === "achieved" ? 100 : (hasNumbers ? goalProgressPct(achieved, target) : 0);
  const tone = goal.status === "behind" || goal.status === "failed" ? "warning" : "accent";
  const title = resolveGoalTitle(t, goal);

  return (
    // #5472 · Hvert maal er et subgrid over tre raekker (titel, maaler, tal), saa
    // naboerne i samme raekke deler titelhoejde: en titel paa tre linjer skubber
    // alle maalerne i raekken ned, ikke kun sin egen (maalerne stod i hver sin
    // hoejde i et smalt vindue). Det goer den tidligere faste to-linjers
    // min-hoejde overfloedig; den efterlod en tom linje under korte titler.
    <div className="row-span-3 grid min-w-0 grid-rows-subgrid gap-y-0">
      <p className="mb-1.5 text-[12.5px] font-medium leading-snug text-cz-1">
        {title}
        {goal.isBonus && (
          <span className="ms-1.5 rounded-cz-pill border border-cz-border px-[7px] py-px align-middle text-3xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">
            {t("boardroom.mandate.bonus")}
          </span>
        )}
      </p>
      <ProgressMeter value={pct} tone={tone} ariaLabel={title} />
      {/* #5472 · content-start: naar en nabo i raekken har et langt beloeb paa
          to linjer, bliver tal-raekken hoejere; uden den stod "2 / 3" centreret
          midt i den ekstra hoejde i stedet for i flugt med naboens foerste linje. */}
      <div className="mt-1.5 flex flex-wrap content-start items-center justify-between gap-x-2 gap-y-1">
        <span className="font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
          {/* Resuméet baerer den KORTE form ("46 / 40") som mockup'en; den fulde
              "Achieved 46 / target 40" staar paa maal-raekken i Mandat-fanen.
              Den lange form ombrød til tre linjer paa 390px og skubbede
              maalerne ud af flugt (TASTE P5: ens ting staar ens). */}
          {t("boardroom.overview.goalValue", {
            achieved: formatGoalValue(goal.achievedDisplay, goal.type),
            target: formatGoalValue(goal.targetDisplay, goal.type),
          })}
        </span>
        <StatusPill status={goal.status} t={t} />
      </div>
    </div>
  );
}

export default function MandateSummaryCard({ mandate, bonusOffer = null, proposedMeeting = null, onOpenMandate, onReload }) {
  const { t } = useTranslation("board");

  // #5754 · Samme forslag som Mandat-fanens fulde kort (GET /board/meeting,
  // gemt af BoardroomPage som `proposedMeeting`) — resumeet paa overblikket
  // skal ikke laengere sige "No mandate signed yet" naar bestyrelsen reelt
  // HAR et forslag klar, kun ikke underskrevet endnu. Lille aendring med
  // vilje: samme SectionHeader+action-anatomi som det underskrevne resumé
  // herunder, kun ét linje-skift i kroppen — det fulde forslag (maalene, "Enter
  // annual meeting") staar i Mandat-fanen, ét klik herfra.
  if (!mandate && proposedMeeting?.available) {
    return (
      <Section>
        <SectionHeader
          title={t("boardroom.mandate.cardTitleGeneric")}
          action={<SectionAction onClick={onOpenMandate}>{t("boardroom.overview.openMandate")}</SectionAction>}
        />
        <p className="text-[13px] font-medium text-cz-1">{t("boardroom.mandate.proposed.summaryLine")}</p>
      </Section>
    );
  }

  if (!mandate) {
    return (
      <Section>
        <SectionHeader title={t("boardroom.mandate.cardTitleGeneric")} />
        <EmptyState
          icon={<ClipboardIcon size={26} aria-hidden="true" />}
          title={t("boardroom.mandate.empty.title")}
          description={t("boardroom.mandate.empty.description")}
          action={null}
        />
      </Section>
    );
  }

  const goals = mandate.goals || [];
  const achievedCount = goals.filter((g) => g.status === "achieved").length;
  const worst = findWorstGoal(goals);

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.mandate.cardTitle", { season: mandate.seasonNumber })}
        action={
          <SectionAction onClick={onOpenMandate}>{t("boardroom.overview.openMandate")}</SectionAction>
        }
      />
      <p className="mb-3 text-[13px] text-cz-2">
        <span className="font-medium text-cz-1">
          {t("boardroom.overview.goalsAchieved", { achieved: achievedCount, total: goals.length })}
        </span>
        {mandate.signedAt ? ` ${endSentence(t("boardroom.overview.signedOn", { date: formatShortDate(mandate.signedAt) }))}` : ""}
        {worst
          ? ` ${t("boardroom.overview.worstGoalNote", {
            goal: resolveGoalTitle(t, worst),
            achieved: formatGoalValue(worst.achievedDisplay, worst.type),
            target: formatGoalValue(worst.targetDisplay, worst.type),
          })}`
          : ""}
      </p>

      {/* #5472 · Fire kolonner kun fra lg: sm er en viewport-grænse, og med
          sidebaren er kortet under 480 px bredt ved 774-1023 px vinduer. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 lg:grid-cols-4">
        {goals.map((goal) => (
          <GoalSummary key={goal.id} goal={goal} t={t} />
        ))}
      </div>

      <BonusOfferStripe offer={bonusOffer} onResolved={onReload} />
      <BonusAcceptedLine offer={bonusOffer} className="mt-3.5 border-t border-cz-border pt-3" />
    </Section>
  );
}
