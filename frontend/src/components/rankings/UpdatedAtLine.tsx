// #7664: lille, daempet "Opdateret kl."-tekst paa ranglisten. Vises KUN naar
// backenden laeser de nye tabeller (kontakten ranking_shadow_decoupled_6765
// taendt). Slukket svarer /api/rankings/freshness med source "legacy", og
// linjen tegner intet, saa siden er praecis som i dag. En fejl giver ogsaa
// ingen linje: tidspunktet er en hjaelp, ikke en forudsaetning.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../lib/supabase";
import { formatLocalTime } from "../../lib/intl";

type Freshness = { source?: unknown; current_as_of?: unknown } | null;

/** Tidsstemplet linjen skal vise, eller null naar der ingen linje skal vaere. */
export function updatedAtFromFreshness(body: Freshness): string | null {
  if (!body || body.source !== "shadow" || typeof body.current_as_of !== "string") return null;
  return Number.isNaN(Date.parse(body.current_as_of)) ? null : body.current_as_of;
}

export default function UpdatedAtLine({ className = "" }: { className?: string }) {
  const { t } = useTranslation("riders");
  const [at, setAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders({ json: false });
        if (!headers) return;
        const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/rankings/freshness`, { headers });
        if (!response.ok) return;
        const value = updatedAtFromFreshness(await response.json() as Freshness);
        if (!cancelled) setAt(value);
      } catch {
        // catch-ok: uden svar vises ingen linje (samme som slukket kontakt).
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!at) return null;
  // Inline i sidens meta-linje (saeson · antal), samme daempede trin som
  // "Afsluttet saeson"-noten. Ingen banner, ingen ny linje.
  return (
    <span className={`ms-2 text-cz-3 tabular-nums ${className}`}>
      · {t("rankings.updatedAt", { time: formatLocalTime(at) })}
    </span>
  );
}
