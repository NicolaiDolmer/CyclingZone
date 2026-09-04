// #4557 (S-M2c) · Tynde fetch-helpers for aarsmoedet (/board/meeting).
// #4348: bruger den KANONISKE authHeaders() (lib/supabase.ts) — enforced af
// authHeadersCanonical.4348.test.js (ingen ny lokal kopi tilladt).
import { authHeaders } from "../../lib/supabase";

const API = import.meta.env.VITE_API_URL;

// GET /api/board/meeting — { available: false } eller det fulde forslag
// (spec §4.8). Returnerer null ved manglende session/netværksfejl (route-
// guarden falder tilbage til /board, samme sikre fallback som BoardroomRoute).
export async function fetchBoardMeeting() {
  const headers = await authHeaders({ json: false });
  if (!headers) return null;
  try {
    const res = await fetch(`${API}/api/board/meeting`, { headers });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

// GET /api/board/room — kun brugt her for at hente det numeriske
// tillids-tal til sidehovedet (spec §4.8's mandat-payload bærer kun
// `trustTier`, ikke et raat tal — Boardroom viser samme tal to klik tidligere,
// saa dette er ren genbrug, ikke ny data). Fejler kaldet, viser sidehovedet
// justeringerne uden tillids-tallet (progressiv, aldrig blokerende).
export async function fetchBoardRoom() {
  const headers = await authHeaders({ json: false });
  if (!headers) return null;
  try {
    const res = await fetch(`${API}/api/board/room`, { headers });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function postJson(path, body) {
  const headers = await authHeaders();
  if (!headers) return { ok: false, status: 401, data: null };
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: null };
  }
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// POST /api/board/meeting/focus — regenererer forslaget, nulstiller
// justeringerne server-side (spec §4.8).
export function postBoardMeetingFocus(focus) {
  return postJson("/api/board/meeting/focus", { focus });
}

// POST /api/board/meeting/sign — hele valget i ét kald (spec §4.5).
export function postBoardMeetingSign(payload) {
  return postJson("/api/board/meeting/sign", payload);
}
