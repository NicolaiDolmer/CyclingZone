import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { supabase } from "../lib/supabase";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch.js";
import {
  Button, PageHeader, Section, SectionStack, SectionHeader, EmptyState, ErrorState,
  SkeletonLines, Modal, Field, Textarea,
} from "../components/ui";
import { InboxIcon } from "../components/ui/icons/index.jsx";
import { formatForumDate } from "./ForumPage.jsx";

// #3199 — tråd-detalje: opslag + evt. ejer-poll + svar. T1 (max-w-4xl).
// Afstemning: single choice, genafstemning tilladt (backend upserter). Kun
// aggregater + egen stemme kommer over wire — aldrig hvem der stemte hvad.
// Rapportér-knappen findes på både opslag og svar; admin ser Slet/Pin
// (backend håndhæver rollen — knapperne er kun synlige for admins).

const API = import.meta.env.VITE_API_URL;
const BODY_MAX = 4000;
const REASON_MAX = 500;
// #3452: ejer-direktiv 6/8 "gider ikke se rapporter uden grund" — skal matche
// FORUM_REPORT_REASON_MIN_LENGTH i backend/lib/forum.js.
const REASON_MIN = 10;
const FORUM_POST_TABLES = ["forum_replies", "forum_posts"];

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

function AuthorLine({ author, createdAt, language, t }) {
  return (
    <div className="flex items-center gap-2 font-data text-2xs uppercase tracking-[.04em] text-cz-3">
      <span className="truncate">{t("list.by", { name: author?.username || author?.team_name || "?" })}</span>
      {author?.team_name && author?.username && <span className="truncate normal-case">{author.team_name}</span>}
      <span>·</span>
      <span className="tabular-nums">{formatForumDate(createdAt, language)}</span>
    </div>
  );
}

