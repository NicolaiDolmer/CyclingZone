// #5008/#5010/#5023-følgefejl: T3-sider (manager-/hold-/rytterprofil m.fl.)
// deler denne tablist, og MobileQuickNav (Layout.jsx) er `fixed bottom-0` med
// 56px højde på mobil (`md:hidden`) — men den optager ikke plads i dokument-
// flowet, så browserens native scrollIntoView (brugt af tastatur-fokus,
// TabList's Home/End/piletaster i #4625) ved intet om den dækkede stribe og
// kan lande en fane der. Ramte manager-profilen først (5. hero-tal +
// Founder-mærke + Discord-linje voksede identitetsblokken nok til at skubbe
// tab-rækken ned i den stribe på iPhone 13/mobile-webkit — reelt en
// klik-gennem-fejl for enhver bruger), men enhver T3-side med nok indhold
// over tabs kan ramme den samme klasse af fejl. `scroll-mb-14` (56px matcher
// MobileQuickNav's højde 1:1, nul-cost på desktop) sidder på selve
// tab-KNAPPEN, ikke på tablist-containeren — browseren scroller det
// FOKUSEREDE element (`tabs[next]?.focus()` i TabList) ind i view og
// respekterer scroll-margin på DET element, ikke på en forælder
// (CodeRabbit-fund under denne PR).
const TAB_BASE =
  "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150 scroll-mb-14 md:scroll-mb-0";

export function tabClass({ active = false } = {}) {
  return active
    ? `${TAB_BASE} border-cz-accent text-cz-1`
    : `${TAB_BASE} border-transparent text-cz-3 hover:text-cz-2`;
}

export function tabListClass({ className = "" } = {}) {
  return `flex gap-1 overflow-x-auto border-b border-cz-border ${className}`.trim();
}
