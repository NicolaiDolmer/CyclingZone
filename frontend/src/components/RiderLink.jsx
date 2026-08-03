import { Link } from "react-router";

// #3203: valgfri `tab`-prop — dyb-link direkte til en fane på rytterprofilen
// (fx "scouting" for scoutingrapporten, spejder-historikkens "link til
// rapporten"). RiderStatsPage læser ?tab= ved mount (fallback "overview"
// uændret for alle eksisterende kald uden denne prop).
export default function RiderLink({ id, tab, className = "", stopPropagation = false, children, ...rest }) {
  if (!id) {
    return <span className={className} {...rest}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  const to = tab ? `/riders/${id}?tab=${tab}` : `/riders/${id}`;
  return (
    <Link to={to} onClick={handleClick} className={className} {...rest}>
      {children}
    </Link>
  );
}
