import { useContext } from "react";
import { buttonClass } from "./buttonStyles.js";
import { TableRowContext } from "./tableRowContext.js";

// #4625 (slice 3 af #4622, PAGE_TEMPLATES T2: "row action buttons are
// secondary sm — never gold in rows") — guld i tabelraekker var et gentaget
// audit-fund (Auktioner "Byd"/"+ Autobud", Akademi "Ryk op"/"Signer"). Inde i
// en DataTable-raekke (TableRowContext, sat af DataTable.jsx om <tbody>)
// logger `variant="primary"` et console.error i DEV og tvinges til secondary —
// blødgjort fra throw 2/9 (PR #4657 opfølgning), migreres i opfølgende PR'er.
export default function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  className = "",
  children,
  ...rest
}) {
  const inTableRow = useContext(TableRowContext);
  const invalidPrimaryInRow = inTableRow && variant === "primary";
  if (import.meta.env.DEV && invalidPrimaryInRow) {
    console.error(
      'Button variant="primary" er ikke tilladt i en DataTable-raekke — raekkeknapper er ALTID secondary. ' +
        "Se docs/design/PAGE_TEMPLATES.md#t2-wide-data-page (\"row action buttons are secondary sm, never gold in rows\")."
    );
  }
  const effectiveVariant = invalidPrimaryInRow ? "secondary" : variant;
  return (
    <button
      className={`${buttonClass({ variant: effectiveVariant, size, fullWidth })} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {!loading && iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
}
