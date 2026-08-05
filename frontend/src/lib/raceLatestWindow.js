// #3333 — LATEST_LIMIT (ResultaterPage.jsx) skærer "Seneste"-vinduet til et fast
// antal kort, sorteret nyeste-først. Et etapeløb optager langt flere datosloter
// end et endagsløb (Vuelta Ibérica: 21 dage), så det kan i praksis skubbe HELE
// den anden løbstype ud af vinduet — verificeret mod prod-data 2026-08-04
// (Division 1 pulje 0: 10 løb i det fulde vindue, top-9 udelod et færdigt
// 6-etapes løb der ellers var repræsenteret). Uden en garanti kan en manager
// derfor opleve at fx alle endagsløb "forsvinder" bare fordi et par etapeløb
// fylder mange dato-pladser.
//
// capLatestRaces garanterer at MINDST ét løb af hver race_type der findes i den
// fulde, sorterede liste er repræsenteret i det afkortede vindue: mangler en
// type efter den normale afskæring, byttes den ÆLDSTE post i vinduet ud med den
// nyeste af den manglende type (bevarer så mange nyeste poster som muligt,
// ofrer kun så få pladser som nødvendigt). Pure → testbar uden UI.

/**
 * @template {{ id: string, race_type?: string|null }} T
 * @param {T[]} sortedRaces - allerede sorteret nyeste-først (sortRacesByDateDesc)
 * @param {number} limit
 * @returns {T[]} ny array, længde <= limit, med alle repræsenterede race_type'er bevaret hvis muligt
 */
export function capLatestRaces(sortedRaces, limit) {
  const races = Array.isArray(sortedRaces) ? sortedRaces : [];
  if (!Number.isFinite(limit) || limit <= 0) return [];
  if (races.length <= limit) return races.slice();

  const capped = races.slice(0, limit);
  const cappedIds = new Set(capped.map((r) => r.id));
  const representedTypes = new Set(capped.map((r) => r.race_type));
  const allTypes = [...new Set(races.map((r) => r.race_type))];
  const missingTypes = allTypes.filter((t) => !representedTypes.has(t));

  let replaceFromEnd = 1;
  for (const type of missingTypes) {
    const newest = races.find((r) => r.race_type === type && !cappedIds.has(r.id));
    if (!newest) continue;
    const idx = capped.length - replaceFromEnd;
    if (idx < 0) break; // flere manglende typer end pladser at ofre — behold hvad vi nåede
    cappedIds.delete(capped[idx].id);
    capped[idx] = newest;
    cappedIds.add(newest.id);
    replaceFromEnd += 1;
  }
  return capped;
}
