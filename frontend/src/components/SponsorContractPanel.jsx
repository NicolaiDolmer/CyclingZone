import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";

const API = import.meta.env.VITE_API_URL;

// #1663 · Read-only sponsorkontrakt-panel paa Finance-fanen. Forhandlingen sker
// paa Board-fladen (SponsorOfferModal) — her vises kun den aktive kontrakt.
// Henter selv sine data; cleanup via alive-flag saa en sen response ikke
// sætter state efter unmount.
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cz-border last:border-0">
      <p className="text-cz-2 text-xs">{label}</p>
      <p className="font-mono text-sm text-cz-1">{value}</p>
    </div>
  );
}

export default function SponsorContractPanel() {
  const { t } = useTranslation("sponsor");
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API}/api/sponsor/contract`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (alive) setContract(body.contract ?? null);
      } catch (e) {
        console.error("SponsorContractPanel load failed", e);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <div className="flex items-center gap-2" role="status" aria-label={t("contract.loading")}>
          <div className="w-4 h-4 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          <p className="text-cz-3 text-sm">{t("contract.loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-4" role="alert">
        <p className="text-cz-danger text-sm">{t("contract.error")}</p>
      </div>
    );
  }

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("contract.title")}</h2>
      {!contract ? (
        <p className="text-cz-3 text-sm">{t("contract.none")}</p>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("contract.sponsorName")}</p>
            <p className="text-cz-accent-t font-display text-2xl leading-none tracking-[.01em]">
              {contract.sponsor_name}
            </p>
          </div>
          <Row
            label={t("field.guaranteedBase")}
            value={`${formatNumber(contract.guaranteed_base)} CZ$`}
          />
          <Row
            label={t("field.perRaceDay")}
            value={`${formatNumber(contract.per_race_day_rate)} CZ$`}
          />
          <Row
            label={t("field.length")}
            value={t("field.seasons", { count: contract.length_seasons })}
          />
          <p className="text-cz-3 text-xs mt-3">
            {t("contract.runsThrough", { season: contract.expires_after_season })}
          </p>
        </>
      )}
    </div>
  );
}
