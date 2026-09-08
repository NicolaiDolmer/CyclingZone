// In-app spørgeskema (#4943) — kontrollerne, holdt ude af SurveyPage så siden
// selv kun handler om indlæsning, autosave og layout.
//
// Design (docs/design/PAGE_TEMPLATES.md + TASTE.md):
//   * Valgt trin = guld-TEKST på 10 % guld-flade, samme opskrift som
//     Segmented-primitivets aktive segment (TASTE fork 3, guld-sted 3). IKKE
//     guld-fyld: sidens ene guld-primære element er Send-knappen.
//   * Alle tal er data-font + tabular-nums, hairline-rammer, 5 px radius.
//   * Stroke-ikoner kun, ingen emoji, ingen unicode-glyffer.
//   * Mobil (375 px): to-akse-rækken er funktionsnavn, derunder to kompakte
//     1-5-segmenter med deres egen etiket til venstre. Trinene er flex-1, så
//     de krymper med skærmen i stedet for at wrappe.

import { useTranslation } from "react-i18next";
import { Checkbox, Radio, Textarea } from "../ui";
import { optionGroup, optionLabel, questionOptions, MULTI_MAX3_LIMIT, SCALE_0_10, SCALE_1_5 } from "../../lib/survey.js";

const STEP_BASE =
  "h-9 min-w-0 flex-1 rounded-cz border font-data text-xs font-semibold tabular-nums transition-colors duration-150 disabled:opacity-50";
const STEP_ON = "border-cz-accent bg-cz-accent/10 text-cz-accent-t";
const STEP_OFF = "border-cz-border bg-cz-card text-cz-2 hover:border-cz-3 hover:text-cz-1";

function stepClass(active) {
  return `${STEP_BASE} ${active ? STEP_ON : STEP_OFF}`;
}

// Trinene er flex-1 saa de krymper med skaermen, men de maa ikke straekkes ud
// over en laesbar knapbredde paa desktop: et 1-5-trin der er 200 px bredt
// laeses ikke som en skala laengere.
const SCALE_MAX_WIDTH = { short: "max-w-[400px]", long: "max-w-[600px]" };
const scaleCap = (scale) => (scale.length > 6 ? SCALE_MAX_WIDTH.long : SCALE_MAX_WIDTH.short);

