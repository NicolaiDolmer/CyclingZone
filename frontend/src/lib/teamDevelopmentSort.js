// teamDevelopmentSort — ren komparator for holdsidens Development-fane
// (#3979/#3721). Udskilt fra TeamDevelopmentTab.jsx (samme #803/#2403-mønster
// som riderColumnSort.js's header-kommentar forklarer): Vite/esbuild tilgiver
// extensionless/.jsx-imports, men Node's ESM-loader (node --test, CI) kan
// hverken parse JSX eller importere en .jsx-fil uden loader — denne fil har
// KUN rene imports (ingen) og kan testes direkte.
//
// Samme null-sidst-kontrakt som riderColumnSort.js's `_scoutMid`-gren: et
// manglende bånd/loft (ikke hentet endnu, eller den defensive "intet bånd"-
// gren) er EKSPLICIT forskelligt fra 0, og skal ikke konkurrere med en reelt
// lav værdi — `null` placeres derfor altid sidst, uanset sorteringsretning.
export function compareDevRows(a, b, sort, dir) {
  if (sort === "firstname") {
    const aName = `${a.lastname} ${a.firstname}`.toLowerCase();
    const bName = `${b.lastname} ${b.firstname}`.toLowerCase();
    const cmp = aName.localeCompare(bName, "en");
    return dir === "desc" ? -cmp : cmp;
  }
  const aVal = a[sort];
  const bVal = b[sort];
  const aNil = aVal == null;
  const bNil = bVal == null;
  if (aNil || bNil) {
    if (aNil && bNil) return 0;
    return aNil ? 1 : -1;
  }
  return dir === "desc" ? bVal - aVal : aVal - bVal;
}
