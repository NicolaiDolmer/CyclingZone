import Card from "./Card.jsx";
import { ChevronRightIcon } from "./icons/index.jsx";

// #2849 bølge 0 — DEN kanoniske section-card-recipe (docs/design/PAGE_TEMPLATES.md).
// Padding 20px (16px på mobil), ingen skygge — chrome renderer altid; kun body
// swapper mellem loading/empty/error (canonical states).
//
// #4625 (slice 3 af #4622, TASTE §3) — venstre-accent-bjælker er et femte
// prioritetssignal oven i de fire guld har lov til, og var Dashboards mest
// gentagne fund (audit 2026-09). Section har ingen `accent`/`leftBar`-prop, og
// forsøger en className en border-l-klasse ind alligevel, kaster den i DEV —
// primitivet kan ikke bruges til at tegne en femte "vigtigt"-markør.
const LEFT_ACCENT_RE = /\bborder-l-(?:\[|[2-9]\b|cz-)/;

export default function Section({ className = "", children, ...rest }) {
  if (import.meta.env.DEV && LEFT_ACCENT_RE.test(className)) {
    throw new Error(
      `Section maa ikke have en venstre-accent-bjaelke (className="${className}"). ` +
        "Det er et femte prioritetssignal oven i guld-knap/leder-markoer/guld-tekst/T3-keyline — se docs/design/TASTE.md §3."
    );
  }
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
        <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{meta}</span>
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
