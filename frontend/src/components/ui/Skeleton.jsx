export default function Skeleton({ className = "h-4 w-full", rounded = "rounded-cz" }) {
  return <span aria-hidden="true" className={`block cz-skeleton ${rounded} ${className}`} />;
}
