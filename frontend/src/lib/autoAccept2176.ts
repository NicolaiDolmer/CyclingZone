import {
  gameWallClockToUTC,
  utcToGameWallClock,
  windowHoursForWallClock,
} from "./auctionEndTime.js";
export type AuctionTiming = {
  weekday_open_hour: number;
  weekday_close_hour: number;
  weekend_open_hour: number;
  weekend_close_hour: number;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validTiming(config: unknown): config is AuctionTiming {
  if (!isRecord(config)) return false;
  return ["weekday", "weekend"].every((day) => {
    const open = config[`${day}_open_hour`];
    const close = config[`${day}_close_hour`];
    return typeof open === "number" && typeof close === "number"
      && Number.isInteger(open) && Number.isInteger(close)
      && open >= 0 && close <= 24 && open < close;
  });
}

export type AutoListing = {
  id: string;
  auto_accept_price: number;
  rider: { id: string; firstname: string; lastname: string; nationality_code?: string };
};
export function readAutoListing(value: unknown): AutoListing | null {
  if (!isRecord(value) || typeof value.id !== "string"
      || typeof value.auto_accept_price !== "number" || !validAutoBid(value.auto_accept_price, 1)
      || !isRecord(value.rider)) return null;
  const rider = value.rider;
  if (typeof rider.id !== "string" || typeof rider.firstname !== "string" || typeof rider.lastname !== "string") return null;
  return { id: value.id, auto_accept_price: value.auto_accept_price,
    rider: { id: rider.id, firstname: rider.firstname, lastname: rider.lastname,
      ...(typeof rider.nationality_code === "string" ? { nationality_code: rider.nationality_code } : {}) } };
}
export function findCounterAutoListing(rows: unknown, offer: unknown, sellerId: unknown) {
  if (isRecord(offer) && offer.auto_accept_eligible === false) return null;
  const riderId = isRecord(offer) && isRecord(offer.rider) ? offer.rider.id : null;
  if (!Array.isArray(rows) || typeof riderId !== "string" || typeof sellerId !== "string") return null;
  for (const value of rows as unknown[]) {
    const listing = readAutoListing(value);
    if (!listing || listing.rider.id !== riderId || !isRecord(value) || !isRecord(value.seller)
        || value.seller.id !== sellerId || typeof value.asking_price !== "number"
        || !Number.isInteger(value.asking_price) || value.asking_price < 0) continue;
    return { asking_price: value.asking_price, auto_accept_price: listing.auto_accept_price };
  }
  return null;
}
export function readAutoAcceptErrorBody(value: unknown): { error?: string; errorCode?: string; errorParams?: object } {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
    ...(isRecord(value.errorParams) ? { errorParams: value.errorParams } : {}),
  };
}

export function durationMinutes(hours: string, minutes: string): number | null {
  if (!/^\d+$/.test(hours) || !/^\d+$/.test(minutes)) return null;
  const h = Number(hours),
    m = Number(minutes),
    total = h * 60 + m;
  return Number.isSafeInteger(h) && m < 60 && total >= 30 && total <= 1440 ? total : null;
}
export function validAutoBid(bid: number | null, minimum: number): bid is number {
  return bid !== null && Number.isInteger(bid) && bid >= minimum && bid > 0 && bid <= 2147483647;
}
// Mirrors calculateAuctionEnd's half-open active windows. Parity tests include
// exact closing time, different weekday/weekend windows and Copenhagen DST.
export function autoAcceptEnd(now: Date, config: AuctionTiming, minutes: number): Date {
  if (!validTiming(config) || !Number.isFinite(now.getTime()))
    throw new Error("Invalid auction timing");
  let current = new Date(now),
    remaining = minutes * 60000;
  for (let i = 0; i < 14; i++) {
    const wall = utcToGameWallClock(current);
    const date = wall.slice(0, 10);
    const { openHour, closeHour } = windowHoursForWallClock(wall, config);
    const atHour = (hour: number) =>
      gameWallClockToUTC(`${date}T${String(hour).padStart(2, "0")}:00`);
    const open = atHour(openHour),
      close = atHour(closeHour);
    if (current < open) current = open;
    const next = () => {
      const [y, m, d] = date.split("-").map(Number);
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
      const nextWall = utcToGameWallClock(nextDay);
      const { openHour: nextOpen } = windowHoursForWallClock(nextWall, config);
      return gameWallClockToUTC(`${nextWall.slice(0, 10)}T${String(nextOpen).padStart(2, "0")}:00`);
    };
    if (current >= close) {
      current = next();
      continue;
    }
    const available = close.getTime() - current.getTime();
    if (remaining < available) return new Date(current.getTime() + remaining);
    remaining -= available;
    current = next();
  }
  throw new Error("Cannot calculate auction end within 14 days");
}

// Compare the precision actually shown to the player, not invisible seconds.
// Crossing a minute or active-window boundary needs another explicit click.
export function reviewAutoAcceptEnd(
  displayed: Date,
  submittedAt: Date,
  config: AuctionTiming,
  minutes: number
) {
  const end = autoAcceptEnd(submittedAt, config, minutes);
  return {
    end,
    changed: Math.floor(displayed.getTime() / 60000) !== Math.floor(end.getTime() / 60000),
  };
}
