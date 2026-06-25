import { Link } from "react-router-dom";

// Løbet som førsteklasses klikbart objekt → /races/:id (valgfri ?stage=N).
// id mangler → ren <span> (graceful, som RiderLink/TeamLink). Rygrad for S5/S6.
export default function RaceLink({ id, stage, state, className = "", stopPropagation = false, children, ...rest }) {
  if (!id) {
    return <span className={className} {...rest}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  const to = stage != null ? `/races/${id}?stage=${stage}` : `/races/${id}`;
  return (
    <Link to={to} state={state} onClick={handleClick} className={className} {...rest}>
      {children}
    </Link>
  );
}
