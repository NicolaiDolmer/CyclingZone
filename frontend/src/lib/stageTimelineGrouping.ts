// #6137: saml gentagne, ens hændelser på samme km til ÉN linje i løbsfilmen.
//
// Motoren emitterer ét event pr. absorberet gruppe (group_merged), pr. hold
// (gc_reaction) og pr. rytter (finale_attack). Efter en finale kan samme km
// bære over tyve ens linjer. Samlingen sker KUN i visningen: motoren og den
// persisterede tidslinje er uændrede, så det virker også på etaper der allerede
// er kørt. Ren afledning, ingen DOM og ingen IO.
//
// Regel: samme type + samme km (+ samme status hvor typen har status) bliver én
// linje med antal. Én hændelse vises uændret. Spillerens EGNE ryttere/hold
// forsvinder aldrig i en samlet linje: en hændelse der rører en egen rytter
// står altid som sin egen, uændrede linje, og den samlede linje tæller kun de
// øvrige ("N andre ...").

export type FilmEvent = { type?: string; km?: number; params?: Record<string, unknown> };

export type GroupedFilmEvent = FilmEvent & {
  grouped?: { count: number; scope: "all" | "others"; events: FilmEvent[] };
};

/** Params for en samlet linje: kun antal/omfang og evt. navne, aldrig motor-tal. */
export type GroupedFilmParams = { count: number; scope: "all" | "others"; riders?: string };
export type GroupedFilmCopy = { key: string; params: GroupedFilmParams };

/** Type-guard: er en beskrevet filmlinje en samlet linje (bærer count + scope)? */
export function isGroupedCopy(line: { key: string; params: unknown } | null | undefined): line is GroupedFilmCopy {
  const p = line?.params;
  if (typeof p !== "object" || p === null) return false;
  const { count, scope } = p as Record<string, unknown>;
  return typeof count === "number" && (scope === "all" || scope === "others");
}

// Over dette antal navne bliver en samlet angrebs-linje et tællertal; en linje
// med ti navne er ikke en broadcast-linje.
const MAX_NAMED_RIDERS = 4;

const GC_STATUSES = new Set(["started", "stopped", "exhausted", "unavailable"]);

function paramsOf(event: FilmEvent): Record<string, unknown> {
  return event.params ?? {};
}

/**
 * Grupperings-nøglen for en hændelse, eller null hvis typen ikke samles.
 * Kun typer hvor ens gentagelser er støj; hændelser der bærer en navngiven
 * rytters skæbne (uheld, KOM, spurt, GC-skift) samles aldrig.
 */
function groupKey(event: FilmEvent): string | null {
  const p = paramsOf(event);
  switch (event.type) {
    case "group_merged":
      return "group_merged";
    case "peloton_splits":
      return "peloton_splits";
    case "finale_attack":
      // Afgørelsen (stage_decided) og nedkørsels-angreb med rytterlister
      // beskrives af egne linjer og samles ikke her.
      if (p.kind === "stage_decided" || p.direction === "descent") return null;
      return p.rider_id != null ? "finale_attack" : null;
    case "gc_reaction": {
      const status = String(p.status ?? "");
      if (!GC_STATUSES.has(status)) return null;
      // "stopper fordi truslen er under kontrol" er en anden linje end "stopper".
      return `gc_reaction:${status}${status === "stopped" && p.reason === "contained" ? ":contained" : ""}`;
    }
    default:
      return null;
  }
}

/** Alle rytter-id'er en hændelse nævner, så en egen rytter altid kan genkendes. */
function mentionedRiderIds(event: FilmEvent): unknown[] {
  const p = paramsOf(event);
  return [p.rider_id, p.protected_rider_id, ...(Array.isArray(p.rider_ids) ? p.rider_ids : [])].filter((id) => id != null);
}

/**
 * Samler gentagne hændelser i en feed-liste (sorteret efter km). Den samlede
 * linje står på første medlems plads; den bærer `grouped` så describeEvent kan
 * skrive den, og beholder første medlems type/params, så en forbruger der ikke
 * kender `grouped` stadig viser en sand linje.
 */
export function groupRepeatedFeedEvents(
  events: FilmEvent[] | null | undefined,
  { ownRiderIds = [] }: { ownRiderIds?: Iterable<unknown> | null } = {},
): GroupedFilmEvent[] {
  const list = events ?? [];
  const own = new Set<unknown>(ownRiderIds ?? []);
  const isOwn = (event: FilmEvent) => own.size > 0 && mentionedRiderIds(event).some((id) => own.has(id));

  const buckets = new Map<string, FilmEvent[]>();
  const ownKeys = new Set<string>();
  const bucketKeyOf = (event: FilmEvent): string | null => {
    const key = groupKey(event);
    return key === null ? null : `${event.km}|${key}`;
  };
  for (const event of list) {
    const bucketKey = bucketKeyOf(event);
    if (bucketKey === null) continue;
    if (isOwn(event)) { ownKeys.add(bucketKey); continue; }
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(event); else buckets.set(bucketKey, [event]);
  }

  const out: GroupedFilmEvent[] = [];
  const emitted = new Set<string>();
  for (const event of list) {
    const bucketKey = bucketKeyOf(event);
    const bucket = bucketKey === null || isOwn(event) ? undefined : buckets.get(bucketKey);
    if (bucketKey === null || !bucket || bucket.length < 2) { out.push(event); continue; }
    if (emitted.has(bucketKey)) continue;
    emitted.add(bucketKey);
    out.push({
      ...event,
      grouped: { count: bucket.length, scope: ownKeys.has(bucketKey) ? "others" : "all", events: bucket },
    });
  }
  return out;
}

const GC_BATCH_KEY: Record<string, string> = {
  started: "gc_reaction_batch_started",
  stopped: "gc_reaction_batch_stopped",
  exhausted: "gc_reaction_batch_exhausted",
  unavailable: "gc_reaction_batch_no_workers",
};

/**
 * Filmlinje for en samlet hændelse (`event.grouped`). Samme kontrakt som
 * describeEvent: { key, params } eller null. Kun antal, aldrig tal fra motoren;
 * angreb navngives når alle navne kendes og listen er kort (#4026: aldrig et
 * råt id).
 */
export function describeGroupedEvent(
  event: GroupedFilmEvent,
  nameOf: (id: unknown) => string | null,
): GroupedFilmCopy | null {
  const grouped = event.grouped;
  if (!grouped) return null;
  const { count, scope } = grouped;
  const p = paramsOf(event);
  switch (event.type) {
    case "group_merged":
      return { key: "group_merged_batch", params: { count, scope } };
    case "peloton_splits":
      return { key: "peloton_split_batch", params: { count, scope } };
    case "finale_attack": {
      const names = grouped.events.map((e) => nameOf(paramsOf(e).rider_id));
      if (scope === "all" && count <= MAX_NAMED_RIDERS && names.every(Boolean)) {
        return { key: "finale_attack_named_batch", params: { riders: names.join(", "), count, scope } };
      }
      return { key: "finale_attack_batch", params: { count, scope } };
    }
    case "gc_reaction": {
      const status = String(p.status ?? "");
      const key = status === "stopped" && p.reason === "contained" ? "gc_reaction_batch_contained" : GC_BATCH_KEY[status];
      return key ? { key, params: { count, scope } } : null;
    }
    default:
      return null;
  }
}
