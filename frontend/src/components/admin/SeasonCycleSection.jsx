import { useEffect, useState } from "react";
import { formatCz } from "../../lib/marketValues";

const API = import.meta.env.VITE_API_URL;

/**
 * Slice 08 — Sæson-cyklus
 * AdminPage-sektion der lader admin udføre sæson-skifte (luk sæson X,
 * åbn sæson X+1, udbetal sponsor til alle managers, log i admin_log).
 *
 * Flow:
 *   1. Mount → fetch preview (GET /api/admin/season-transition/preview)
 *   2. Admin ser plan: hvilken sæson lukkes, hvilken oprettes, antal hold,
 *      total sponsor-payout
 *   3. Knap "Udfør" → confirm-dialog → POST /api/admin/season-transition
 *   4. Result vises med per-fase-log
 */
export default function SeasonCycleSection({ getAuth, onMsg }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  async function fetchPreview() {
    setLoading(true);
    setResult(null);
    try {
      const auth = await getAuth();
      const res = await fetch(`${API}/api/admin/season-transition/preview`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente forhåndsvisning");
      setPreview(data.plan);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function executeTransition() {
    if (!preview) return;
    const confirmText =
      `Du er ved at lukke sæson ${preview.from_season.number} og oprette sæson ${preview.to_season.number}.\n\n` +
      `Dette vil:\n` +
      `  • Markere sæson ${preview.from_season.number} som færdig\n` +
      `  • Oprette sæson ${preview.to_season.number} (status='active')\n` +
      `  • Udbetale ${formatCz(preview.sponsor_base_total)} i sponsor til ${preview.teams_affected} hold\n` +
      `  • Lukke sæson ${preview.from_season.number}'s transfervindue\n` +
      `  • Logge handlingen i admin-loggen\n\n` +
      `Er du sikker?`;
    if (!window.confirm(confirmText)) return;

    setExecuting(true);
    try {
      const auth = await getAuth();
      const res = await fetch(`${API}/api/admin/season-transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sæsonskifte fejlede");
      setResult(data);
      onMsg(`✅ Sæsonskifte udført — sæson ${preview.to_season.number} er nu aktiv`);
      // Refresh preview så UI viser ny state
      await fetchPreview();
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setExecuting(false);
    }
  }

  if (loading && !preview) {
    return <p className="text-cz-3 text-sm">Indlæser forhåndsvisning…</p>;
  }

  if (!preview) {
    return (
      <div className="bg-cz-subtle rounded-xl p-4">
        <p className="text-cz-3 text-sm mb-3">Ingen forhåndsvisning tilgængelig.</p>
        <button
          onClick={fetchPreview}
          className="px-3 py-2 bg-cz-info-bg text-cz-info border border-cz-info/30 rounded-lg text-sm font-medium hover:brightness-110"
        >
          Forsøg igen
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hero — hvad sker der */}
      <div className="bg-cz-subtle rounded-xl p-4">
        <p className="text-cz-2 font-medium text-sm mb-2">Hvad sker der ved sæsonskifte?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-cz-3 text-xs">Lukker</p>
            <p className="text-cz-1 font-bold">Sæson {preview.from_season.number}</p>
            {preview.from_season.start_date && (
              <p className="text-cz-3 text-xs">
                Startede: {new Date(preview.from_season.start_date).toLocaleDateString("da-DK")}
              </p>
            )}
          </div>
          <div>
            <p className="text-cz-3 text-xs">Åbner</p>
            <p className="text-cz-accent font-bold">Sæson {preview.to_season.number}</p>
            <p className="text-cz-3 text-xs">Bliver aktiv ved klik</p>
          </div>
        </div>
      </div>

      {/* Plan-detaljer */}
      <div className="bg-cz-subtle rounded-xl p-4">
        <p className="text-cz-2 font-medium text-sm mb-3">Forhåndsvisning</p>
        <div className="space-y-2 text-sm">
          <Row label="Hold påvirket" value={preview.teams_affected.toString()} />
          <Row
            label="Sponsor-udbetaling i alt"
            value={formatCz(preview.sponsor_base_total)}
            sub={`(${formatCz(preview.sponsor_base_total / Math.max(preview.teams_affected, 1))} pr. hold)`}
          />
          <Row label="Sæson 1 modifier" value="×1.00 (fredet)" sub="bestyrelses-modifier først aktiv fra sæson 2" />
        </div>

        {preview.already_transitioned && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-900 text-xs">
            ⚠️ Sæson {preview.to_season.number} eksisterer allerede. Re-run vil kun køre
            de faser der mangler (idempotent).
          </div>
        )}
      </div>

      {/* Sponsor-breakdown */}
      {preview.sponsor_breakdown?.length > 0 && (
        <details className="bg-cz-subtle rounded-xl p-4">
          <summary className="text-cz-2 font-medium text-sm cursor-pointer">
            Sponsor pr. hold ({preview.sponsor_breakdown.length})
          </summary>
          <div className="mt-3 max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-cz-3 text-left">
                  <th className="py-1 pr-2">Hold</th>
                  <th className="py-1 pr-2">Div</th>
                  <th className="py-1 text-right">Sponsor</th>
                </tr>
              </thead>
              <tbody>
                {preview.sponsor_breakdown.map((row) => (
                  <tr key={row.team_id} className="border-t border-cz-border">
                    <td className="py-1 pr-2 text-cz-1">{row.team_name}</td>
                    <td className="py-1 pr-2 text-cz-2">D{row.division}</td>
                    <td className="py-1 text-right text-cz-1">{formatCz(row.sponsor_base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Knapper */}
      <div className="flex gap-2">
        <button
          onClick={fetchPreview}
          disabled={loading || executing}
          className="px-4 py-2 bg-cz-card border border-cz-border text-cz-2 rounded-lg text-sm font-medium hover:bg-cz-subtle disabled:opacity-50"
        >
          {loading ? "Henter…" : "🔄 Genindlæs forhåndsvisning"}
        </button>
        <button
          onClick={executeTransition}
          disabled={loading || executing}
          className="flex-1 min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50"
        >
          {executing
            ? "Udfører…"
            : `Udfør sæsonskifte (sæson ${preview.from_season.number} → ${preview.to_season.number})`}
        </button>
      </div>

      {/* Resultat-log efter udførsel */}
      {result && (
        <div className="bg-cz-subtle rounded-xl p-4">
          <p className="text-cz-2 font-medium text-sm mb-2">✅ Sæsonskifte udført</p>
          <div className="space-y-1 text-xs font-mono">
            {(result.log || []).map((entry, i) => (
              <div key={i} className="text-cz-2">
                {entry.skipped ? "⏭️" : entry.inserted || entry.updated ? "✅" : "•"}{" "}
                <span className="text-cz-1 font-semibold">{entry.phase}</span>
                {entry.skipped && <span className="text-cz-3"> — {entry.reason}</span>}
                {entry.count !== undefined && <span className="text-cz-3"> ({entry.count})</span>}
              </div>
            ))}
          </div>

          {/* #535: Payroll-summary tabel — viser counts + totaler pr. kategori
              så admin kan verificere at de forventede finance_transactions
              rows blev skrevet, uden manuel SQL i Supabase. */}
          <PayrollSummaryTable result={result} />
        </div>
      )}
    </div>
  );
}

function PayrollSummaryTable({ result }) {
  const payrollEntry = (result?.log || []).find((e) => e.phase === "season_payroll");
  if (!payrollEntry) return null;

  // Engine'n kan have returneret { skipped: true, reason } hvis processSeasonStart
  // er stubbed (legacy test-path). I produktion sker det ikke, men vi viser en
  // venlig fallback i stedet for tomme tal.
  if (payrollEntry.skipped) {
    return (
      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-900 text-xs">
        ⚠️ Payroll-summary ikke tilgængelig: {payrollEntry.reason}
      </div>
    );
  }

  const teamsProcessed = payrollEntry.teams_processed ?? 0;
  // Forventet tal: hvis preview-data findes for kategorien, brug den; ellers null.
  // Pt. har sponsor-preview ingen payroll-forventninger, så alle expected er null.
  // Et fremtidigt buildSeasonEndPreviewRows-feed (ledger fra forrige sæsons
  // riders/loans) ville kunne udfylde disse.
  const rows = [
    {
      key: "loan_interest",
      label: "Lånerenter",
      expectedCount: null,
      actualCount: payrollEntry.loan_interest_count ?? 0,
      actualTotal: payrollEntry.loan_interest_total ?? 0,
      hint: "uniq_loan_interest_per_loan_season — divergens kan indikere skip-events",
    },
    {
      key: "salary",
      label: "Lønninger",
      expectedCount: null,
      actualCount: payrollEntry.salary_count ?? 0,
      actualTotal: payrollEntry.salary_total ?? 0,
      hint: "Forventer salary-row pr. hold med ryttere — divergens kan indikere idempotent-retry",
    },
    {
      key: "emergency_loan",
      label: "Nødlån",
      expectedCount: null,
      actualCount: payrollEntry.emergency_loan_count ?? 0,
      actualTotal: payrollEntry.emergency_loan_total ?? 0,
      hint: "Oprettes når balance < salary efter sponsor — afhænger af holdenes økonomi",
    },
    {
      key: "negative_balance_interest",
      label: "Renter på negativ balance",
      expectedCount: null,
      actualCount: payrollEntry.negative_balance_interest_count ?? 0,
      actualTotal: payrollEntry.negative_balance_interest_total ?? 0,
      hint: "Safety net når emergency-lån ikke dækker — sjælden i normal-drift",
    },
  ];

  const fmt = (n) =>
    typeof n === "number" ? n.toLocaleString("da-DK") : "—";

  return (
    <div className="mt-4">
      <p className="text-cz-2 font-medium text-sm mb-2">
        Payroll-summary ({teamsProcessed} hold behandlet)
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cz-3 text-left">
            <th className="py-1 pr-2">Kategori</th>
            <th className="py-1 pr-2 text-right">Forventet rows</th>
            <th className="py-1 pr-2 text-right">Faktisk rows</th>
            <th className="py-1 text-right">Total beløb (CZ$)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const hasExpected = row.expectedCount !== null && row.expectedCount !== undefined;
            const diverges = hasExpected && row.expectedCount !== row.actualCount;
            return (
              <tr
                key={row.key}
                className={`border-t border-cz-border ${diverges ? "bg-red-50" : ""}`}
              >
                <td className="py-1 pr-2 text-cz-1">{row.label}</td>
                <td className="py-1 pr-2 text-right text-cz-2">
                  {hasExpected ? fmt(row.expectedCount) : "—"}
                </td>
                <td
                  className={`py-1 pr-2 text-right font-semibold ${
                    diverges ? "text-red-700" : "text-cz-1"
                  }`}
                >
                  {fmt(row.actualCount)}
                </td>
                <td className="py-1 text-right text-cz-1">{fmt(row.actualTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.expectedCount === null) && (
        <p className="mt-2 text-cz-3 text-xs italic">
          Forventet-tal ikke tilgængelige (ingen payroll-preview-feed). Viser faktisk-rows
          fra engine-return + total beløb. Sammenlign mod Supabase finance_transactions ved
          mistanke om divergens — hints pr. række:
        </p>
      )}
      <ul className="mt-1 list-disc list-inside text-cz-3 text-xs space-y-0.5">
        {rows.map((r) => (
          <li key={`${r.key}-hint`}>
            <span className="font-medium text-cz-2">{r.label}:</span> {r.hint}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, sub }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-cz-3 text-xs">{label}</span>
      <div className="text-right">
        <p className="text-cz-1 font-medium">{value}</p>
        {sub && <p className="text-cz-3 text-xs">{sub}</p>}
      </div>
    </div>
  );
}