/** Én skala-række: valgfri etiket til venstre, derefter trinene. */
function ScaleRow({ label, scale, value, ariaLabel, onSelect, disabled }) {
  const cap = scaleCap(scale);
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="w-[76px] shrink-0 font-data text-3xs uppercase tracking-[.08em] text-cz-3">
          {label}
        </span>
      )}
      <div role="radiogroup" aria-label={ariaLabel} className={`flex min-w-0 flex-1 gap-1 ${cap}`}>
        {scale.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={String(n)}
            disabled={disabled}
            onClick={() => onSelect(value === n ? null : n)}
            className={stepClass(value === n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// Endepunkts-etiketterne skal flugte med skalaens egen bredde, ikke med kortet:
// "Meget tilfreds" 200 px til hoejre for femtallet peger paa ingenting.
function ScaleEnds({ low, high, cap }) {
  return (
    <div className={`mt-1 flex justify-between text-3xs text-cz-3 ${cap}`}>
      <span>{low}</span>
      <span>{high}</span>
    </div>
  );
}

function ScaleQuestion({ question, value, onChange, disabled, ends }) {
  const scale = question.kind === "scale_0_10" ? SCALE_0_10 : SCALE_1_5;
  const cap = scaleCap(scale);
  return (
    <>
      <ScaleRow
        scale={scale}
        value={value?.score ?? null}
        ariaLabel={question.label}
        onSelect={(next) => onChange(next)}
        disabled={disabled}
      />
      {ends && <ScaleEnds low={ends.low} high={ends.high} cap={cap} />}
    </>
  );
}

/** To-akse-gitteret: én række pr. funktion, to 1-5-skalaer plus "ved ikke". */
function IdeaImportanceQuestion({ question, value, language, onChange, disabled }) {
  const { t } = useTranslation("survey");
  const ratings = value?.ratings ?? {};

  function setAxis(featureKey, axis, next) {
    const current = ratings[featureKey] ?? {};
    onChange({ ...ratings, [featureKey]: { ...current, dont_know: false, [axis]: next } });
  }

  function toggleDontKnow(featureKey) {
    const current = ratings[featureKey] ?? {};
    onChange({
      ...ratings,
      [featureKey]: current.dont_know
        ? { idea: null, importance: null, dont_know: false }
        : { idea: null, importance: null, dont_know: true },
    });
  }

  // Gruppe-overskrift naar options skifter omraade (feature_axes' fem
  // grupper, #4943 v3). Options-raekkefoelgen ER grupperingen: listen sorteres
  // aldrig om her, og et spoergsmaal uden group-felter faar ingen overskrifter.
  const options = questionOptions(question);

  return (
    <ul className="flex flex-col">
      {options.map((option, index) => {
        const rating = ratings[option.key] ?? {};
        const dontKnow = Boolean(rating.dont_know);
        const name = optionLabel(option, language);
        const group = optionGroup(option, language);
        const newGroup = group && group !== optionGroup(options[index - 1], language);
        return (
          <li key={option.key} className="border-t border-cz-border py-3.5 first:border-t-0 first:pt-0">
            {newGroup && (
              <p className="mb-2.5 font-data text-2xs uppercase tracking-[.08em] text-cz-3">{group}</p>
            )}
            <p className="text-[13.5px] font-medium leading-snug text-cz-1">{name}</p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              <ScaleRow
                label={t("axes.idea")}
                scale={SCALE_1_5}
                value={dontKnow ? null : rating.idea ?? null}
                ariaLabel={`${t("axes.idea")}: ${name}`}
                onSelect={(next) => setAxis(option.key, "idea", next)}
                disabled={disabled || dontKnow}
              />
              <ScaleRow
                label={t("axes.importance")}
                scale={SCALE_1_5}
                value={dontKnow ? null : rating.importance ?? null}
                ariaLabel={`${t("axes.importance")}: ${name}`}
                onSelect={(next) => setAxis(option.key, "importance", next)}
                disabled={disabled || dontKnow}
              />
            </div>
            <div className="mt-2 ms-[84px]">
              <Checkbox
                checked={dontKnow}
                disabled={disabled}
                onChange={() => toggleDontKnow(option.key)}
                label={t("axes.dontKnow")}
                aria-label={t("axes.dontKnowAria", { feature: name })}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MultiQuestion({ question, value, language, onChange, disabled }) {
  const { t } = useTranslation("survey");
  const selected = value?.selected ?? [];
  const capped = question.kind === "multi_max3";
  const left = capped ? Math.max(MULTI_MAX3_LIMIT - selected.length, 0) : null;

  function toggle(optionKey) {
    if (selected.includes(optionKey)) {
      onChange(selected.filter((key) => key !== optionKey));
      return;
    }
    if (capped && selected.length >= MULTI_MAX3_LIMIT) return;
    onChange([...selected, optionKey]);
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {questionOptions(question).map((option) => {
          const isOn = selected.includes(option.key);
          return (
            <Checkbox
              key={option.key}
              checked={isOn}
              disabled={disabled || (capped && !isOn && selected.length >= MULTI_MAX3_LIMIT)}
              onChange={() => toggle(option.key)}
              label={optionLabel(option, language)}
            />
          );
        })}
      </div>
      {capped && (
        <p className="mt-2 font-data text-3xs uppercase tracking-[.08em] tabular-nums text-cz-3">
          {t("field.maxThreeLeft", { left })}
        </p>
      )}
    </>
  );
}

function ChoiceQuestion({ question, value, language, onChange, disabled }) {
  const { t } = useTranslation("survey");
  const options =
    question.kind === "yes_no"
      ? [
          { key: "yes", label: t("field.yes") },
          { key: "no", label: t("field.no") },
        ]
      : questionOptions(question).map((option) => ({ key: option.key, label: optionLabel(option, language) }));

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <Radio
          key={option.key}
          name={question.key}
          checked={value?.choice === option.key}
          disabled={disabled}
          onChange={() => onChange(option.key)}
          label={option.label}
        />
      ))}
    </div>
  );
}

function TextQuestion({ question, value, onChange, disabled }) {
  const { t } = useTranslation("survey");
  return (
    <Textarea
      id={`survey-${question.key}`}
      rows={3}
      maxLength={1000}
      disabled={disabled}
      value={value?.text ?? ""}
      placeholder={t("field.textPlaceholder")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Én spørgsmålsblok: etiket, valgfri hjælpetekst, kontrollen, gem-status.
 * `onChange` får den RÅ værdi for typen (tal, array, streng, ratings-objekt);
 * SurveyPage normaliserer og gemmer den.
 */
export default function SurveyQuestion({
  question,
  label,
  help,
  value,
  language,
  saveState,
  disabled = false,
  onChange,
  scaleEnds = null,
}) {
  const { t } = useTranslation("survey");

  let control;
  if (question.kind === "scale_1_5" || question.kind === "scale_0_10") {
    control = (
      <ScaleQuestion question={{ ...question, label }} value={value} onChange={onChange} disabled={disabled} ends={scaleEnds} />
    );
  } else if (question.kind === "idea_importance") {
    control = (
      <IdeaImportanceQuestion question={question} value={value} language={language} onChange={onChange} disabled={disabled} />
    );
  } else if (question.kind === "multi_max3" || question.kind === "multi") {
    control = <MultiQuestion question={question} value={value} language={language} onChange={onChange} disabled={disabled} />;
  } else if (question.kind === "single" || question.kind === "yes_no") {
    control = <ChoiceQuestion question={question} value={value} language={language} onChange={onChange} disabled={disabled} />;
  } else {
    control = <TextQuestion question={question} value={value} onChange={onChange} disabled={disabled} />;
  }

  const isText = question.kind === "text";

  return (
    <div className="border-t border-cz-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        {isText ? (
          <label htmlFor={`survey-${question.key}`} className="text-[13.5px] font-medium leading-snug text-cz-1">
            {label}
          </label>
        ) : (
          <p className="text-[13.5px] font-medium leading-snug text-cz-1">{label}</p>
        )}
        {!question.required && (
          <span className="shrink-0 font-data text-3xs uppercase tracking-[.08em] text-cz-3">
            {t("field.optional")}
          </span>
        )}
      </div>
      {help && <p className="mb-2.5 text-xs leading-relaxed text-cz-2">{help}</p>}
      <div className={help ? "" : "mt-2.5"}>{control}</div>
      <div aria-live="polite" className="mt-1.5 min-h-[1rem]">
        {saveState === "saving" && <span className="text-3xs text-cz-3">{t("save.saving")}</span>}
        {saveState === "saved" && <span className="text-3xs text-cz-3">{t("save.saved")}</span>}
        {saveState === "error" && <span className="text-3xs text-cz-danger">{t("save.error")}</span>}
      </div>
    </div>
  );
}
