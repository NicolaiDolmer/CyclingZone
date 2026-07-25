import { useCallback, useEffect, useState } from "react";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";
import {
  Button, DataTable, ZonePill, EmptyState, ErrorState, Modal, Select, Textarea,
  SkeletonLines, InboxIcon,
} from "../../components/ui";

// #2842 — spillerfeedback-indbakke.
//
// Baggrund: #2602 byggede skrive-stien (POST /api/feedback) uden en læse-flade.
// player_feedback havde nul .select() i hele repoet, og den første rigtige
// indsendelse lå ulæst i basen i dagevis. Denne fane er læse- og svar-siden.
//
// Denne flade er admin-only og BEVIDST dansk (repo-konvention for
// frontend/src/pages/admin — se EXEMPT_DIRS i scripts/i18n-check-leaks.mjs).
// Alt spilleren ser af sløjfen er derimod i18n'et EN+DA: svar-notifikationens
// titel (notif.admin.feedbackReply.title i backendMessages) og kvitteringen i
// FeedbackModal (feedback.sent.text).
//
// Layout følger T2 wide data (docs/design/PAGE_TEMPLATES.md): filterbar over
// en cz-table, hairline-borders, tabular figures på tid, stroke-ikoner.
// Beskeden selv kan være 4000 tegn og ville sprænge rækkehøjden, så rækken
// bærer et uddrag og hele indsendelsen åbnes i en detalje-dialog.

const API = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 25;

const STATUS_LABELS = {
  new: "Ny",
  in_progress: "I gang",
  closed: "Lukket",
};

const STATUS_TONE = {
  new: "danger",
  in_progress: "neutral",
  closed: "success",
};

const CATEGORY_LABELS = {
  feedback: "Feedback",
  bug: "Bug",
  idea: "Idé",
};

const STATUS_FILTERS = [
  { key: "", label: "Alle" },
  { key: "new", label: "Nye" },
  { key: "in_progress", label: "I gang" },
  { key: "closed", label: "Lukkede" },
];

// Dansk lokaltid — al tid i projektet vises i Europe/Copenhagen.
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

