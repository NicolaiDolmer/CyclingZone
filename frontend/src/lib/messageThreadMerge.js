// #3200 · Hvordan en netop hentet side beskeder sættes sammen med det der
// allerede står på skærmen i en DM-tråd.
//
// Reglen er subtil nok til at fortjene sin egen fil og sine egne tests: den
// blev forkert to gange under review. Første udgave erstattede altid, så
// "vis ældre beskeder" blev rullet tilbage af næste poll-tick. Anden udgave
// flettede altid, og så kunne en besked ALDRIG forsvinde igen — hvilket brød
// blokeringen, for en blokeret afsenders beskeder skal netop forsvinde fra
// modtagerens visning.
//
// Ren funktion uden DOM-afhængighed, så den kan testes med node --test.

/**
 * @param {Array<{id: string, createdAt: string}>} previous det der står nu
 * @param {Array<{id: string, createdAt: string}>} page den hentede side
 * @param {{ before?: string|null, hasMore?: boolean }} opts
 *   `before` = siden er ÆLDRE end alt vi har (fra "vis ældre").
 *   `hasMore` = serveren siger der findes mere bagud end denne side.
 * @returns {Array} beskederne i kronologisk orden
 */
export function combineThreadMessages(previous, page, { before = null, hasMore = false } = {}) {
  const next = page || [];
  const prev = previous || [];

  // Den nyeste side uden mere bagud ER hele samtalen. Den erstatter alt —
  // også beskeder der er forsvundet, fordi modtageren har blokeret afsenderen.
  if (!before && !hasMore) return next;

  // En ældre side prependes til det vi har.
  if (before) {
    const byId = new Map();
    for (const message of [...next, ...prev]) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  // Den nyeste side med mere bagud er autoritativ for SIT tidsrum: alt fra
  // dens første besked og frem kommer derfra, resten er ældre sider vi
  // allerede har hentet.
  if (next.length === 0) return [];
  const boundary = Date.parse(next[0].createdAt);
  return [...prev.filter(m => Date.parse(m.createdAt) < boundary), ...next];
}
