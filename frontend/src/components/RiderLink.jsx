import { Link } from "react-router";
import { useRiderNameOverlay } from "./rider/RiderNameIcon.tsx";

// #3203: valgfri `tab`-prop — dyb-link direkte til en fane på rytterprofilen
// (fx "scouting" for scoutingrapporten, spejder-historikkens "link til
// rapporten"). RiderStatsPage læser ?tab= ved mount (fallback "overview"
// uændret for alle eksisterende kald uden denne prop).
//
// #2009/#7858: bag rider_hover_card står et person-ikon efter navnet (TASTE P12) (hover =
// rytterkort, klik = fastlåst kort) og navnet får højreklik-menuen. Slukket =
// præcis samme link som før. `hoverCard={false}` fravælger det, hvor linket
// ikke er et navn (fx en ren pil-knap).
export default function RiderLink({ id, tab = undefined, className = "", stopPropagation = false, hoverCard = true, children, ...rest }) {
  const overlay = useRiderNameOverlay(hoverCard ? id : null);
  if (!id) {
    return <span className={className} {...rest}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  const to = tab ? `/riders/${id}?tab=${tab}` : `/riders/${id}`;
  return (
    <>
      <Link to={to} onClick={handleClick} className={className} {...rest} {...overlay.linkProps}>
        {children}{overlay.icon}
      </Link>
      {overlay.overlays}
    </>
  );
}
