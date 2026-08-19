import { ChevronDownIcon } from "./icons/index.jsx";

// #3914 — delt fold-primitiv (etapesiden #3859/#3914-kontrakt, ejer-godkendt
// 18/8). <details>-baseret (samme browser-native tilgængelighed som
// LandingPage's FaqItem — summary er fokusérbar/tastatur-betjent uden ekstra
// ARIA, ingen ny afhængighed). Kontrakt-styling: hairline (border-cz-border),
// 5px radius (rounded-cz), SectionHeader-typografi (15px/600 titel, 2xs
// uppercase meta), chevron-stroke-ikon der roterer på åben/luk.
//
// Fold-tilstand persisterer IKKE (ingen localStorage, #3914-scope) —
// `defaultOpen` alene styrer hvad brugeren ser ved mount. React genskriver
// kun DOM'ens `open`-attribut når PROP-VÆRDIEN ændrer sig mellem renders
// (samme mekanik som LandingPage's FaqItem), så en brugers manuelle
// fold/udfold via klik på summary overlever almindelig re-render af siden.
export default function CollapsibleSection({ title, defaultOpen = false, meta = null, className = "", children }) {
  return (
    <details open={defaultOpen} className={`group rounded-cz border border-cz-border bg-cz-card ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 sm:px-5 py-4 select-none">
        <span className="text-[15px] font-semibold text-cz-1">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {meta && <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{meta}</span>}
          <ChevronDownIcon size={16} className="text-cz-3 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0 border-t border-cz-border">
        {children}
      </div>
    </details>
  );
}
