// #6181 · Saelgers laaste salgspenge (ejerens udgave A, 13/11).
//
// Saldoen er det, holdet kan bruge. Under den staar "+X CZ$ laast" (menuen,
// dashboardets saldokort og Oekonomis saldokort), og Oekonomi viser boksen
// "Laast til holdskifte" med een linje pr. laast salg: rytter, loeb, hvor laenge
// loebet har tilbage, beloeb og "Udbetales, naar rytteren skifter hold".
//
// Data kommer fra GET /api/me/locked-sales (eget hold, sale_escrows med status
// 'held'). Ingen laaste salg = intet renderes, saa siden er uaendret, saa laenge
// kontakten sale_escrow_enabled er slukket og intet er laast.
//
// TASTE: hairline-Card, ingen guld, tabulaere tal, rytter- og loebsnavne er links (P12).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../ui/Card.jsx";
import RiderLink from "../RiderLink.jsx";
import RaceLink from "../RaceLink.jsx";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { formatNumber } from "../../lib/intl.js";

const API = import.meta.env.VITE_API_URL;

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

/** Svaret fra serveren, renset: alt uventet bliver "intet laast". */
export function lockedSalesFromResponse(data: unknown): LockedSales {
  if (!data || typeof data !== "object") return NO_LOCKED_SALES;
  const raw = (data as { sales?: unknown }).sales;
  const sales = Array.isArray(raw)
    ? (raw as LockedSale[]).filter((s) => s && typeof s.id === "string" && Number(s.amount) > 0)
    : [];
  if (sales.length === 0) return NO_LOCKED_SALES;
  return { total: sales.reduce((sum, s) => sum + Number(s.amount), 0), sales };
}

// Menuen og siden spoerger samtidig; eet kald pr. saldo-vaerdi deles. En ny saldo
// (fx efter en udbetaling) henter igen.
let shared: { key: unknown; promise: Promise<LockedSales> } | null = null;

async function fetchLockedSales(): Promise<LockedSales> {
  try {
    const headers = await authHeaders({ json: false });
    if (!headers) return NO_LOCKED_SALES;
    const res = await apiFetch(`${API}/api/me/locked-sales`, { headers });
    return res.ok ? lockedSalesFromResponse(res.data) : NO_LOCKED_SALES;
  } catch {
    // non-critical: uden svar vises intet ekstra, og saldoen staar som foer.
    return NO_LOCKED_SALES;
  }
}

function loadLockedSales(key: unknown): Promise<LockedSales> {
  if (shared && shared.key === key) return shared.promise;
  const promise = fetchLockedSales().then((result) => {
    // Et tomt svar efter en fejl maa ikke sidde fast i den delte cache.
    if (result === NO_LOCKED_SALES && shared?.promise === promise) shared = null;
    return result;
  });
  shared = { key, promise };
  return promise;
}

/** @param refreshKey  saldoen (eller andet), der skal udloese et nyt opslag naar den aendrer sig */
export function useLockedSales(refreshKey: unknown): LockedSales {
  const [state, setState] = useState<LockedSales>(NO_LOCKED_SALES);
  useEffect(() => {
    if (refreshKey == null) return undefined;
    let cancelled = false;
    void loadLockedSales(refreshKey).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);
  return state;
}

/** "+X CZ$ laast" under en saldo. Intet laast = intet renderes. */
export function LockedSalesLine({ refreshKey, className = "" }: { refreshKey: unknown; className?: string }) {
  const { t } = useTranslation("finance");
  const { total } = useLockedSales(refreshKey);
  if (total <= 0) return null;
  return (
    <p className={`font-mono tabular-nums ${className}`} data-testid="locked-sales-line">
      {t("balance.lockedSales", { value: formatNumber(total) })}
    </p>
  );
}

function endsText(t: (key: string, opts?: Record<string, unknown>) => string, daysLeft: number | null): string | null {
  if (daysLeft == null) return null;
  return daysLeft <= 0 ? t("lockedSalesBox.endsToday") : t("lockedSalesBox.endsIn", { count: daysLeft });
}

/** Oekonomis boks: een linje pr. laast salg. */
export function LockedSaleEscrowsList({ data }: { data: LockedSales }) {
  const { t } = useTranslation("finance");
  if (data.total <= 0) return null;
  return (
    <Card className="p-0 mb-4" data-testid="locked-sales-box">
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3 border-b border-cz-border">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{t("lockedSalesBox.heading")}</p>
        <p className="font-mono tabular-nums text-cz-2 text-sm">{formatNumber(data.total)} CZ$</p>
      </div>
      <ul>
        {data.sales.map((sale, i) => {
          const ends = endsText(t, sale.daysLeft);
          return (
            <li
              key={sale.id}
              className={`px-4 py-2.5 flex items-baseline gap-3 ${i > 0 ? "border-t border-cz-border" : ""}`}
            >
              <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
                <span className="block sm:inline text-cz-1 text-sm font-medium">
                  {sale.riders.map((r, ri) => (
                    <span key={r.id}>
                      {ri > 0 ? ", " : null}
                      <RiderLink id={r.id} className="hover:text-cz-accent-t">{r.name}</RiderLink>
                    </span>
                  ))}
                </span>
                {(sale.race || ends) && (
                  <span className="block sm:inline text-cz-3 text-xs">
                    {sale.race ? <RaceLink id={sale.race.id} className="hover:text-cz-accent-t">{sale.race.name}</RaceLink> : null}
                    {sale.race && ends ? " · " : null}
                    {ends}
                  </span>
                )}
                <span className="block sm:inline sm:ms-auto text-cz-3 text-xs">{t("lockedSalesBox.payout")}</span>
              </div>
              <span className="shrink-0 font-mono tabular-nums text-cz-1 text-sm">{formatNumber(sale.amount)} CZ$</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function LockedSaleEscrows({ refreshKey }: { refreshKey: unknown }) {
  const data = useLockedSales(refreshKey);
  return <LockedSaleEscrowsList data={data} />;
}
