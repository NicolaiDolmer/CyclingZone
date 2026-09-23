// #5417: destinationen for "Vis detaljer"-knappen i bunden af en UDFOLDET
// aggregat-linje i indbakken.
//
// #5384 samlede et afviklet løbs race_result/stage_result + career_milestone
// til ÉN linje pr. løb (bøtten "race_completed" i lib/groupNotifications.js).
// Knappen tog destinationen direkte fra TYPE_CONFIG[entry.type].link, som for
// resultat-typerne er den generiske fallback "/resultater" (resultat-hubben).
// Den enkelte race_result-besked har altid deep-linket til /races/:raceId
// (#1952/#3243 i lib/notificationLink.js), men den regel kom aldrig med over i
// den samlede linje. Spilleren landede derfor på hubben og måtte selv finde
// løbet via Race Centre (rapporteret fra telefon 19/9).
//
// Bøtten ER løbet: groupNotifications nøgler den på related_id, som alle tre
// typer sætter til race.id. Knappen går derfor altid til løbssiden, uanset om
// linjens ansigt er resultatet eller (uden resultat i bøtten) en milepæl.
// Løbssiden viser selv karriere-momenterne for løbet under hero'en.
//
// Alle andre bøtter (auktioner, bud) beholder deres generiske TYPE_CONFIG-link.

export type AggregateLinkEntry = {
  group?: string | null;
  related_id?: string | null;
  sample_metadata?: { raceId?: unknown } | null;
};

export function resolveAggregateLink(
  entry: AggregateLinkEntry | null | undefined,
  fallbackLink: string | null | undefined,
): string | null {
  if (entry?.group === "race_completed") {
    const metaRaceId = entry.sample_metadata?.raceId;
    const raceId = entry.related_id || (typeof metaRaceId === "string" && metaRaceId ? metaRaceId : null);
    if (raceId) return `/races/${raceId}`;
  }
  return fallbackLink ?? null;
}
