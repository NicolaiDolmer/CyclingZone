import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button, Modal, Textarea, MessageIcon } from "../ui";
import MessageQuote from "./MessageQuote.jsx";
import { fetchConversationWithTeam, sendMessage } from "../../lib/messagesApi";
import { useMyTeamId } from "../../hooks/useMyTeamId.js";

// #3200 · Den ene indgang til en samtale, genbrugt alle de steder ejeren bad
// om den: managerprofilen, forfatternavnet i forummet, og "Skriv til
// modparten" på et transfertilbud og en auktion.
//
// Adfærd:
//   - Med et `context` (en handel) åbnes altid skrivefeltet, så citatet lander
//     på beskeden. Det er hele pointen med knappen på tilbuddet.
//   - Uden `context` springer vi direkte til en eksisterende samtale, hvis der
//     er en. Der er ingen grund til at lægge en dialog foran en tråd der
//     allerede findes.
//
// Der oprettes ALDRIG en tom tråd: samtalen fødes først når nogen skriver.
//
// `variant="link"` bruges i forummets forfatterlinje, hvor knappen skal være
// et diskret link mellem de andre meta-elementer, ikke en handlingsknap.
export default function MessageManagerButton({
  teamId,
  managerName,
  context = null,
  variant = "secondary",
  size = "sm",
  className = "",
}) {
  // `messages` er et lazy namespace (INLINE_EXEMPT i
  // scripts/i18n-check-namespace-inline.mjs), og denne knap sidder på flader
  // der IKKE selv gater på det (managerprofil, forum, transfers). Uden
  // ready-tjekket ville knappen vise en rå nøgle i det korte vindue før
  // namespacet er hentet — useSuspense er slået fra.
  const { t, ready } = useTranslation("messages");
  const navigate = useNavigate();
  const myTeamId = useMyTeamId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const name = managerName || "";

  function goToThread(conversationId) {
    navigate(`/notifications?tab=messages&c=${conversationId}`);
  }

  async function handleClick() {
    if (busy) return;
    setError(null);
    if (context) { setOpen(true); return; }
    setBusy(true);
    try {
      const found = await fetchConversationWithTeam(teamId);
      if (found?.conversationId) goToThread(found.conversationId);
      else setOpen(true);
    } catch {
      // Kunne ikke slå samtalen op — lad spilleren skrive alligevel frem for
      // at spærre knappen på et opslag der ikke er handlingen.
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendMessage({ recipientTeamId: teamId, body, context });
      setOpen(false);
      setDraft("");
      goToThread(result.conversationId);
    } catch {
      setError(t("thread.sendError"));
    } finally {
      setBusy(false);
    }
  }

  // Ingen knap paa eget indlaeg eller egen profil: man skriver ikke til sig
  // selv, og backenden ville i oevrigt afvise det med 400.
  if (!ready || !teamId || teamId === myTeamId) return null;

  const label = context ? t("start.dealButton") : t("start.button");

  return (
    <>
      {variant === "link" ? (
        <button
          type="button"
          onClick={handleClick}
          aria-label={t("start.buttonAria", { name })}
          className={`normal-case transition-colors hover:text-cz-accent-t ${className}`}
        >
          {t("start.forumLink")}
        </button>
      ) : (
        <Button
          variant={variant}
          size={size}
          onClick={handleClick}
          disabled={busy}
          aria-label={t("start.buttonAria", { name })}
          className={className}
        >
          <MessageIcon size={13} aria-hidden="true" />{label}
        </Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("start.title", { name })}>
        <form onSubmit={handleSend}>
          {context && <MessageQuote context={context} t={t} />}
          <Textarea
            rows={4}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            maxLength={2000}
            placeholder={t("start.placeholder")}
            aria-label={t("start.placeholder")}
          />
          {error && <p className="mt-1.5 text-xs text-cz-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("start.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy || !draft.trim()}>
              {t("start.send")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
