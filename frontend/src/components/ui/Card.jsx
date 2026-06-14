export default function Card({ interactive = false, className = "", children, ...rest }) {
  const base = "rounded-cz border border-cz-border bg-cz-card";
  const hover = interactive ? "transition-colors duration-150 hover:border-cz-3" : "";
  return (
    <div className={`${base} ${hover} ${className}`} {...rest}>
      {children}
    </div>
  );
}
