import { Link } from "react-router-dom";

// tab: åbn en bestemt tab på holdprofilen (fx "results" fra ranglisten, #824).
export default function TeamLink({ id, className = "", stopPropagation = false, tab, children }) {
  if (!id) {
    return <span className={className}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  const to = tab ? `/teams/${id}?tab=${tab}` : `/teams/${id}`;
  return (
    <Link to={to} onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}
