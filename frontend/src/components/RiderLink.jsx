import { Link } from "react-router-dom";

export default function RiderLink({ id, className = "", stopPropagation = false, children, ...rest }) {
  if (!id) {
    return <span className={className} {...rest}>{children}</span>;
  }
  const handleClick = stopPropagation ? (e) => e.stopPropagation() : undefined;
  return (
    <Link to={`/riders/${id}`} onClick={handleClick} className={className} {...rest}>
      {children}
    </Link>
  );
}
