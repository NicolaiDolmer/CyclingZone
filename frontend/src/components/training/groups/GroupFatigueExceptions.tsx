// GroupFatigueExceptions — traethedsgraensen faar en undtagelse for en HEL gruppe
// (#6000, mockup pin 5). Vises som chips i Fatigue limit-kortets "Exceptions"-
// raekke, foran rytternes egne undtagelser: "Group: Sprint train · 70 · Light".
//
// Stigen: rytterens egen undtagelse → gruppens → holdets. Gemmes med det samme
// (ingen gem-knap, ingen ny gold), samme moenster som rytterens undtagelse.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon } from "../../ui/icons/index.jsx";
import type { TrainingGroup } from "./trainingGroupsModel.ts";
import type { GroupFatigueMode, GroupsResult } from "./useTrainingGroups.ts";

const DEFAULT_THRESHOLD = 70;
const FALLBACKS = ["light", "recovery", "rest"] as const;
const controlClass = "rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-[13px] text-cz-1 disabled:opacity-50";

export default function GroupFatigueExceptions({
  groups,
  busy,
  onSave,
}: {
  groups: TrainingGroup[];
  busy: boolean;
  onSave: (id: string, mode: GroupFatigueMode, own?: { threshold: number; fallback: string }) => Promise<GroupsResult>;
}) {
  const { t } = useTranslation("training");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const withRule = groups.filter((g) => g.fatigue);
  const addable = groups.filter((g) => !g.fatigue);
  const fallbackLabel = (value: string) => t(`fatigueRule.fallback_${value}`);
  const open = withRule.find((g) => g.id === openId) ?? null;

  function chipText(group: TrainingGroup) {
    const rule = group.fatigue!;
    return rule.fallback === "off"
      ? t("groups.fatigueChipOff", { name: group.name })
      : t("groups.fatigueChip", { name: group.name, threshold: rule.threshold, fallback: fallbackLabel(rule.fallback) });
  }

  if (groups.length === 0) return null;

  return (
    <>
      {withRule.map((group) => (
        <button
          key={group.id}
          type="button"
          aria-expanded={openId === group.id}
          onClick={() => { setAdding(false); setOpenId((prev) => (prev === group.id ? null : group.id)); }}
          className={`min-h-11 rounded-cz-pill border px-2.5 text-xs tabular-nums sm:min-h-0 sm:py-0.5 ${
            openId === group.id ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2 hover:bg-cz-subtle"
          }`}
          data-testid="fatigue-rule-group-exception"
        >
          {chipText(group)}
        </button>
      ))}
      {addable.length > 0 && !adding && (
        <button
          type="button"
          onClick={() => { setOpenId(null); setAdding(true); }}
          className="inline-flex min-h-11 items-center gap-1 rounded-cz-pill border border-cz-border px-2.5 text-xs text-cz-2 hover:bg-cz-subtle sm:min-h-0 sm:py-0.5"
          data-testid="fatigue-rule-add-group"
        >
          <PlusIcon size={11} aria-hidden="true" />
          {t("groups.fatigueAdd")}
        </button>
      )}
      {adding && (
        <select
          value=""
          disabled={busy}
          autoFocus
          onChange={async (e) => {
            const id = e.target.value;
            if (!id) return;
            const result = await onSave(id, "own", { threshold: DEFAULT_THRESHOLD, fallback: "light" });
            setAdding(false);
            if (result.ok) setOpenId(id);
          }}
          aria-label={t("groups.fatigueAddLabel")}
          className={`${controlClass} min-h-11 sm:min-h-0`}
          data-testid="fatigue-rule-add-group-select"
        >
          <option value="">{t("groups.fatigueAddLabel")}</option>
          {addable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      {open && (
        <GroupExceptionEditor
          key={`${open.id}-${open.fatigue?.threshold}-${open.fatigue?.fallback}`}
          group={open}
          busy={busy}
          fallbackLabel={fallbackLabel}
          onSave={async (mode, own) => {
            const result = await onSave(open.id, mode, own);
            if (result.ok && mode === "team") setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function GroupExceptionEditor({
  group, busy, fallbackLabel, onSave,
}: {
  group: TrainingGroup;
  busy: boolean;
  fallbackLabel: (value: string) => string;
  onSave: (mode: GroupFatigueMode, own?: { threshold: number; fallback: string }) => void;
}) {
  const { t } = useTranslation("training");
  const rule = group.fatigue!;
  const mode: GroupFatigueMode = rule.fallback === "off" ? "off" : "own";
  const [threshold, setThreshold] = useState(String(rule.threshold ?? DEFAULT_THRESHOLD));
  const fallback = (FALLBACKS as readonly string[]).includes(rule.fallback) ? rule.fallback : "light";
  const thresholdNumber = threshold.trim() === "" ? NaN : Number(threshold);
  const valid = Number.isInteger(thresholdNumber) && thresholdNumber >= 0 && thresholdNumber <= 100;

  function commitThreshold() {
    if (mode !== "own" || !valid || thresholdNumber === rule.threshold) return;
    onSave("own", { threshold: thresholdNumber, fallback });
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-cz bg-cz-subtle px-2.5 py-2" data-testid="fatigue-rule-group-editor">
      <span className="min-w-0 basis-full truncate text-[13px] font-semibold text-cz-1 sm:basis-auto">
        {t("groups.fatigueGroupLabel", { name: group.name })}
      </span>
      <select
        value={mode}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value as GroupFatigueMode;
          onSave(next, next === "own" ? { threshold: valid ? thresholdNumber : DEFAULT_THRESHOLD, fallback } : undefined);
        }}
        aria-label={group.name}
        className={`${controlClass} min-h-11 sm:min-h-0`}
      >
        {(["team", "own", "off"] as const).map((m) => <option key={m} value={m}>{t(`fatigueRule.mode_${m}`)}</option>)}
      </select>
      {mode === "own" && (
        <>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={threshold}
            disabled={busy}
            aria-label={t("fatigueRule.aboveLabel")}
            aria-invalid={!valid}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={commitThreshold}
            onKeyDown={(e) => { if (e.key === "Enter") commitThreshold(); }}
            className={`${controlClass} min-h-11 w-16 font-data tabular-nums sm:min-h-0`}
          />
          <select
            value={fallback}
            disabled={busy}
            aria-label={t("fatigueRule.insteadLabel")}
            onChange={(e) => onSave("own", { threshold: rule.threshold ?? DEFAULT_THRESHOLD, fallback: e.target.value })}
            className={`${controlClass} min-h-11 sm:min-h-0`}
          >
            {FALLBACKS.map((f) => <option key={f} value={f}>{fallbackLabel(f)}</option>)}
          </select>
        </>
      )}
      <span className="basis-full text-2xs text-cz-3">{t("groups.fatigueLadder")}</span>
    </div>
  );
}
