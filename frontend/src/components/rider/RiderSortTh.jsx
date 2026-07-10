// RiderSortTh — bevaret som import-sti for rytter-tabellerne, men er nu bare en
// re-export af den domæne-neutrale, kanoniske SortableTh (components/ui). Før
// #1755-generaliseringen boede header-implementeringen her; den flyttede til ui/
// så ikke-rytter-tabeller (træning, manager-profil, løbsbibliotek) kan dele
// præcis samme header. Rytter-kald-sites + kilde-tekst-testene (#1537) matcher
// fortsat <SortTh sortKey="..."> uændret, fordi prop-formen er identisk.
export { default, SortIndicator } from "../ui/SortableTh.jsx";
