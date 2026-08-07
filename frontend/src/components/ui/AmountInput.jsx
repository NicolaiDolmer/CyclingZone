import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseAmountInput } from "../../lib/amountInput.js";
import { formatNumber } from "../../lib/intl.js";

/**
 * AmountInput — delt beløbsfelt for ALLE CZ$-beløb i spillet (#3495).
 *
 * Erstatter <input type="number">, som stiltiende trunkerede "150.000"
 * (dansk tusindtalsseparator) til 150 — en faktor 1000-fejl på rigtige
 * penge der ramte en spiller mindst 2 gange i prod.
 *
 * - Accepterer "150.000" / "150,000" / "150 000" / "150000" som samme værdi
 *   (frontend/src/lib/amountInput.js).
 * - Viser en klartekst-bekræftelse ("= 150.000 CZ$") af hvad systemet
 *   forstod, FØR submit — så spilleren ser resultatet, ikke kun tal han selv
 *   tastede.
 * - Input der ikke er et gyldigt heltal efter normalisering afvises med en
 *   feltfejl (aria-invalid + fejltekst) i stedet for stiltiende trunkering
 *   eller et skjult fald-tilbage til 0.
 * - `type="text"` (ikke `type="number"`) er bevidst: native number-inputs
 *   blokerer komma/mellemrum-tastetryk helt, så de kan slet ikke bruges til
 *   at understøtte danske separator-varianter.
 *
 * onValueChange(value, meta) kaldes ved hver ændring:
 *   value      — number|null (parsed heltal, eller null hvis tomt/ugyldigt)
 *   meta.raw     — den rå tekst brugeren har tastet
 *   meta.isEmpty — true hvis feltet er tomt
 *   meta.isValid — true hvis raw er tom ELLER gyldigt parset (false = formatfejl)
 */
export default function AmountInput({
  value,
  onValueChange,
  placeholder,
  className = "",
  wrapperClassName = "",
  feedbackClassName = "",
  showPreview = true,
  errorMessage,
  disabled = false,
  allowNegative = false,
  ...rest
}) {
  const { t } = useTranslation("common");
  const [raw, setRaw] = useState(value == null || value === "" ? "" : String(value));
  const lastExternalValue = useRef(value);

  // Sync kun når `value` ændres UDEFRA (fx reset efter submit, eller parent
  // sætter en ny default) — ikke ved hvert keystroke, ellers overskriver vi
  // brugerens rå tekst midt i indtastningen (og "150." bliver fx til "150").
  useEffect(() => {
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      setRaw(value == null || value === "" ? "" : String(value));
    }
  }, [value]);

  const parsed = parseAmountInput(raw, { allowNegative });
  const isEmpty = raw.trim() === "";
  const isInvalid = !isEmpty && !parsed.valid;

  function handleChange(e) {
    const nextRaw = e.target.value;
    setRaw(nextRaw);
    const nextParsed = parseAmountInput(nextRaw, { allowNegative });
    const nextIsEmpty = nextRaw.trim() === "";
    const nextValue = nextParsed.valid ? nextParsed.value : null;
    lastExternalValue.current = nextValue;
    onValueChange?.(nextValue, {
      raw: nextRaw,
      isEmpty: nextIsEmpty,
      isValid: nextIsEmpty || nextParsed.valid,
    });
  }

  return (
    <div className={wrapperClassName}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={raw}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        className={className}
        {...rest}
      />
      {isInvalid && (
        <p className={feedbackClassName || "text-2xs text-cz-danger mt-1"}>
          {errorMessage || t("amountInput.invalid")}
        </p>
      )}
      {!isInvalid && !isEmpty && showPreview && parsed.valid && (
        <p className={feedbackClassName || "text-2xs text-cz-3 mt-1 tabular-nums"}>
          {t("amountInput.parsedPreview", { amount: formatNumber(parsed.value) })}
        </p>
      )}
    </div>
  );
}
