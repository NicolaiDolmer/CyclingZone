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
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import Card from "../ui/Card.jsx";
import RiderLink from "../RiderLink.jsx";
import RaceLink from "../RaceLink.jsx";
import { authHeaders, supabase } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { formatNumber } from "../../lib/intl.js";
import {
  NO_LOCKED_SALES, canReuseShared, coalesceLatest, endsInKey, lockedSalesFromResponse, lockedSalesShareKey, nextLockedSales,
  type LockedSales, type LockedSalesSnapshot,
} from "./lockedSalesModel.ts";

const API = import.meta.env.VITE_API_URL;

// Menuen, dashboardet og Oekonomi viser altid samme svar: hvert svar gaar til alle
// steder paa skaermen. Kald, der starter inden for et kort vindue, deles (aldrig en
// gammel liste). Noeglen er brugeren + saldoen, saa et brugerskift aldrig ser et
// andet holds salg.
const SHARE_WINDOW_MS = 5000;
/** Sendes, naar et salg kan vaere laast eller afregnet uden at saldoen aendrer sig (fx en ny besked). */
export const LOCKED_SALES_REFRESH_EVENT = "cz:locked-sales-refresh";
let shared: { key: string; at: number; promise: Promise<LockedSales | null> } | null = null;
let latest: LockedSalesSnapshot | null = null;
const listeners = new Set<(data: LockedSales) => void>();

/** null = intet gyldigt svar (fejl, 429, netvaerk); saa beholdes det sidst kendte. */
async function fetchLockedSales(headers: Record<string, string>): Promise<LockedSales | null> {
  try {
    const res = await apiFetch(`${API}/api/me/locked-sales`, { headers });
    return res.ok ? lockedSalesFromResponse(res.data) : null;
  } catch {
    // non-critical: uden svar staar det sidst kendte, og saldoen staar som foer.
    return null;
  }
}

// Kun det nyeste kald maa vise sit svar: et forsinket svar fra et aeldre kald (fx en
// bruger, der lige er logget ud) maa aldrig overskrive det nyere (lokal Codex P1).
let generation = 0;

async function loadLockedSales(refreshKey: unknown, { fresh = false }: { fresh?: boolean } = {}): Promise<void> {
  const [{ data }, headers] = await Promise.all([supabase.auth.getSession(), authHeaders({ json: false })]);
  const userId = data.session?.user?.id;
  if (!userId || !headers) return;
  const key = lockedSalesShareKey(userId, refreshKey);
  const now = Date.now();
  const entry = shared && canReuseShared(shared, key, now, SHARE_WINDOW_MS, fresh)
    ? shared
    : { key, at: now, promise: fetchLockedSales(headers) };
  shared = entry;
  const gen = ++generation;
  const fetched = await entry.promise;
  if (gen !== generation) return;
  const { data: current } = await supabase.auth.getSession();
  if (gen !== generation || current.session?.user?.id !== userId) return;
  latest = nextLockedSales(latest, userId, fetched);
  for (const listener of listeners) listener(latest.data);
}

// En ny besked henter altid paa ny, men samlet for hele skaermen: en byge af beskeder
// og flere steder paa skaermen giver hoejst eet kald ad gangen plus eet efterfoelgende
// (dommerens B1; ruten deler loft med mange andre laeseveje).
const refreshFreshShared = coalesceLatest((refreshKey: unknown) => loadLockedSales(refreshKey, { fresh: true }));

/**
 * @param refreshKey  saldoen; en ny saldo (fx efter en udbetaling) henter igen. Et nyt
 *   laast salg eller en refusion aendrer ikke saelgerens saldo, saa listen hentes ogsaa
 *   ved hvert sideskift, naar fanen faar fokus, og naar en ny besked ankommer.
 */
export function useLockedSales(refreshKey: unknown): LockedSales {
  const [state, setState] = useState<LockedSales>(NO_LOCKED_SALES);
  const { pathname } = useLocation();
  useEffect(() => {
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);
  useEffect(() => {
    if (refreshKey == null) return undefined;
    const refresh = () => { void loadLockedSales(refreshKey); };
    // En ny besked kan betyde et nyt laast salg eller en refusion: hent altid paa ny.
    const refreshFresh = () => { void refreshFreshShared(refreshKey); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(LOCKED_SALES_REFRESH_EVENT, refreshFresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(LOCKED_SALES_REFRESH_EVENT, refreshFresh);
    };
  }, [refreshKey, pathname]);
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
  const ends = endsInKey(daysLeft);
  if (!ends) return null;
  return ends.count == null ? t(ends.key) : t(ends.key, { count: ends.count });
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
                    {sale.race ? <RaceLink id={sale.race.id} stage={undefined} state={undefined} className="hover:text-cz-accent-t">{sale.race.name}</RaceLink> : null}
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
