import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { supabase, authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch.js";
import {
  Button, PageHeader, Section, SectionStack, SectionHeader, EmptyState, ErrorState,
  SkeletonLines, Modal, Field, Input, Textarea,
} from "../components/ui";
import { InboxIcon } from "../components/ui/icons/index.jsx";
import FounderMark from "../components/FounderMark.jsx";

// #3199 — Forum v1 (plan låst 6/8): to kategorier (General · Feedback & ideas),
// opslag + svar-tråde, ejer-opslag kan pinnes og bære afstemninger. T1 standard
// content (docs/design/PAGE_TEMPLATES.md): max-w-4xl, sektionskort, én gold
// primary ("New post"), hairline-borders, tabular figures på al numerik.
//
// Data læses via backend-API (service-role bag requireAuth) — RLS på
// forum-tabellerne tillader ikke klient-queries til andet end Realtime-events,
// som her kun bruges som refetch-trigger (useRealtimeRefetch-mønstret).

const API = import.meta.env.VITE_API_URL;
const CATEGORIES = ["general", "feedback_ideas"];
const TITLE_MAX = 120;
const BODY_MAX = 4000;
// Modul-konstant: en inline-array ville re-subscribe Realtime-kanalen hver render.
const FORUM_TABLES = ["forum_posts", "forum_replies"];

export function formatForumDate(iso, language) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(language === "da" ? "da-DK" : "en-GB", {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PostRow({ post, t, language }) {
  return (
    <Link
      to={`/forum/${post.id}`}
      className="block py-[13px] transition-colors hover:bg-cz-subtle -mx-2 px-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {/* #4118/#3451: gul prik — samme markup/farve som nav-prikken
              (Layout.jsx), ikke et nyt visuelt sprog. Kun dekorativ; den
              egentlige "ulæst"-status kommunikeres til skærmlæsere via
              sr-only-teksten. */}
          {post.is_unread && (
            <span className="flex-shrink-0" title={t("list.unread")}>
              <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-cz-accent" />
              <span className="sr-only">{t("list.unread")}</span>
            </span>
          )}
          <span className={`min-w-0 truncate text-[13.5px] text-cz-1 ${post.is_unread ? "font-semibold" : "font-medium"}`}>
            {post.title}
          </span>
        </span>
        <span className="shrink-0 font-data text-2xs tabular-nums text-cz-3">
          {t("list.replies", { count: post.reply_count })}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 font-data text-2xs uppercase tracking-[.04em] text-cz-3">
        {post.is_pinned && <span className="text-cz-accent-t">{t("post.pinnedTag")}</span>}
        {post.has_poll && <span className="text-cz-accent-t">{t("list.poll")}</span>}
        <span className="truncate">
          {t("list.by", { name: post.author?.username || post.author?.team_name || "?" })}
        </span>
        {/* #4649: Founder-mærke ved forfatterlinjen. */}
        <FounderMark teamId={post.author?.team_id} />
        <span>·</span>
        <span>{t(`categories.${post.category}`)}</span>
        <span>·</span>
        <span className="tabular-nums">{formatForumDate(post.created_at, language)}</span>
      </div>
    </Link>
  );
}

function ComposeModal({ open, onClose, onCreated, isAdmin, defaultCategory, t, tError }) {
  const [category, setCategory] = useState(defaultCategory || "general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pollText, setPollText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) setCategory(CATEGORIES.includes(defaultCategory) ? defaultCategory : "general");
  }, [open, defaultCategory]);

  function handleClose() {
    if (submitting) return;
    onClose?.();
    setTimeout(() => {
      setTitle("");
      setBody("");
      setPollText("");
      setError(null);
    }, 200);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers || !API) {
        setError(t("errors.submitFailed"));
        return;
      }
      const pollOptions = pollText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const res = await fetch(`${API}/api/forum/posts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          category,
          title: title.trim(),
          body: body.trim(),
          ...(isAdmin && pollOptions.length ? { poll_options: pollOptions } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(tError(data?.errorCode));
        return;
      }
      handleClose();
      onCreated?.(data?.id);
    } catch {
      setError(t("errors.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} size="md" ariaLabelledby="forum-compose-title">
      <div className="mb-4">
        <h2 id="forum-compose-title" className="font-display text-2xl leading-none tracking-[.01em] text-cz-1">
          {t("compose.title")}
        </h2>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t("compose.categoryLabel")}>
          <div role="group" aria-label={t("compose.categoryLabel")} className="inline-flex rounded border border-cz-border overflow-hidden">
            {CATEGORIES.map((key) => (
              <button
                key={key}
                type="button"
                disabled={submitting}
                onClick={() => setCategory(key)}
                aria-pressed={category === key}
                className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  category === key ? "bg-cz-accent text-cz-on-accent" : "text-cz-2 hover:bg-cz-subtle"
                }`}
              >
                {t(`categories.${key}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("compose.titleLabel")} htmlFor="forum-compose-titel">
          <Input
            id="forum-compose-titel"
            value={title}
            disabled={submitting}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("compose.titlePlaceholder")}
          />
        </Field>
        <Field label={t("compose.bodyLabel")} htmlFor="forum-compose-body">
          <Textarea
            id="forum-compose-body"
            rows={6}
            value={body}
            disabled={submitting}
            maxLength={BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("compose.bodyPlaceholder")}
          />
        </Field>
        {isAdmin && (
          <Field label={t("compose.pollLabel")} htmlFor="forum-compose-poll" helper={t("compose.pollHelp")}>
            <Textarea
              id="forum-compose-poll"
              rows={3}
              value={pollText}
              disabled={submitting}
              onChange={(e) => setPollText(e.target.value)}
            />
          </Field>
        )}
        {error && <p className="text-xs text-cz-danger">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={submitting}>
            {t("compose.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={submitting}>
            {t("compose.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ForumPage() {
  const { t, i18n } = useTranslation("forum");
  const { t: tErrors } = useTranslation("errors");
  const [searchParams, setSearchParams] = useSearchParams();
  const category = CATEGORIES.includes(searchParams.get("category")) ? searchParams.get("category") : "";

  const [state, setState] = useState({ status: "loading", pinned: [], items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // #3451: "Markér alle som læst" — sekundær knap (gold er reserveret til
  // "New post"), samme markingAll/loading-mønster som NotificationsPage.
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState(null);

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

  const load = useCallback(async (cursor = null) => {
    if (cursor == null) setState((s) => ({ ...s, status: s.items.length ? "ready" : "loading" }));
    try {
      const headers = await authHeaders();
      if (!headers || !API) throw new Error("no session");
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (cursor != null) params.set("cursor", String(cursor));
      const res = await fetch(`${API}/api/forum/posts?${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState((s) => ({
        status: "ready",
        pinned: cursor == null ? data.pinned || [] : s.pinned,
        items: cursor == null ? data.items || [] : [...s.items, ...(data.items || [])],
        nextCursor: data.next_cursor ?? null,
      }));
    } catch {
      setState((s) => (cursor == null ? { status: "error", pinned: [], items: [], nextCursor: null } : s));
    }
  }, [category]);

  useEffect(() => { load(null); }, [load]);

  // #3451: "Markér alle som læst" skal vises ud fra det SAMME globale signal
  // som nav-prikken (GET /api/forum/unread-status) — ikke den kategori-
  // filtrerede/paginerede liste, som aldrig ser tråde uden for aktuel fane/
  // side. Samme fetch-recipe som Layout.jsx's fetchForumUnread.
  const [hasUnread, setHasUnread] = useState(false);
  const refreshUnread = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers || !API) return;
    try {
      const res = await fetch(`${API}/api/forum/unread-status`, { headers });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (typeof data?.has_unread === "boolean") setHasUnread(data.has_unread);
    } catch { /* ignore — prikken/knappen beholder sidst kendte tilstand */ }
  }, []);
  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  const refetch = useCallback(() => { load(null); refreshUnread(); }, [load, refreshUnread]);
  useRealtimeRefetch("forum-live", FORUM_TABLES, refetch);

  async function handleLoadMore() {
    if (state.nextCursor == null || loadingMore) return;
    setLoadingMore(true);
    await load(state.nextCursor);
    setLoadingMore(false);
  }

  function setCategoryParam(next) {
    setSearchParams(next ? { category: next } : {}, { replace: true });
  }

  async function handleMarkAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    setMarkAllError(null);
    try {
      const headers = await authHeaders();
      if (!headers || !API) throw new Error("no session");
      const res = await fetch(`${API}/api/forum/threads/read-all`, { method: "PATCH", headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Klar prikken lokalt med det samme (ikke reload) — samme
      // is_unread-felt PostRow allerede læser.
      setState((s) => ({
        ...s,
        pinned: s.pinned.map((p) => ({ ...p, is_unread: false })),
        items: s.items.map((p) => ({ ...p, is_unread: false })),
      }));
      setHasUnread(false);
      // Samme window-event som ForumPostPage bruger, så Layout.jsx's
      // nav-prik forsvinder MED DET SAMME i stedet for at vente på næste
      // heartbeat/realtime-tick.
      window.dispatchEvent(new Event("cz:forum-thread-read"));
    } catch {
      setMarkAllError(t("errors.markAllReadFailed"));
    } finally {
      setMarkingAll(false);
    }
  }

  const language = i18n.language;
  const tabs = [
    { key: "", label: t("categories.all") },
    { key: "general", label: t("categories.general") },
    { key: "feedback_ideas", label: t("categories.feedback_ideas") },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        actions={
          <>
            {/* #3451: sekundær — gold er reserveret til "New post" herunder. Kun
                synlig når der rent faktisk er ulæste tråde (samme signal som
                nav-prikken den skal fjerne). */}
            {hasUnread && (
              <Button variant="secondary" size="sm" onClick={handleMarkAllRead}
                loading={markingAll} disabled={markingAll}>
                {markingAll ? t("page.markingAllRead") : t("page.markAllRead")}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => setComposeOpen(true)}>
              {t("page.newPost")}
            </Button>
          </>
        }
      />
      {markAllError && (
        <p role="alert" className="mb-4 text-xs text-cz-danger">{markAllError}</p>
      )}

      <nav className="mb-6 flex gap-1 border-b border-cz-border overflow-x-auto" aria-label={t("compose.categoryLabel")}>
        {tabs.map((tab) => (
          <button
            key={tab.key || "all"}
            type="button"
            onClick={() => setCategoryParam(tab.key)}
            aria-current={category === tab.key ? "page" : undefined}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              category === tab.key
                ? "border-cz-accent text-cz-1"
                : "border-transparent text-cz-3 hover:text-cz-2"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {state.status === "loading" ? (
        <Section><SkeletonLines lines={6} /></Section>
      ) : state.status === "error" ? (
        <Section role="alert">
          <ErrorState
            description={t("errors.loadFailed")}
            action={<Button size="sm" variant="secondary" onClick={() => load(null)}>{t("errors.retry")}</Button>}
          />
        </Section>
      ) : (
        <SectionStack>
          {state.pinned.length > 0 && (
            <Section>
              <SectionHeader title={t("list.pinnedHeading")} />
              <div className="divide-y divide-cz-border">
                {state.pinned.map((post) => (
                  <PostRow key={post.id} post={post} t={t} language={language} />
                ))}
              </div>
            </Section>
          )}
          <Section>
            <SectionHeader title={t("list.latestHeading")} />
            {state.items.length === 0 && state.pinned.length === 0 ? (
              <EmptyState
                icon={<InboxIcon size={26} aria-hidden="true" />}
                title={t("list.emptyTitle")}
                description={t("list.emptyDescription")}
              />
            ) : state.items.length === 0 ? (
              <p className="py-2 text-[13px] text-cz-2">{t("list.emptyDescription")}</p>
            ) : (
              <div className="divide-y divide-cz-border">
                {state.items.map((post) => (
                  <PostRow key={post.id} post={post} t={t} language={language} />
                ))}
              </div>
            )}
            {state.nextCursor != null && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" size="sm" onClick={handleLoadMore} loading={loadingMore} disabled={loadingMore}>
                  {t("list.loadMore")}
                </Button>
              </div>
            )}
          </Section>
        </SectionStack>
      )}

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={() => load(null)}
        isAdmin={isAdmin}
        defaultCategory={category}
        t={t}
        tError={tError}
      />
    </div>
  );
}
