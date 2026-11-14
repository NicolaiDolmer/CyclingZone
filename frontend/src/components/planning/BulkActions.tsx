// #7535 · DESIGN-SPOR (merges ikke): tre varianter af de tre handlinger paa planlaegningssiden,
// tegnet ind i den rigtige side, valgt med ?actions=a|b|c i preview-mocken (ejer 14/11):
//   A  samlet vaerktoejslinje i loebslistens hoved: omfang + tre knapper
//   B  én "Handlinger"-knap i hovedet, der aabner en menu med omfang og de tre handlinger
//   C  afkrydsning foerst: kryds loeb af, og en bjaelke med de tre handlinger dukker op
// Faelles: handlingen lander som en KLADDE i bjaelken med Fortryd og Gem (intet gemmes foer Gem), og
// "Afmeld" staar adskilt fra de to andre, fordi det er den eneste, der kan koste holdet et loeb.
// Ingen serverkald: Gem anvender kladden lokalt i preview-mocken.
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Select, Menu, MenuItem, TeamIcon, XIcon, AlertTriangleIcon, ChevronDownIcon, statusBadgeClass, useDismiss } from "./primitives.ts";
import {
  BULK_SCOPES,
  EMPTY_DRAFT,
  actionTargets,
  addToDraft,
  assistantFill,
  draftSummary,
  entriesWithDraft,
  scopeRaces,
  withdrawnWithDraft,
  type ActionsVariant,
  type BulkDraft,
  type BulkKind,
  type BulkScope,
  type PreviewRider,
} from "./bulkActionsModel.ts";
import type { SeasonEntry, SeasonRace, TrainNowLocks } from "../../lib/planningWorkbench.ts";

export interface BulkController {
  variant: ActionsVariant;
  scope: BulkScope;
  setScope: (scope: BulkScope) => void;
  checked: Set<string>;
  toggleCheck: (id: string) => void;
  checkRaces: (ids: string[]) => void;
  clearChecks: () => void;
  /** Afkrydsningsfelterne staar i listen (C altid, A/B naar omfanget er "Afkrydsede"). */
  checkMode: boolean;
  entries: SeasonEntry[];
  withdrawn: Set<string>;
  draftKind: (raceId: string) => BulkKind | null;
  racesIn: (scope: BulkScope) => SeasonRace[];
  targets: (kind: BulkKind, scope: BulkScope) => SeasonRace[];
  run: (kind: BulkKind, scope: BulkScope) => void;
  undo: () => void;
  save: () => void;
  summary: { auto: number; added: number; clear: number; withdraw: number };
  hasDraft: boolean;
}

