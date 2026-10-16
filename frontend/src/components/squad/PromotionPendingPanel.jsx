// #6710 (plan-PR 1 i #5833): "Afventer oprykning" på trupsiden.
//
// En rytter hvis næste trup var fuld ved graduering, bliver stående i sin
// nuværende trup (klub + kontrakt uændret) i stedet for at blive solgt. Her ser
// manageren hvem det gælder, og rykker dem op med "Ryk op", når der er plads.
// Backenden ejer reglerne (promotionPendingAction.js → moveRider); panelet viser
// kun svaret. Flag off eller ingen ventende ryttere → panelet renderer intet.
//
// TASTE: hairline-Section, ingen guld (rækkeknapper er altid secondary),
// stroke-ikon, én linje kontekst.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import RiderLink from "../RiderLink";
import { Button, Section, SectionHeader, ArrowUpIcon } from "../ui";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { promotionErrorKey, pendingRidersFromResponse } from "./promotionPendingModel.js";

const API = import.meta.env.VITE_API_URL;

export default function PromotionPendingPanel({ onPromoted }) {
  const { t } = useTranslation("team");
  const [riders, setRiders] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null); // { tone: "success"|"danger", text }

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders({ json: false });
      if (!headers) return;
      const res = await apiFetch(`${API}/api/team/promotion-pending`, { headers });
      setRiders(pendingRidersFromResponse(res));
    } catch {
      // non-critical: panelet forbliver skjult, truppen virker som før.
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function promote(rider) {
    setBusyId(rider.id);
    setNotice(null);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await apiFetch(`${API}/api/riders/${rider.id}/promote-pending`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setNotice({ tone: "success", text: t("promotionPending.promoted", { name: `${rider.firstname} ${rider.lastname}` }) });
        await load();
        onPromoted?.();
      } else {
        setNotice({ tone: "danger", text: t(promotionErrorKey(res.data?.errorCode)) });
      }
    } catch {
      setNotice({ tone: "danger", text: t("promotionPending.error.generic") });
    } finally {
      setBusyId(null);
    }
  }

  if (riders.length === 0 && !notice) return null;

  return (
    <Section className="mb-5" data-testid="promotion-pending-panel">
      <SectionHeader title={t("promotionPending.title")} meta={riders.length > 0 ? String(riders.length) : null} />
      {riders.length > 0 && <p className="-mt-2 mb-3 text-xs text-cz-3">{t("promotionPending.hint")}</p>}
      {riders.length > 0 && (
        <ul className="divide-y divide-cz-border">
          {riders.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <RiderLink id={r.id} className="block truncate text-sm font-medium text-cz-1 hover:text-cz-accent-t">
                  {r.firstname} {r.lastname}
                </RiderLink>
                <span className="text-2xs text-cz-3">{t(`promotionPending.waitingFor.${r.to}`)}</span>
              </div>
              {r.canPromote ? (
                <Button variant="secondary" size="sm" disabled={busyId !== null} onClick={() => promote(r)}
                  data-testid="promotion-pending-promote">
                  <ArrowUpIcon size={14} aria-hidden="true" />
                  {t("promotionPending.promote")}
                </Button>
              ) : (
                <span className="shrink-0 text-2xs text-cz-3">{t("promotionPending.noRoom")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p role="status" className={`mt-2 text-xs ${notice.tone === "success" ? "text-cz-success" : "text-cz-danger"}`}>
          {notice.text}
        </p>
      )}
    </Section>
  );
}
