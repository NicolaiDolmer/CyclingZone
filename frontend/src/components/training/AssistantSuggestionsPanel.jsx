// AssistantSuggestionsPanel — "Get suggestions from the assistant"-panelet på
// træningssiden (#4522, ejer-direktiv 31/8, mockup ejer-godkendt 31/8).
//
// Ren visning: al afledning bor i lib/assistantTrainingSuggestions.js
// (unit-testet), al state (åben/lukket, valgte ryttere, filter, resultat-
// besked) ejes af TrainingPage — samme deling af ansvar som FocusOpenButton.
//
// Princippet fra issuet: "forslag først, accept bagefter" (samme mønster som
// PlannerAssistantCard for peak-forslag, #3086). INTET anvendes før klik på
// Accept — accept-knapperne kalder TrainingPages handlers, som skriver via
// den EKSISTERENDE smart-bulk-endpoint (samme sti som roster-værktøjs-
// linjens "Smart focus"-bulk-valg), ikke en ny skrive-sti.
import { useTranslation } from "react-i18next";
import { Section, Button, Toggle, StarIcon } from "../ui";

export default function AssistantSuggestionsPanel({
  rows,
  visibleRows,
  noPlanCount,
  onlyWithoutPlan,
  onToggleOnlyWithoutPlan,
  selected,
  onToggleSelect,
  onAcceptSelected,
  onAcceptAll,
  onDismiss,
  busy,
  message,
}) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const selectedCount = selected.size;

  return (
    <Section borderClass="border-cz-accent-t" className="mb-6">
      <div className="mb-3 flex items-start gap-3">
        <StarIcon size={16} aria-hidden="true" className="mt-0.5 hidden shrink-0 text-cz-accent-t sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-cz-1">{t("assistantSuggestions.title")}</p>
          <p className="mt-1 text-[13px] text-cz-2">{t("assistantSuggestions.intro")}</p>
        </div>
      </div>

      <div className="mb-3">
        <Toggle
          id="assistant-suggestions-only-no-plan"
          checked={onlyWithoutPlan}
          onChange={(e) => onToggleOnlyWithoutPlan(e.target.checked)}
          label={t("assistantSuggestions.onlyNoPlanToggle", { n: noPlanCount })}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-cz-3">{t("assistantSuggestions.empty")}</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-cz-3">{t("assistantSuggestions.emptyFiltered")}</p>
      ) : (
        <div className="max-h-[360px] overflow-y-auto rounded-cz border border-cz-border">
          <ul>
            {visibleRows.map((row, i) => (
              <li
                key={row.riderId}
                className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t border-cz-border" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.riderId)}
                  onChange={() => onToggleSelect(row.riderId)}
                  aria-label={`${t("assistantSuggestions.selectRow")} — ${row.name}`}
                  className="h-4 w-4 shrink-0 rounded-[3px] accent-cz-accent"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-cz-1">{row.name}</span>
                    {!row.hasPlan && (
                      <span className="inline-block rounded-cz-pill border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-3xs uppercase tracking-[.06em] text-cz-3">
                        {t("assistantSuggestions.noPlanMarker")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-2xs text-cz-3">
                    {t("assistantSuggestions.suggestionLine", {
                      session: t(`dayPanel.session_${row.focus}`),
                      intensity: tRider(`training.intensity_${row.intensity}`),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p className={`mt-3 text-xs ${message.type === "ok" ? "text-cz-success" : "text-cz-warning"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-cz-border pt-3">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy || selectedCount === 0}
          onClick={onAcceptSelected}
        >
          {t("assistantSuggestions.acceptSelected", { n: selectedCount })}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || visibleRows.length === 0}
          onClick={onAcceptAll}
        >
          {t("assistantSuggestions.acceptAll")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
          {t("assistantSuggestions.dismiss")}
        </Button>
        <span className="text-2xs text-cz-3">{t("assistantSuggestions.nothingAppliedYet")}</span>
      </div>
    </Section>
  );
}
