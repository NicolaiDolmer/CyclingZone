// #7535 · "Handlinger" paa planlaegningssiden (ejer 14/11, variant B): én knap i loebslistens hoved
// aabner en menu (pc) eller et ark fra bunden (telefon, TASTE P18) med omfanget og tre handlinger:
// "Lad assistenten udtage", "Fjern udtagelser" og, adskilt og roed, "Afmeld". Alt lander som en
// KLADDE i bjaelken med Fortryd og Gem; intet gemmes foer Gem. Selve reglerne (omfang, taellere,
// kladde, gem) bor i lib/planningWorkbench.ts; her er kun visningen.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Menu,
  MenuItem,
  Portal,
  TeamIcon,
  XIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  statusBadgeClass,
  useDismiss,
  useModalA11y,
} from "./primitives.ts";
import { BULK_SCOPES, type BulkKind, type BulkScope } from "../../lib/planningWorkbench.ts";

/** Telefonens bredde (Tailwinds sm-graense): her er menuen et ark fra bunden. */
function useSheetLayout(): boolean {
  const query = "(max-width: 639px)";
  const read = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [sheet, setSheet] = useState(read);
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(query) : null;
    if (!mq) return undefined;
    const onChange = () => setSheet(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return sheet;
}

export interface BulkPlan {
  /** Antal loeb handlingen aendrer i omfanget (inden for et gems loft). */
  count: number;
  /** Der var flere loeb, end ét gem kan rumme. */
  capped: boolean;
}

export interface BulkMenuProps {
  scope: BulkScope;
  onScope: (scope: BulkScope) => void;
  /** Antal kommende loeb i hvert omfang. */
  scopeCounts: Record<BulkScope, number>;
  /** Navnet paa "naeste loeb", hvis der er et. */
  nextName: string | null;
  plans: Record<BulkKind, BulkPlan>;
  /** Serverens loft pr. gem. */
  max: number;
  /** Et kald koerer (sidens skrive-laas): handlingerne venter. */
  locked: boolean;
  /** Assistenten regner lige nu. */
  assisting: boolean;
  onRun: (kind: BulkKind) => void;
  /** Kun til billeder/proever: menuen staar aaben fra start. */
  defaultOpen?: boolean;
}

const ICONS: Record<BulkKind, (size: number) => ReactNode> = {
  auto: (size) => <TeamIcon size={size} aria-hidden="true" />,
  clear: (size) => <XIcon size={size} aria-hidden="true" />,
  withdraw: (size) => <AlertTriangleIcon size={size} aria-hidden="true" />,
};

export function BulkMenu({ scope, onScope, scopeCounts, nextName, plans, max, locked, assisting, onRun, defaultOpen = false }: BulkMenuProps) {
  const { t } = useTranslation("planning");
  const [open, setOpen] = useState(defaultOpen);
  const sheet = useSheetLayout();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open && !sheet);

  const scopeLabel = (s: BulkScope) => {
    if (s === "next") return nextName ? t("bulk.scope.nextNamed", { race: nextName }) : t("bulk.scope.next");
    if (s === "checked") return scopeCounts.checked > 0 ? t("bulk.scope.checked", { count: scopeCounts.checked }) : t("bulk.scope.pick");
    return t(`bulk.scope.${s}`, { count: scopeCounts[s] });
  };
  const act = (kind: BulkKind) => {
    setOpen(false);
    onRun(kind);
  };
  const capped = (Object.keys(plans) as BulkKind[]).some((k) => plans[k].capped);

  const item = (kind: BulkKind, danger = false) => {
    const n = plans[kind].count;
    return (
      <MenuItem
        danger={danger}
        disabled={n === 0 || locked}
        title={n === 0 ? t("bulk.nothing") : undefined}
        onClick={() => act(kind)}
        className="min-h-11 items-start disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
        data-testid={`planning-bulk-${kind}`}
      >
        <span className="mt-0.5 shrink-0">{ICONS[kind](15)}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t(`bulk.${kind}`)}</span>
          <span className={`block text-2xs leading-snug ${danger ? "text-cz-danger" : "text-cz-3"}`}>{t(`bulk.${kind}Hint`)}</span>
        </span>
        <span className="font-data text-xs tabular-nums">{n}</span>
      </MenuItem>
    );
  };

  const body = (
    <>
      <p className="px-2.5 pb-1 pt-1.5 font-data text-2xs uppercase tracking-wide text-cz-3">{t("bulk.scopeLabel")}</p>
      <div role="group" aria-label={t("bulk.scopeLabel")}>
        {BULK_SCOPES.map((s) => {
          const active = s === scope;
          return (
            <MenuItem
              key={s}
              role="menuitemradio"
              aria-checked={active}
              active={active}
              className="min-h-11 sm:min-h-0"
              onClick={() => {
                onScope(s);
                // "Kryds loeb af i listen" uden flueben: menuen lukker, saa spilleren kan krydse af.
                if (s === "checked" && scopeCounts.checked === 0) setOpen(false);
              }}
              data-testid={`planning-bulk-scope-${s}`}
            >
              <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-cz-pill border ${active ? "border-cz-1 bg-cz-1" : "border-cz-3"}`} />
              <span className="min-w-0 flex-1 truncate tabular-nums">{scopeLabel(s)}</span>
            </MenuItem>
          );
        })}
      </div>
      <div className="my-1.5 border-t border-cz-border" />
      {item("auto")}
      {item("clear")}
      <div className="my-1.5 border-t border-cz-border" />
      {item("withdraw", true)}
      {capped && (
        <p className="px-2.5 pb-1 pt-2 text-2xs leading-snug text-cz-3" data-testid="planning-bulk-capped">
          {t("bulk.capped", { max })}
        </p>
      )}
    </>
  );

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={locked}
        loading={assisting}
        iconRight={<ChevronDownIcon size={13} aria-hidden="true" />}
        data-testid="planning-bulk-menu"
      >
        {t("bulk.menu")}
      </Button>
      {open && !sheet && (
        // Svaever ud over arbejdsfladen til hoejre (listen er kun 296 px bred), som i designet.
        <div className="absolute start-0 top-full z-dropdown mt-2 w-80 max-w-[calc(100vw-2rem)]">
          <Menu aria-label={t("bulk.menu")} className="max-h-[80vh] w-full overflow-y-auto" data-testid="planning-bulk-panel">
            {body}
          </Menu>
        </div>
      )}
      {open && sheet && <BulkSheet title={t("bulk.menu")} onClose={close}>{body}</BulkSheet>}
    </div>
  );
}

/** Telefonen: samme indhold som et ark fra bunden (spillets overlay-standard, som rytterkortets ark). */
function BulkSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useModalA11y(onClose, true);
  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-end justify-center">
        <div className="cz-overlay-backdrop absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-testid="planning-bulk-sheet"
          className="cz-overlay-panel relative w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-cz border-x border-b-0 border-t border-cz-border bg-cz-card px-2 pb-4 pt-3 shadow-overlay outline-hidden"
        >
          <div className="flex items-center justify-between px-2.5 pb-1">
            <p className="text-sm font-semibold text-cz-1">{title}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common:actions.close")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
            >
              <XIcon size={18} aria-hidden="true" />
            </button>
          </div>
          <div role="menu" aria-label={title}>
            {children}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Taelleren i hovedet, naar omfanget er "Kryds loeb af i listen". */
export function CheckedCount({ count, onClear }: { count: number; onClear: () => void }) {
  const { t } = useTranslation("planning");
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-data text-2xs uppercase tracking-wide tabular-nums text-cz-3" data-testid="planning-bulk-checked">
        {t("bulk.checkedCount", { count })}
      </span>
      {count > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t("bulk.untick")}
        </Button>
      )}
    </span>
  );
}

export interface BulkSummary {
  auto: number;
  added: number;
  clear: number;
  withdraw: number;
}

/** Kladde-bjaelken: hvad kladden goer, Fortryd og Gem. Uden kladde viser den kun en besked (fejl eller "intet fundet"). */
export function BulkDraftBar({
  summary,
  hasDraft,
  busy,
  locked,
  message,
  messageTone = "danger",
  onUndo,
  onSave,
}: {
  summary: BulkSummary;
  hasDraft: boolean;
  /** Gemmet koerer. */
  busy: boolean;
  /** Et kald koerer (sidens skrive-laas): baade Gem og Fortryd venter. */
  locked: boolean;
  message?: string | null;
  messageTone?: "danger" | "neutral";
  onUndo: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation("planning");
  if (!hasDraft && !message) return null;
  return (
    <div
      role="region"
      aria-label={t("bulk.draft.label")}
      data-testid="planning-bulk-draft"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-2.5"
    >
      <div className="min-w-0 text-[13px]">
        {hasDraft && (
          <>
            <p className="text-cz-1">
              <span className="font-semibold">{t("bulk.draft.title")}</span>
              <span className="text-cz-2"> {t("bulk.draft.note")}</span>
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-cz-2">
              {summary.auto > 0 && (
                <li className="inline-flex items-center gap-1.5">
                  {ICONS.auto(13)}
                  <span className="tabular-nums">{t("bulk.draft.auto", { count: summary.auto, riders: summary.added })}</span>
                </li>
              )}
              {summary.clear > 0 && (
                <li className="inline-flex items-center gap-1.5">
                  {ICONS.clear(13)}
                  <span className="tabular-nums">{t("bulk.draft.clear", { count: summary.clear })}</span>
                </li>
              )}
              {summary.withdraw > 0 && (
                <li className="inline-flex items-center gap-1.5 text-cz-danger">
                  {ICONS.withdraw(13)}
                  <span className="tabular-nums">{t("bulk.draft.withdraw", { count: summary.withdraw })}</span>
                </li>
              )}
            </ul>
          </>
        )}
        {message && (
          <p className={`${hasDraft ? "mt-0.5 " : ""}text-xs ${messageTone === "danger" ? "text-cz-danger" : "text-cz-2"}`} role={messageTone === "danger" ? "alert" : "status"}>
            {message}
          </p>
        )}
      </div>
      {hasDraft && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onUndo} disabled={busy || locked} data-testid="planning-bulk-undo">
            {t("bulk.draft.undo")}
          </Button>
          <Button variant="secondary" size="sm" onClick={onSave} loading={busy} disabled={locked} data-testid="planning-bulk-save">
            {t("bulk.draft.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Kladde" ved et loeb i listen, i spillets egen status-anatomi (ingen ny pille-stil). */
export function BulkRowMark({ kind }: { kind: BulkKind | null }) {
  const { t } = useTranslation("planning");
  if (!kind) return null;
  return (
    <span className={`${statusBadgeClass(kind === "withdraw" ? "outbid" : "info", { emphasis: true })} shrink-0`} data-testid="planning-bulk-row-mark">
      {t("bulk.draft.mark")}
    </span>
  );
}

/** Det aabne loeb er i kladden: truppen herunder er den gemte, indtil Gem. */
export function BulkOpenRaceNote({ kind }: { kind: BulkKind | null }) {
  const { t } = useTranslation("planning");
  if (!kind) return null;
  return (
    <p className="mb-2 rounded-cz border border-cz-border bg-cz-card px-4 py-2 text-xs text-cz-2" data-testid="planning-bulk-open-note">
      {t(`bulk.draft.open.${kind}`)}
    </p>
  );
}
