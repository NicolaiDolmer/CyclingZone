/**
 * amountInput — shared parsing/normalisering af beløbsfelter (#3495).
 *
 * Baggrund: alle beløb i spillet (CZ$) er heltal. Danske spillere bruger "."
 * som tusindtalsseparator ("150.000"), men de fleste felter parsede med
 * parseInt/parseFloat der stopper ved punktummet — "150.000" → 150. En
 * spiller ramte det mindst 2 gange og en rytter blev sat til salg for 1/1000
 * af den tilsigtede pris (ejeren måtte rydde op manuelt i prod).
 *
 * parseAmountInput() accepterer "150.000", "150,000", "150 000" og "150000"
 * og normaliserer alle til det samme heltal (150000). Den afviser eksplicit
 * — i stedet for at stiltiende trunkere — input der er reelt tvetydigt
 * (f.eks. "150.5" kan ikke skelnes fra en ægte decimal, og beløb er altid
 * heltal, så det er en fejl, ikke en gyldig pris).
 *
 * Kept som ren .js (ingen React) så den er node --test-venlig og genbruges
 * 1:1 af komponenten (components/ui/AmountInput.jsx) og alle kald-steder.
 */

/**
 * @param {string|number|null|undefined} raw
 * @returns {{ valid: boolean, value: number|null }}
 */
export function parseAmountInput(raw, { allowNegative = false } = {}) {
  if (raw === null || raw === undefined) return { valid: false, value: null };
  if (typeof raw === "number") {
    return Number.isFinite(raw) && Number.isInteger(raw) && (allowNegative || raw >= 0)
      ? { valid: true, value: raw }
      : { valid: false, value: null };
  }

  let trimmed = String(raw).trim();
  if (trimmed === "") return { valid: false, value: null };

  let negative = false;
  if (allowNegative && trimmed.startsWith("-")) {
    negative = true;
    trimmed = trimmed.slice(1).trim();
    if (trimmed === "") return { valid: false, value: null };
  }

  // Kun cifre, punktum, komma og whitespace (inkl. nbsp) er tilladt — ingen
  // fortegn (beløb er aldrig negative, medmindre allowNegative), bogstaver,
  // valutategn osv.
  if (!/^[0-9](?:[0-9.,\s\u00A0]*[0-9])?$/.test(trimmed)) {
    return { valid: false, value: null };
  }

  // Whitespace (almindeligt eller nbsp) er altid en gruppeseparator ("150 000").
  const noSpaces = trimmed.replace(/[\s\u00A0]/g, "");
  if (noSpaces === "") return { valid: false, value: null };

  const dotCount = (noSpaces.match(/\./g) || []).length;
  const commaCount = (noSpaces.match(/,/g) || []).length;

  let digitsOnly;

  if (dotCount === 0 && commaCount === 0) {
    digitsOnly = noSpaces;
  } else if (dotCount > 0 && commaCount > 0) {
    // Blandet — europæisk ("1.234.567,89") eller amerikansk ("1,234,567.89")
    // stil. Det SIDSTE separator-tegn er decimal-separatoren; resten er
    // gruppering. Beløb er heltal, så en ægte (ikke-nul) brøkdel afvises.
    const lastDot = noSpaces.lastIndexOf(".");
    const lastComma = noSpaces.lastIndexOf(",");
    const decimalIndex = Math.max(lastDot, lastComma);
    const intPart = noSpaces.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fracPart = noSpaces.slice(decimalIndex + 1);
    if (intPart === "" || !/^\d*$/.test(fracPart) || !/^0*$/.test(fracPart)) {
      return { valid: false, value: null };
    }
    digitsOnly = intPart;
  } else {
    // Kun én type separator brugt — kan enten være tusindtalsgruppering
    // ("150.000", alle grupper efter den første har præcis 3 cifre) eller en
    // decimal ("150.5" / "150.00"). En ren-nul brøkdel ("150.00") er en
    // harmløs decimal-notation af et heltal og accepteres; alt andet
    // tvetydigt afvises i stedet for at gætte.
    const sep = dotCount > 0 ? "." : ",";
    const parts = noSpaces.split(sep);
    const groups = parts.slice(1);
    const isThousandsGrouping = groups.length > 0 && groups.every(g => g.length === 3 && /^\d{3}$/.test(g)) && /^\d{1,3}$/.test(parts[0]);
    if (isThousandsGrouping) {
      digitsOnly = parts.join("");
    } else if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^0*$/.test(parts[1])) {
      digitsOnly = parts[0];
    } else {
      return { valid: false, value: null };
    }
  }

  if (!/^\d+$/.test(digitsOnly)) return { valid: false, value: null };
  const value = parseInt(digitsOnly, 10);
  if (!Number.isSafeInteger(value)) return { valid: false, value: null };
  return { valid: true, value: negative ? -value : value };
}

/**
 * Lempelig decimal-parser til IKKE-beløbs felter der reelt skal kunne have
 * decimaler (fx "+10,5%" i bulk-prisjustering). Accepterer "." eller ","
 * som decimal-separator (aldrig begge — det er tvetydigt/gruppering, se
 * parseAmountInput ovenfor), ingen tusindtalsgruppering forventet fordi
 * disse værdier typisk er små (procent/delta).
 *
 * @param {string} raw
 * @returns {{ valid: boolean, value: number|null }}
 */
export function parseDecimalInput(raw) {
  if (raw === null || raw === undefined) return { valid: false, value: null };
  const trimmed = String(raw).trim();
  if (trimmed === "") return { valid: false, value: null };
  if (!/^[+-]?[0-9]*[.,]?[0-9]+$/.test(trimmed)) return { valid: false, value: null };
  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { valid: false, value: null };
  return { valid: true, value };
}

/**
 * Mode-bevidst parser til bulk-prisjustering (#2451): "set"/"amount" er
 * heltals-CZ$ (samme risiko for tusind-fejl som alle andre beløbsfelter),
 * "percent" er en reel decimal. "amount" er en delta og må være negativ
 * (fx "-500" = sænk alle markerede priser med 500) — "set" er en absolut
 * pris og skal derfor være ikke-negativ.
 *
 * @param {string} raw
 * @param {"percent"|"amount"|"set"} mode
 * @returns {{ valid: boolean, value: number|null }}
 */
export function parseAdjustmentValue(raw, mode) {
  if (mode === "percent") return parseDecimalInput(raw);
  if (mode === "amount") return parseAmountInput(raw, { allowNegative: true });
  return parseAmountInput(raw);
}
