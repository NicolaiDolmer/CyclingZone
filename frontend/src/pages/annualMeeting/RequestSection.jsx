import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../components/ui";
import { resolveBoardCopy } from "../../lib/boardCopy";

// #4557 (S-M2c) · "Your request" (spec §4.3, mockup). Default = ingen valgt.
// Ét valgt → opsummeringsraekke + "Change request". Ingen valgt → liste over
// de 4 typer, disabled-typer graat med forklaring (aldrig et doedt klik).
export default function RequestSection({ options, selectedType, onSelect, onClear }) {
  const { t } = useTranslation("board");
  if (!options || options.length === 0) return null;

  const selected = selectedType ? options.find((o) => o.type === selectedType) : null;

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.meeting.request.title")}
        meta={t("boardroom.meeting.request.meta")}
      />
      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-cz border border-cz-border bg-cz-card p-[13px_14px]">
          <div>
            <p className="text-[13.5px] font-medium text-cz-1">{resolveBoardCopy(t, selected.label_key, selected.label)}</p>
            <p className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">
              {resolveBoardCopy(t, selected.tradeoff_preview_key, selected.tradeoff_preview)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="flex-shrink-0 rounded-cz border border-cz-border bg-cz-card px-3 py-1.5 text-xs font-medium text-cz-2 transition-colors duration-150 hover:border-cz-3"
          >
            {t("boardroom.meeting.request.changeRequest")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {options.map((option) => {
            const disabled = Boolean(option.disabled);
            return (
              <div
                key={option.type}
                className={`flex items-center justify-between gap-3 rounded-cz border border-cz-border p-[13px_14px] ${disabled ? "bg-cz-subtle" : "bg-cz-card"}`}
              >
                <div className="min-w-0">
                  <p className={`text-[13.5px] font-medium ${disabled ? "text-cz-3" : "text-cz-1"}`}>
                    {resolveBoardCopy(t, option.label_key, option.label)}
                  </p>
                  <p className="mt-0.5 text-xs text-cz-2">{resolveBoardCopy(t, option.description_key, option.description)}</p>
                  {disabled && option.disabled_reason && (
                    <p className="mt-1 text-3xs uppercase tracking-[.06em] text-cz-3">
                      {resolveBoardCopy(t, option.disabled_reason_key, option.disabled_reason, option.disabled_reason_params || {})}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(option.type)}
                  className="flex-shrink-0 rounded-cz border border-cz-border bg-cz-card px-3 py-1.5 text-xs font-medium text-cz-2 transition-colors duration-150 hover:border-cz-3 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("boardroom.meeting.request.select")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
