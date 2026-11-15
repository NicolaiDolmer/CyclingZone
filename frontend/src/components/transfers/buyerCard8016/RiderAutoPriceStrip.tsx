import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../../lib/supabase.ts";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { formatCz } from "../../../lib/marketValues.js";
import { ChevronRightIcon } from "../../ui/icons/index.jsx";
import {
  sharedRequestCache,
  SHARED_TTL_MS,
  transferListingsKeyForHeaders2176,
} from "../../../lib/sharedRequestCache.js";

const API = import.meta.env.VITE_API_URL;

// #8016 (Discord-fund 12/11: "auto-accept price not visible on rider page"):
// ryttersiden viste kun udbudsprisen. Auto-prisen kan ikke laeses direkte fra
// transfer_listings (kolonnen er lukket for klienter); serveren projicerer den i
// GET /api/transfers, og kun for en spiller med auto_accept_enabled. Derfor
// samme delte, kortlivede kopi som saelgerens knap paa samme side (#5089).
// Ingen auto-pris i svaret = ingen stribe, saa spillere uden kontakten ser
// siden uaendret. Udbudsprisen staar allerede i heroens "Til salg"-bjaelke og
// gentages ikke her.
function readAutoPrice(rows: unknown, riderId: string): number | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows as Array<Record<string, unknown>>) {
    const rider = row?.rider as { id?: unknown } | null | undefined;
    if (rider?.id !== riderId) continue;
    const price = Number(row.auto_accept_price);
    return Number.isInteger(price) && price > 0 ? price : null;
  }
  return null;
}

export default function RiderAutoPriceStrip({ riderId }: { riderId: string | undefined }) {
  const { t, ready } = useTranslation("transfers");
  const [autoPrice, setAutoPrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAutoPrice(null);
    if (!riderId) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const rows = await sharedRequestCache.get(
          await transferListingsKeyForHeaders2176(headers),
          async () => {
            // catch-ok: bobler ud til effektens egen try/catch nedenfor.
            const res = await apiFetch(`${API}/api/transfers`, { headers }); // catch-ok
            if (!res.ok) throw new Error("transfer_listings_failed");
            return res.data;
          },
          SHARED_TTL_MS.transferListings,
        );
        if (!cancelled) setAutoPrice(readAutoPrice(rows, riderId));
      } catch {
        /* bevidst stille: uden svar vises ingen stribe, siden virker som foer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [riderId]);

  if (!ready || autoPrice === null) return null;
  return (
    <div
      className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-3 py-2.5"
      data-testid="rider-auto-price"
    >
      <div>
        <p className="text-2xs uppercase tracking-[.06em] text-cz-3">{t("autoAccept.autoPrice")}</p>
        <p className="font-data text-xl font-bold tabular-nums text-cz-1">{formatCz(autoPrice)}</p>
      </div>
      <div className="min-w-48 flex-1 space-y-1 text-xs text-cz-2">
        <p>{t("buyerCard.riderText", { price: formatCz(autoPrice) })}</p>
        <Link to="/transfers?tab=market" className="inline-flex min-h-11 items-center gap-1 font-semibold text-cz-accent-t sm:min-h-0">
          {t("buyerCard.riderLink")}
          <ChevronRightIcon size={13} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
