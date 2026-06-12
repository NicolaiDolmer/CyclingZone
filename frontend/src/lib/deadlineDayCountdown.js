export function formatDeadlineDayCountdown(secs, t) {
  if (secs == null || secs <= 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = value => String(value).padStart(2, "0");

  if (h > 0) {
    return t("deadlineDayBanner.countdownHours", {
      h,
      m: pad(m),
      s: pad(s),
    });
  }
  return `${pad(m)}:${pad(s)}`;
}
