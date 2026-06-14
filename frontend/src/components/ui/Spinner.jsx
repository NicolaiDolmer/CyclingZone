export default function Spinner({ size = 20, className = "" }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`spinner inline-block animate-spin rounded-cz-pill border-2 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
