import { InboxIcon } from "./icons";

// #2849 bølge 0 — kanonisk empty-state (states-sheet i docs/design/PAGE_TEMPLATES.md):
// dashed hairline-inset (12px radius), stroke-ikon 26px i --text-3, titel 15px/600,
// ÉN sætning beskrivelse (13px), ÉN handling (sektionens primary, size sm).
// icon: pass et SVG-ikon fra ./icons (aldrig en tekst-glyf).
//
// #4625 (slice 3 af #4622, TASTE fork 4) — `action` er PÅKRÆVET. En tom tilstand
// der kun beskriver hvad der mangler ("Ingen aktive auktioner") uden en knap der
// fører videre var 6 af de 10 værste fund i audit 2026-09 (Indbakke, Scouting,
// Klub, Transfers m.fl.). Logger console.error i DEV (tree-shaket ud af
// produktionsbuilds) og renderer uden knap — blødgjort fra throw 2/9
// (PR #4657 opfølgning), migreres i opfølgende PR'er.
export default function EmptyState({
  icon = <InboxIcon size={26} aria-hidden="true" />,
  title,
  description,
  action,
  className = "",
}) {
  if (import.meta.env.DEV && !action) {
    console.error(
      `EmptyState kraever en \`action\`-prop (titel: ${JSON.stringify(title ?? null)}). ` +
        "Skabelonens anatomi er stroke-ikon + handlings-titel + EN saetning + EN knap " +
        "(docs/design/PAGE_TEMPLATES.md#canonical-states) — en tom tilstand uden vej videre er et fund, ikke en variant."
    );
  }
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-cz border border-dashed border-cz-border bg-cz-card px-6 py-8 text-center ${className}`}
    >
      {icon && <span className="text-cz-3">{icon}</span>}
      <div>
        <p className="text-[15px] font-semibold text-cz-1">{title}</p>
        {description && <p className="mt-1 max-w-sm text-[13px] text-cz-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}
