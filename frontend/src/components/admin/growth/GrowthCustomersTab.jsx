import { useCallback, useEffect, useState } from "react";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../shared/useAdminAuth";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import { Table, Tr, Th, Td } from "../../ui/Table";
import PageLoader from "../../ui/PageLoader";
import EmptyState from "../../ui/EmptyState";
import ErrorState from "../../ui/ErrorState";
import { RefreshIcon, StarIcon } from "../../ui/icons";

// "Kunder & LTV"-fanen (#3196): "Jeg vil gerne ... se livstidsværdi på
// kunderne. Samt at jeg kan se hvor mange aktive kunder vi har." Data via
// GET /api/admin/growth/customers (subscriptions + teams, service_role — se
// backend/routes/api.js).
//
// #4636: `customers` er kun rækker med betalingsspor. Rækker der kun bærer en
// vilkårsaccept (checkout startet, aldrig betalt) kommer separat som
// `checkout_started` og vises som funnel-tal, ikke som kunder.
const API = import.meta.env.VITE_API_URL;

function fmtNumber(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("da-DK").format(n);
}

function fmtCents(cents) {
  if (cents == null) return "—";
  return `${new Intl.NumberFormat("da-DK").format(Math.round(cents / 100))} kr`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABELS = { active: "Aktiv", cancelled: "Opsagt", past_due: "Forfalden", inactive: "Inaktiv" };
const PLAN_LABELS = { monthly: "Månedlig", semiannual: "Halvårlig" };

function KpiCard({ label, value, sub }) {
  return (
    <Card className="p-4">
      <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-cz-1 text-2xl font-bold font-data tabular-nums mt-1">{value}</p>
      {sub && <p className="text-cz-3 text-xs mt-1">{sub}</p>}
    </Card>
  );
}

export default function GrowthCustomersTab() {
  const { getAuth } = useAdminAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      const res = await fetch(`${API}/api/admin/growth/customers`, { headers: auth });
      const json = await readAdminJson(res);
      if (res.ok) setData(json);
      else setError(adminErrorMessage(json, res));
    } catch (e) {
      setError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
  }, [getAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const customers = data?.customers ?? [];
  const checkoutStarted = data?.checkout_started ?? [];
  const summary = data?.summary ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-cz-3 text-sm">
          Betalende kunder + estimeret livstidsværdi pr. kunde + konverteringsrate. LTV er et ESTIMAT
          (ingen faktura-historik findes — se tooltip på tabellen). Vilkårsaccept uden betaling tæller ikke som kunde.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadData}
          loading={loading}
          iconLeft={<RefreshIcon size={14} aria-hidden="true" />}
        >
          Genindlæs
        </Button>
      </div>

      {error && (
        <ErrorState
          title="Kunne ikke hente kunde-data"
          description={error === "Admin only" ? "403 — du er ikke admin." : error}
          action={<Button variant="secondary" size="sm" onClick={loadData}>Prøv igen</Button>}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Aktive kunder" value={fmtNumber(summary.active_customers)} />
        <KpiCard label="Kunder i alt (har betalt)" value={fmtNumber(summary.total_customers)} />
        <KpiCard label="LTV i alt (estimeret)" value={fmtCents(summary.ltv_total_cents)} />
        <KpiCard label="LTV pr. kunde (gns.)" value={fmtCents(summary.ltv_avg_cents)} />
        <KpiCard
          label="Konvertering"
          value={summary.conversion_pct != null ? `${summary.conversion_pct}%` : "—"}
          sub={`${fmtNumber(summary.total_customers)} af ${fmtNumber(summary.total_registered)} registrerede`}
        />
        <KpiCard
          label="Startede checkout, betalte ikke"
          value={fmtNumber(summary.checkout_started_unpaid)}
          sub="Accepterede vilkår, ingen betaling"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-cz-border">
          <p className="text-cz-3 text-xs uppercase tracking-wide">Kunder, sorteret efter estimeret LTV</p>
        </div>
        <Table data-sort-exempt="LTV-sorteret, server-ordnet">
          <thead>
            <Tr>
              <Th>Hold</Th>
              <Th>Status</Th>
              <Th>Plan</Th>
              <Th numeric>LTV (estimeret)</Th>
              <Th>Dækket til</Th>
              <Th>Kunde siden</Th>
            </Tr>
          </thead>
          <tbody>
            {loading && (
              <Tr>
                <Td colSpan={6} className="py-8">
                  <PageLoader label="Henter kunder" minHeight="80px" />
                </Td>
              </Tr>
            )}
            {!loading && customers.length === 0 && (
              <Tr>
                <Td colSpan={6} className="py-4">
                  <EmptyState title="Ingen betalende kunder endnu" description="Betalende kunder vises her, når det første CZ Pro-abonnement er gennemført." />
                </Td>
              </Tr>
            )}
            {!loading && customers.map(c => (
              <Tr key={c.team_id}>
                <Td className="max-w-[180px] truncate" title={c.team_name || ""}>
                  {c.team_name || "—"}
                  {c.is_founder && (
                    <span title="Founder (blandt de første 50 betalende)" className="inline-flex ms-1.5 align-middle text-cz-accent-t">
                      <StarIcon size={12} aria-hidden="true" />
                    </span>
                  )}
                </Td>
                <Td>
                  <span className={c.is_active ? "text-cz-success" : "text-cz-3"}>
                    {STATUS_LABELS[c.status] || c.status}
                  </span>
                </Td>
                <Td>{PLAN_LABELS[c.plan_interval] || c.plan_interval || "—"}</Td>
                <Td numeric className="font-data tabular-nums" title="Estimat: dækkede perioder × periodepris — ingen faktura-historik findes i dag">
                  {fmtCents(c.ltv_cents)}
                </Td>
                <Td className="text-cz-3 text-xs whitespace-nowrap">{fmtDate(c.current_period_end)}</Td>
                <Td className="text-cz-3 text-xs whitespace-nowrap">{fmtDate(c.created_at)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {!loading && checkoutStarted.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-cz-border">
            <p className="text-cz-3 text-xs uppercase tracking-wide">Startede checkout, betalte ikke</p>
          </div>
          <Table data-sort-exempt="nyeste først, server-ordnet">
            <thead>
              <Tr>
                <Th>Hold</Th>
                <Th>Accepterede vilkår</Th>
              </Tr>
            </thead>
            <tbody>
              {checkoutStarted.map(c => (
                <Tr key={c.team_id}>
                  <Td className="max-w-[180px] truncate" title={c.team_name || ""}>{c.team_name || "—"}</Td>
                  <Td className="text-cz-3 text-xs whitespace-nowrap">{fmtDateTime(c.terms_accepted_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
