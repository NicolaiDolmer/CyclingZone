// #8045 · Løbsfilmen fortæller angrebet, mens det sker: angrebet, når rytteren kører
// fra gruppen, forspringet ved motorens grænser, og om han bliver hentet, sat eller
// holder. Hver linje står på det sted (og med den løbstid), hvor motoren skrev den.
// Kilde: backend/lib/raceAttackStory8045.js (ren læser af løbsloggen, intet opfundet).
// Bag kontakten attack_story_8045 (seedet off): slukket viser filmen dagens angrebslinjer.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { attackStory8045, attackStoryLines8045, gapParts8045 } from "../../../../backend/lib/raceAttackStory8045.js";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { formatClock, type Cast } from "./stagePageV2/raceStoryModel.ts";

export const ATTACK_STORY_8045_FLAG_KEY = "attack_story_8045";

export type AttackStoryPhase = "started" | "away" | "checkpoint" | "bridged" | "caught" | "dropped" | "held" | "level";
export type AttackStoryGroup = "peloton" | "breakaway" | "group" | "chasers";

export interface AttackStoryLine {
  id: string;
  kind: "attackStory";
  phase: AttackStoryPhase;
  km: number;
  kmTo: null;
  span: false;
  time: number | null;
  rider_ids: string[];
  mineIds: string[];
  climb_name: string | null;
  group: AttackStoryGroup | null;
  cause: "cracked" | "out_of_strength" | "outpaced" | null;
  at: "top" | "finish" | null;
  gap_seconds: number | null;
  trend: "growing" | "shrinking" | "steady" | null;
}

export function isAttackStoryLine(line: { kind: string }): line is AttackStoryLine {
  return line.kind === "attackStory";
}

/** Kontakten for viewerens konto (fejl eller intet svar = slukket). */
export function useAttackStory8045Enabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => {
      if (alive) setEnabled(flags?.[ATTACK_STORY_8045_FLAG_KEY] === true);
    });
    return () => { alive = false; };
  }, []);
  return enabled;
}

interface ClimbLike { name?: string | null; crest_km?: number | string | null; length_km?: number | string | null }

/** Angrebets linjer for filmens referat. Tom = filmen viser dagens angrebslinjer. */
export function attackStoryFilmLines(events: readonly unknown[] | null | undefined, opts: {
  timelineVersion?: number | null;
  climbs?: readonly ClimbLike[] | null;
  distanceKm?: number | null;
  mine?: ReadonlySet<string>;
} = {}): AttackStoryLine[] {
  const entries = attackStory8045(events as unknown[] ?? [], {
    timelineVersion: opts.timelineVersion ?? null,
    climbs: (opts.climbs ?? null) as unknown[] | null,
    distanceKm: opts.distanceKm ?? null,
  });
  return (attackStoryLines8045(entries) as Omit<AttackStoryLine, "mineIds">[]).map((line) => ({
    ...line,
    mineIds: line.rider_ids.filter((id) => opts.mine?.has(id)),
  }));
}

type FilmLine = { kind: string; km: number };

/**
 * Referatets linjer i rutens rækkefølge, som v6ReportLines: løbshistoriens linjer og
 * angrebets linjer flettet efter km; på samme km står målet sidst, ellers bevares
 * rækkefølgen (angrebets egen rækkefølge er den, det skete i).
 */
export function reportLinesWithAttackStory<T extends FilmLine>(story: readonly T[], attack: readonly AttackStoryLine[]): Array<T | AttackStoryLine> {
  if (!attack.length) return [...story];
  return [...story, ...attack]
    .map((line, i) => ({ line, i }))
    .sort((a, b) => a.line.km - b.line.km
      || Number(a.line.kind === "finish") - Number(b.line.kind === "finish")
      || a.i - b.i)
    .map(({ line }) => line);
}

