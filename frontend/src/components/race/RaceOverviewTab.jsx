// RaceOverviewTab — løbssidens Overblik-fane (#4613, variant A godkendt 6/9).
//
// Overblikket er en LANDINGSSIDE, ikke en mur (ejer 6/9): det svarer på tre
// spørgsmål og stopper. Alt andet ligger én fane væk.
//
//   FØR    Hvad kører du ud på? Hvad står stadig åbent?
//   UNDER  Hvor står du? Hvad er sket i dag? Hvad har du tilbage at vælge?
//   EFTER  Hvordan endte det? Hvad afgjorde ugen?
//
// Fanens ENE guld-knap peger altid på den eneste åbne beslutning (FØR/UNDER:
// "Sæt taktik til etape N", der skifter til Taktik-fanen) eller på resultatet
// (EFTER: "Åbn resultater"). Er der intet at beslutte, står der netop det —
// ingen knap der ikke fører nogen steder hen.
//
// FOG OF WAR: ingen procenter, ingen loft-signaler, ingen "du burde"-råd.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import RiderLink from "../RiderLink";
import TeamLink from "../TeamLink";
import StageDetailPanel from "./StageDetailPanel.jsx";
import { Section, SectionHeader, SectionStack, Button, SkeletonLines, LockIcon, CheckIcon } from "../ui/index.js";
import { WRAP, SCROLLER } from "../ui/dataTableStyles.js";
import { formatNumber } from "../../lib/intl.js";
import { useStageTimeline } from "../../hooks/useStageTimeline.js";
import { selectStoryEvents } from "../../lib/stageTimelineStory.js";
import { describeEvent } from "../../lib/stageTimelineFilm.js";
import { beforeFlagChecklist, openStageDecisions, standingsWithMine } from "../../lib/raceOverviewLogic.js";
import { resultEntity } from "../../lib/raceResultEntity.js";

