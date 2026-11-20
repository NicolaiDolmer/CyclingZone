// #7947 R5 I dag (ejer 20/11): paritetshullerne fra gennemgangen 19/11, bygget ind
// i skitsen med spillets AEGTE komponenter (TrainNowNote, Modal, DailyDecision,
// RiderBadges, XpBar, EmptyState/ErrorState/SkeletonLines, OnboardingTour) og
// spillets egen tekst (training.json/rider.json, en). Alt er eksempeldata.
//
// De fem afvigelser fra 19/11 bygges IKKE endeligt: `?dev=old` viser den gamle
// loesning i R5-rammen, standarden viser R5's forslag. Billederne viser begge.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../../../components/ui/Modal.jsx";
import Button from "../../../components/ui/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import ErrorState from "../../../components/ui/ErrorState.jsx";
import { SkeletonLines } from "../../../components/ui/Skeleton.jsx";
import { CheckIcon, ChevronRightIcon, TeamIcon } from "../../../components/ui/icons/index.jsx";
import RiderBadges from "../../../components/rider/RiderBadges.jsx";
import OnboardingTour from "../../../components/OnboardingTour.jsx";
import TrainNowNote from "../../../components/training/TrainNowNote.tsx";
import DailyDecision, { type DecisionRow } from "../../../components/training/DailyDecision.tsx";
import { TONIGHT_TEXT } from "../../../components/training/TrainingTodayTable.tsx";
import { trainNowInstantConfirm, trainNowWarnings, type TrainNowPressResult, type TrainNowStatus } from "../../../components/training/TrainNowState.ts";
import { XpBar } from "../../../components/training/reportXp/XpBar.tsx";
import { squadBadgeKey } from "../../../lib/squadBadge.ts";
import { injuryBadgeMessage } from "../../../lib/training.js";
import { startTour } from "../../../lib/onboardingTour.js";
import type { Session } from "./model.ts";
import { COUNTS_FOR, RACE, STATUS, TEAM, TRAINS, XP_LINES, type R5Rider } from "./r5data.ts";
import { FatiguePlate } from "./R5Parts.tsx";

export type DevMode = "r5" | "old";
export type TodayState = "loading" | "empty" | "error" | "saving" | "tour" | null;

const HEAD = "font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";

// --- Train now-sikkerheden (#6740 + #4847) -------------------------------------
// Dagens etapeloeb har for faa raske ryttere: Train now spoerger foer det laaser.
export const TRAIN_NOW_BEFORE: TrainNowStatus = {
  enabled: true, available: true, reason: null, tickDate: "2026-11-17", locked: false, lockedAt: null, settled: false,
  todayRaces: [{ id: "rvp", name: RACE }],
  shortRaces: [{ id: "rvp", name: RACE, fit: 3, entered: 3, min: 4, startsShort: true }],
  instant: false,
};
export const TRAIN_NOW_AFTER: TrainNowStatus = { ...TRAIN_NOW_BEFORE, available: false, locked: true, lockedAt: "2026-11-17T14:05:00Z", shortRaces: [] };
export const TRAIN_NOW_RESULT: TrainNowPressResult = {
  settledRiderIds: ["r4", "r5", "r6", "r7", "r8", "r9"], afterRaceRiderIds: ["r1", "r2", "r3"],
};

export function R5TrainNowNote({ pressed }: { pressed: boolean }) {
  return (
    <TrainNowNote status={pressed ? TRAIN_NOW_AFTER : TRAIN_NOW_BEFORE} result={pressed ? TRAIN_NOW_RESULT : null}
      className="max-w-[420px] text-end max-sm:max-w-none max-sm:text-start" />
  );
}

// Samme dialog som TrainingPage (Modal + to knapper, samme noegler og samme advarselslinjer).
export function TrainNowConfirm({ open, onClose, onGo }: { open: boolean; onClose: () => void; onGo: () => void }) {
  const { t } = useTranslation("training");
  const status = TRAIN_NOW_BEFORE;
  const instantOnly = trainNowInstantConfirm(status) && status.shortRaces.length === 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t(instantOnly ? "trainNow.confirm.titleInstant" : status.shortRaces.every((r) => r.startsShort) ? "trainNow.confirm.titleShort" : "trainNow.confirm.title")}
      closeLabel={t("trainNow.confirm.cancel")}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t("trainNow.confirm.cancel")}</Button>
          <Button variant="primary" onClick={onGo}>{t(instantOnly ? "trainNow.confirm.goNow" : "trainNow.confirm.go")}</Button>
        </>
      )}
    >
      <ul className="space-y-1.5">
        {trainNowWarnings(status).map((w) => <li key={`${w.key}:${w.params.race}`}>{t(w.key, w.params)}</li>)}
      </ul>
    </Modal>
  );
}

