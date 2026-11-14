// #6181 · Den rene del af saelgers laaste salg (testes direkte med node --test).

export interface LockedSale {
  id: string;
  dealType: string;
  riders: Array<{ id: string; name: string }>;
  race: { id: string; name: string } | null;
  endsAt: string | null;
  daysLeft: number | null;
  amount: number;
}

export interface LockedSales {
  total: number;
  sales: LockedSale[];
}

export const NO_LOCKED_SALES: LockedSales = Object.freeze({ total: 0, sales: [] }) as LockedSales;

/** Svaret fra GET /api/me/locked-sales, renset: alt uventet bliver "intet laast". */
export function lockedSalesFromResponse(data: unknown): LockedSales {
  if (!data || typeof data !== "object") return NO_LOCKED_SALES;
  const raw = (data as { sales?: unknown }).sales;
  const sales = Array.isArray(raw)
    ? (raw as LockedSale[]).filter((s) => s && typeof s.id === "string" && Number(s.amount) > 0)
    : [];
  if (sales.length === 0) return NO_LOCKED_SALES;
  return { total: sales.reduce((sum, s) => sum + Number(s.amount), 0), sales };
}

/**
 * Noeglen, som samtidige kald deler svar paa: brugeren + saldoen. Brugeren skal med,
 * saa et brugerskift med samme saldo aldrig ser forrige holds laaste salg (Codex P1).
 */
export function lockedSalesShareKey(userId: string, refreshKey: unknown): string {
  return `${userId}:${String(refreshKey)}`;
}

/**
 * Maa et kald genbruge det delte svar? Kun samme noegle inden for vinduet. En besked
 * om et nyt laast salg eller en refusion (fresh) henter altid paa ny, ogsaa selv om
 * saldoen er den samme (lokal Codex P2).
 */
export function canReuseShared(
  shared: { key: string; at: number } | null, key: string, nowMs: number, windowMs: number, fresh: boolean,
): boolean {
  return !fresh && shared !== null && shared.key === key && nowMs - shared.at < windowMs;
}

export interface LockedSalesSnapshot {
  userId: string;
  data: LockedSales;
}

/**
 * Det, skaermen viser efter et kald. fetched = null betyder, at svaret ikke kom
 * (fejl, 429, netvaerk): saa beholdes det sidst kendte svar for samme bruger, og
 * linjen forsvinder ikke. Kun et gyldigt svar, ogsaa et tomt, aendrer visningen.
 * En ny bruger starter altid fra "intet laast".
 */
export function nextLockedSales(prev: LockedSalesSnapshot | null, userId: string, fetched: LockedSales | null): LockedSalesSnapshot {
  if (fetched) return { userId, data: fetched };
  if (prev && prev.userId === userId) return prev;
  return { userId, data: NO_LOCKED_SALES };
}

/** Noeglen til "slutter om N dage" / "slutter i dag"; null = intet loeb at vise. */
export function endsInKey(daysLeft: number | null): { key: string; count?: number } | null {
  if (daysLeft == null || !Number.isFinite(daysLeft)) return null;
  return daysLeft <= 0 ? { key: "lockedSalesBox.endsToday" } : { key: "lockedSalesBox.endsIn", count: daysLeft };
}
