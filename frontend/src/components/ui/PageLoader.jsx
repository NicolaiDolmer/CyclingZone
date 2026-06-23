// Full-section loading state with reserved height. Replaces the inline
// `<div className="flex justify-center py-16">…spinner…</div>` pattern that used
// to sit on ~25 pages: that container was only ~96px tall, so when async data
// arrived the real layout (hundreds of px) pushed everything down — the main
// driver of the app-wide CLS=0.83 measured in Clarity (#1794). Reserving height
// up front keeps the spinner→content swap shift-free.
export default function PageLoader({ label = "Loading", minHeight = "60vh", className = "" }) {
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{ minHeight }}
      role="status"
      aria-label={label}
    >
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );
}
