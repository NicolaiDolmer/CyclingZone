import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";
import { Card, ArrowUpIcon } from "./ui";
import RiderLink from "./RiderLink";

const API = import.meta.env.VITE_API_URL;

// ═══ Overgangs-panelet (trin 7-udrulningen, ejer-design 18/8, #3746/#3803) ═══
// "Udviklingsvisningen er lagt om" — engangspanel på dashboardet der forklarer
// loft-omlægningen med SPILLERENS EGNE tal: rating (uændret), loft før → nu
// (hævet for de fleste) og det nye prognose-bånd. Designet bærer den målte
// virkelighed fra 17/8-overgangsmålingen (#3746-kommentaren): prognosen ligger
// LAVERE end det gamle loft-bånd for næsten alle — derfor sammenlignes loft
// med loft (grøn historie), og prognosen introduceres som NY information,
// aldrig som det gamle tals afløser.
//
// Selvstændig komponent med egen fetch (GlobalRankWidget/MaidenWinMomentCard-
// mønsteret) så DashboardPage-diffet er minimalt. Panelet er kun aktivt når
// backend-endpointet siger til (backfillen har kørt, holdet har ikke
// dismissed) — enhver fejl → render intet (dashboardet må aldrig knække på
// et forklaringskort).
export default function DevTransitionCard() {
  const { t } = useTranslation("dashboard");
  const [data, setData] = useState(null); // null = loading/inaktiv
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${API}/api/development/transition`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.active) setData(body);
      } catch { /* silent — panelet er en forklaring, ikke en funktion */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;

  const dismiss = async () => {
    setDismissing(true);
    // Optimistisk: skjul med det samme; server-persistér i baggrunden.
    setData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${API}/api/development/transition/dismiss`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    } catch { /* best-effort — panelet dukker i værste fald op igen */ }
  };

  const facts = [
    { key: "abilities", title: t("devTransition.factAbilitiesTitle"), sub: t("devTransition.factAbilitiesSub") },
    { key: "ceilings", title: t("devTransition.factCeilingsTitle"), sub: t("devTransition.factCeilingsSub", { up: data.up, total: data.total }) },
    { key: "forecast", title: t("devTransition.factForecastTitle"), sub: t("devTransition.factForecastSub") },
  ];

  return (
    <Card className="p-5 border-t-[3px] border-t-cz-accent" data-testid="dev-transition-card">
      <h2 className="font-display text-[22px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
        {t("devTransition.title")}
      </h2>
      <p className="text-[14px] text-cz-2 leading-relaxed mt-2 mb-0 max-w-[70ch]">
        {t("devTransition.intro")}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 border-y border-cz-border divide-y sm:divide-y-0 sm:divide-x divide-cz-border mt-4">
        {facts.map((f) => (
          <div key={f.key} className="py-3 sm:px-4 first:sm:ps-0 last:sm:pe-0">
            <p className="text-[13px] font-semibold text-cz-1 m-0">{f.title}</p>
            <p className="text-2xs text-cz-3 m-0 mt-0.5">{f.sub}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto mt-1">
        <table data-sort-exempt="Engangs-forklaringspanel; faa raekker, rating-sorteret server-side" className="w-full text-[13px] border-collapse min-w-[480px]">
          <thead>
            <tr className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3 text-left">
              <th className="py-2 pe-3 font-semibold">{t("devTransition.colRider")}</th>
              <th className="py-2 px-2 text-right font-semibold">{t("devTransition.colRating")}</th>
              <th className="py-2 px-2 text-right font-semibold">{t("devTransition.colCeilBefore")}</th>
              <th className="py-2 px-2 text-right font-semibold">{t("devTransition.colCeilNow")}</th>
              <th className="py-2 ps-2 text-right font-semibold">{t("devTransition.colForecast")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const lifted = r.loftFoer != null && r.loftNu != null && r.loftNu > r.loftFoer;
              const lowered = r.loftFoer != null && r.loftNu != null && r.loftNu < r.loftFoer;
              return (
                <tr key={r.riderId} className="border-t border-cz-border">
                  <td className="py-1.5 pe-3">
                    <RiderLink id={r.riderId} className="text-cz-1 font-medium hover:underline">
                      {r.name}
                    </RiderLink>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-cz-2">{r.rating ?? "—"}</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-cz-3">{r.loftFoer ?? "—"}</td>
                  <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${lifted ? "text-cz-success" : lowered ? "text-cz-2" : "text-cz-2"}`}>
                    <span className="inline-flex items-center justify-end gap-0.5">
                      {r.loftNu ?? "—"}
                      {lifted && <ArrowUpIcon size={10} aria-hidden="true" />}
                    </span>
                  </td>
                  <td className="py-1.5 ps-2 text-right font-mono tabular-nums text-cz-1 font-semibold">
                    {r.prog ? `${r.prog.lo}–${r.prog.hi}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.down > 0 && (
        <p className="text-2xs text-cz-3 mt-2 mb-0">{t("devTransition.loweredNote")}</p>
      )}

      <div className="flex items-center justify-between gap-3 mt-4">
        <Link to="/help" className="text-[13px] text-cz-accent-t hover:underline">
          {t("devTransition.helpLink")}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          disabled={dismissing}
          className="px-5 py-2 rounded-cz border border-cz-border text-cz-1 text-[14px] font-bold hover:bg-cz-subtle transition-colors disabled:opacity-60"
          data-testid="dev-transition-dismiss"
        >
          {t("devTransition.dismiss")}
        </button>
      </div>
    </Card>
  );
}
