// #8595 · SKITSE (design-branch, merges aldrig): én fælles kolonnerækkefølge for alle
// rytterlister, så ejeren kan se forslaget på de rigtige sider før noget bygges.
//   Rytter (flag + hover-ikon + navn) · [ikon-kolonner] · Rating · Potentiale · Prognose ·
//   Type · Alder · Værdi · Løn · derefter listens egne kolonner i deres nuværende orden.
// Nationen står som flaget i navnecellen (landet ved hover), så den egne nation-kolonne
// udgår. Alder og type foldes aldrig ind under navnet (ejer 22/11 på #8554).
import { Flag } from "../../../components/Flag";

const CANON = ["name", "rider", "compare", "watchlist", "star", "rating", "potential", "prognosis", "type", "age", "value", "salary"];
const rank = (key) => {
  const i = CANON.indexOf(key);
  return i < 0 ? CANON.length : i;
};

function withFlag(col, codeFor) {
  const wrap = (fn) => (fn ? (row, i) => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Flag code={row.nationality_code ?? row.rider?.nationality_code ?? codeFor?.(row)} className="shrink-0" />
      <span className="min-w-0">{fn(row, i)}</span>
    </span>
  ) : fn);
  return { ...col, render: wrap(col.render), renderShort: wrap(col.renderShort) };
}

/** @param {any[]} columns @param {((row: any) => string | null | undefined) | null} [codeFor] */
export function sketch8595(columns, codeFor = null) {
  return (columns ?? [])
    .filter((col) => col && col.key !== "nation")
    .map((col, i) => ({ col: (col.key === "age" || col.key === "type") ? { ...col, fold: false } : col, i }))
    .sort((a, b) => rank(a.col.key) - rank(b.col.key) || a.i - b.i)
    .map(({ col }) => ((col.key === "name" || col.key === "rider") ? withFlag(col, codeFor) : col));
}
