import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";
import {
  Button, DataTable, ZonePill, EmptyState, ErrorState, SkeletonLines, GlobeIcon,
} from "../../components/ui";

// #3201 — forum-rapport-indbakke (moderation). Spillere rapporterer opslag/svar
// via rapportér-knappen (#3199); rapporterne lander her + som Discord-ping.
// Sletning er soft delete (deleted_at) og auto-resolver rapporten i backend.
//
// Denne flade er admin-only og BEVIDST dansk (repo-konvention for
// frontend/src/pages/admin — se EXEMPT_DIRS i scripts/i18n-check-leaks.mjs).
// Layout følger AdminFeedbackTab: filter-chips + DataTable, T2-idiom.

const API = import.meta.env.VITE_API_URL;

const STATUS_LABELS = { new: "Ny", resolved: "Håndteret" };
const STATUS_TONE = { new: "danger", resolved: "success" };
const TARGET_LABELS = { post: "Opslag", reply: "Svar" };

const STATUS_FILTERS = [
  { key: "", label: "Alle" },
  { key: "new", label: "Nye" },
  { key: "resolved", label: "Håndterede" },
];

function formatWhen(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("da-DK", {
    timeZone: "Europe/Copenhagen",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminForumTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [status, setStatus] = useState("new");
  const [state, setState] = useState({ phase: "loading", items: [], nextCursor: null, counts: { new: 0 } });
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (cursor = null) => {
    if (cursor == null) setState((s) => ({ ...s, phase: s.items.length ? "ready" : "loading" }));
    try {
      const headers = await getAuth();
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor != null) params.set("cursor", String(cursor));
      const res = await fetch(`${API}/api/admin/forum/reports?${params}`, { headers });
      const data = await readAdminJson(res);
      if (!res.ok) throw new Error(adminErrorMessage(data, res));
      setState((s) => ({
        phase: "ready",
        items: cursor == null ? data.items || [] : [...s.items, ...(data.items || [])],
        nextCursor: data.next_cursor ?? null,
        counts: data.counts || { new: 0 },
      }));
    } catch (e) {
      if (cursor == null) setState({ phase: "error", items: [], nextCursor: null, counts: { new: 0 } });
      showMsg(e.message, "error");
    }
  }, [getAuth, showMsg, status]);

  useEffect(() => { load(null); }, [load]);

  async function action(id, fn, okText) {
    setBusyId(id);
    try {
      await fn();
      showMsg(okText);
      await load(null);
    } catch (e) {
      showMsg(e.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function resolveReport(report) {
    const headers = await getAuth();
    const res = await fetch(`${API}/api/admin/forum/reports/${report.id}/resolve`, { method: "PATCH", headers });
    const data = await readAdminJson(res);
    if (!res.ok) throw new Error(adminErrorMessage(data, res));
  }

  async function deleteTarget(report) {
    const headers = await getAuth();
    // Fuld path inline i fetch-kaldet (Detector B-scanneren, se ForumPostPage).
    const res = report.target_type === "post"
      ? await fetch(`${API}/api/admin/forum/posts/${report.target_id}`, { method: "DELETE", headers })
      : await fetch(`${API}/api/admin/forum/replies/${report.target_id}`, { method: "DELETE", headers });
    const data = await readAdminJson(res);
    if (!res.ok) throw new Error(adminErrorMessage(data, res));
  }

  const columns = [
    {
      key: "created_at",
      header: "Modtaget",
      numeric: true,
      render: (r) => <span className="tabular-nums">{formatWhen(r.created_at)}</span>,
    },
    {
      key: "target_type",
      header: "Type",
      compact: true,
      render: (r) => TARGET_LABELS[r.target_type] || r.target_type,
    },
    {
      key: "target",
      header: "Indhold",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-[13px]">{r.target?.excerpt || "(fjernet)"}</div>
          {r.target?.deleted && <div className="text-2xs text-cz-3">Allerede slettet</div>}
        </div>
      ),
    },
    {
      key: "reporter",
      header: "Rapporteret af",
      render: (r) => r.reporter_username || "—",
    },
    {
      key: "reason",
      header: "Begrundelse",
      render: (r) => <span className="text-[13px] text-cz-2">{r.reason || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      compact: true,
      render: (r) => <ZonePill tone={STATUS_TONE[r.status] || "neutral"}>{STATUS_LABELS[r.status] || r.status}</ZonePill>,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.target?.post_id && (
            <Link to={`/forum/${r.target.post_id}`} className="text-xs text-cz-accent-t hover:underline">
              Åbn
            </Link>
          )}
          {r.status === "new" && !r.target?.deleted && (
            <Button
              variant="danger"
              size="sm"
              disabled={busyId === r.id}
              onClick={() => action(r.id, () => deleteTarget(r), "Indholdet er slettet og rapporten håndteret")}
            >
              Slet indhold
            </Button>
          )}
          {r.status === "new" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busyId === r.id}
              onClick={() => action(r.id, () => resolveReport(r), "Rapporten er markeret håndteret")}
            >
              Håndteret
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <AdminMessageBanner msg={msg} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              onClick={() => setStatus(f.key)}
              aria-pressed={status === f.key}
              className={`rounded-cz-pill border px-3 py-1 text-xs font-medium transition-colors ${
                status === f.key
                  ? "border-cz-accent/50 bg-cz-accent/10 text-cz-1"
                  : "border-cz-border text-cz-2 hover:border-cz-3"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
          {state.counts.new} åbne rapporter
        </span>
      </div>

      {state.phase === "loading" ? (
        <SkeletonLines lines={6} />
      ) : state.phase === "error" ? (
        <ErrorState
          description="Rapporterne kunne ikke hentes."
          action={<Button size="sm" variant="secondary" onClick={() => load(null)}>Prøv igen</Button>}
        />
      ) : state.items.length === 0 ? (
        <EmptyState
          icon={<GlobeIcon size={26} aria-hidden="true" />}
          title="Ingen rapporter"
          description={status === "new" ? "Der er ingen åbne rapporter lige nu." : "Ingen rapporter matcher filteret."}
        />
      ) : (
        <>
          <DataTable columns={columns} rows={state.items} rowKey={(r) => r.id} label="Forum-rapporter" />
          {state.nextCursor != null && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => load(state.nextCursor)}>
                Hent flere
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
