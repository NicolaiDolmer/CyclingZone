import RiderLink from "../RiderLink";
import RiderTalentMark from "./TalentMark.tsx"; // #7879: efter navnet, før status-mærkerne (TASTE P12)
import RiderChampionJersey from "./ChampionJersey.tsx"; // #7824: mærke-pladsen efter navnet og ikonet, før status (TASTE P12)

// Rytternavn uden flag (nation har nu sin egen kolonne). Eventuelle badges
// (U25, status m.m.) leveres af kaldersiden via children, så de ikke blandes
// ind i nation- eller hold-kolonnen. Bruges som <td>-indhold.
//
// #5124: `wrap` (default false, alle eksisterende kald uændrede) lader navnet
// bryde ved ordgrænser i stedet for at tvinge nowrap-bredden — D-047's
// mobil-standardtilstand (ingen vandret scroll) kræver det, ligesom
// DataTable's renderStickyCell(wrap) og TrainingPage.jsx's roster.
//
// #5383: `name` (valgfri) saetter den viste tekst direkte, saa en kalder kan
// vise den korte form ("A. Pedersen", lib/riderName.ts) uden at cellen skal
// gaette hvordan et navn deles. Udelades den, vises fornavn + efternavn som
// hidtil. Linkets TILGAENGELIGE navn er altid det fulde navn: en forkortelse er
// et pladsvalg paa skaermen, ikke en omdoebning — en skaermlaeser skal stadig
// sige "Ada Pedersen".
export default function RiderNameCell({
  id,
  firstname,
  lastname,
  name,
  stopPropagation = false,
  className = "text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors",
  wrap = false,
  children,
}) {
  const fullName = `${firstname ?? ""} ${lastname ?? ""}`.trim();
  const shown = name ?? fullName;
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap max-w-full ${wrap ? "min-w-0" : ""}`}>
      {/* #5124: KUN `min-w-0` (bryd ved ordgrænser), ikke `wrap-break-word` — sidstnævnte
          tillader browseren at bryde MIDT i et ord, hvilket i en tabel med
          table-layout:auto (og en `max-w-0`-kolonnehint, se TransfersPage.jsx's
          sticky navne-celle) presser bredden helt ned til ét tegn pr. linje
          ("S/a/n/d/e/r"). Uden wrap-break-word er kolonnens minimumsbredde det
          LÆNGSTE ORD i navnet, som table-layout ikke kan presse under — samme
          fix som TrainingPage.jsx's roster (#5124). */}
      {/* #7824: navn og trøje i én gruppe uden linjeskift imellem, så trøjen aldrig
          ryger ned under navnet, når tabellen giver kolonnen sin mindste bredde. */}
      {/* #7879: hover-ikonet står til venstre for navnet (RiderLink), mærker og trøje lige til
          højre på samme linje. Et langt navn forkortes med ellipsis (kun når kolonnen er
          begrænset) i stedet for at skubbe mærkerne ned; mærkerne krymper aldrig. */}
      <span className={`inline-flex items-center gap-1.5 min-w-0 max-w-full`}>
        <RiderLink
          id={id}
          stopPropagation={stopPropagation}
          className={`${className} inline-flex items-center min-w-0 ${wrap ? "" : "whitespace-nowrap"}`}
          aria-label={fullName && shown !== fullName ? fullName : undefined}
          title={fullName && shown !== fullName ? fullName : undefined}
        >
          <span className={wrap ? "" : "min-w-0 truncate"}>{shown}</span>
        </RiderLink>
        <RiderChampionJersey riderId={id} />
        <RiderTalentMark riderId={id} />
      </span>
      {children}
    </span>
  );
}
