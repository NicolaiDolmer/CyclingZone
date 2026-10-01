export interface MatrixDayColumn {
  key: string;
  raceId: string;
  gameDay: number;
  stageIndex: number;
}

const MOBILE_DAYS = 3;

export function shiftMobileRaceWindow(start: number, direction: -1 | 1, total: number): number {
  return Math.max(0, Math.min(Math.max(0, total - MOBILE_DAYS), start + direction));
}

export function mobileRaceWindow(
  columns: readonly MatrixDayColumn[],
  raceId: string | null | undefined,
  requestedStart: number,
) {
  const raceDays = columns.filter((column) => column.raceId === raceId);
  const total = raceDays.length;
  const start = Math.max(0, Math.min(Math.max(0, total - MOBILE_DAYS), requestedStart));
  return {
    days: raceDays.slice(start, start + MOBILE_DAYS),
    start,
    total,
    canEarlier: start > 0,
    canLater: start + MOBILE_DAYS < total,
  };
}