/** "Lozano", "Lozano og Brivio", "Lozano, Brivio og Whitfield", "Lozano, Brivio, Whitfield og 4 andre". */
export function riderNames(ids: readonly string[], cast: Pick<Cast, "nameOf" | "rankOf">, t: TFunction): string {
  const known = [...new Set(ids)]
    .filter((id) => cast.nameOf(id))
    .sort((a, b) => (cast.rankOf(a) ?? 9999) - (cast.rankOf(b) ?? 9999));
  const unknown = ids.length - known.length;
  const names = known.map((id) => cast.nameOf(id) as string);
  if (!names.length) return t("raceFilm:attackStory.aRider");
  if (names.length + unknown <= 4 && unknown === 0) {
    if (names.length === 1) return names[0];
    return t("raceFilm:attackStory.names.list", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] });
  }
  const shown = names.slice(0, 3);
  return t("raceFilm:attackStory.names.more", { list: shown.join(", "), count: ids.length - shown.length });
}

/** "48 sekunder", "1 minut og 5 sekunder", "12 minutter og 4 sekunder" (fulde ord). */
export function gapWords(seconds: number, t: TFunction): string {
  const { minutes, seconds: rest } = gapParts8045(seconds);
  const sec = rest === 1 ? t("raceFilm:attackStory.gap.second") : t("raceFilm:attackStory.gap.seconds", { count: rest });
  if (minutes === 0) return sec;
  const min = minutes === 1 ? t("raceFilm:attackStory.gap.minute") : t("raceFilm:attackStory.gap.minutes", { count: minutes });
  return rest === 0 ? min : t("raceFilm:attackStory.gap.join", { minutes: min, seconds: sec });
}

/** Den fulde tekstnøgle for linjen (én eller flere ryttere). */
export function attackStoryCopyKey(line: Pick<AttackStoryLine, "phase" | "cause" | "at" | "trend" | "rider_ids">): string {
  const n = line.rider_ids.length > 1 ? "many" : "one";
  const base = "raceFilm:attackStory";
  switch (line.phase) {
    case "checkpoint": return `${base}.checkpoint.${line.trend ?? "first"}.${n}`;
    case "dropped": return `${base}.dropped.${line.cause ?? "outpaced"}.${n}`;
    case "held": return `${base}.held.${line.at ?? "finish"}.${n}`;
    case "level": return `${base}.level.${line.at ?? "finish"}.${n}`;
    default: return `${base}.${line.phase}.${n}`;
  }
}

export function attackStoryText(line: AttackStoryLine, cast: Pick<Cast, "nameOf" | "rankOf">, t: TFunction): string {
  const many = line.rider_ids.length > 1;
  const group = line.group ? t(`raceFilm:attackStory.group.${line.group}.${many ? "many" : "one"}`) : "";
  return t(attackStoryCopyKey(line), {
    rider: riderNames(line.rider_ids, cast, t),
    riders: riderNames(line.rider_ids, cast, t),
    climb: line.climb_name ?? t("raceFilm:attackStory.lastClimb"),
    group,
    gap: line.gap_seconds != null ? gapWords(line.gap_seconds, t) : "",
  });
}

/** En linje i referatet: km og løbstid (når motoren har den) til venstre, hændelsen til højre. */
export default function AttackStoryReportLine({ line, current, cast, kmLabel, onJump }: {
  line: AttackStoryLine;
  current: boolean;
  cast: Pick<Cast, "nameOf" | "rankOf">;
  kmLabel: string;
  onJump: () => void;
}) {
  const { t } = useTranslation(["races", "raceFilm"]);
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        aria-current={current ? "step" : undefined}
        data-film-line={`attack-story-${line.phase}`}
        className={`grid min-h-11 w-full grid-cols-[72px_minmax(0,1fr)] gap-2.5 border-t border-cz-border px-1 py-2 text-left hover:bg-cz-subtle ${current ? "bg-cz-subtle" : ""}`}
      >
        <span className="flex flex-col font-data text-xs font-semibold tabular-nums text-cz-1">
          <span>{kmLabel}</span>
          {line.time != null && <span className="font-normal text-cz-3">{formatClock(line.time)}</span>}
        </span>
        <span className="text-sm text-cz-1">
          {attackStoryText(line, cast, t)}
          {line.mineIds.length > 0 && (
            <span className="ml-1.5 inline-flex items-center rounded-cz bg-cz-1 px-1.5 py-0.5 align-middle text-xs font-semibold text-cz-body">
              {t("stagePageV2.story.you")}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