// --- Status i raekken ---------------------------------------------------------------
// Som TrainingPage.renderRowStatus: det der betyder noget FOR DAGEN (skade med
// loebsdage tilbage, hoej skaderisiko) staar under navnet; U23/JR staar bag navnet.
export function SquadBadge({ id }: { id: string }) {
  return <RiderBadges badges={[squadBadgeKey(STATUS[id]?.squad ?? null)]} className="flex-none" />;
}

export function RowStatus({ id }: { id: string }) {
  const { t } = useTranslation("training");
  const s = STATUS[id];
  if (!s || (!s.injuredRaceDays && !s.highRisk)) return null;
  const msg = s.injuredRaceDays ? injuryBadgeMessage({ count: s.injuredRaceDays, unit: "race_day" }, { compact: true }) : null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid="r5-row-status">
      {msg && (
        <span className="rounded-cz-pill border border-cz-danger/30 bg-cz-danger-bg px-2 py-0.5 text-3xs text-cz-danger">
          {t(msg.key, { days: msg.days })}
        </span>
      )}
      {s.highRisk && !s.injuredRaceDays && (
        <span className="rounded-cz-pill border border-cz-warning/20 bg-cz-warning/10 px-2 py-0.5 text-3xs text-cz-warning">{t("injuryRisk")}</span>
      )}
    </div>
  );
}

// Akademi, kontrakt, pension og skade: i rytterens kort (som kortets fod i dag).
export function CardBadges({ id }: { id: string }) {
  const s = STATUS[id];
  if (!s) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <RiderBadges badges={[
        s.academy && "academy",
        !s.academy && s.retireRisk && "retireRisk",
        !s.academy && s.contractExpiring && "contractExpiring",
        s.injuredRaceDays > 0 && "injured",
      ]} />
    </span>
  );
}

// --- Traethed "nu -> i aften ~xx" og "Days 70+" (gamle I dag, #6025) ----------------
export function FatigueNowTonight({ rider, settled = false }: { rider: R5Rider; settled?: boolean }) {
  const { t } = useTranslation("training");
  const tn = rider.tonight;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" role="img"
      aria-label={t("today.fatigueTonightAria", { now: rider.fatigue, value: tn.value, band: t(`forecast.band_${tn.tone}`) })}>
      <FatiguePlate value={rider.fatigue} />
      <ChevronRightIcon size={11} aria-hidden="true" className="flex-none text-cz-3" />
      <span className={`font-data text-[13px] font-semibold tabular-nums ${TONIGHT_TEXT[tn.tone]}`} aria-hidden="true">
        {settled ? tn.value : `~${tn.value}`}
      </span>
    </span>
  );
}

export function Days70({ id }: { id: string }) {
  const n = STATUS[id]?.days70 ?? 0;
  return <span className={`font-data text-[13px] tabular-nums ${n >= 3 ? "font-semibold text-cz-danger" : n > 0 ? "text-cz-warning" : "text-cz-3"}`}>{n}</span>;
}

// --- Assistenten: dagens beslutning med flere forslag og "Use all" ------------------
export function R5Decision({ onUse, compact = false }: { onUse: (riderId: string) => void; compact?: boolean }) {
  const rows: DecisionRow[] = TEAM
    .filter((r) => r.tonight.tone === "risk" || (r.tonight.tone === "warn" && (STATUS[r.id]?.days70 ?? 0) > 0))
    .map((r) => ({ riderId: r.id, dayType: "recovery", fatigue: r.fatigue, name: r.name }));
  return <DailyDecision rows={rows} compact={compact} onUse={(row) => { onUse(row.riderId); return true; }} />;
}

// --- Rytterkortet: XP-linjer pr. evne, "Counts for", "Trains / fits type" ----------
function XpLines({ id }: { id: string }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const lines = XP_LINES[id] ?? XP_LINES.r4;
  return (
    <div data-testid="r5-xp-lines">
      <div className="flex items-center gap-1.5 border-b border-cz-border pb-1 font-data text-3xs uppercase tracking-[.08em] text-cz-3">
        <span className="min-w-[44px] flex-1 truncate">{t("receipt.colAbility")}</span>
        <span className="w-[28px] flex-none text-right">{t("receipt.colNow")}</span>
        <span className="w-[132px] flex-none">{t("receipt.colProgress")}</span>
        <span className="w-[72px] flex-none text-right">{t("receipt.colLatest", { defaultValue: "Latest" })}</span>
      </div>
      {lines.map((l) => (
        <div key={l.ability} className="flex items-center gap-1.5 py-[3px]">
          <span className="min-w-[44px] flex-1 truncate text-xs text-cz-1">{tRider(`racePreview.derived.${l.ability}`)}</span>
          <span className="w-[28px] flex-none text-right font-data text-2xs tabular-nums text-cz-1">{l.now}</span>
          <span className="flex w-[132px] flex-none items-center gap-1.5">
            <span className="block min-w-[16px] flex-1"><XpBar training={l.xp / l.price} race={0} height={4} label={`${l.xp} of ${l.price} XP toward the next point.`} /></span>
            <span className="flex-none whitespace-nowrap font-data text-2xs tabular-nums text-cz-2">{l.xp} / {l.price} XP</span>
          </span>
          <span className="w-[72px] flex-none whitespace-nowrap text-right font-data text-3xs tabular-nums text-cz-3">{l.latest != null ? `today +${l.latest} XP` : null}</span>
        </div>
      ))}
    </div>
  );
}

