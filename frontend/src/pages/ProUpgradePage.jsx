import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useSubscription } from "../lib/useSubscription";
import { useDocumentHead } from "../hooks/useDocumentHead.js";

const API = import.meta.env.VITE_API_URL;

export default function ProUpgradePage() {
  const { t } = useTranslation("pro");
  const [teamId, setTeamId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useDocumentHead({ title: t("metaTitle") });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: team } = await supabase
        .from("teams").select("id").eq("user_id", session.user.id).single();
      if (alive) setTeamId(team?.id ?? null);
    })();
    return () => { alive = false; };
  }, []);

  const { isPro, isFounder } = useSubscription(teamId);

  async function startCheckout(interval) {
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ interval }),
      });
      if (!res.ok) throw new Error("checkout failed");
      const { checkout_url } = await res.json();
      window.location.href = checkout_url; // redirect til Aluntas hostede betalingsside
    } catch {
      setErr(t("error"));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight leading-none text-cz-1">{t("title")}</h1>
      <p className="text-cz-2 mt-4 leading-relaxed">{t("subtitle")}</p>

      {isPro ? (
        <p className="mt-8 border-l-2 border-cz-accent bg-cz-subtle rounded-cz px-5 py-4 text-cz-1">
          {t("alreadyPro")}
        </p>
      ) : (
        <>
          {err && <p className="text-cz-danger text-sm mt-4">{err}</p>}
          <div className="grid sm:grid-cols-2 gap-4 mt-8">
            <button
              type="button"
              disabled={busy}
              onClick={() => startCheckout("monthly")}
              className="border border-cz-border rounded-cz p-5 text-left hover:bg-cz-subtle transition-colors disabled:opacity-50"
            >
              <div className="text-cz-3 text-xs uppercase tracking-wider">{t("monthly")}</div>
              <div className="font-data text-2xl text-cz-1 mt-1 tabular-nums">{t("monthlyPrice")}</div>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => startCheckout("semiannual")}
              className="border border-cz-accent border-t-2 rounded-cz p-5 text-left hover:bg-cz-subtle transition-colors disabled:opacity-50"
            >
              <div className="text-cz-3 text-xs uppercase tracking-wider">{t("semiannual")}</div>
              <div className="font-data text-2xl text-cz-1 mt-1 tabular-nums">{t("semiannualPrice")}</div>
              <div className="text-cz-3 text-[11px] mt-0.5">{t("semiannualNote")}</div>
            </button>
          </div>
        </>
      )}

      <p className="text-cz-3 text-xs mt-8 leading-relaxed">{t("fairnessNote")}</p>
    </div>
  );
}
