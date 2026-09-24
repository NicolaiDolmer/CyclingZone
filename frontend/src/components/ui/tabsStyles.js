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
  "whitespace-nowrap border-b-2 py-2.5 text-sm font-medium transition-colors duration-150 scroll-mb-14 md:scroll-mb-0";

// #5485 (training, 23/9): `fit` er et OPT-IN for en fanerække der skal staa
// HELT paa en telefon (360-390 px) uden vandret scroll: faste 4 faner, hvor
// den sidste ellers blev skaaret af ("Report"/"Rapport"). Under `sm` bliver
// vandret padding 8 px i stedet for 16 px, og raekken fordeler fanerne over
// bredden; fra `sm` og op er fanerne identiske med standarden. Samme
// underline, samme typografi, samme 14 px-labels: kun luften flytter sig.
// Standarden (uden `fit`) er uaendret, saa ingen anden side flytter sig.
const TAB_PAD = "px-4";
const TAB_PAD_FIT = "px-2 sm:px-4";

export function tabClass({ active = false, fit = false } = {}) {
  const base = `${TAB_BASE} ${fit ? TAB_PAD_FIT : TAB_PAD}`;
  return active
    ? `${base} border-cz-accent text-cz-1`
    : `${base} border-transparent text-cz-3 hover:text-cz-2`;
}

export function tabListClass({ className = "", fit = false } = {}) {
  const spacing = fit ? "justify-between sm:justify-start sm:gap-1" : "gap-1";
  return `flex ${spacing} overflow-x-auto border-b border-cz-border ${className}`.trim();
}
