import { InboxIcon } from "./icons";

// icon: pass an SVG icon component from ./icons (not a text glyph). Defaults to
// InboxIcon so frames without an explicit icon still render a real stroke-SVG.
export default function EmptyState({ icon = <InboxIcon size={32} aria-hidden="true" />, title, description, action = null, className = "" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-cz border border-cz-border bg-cz-card px-6 py-12 text-center ${className}`}
    >
      {icon && <div className="mb-3 text-cz-3">{icon}</div>}
      <p className="font-data text-sm font-semibold uppercase tracking-[.08em] text-cz-1">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-cz-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
