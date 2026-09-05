// #4557 · Bonustilbuddets accept/afslag (BOARD_RULES §4, lag 6), udtrukket fra
// BoardPage.jsx så den gamle bestyrelsesside og den nye Boardroom rammer
// PRÆCIS de samme to endpoints med præcis den samme body.
//
// INGEN ny mekanik og ingen ny rute: `POST /api/board/bonus-offer/accept` og
// `/decline` er dem der allerede findes (backend/routes/api.js).
//
// #4348: bruger den KANONISKE authHeaders() (lib/supabase.ts) — enforced af
// authHeadersCanonical.4348.test.js (ingen ny lokal kopi tilladt).
import { authHeaders } from "../../lib/supabase";

const API = import.meta.env.VITE_API_URL;

/**
 * @param {"accept"|"decline"} action
 * @param {string} offerId  board_consequences.id for lag 6-rækken
 * @returns {Promise<{ ok: boolean, data: object|null }>} `ok:false` uden at kaste,
 *          så kalderen selv bestemmer fejl-visningen (BoardPage logger, Boardroom
 *          viser en linje i striben).
 */
export async function postBonusOfferAction(action, offerId) {
  if (!offerId) return { ok: false, data: null };
  const headers = await authHeaders();
  if (!headers) return { ok: false, data: null };

  let res;
  try {
    res = await fetch(`${API}/api/board/bonus-offer/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ offer_id: offerId }),
    });
  } catch {
    return { ok: false, data: null };
  }
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}
