// #2832-review (fund 2) · POST /admin/seasons/:id/end returnerer nu
// `season_ended_notifications` ({ eligible, delivered, deduped, failed } eller
// { skipped: true, reason } hvis selve emit-kaldet kastede — se
// backend/routes/api.js). Uden dette var success-toasten i AdminSeasonTab.jsx
// blind for et 0-delivered-scenarie — ejeren ville se "✅ Sæson afsluttet"
// selvom INGEN spiller fik beskeden. Ren funktion (ikke JSX) så den kan
// importeres af et almindeligt `node --test` uden en JSX-transform, og testes
// isoleret uden at rendere komponenten (seasonEndedToast.test.js).
//
// Admin-only tekst (samme policy som useAdminAuth.js i denne mappe) —
// components/admin/** er policy-exempt fra i18n-check-lib-strings.mjs
// (ikke player-facing, bag admin-guard).

/**
 * @param {{eligible?: number, delivered?: number, deduped?: number, failed?: number, skipped?: boolean, reason?: string}|null|undefined} stats
 * @returns {[string] | [string, "error"]} argumenter til showMsg(text, type?)
 */
export function formatSeasonEndedToast(stats) {
  if (!stats || typeof stats !== "object") return ["✅ Sæson afsluttet"];
  if (stats.skipped) {
    return [`⚠️ Sæson afsluttet — notifikationer IKKE sendt (${stats.reason || "fejl"})`, "error"];
  }
  const eligible = stats.eligible ?? 0;
  const delivered = stats.delivered ?? 0;
  if (eligible === 0) return ["✅ Sæson afsluttet — ingen menneske-hold at notificere"];
  if (delivered === 0) return [`⚠️ Sæson afsluttet — 0/${eligible} notificeret`, "error"];
  return [`✅ Sæson afsluttet — ${delivered}/${eligible} notificeret`];
}
