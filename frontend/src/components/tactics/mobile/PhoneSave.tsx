// #8386 · "Gem fast i bunden" på telefonen. Panelets ene guldknap med præcis samme handling og
// tilstand som computerens (footer fra værten); på telefonen står den i en bjælke, der bliver
// i bunden over appens menu, og i rytterens ark, så den aldrig skal lukkes for at gemme.
import { createContext, useContext, type ReactNode } from "react";
import StatusBadgeJs from "../../ui/StatusBadge.jsx";
import { Button } from "../../race/stagePageV2/ui.ts";
import type { TacticsSaveBadge } from "../tacticsPanelModel.ts";

const StatusBadge = StatusBadgeJs as unknown as (props: { state: string; className?: string; children: ReactNode }) => ReactNode;

export interface PhoneSaveState {
  locked: boolean;
  badge: TacticsSaveBadge;
  badgeLabels: { saved: string; notSaved: string };
  saveLabel: string;
  saveDisabled: boolean;
  onSave: () => void;
  /** Panelets forklaring ved fejl, delvist gem og konflikt (med genvejene), så arket ikke skjuler den. */
  statusLine?: ReactNode;
}

/** Panelets gem til rytterens ark (null uden for panelet, fx den klassiske løbsside). */
export const PhoneSaveContext = createContext<PhoneSaveState | null>(null);

export function usePhoneSave(): PhoneSaveState | null {
  return useContext(PhoneSaveContext);
}

/** "NOT SAVED [Save stage 4]" på én linje. Intet på en låst etape. */
export function PhoneSaveLine({ save, withStatus = false }: { save: PhoneSaveState | null; withStatus?: boolean }) {
  if (!save || save.locked) return null;
  const badge = save.badge === "saved"
    ? <StatusBadge state="won">{save.badgeLabels.saved}</StatusBadge>
    : save.badge === "unsaved" || save.badge === "problem"
      ? <StatusBadge state="closing">{save.badgeLabels.notSaved}</StatusBadge>
      : null;
  return (
    <div data-tactics-phone-save className="flex flex-col gap-2">
      {/* Ved fejl, delvist gem eller konflikt står forklaringen og genvejene her, ikke bag arket. */}
      {withStatus && save.badge === "problem" && save.statusLine && <div className="min-w-0 text-xs text-cz-2">{save.statusLine}</div>}
      <div className="flex items-center gap-3">
        {badge && <span className="shrink-0">{badge}</span>}
        <Button variant="primary" size="md" disabled={save.saveDisabled} onClick={save.onSave} className="min-h-11 flex-1">
          {save.saveLabel}
        </Button>
      </div>
    </div>
  );
}