function daysOld(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function excerpt(text, max = 90) {
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export default function AdminFeedbackTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();

  const [status, setStatus] = useState("new");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ new: 0, in_progress: 0, closed: 0, total: 0 });
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);

  // cursor === null → første side (erstatter listen). Ellers append.
  const load = useCallback(async (cursor = null) => {
    if (cursor == null) { setLoading(true); setLoadError(null); } else { setLoadingMore(true); }
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      if (cursor != null) params.set("cursor", String(cursor));

      const res = await fetch(`${API}/api/admin/feedback?${params}`, { headers: await getAuth() });
      const data = await readAdminJson(res);
      if (!res.ok) {
        setLoadError(adminErrorMessage(data, res));
        return;
      }
      setItems(prev => (cursor == null ? data.items : [...prev, ...data.items]));
      setCounts(data.counts || { new: 0, in_progress: 0, closed: 0, total: 0 });
      setNextCursor(data.next_cursor ?? null);
    } catch (e) {
      setLoadError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [getAuth, status, category]);

  useEffect(() => { load(null); }, [load]);

  // Skriv en opdateret række tilbage i listen uden at genindlæse hele siden,
  // så scroll-positionen og en evt. indlæst side 2 overlever en handling.
  function patchItem(id, patch) {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    setSelected(prev => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  async function changeStatus(item, nextStatus) {
    try {
      const res = await fetch(`${API}/api/admin/feedback/${item.id}/status`, {
        method: "PATCH",
        headers: await getAuth(),
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await readAdminJson(res);
      if (!res.ok) { showMsg(adminErrorMessage(data, res), "error"); return; }
      patchItem(item.id, { status: nextStatus });
      setCounts(c => ({
        ...c,
        [item.status]: Math.max(0, (c[item.status] || 0) - 1),
        [nextStatus]: (c[nextStatus] || 0) + 1,
      }));
      showMsg(`Status sat til "${STATUS_LABELS[nextStatus]}"`);
    } catch (e) {
      showMsg(e.message || "Forbindelsen fejlede", "error");
    }
  }

  const columns = [
    {
      key: "user",
      header: "Afsender",
      sticky: true,
      render: (row) => row.user?.username || "Ukendt bruger",
      subline: (row) => [row.team?.name, row.user?.email].filter(Boolean).join(" · ") || "Intet hold",
    },
    {
      key: "created_at",
      header: "Modtaget",
      numeric: true,
      render: (row) => {
        const age = daysOld(row.created_at);
        return (
          <span className="whitespace-nowrap">
            {formatWhen(row.created_at)}
            {row.status === "new" && age != null && age >= 1 && (
              <span className="ms-2 font-data text-3xs uppercase tracking-[.06em] text-cz-danger">
                {age}d
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "category",
      header: "Type",
      compact: true,
      render: (row) => CATEGORY_LABELS[row.category] || row.category,
    },
    {
      key: "page_path",
      header: "Side",
      fold: true,
      render: (row) => <span className="font-data text-2xs text-cz-3">{row.page_path || "—"}</span>,
    },
    {
      key: "message",
      header: "Besked",
      render: (row) => <span className="text-cz-2">{excerpt(row.message)}</span>,
    },
    {
      key: "status",
      header: "Status",
      compact: true,
      render: (row) => (
        <ZonePill tone={STATUS_TONE[row.status] || "neutral"}>
          {STATUS_LABELS[row.status] || row.status}
        </ZonePill>
      ),
    },
    {
      key: "actions",
      header: "",
      compact: true,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setSelected(row)}>
          Åbn
        </Button>
      ),
    },
  ];

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key || "all"}
              type="button"
              onClick={() => setStatus(f.key)}
              aria-pressed={status === f.key}
              className={`rounded-cz border px-3 py-1.5 text-xs font-medium transition-colors ${
                status === f.key
                  ? "border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t"
                  : "border-cz-border text-cz-2 hover:text-cz-1"
              }`}
            >
              {f.label}
              <span className="ms-1.5 font-data tabular-nums text-cz-3">
                {f.key ? counts[f.key] ?? 0 : counts.total ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="w-40">
          <Select size="sm" value={category} onChange={e => setCategory(e.target.value)} aria-label="Filtrér på type">
            <option value="">Alle typer</option>
            <option value="feedback">Feedback</option>
            <option value="bug">Bug</option>
            <option value="idea">Idé</option>
          </Select>
        </div>

        <p className="ms-auto font-data text-xs text-cz-3">
          {counts.new ?? 0} ubesvarede af {counts.total ?? 0} i alt
        </p>
      </div>

      {loading ? (
        <div className="rounded-cz border border-cz-border bg-cz-card p-5">
          <SkeletonLines lines={5} />
        </div>
      ) : loadError ? (
        <ErrorState
          title="Kunne ikke hente feedback"
          description="Intet er gået tabt. Indsendelserne ligger uændret i basen."
          action={<Button variant="secondary" size="sm" onClick={() => load(null)}>Prøv igen</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={26} aria-hidden="true" />}
          title="Ingen indsendelser her"
          description="Skift filter for at se de øvrige indsendelser."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            label="Spillerfeedback"
            count={`Viser ${items.length} af ${counts.total ?? items.length} indsendelser`}
          />
          {nextCursor != null && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => load(nextCursor)}>
                Hent flere
              </Button>
            </div>
          )}
        </>
      )}

      <FeedbackDetailModal
        item={selected}
        onClose={() => setSelected(null)}
        onStatusChange={changeStatus}
        onReplied={(id, reply, repliedAt) => {
          patchItem(id, { reply_message: reply, replied_at: repliedAt, status: "closed" });
          setCounts(c => ({
            ...c,
            new: Math.max(0, (c.new || 0) - (selected?.status === "new" ? 1 : 0)),
            in_progress: Math.max(0, (c.in_progress || 0) - (selected?.status === "in_progress" ? 1 : 0)),
            closed: (c.closed || 0) + 1,
          }));
          showMsg("Svaret er sendt til spilleren");
        }}
        getAuth={getAuth}
        onError={(text) => showMsg(text, "error")}
      />
    </>
  );
}

const REPLY_MAX_LENGTH = 4000;

function FeedbackDetailModal({ item, onClose, onStatusChange, onReplied, getAuth, onError }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  // Nulstil kladden når en anden indsendelse åbnes, så et påbegyndt svar
  // aldrig kan lande på den forkerte spiller.
  useEffect(() => { setReply(""); }, [item?.id]);

  if (!item) return null;

  const alreadyReplied = Boolean(item.reply_message);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/admin/feedback/${item.id}/reply`, {
        method: "POST",
        headers: await getAuth(),
        body: JSON.stringify({ reply: reply.trim() }),
      });
      const data = await readAdminJson(res);
      if (!res.ok) { onError(adminErrorMessage(data, res)); return; }
      onReplied(item.id, reply.trim(), data.replied_at);
      onClose();
    } catch (e) {
      onError(e.message || "Forbindelsen fejlede");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" closeLabel="Luk" ariaLabelledby="feedback-detail-title">
      <div className="mb-4">
        <h2 id="feedback-detail-title" className="font-data text-xl font-bold text-cz-1">
          {CATEGORY_LABELS[item.category] || item.category} fra {item.user?.username || "ukendt bruger"}
        </h2>
        <p className="mt-1 font-data text-2xs uppercase tracking-[.06em] text-cz-3">
          {formatWhen(item.created_at)}
          {item.team?.name ? ` · ${item.team.name}` : ""}
          {item.page_path ? ` · ${item.page_path}` : ""}
          {item.viewport ? ` · ${item.viewport}` : ""}
        </p>
        {item.user?.email && (
          <p className="mt-0.5 font-data text-2xs text-cz-3">{item.user.email}</p>
        )}
      </div>

      <div className="rounded-cz border border-cz-border bg-cz-subtle p-4">
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-cz-1">{item.message}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">Status</span>
        {Object.keys(STATUS_LABELS).map(key => (
          <button
            key={key}
            type="button"
            disabled={item.status === key}
            onClick={() => onStatusChange(item, key)}
            className={`rounded-cz border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
              item.status === key
                ? "border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t"
                : "border-cz-border text-cz-2 hover:text-cz-1"
            }`}
          >
            {STATUS_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="mt-5 border-t border-cz-border pt-4">
        {alreadyReplied ? (
          <>
            <p className="font-data text-2xs uppercase tracking-[.06em] text-cz-3">
              Besvaret {formatWhen(item.replied_at)}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-cz-2">
              {item.reply_message}
            </p>
            <p className="mt-3 text-xs text-cz-3">
              Et svar kan kun sendes én gang. Skriv til spilleren ad anden vej hvis der skal følges op.
            </p>
          </>
        ) : (
          <>
            <label htmlFor="feedback-reply" className="mb-1.5 block text-xs font-medium text-cz-2">
              Svar til spilleren
            </label>
            <Textarea
              id="feedback-reply"
              rows={5}
              value={reply}
              disabled={sending}
              maxLength={REPLY_MAX_LENGTH}
              onChange={e => setReply(e.target.value)}
              placeholder="Svaret lander som en notifikation i spillet."
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="font-data text-2xs text-cz-3">
                {REPLY_MAX_LENGTH - reply.length} tegn tilbage
              </p>
              <Button
                variant="primary"
                size="sm"
                loading={sending}
                disabled={sending || !reply.trim()}
                onClick={sendReply}
              >
                Send svar
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
