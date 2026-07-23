import Card from "./Card.jsx";
import { ChevronRightIcon } from "./icons/index.jsx";

// #2849 bølge 0 — DEN kanoniske section-card-recipe (docs/design/PAGE_TEMPLATES.md).
// Padding 20px (16px på mobil), ingen skygge — chrome renderer altid; kun body
// swapper mellem loading/empty/error (canonical states).
export default function Section({ className = "", children, ...rest }) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`} {...rest}>
      {children}
    </Card>
  );
}

// Søskende-sections stakker med 14px gap (spec: sibling-gap 14px).
export function SectionStack({ className = "", children, ...rest }) {
  return (
    <div className={`flex flex-col gap-[14px] ${className}`} {...rest}>
      {children}
    </div>
  );
}

// Card-header: titel 15px/600; højre slot er ENTEN en quiet action ELLER et
// uppercase meta-label — aldrig begge. Får den begge, vinder action.
export function SectionHeader({ title, as: Heading = "h2", action = null, meta = null, className = "" }) {
  if (import.meta.env.DEV && action && meta) {
    console.warn("SectionHeader: `action` og `meta` er gensidigt udelukkende — `meta` ignoreres.");
  }
  return (
    <div className={`mb-4 flex items-baseline justify-between gap-3 ${className}`}>
      <Heading className="text-[15px] font-semibold text-cz-1">{title}</Heading>
      {action}
      {!action && meta && (
        <span className="font-data text-[11px] uppercase tracking-[.08em] text-cz-3">{meta}</span>
      )}
    </div>
  );
}

// Quiet action til SectionHeader's højre slot: 12px/500 i --accent-t + chevron 13px.
export function SectionAction({ as: Comp = "button", className = "", children, ...rest }) {
  return (
    <Comp
      className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium text-cz-accent-t transition-colors duration-150 hover:underline ${className}`}
      {...rest}
    >
      {children}
      <ChevronRightIcon size={13} aria-hidden="true" />
    </Comp>
  );
}
