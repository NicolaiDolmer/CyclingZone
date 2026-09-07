import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Avatar, Button, EmptyState, ErrorState, Dropdown, MenuItem, Modal,
  SkeletonLines, Textarea, MessageIcon, MoreIcon, ChevronLeftIcon,
} from "../ui";
import MessageBody from "./MessageBody.jsx";
import MessageQuote from "./MessageQuote.jsx";
import { formatRelativeTime, formatDateTime } from "../../lib/intl";
import {
  fetchConversations, fetchThread, hideThread, markThreadRead,
  reportThread, sendMessage, setBlocked,
} from "../../lib/messagesApi";

// #3200 · Beskeder-fanen i indbakken: samtaleliste + tråd.
//
// Mobil først (ejeren tester på Android): på små skærme vises ÉN ting ad
// gangen (liste ELLER tråd), på md+ står de side om side. Den åbne tråd bor i
// URL'en (?c=<id>) af samme grund som fanen selv gør det (#3104 etape C):
// deep-linkbar fra en notifikation, og tilbage-knappen gør det man forventer.
//
// REALTIME ER IKKE MED I v1 (bevidst, se PR-body): en åben tråd poller hvert
// 20. sekund. Datamodellen skal ikke ændres for at lægge realtime ovenpå.

const BODY_MAX_LENGTH = 2000;
const THREAD_POLL_MS = 20_000;
const REPORT_REASON_MIN = 10;

