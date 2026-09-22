// Formvagt for `/api/inbox/pending`-svaret som useActionSummary gemmer i state.
//
// CYCLINGZONE-66/67 (22/9): apiFetch returnerer `data: null` når et 2xx-svar
// ikke kan parses som JSON (tom/afbrudt krop). Før #5372 kastede
// `await res.json()` i samme situation, så state blev stående; efter
// migreringen landede `null` i state, og Layout (`pending.counts.total`) og
// NotificationsPage (`pending.transfer_offers.map`) crashede i ErrorBoundary.
//
// Returnerer et gyldigt summary, eller null hvis svaret ikke har formen —
// kaldstedet beholder så den forrige tilstand.
export function normalizeActionSummary(data) {
  if (!data || typeof data !== "object") return null;
  const transfer_offers = Array.isArray(data.transfer_offers) ? data.transfer_offers : null;
  const swap_offers = Array.isArray(data.swap_offers) ? data.swap_offers : null;
  if (!transfer_offers || !swap_offers) return null;
  const counts = data.counts && typeof data.counts === "object" ? data.counts : {};
  const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  const t = num(counts.transfer_offers, transfer_offers.length);
  const s = num(counts.swap_offers, swap_offers.length);
  return {
    ...data,
    transfer_offers,
    swap_offers,
    counts: { ...counts, transfer_offers: t, swap_offers: s, total: num(counts.total, t + s) },
  };
}