export function useBulkActions(opts: {
  variant: ActionsVariant | null;
  entries: SeasonEntry[];
  withdrawn: Set<string>;
  locks: TrainNowLocks;
  allRaces: SeasonRace[];
  listRaces: SeasonRace[];
  riders: PreviewRider[];
  terrain: Map<string, string[]>;
  onCommit: (entries: SeasonEntry[], withdrawIds: string[]) => void;
}): BulkController | null {
  const { variant, entries, withdrawn, locks, allRaces, listRaces, riders, terrain, onCommit } = opts;
  const [scope, setScope] = useState<BulkScope>("next");
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<BulkDraft>(EMPTY_DRAFT);

  const shown = useMemo(() => entriesWithDraft(entries, draft, locks), [entries, draft, locks]);
  const out = useMemo(() => withdrawnWithDraft(withdrawn, draft), [withdrawn, draft]);
  const racesIn = useCallback(
    (s: BulkScope) => scopeRaces(s, { allRaces, listRaces, checked, withdrawn: out }),
    [allRaces, listRaces, checked, out],
  );
  const targets = useCallback(
    (kind: BulkKind, s: BulkScope) => actionTargets(kind, racesIn(s), { entries: shown, withdrawn: out, locks }),
    [racesIn, shown, out, locks],
  );
  const run = useCallback(
    (kind: BulkKind, s: BulkScope) => {
      const hit = targets(kind, s);
      if (!hit.length) return;
      const auto = kind === "auto" ? assistantFill({ races: hit, allRaces, entries: shown, withdrawn: out, riders, terrain }) : undefined;
      setDraft((cur) => addToDraft(cur, kind, hit.map((r) => r.id), auto));
      setChecked(new Set());
    },
    [targets, allRaces, shown, out, riders, terrain],
  );
  const save = useCallback(() => {
    const ids = [...draft.kinds].filter(([, k]) => k === "withdraw").map(([id]) => id);
    onCommit(shown, ids);
    setDraft(EMPTY_DRAFT);
  }, [draft, shown, onCommit]);

  if (!variant) return null;
  return {
    variant,
    scope,
    setScope,
    checked,
    toggleCheck: (id) =>
      setChecked((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    checkRaces: (ids) => setChecked(new Set(ids)),
    clearChecks: () => setChecked(new Set()),
    checkMode: variant === "c" || scope === "checked",
    entries: shown,
    withdrawn: out,
    draftKind: (id) => draft.kinds.get(id) ?? null,
    racesIn,
    targets,
    run,
    undo: () => setDraft(EMPTY_DRAFT),
    save,
    summary: draftSummary(draft, entries),
    hasDraft: draft.kinds.size > 0,
  };
}

// ── Faelles dele ────────────────────────────────────────────────────────────

function Count({ value }: { value: number }) {
  return <span className="font-data tabular-nums text-cz-3">{value}</span>;
}

/** De to "byggende" handlinger. Afmeld tegnes for sig (WithdrawButton), adskilt af en hairline. */
function BuildButtons({ bulk, scope, full = false }: { bulk: BulkController; scope: BulkScope; full?: boolean }) {
  const { t } = useTranslation("planning");
  const auto = bulk.targets("auto", scope).length;
  const clear = bulk.targets("clear", scope).length;
  const width = full ? "w-full justify-between sm:w-auto" : "";
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className={width}
        disabled={auto === 0}
        title={auto === 0 ? t("bulk.nothing") : t("bulk.autoHint")}
        onClick={() => bulk.run("auto", scope)}
        data-testid="planning-bulk-auto"
      >
        <span className="inline-flex items-center gap-1.5">
          <TeamIcon size={14} aria-hidden="true" />
          {t("bulk.auto")}
        </span>
        <Count value={auto} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className={width}
        disabled={clear === 0}
        title={clear === 0 ? t("bulk.nothing") : t("bulk.clearHint")}
        onClick={() => bulk.run("clear", scope)}
        data-testid="planning-bulk-clear"
      >
        <span className="inline-flex items-center gap-1.5">
          <XIcon size={14} aria-hidden="true" />
          {t("bulk.clear")}
        </span>
        <Count value={clear} />
      </Button>
    </>
  );
}

function WithdrawButton({ bulk, scope, className = "" }: { bulk: BulkController; scope: BulkScope; className?: string }) {
  const { t } = useTranslation("planning");
  const n = bulk.targets("withdraw", scope).length;
  return (
    <Button
      variant="danger"
      size="sm"
      className={className}
      disabled={n === 0}
      title={n === 0 ? t("bulk.nothing") : t("bulk.withdrawHint")}
      onClick={() => bulk.run("withdraw", scope)}
      data-testid="planning-bulk-withdraw"
    >
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangleIcon size={14} aria-hidden="true" />
        {t("bulk.withdraw")}
      </span>
      <span className="font-data tabular-nums">{n}</span>
    </Button>
  );
}

function scopeLabel(t: (key: string, opts?: Record<string, unknown>) => string, bulk: BulkController, scope: BulkScope): string {
  const races = bulk.racesIn(scope);
  if (scope === "next") return races[0] ? t("bulk.scope.nextNamed", { race: races[0].name }) : t("bulk.scope.next");
  if (scope === "checked") return t("bulk.scope.checked", { count: races.length });
  return t(`bulk.scope.${scope}`, { count: races.length });
}

// ── A · samlet vaerktoejslinje i loebslistens hoved ─────────────────────────

export function BulkToolbarA({ bulk }: { bulk: BulkController }) {
  const { t } = useTranslation("planning");
  return (
    <div className="space-y-2 border-t border-cz-border px-3.5 py-2.5" data-testid="planning-bulk-toolbar">
      <label className="flex items-center gap-2">
        <span className="shrink-0 font-data text-2xs uppercase tracking-wide text-cz-3">{t("bulk.scopeLabel")}</span>
        <span className="min-w-0 flex-1">
          <Select size="sm" value={bulk.scope} onChange={(e: { target: { value: string } }) => bulk.setScope(e.target.value as BulkScope)} data-testid="planning-bulk-scope">
            {BULK_SCOPES.map((s) => (
              <option key={s} value={s}>
                {scopeLabel(t, bulk, s)}
              </option>
            ))}
          </Select>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <BuildButtons bulk={bulk} scope={bulk.scope} full />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-cz-border pt-2">
        <span className="min-w-0 text-2xs text-cz-3">{t("bulk.withdrawHint")}</span>
        <WithdrawButton bulk={bulk} scope={bulk.scope} className="shrink-0" />
      </div>
    </div>
  );
}

// ── B · én "Handlinger"-knap med menu ───────────────────────────────────────

export function BulkMenuB({ bulk, defaultOpen = false }: { bulk: BulkController; defaultOpen?: boolean }) {
  const { t } = useTranslation("planning");
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open);
  const act = (kind: BulkKind) => {
    bulk.run(kind, bulk.scope);
    setOpen(false);
  };
  const item = (kind: BulkKind, icon: ReactNode, danger = false) => {
    const n = bulk.targets(kind, bulk.scope).length;
    return (
      <MenuItem danger={danger} disabled={n === 0} onClick={() => act(kind)} className="items-start disabled:opacity-40" data-testid={`planning-bulk-menu-${kind}`}>
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t(`bulk.${kind}`)}</span>
          <span className={`block text-2xs ${danger ? "text-cz-danger" : "text-cz-3"}`}>{t(`bulk.${kind}Hint`)}</span>
        </span>
        <span className="font-data text-xs tabular-nums">{n}</span>
      </MenuItem>
    );
  };
  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        iconRight={<ChevronDownIcon size={13} aria-hidden="true" />}
        data-testid="planning-bulk-menu"
      >
        {t("bulk.menu")}
      </Button>
      {open && (
        // Computer: svaevende menu under knappen. Telefon: ark fra bunden (TASTE P18).
        <div className="fixed inset-x-0 bottom-0 z-overlay sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
          <Menu className="max-h-[85vh] w-full overflow-y-auto">
            <p className="px-2.5 pb-1 pt-1.5 font-data text-2xs uppercase tracking-wide text-cz-3">{t("bulk.scopeLabel")}</p>
            <div role="group" aria-label={t("bulk.scopeLabel")}>
              {BULK_SCOPES.map((s) => {
                const active = s === bulk.scope;
                const n = bulk.racesIn(s).length;
                return (
                  <MenuItem
                    key={s}
                    role="menuitemradio"
                    aria-checked={active}
                    active={active}
                    onClick={() => {
                      bulk.setScope(s);
                      // "Afkrydsede" uden flueben: luk menuen, saa spilleren kan krydse af i listen.
                      if (s === "checked" && n === 0) setOpen(false);
                    }}
                    data-testid={`planning-bulk-scope-${s}`}
                  >
                    <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-cz-pill border ${active ? "border-cz-1 bg-cz-1" : "border-cz-3"}`} />
                    <span className="min-w-0 flex-1 truncate">{s === "checked" && n === 0 ? t("bulk.scope.pick") : scopeLabel(t, bulk, s)}</span>
                  </MenuItem>
                );
              })}
            </div>
            <div className="my-1.5 border-t border-cz-border" />
            {item("auto", <TeamIcon size={15} aria-hidden="true" />)}
            {item("clear", <XIcon size={15} aria-hidden="true" />)}
            <div className="my-1.5 border-t border-cz-border" />
            {item("withdraw", <AlertTriangleIcon size={15} aria-hidden="true" />, true)}
          </Menu>
        </div>
      )}
    </div>
  );
}

/** Taelleren i hovedet, naar omfanget er "Afkrydsede" (A og B). */
export function CheckedCount({ bulk }: { bulk: BulkController }) {
  const { t } = useTranslation("planning");
  if (!bulk.checkMode || bulk.variant === "c") return null;
  return <span className="font-data text-2xs uppercase tracking-wide text-cz-3 tabular-nums">{t("bulk.checkedCount", { count: bulk.checked.size })}</span>;
}

// ── C · afkrydsning foerst ──────────────────────────────────────────────────

/** Genvejene i listens hoved: kryds naeste loeb eller hele saesonen af med ét tryk. */
export function BulkShortcutsC({ bulk }: { bulk: BulkController }) {
  const { t } = useTranslation("planning");
  return (
    <div className="flex items-center gap-1" data-testid="planning-bulk-shortcuts">
      <span className="font-data text-2xs uppercase tracking-wide text-cz-3">{t("bulk.tick")}</span>
      <Button variant="ghost" size="sm" onClick={() => bulk.checkRaces(bulk.racesIn("next").map((r) => r.id))}>
        {t("bulk.scope.next")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => bulk.checkRaces(bulk.racesIn("season").map((r) => r.id))}>
        {t("bulk.scope.seasonShort")}
      </Button>
    </div>
  );
}

/** Bjaelken der dukker op, saa snart mindst ét loeb er krydset af. */
export function BulkSelectionBarC({ bulk }: { bulk: BulkController }) {
  const { t } = useTranslation("planning");
  if (bulk.checked.size === 0) return null;
  return (
    <div
      role="region"
      aria-label={t("bulk.selectionLabel")}
      data-testid="planning-bulk-selection"
      className="z-sticky mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-cz border border-cz-1 bg-cz-card px-4 py-2.5 max-md:fixed max-md:inset-x-4 max-md:bottom-[68px] md:sticky md:top-2"
    >
      <p className="flex items-center gap-2 text-[13px] text-cz-1">
        <span className="font-semibold tabular-nums">{t("bulk.checkedCount", { count: bulk.checked.size })}</span>
        <Button variant="ghost" size="sm" onClick={bulk.clearChecks}>
          {t("bulk.untick")}
        </Button>
      </p>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <BuildButtons bulk={bulk} scope="checked" />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-cz-border sm:inline-block" />
        <WithdrawButton bulk={bulk} scope="checked" className="max-sm:ml-auto" />
      </div>
    </div>
  );
}

// ── Faelles: kladde-bjaelken, raekke-maerket og noten over truppen ──────────

export function BulkDraftBar({ bulk }: { bulk: BulkController }) {
  const { t } = useTranslation("planning");
  if (!bulk.hasDraft) return null;
  const s = bulk.summary;
  return (
    <div
      role="region"
      aria-label={t("bulk.draft.label")}
      data-testid="planning-bulk-draft"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-2.5"
    >
      <div className="min-w-0 text-[13px]">
        <p className="text-cz-1">
          <span className="font-semibold">{t("bulk.draft.title")}</span>
          <span className="text-cz-2"> {t("bulk.draft.note")}</span>
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-cz-2">
          {s.auto > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <TeamIcon size={13} aria-hidden="true" />
              <span className="tabular-nums">{t("bulk.draft.auto", { count: s.auto, riders: s.added })}</span>
            </li>
          )}
          {s.clear > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <XIcon size={13} aria-hidden="true" />
              <span className="tabular-nums">{t("bulk.draft.clear", { count: s.clear })}</span>
            </li>
          )}
          {s.withdraw > 0 && (
            <li className="inline-flex items-center gap-1.5 text-cz-danger">
              <AlertTriangleIcon size={13} aria-hidden="true" />
              <span className="tabular-nums">{t("bulk.draft.withdraw", { count: s.withdraw })}</span>
            </li>
          )}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={bulk.undo} data-testid="planning-bulk-undo">
          {t("bulk.draft.undo")}
        </Button>
        <Button variant="secondary" size="sm" onClick={bulk.save} data-testid="planning-bulk-save">
          {t("bulk.draft.save")}
        </Button>
      </div>
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

/** Det aabne loeb er i kladden: truppen herunder viser det gemte, indtil Gem. */
export function BulkOpenRaceNote({ kind }: { kind: BulkKind | null }) {
  const { t } = useTranslation("planning");
  if (!kind) return null;
  return (
    <p className="mb-2 rounded-cz border border-cz-border bg-cz-card px-4 py-2 text-xs text-cz-2" data-testid="planning-bulk-open-note">
      {t(`bulk.draft.open.${kind}`)}
    </p>
  );
}