function CountsFor({ id, type }: { id: string; type: string }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const rows = COUNTS_FOR[id] ?? COUNTS_FOR.r4;
  return (
    <div>
      <div className={HEAD}>{t("mobile.countsFor", { role: type })}</div>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <li key={row.ability} className="inline-flex items-baseline gap-1.5 rounded-cz-pill border border-cz-border bg-cz-elevated px-2 py-0.5 font-data text-2xs text-cz-2">
            <span>{tRider(`racePreview.derived.${row.ability}`)}</span>
            <b className="font-semibold tabular-nums text-cz-1">{row.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// "Trains Punch, Acceleration · Fits Puncheur": hvad dagens pas traener, og om det passer til typen.
export function TrainsLine({ sessions, rider, compact = false }: { sessions: readonly Session[]; rider: R5Rider; compact?: boolean }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const counts = new Set((COUNTS_FOR[rider.id] ?? []).map((c) => c.ability));
  const trained = [...new Set(sessions.flatMap((s) => TRAINS[s] ?? []))];
  if (!trained.length) return null;
  const fits = trained.some((a) => counts.has(a));
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 ${compact ? "text-3xs" : "text-2xs"} text-cz-2`}>
      <span>Trains {trained.slice(0, 3).map((a) => tRider(`racePreview.derived.${a}`)).join(", ")}</span>
      {fits && <span className="font-medium text-cz-success">· {t("programs.fitsType", { type: rider.type })}</span>}
    </span>
  );
}

export function RiderCardR5({ rider, sessions, mobile }: { rider: R5Rider; sessions: readonly Session[]; mobile: boolean }) {
  const { t } = useTranslation("training");
  const tn = rider.tonight;
  return (
    <div className={`mt-3 grid gap-4 rounded-cz border border-cz-border bg-cz-card p-3 ${mobile ? "" : "grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"}`} data-testid="r5-rider-card">
      <XpLines id={rider.id} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-cz-2">
            {t("forecast.label")}{" "}
            <span className={`font-data font-semibold tabular-nums ${TONIGHT_TEXT[tn.tone]}`}>~{tn.value}</span>
          </span>
          <CardBadges id={rider.id} />
        </div>
        <CountsFor id={rider.id} type={rider.type} />
        <div>
          <div className={HEAD}>Today</div>
          <TrainsLine sessions={sessions} rider={rider} />
          <div className="mt-1 font-data text-2xs tabular-nums text-cz-2">{t("mobile.pace", { n: 3 })}</div>
        </div>
      </div>
    </div>
  );
}

// --- Tilstande: indlaesning, tom, fejl, tour, hjaelpelink --------------------------
export function StateBody({ state }: { state: TodayState }): ReactNode {
  const { t } = useTranslation("training");
  if (state === "loading") return <div className="p-5" data-testid="r5-state-loading"><SkeletonLines lines={12} /></div>;
  if (state === "empty") return <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("noRiders")} />;
  if (state === "error") {
    return <ErrorState title="Could not load your squad's training." description="Check your connection and try again."
      action={<Button variant="secondary" size="sm">Try again</Button>} />;
  }
  return null;
}

// Spillets guidede tour (OnboardingTour) med I dag-trinnene; startes af ?state=tour.
export function R5Tour({ on }: { on: boolean }) {
  const { t } = useTranslation("training");
  useEffect(() => { if (on) startTour("training"); }, [on]);
  if (!on) return null;
  return (
    <OnboardingTour pageKey="training" steps={[
      { target: "[data-tour='training-focus']", title: t("tour.focus.title"), body: t("tour.focus.body") },
      { target: "[data-tour='training-run-today']", title: t("tour.runNow.title"), body: t("tour.runNow.body") },
    ]} />
  );
}

export function HelpLink() {
  const { t } = useTranslation("training");
  return (
    <a href="#help-dailytraining" className="text-2xs text-cz-3 underline decoration-dotted hover:text-cz-accent" data-testid="r5-help-link">
      {t("howTrainingWorksLink")}
    </a>
  );
}

export function SavedMark() {
  const { t } = useTranslation("training");
  return (
    <span role="status" className="inline-flex flex-none items-center gap-1 text-2xs font-semibold text-cz-success">
      <CheckIcon size={12} aria-hidden="true" />
      {t("daySelect.saved")}
    </span>
  );
}
