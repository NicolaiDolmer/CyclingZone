// #3200 · Klient-laget til beskeder mellem managers.
//
// Alt går gennem backenden (/api/messages), aldrig direkte mod PostgREST:
// blok-tjek og rate-limit findes kun der, og `authenticated` har bevidst ingen
// INSERT på dm_messages (database/2026-09-08-3200-manager-dm.sql).
//
// Hver funktion kaster en Error med `.errorCode` sat, så kaldestedet kan slå
// en oversat tekst op i `errors:api.<code>` frem for at vise backendens
// engelske fallback-streng.

import { supabase } from "./supabase";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

async function call(path, { method = "GET", body = null } = {}) {
  const headers = await authHeaders();
  if (!headers) {
    const err = new Error("Not signed in");
    err.errorCode = "unauthorized";
    throw err;
  }
  const res = await fetch(`${API}/api/messages${path}`, {
    method,
    headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const err = new Error(payload?.error || `Request failed (${res.status})`);
    err.errorCode = payload?.errorCode || null;
    err.status = res.status;
    throw err;
  }
  return payload;
}

export function fetchConversations() {
  return call("/conversations");
}

export function fetchUnreadSummary() {
  return call("/unread-count");
}

export function fetchThread(conversationId, { before = null, limit = null } = {}) {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  return call(`/conversations/${conversationId}${query ? `?${query}` : ""}`);
}

/** Slår modparten op ud fra HOLDET (den id managerprofilen og forummet kender). */
export function fetchConversationWithTeam(teamId) {
  return call(`/with/${teamId}`);
}

/**
 * `context` bæres kun med på den FØRSTE besked fra "Skriv til modparten" og
 * citerer handlen: { kind, refId, riderName, amount, occurredAt }. Backenden
 * kaster ukendte felter væk.
 */
export function sendMessage({ conversationId = null, recipientTeamId = null, body, context = null }) {
  return call("/send", { method: "POST", body: { conversationId, recipientTeamId, body, context } });
}

export function markThreadRead(conversationId) {
  return call(`/conversations/${conversationId}/read`, { method: "POST" });
}

export function hideThread(conversationId) {
  return call(`/conversations/${conversationId}/hide`, { method: "POST" });
}

export function reportThread(conversationId, reason) {
  return call(`/conversations/${conversationId}/report`, { method: "POST", body: { reason } });
}

export function setBlocked(teamId, blocked) {
  return call("/block", { method: "POST", body: { teamId, blocked } });
}
