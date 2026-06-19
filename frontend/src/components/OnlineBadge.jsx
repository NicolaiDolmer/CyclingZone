function timeAgo(dateStr) {
  if (!dateStr) return "aldrig";
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return "online nu";
  if (min < 60) return `${min} min siden`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}t siden`;
  const d = Math.floor(h / 24);
  return `${d}d siden`;
}

export default function OnlineBadge({ isOnline, lastSeen }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-cz-pill flex-shrink-0 ${isOnline ? "bg-cz-success" : "bg-cz-border"}`} />
      <span className={`text-xs ${isOnline ? "text-cz-success" : "text-cz-3"}`}>
        {isOnline ? "Online nu" : timeAgo(lastSeen)}
      </span>
    </span>
  );
}
