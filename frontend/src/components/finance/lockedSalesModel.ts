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

/**
 * Samler mange anmodninger i traek (dommerens B1): hoejst eet kald ad gangen plus eet
 * efterfoelgende. Kommer der anmodninger, mens et kald koerer, starter praecis eet nyt
 * kald, naar det er faerdigt, med den seneste anmodnings argument. Saa henter en ny
 * besked altid paa ny (kaldet starter efter beskeden), men en byge af beskeder og
 * flere steder paa skaermen giver tilsammen hoejst to kald. Kaster aldrig.
 */
export function coalesceLatest<A>(run: (arg: A) => Promise<void>): (arg: A) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let queuedArg: A;
  const start = (arg: A): Promise<void> => {
    const p: Promise<void> = Promise.resolve()
      .then(() => run(arg))
      .catch(() => { /* non-critical: kalderen haandterer selv fejl; koeen maa aldrig sidde fast */ })
      .then(() => { if (inFlight === p) inFlight = null; });
    inFlight = p;
    return p;
  };
  return (arg: A) => {
    if (!inFlight) return start(arg);
    queuedArg = arg;
    if (!queued) {
      queued = inFlight.then(() => {
        queued = null;
        return start(queuedArg);
      });
    }
    return queued;
  };
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