function ReportModal({ open, onClose, onSubmit, t }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  function handleClose() {
    if (submitting) return;
    onClose?.();
    setTimeout(() => {
      setReason("");
      setSent(false);
      setError(null);
    }, 200);
  }

  const trimmedReason = reason.trim();
  // #3452: samme grænse som backend (FORUM_REPORT_REASON_MIN_LENGTH) —
  // klientvalideret FØR submit, så spilleren ser fejlen med det samme i
  // stedet for at vente på en 400 tur-retur.
  const reasonTooShort = trimmedReason.length > 0 && trimmedReason.length < REASON_MIN;

  async function handleSubmit(e) {
    e.preventDefault();
    if (trimmedReason.length < REASON_MIN) {
      setError(t("report.reasonMinError", { count: REASON_MIN }));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmedReason);
      setSent(true);
    } catch (err) {
      setError(err?.message || t("errors.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} size="sm" ariaLabelledby="forum-report-title">
      <div className="mb-4">
        <h2 id="forum-report-title" className="font-display text-2xl leading-none tracking-[.01em] text-cz-1">
          {t("report.title")}
        </h2>
        <p className="mt-1.5 text-sm text-cz-2">{t("report.description")}</p>
      </div>
      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-cz-1">{t("report.sent")}</p>
          <Button type="button" variant="primary" size="sm" onClick={handleClose}>{t("report.cancel")}</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label={t("report.reasonLabel")} htmlFor="forum-report-reason">
            <Textarea
              id="forum-report-reason"
              rows={3}
              value={reason}
              disabled={submitting}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("report.reasonPlaceholder")}
              aria-invalid={reasonTooShort || undefined}
              required
            />
          </Field>
          {reasonTooShort && !error && (
            <p className="text-xs text-cz-danger">{t("report.reasonMinError", { count: REASON_MIN })}</p>
          )}
          {error && <p className="text-xs text-cz-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={submitting}>
              {t("report.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={submitting || trimmedReason.length < REASON_MIN}>
              {t("report.submit")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PollBlock({ poll, onVote, voting, t }) {
  const total = poll.total_votes || 0;
  return (
    <div className="mt-4 border-t border-cz-border pt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13.5px] font-medium text-cz-1">{t("poll.heading")}</span>
        <span className="font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
          {t("poll.votes", { count: total })}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {poll.options.map((option) => {
          const pct = total > 0 ? Math.round((option.votes / total) * 100) : 0;
          const mine = poll.my_option_id === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={voting}
              onClick={() => onVote(option.id)}
              aria-pressed={mine}
              className={`relative overflow-hidden rounded-cz border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                mine ? "border-cz-accent/50" : "border-cz-border hover:border-cz-3"
              }`}
            >
              <span
                className="absolute inset-y-0 left-0 bg-cz-accent/10"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
              <span className="relative flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-cz-1">
                  {option.label}
                  {mine && (
                    <span className="ms-2 font-data text-2xs uppercase tracking-[.08em] text-cz-accent-t">
                      {t("poll.yourVote")}
                    </span>
                  )}
                </span>
                <span className="font-data text-2xs tabular-nums text-cz-3">{option.votes} · {pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ForumPostPage() {
  const { t, i18n } = useTranslation("forum");
  const { t: tErrors } = useTranslation("errors");
  const { postId } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState({ status: "loading", post: null, replies: [], poll: null });
  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState(null);
  const [voting, setVoting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reportTarget, setReportTarget] = useState(null); // { type, id } | null

  const tError = useCallback(
    (code) => (code && i18n.exists(`errors:api.${code}`) ? tErrors(`api.${code}`) : t("errors.submitFailed")),
    [i18n, tErrors, t]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).single();
      if (!cancelled) setIsAdmin(userData?.role === "admin");
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers || !API) throw new Error("no session");
      const res = await fetch(`${API}/api/forum/posts/${postId}`, { headers });
      if (res.status === 404) {
        setState({ status: "notfound", post: null, replies: [], poll: null });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({ status: "ready", post: data.post, replies: data.replies || [], poll: data.poll || null });
      // #4118/#3451: backend markerer tråden læst som side-effekt af dette
      // kald (GET /api/forum/posts/:id) — fortæl Layout.jsx's nav-prik at
      // genberegne med det samme i stedet for at vente på næste heartbeat.
      window.dispatchEvent(new Event("cz:forum-thread-read"));
    } catch {
      setState((s) => (s.status === "ready" ? s : { status: "error", post: null, replies: [], poll: null }));
    }
  }, [postId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefetch(`forum-post-${postId}`, FORUM_POST_TABLES, load);

  async function handleReply(e) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/forum/posts/${postId}/replies`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReplyError(tError(data?.errorCode));
        return;
      }
      setReplyBody("");
      await load();
    } catch {
      setReplyError(t("errors.submitFailed"));
    } finally {
      setReplySubmitting(false);
    }
  }

  async function handleVote(optionId) {
    setVoting(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/forum/posts/${postId}/vote`, {
        method: "POST",
        headers,
        body: JSON.stringify({ option_id: optionId }),
      });
      if (res.ok) await load();
    } finally {
      setVoting(false);
    }
  }

  async function submitReport(reason) {
    const headers = await authHeaders();
    // #3452: reason er nu påkrævet — sendes altid (ReportModal validerer
    // min. længde FØR dette kaldes).
    const res = await fetch(`${API}/api/forum/report`, {
      method: "POST",
      headers,
      body: JSON.stringify({ target_type: reportTarget?.type, target_id: reportTarget?.id, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(tError(data?.errorCode));
  }

  async function handleAdminDelete(type, id) {
    const headers = await authHeaders();
    // Fuld path inline i fetch-kaldet — audit-feature-liveness' Detector B
    // scanner efter `${X}/api/...`-literals og ser ikke variabel-byggede paths.
    const res = type === "post"
      ? await fetch(`${API}/api/admin/forum/posts/${id}`, { method: "DELETE", headers })
      : await fetch(`${API}/api/admin/forum/replies/${id}`, { method: "DELETE", headers });
    if (res.ok) {
      if (type === "post") navigate("/forum");
      else await load();
    }
  }

  async function handleAdminPin(pinned) {
    const headers = await authHeaders();
    const res = await fetch(`${API}/api/admin/forum/posts/${postId}/pin`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ pinned }),
    });
    if (res.ok) await load();
  }

  const language = i18n.language;
  const { post, replies, poll } = state;

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/forum" className="mb-4 inline-block text-xs text-cz-accent-t hover:underline">
        {t("post.back")}
      </Link>

      {state.status === "loading" ? (
        <Section><SkeletonLines lines={6} /></Section>
      ) : state.status === "error" ? (
        <Section role="alert">
          <ErrorState
            description={t("errors.loadFailed")}
            action={<Button size="sm" variant="secondary" onClick={load}>{t("errors.retry")}</Button>}
          />
        </Section>
      ) : state.status === "notfound" ? (
        <EmptyState
          icon={<InboxIcon size={26} aria-hidden="true" />}
          title={t("post.notFoundTitle")}
          description={t("post.notFoundDescription")}
        />
      ) : (
        <>
        <PageHeader
          title={post.title}
          subtitle={`${post.author?.username || post.author?.team_name || "?"}${post.author?.team_name && post.author?.username ? ` · ${post.author.team_name}` : ""} · ${t(`categories.${post.category}`)} · ${formatForumDate(post.created_at, language)}`}
        />
        <SectionStack>
          <Section>
            {post.is_pinned && (
              <div className="mb-2 font-data text-2xs uppercase tracking-[.08em] text-cz-accent-t">{t("post.pinnedTag")}</div>
            )}
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-cz-1">{post.body}</p>
            {poll && <PollBlock poll={poll} onVote={handleVote} voting={voting} t={t} />}
            <div className="mt-4 flex items-center gap-2 border-t border-cz-border pt-3">
              {!post.is_mine && (
                <Button variant="ghost" size="sm" onClick={() => setReportTarget({ type: "post", id: post.id })}>
                  {t("post.report")}
                </Button>
              )}
              {isAdmin && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => handleAdminPin(!post.is_pinned)}>
                    {post.is_pinned ? t("post.unpin") : t("post.pin")}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleAdminDelete("post", post.id)}>
                    {t("post.delete")}
                  </Button>
                </>
              )}
            </div>
          </Section>

          <Section>
            <SectionHeader title={t("post.repliesHeading")} />
            {replies.length === 0 ? (
              <p className="py-2 text-[13px] text-cz-2">{t("post.noReplies")}</p>
            ) : (
              <div className="divide-y divide-cz-border">
                {replies.map((reply) => (
                  <div key={reply.id} className="py-[13px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <AuthorLine author={reply.author} createdAt={reply.created_at} language={language} t={t} />
                        <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-cz-1">{reply.body}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!reply.is_mine && (
                          <Button variant="ghost" size="sm" onClick={() => setReportTarget({ type: "reply", id: reply.id })}>
                            {t("post.report")}
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant="danger" size="sm" onClick={() => handleAdminDelete("reply", reply.id)}>
                            {t("post.delete")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleReply} className="mt-4 flex flex-col gap-3 border-t border-cz-border pt-4">
              <Field label={t("post.replyLabel")} htmlFor="forum-reply-body">
                <Textarea
                  id="forum-reply-body"
                  rows={3}
                  value={replyBody}
                  disabled={replySubmitting}
                  maxLength={BODY_MAX}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder={t("post.replyPlaceholder")}
                />
              </Field>
              {replyError && <p className="text-xs text-cz-danger">{replyError}</p>}
              <div className="flex justify-end">
                <Button type="submit" variant="primary" size="sm" loading={replySubmitting} disabled={replySubmitting || !replyBody.trim()}>
                  {t("post.replySubmit")}
                </Button>
              </div>
            </form>
          </Section>
        </SectionStack>
        </>
      )}

      <ReportModal
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        onSubmit={submitReport}
        t={t}
      />
    </div>
  );
}
