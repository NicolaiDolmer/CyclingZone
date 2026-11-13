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

/** Noeglen til "slutter om N dage" / "slutter i dag"; null = intet loeb at vise. */
export function endsInKey(daysLeft: number | null): { key: string; count?: number } | null {
  if (daysLeft == null || !Number.isFinite(daysLeft)) return null;
  return daysLeft <= 0 ? { key: "lockedSalesBox.endsToday" } : { key: "lockedSalesBox.endsIn", count: daysLeft };
}
