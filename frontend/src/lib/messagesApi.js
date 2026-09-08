// #3200 · Klient-laget til beskeder mellem managers.
//
// Alt går gennem backenden (/api/messages), aldrig direkte mod PostgREST:
// blok-tjek og rate-limit findes kun der, og `authenticated` har bevidst ingen
// INSERT på dm_messages (database/2026-09-08-3200-manager-dm.sql).
//
// Hver funktion kaster en Error med `.errorCode` sat, så kaldestedet kan slå
// en oversat tekst op i `errors:api.<code>` frem for at vise backendens
// engelske fallback-streng.

import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi

const API = import.meta.env.VITE_API_URL;

// `path` er den FULDE sti og skrives ordret paa hvert kaldested, ikke som et
// suffiks paa et faelles praefiks. Det er ikke kosmetik:
// feature-liveness-auditens detector B (backend/scripts/audit-feature-liveness.js)
// finder frontendens kaldere ved at laese kildeteksten efter selve sti-literalen.
// Da praefikset blev sat sammen i fetch-kaldet, saa den kun eet wildcard-segment
// og flagede alle ni DM-endpoints som doed API. Literalen paa kaldestedet er
// dermed selve beviset for at endpointet har en kalder.
async function call(path, { method = "GET", body = null } = {}) {
  const headers = await authHeaders({ json: Boolean(body) });
  if (!headers) {
    const err = new Error("Not signed in");
    err.errorCode = "unauthorized";
    throw err;
  }
  // fetch() REJECTER ved netværksudfald (mobil-WebKit: "TypeError: Load
  // failed"). Uden denne oversættelse ville hver enkelt kalder skulle skelne
  // mellem "netværket faldt ud" og "backenden sagde nej" — her bliver begge
  // til den samme Error med en errorCode, som kaldestederne allerede fanger og
  // viser som en fejltekst (#3628).
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    const err = new Error("Network request failed", { cause });
    err.errorCode = "network";
    throw err;
  }
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
  return call("/api/messages/conversations");
}

export function fetchUnreadSummary() {
  return call("/api/messages/unread-count");
}

export function fetchThread(conversationId, { before = null, limit = null } = {}) {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  return call(`/api/messages/conversations/${conversationId}${query ? `?${query}` : ""}`);
}

/** Slår modparten op ud fra HOLDET (den id managerprofilen og forummet kender). */
export function fetchConversationWithTeam(teamId) {
  return call(`/api/messages/with/${teamId}`);
}

/**
 * `context` bæres kun med på den FØRSTE besked fra "Skriv til modparten" og
 * citerer handlen: { kind, refId, riderName, amount, occurredAt }. Backenden
 * kaster ukendte felter væk.
 */
export function sendMessage({ conversationId = null, recipientTeamId = null, body, context = null }) {
  return call("/api/messages/send", { method: "POST", body: { conversationId, recipientTeamId, body, context } });
}

export function markThreadRead(conversationId) {
  return call(`/api/messages/conversations/${conversationId}/read`, { method: "POST" });
}

export function hideThread(conversationId) {
  return call(`/api/messages/conversations/${conversationId}/hide`, { method: "POST" });
}

export function reportThread(conversationId, reason) {
  return call(`/api/messages/conversations/${conversationId}/report`, { method: "POST", body: { reason } });
}

// Ét af de to felter er nok. Traaden sender `conversationId`, fordi modparten
// kan mangle et hold og dermed et `teamId` (CodeRabbit 8/9); profilen og
// forumnavnet sender `teamId`, fordi samtalen maaske ikke findes endnu.
export function setBlocked({ teamId, conversationId }, blocked) {
  return call("/api/messages/block", { method: "POST", body: { teamId, conversationId, blocked } });
}
