// Hvornår er et sidebar-menupunkt det aktive? Ren funktion, unit-testbar —
// samme mønster som plannerNavVisibility.js. Lå før inline i Layout.jsx, hvor
// den ikke kunne dækkes af node --test (.jsx).
//
// #987: `to` kan indeholde en query (fx "/transfers?tab=market"). Aktiv kræver
// at path matcher OG alle query-params i `to` findes i URL'en. `excludeQuery`
// afaktiverer et item når en bestemt param-værdi ER sat (så søskende-genveje
// til samme path ikke begge lyser op).
// #3102: `excludePaths` gør det samme for søskende-ruter under samme prefix —
// /races/strategy har sit eget menupunkt i Planlægning, så "Løb" må ikke også
// lyse op dér via prefix-matchet. Item-objektet sendes som helhed, så et nyt
// felt ikke kan blive glemt på ét af kaldstederne.
export function pathMatchesNavItem(location, item) {
  const { to, exact = false, excludeQuery = null, excludePaths = null } = item;
  const [toPath, toQuery] = to.split("?");
  const pathOk = exact
    ? location.pathname === toPath
    : location.pathname === toPath || location.pathname.startsWith(`${toPath}/`);
  if (!pathOk) return false;
  if (excludePaths?.includes(location.pathname)) return false;
  const current = new URLSearchParams(location.search);
  if (toQuery) {
    for (const [k, v] of new URLSearchParams(toQuery)) {
      if (current.get(k) !== v) return false;
    }
  }
  if (excludeQuery) {
    for (const [k, v] of new URLSearchParams(excludeQuery)) {
      if (current.get(k) === v) return false;
    }
  }
  return true;
}
