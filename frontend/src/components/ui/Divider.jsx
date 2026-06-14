export default function Divider({ label, className = "" }) {
  if (label) {
    return (
      <div role="separator" className={`flex items-center gap-3 ${className}`}>
        <span className="h-px flex-1 bg-cz-border" />
        <span className="font-data text-[11px] font-semibold uppercase tracking-[.12em] text-cz-3">
          {label}
        </span>
        <span className="h-px flex-1 bg-cz-border" />
      </div>
    );
  }
  return <hr className={`border-0 border-t border-cz-border ${className}`} />;
}
