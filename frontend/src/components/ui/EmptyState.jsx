import { InboxIcon } from "./icons";

// #2849 bølge 0 — kanonisk empty-state (states-sheet i docs/design/PAGE_TEMPLATES.md):
// dashed hairline-inset (12px radius), stroke-ikon 26px i --text-3, titel 15px/600,
// ÉN sætning beskrivelse (13px), ÉN handling (sektionens primary, size sm).
// icon: pass et SVG-ikon fra ./icons (aldrig en tekst-glyf).
export default function EmptyState({
  icon = <InboxIcon size={26} aria-hidden="true" />,
  title,
  description,
  action = null,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-cz-border bg-cz-card px-6 py-8 text-center ${className}`}
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
