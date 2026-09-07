// backend/lib/engine/v4/groups.ts
// Race Engine v4 F2 (#4030): M1 - gruppe-state, split/merge, gap-bogfoering,
// tid-tildeling. SSOT: designdoc SS3-4, mor-spec SS3.2 (rent gruppe-princip,
// ejer-valg 20/8: "samme gruppe = samme tid").
//
// REN — ingen import fra oevrigt backend. Alle funktioner er RENE (input
// muteres aldrig, nyt array/objekt returneres) saa determinisme-testene kan
// sammenligne deep-equal uden at bekymre sig om aliasing.

import type { Entrant, EngineTuning, GroupKind, RaceGroup, RiderState, SegmentGroupSnapshot } from "./types.ts";
import { deriveWprimeMax, dayformComponent, jourSansComponent } from "./physiology.ts";

export const INITIAL_GROUP_ID = "peloton-0";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Startgruppe: alle ryttere i én peloton, ingen gap. */
export function initGroups(entrants: Entrant[]): RaceGroup[] {
  return [
    {
      id: INITIAL_GROUP_ID,
      kind: "peloton",
      rider_ids: entrants.map((e) => e.rider_id),
      gap_seconds: 0,
      cohesion: 1,
    },
  ];
}

/**
 * Start-rytterstate: wprimeMax afledt af abilities, dagsform+jour-sans slaaet
 * sammen til ét signeret modifikator-felt (F2-forenkling af raceDayForm.js's
 * to separate komponenter — begge anvendes paa cp via physiology.applyDayformToCp).
 * `cp` saettes til 0 her — genberegnes segment for segment (segmentKind-afhaengig).
 *
 * F2-note: Entrant-kontrakten (SS2) baerer endnu intet "form"-felt (0-100-skala,
 * raceDayForm's form-koblede jour-sans-sandsynlighed) — jourSansComponent kaldes
 * derfor med form=null (neutral base-rate) indtil rating-fladen kobles ind (F3+).
 */
export function initRiderStates(
  entrants: Entrant[],
  tuning: EngineTuning,
  seed: string,
): Record<string, RiderState> {
  const riders: Record<string, RiderState> = {};
  for (const entrant of entrants) {
    const wprimeMax = deriveWprimeMax(entrant.abilities, tuning.physiology.wprimeWeights);
    const dayform = dayformComponent({ seed, riderId: entrant.rider_id, tuning: tuning.dayform });
    const jourSans = jourSansComponent({ seed, riderId: entrant.rider_id, form: null, tuning: tuning.dayform });
    riders[entrant.rider_id] = {
      rider_id: entrant.rider_id,
      group_id: INITIAL_GROUP_ID,
      cp: 0,
      wprimeMax,
      wprime: wprimeMax,
      dayform: dayform + jourSans,
      seconds_over_cp: 0,
      work_norm: 0,
      incidents: 0,
      status: "racing",
      time_seconds: 0,
    };
  }
  return riders;
}

/** Deterministisk gruppe-id — mekanik-hooks kalder med en loebende taeller pr. segment. */
export function makeGroupId(kind: GroupKind, seq: number): string {
  return `${kind}-${seq}`;
}

/**
 * Split en delmaengde ryttere ud af `sourceGroupId` og ind i en ny gruppe.
 * Den nye gruppes gap_seconds = kilde-gruppens gap + `gapSecondsDelta` (altid
 * bagud — splittede ryttere taber ALDRIG tid til den gruppe de forlod, jf.
 * monotoni-invarianten). Kilde-gruppen fjernes hvis den toemmes helt.
 */
export function splitGroup(
  groups: RaceGroup[],
  sourceGroupId: string,
  splitRiderIds: string[],
  newGroup: { id: string; kind: GroupKind; gapSecondsDelta: number; cohesion?: number },
): RaceGroup[] {
  if (splitRiderIds.length === 0) return groups;
  const splitSet = new Set(splitRiderIds);
  const next: RaceGroup[] = [];
  let sourceGapSeconds = 0;
  let foundSource = false;
  for (const group of groups) {
    if (group.id !== sourceGroupId) {
      next.push(group);
      continue;
    }
    foundSource = true;
    sourceGapSeconds = group.gap_seconds;
    const remaining = group.rider_ids.filter((id) => !splitSet.has(id));
    if (remaining.length > 0) next.push({ ...group, rider_ids: remaining });
  }
  if (!foundSource) return groups;
  next.push({
    id: newGroup.id,
    kind: newGroup.kind,
    rider_ids: [...splitRiderIds],
    gap_seconds: sourceGapSeconds + newGroup.gapSecondsDelta,
    cohesion: newGroup.cohesion ?? 1,
  });
  return next;
}

