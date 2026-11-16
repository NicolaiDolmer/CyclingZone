// #8297 · DET FÆLLES TAKTIKPANEL (wireframe v6c's Tactics-fane, skitsen i #8289).
//
// Rækkefølgen er wireframets: ruten, "Dagens plan" (holdets fem planer), og kortet
// "Ordrer for etape N" med holdets linje (jagter vi udbruddet?), rytternes tabel og
// bunden med gem-status, "Kopiér til etape N+1" og sidens ENE guldknap.
//
// Panelet ejer ingen data og ingen regler: værten (i dag løbssidens Taktik-fane,
// RaceTacticsTab) giver det indholdet og handlingerne, så gem-vejen, valideringen og
// holdplanernes regler er præcis de samme som før. Det gør panelet genbrugeligt fra
// planlægningen senere uden en anden kopi af taktikken.
//
// TASTE/PAGE_TEMPLATES: hairline-kort med 5 px radius, ingen skygger, ingen piller,
// guld kun på den ene knap og som guld-tekst på det aktive valg, tabulære tal.
import type { ReactNode } from "react";
import StatusBadgeJs from "../ui/StatusBadge.jsx";
import { LockIcon as LockIconJs } from "../ui/index.js";
import { Button } from "../race/stagePageV2/ui.ts";
import type { TacticsSaveBadge } from "./tacticsPanelModel.ts";

type TFn = (key: string, opts?: Record<string, unknown>) => string;
const StatusBadge = StatusBadgeJs as unknown as (props: { state: string; className?: string; children: ReactNode }) => ReactNode;
const LockIcon = LockIconJs as unknown as (props: { size?: number; "aria-hidden"?: boolean | "true" }) => ReactNode;

export interface TacticsPanelFooter {
  /** Låst etape: bunden er kun en linje, ingen knapper. */
  locked: boolean;
  lockedNote: string;
  badge: TacticsSaveBadge;
  /** Linjen ved mærket (fejl, delvist gem, konflikt, "ikke gemt" osv.), allerede bygget af værten. */
  statusLine: ReactNode;
  /** "Kopiér til etape N+1", eller null når der ikke er en næste etape. */
  copyLabel: string | null;
  onCopy: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  onSave: () => void;
  busy: boolean;
}

export interface TacticsPanelProps {
  t: TFn;
  /** Ruten for den åbne etape (profilkortet). */
  route: ReactNode;
  /** "Dagens plan": holdets planer (og kopi-linjen), eller null når planerne ikke findes for etapen. */
  teamPlan: ReactNode | null;
  /** "Ordrer for etape N" / "Ordrer for løbsdagen". */
  title: string;
  /** Frist for etapen (klokkeslæt), højrestillet i kortets hoved. */
  meta?: string | null;
  /** Hjælpelinjen og evt. regel-linjen under titlen. */
  intro?: ReactNode;
  /** Etapens terræn og "ikke sat"-noten, eller hvornår etapen låste. */
  note?: ReactNode;
  /** Holdets linje (udbruddet, planen, sprint-toget), eller null (fx enkeltstart). */
  team: ReactNode | null;
  /** Linjen der erstatter holdets linje på en tidskørsel. */
  teamNote?: ReactNode;
  /** Rytternes tabel (eller etapeplanen langs ruten). */
  board: ReactNode;
  footer: TacticsPanelFooter;
}

function SaveBadge({ t, badge }: { t: TFn; badge: TacticsSaveBadge }) {
  if (badge === "saving") return null;
  return badge === "saved"
    ? <StatusBadge state="won">{t("tacticsPanel.badge.saved")}</StatusBadge>
    : <StatusBadge state="closing">{t("tacticsPanel.badge.notSaved")}</StatusBadge>;
}

export default function TacticsPanel({ t, route, teamPlan, title, meta = null, intro = null, note = null, team, teamNote = null, board, footer }: TacticsPanelProps) {
  return (
    <div data-tactics-panel="v6c" className="flex min-w-0 flex-col gap-3">
      {route}

      {teamPlan && (
        <section data-testid="tactics-today-plan" className="min-w-0 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
          <h2 className="m-0 mb-3 flex flex-wrap items-baseline justify-between gap-2 text-[15px] font-semibold text-cz-1">
            {t("tacticsPanel.todayPlan")}
            <small className="text-xs font-normal text-cz-3">{t("tacticsPanel.todayPlanNote")}</small>
          </h2>
          {teamPlan}
        </section>
      )}

      <section data-testid="race-tactics-tab" className="min-w-0 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold text-cz-1">{title}</h2>
            {intro}
          </div>
          {meta && <span className="whitespace-nowrap font-data text-2xs tabular-nums text-cz-3">{meta}</span>}
        </div>
        {note && <p className="m-0 mb-2 text-xs text-cz-2">{note}</p>}

        {team && (
          <div data-testid="tactics-team-bar" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-cz bg-cz-subtle px-2.5 py-2 text-sm">
            <b className="font-semibold text-cz-1">{t("tacticsPanel.team")}</b>
            {team}
          </div>
        )}
        {teamNote}

        {board}

        {footer.locked ? (
          <p className="m-0 mt-3 flex items-center gap-1.5 border-t border-cz-border pt-3 text-xs text-cz-3">
            <LockIcon size={12} aria-hidden="true" /> {footer.lockedNote}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3 border-t border-cz-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-cz-3">
              <SaveBadge t={t} badge={footer.badge} />
              <div className="min-w-0">{footer.statusLine}</div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {footer.copyLabel && (
                <Button variant="secondary" size="sm" disabled={footer.busy} onClick={footer.onCopy} className="w-full sm:w-auto">
                  {footer.copyLabel}
                </Button>
              )}
              <Button variant="primary" size="sm" disabled={footer.saveDisabled} onClick={footer.onSave} className="w-full sm:w-auto">
                {footer.saveLabel}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
