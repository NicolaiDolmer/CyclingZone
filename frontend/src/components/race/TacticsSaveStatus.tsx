// #7327 (ejer 31/10, design A): status-boksen efter et delvist gem paa Taktik-fanen.
//
// Een linje pr. del (roller og intentioner, ordrer) med stroke-ikon: flueben =
// bekraeftet gemt, kryds = ikke gemt. Kladden er altid bevaret. Fanens guldknap
// ("Gem resten") gemmer kun det manglende; boksen har ingen egen guldknap.
// Ved en aegte konflikt med en anden fane: [Hent den nye] / [Behold mine].
// Ingen tal, ingen emoji.

import { Button, CheckIcon, XIcon } from "../ui/index.js";
import type { PartState } from "../../lib/tacticsSaveFlow.ts";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

const PART_KEYS = [
  ["roles", "racePage.tactics.saveStatus.roles"],
  ["orders", "racePage.tactics.saveStatus.orders"],
] as const;

export default function TacticsSaveStatus({
  t,
  parts,
  conflict = false,
  reason = null,
  busy = false,
  onLoadNew,
  onKeepMine,
}: {
  t: TFn;
  parts: { roles: PartState; orders: PartState };
  conflict?: boolean;
  reason?: string | null;
  busy?: boolean;
  onLoadNew?: () => void;
  onKeepMine?: () => void;
}) {
  const rows = PART_KEYS.filter(([key]) => parts[key] !== "notNeeded");
  return (
    <div
      role="status"
      data-testid="tactics-save-status"
      className="rounded-cz border border-cz-border bg-cz-subtle px-3 py-2.5 space-y-1.5 max-w-md"
    >
      <p className="text-xs font-semibold text-cz-1">
        {t(conflict ? "racePage.tactics.saveStatus.conflictTitle" : "racePage.tactics.saveStatus.partialTitle")}
      </p>
      <ul className="space-y-1">
        {rows.map(([key, labelKey]) => {
          const saved = parts[key] === "saved";
          return (
            <li key={key} data-testid={`tactics-save-part-${key}`} data-saved={saved} className="flex items-center gap-2 text-xs">
              {saved
                ? <CheckIcon size={14} aria-hidden="true" className="text-cz-success shrink-0" />
                : <XIcon size={14} aria-hidden="true" className="text-cz-danger shrink-0" />}
              <span className="text-cz-1">{t(labelKey)}</span>
              <span className="text-cz-3">{t(saved ? "racePage.tactics.saveStatus.saved" : "racePage.tactics.saveStatus.notSaved")}</span>
            </li>
          );
        })}
      </ul>
      {reason && <p className="text-3xs text-cz-danger">{reason}</p>}
      <p className="text-3xs text-cz-3">
        {t(conflict ? "racePage.tactics.saveStatus.conflictNote" : "racePage.tactics.saveStatus.keptNote")}
      </p>
      {conflict && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button variant="secondary" size="sm" disabled={busy} onClick={onLoadNew}>
            {t("racePage.tactics.saveStatus.loadNew")}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onKeepMine}>
            {t("racePage.tactics.saveStatus.keepMine")}
          </Button>
        </div>
      )}
    </div>
  );
}
