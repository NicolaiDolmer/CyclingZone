// #7251 (ejer 26/10, valg A): tilbagekøbsret øverst på Kontrakter-fanen.
//
// Ryttere frigivet ved S4→S5 UDEN kontraktvarsel (#7246) kan i 7 dage gen-signes af
// deres tidligere hold til normal løn, 1 sæson, uden signing fee. Panelet vises kun,
// når holdet har kandidater; listen og reglerne kommer fra backenden
// (GET /api/contracts/buyback). Knappen er secondary: fanens gold primary er
// "Forlæng N kontrakter" (én gold pr. view).
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "../squad/squadUi.ts";
import { Button as ButtonJs } from "../ui/index.js";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { formatNumber } from "../../lib/intl";
import { intlLocale } from "../../lib/intlLocale.ts";

const API = import.meta.env.VITE_API_URL;
const Button = ButtonJs as unknown as (p: { variant?: string; size?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode; "aria-label"?: string }) => ReactNode;

type Candidate = {
  id: string; firstname: string | null; lastname: string | null; squad: string | null;
  salary: number; deadline: string; blocked: string | null;
};

export default function BuybackPanel({ onSigned }: { onSigned?: () => void }) {
  const { t, i18n } = useTranslation(["team"]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch(`${API}/api/contracts/buyback`, { headers });
    if (res.ok) setCandidates(((res.data as { candidates?: Candidate[] })?.candidates) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sign = async (c: Candidate) => {
    setBusyId(c.id);
    setMessage(null);
    const headers = await authHeaders();
    const res = headers ? await apiFetch(`${API}/api/contracts/buyback/${c.id}`, { method: "POST", headers }) : null;
    setBusyId(null);
    if (res?.ok) {
      setMessage(t("contracts.buyback.done", { name: `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() }));
      await load();
      onSigned?.();
    } else {
      const code = (res?.data as { error?: string } | undefined)?.error ?? "buyback_failed";
      setMessage(t(`contracts.buyback.errors.${code}`, { defaultValue: t("contracts.buyback.errors.buyback_failed") }));
    }
  };

  if (candidates.length === 0) return null;
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(intlLocale(i18n.language), { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" }).format(new Date(iso));

  const columns: DataTableColumn<Candidate>[] = [
    { key: "rider", header: t("squad.headers.rider"), render: (c) => `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() },
    { key: "squad", header: t("contracts.buyback.squad"), render: (c) => t(`contracts.buyback.squads.${c.squad ?? "senior"}`, { defaultValue: c.squad ?? "" }) },
    { key: "salary", header: t("contracts.headers.salary"), numeric: true, render: (c) => <span className="tabular-nums">{formatNumber(c.salary)}</span> },
    { key: "deadline", header: t("contracts.buyback.deadline"), numeric: true, render: (c) => <span className="tabular-nums">{fmtDate(c.deadline)}</span> },
    {
      key: "action", header: "", render: (c) => c.blocked
        ? <span className="text-cz-3 text-[12px]">{t(`contracts.buyback.errors.${c.blocked}`, { defaultValue: "" })}</span>
        : <Button variant="secondary" size="sm" disabled={busyId !== null} onClick={() => void sign(c)} aria-label={t("contracts.buyback.signAria", { name: `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() })}>{t("contracts.buyback.sign")}</Button>,
    },
  ];

  return (
    <section className="mb-[14px]" data-testid="contracts-buyback">
      <p className="text-[13px] text-cz-2 mb-[8px]">{t("contracts.buyback.intro")}</p>
      <DataTable label={t("contracts.buyback.title")} columns={columns} rows={candidates} rowKey={(c) => c.id} dense mobileDefaults={["salary", "action"]} />
      {message && <p className="text-[13px] mt-[6px]" role="status">{message}</p>}
    </section>
  );
}
