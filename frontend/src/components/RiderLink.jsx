import { Link } from "react-router-dom";

export default function RiderLink({ id, className = "", stopPropagation = false, children }) {
  if (!id) {
    return <span className={className}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  return (
    <Link to={`/riders/${id}`} onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}
