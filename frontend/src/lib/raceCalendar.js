export function dateTextToDayOfYear(dateText) {
  if (!dateText) return Infinity;
  const m = String(dateText).match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return Infinity;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (!day || !month) return Infinity;
  return month * 32 + day;
}
