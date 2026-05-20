export default function AdminMessageBanner({ msg }) {
  if (!msg?.text) return null;
  const cls = msg.type === "error"
    ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
    : msg.type === "info"
      ? "bg-cz-info-bg0/10 text-cz-info border-blue-500/20"
      : "bg-cz-success-bg text-cz-success border-cz-success/30";
  return (
    <div className={`mb-4 px-4 py-3 rounded-xl text-sm border ${cls}`}>
      {msg.text}
    </div>
  );
}
