import type { ReactNode } from "react";

// #8016: bekraeftelsens raekker er ens for bud og auktion, saa spilleren altid
// laeser det samme sted om han sender et bud eller starter en auktion.
export type ConfirmRow = { key: string; label: string; value: ReactNode; numeric?: boolean };

export default function ConfirmRows({ rows, testId }: { rows: ConfirmRow[]; testId: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-cz-3">{row.label}</dt>
          <dd className={`text-right text-cz-1 ${row.numeric ? "font-data tabular-nums font-semibold" : ""}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
