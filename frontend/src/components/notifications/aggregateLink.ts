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
// #7868: en dags bøtte for et etapeløb rummer typisk én eller flere
// stage_result-beskeder, og enkelt-beskeden deep-linker allerede til sin egen
// etape (?stage=N, #5317). Den samlede linje faldt tilbage til det brede
// løbslink og tabte dermed etapen. Linjen åbner nu den SENESTE kørte etape i
// bøtten. Har bøtten et afsluttende race_result (løbet er slut), er hele løbet
// det rigtige mål, så dér bliver linket det brede løbslink.
//
// Alle andre bøtter (auktioner, bud) beholder deres generiske TYPE_CONFIG-link.

export type AggregateLinkEntry = {
  group?: string | null;
  related_id?: string | null;
  sample_metadata?: { raceId?: unknown } | null;
  items?: AggregateLinkItem[] | null;
};

export type AggregateLinkItem = {
  type?: string | null;
  created_at?: string | null;
  metadata?: { stageNumber?: unknown } | null;
};

function stageNumberOf(item: AggregateLinkItem): number | null {
  const raw = item.metadata?.stageNumber;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

// Seneste kørte etape i bøtten, eller null når der ikke er en entydig etape.
function latestStageNumber(items: AggregateLinkItem[] | null | undefined): number | null {
  if (!items || items.length === 0) return null;
  if (items.some((i) => i.type === "race_result")) return null;
  let best: { n: number; at: number } | null = null;
  for (const item of items) {
    if (item.type !== "stage_result") continue;
    const n = stageNumberOf(item);
    if (n == null) continue;
    const at = item.created_at ? Date.parse(item.created_at) : 0;
    const ts = Number.isNaN(at) ? 0 : at;
    if (!best || n > best.n || (n === best.n && ts > best.at)) best = { n, at: ts };
  }
  return best ? best.n : null;
}

export function resolveAggregateLink(
  entry: AggregateLinkEntry | null | undefined,
  fallbackLink: string | null | undefined,
): string | null {
  if (entry?.group === "race_completed") {
    const metaRaceId = entry.sample_metadata?.raceId;
    const raceId = entry.related_id || (typeof metaRaceId === "string" && metaRaceId ? metaRaceId : null);
    if (raceId) {
      const stage = latestStageNumber(entry.items);
      return stage != null ? `/races/${raceId}?stage=${stage}` : `/races/${raceId}`;
    }
  }
  return fallbackLink ?? null;
}
