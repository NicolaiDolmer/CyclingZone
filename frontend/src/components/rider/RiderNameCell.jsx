import RiderLink from "../RiderLink";

// Rytternavn uden flag (nation har nu sin egen kolonne). Eventuelle badges
// (U25, status m.m.) leveres af kaldersiden via children, så de ikke blandes
// ind i nation- eller hold-kolonnen. Bruges som <td>-indhold.
export default function RiderNameCell({
  id,
  firstname,
  lastname,
  stopPropagation = false,
  className = "text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors",
  children,
}) {
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <RiderLink id={id} stopPropagation={stopPropagation} className={`${className} whitespace-nowrap`}>
        {firstname} {lastname}
      </RiderLink>
      {children}
    </span>
  );
}