function ConversationRow({ conversation, active, onOpen, t }) {
  const name = conversation.otherManagerName || conversation.otherTeamName || "";
  return (
    <button
      type="button"
      onClick={() => onOpen(conversation.id)}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-start gap-3 border-b border-cz-border px-3 py-3 text-start transition-colors hover:bg-cz-subtle ${active ? "bg-cz-subtle" : ""}`}
    >
      <Avatar name={conversation.otherTeamName || name} size="sm" className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13.5px] font-semibold text-cz-1">{name}</span>
          {conversation.lastMessageAt && (
            <span className="shrink-0 font-data text-2xs tabular-nums text-cz-3">
              {formatRelativeTime(conversation.lastMessageAt)}
            </span>
          )}
        </span>
        {conversation.otherTeamName && conversation.otherManagerName && (
          <span className="block truncate font-data text-2xs uppercase tracking-[.06em] text-cz-3">
            {conversation.otherTeamName}
          </span>
        )}
        {conversation.lastMessagePreview && (
          <span className="mt-1 block truncate text-xs text-cz-2">
            {conversation.lastMessageFromMe && <span className="text-cz-3">{t("list.you")}: </span>}
            {conversation.lastMessagePreview}
          </span>
        )}
      </span>
      {conversation.unreadCount > 0 && (
        <span
          aria-label={String(conversation.unreadCount)}
          className="mt-1.5 h-2 w-2 shrink-0 rounded-cz-pill bg-cz-accent"
        />
      )}
    </button>
  );
}

export default function MessagesPanel({ conversationId, onSelectConversation, onUnreadChange }) {
  const { t } = useTranslation("messages");

  const [conversations, setConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);

  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState(null);
  const [reporting, setReporting] = useState(false);

  const bottomRef = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const data = await fetchConversations();
      setConversations(data.conversations || []);
      setListError(false);
      onUnreadChange?.((data.conversations || []).filter(c => c.unreadCount > 0).length);
    } catch {
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadThread = useCallback(async (id, { silent = false } = {}) => {
    if (!silent) setThreadLoading(true);
    try {
      const data = await fetchThread(id);
      setThread(data);
      setThreadError(false);
    } catch {
      if (!silent) setThreadError(true);
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, []);

  // Åbn tråden + markér den læst. Markeringen er best-effort: den må aldrig
  // kunne blokere visningen (samme mønster som forummets trådlæsning).
  useEffect(() => {
    if (!conversationId) { setThread(null); return; }
    setDraft("");
    setSendError(null);
    loadThread(conversationId);
    markThreadRead(conversationId)
      .then(() => loadList())
      .catch(() => {});
  }, [conversationId, loadThread, loadList]);

  // Polling frem for realtime i v1.
  useEffect(() => {
    if (!conversationId) return undefined;
    const timer = setInterval(() => { loadThread(conversationId, { silent: true }); }, THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages?.length]);

  async function handleSend(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    if (body.length > BODY_MAX_LENGTH) {
      setSendError(t("thread.tooLong", { max: BODY_MAX_LENGTH }));
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await sendMessage({ conversationId, body });
      setDraft("");
      await loadThread(conversationId, { silent: true });
      await loadList();
    } catch {
      setSendError(t("thread.sendError"));
    } finally {
      setSending(false);
    }
  }

  async function handleBlockToggle() {
    if (!thread?.conversation) return;
    const next = !thread.conversation.blocked;
    try {
      await setBlocked(thread.conversation.otherTeamId, next);
      setNotice(next ? t("block.done") : t("block.undone"));
      await loadThread(conversationId, { silent: true });
      await loadList();
    } catch {
      setNotice(t("block.error"));
    }
  }

  async function handleHide() {
    try {
      await hideThread(conversationId);
      setNotice(t("hide.done"));
      onSelectConversation(null);
      await loadList();
    } catch {
      setNotice(t("hide.error"));
    }
  }

  async function handleReport(event) {
    event.preventDefault();
    const reason = reportReason.trim();
    if (reason.length < REPORT_REASON_MIN) {
      setReportError(t("report.tooShort", { min: REPORT_REASON_MIN }));
      return;
    }
    setReporting(true);
    setReportError(null);
    try {
      const result = await reportThread(conversationId, reason);
      setReportOpen(false);
      setReportReason("");
      setNotice(result?.alreadyReported ? t("report.alreadyDone") : t("report.done"));
    } catch {
      setReportError(t("report.error"));
    } finally {
      setReporting(false);
    }
  }

  const unreadConversations = conversations.filter(c => c.unreadCount > 0).length;

  if (listError) {
    return <ErrorState description={t("list.loadError")} onRetry={loadList} />;
  }

  if (listLoading) {
    return <SkeletonLines lines={5} />;
  }

  if (conversations.length === 0 && !conversationId) {
    return (
      <EmptyState
        icon={<MessageIcon size={26} aria-hidden="true" />}
        title={t("list.emptyTitle")}
        description={t("list.emptyBody")}
        action={
          <Link to="/global-rank">
            <Button variant="primary" size="sm">{t("list.emptyAction")}</Button>
          </Link>
        }
      />
    );
  }

  const showListOnMobile = !conversationId;

  return (
    <>
      {notice && (
        <p role="status" className="mb-3 border border-cz-border bg-cz-subtle px-3 py-2 text-xs text-cz-2">
          {notice}
        </p>
      )}

      <p className="sr-only">
        {unreadConversations > 0
          ? t("list.subtitle", { count: unreadConversations })
          : t("list.subtitleNone")}
      </p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        {/* Samtaleliste */}
        {/* self-start: listen skal vaere praecis saa hoej som sine raekker.
            Uden den straekker grid'et kortet til traadens hoejde og efterlader
            en tom ramme under den sidste samtale. */}
        <div className={`${showListOnMobile ? "block" : "hidden"} md:block self-start border border-cz-border rounded-cz overflow-hidden bg-cz-card`}>
          {conversations.map(conversation => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === conversationId}
              onOpen={onSelectConversation}
              t={t}
            />
          ))}
        </div>

        {/* Tråd */}
        <div className={`${showListOnMobile ? "hidden" : "block"} md:block`}>
          {!conversationId ? (
            <div className="hidden md:flex h-full min-h-[220px] items-center justify-center border border-cz-border rounded-cz bg-cz-card px-6 text-center">
              <p className="text-sm text-cz-3">{t("thread.emptyBody")}</p>
            </div>
          ) : threadError ? (
            <ErrorState description={t("list.loadError")} onRetry={() => loadThread(conversationId)} />
          ) : threadLoading || !thread ? (
            <SkeletonLines lines={6} />
          ) : (
            <div className="flex flex-col border border-cz-border rounded-cz bg-cz-card">
              {/* Tråd-hoved */}
              <div className="flex items-center gap-2 border-b border-cz-border px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => onSelectConversation(null)}
                  className="md:hidden inline-flex items-center gap-1 text-xs font-medium text-cz-2 transition-colors hover:text-cz-1"
                >
                  <ChevronLeftIcon size={16} />{t("thread.back")}
                </button>
                <Avatar name={thread.conversation.otherTeamName || thread.conversation.otherManagerName || ""} size="sm" className="hidden md:block shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-cz-1">
                    {thread.conversation.otherManagerName || thread.conversation.otherTeamName}
                  </p>
                  {thread.conversation.otherTeamId && (
                    <Link
                      to={`/managers/${thread.conversation.otherTeamId}`}
                      className="font-data text-2xs uppercase tracking-[.06em] text-cz-3 transition-colors hover:text-cz-accent-t"
                    >
                      {thread.conversation.otherTeamName || t("thread.openProfile")}
                    </Link>
                  )}
                </div>
                <Dropdown
                  align="right"
                  trigger={({ open, toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-expanded={open}
                      aria-label={t("menu.label")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
                    >
                      <MoreIcon size={18} />
                    </button>
                  )}
                >
                  <MenuItem onClick={handleBlockToggle}>
                    {thread.conversation.blocked ? t("menu.unblock") : t("menu.block")}
                  </MenuItem>
                  <MenuItem onClick={() => { setReportOpen(true); setReportError(null); }}>
                    {t("menu.report")}
                  </MenuItem>
                  <MenuItem onClick={handleHide}>{t("menu.hide")}</MenuItem>
                </Dropdown>
              </div>

              {thread.conversation.blocked && (
                <p className="border-b border-cz-border bg-cz-subtle px-3 py-2 text-xs text-cz-2">
                  {t("thread.blockedNote")}
                </p>
              )}

              {/* Beskeder */}
              <div className="max-h-[52vh] min-h-[180px] overflow-y-auto px-3 py-3">
                {thread.hasMore && (
                  <div className="mb-3 text-center">
                    <Button variant="secondary" size="sm" onClick={() => loadThread(conversationId)}>
                      {t("thread.loadMore")}
                    </Button>
                  </div>
                )}
                {thread.messages.length === 0 ? (
                  <p className="py-6 text-center text-sm text-cz-3">{t("thread.emptyBody")}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {thread.messages.map(message => (
                      <li key={message.id} className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] border px-3 py-2 rounded-cz ${
                            message.fromMe
                              ? "border-cz-accent/30 bg-cz-accent/8 text-cz-1"
                              : "border-cz-border bg-cz-subtle text-cz-1"
                          }`}
                        >
                          <MessageQuote context={message.context} t={t} />
                          <MessageBody text={message.body} />
                          <p className="mt-1 font-data text-2xs tabular-nums text-cz-3">
                            {formatDateTime(message.createdAt)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Skrivefelt */}
              <form onSubmit={handleSend} className="border-t border-cz-border px-3 py-2.5">
                <Textarea
                  rows={2}
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  maxLength={BODY_MAX_LENGTH}
                  placeholder={t("thread.placeholder")}
                  aria-label={t("thread.placeholder")}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-data text-2xs tabular-nums text-cz-3">
                    {t("thread.counter", { count: draft.length, max: BODY_MAX_LENGTH })}
                  </span>
                  <Button type="submit" variant="primary" size="sm" loading={sending} disabled={sending || !draft.trim()}>
                    {sending ? t("thread.sending") : t("thread.send")}
                  </Button>
                </div>
                {sendError && <p className="mt-1.5 text-xs text-cz-danger">{sendError}</p>}
              </form>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t("report.title")}
        description={t("report.body")}
      >
        <form onSubmit={handleReport}>
          <label htmlFor="dm-report-reason" className="mb-1.5 block text-xs font-semibold text-cz-2">
            {t("report.reasonLabel")}
          </label>
          <Textarea
            id="dm-report-reason"
            rows={3}
            value={reportReason}
            onChange={event => setReportReason(event.target.value)}
            placeholder={t("report.reasonPlaceholder")}
          />
          {reportError && <p className="mt-1.5 text-xs text-cz-danger">{reportError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setReportOpen(false)}>
              {t("report.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={reporting} disabled={reporting}>
              {t("report.confirm")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
