// #8297/#8298 · DET FÆLLES TAKTIKPANEL (wireframe v6c's Tactics-fane, loebsside-1280/375).
//
// Rækkefølgen er wireframets: ruten, "Today's plan" (holdets fem planer), og kortet
// "Orders for stage N" med Simple | All orders og "How tactics work" øverst til højre,
// holdets linje ("The team · Chase the break?"), rytternes tabel, forklaringen og bunden
// med gem-status, "Copy to stage N+1" og sidens ENE guldknap.
//
// Panelet ejer ingen data og ingen regler: værten (løbssidens Taktik-fane, RaceTacticsTab)
// giver indholdet og handlingerne, så gem-vejen, valideringen og holdplanernes regler er
// præcis de samme. Teksterne kommer færdige fra værten.
//
// TASTE/PAGE_TEMPLATES: hairline-kort med 5 px radius, ingen skygger, guld kun på den ene
// knap og som guld-tekst på det aktive valg, tabulære tal.
import type { ReactNode } from "react";
import StatusBadgeJs from "../ui/StatusBadge.jsx";
import { LockIcon as LockIconJs } from "../ui/index.js";
import { Button } from "../race/stagePageV2/ui.ts";
import type { TacticsSaveBadge } from "./tacticsPanelModel.ts";
import { PhoneSaveContext, PhoneSaveLine } from "./mobile/PhoneSave.tsx"; // #8386: telefonen
import { PhoneChoiceField, PhoneTeamPlanField, UnsavedStagesBar, type PhoneChoice } from "./mobile/PhoneTeamFields.tsx";

const StatusBadge = StatusBadgeJs as unknown as (props: { state: string; className?: string; children: ReactNode }) => ReactNode;
const LockIcon = LockIconJs as unknown as (props: { size?: number; "aria-hidden"?: boolean | "true" }) => ReactNode;

export interface TacticsPanelFooter {
  /** Låst etape: bunden er kun en linje, ingen knapper. */
  locked: boolean;
  lockedNote: string;
  badge: TacticsSaveBadge;
  badgeLabels: { saved: string; notSaved: string };
  /** Linjen ved mærket ("If you do nothing, they ride exactly this", fejl, delvist gem, konflikt). */
  statusLine: ReactNode;
  /** "Copy to stage N+1", eller null når der ikke er en næste etape. */
  copyLabel: string | null;
  onCopy: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  onSave: () => void;
  busy: boolean;
}

export interface TacticsPanelProps {
  /** Ruten for den åbne etape (profilkortet). */
  route: ReactNode;
  /** "Today's plan": titel, meta til højre og kortene; null når planerne ikke findes for etapen. */
  teamPlan: { title: string; meta: string; body: ReactNode } | null;
  /** "Orders for stage N". */
  title: string;
  /** Simple | All orders og "How tactics work" (øverst til højre). */
  actions?: ReactNode;
  /** Låst etape: hvornår den låste. */
  note?: ReactNode;
  /** Holdets linje ("The team · Chase the break?"), eller null (fx enkeltstart). */
  team: ReactNode | null;
  /** Linjen der erstatter holdets linje på en tidskørsel. */
  teamNote?: ReactNode;
  board: ReactNode;
  /** Forklaringen under tabellen (pris, dagens belastning, sortering og lås). */
  legend?: ReactNode;
  footer: TacticsPanelFooter;
  /**
   * #8386: telefonens udgave B (under PHONE-grænsen): holdets plan og jagten som ét felt hver med
   * et ark, en bjælke for andre etapers ugemte ændringer og Gem fast i bunden. Udelades = som før.
   */
  phone?: { planValue: string; team: PhoneChoice | null; unsavedStages: number[] } | null;
}

// #8386: panelets bredde, hvor rytternes tabel afløses af telefonlisten. Samme grænse som tabellens
// egen (@4xl = 56rem af tabellens bredde) plus kortets polstring (2 x 1,25rem), så panelet og
// listen altid skifter samtidig.
const HIDE_ON_PHONE = "@max-[58.5rem]/tactics:hidden";
const HIDE_ON_DESK = "@min-[58.5rem]/tactics:hidden";

