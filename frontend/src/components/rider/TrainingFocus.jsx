// TrainingFocus — progression L2 teaser (#1163).
//
// Lader manageren sætte ét sæson-langt TRÆNINGSFOKUS + intensitet på en EGEN
// nøglerytter. Rykker de trænede evner hurtigere mod cap ved sæson-skift (gated
// bag #1137). Assistent-linjen forklarer trade-off'en (hurtigere målrettet vækst
// vs. setback-risiko + langsommere bredde). Vises kun for egne ryttere.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES, TRAINING_SETBACK_PCT,
} from "../../lib/training.js";

export default function TrainingFocus({ rider, training }) {
  const { t } = useTranslation("rider");
  const { slots, planFor, setPlan, clearPlan, savingId } = training;

  const existing = planFor(rider.id);
  const [focus, setFocus] = useState(existing?.focus ?? TRAINING_FOCUS_KEYS[0]);
  const [intensity, setIntensity] = useState(existing?.intensity ?? "normal");

  // null = ubegrænsede pladser (#1305) — bevar sentinel, ?? 0 ville knuse den.
  const remaining = slots?.remaining ?? null;
  const total = slots?.total ?? null;
  const busy = savingId === rider.id;
  // Nyt fokus kræver et ledigt slot (eller ubegrænset); ændring af eksisterende koster intet.
  const canSet = (existing != null || remaining === null || remaining > 0) && !busy;

  const risk = TRAINING_SETBACK_PCT[intensity] ?? 0;
  const assistant = risk > 0
    ? t("training.assistantRisk", { risk })
    : t("training.assistantNoRisk");

  const handleSet = () => { if (canSet) setPlan(rider.id, focus, intensity); };
  const handleClear = () => { if (!busy) clearPlan(rider.id); };

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-cz-1">🚴 {t("training.title")}</h3>
        {/* Slot-tæller skjules når slots.total === null (ubegrænsede pladser) */}
        {total !== null && (
          <span className="text-[11px] font-mono text-cz-3">
            {t("training.slotsLeft", { remaining, total })}
          </span>
        )}
      </div>
      <p className="text-xs text-cz-3 mb-3">{t("training.intro")}</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-cz-3">
          {t("training.focus")}
          <select
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            disabled={busy}
            className="bg-cz-subtle border border-cz-border rounded px-2 py-1 text-sm text-cz-1 disabled:opacity-50"
          >
            {TRAINING_FOCUS_KEYS.map((k) => (
              <option key={k} value={k}>{t(`training.focus_${k}`)}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-[11px] text-cz-3">
          {t("training.intensity")}
          <div className="inline-flex rounded border border-cz-border overflow-hidden">
            {TRAINING_INTENSITIES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setIntensity(k)}
                disabled={busy}
                aria-pressed={intensity === k}
                className={`text-sm px-2.5 py-1 transition-colors disabled:opacity-50 ${
                  intensity === k ? "bg-cz-accent text-white" : "text-cz-2 hover:bg-cz-subtle"
                }`}
              >
                {t(`training.intensity_${k}`)}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSet}
          disabled={!canSet}
          className="text-sm px-3 py-1.5 rounded bg-cz-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {busy ? t("training.saving") : t(existing ? "training.update" : "training.set")}
        </button>

        {existing && (
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded border border-cz-border text-cz-2 hover:bg-cz-subtle disabled:opacity-40 transition-colors"
          >
            {t("training.remove")}
          </button>
        )}
      </div>

      {/* Assistent-forklaring: trade-off'en for det valgte fokus + intensitet. */}
      <p className="text-xs text-cz-2 mt-3">{assistant} {t("training.tradeoff")}</p>
      <p className="text-[11px] text-cz-3 mt-1">{t("training.gatedNote")}</p>
      {remaining <= 0 && !existing && (
        <p className="text-[11px] text-cz-warning mt-1">{t("training.noSlots")}</p>
      )}
    </div>
  );
}
