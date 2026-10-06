// #4557 · Mål-statuspillen, udtrukket af MandateCard.jsx så overblikkets
// resumé-række og Mandat-fanens fulde kort bruger PRÆCIS samme anatomi
// (TASTE P8: "alle piller på siden har samme anatomi").
const STATUS_TONE = {
  on_track: "success",
  achieved: "success",
  at_risk: "warning",
  behind: "danger",
  failed: "danger",
};

const TONE_CLASS = {
  success: "text-cz-success bg-cz-success/8",
  warning: "text-cz-warning bg-cz-warning/8",
  danger: "text-cz-danger bg-cz-danger/8",
};

export default function StatusPill({ status, t }) {
  const tone = STATUS_TONE[status] || "warning";
  return (
    <span className={`inline-block shrink-0 rounded-cz-pill px-2.5 py-[3px] text-2xs font-semibold ${TONE_CLASS[tone]}`}>
      {t(`boardroom.status.${status}`, { defaultValue: status })}
    </span>
  );
}