// Tjeklistens markør: udført = flueben, åben = tom ring. Stroke-ikoner, aldrig
// emoji (TASTE P5). Den åbne ring er en ren SVG-cirkel — en tom <span> med en
// border ville arve linjehøjde og sidde skævt i forhold til fluebenet.
function DecisionMark({ done }) {
  if (done) return <CheckIcon size={14} className="text-cz-success shrink-0" aria-hidden="true" />;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="text-cz-accent shrink-0">
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Højre side af en tjeklinje: hvad er status for netop dette punkt. Ét
// eksplicit opslag pr. punkt — aldrig en sammensat i18n-nøgle, så en manglende
// oversættelse fanges af check:i18n i stedet for at ende som en rå nøgle i UI.
function checklistValue(t, item, isStageRace) {
  if (item.key === "teamPicked") {
    return item.done
      ? t("racePage.overview.checkValue.picked", { count: item.params.count })
      : t("racePage.overview.nothingSet");
  }
  if (item.key === "rolesSet") {
    return item.done
      ? t("racePage.overview.checkValue.rolesDone")
      : t("racePage.overview.nothingSet");
  }
  if (item.key === "laterStages") {
    return t("racePage.overview.checkValue.laterStages");
  }
  if (!isStageRace && item.key === "firstStage") {
    return t(item.done ? "racePage.overview.somethingSet" : "racePage.overview.nothingSet");
  }
  return t(item.done ? "racePage.overview.somethingSet" : "racePage.overview.nothingSet");
}

function DecisionRow({ mark, label, value, highlight = false }) {
  return (
    <li className={`flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-cz-border last:border-b-0 ${highlight ? "bg-cz-accent/5" : ""}`}>
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="translate-y-[2px]">{mark}</span>
        <span className="text-cz-1 text-sm">{label}</span>
      </span>
      <span className="text-cz-3 text-xs whitespace-nowrap">{value}</span>
    </li>
  );
}

// Kompakt klassement-uddrag: top N + dine egne ryttere, aldrig hele feltet.
// Den fulde tabel bor på Resultater-fanen.
function StandingsExtract({ t, rows, myTeamId }) {
  if (!rows.length) return null;
  return (
    <div className={WRAP}>
      <div className={SCROLLER}>
        <table data-sort-exempt="Klassement, sorteret paa placering (rank)" className="w-full text-sm">
          <thead>
            <tr className="text-3xs uppercase tracking-wide text-cz-3 border-b border-cz-border">
              <th className="px-4 py-2 text-left font-medium w-10" scope="col">#</th>
              <th className="px-2 py-2 text-left font-medium" scope="col">{t("intention.colRider")}</th>
              <th className="px-2 py-2 text-left font-medium" scope="col">{t("detail.classification.team")}</th>
              <th className="px-4 py-2 text-right font-medium" scope="col">{t("racePage.overview.gap")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cz-border">
            {rows.map((r) => {
              const entity = resultEntity(r);
              const isMine = myTeamId != null && String(r.team_id ?? r.rider?.team?.id) === String(myTeamId);
              return (
                <tr key={r.id ?? `${r.rank}-${r.rider_id}`} className={isMine ? "bg-cz-accent/5 cz-me" : "hover:bg-cz-subtle transition-colors"}>
                  <td className="px-4 py-2 font-data text-xs tabular-nums text-cz-3">{r.rank ?? "—"}</td>
                  <td className="px-2 py-2">
                    <RiderLink id={entity.linkId} className="text-cz-1 hover:text-cz-accent-t transition-colors">
                      {entity.name || "—"}
                    </RiderLink>
                  </td>
                  <td className="px-2 py-2 text-cz-3 text-xs">
                    <TeamLink id={r.rider?.team?.id ?? r.team_id} className="hover:text-cz-accent-t transition-colors">
                      {r.rider?.team?.name || r.team_name || "—"}
                    </TeamLink>
                  </td>
                  <td className="px-4 py-2 text-right font-data text-xs tabular-nums text-cz-2 whitespace-nowrap">
                    {r.finish_time || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "Seneste fra vejen": etapens egen tidslinje. Findes den ikke (ældre løb,
// S3-forward-only), rendres INTET — aldrig en opdigtet fortælling.
function LatestFromTheRoad({ t, raceId, stageNumber, riderNameById, teamNameById }) {
  const { timeline } = useStageTimeline(raceId, stageNumber);
  const story = timeline?.events?.length ? selectStoryEvents(timeline.events) : [];
  if (!story.length) return null;
  return (
    <Section>
      <SectionHeader title={t("racePage.overview.latest")} meta={t("detail.tabStage", { number: stageNumber })} />
      <ul>
        {story.map((event, i) => {
          const described = describeEvent(event, { riderNameById, teamNameById });
          if (!described) return null;
          return (
            <li key={`${event.km}-${i}`} className="flex items-baseline gap-3 py-1.5 border-t border-cz-border first:border-t-0">
              <span className="font-data text-2xs text-cz-3 tabular-nums shrink-0 w-14">
                {t("detail.film.km", { value: formatNumber(event.km) })}
              </span>
              <span className="text-cz-1 text-sm leading-snug">
                {t(`detail.film.event.${described.key}`, described.params)}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function RaceOverviewTab({
  raceId,
  phase,
  isStageRace,
  stages = 1,
  stagesCompleted = 0,
  profileByStage = {},
  standingsRows = [],
  myTeamId = null,
  riderNameById,
  teamNameById,
  stageRoles,           // svaret fra useStageRoles: null | false | objekt
  onOpenTab,            // (tabKey) => void
  recapSlot = null,     // "Din uge" (EFTER) — bygget af siden af de eksisterende momenter
}) {
  const { t } = useTranslation("races");

  // `stageRoles` er null (henter) / false (fejlede) / svaret. useMemo holder
  // referencerne stabile — ellers ville hver render give nye tomme arrays og
  // gen-regne tjeklisten (react-hooks/exhaustive-deps).
  const riders = useMemo(() => (stageRoles ? stageRoles.riders ?? [] : []), [stageRoles]);
  const overrides = useMemo(() => (stageRoles ? stageRoles.overrides ?? [] : []), [stageRoles]);
  const rolesLoading = stageRoles === null;
  const rolesFailed = stageRoles === false;

  const checklist = useMemo(
    () => beforeFlagChecklist({ riders, overrides, stageCount: stages }),
    [riders, overrides, stages],
  );
  const decisions = useMemo(
    () => openStageDecisions({ overrides, stageCount: stages, stagesCompleted }),
    [overrides, stages, stagesCompleted],
  );
  const extract = useMemo(
    () => standingsWithMine({ rows: standingsRows, myTeamId }),
    [standingsRows, myTeamId],
  );

  // "Top 6 of {count}" må kun stå når listen FAKTISK er klippet. Et løb med to
  // ryttere i klassementet viste ellers "Top 6 of 2", som hverken er sandt
  // eller læseligt.
  const truncated = extract.length > 0 && standingsRows.length > extract.length;

  const nextStage = decisions[0]?.stageNumber ?? null;
  const todayStage = Math.min(stages, (Number(stagesCompleted) || 0) + 1);
  const lastRidden = Number(stagesCompleted) || 0;

  // ── Den ene åbne beslutning ────────────────────────────────────────────────
  const decisionCard = (
    <Section>
      <SectionHeader
        title={t(phase === "before" ? "racePage.overview.beforeFlag" : "racePage.overview.nextDecision")}
      />
      <p className="text-cz-3 text-xs mb-3">
        {t(phase === "before" ? "racePage.overview.beforeFlagHelp" : "racePage.overview.nextDecisionHelp")}
      </p>
      {rolesLoading && <SkeletonLines lines={4} />}
      {rolesFailed && <p className="text-xs text-cz-3">{t("racePage.team.loadError")}</p>}
      {!rolesLoading && !rolesFailed && (
        <>
          <ul className="border border-cz-border rounded-cz overflow-hidden -mx-0">
            {phase === "before"
              ? checklist.map((item) => (
                <DecisionRow
                  key={item.key}
                  mark={<DecisionMark done={item.done} />}
                  highlight={!item.done && item.key === "firstStage"}
                  label={t(`racePage.overview.check.${item.key}`, item.params)}
                  value={checklistValue(t, item, isStageRace)}
                />
              ))
              : decisions.map((d, i) => (
                <DecisionRow
                  key={d.stageNumber}
                  mark={<DecisionMark done={d.hasIntention} />}
                  highlight={i === 0 && !d.hasIntention}
                  label={isStageRace
                    ? t("racePage.overview.stageTactics", { number: d.stageNumber })
                    : t("racePage.overview.raceDayTactics")}
                  value={t(d.hasIntention ? "racePage.overview.somethingSet" : "racePage.overview.nothingSet")}
                />
              ))}
          </ul>
          {decisions.length === 0 && phase !== "before" && (
            <p className="text-cz-3 text-sm flex items-center gap-1.5">
              <LockIcon size={12} aria-hidden="true" />
              {t("racePage.overview.nothingLeft")}
            </p>
          )}
          {nextStage != null && (
            <div className="mt-3 pt-3 border-t border-cz-border flex flex-wrap items-center justify-between gap-3">
              <p className="text-cz-3 text-xs">{t("racePage.overview.nothingSetNote")}</p>
              <Button variant="primary" size="sm" onClick={() => onOpenTab?.("tactics")}>
                {isStageRace
                  ? t("racePage.overview.setStageTactics", { number: nextStage })
                  : t("racePage.overview.setRaceDayTactics")}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );

  // ── FØR løbet ─────────────────────────────────────────────────────────────
  if (phase === "before") {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[14px] items-start">
        <SectionStack>
          <StageDetailPanel
            profile={profileByStage[1]}
            stageLabel={isStageRace ? t("detail.tabStage", { number: 1 }) : undefined}
            tier="full"
            hasClassifications={isStageRace}
          />
        </SectionStack>
        <SectionStack>{decisionCard}</SectionStack>
      </div>
    );
  }

  // ── EFTER løbet ───────────────────────────────────────────────────────────
  if (phase === "after") {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[14px] items-start">
        <SectionStack>
          <Section>
            <SectionHeader
              title={t("racePage.overview.howItEnded")}
              meta={truncated ? t("racePage.overview.topOf", { count: standingsRows.length }) : null}
            />
            <p className="text-cz-3 text-xs mb-3">{t("racePage.overview.howItEndedHelp")}</p>
            <StandingsExtract t={t} rows={extract} myTeamId={myTeamId} />
            <div className="mt-3 pt-3 border-t border-cz-border flex flex-wrap items-center justify-between gap-3">
              <p className="text-cz-3 text-xs">{t("racePage.overview.otherClassifications")}</p>
              <Button variant="primary" size="sm" onClick={() => onOpenTab?.("results")}>
                {t("racePage.overview.openResults")}
              </Button>
            </div>
          </Section>
        </SectionStack>
        <SectionStack>
          {recapSlot}
          <Section>
            <p className="text-cz-3 text-xs flex items-center gap-1.5">
              <LockIcon size={12} aria-hidden="true" />
              {t("racePage.overview.raceIsDone")}
            </p>
          </Section>
        </SectionStack>
      </div>
    );
  }

  // ── UNDER løbet ───────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[14px] items-start">
      <SectionStack>
        <Section>
          <SectionHeader
            title={t("racePage.overview.whereYouStand")}
            meta={truncated ? t("racePage.overview.topOf", { count: standingsRows.length }) : null}
          />
          <p className="text-cz-3 text-xs mb-3">
            {isStageRace
              ? t("racePage.overview.whereYouStandHelp", { done: lastRidden, running: todayStage })
              : t("racePage.overview.whereYouStandHelpOneDay")}
          </p>
          {extract.length
            ? <StandingsExtract t={t} rows={extract} myTeamId={myTeamId} />
            : <p className="text-cz-3 text-sm">{t("racePage.overview.noStandingsYet")}</p>}
        </Section>
        {lastRidden > 0 && (
          <LatestFromTheRoad
            t={t}
            raceId={raceId}
            stageNumber={lastRidden}
            riderNameById={riderNameById}
            teamNameById={teamNameById}
          />
        )}
      </SectionStack>
      <SectionStack>
        {isStageRace && profileByStage[todayStage] && (
          <StageDetailPanel
            profile={profileByStage[todayStage]}
            stageLabel={t("racePage.overview.today", { number: todayStage })}
            tier="compact"
            hasClassifications
          />
        )}
        {decisionCard}
      </SectionStack>
    </div>
  );
}
