// #8280 (TASTE P21) — ren logik bag tabellens titellinje, så den kan testes med
// `node --test` uden DOM. Selve markuppen bor i TableTitleBar.tsx.

export type TitleBarOption = { value: string | number; label: string; shortLabel?: string };

export type TitleBarChoice = {
  key: string;
  ariaLabel: string;
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  options: TitleBarOption[];
};

export type TitleBarColumnItem = { key: string; label: string; checked: boolean; disabled?: boolean };

export type TitleBarColumns = {
  label?: string;
  hint?: string;
  count: number;
  total: number;
  items: TitleBarColumnItem[];
  onToggle: (key: string) => void;
  footer?: { label: string; checked: boolean; onToggle: () => void } | null;
};

/** "3/9": hvor mange kolonner der vises ud af de kolonner man kan vælge imellem. */
export function columnsSummary(count: number | undefined, total: number | undefined): string {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCount = Math.min(Math.max(0, Number(count) || 0), safeTotal);
  return `${safeCount}/${safeTotal}`;
}

/**
 * Den tekst et valg viser i selve linjen: den valgte options label. Et valg
 * uden match (fx en værdi der ikke længere findes) falder tilbage til første
 * option, så linjen aldrig står tom.
 */
export function choiceLabel(choice: { value?: string | number; options?: TitleBarOption[] } | null | undefined, compact = false): string {
  const options = choice?.options ?? [];
  const match = options.find((o) => String(o.value) === String(choice?.value ?? ""));
  const option = match ?? options[0];
  return (compact ? option?.shortLabel : undefined) ?? option?.label ?? "";
}

/**
 * Telemetri-nyttelasten for `table_control_used` (#8280). KUN side og kontrolnavn
 * (og for kolonner den statiske kolonnenøgle) — aldrig søgetekst, filterværdier,
 * rytter-, hold- eller bruger-id. Formålet er at kunne vælge standardvalg ud fra
 * brug; det kræver ikke persondata.
 */
export function tableControlPayload(
  page: string | undefined,
  control: string,
  item: string | null = null,
): { page: string; control: string; item?: string } {
  const payload: { page: string; control: string; item?: string } = {
    page: String(page || "unknown"),
    control: String(control),
  };
  if (item != null) payload.item = String(item);
  return payload;
}