function SaveBadge({ badge, labels }: { badge: TacticsSaveBadge; labels: TacticsPanelFooter["badgeLabels"] }) {
  // Uændret gemt taktik (eller intet sat endnu) får intet mærke: "Ikke gemt" er kun til en ugemt kladde (Codex #8298).
  if (badge === "saving" || badge === "untouched") return null;
  return badge === "saved"
    ? <StatusBadge state="won">{labels.saved}</StatusBadge>
    : <StatusBadge state="closing">{labels.notSaved}</StatusBadge>;
}

export default function TacticsPanel({ route, teamPlan, title, actions = null, note = null, team, teamNote = null, board, legend = null, footer, phone = null }: TacticsPanelProps) {
  return (
    <PhoneSaveContext.Provider value={phone ? footer : null}>
    <div data-tactics-panel="v6c" className="@container/tactics flex min-w-0 flex-col gap-3">
      {phone && phone.unsavedStages.length > 0 && <div className={HIDE_ON_DESK}><UnsavedStagesBar stages={phone.unsavedStages} /></div>}
      {route}

      {teamPlan && phone && <div className={HIDE_ON_DESK}><PhoneTeamPlanField title={teamPlan.title} value={phone.planValue}>{teamPlan.body}</PhoneTeamPlanField></div>}
      {teamPlan && (
        <section data-testid="tactics-today-plan" className={`min-w-0 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5 ${phone ? HIDE_ON_PHONE : ""}`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="m-0 text-[15px] font-semibold text-cz-1">{teamPlan.title}</h2>
            <span className="text-2xs text-cz-3">{teamPlan.meta}</span>
          </div>
          {teamPlan.body}
        </section>
      )}

      <section data-testid="race-tactics-tab" className="min-w-0 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="m-0 text-[15px] font-semibold text-cz-1">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {note && <p className="m-0 mb-2 text-xs text-cz-2">{note}</p>}

        {team && phone?.team && <div className={`mb-3 ${HIDE_ON_DESK}`}><PhoneChoiceField choice={phone.team} /></div>}
        {team && (
          <div data-testid="tactics-team-bar" className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-cz bg-cz-subtle px-2.5 py-2 text-sm ${phone?.team ? HIDE_ON_PHONE : ""}`}>
            {team}
          </div>
        )}
        {teamNote}

        {board}

        {legend && <div className="mt-3 flex flex-col gap-1 text-2xs text-cz-3">{legend}</div>}

        {footer.locked ? (
          <p className="m-0 mt-3 flex items-center gap-1.5 border-t border-cz-border pt-3 text-xs text-cz-3">
            <LockIcon size={12} aria-hidden="true" /> {footer.lockedNote}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3 border-t border-cz-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-cz-2">
              <span className={`contents ${phone ? HIDE_ON_PHONE : ""}`}><SaveBadge badge={footer.badge} labels={footer.badgeLabels} /></span>
              <div className="min-w-0">{footer.statusLine}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {footer.copyLabel && (
                <Button variant="secondary" size="sm" disabled={footer.busy} onClick={footer.onCopy} className="order-2 w-full sm:order-1 sm:w-auto">
                  {footer.copyLabel}
                </Button>
              )}
              <Button variant="primary" size="sm" disabled={footer.saveDisabled} onClick={footer.onSave} className={`order-1 w-full sm:order-2 sm:w-auto ${phone ? HIDE_ON_PHONE : ""}`}>
                {footer.saveLabel}
              </Button>
            </div>
          </div>
        )}
        {/* #8386: Gem fast i bunden på telefonen, over appens menu. */}
        {phone && !footer.locked && (
          <div className={`sticky bottom-(--cz-mobile-nav-offset,0px) z-20 -mx-4 -mb-4 mt-3 rounded-b-cz border-t border-cz-border bg-cz-card px-4 py-2.5 sm:-mx-5 sm:-mb-5 sm:px-5 ${HIDE_ON_DESK}`}>
            <PhoneSaveLine save={footer} />
          </div>
        )}
      </section>
    </div>
    </PhoneSaveContext.Provider>
  );
}
