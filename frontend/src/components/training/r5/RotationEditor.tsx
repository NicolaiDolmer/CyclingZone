import { useRef } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import Select from "../../ui/Select.jsx";
import { ChevronDownIcon, ChevronUpIcon, FlagIcon, PlusIcon, XIcon } from "../../ui/icons/index.jsx";
import {
  moveRotationPass, ROTATION_MIN_PASSES, ROTATION_MAX_PASSES, type RotationPass, type RotationPreviewSlot,
} from "./programR5Model.ts";

export type RotationPreviewDay = {
  date: string;
  label: string;
  rotationSlots?: RotationPreviewSlot[];
  raceSlots?: number[];
  restSlots?: number[];
  recoverySlots?: number[];
};

export default function RotationEditor({
  passes, sessionOrder, sessionLabel, effortLevels, startIndex, disabled, mobile, preview, nextIndex, canJump,
  onPasses, onJump,
}: {
  passes: RotationPass[];
  sessionOrder: readonly string[];
  sessionLabel: (key: string) => string;
  effortLevels: boolean;
  startIndex: number | null;
  disabled: boolean;
  mobile: boolean;
  preview: RotationPreviewDay[];
  nextIndex?: number;
  canJump: boolean;
  onPasses: (passes: RotationPass[]) => void;
  onJump: (index: number | null) => void;
}) {
  const { t } = useTranslation("trainingR5", { keyPrefix: "programR5.rotation" });
  const dragIndex = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    const next = moveRotationPass(passes, from, to);
    if (next !== passes) onPasses([...next]);
  };
  const update = (index: number, pass: RotationPass) =>
    onPasses(passes.map((old, position) => position === index ? pass : old));
  const editCount = (count: number) => {
    const next = Array.from({ length: count }, (_, i) => passes[i] ?? { session: sessionOrder[0] ?? "rest" });
    onPasses(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="program-r5-rotation">
      <section className="rounded-cz border border-cz-border bg-cz-card" aria-label={t("passes")}>
        <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <h3 className="text-sm font-semibold text-cz-1">{t("passes")}</h3>
          <div className="flex flex-wrap gap-1">
            {[5, 10, ROTATION_MAX_PASSES].filter((count) => count > passes.length).map((count) => (
              <Button key={count} variant="secondary" size="sm" disabled={disabled} onClick={() => editCount(count)}>
                {t("setCount", { count })}
              </Button>
            ))}
          </div>
        </header>
        <ol>
          {passes.map((pass, index) => (
            <li key={index}
              onDragOver={(event) => { if (!disabled && dragIndex.current != null) event.preventDefault(); }}
              onDrop={(event) => {
                event.preventDefault();
                if (!disabled && dragIndex.current != null) move(dragIndex.current, index);
                dragIndex.current = null;
              }}
              className="flex flex-wrap items-center gap-2 border-t border-cz-border px-3 py-2">
              <span draggable={!disabled && !mobile} onDragStart={(event) => {
                dragIndex.current = index;
                event.dataTransfer.setData("text/plain", String(index));
              }} onDragEnd={() => { dragIndex.current = null; }}
                className="min-w-6 font-data text-xs tabular-nums text-cz-2 md:cursor-grab">
                {index + 1}
              </span>
              <Select value={pass.session} disabled={disabled} aria-label={t("session", { n: index + 1 })}
                className="min-h-11 min-w-28 flex-1"
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => update(index, { ...pass, session: event.target.value })}>
                {Array.from(new Set([...sessionOrder, "rest", "recovery", pass.session])).map((session) => (
                  <option key={session} value={session}>{sessionLabel(session)}</option>
                ))}
              </Select>
              {effortLevels && pass.session !== "rest" && pass.session !== "recovery" && (
                <Select value={pass.effort ?? ""} disabled={disabled} aria-label={t("effort", { n: index + 1 })}
                  className="min-h-11 w-auto" onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    const effort = event.target.value as RotationPass["effort"] | "";
                    update(index, effort ? { session: pass.session, effort } : { session: pass.session });
                  }}>
                  <option value="">{t("defaultEffort")}</option>
                  <option value="easy">{t("easy")}</option>
                  <option value="normal">{t("normal")}</option>
                  <option value="hard">{t("hard")}</option>
                </Select>
              )}
              <span className="ml-auto flex items-center">
                <Button variant="ghost" size="sm" disabled={disabled || index === 0} onClick={() => move(index, index - 1)}
                  aria-label={t("moveUp", { n: index + 1 })}><ChevronUpIcon size={14} aria-hidden="true" /></Button>
                <Button variant="ghost" size="sm" disabled={disabled || index === passes.length - 1} onClick={() => move(index, index + 1)}
                  aria-label={t("moveDown", { n: index + 1 })}><ChevronDownIcon size={14} aria-hidden="true" /></Button>
                <Button variant="ghost" size="sm" disabled={disabled || passes.length <= ROTATION_MIN_PASSES}
                  onClick={() => onPasses(passes.filter((_, i) => i !== index))} aria-label={t("remove", { n: index + 1 })}>
                  <XIcon size={14} aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
        <div className="border-t border-cz-border px-3 py-2">
          <Button variant="secondary" size="md" disabled={disabled || passes.length >= ROTATION_MAX_PASSES}
            onClick={() => editCount(passes.length + 1)}><PlusIcon size={14} aria-hidden="true" />{t("add")}</Button>
        </div>
      </section>
      {canJump && (
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-cz-1">
          {t("jump")}
          <Select value={startIndex ?? ""} className="min-h-11 w-auto" disabled={disabled}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onJump(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">{t("keepPlace")}</option>
            {passes.map((pass, index) => <option key={index} value={index}>{index + 1} · {sessionLabel(pass.session)}</option>)}
          </Select>
        </label>
      )}
      {preview.length > 0 && (
        <section className="flex min-w-0 flex-col gap-2" aria-label={t("preview")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-cz-1">{t("preview")}</h3>
            {nextIndex != null && <span className="font-data text-xs tabular-nums text-cz-2">{t("nextWeek", { n: nextIndex + 1 })}</span>}
          </div>
          <div className="grid gap-1 md:grid-cols-7">
            {preview.map((day) => (
              <div key={day.date} className="min-w-0 rounded-cz border border-cz-border bg-cz-card">
                <h4 className="px-2 py-1 text-xs font-medium text-cz-1">{day.label}</h4>
                <ol className={mobile ? "grid grid-cols-5" : ""}>
                  {Array.from({ length: 5 }, (_, i) => {
                    const slot = day.rotationSlots?.[i];
                    const raced = day.raceSlots?.includes(i);
                    return (
                      <li key={i} className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-1 border-t border-cz-border px-1.5 py-1 text-2xs text-cz-2">
                        {raced ? <FlagIcon size={10} aria-label={t("race")} /> : slot ? (
                          <>
                            <span className="font-data font-semibold tabular-nums" data-testid="program-r5-rotation-index">{slot.index + 1}/{slot.length}</span>
                            {slot.session && <span className="truncate">{sessionLabel(slot.session)}</span>}
                          </>
                        ) : day.restSlots?.includes(i) ? sessionLabel("rest")
                          : day.recoverySlots?.includes(i) ? sessionLabel("recovery") : "–"}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
