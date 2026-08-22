import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { supabase } from "../lib/supabase";
import { Button, Card, DataTable, EmptyState, ErrorState, Input, PageLoader, Select, SkeletonLines } from "../components/ui";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../components/admin/shared/useAdminAuth";
import {
  buildValueRows,
  buildSalaryRows,
  filterRows,
  sortRows,
  summarize,
  typeOptions,
} from "./adminValueTransitionShape";

// #3750/#4000 — EJERENS forhåndsvisning af værdi-overgangen: hvad hver rytters
// værdi bliver efter niveau-korrektion (c, justérbar) + type-dæmpning, og hvor
// lønnen forventes at lande fra S3 (løn = CPV × global sats; c-uafhængig).
// RENT read-only beslutningsværktøj: datagrundlaget bygges af
// backend/scripts/buildValueTransitionPreview.js, og intet her ændrer
// spil-tilstand. Selve apply er CLI-only med ejer-go.
//
// EJER-ONLY (22/8): backend-endpointet er requireOwner (OWNER_USER_IDS), ikke
// kun requireAdmin — en 403 herfra behandles som "ikke adgang" og sender
// videre til dashboardet, præcis som for ikke-admins.
const API = import.meta.env.VITE_API_URL;

const fmtNum = (n) => (n == null ? "—" : new Intl.NumberFormat("da-DK").format(Math.round(n)));
const fmtPct = (p) => {
  if (p == null) return "—";
  const r = Math.round(p * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
};
const fmtC = (c) => (c == null ? "—" : Number(c).toFixed(3));
const pctClass = (p) => (p == null ? "" : p < 0 ? "text-cz-danger" : "text-cz-success");

// Den officielle gate-log-række (market_value_level_correction_gate_log) →
// de to målte c-kandidater: nyeste 30-dages-vindue (= fyringsværdien når
// gaten er grøn) og median90 (til sammenligning).
export function gatePresets(gate) {
  if (!gate) return null;
  const rolling = Array.isArray(gate.rolling_medians) ? gate.rolling_medians : [];
  const last = rolling.length ? rolling[rolling.length - 1] : null;
  const newest = Number.isFinite(Number(last?.median)) ? Number(last.median) : null;
  const median90 = Number.isFinite(Number(gate.median_price_over_anchor_90d)) ? Number(gate.median_price_over_anchor_90d) : null;
  return { newest, median90 };
}

function SummaryTiles({ label, summary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card className="p-3">
        <p className="text-cz-3 text-2xs uppercase">Ryttere (filtreret)</p>
        <p className="text-cz-1 text-lg font-bold font-data tabular-nums">{fmtNum(summary.n)}</p>
      </Card>
      <Card className="p-3">
        <p className="text-cz-3 text-2xs uppercase">{label} i dag</p>
        <p className="text-cz-1 text-lg font-bold font-data tabular-nums">{fmtNum(summary.before)}</p>
      </Card>
      <Card className="p-3">
        <p className="text-cz-3 text-2xs uppercase">{label} efter</p>
        <p className="text-cz-1 text-lg font-bold font-data tabular-nums">{fmtNum(summary.after)}</p>
      </Card>
      <Card className="p-3">
        <p className="text-cz-3 text-2xs uppercase">Ændring</p>
        <p className={`text-lg font-bold font-data tabular-nums ${pctClass(summary.deltaPct)}`}>{fmtPct(summary.deltaPct)}</p>
      </Card>
    </div>
  );
}

function GateStatus({ gate }) {
  if (!gate) {
    return (
      <p className="text-cz-3 text-sm" data-testid="gate-status">
        Gate: ingen officiel måling endnu (søndags-cron eller manuel kørsel).
      </p>
    );
  }
  const green = gate.gate_status === "green";
  const presets = gatePresets(gate);
  return (
    <p className="text-sm" data-testid="gate-status">
      <span className={`font-semibold ${green ? "text-cz-success" : "text-cz-danger"}`}>
        Gate {green ? "GRØN" : "RØD"}
      </span>
      <span className="text-cz-2"> · målt {gate.measured_date} · {gate.gate_reason_text}</span>
      <span className="text-cz-3"> · nyeste vindue {fmtC(presets?.newest)} · median90 {fmtC(presets?.median90)}</span>
    </p>
  );
}

export default function AdminValueTransitionPage() {
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const { getAuth } = useAdminAuth();
  const [state, setState] = useState({ loading: true, error: null, rows: [], computedAt: null, message: null, gate: null });
  const [tab, setTab] = useState("values"); // values | salaries
  const [c, setC] = useState(1);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [humanOnly, setHumanOnly] = useState(true);
  const [sort, setSort] = useState("valueNow");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).single();
      setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
  }, []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const headers = await getAuth();
      const res = await fetch(`${API}/api/admin/value-transition`, { headers });
      if (res.status === 403) { setAdminStatus("not_admin"); return; }
      const data = await readAdminJson(res);
      if (!res.ok) throw new Error(adminErrorMessage(data, res));
      // Gate-status er sekundær: fejler den, vises siden stadig (uden presets).
      let gate = null;
      try {
        const gres = await fetch(`${API}/api/admin/market-value-level-correction/gate`, { headers });
        const gdata = gres.ok ? await readAdminJson(gres) : null;
        gate = gdata?.gate ?? null;
      } catch {
        // best-effort: gate-status er kun kontekst til presets; tabellen er det primære.
        gate = null;
      }
      const presets = gatePresets(gate);
      if (presets?.newest != null) setC(presets.newest);
      setState({ loading: false, error: null, rows: data.rows ?? [], computedAt: data.computedAt ?? null, message: data.message ?? null, gate });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [getAuth]);

  useEffect(() => {
    if (adminStatus === "admin") load();
  }, [adminStatus, load]);

  const onSort = useCallback((key) => {
    setSort((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return prev;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  // Værdi-fanen: uden akademi (symbolsk værdi indtil første søndag, #4001).
  // Løn-fanen: MED akademi (søndagens genberegning omfatter dem, ejer-krav 22/8).
  const filtered = useMemo(
    () => filterRows(state.rows, { q, type, humanOnly, includeAcademy: tab === "salaries" }),
    [state.rows, q, type, humanOnly, tab]
  );
  const valueRows = useMemo(
    () => (tab === "values" ? sortRows(buildValueRows(filtered, c), sort, sortDir) : []),
    [tab, filtered, c, sort, sortDir]
  );
  const salaryRows = useMemo(
    () => (tab === "salaries" ? sortRows(buildSalaryRows(filtered), sort, sortDir) : []),
    [tab, filtered, sort, sortDir]
  );
  const summary = useMemo(
    () =>
      tab === "values"
        ? summarize(buildValueRows(filtered, c), { beforeKey: "valueNow", afterKey: "valueAfter" })
        : summarize(buildSalaryRows(filtered), { beforeKey: "salaryNow", afterKey: "salaryExpected" }),
    [tab, filtered, c]
  );
  const types = useMemo(() => typeOptions(state.rows), [state.rows]);
  const presets = useMemo(() => gatePresets(state.gate), [state.gate]);

  const stickyCol = {
    key: "name",
    header: "Rytter",
    sticky: true,
    sortKey: "name",
    render: (r) => r.name,
    subline: (r) => (r.isAcademy ? `${r.teamName ?? "—"} · akademi` : (r.teamName ?? "—")),
  };

  const valueColumns = [
    stickyCol,
    { key: "valuationType", header: "Type (frossen)", fold: true, sortKey: "valuationType", render: (r) => r.valuationType ?? "—" },
    { key: "primaryType", header: "Ny type", fold: true, sortKey: "primaryType", render: (r) => r.primaryType ?? "—" },
    { key: "valueNow", header: "Værdi i dag", numeric: true, sortKey: "valueNow", render: (r) => fmtNum(r.valueNow) },
    { key: "valueAfter", header: "Efter", numeric: true, sortKey: "valueAfter", render: (r) => fmtNum(r.valueAfter) },
    {
      key: "valueDeltaPct",
      header: "Ændring",
      numeric: true,
      sortKey: "valueDeltaPct",
      render: (r) => <span className={pctClass(r.valueDeltaPct)}>{fmtPct(r.valueDeltaPct)}</span>,
      foldValue: (r) => fmtPct(r.valueDeltaPct),
    },
  ];

  const salaryColumns = [
    stickyCol,
    { key: "valuationType", header: "Type (frossen)", fold: true, sortKey: "valuationType", render: (r) => r.valuationType ?? "—" },
    { key: "salaryNow", header: "Løn i dag", numeric: true, sortKey: "salaryNow", render: (r) => fmtNum(r.salaryNow) },
    { key: "salaryExpected", header: "Forventet S3", numeric: true, sortKey: "salaryExpected", render: (r) => fmtNum(r.salaryExpected) },
    { key: "salaryExpectedNoDamp", header: "Uden dæmpning", numeric: true, fold: true, sortKey: "salaryExpectedNoDamp", render: (r) => fmtNum(r.salaryExpectedNoDamp) },
    {
      key: "salaryDeltaPct",
      header: "Ændring",
      numeric: true,
      sortKey: "salaryDeltaPct",
      render: (r) => <span className={pctClass(r.salaryDeltaPct)}>{fmtPct(r.salaryDeltaPct)}</span>,
      foldValue: (r) => fmtPct(r.salaryDeltaPct),
    },
  ];

  if (adminStatus === "checking") {
    return <PageLoader label="Tjekker adgang" minHeight="40vh" />;
  }
  if (adminStatus === "not_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  const activeRows = tab === "values" ? valueRows : salaryRows;
  const activeColumns = tab === "values" ? valueColumns : salaryColumns;

  return (
    <div className="max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-cz-1 text-xl font-bold">Værdi-overgangen — forhåndsvisning</h1>
          <p className="text-cz-3 text-sm mt-1">
            Niveau-korrektion (c) + type-dæmpning pr. rytter (uden akademi), og forventet S3-løn inkl. akademiryttere (CPV × global sats — c-uafhængig).
            Read-only, kun ejeren: intet her ændrer spillet.
            {state.computedAt && ` Beregnet ${new Date(state.computedAt).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" })}.`}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant={tab === "values" ? "primary" : "secondary"} onClick={() => { setTab("values"); setSort("valueNow"); setSortDir("desc"); }}>
            Værdier
          </Button>
          <Button variant={tab === "salaries" ? "primary" : "secondary"} onClick={() => { setTab("salaries"); setSort("salaryNow"); setSortDir("desc"); }}>
            Løn
          </Button>
          <Button variant="secondary" onClick={load} disabled={state.loading}>
            Opdatér
          </Button>
        </div>
      </div>

      {state.loading ? (
        <Card className="p-4"><SkeletonLines lines={6} /></Card>
      ) : state.error ? (
        <ErrorState title="Kunne ikke hente forhåndsvisningen" description={state.error} onRetry={load} />
      ) : state.rows.length === 0 ? (
        <EmptyState
          title="Forhåndsvisningen er ikke bygget endnu"
          description={state.message ?? "Kør backend/scripts/buildValueTransitionPreview.js og genindlæs."}
        />
      ) : (
        <>
          <GateStatus gate={state.gate} />

          <SummaryTiles label={tab === "values" ? "Værdi" : "Lønsum"} summary={summary} />

          <div className="flex flex-wrap items-center gap-3">
            <Input
              size="sm"
              className="w-[240px]"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søg rytter eller hold…"
              aria-label="Søg rytter eller hold"
            />
            <Select size="sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrér på frossen type">
              <option value="all">Alle typer</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-cz-2 text-sm">
              <input type="checkbox" checked={humanOnly} onChange={(e) => setHumanOnly(e.target.checked)} />
              Kun spillerhold
            </label>
            {tab === "values" && (
              <div className="flex items-center gap-2 ms-auto">
                <span className="text-cz-3 text-sm">c =</span>
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.005"
                  value={c}
                  onChange={(e) => setC(Number(e.target.value))}
                  aria-label="Niveau-faktor c"
                  className="w-[160px]"
                />
                <span className="text-cz-1 text-sm font-data tabular-nums w-[48px]">{c.toFixed(3)}</span>
                {presets?.newest != null && (
                  <Button variant="secondary" onClick={() => setC(presets.newest)} title="Nyeste 30-dages-vindues median (officiel måling)">
                    målt {fmtC(presets.newest)}
                  </Button>
                )}
                {presets?.median90 != null && (
                  <Button variant="secondary" onClick={() => setC(presets.median90)} title="90-dages-medianen (officiel måling)">
                    median90 {fmtC(presets.median90)}
                  </Button>
                )}
              </div>
            )}
          </div>

          <DataTable
            columns={activeColumns}
            rows={activeRows}
            rowKey={(r) => r.riderId}
            sort={sort}
            sortDir={sortDir}
            onSort={onSort}
            count={activeRows.length}
            label={tab === "values" ? "Værdi-forhåndsvisning pr. rytter" : "Løn-forhåndsvisning pr. rytter"}
            dense
          />
        </>
      )}
    </div>
  );
}