function mergedKind(a: RaceGroup, b: RaceGroup): GroupKind {
  if (a.kind === "peloton" || b.kind === "peloton") return "peloton";
  return a.rider_ids.length >= b.rider_ids.length ? a.kind : b.kind;
}

/**
 * Sammensmelt grupper hvis gap-afstanden mellem naboer (sorteret paa
 * gap_seconds) er under `mergeThresholdSeconds` ("breakaway_caught"-moenstret,
 * generaliseret til alle gruppe-par). Sorteringen (gap_seconds, id) goer
 * sammenlaegningen uafhaengig af input-arrayets raekkefolge — determinisme-krav.
 * Den sammenlagte gruppe arver front-naboens id/gap_seconds (rent princip:
 * samme gruppe = samme tid).
 */
export function mergeGroups(groups: RaceGroup[], mergeThresholdSeconds: number): RaceGroup[] {
  return mergeGroupsDetailed(groups, mergeThresholdSeconds).groups;
}

/**
 * En enkelt sammensmeltning: gruppen `absorbed_group_id` findes ikke laengere
 * efter merget — dens ryttere ligger nu i `into_group_id`. #4971: segmentLoop
 * bruger denne log til at emittere `group_merged`, saa tidslinjen ALDRIG
 * efterlader en rytter i et gruppe-id der ikke findes i naeste snapshot
 * (gruppe-skift uden event var selve fejlen: et `peloton_splits` til
 * `chase-1000` som merget saa foldede tilbage i `peloton-0` i samme segment).
 */
export type GroupMerge = {
  absorbed_group_id: string;
  into_group_id: string;
  rider_ids: string[];
};

/**
 * Samme rene merge som mergeGroups, men returnerer OGSAA hvilke grupper der
 * blev opslugt af hvem. Kaskader foldes: smelter C ind i B og B ind i A i
 * samme kald, rapporteres begge med `into_group_id` = A (det id gruppen
 * FAKTISK baerer i det snapshot segmentLoop bygger bagefter).
 */
export function mergeGroupsDetailed(
  groups: RaceGroup[],
  mergeThresholdSeconds: number,
): { groups: RaceGroup[]; merges: GroupMerge[] } {
  if (groups.length <= 1) {
    return { groups: groups.map((g) => ({ ...g, rider_ids: [...g.rider_ids] })), merges: [] };
  }
  const sorted = [...groups].sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  const merged: RaceGroup[] = [];
  const merges: GroupMerge[] = [];
  for (const group of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && group.gap_seconds - prev.gap_seconds < mergeThresholdSeconds) {
      merges.push({
        absorbed_group_id: group.id,
        into_group_id: prev.id,
        rider_ids: [...group.rider_ids],
      });
      merged[merged.length - 1] = {
        id: prev.id,
        kind: mergedKind(prev, group),
        rider_ids: [...prev.rider_ids, ...group.rider_ids],
        gap_seconds: prev.gap_seconds,
        cohesion: Math.min(prev.cohesion, group.cohesion),
      };
      continue;
    }
    merged.push({ ...group, rider_ids: [...group.rider_ids] });
  }
  return { groups: merged, merges };
}

/**
 * Tid-tildeling (mor-spec SS3.2, rent princip): alle ryttere i samme gruppe
 * faar PRAECIS gruppens tid (front-elapsed + gruppens gap_seconds). Ingen
 * individuel varians inden for gruppen — det er selve invarianten (SS2 §2).
 */
export function applyGroupTimes(
  groups: RaceGroup[],
  riders: Record<string, RiderState>,
  frontElapsedSeconds: number,
): Record<string, RiderState> {
  const next: Record<string, RiderState> = { ...riders };
  for (const group of groups) {
    const groupTime = frontElapsedSeconds + group.gap_seconds;
    for (const riderId of group.rider_ids) {
      const rider = next[riderId];
      if (!rider) continue;
      next[riderId] = { ...rider, group_id: group.id, time_seconds: groupTime };
    }
  }
  return next;
}

/** Per-segment gruppe-snapshot (beslutning 20) — km rundes til 2 decimaler. */
export function buildGroupSnapshot(km: number, groups: RaceGroup[]): SegmentGroupSnapshot {
  return {
    km: round2(km),
    groups: groups.map((g) => ({
      group_id: g.id,
      kind: g.kind,
      rider_ids: [...g.rider_ids],
      gap_seconds: g.gap_seconds,
    })),
  };
}
