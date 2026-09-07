// backend/lib/engine/v4/timeline.ts
// Race Engine v4 F2 (#4030), Fase B4: nativ event-emission, timeline_version 2.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §6.
// Taksonomi: docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md
//   §2.2 (event-taksonomi v1), §2.3 (konsistensregler, HAARDE).
// v3-praecedent (samme event-former/param-shapes hvor v4 ikke strukturelt
// afviger — se afvigelses-noten nederst): backend/lib/raceTimeline.js.
//
// REN — ingen import fra oevrigt backend (renheds-graense, designdoc §1/§3).
//
// Dette er BIBLIOTEKET mekanik-hooks (climbSelection.ts/descent.ts/finale.ts,
// og evt. fremtidige segmentLoop-udvidelser) bygger events med: en builder-
// funktion pr. kendt #2410-event-type der laaser param-formen, plus konsistens-
// haandhaevelse af de regler der er checkbare PURT paa selve tidslinjen.
//
// segmentLoop.ts (Fase A, frosset) har allerede sin egen lokale pushEvent() for
// stage_start/gap_update og importerer IKKE denne fil — det aendrer intet ved
// at denne fils gapUpdateEvent() matcher segmentLoop.ts's shape 1:1 (verificeret
// i timeline.test.ts), saa fremtidige kaldere (finale.ts/climbSelection.ts/
// descent.ts, Fase B1-B3) kan bruge builderne herfra med tillid til at formen
// er konsistent gennem hele motoren.

import type { KnownTimelineEventType, TimelineEvent } from "./types.ts";

// ── km-afrunding (samme konvention som segmentLoop.ts's lokale pushEvent) ────
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** REN event-konstruktor: km rundes til 2 decimaler (#2410 §2.3 regel 4). */
export function makeEvent(
  km: number,
  type: KnownTimelineEventType | (string & {}),
  params: Record<string, unknown>,
): TimelineEvent {
  return { km: round2(km), type, params };
}

// ── Builder-funktioner pr. kendt event-type ───────────────────────────────────
// Param-shapes matcher raceTimeline.js's emit(...)-kald felt-for-felt, MED
// UNDTAGELSE af de to bevidste v4-udvidelser (gap_update/peloton_splits) —
// se afvigelses-noten nederst i filen.

export function stageStartEvent(
  km: number,
  args: { fieldCount: number; profileType: string | null; distanceKm: number | null },
): TimelineEvent {
  return makeEvent(km, "stage_start", {
    field_count: args.fieldCount,
    profile_type: args.profileType,
    distance_km: args.distanceKm,
  });
}

export function breakawayFormedEvent(km: number, riderIds: readonly string[]): TimelineEvent {
  return makeEvent(km, "breakaway_formed", { rider_ids: riderIds.slice(0, 3) });
}

// v4 har et reelt gruppe-lag (mor-spec §3.2) — group_id er derfor et LEGITIMT
// ekstra-felt ift. v3's rene { gap_seconds } (v3 har ingen formaliserede
// grupper, kun ÉN syntetisk udbryder-vs-felt-kurve). Matcher segmentLoop.ts's
// allerede-shippede pushEvent(..., "gap_update", { group_id, gap_seconds })-form.
export function gapUpdateEvent(km: number, args: { groupId: string; gapSeconds: number }): TimelineEvent {
  return makeEvent(km, "gap_update", { group_id: args.groupId, gap_seconds: round2(args.gapSeconds) });
}

export function komPassageEvent(
  km: number,
  args: { name: string; category: string | null; top: Array<{ rider_id: string; points: number }> },
): TimelineEvent {
  return makeEvent(km, "kom_passage", { name: args.name, category: args.category ?? null, top: args.top });
}

export function intermediateSprintEvent(
  km: number,
  args: { name: string; top: Array<{ rider_id: string; points: number; bonus_seconds: number }> },
): TimelineEvent {
  return makeEvent(km, "intermediate_sprint", { name: args.name, top: args.top });
}

export function breakawayCaughtEvent(km: number, riderIds: readonly string[]): TimelineEvent {
  return makeEvent(km, "breakaway_caught", { rider_ids: [...riderIds] });
}

export function breakawaySurvivedEvent(
  km: number,
  args: { riderIds: readonly string[]; finalGap: number },
): TimelineEvent {
  return makeEvent(km, "breakaway_survived", {
    rider_ids: [...args.riderIds],
    final_gap: Math.max(0, Math.round(args.finalGap)),
  });
}

// v4-native: splits baerer en AARSAG (mor-spec §3.3 "Splits er events med
// aarsag"; designdoc §4 punkt 3: "peloton_splits-event med aarsag") — et
// strukturelt rigere param-sæt end v3's bagudafledte { groups: number[] }.
// Se afvigelses-noten.
export function pelotonSplitsEvent(
  km: number,
  args: { groupId: string; kind: string; riderIds: readonly string[]; reason: string },
): TimelineEvent {
  return makeEvent(km, "peloton_splits", {
    group_id: args.groupId,
    kind: args.kind,
    rider_ids: [...args.riderIds],
    reason: args.reason,
  });
}

/**
 * v4-native (#4971): kvittering for segmentLoop's merge-trin. `groupId` er den
 * gruppe der FORSVANDT; `intoGroupId` er det id den fortsatte under (front-
 * naboens, jf. groups.mergeGroups). Emitteres af segmentLoop.ts efter mergen,
 * saa `assertGroupMembershipMatchesSnapshots` altid kan foelge en rytter fra
 * event til snapshot uden huller.
 */
export function groupMergedEvent(
  km: number,
  args: { groupId: string; intoGroupId: string; riderIds: readonly string[] },
): TimelineEvent {
  return makeEvent(km, "group_merged", {
    group_id: args.groupId,
    into_group_id: args.intoGroupId,
    rider_ids: [...args.riderIds],
  });
}

/**
 * "incident"-eventet. `severity`/`injuryDays`/`helperAssist` er ADDITIVE og
 * VALGFRIE (#2944's trappe): udelades de, er param-formen bit-identisk med den
 * F2-etablerede — v3's og aeldre v4-events beholder altsaa deres form.
 *
 * FOG-GATE (#1791, invariant 5): params baerer KUN ting spilleren maa se —
 * hvem, hvad slags, hvad det kostede i SEKUNDER og DAGE, og om en hjaelper var
 * fremme. ALDRIG sandsynligheder, alvors-andele eller lodtraekninger. Renderen
 * (frontend/src/lib/stageTimelineFilm.js) oversaetter disse noegler til
 * spillerens sprog; motoren skriver aldrig faerdig prosa.
 */
export function incidentEvent(
  km: number,
  args: {
    riderId: string;
    kind: string;
    outcome: string;
    timeLossSeconds: number | null;
    severity?: string | null;
    injuryDays?: number | null;
    helperAssist?: boolean;
    cause?: string;
  },
): TimelineEvent {
  const params: Record<string, unknown> = {
    rider_id: args.riderId,
    kind: args.kind,
    outcome: args.outcome,
    time_loss_seconds: args.timeLossSeconds ?? null,
  };
  if (args.severity !== undefined) params.severity = args.severity;
  if (args.injuryDays !== undefined) params.injury_days = args.injuryDays;
  if (args.helperAssist !== undefined) params.helper_assist = args.helperAssist;
  // Optional (#4950): angiver hvilken mekanik der udloeste uheldet (fx
  // "descent_attack"). M10s egne uheld (mechanics/incidents.ts) saetter den
  // ikke — udelades den, er param-formen bit-identisk med foer (samme
  // additiv-og-valgfri-moenster som severity/injuryDays/helperAssist ovenfor).
  if (args.cause !== undefined) params.cause = args.cause;
  return makeEvent(km, "incident", params);
}

export function favoriteCrackEvent(km: number, args: { riderId: string; reason: string }): TimelineEvent {
  return makeEvent(km, "favorite_crack", { rider_id: args.riderId, reason: args.reason });
}

export function finaleAttackEvent(km: number, riderId: string): TimelineEvent {
  return makeEvent(km, "finale_attack", { rider_id: riderId });
}

export function sprintDecidedEvent(
  km: number,
  args: { riderIds: readonly string[]; photoFinish: boolean },
): TimelineEvent {
  return makeEvent(km, "sprint_decided", { rider_ids: [...args.riderIds], photo_finish: args.photoFinish });
}

export function finishEvent(
  km: number,
  args: { top: Array<{ rider_id: string; rank: number; gap: number }>; winType: string },
): TimelineEvent {
  return makeEvent(km, "finish", { top: args.top, win_type: args.winType });
}

export function gcChangeEvent(km: number, args: { newLeaderId: string; previousLeaderId: string }): TimelineEvent {
  return makeEvent(km, "gc_change", { new_leader_id: args.newLeaderId, previous_leader_id: args.previousLeaderId });
}

// ── Sortering (#2410 §2.3 regel 4: km monotont ikke-faldende) ────────────────
// Stabil sortering (Array#sort er stabil siden Node >=12 / V8 TimSort) — indbyrdes
// raekkefoelge for events med samme km er insertion-orden (samme moenster som
// raceTimeline.js's afsluttende events.sort()).
export function sortTimeline(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.km - b.km);
}

// ── Konsistensregel-haandhaevelse (#2410 §2.3) ────────────────────────────────
// Kun de regler der er checkbare PURT paa selve tidslinjen haandhaeves her:
//   regel 3 (rider_ids findes i det kendte felt), regel 4 (km-daekning +
//   monotoni), regel 5 (fog-gate #1791).
// Regel 1/2/6 forudsaetter sammenligning med persisterede
// race_results/passages/moments/runs og hoerer til persisterings-laget
// (raceRunner.persistStageTimelines naar v4 wires ind, mor-spec §3.4) — IKKE
// motor-kernen, som ikke kender til DB'en (renheds-graensen).

// v4-fysiologi-/selektions-interne noegler (§4-5) — samme moenster som
// raceTimeline.test.js's COMPONENT_KEYS-saet, tilpasset v4s eget komponent-
// vokabular (physiology.ts/segmentLoop.ts/tuning.ts).
const FOG_GATE_FORBIDDEN_KEYS = new Set([
  "cp", "wprime", "wprimemax", "dayform", "seconds_over_cp", "work_norm",
  "cohesion", "demand", "collectivecp", "deficit", "noise", "weight",
  "weights", "probability", "score", "energydeficit", "cpweights",
  "wprimeweights", "components", "finalscore", "terrain",
]);

export type TimelineViolation = { rule: string; message: string };

export type TimelineValidationContext = {
  distanceKm: number;
  knownRiderIds: ReadonlySet<string>;
};

function extractRiderIds(params: Record<string, unknown>): string[] {
  const out: string[] = [];
  const riderIdKeys = new Set(["rider_id", "new_leader_id", "previous_leader_id"]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (riderIdKeys.has(k) && typeof v === "string") {
          out.push(v);
        } else if (k === "rider_ids" && Array.isArray(v)) {
          for (const id of v) if (typeof id === "string") out.push(id);
        } else {
          visit(v);
        }
      }
    }
  };
  visit(params);
  return out;
}

function collectParamKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectParamKeys(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      collectParamKeys(v, out);
    }
  }
  return out;
}

/**
 * Kontrollerer de tre PURT-tidslinje-checkbare konsistensregler (#2410 §2.3
 * regel 3/4/5) og returnerer eventuelle brud (tom liste = konsistent).
 * Ren funktion — kaster ALDRIG selv (se assertValidTimeline for den variant).
 */
export function validateTimelineEvents(
  events: readonly TimelineEvent[],
  ctx: TimelineValidationContext,
): TimelineViolation[] {
  const violations: TimelineViolation[] = [];

  for (const e of events) {
    if (e.km < 0 || e.km > ctx.distanceKm + 1e-9) {
      violations.push({ rule: "km-range", message: `event ${e.type} har km=${e.km} udenfor [0, ${ctx.distanceKm}]` });
    }
  }

  for (let i = 1; i < events.length; i++) {
    if (events[i].km < events[i - 1].km) {
      violations.push({
        rule: "km-monotonic",
        message: `event ${events[i].type} (km=${events[i].km}) kommer efter km=${events[i - 1].km}`,
      });
    }
  }

  for (const e of events) {
    for (const riderId of extractRiderIds(e.params)) {
      if (!ctx.knownRiderIds.has(riderId)) {
        violations.push({ rule: "unknown-rider", message: `event ${e.type} refererer ukendt rider_id "${riderId}"` });
      }
    }
  }

  for (const e of events) {
    for (const key of collectParamKeys(e.params)) {
      if (FOG_GATE_FORBIDDEN_KEYS.has(key.toLowerCase())) {
        violations.push({ rule: "fog-gate", message: `event ${e.type} laekker fog-gated noegle "${key}" i params` });
      }
    }
  }

  // #4950: "incident"-eventets valgfrie `cause` (incidentEvent) skal, naar den
  // er sat, vaere en ikke-tom streng — samme lette form-tjek som de tre andre
  // regler ovenfor, PURT checkbart paa selve tidslinjen (ingen DB-slag).
  for (const e of events) {
    if (e.type !== "incident" || !("cause" in e.params)) continue;
    const cause = e.params.cause;
    if (typeof cause !== "string" || cause.length === 0) {
      violations.push({
        rule: "incident-cause",
        message: `event ${e.type} har ugyldig cause "${String(cause)}" (skal vaere en ikke-tom streng)`,
      });
    }
  }

  return violations;
}

// ── Gruppe-medlemskab: event vs. snapshot (#4971) ────────────────────────────
// Snapshots (groups.buildGroupSnapshot) er sandheden om segment-state; events
// er fortaellingen om den. Er de uenige, er outputtet selvmodsigende — praecis
// den fejl CodeRabbit fandt paa PR #4971 (golden fixture bjerg-selektion:
// `peloton_splits` flyttede r04/r05 til `chase-1000` ved km 65, mens km 65- og
// km 82-snapshots holdt dem i `peloton-0`, fordi segmentLoop's merge-trin
// foldede `chase-1000` tilbage UDEN event).
//
// Reglen er bevidst afgraenset til NAESTE snapshot: den kontrollerer at det
// billede en event tegner, staar i det FOERSTE snapshot ved eller efter
// eventets km — derefter ejer segment-state historien igen. Det fanger praecis
// den fejlklasse CodeRabbit fandt (et gruppeskift der aldrig naaede
// segment-state) uden at gore senere, legitime omgrupperinger — fx M4's
// placerings-tiers paa maalstregen (finale.ts), som IKKE navngiver ryttere —
// til falske brud. Ryttere ingen event har udtalt sig om tjekkes aldrig.

/** Events der udtaler sig om hvilken gruppe konkrete ryttere HOERER til. */
const GROUP_MEMBERSHIP_EVENT_TYPES = new Set(["breakaway_formed", "peloton_splits", "group_merged"]);

function groupIdAssertedBy(event: TimelineEvent): string | null {
  if (!GROUP_MEMBERSHIP_EVENT_TYPES.has(event.type)) return null;
  // group_merged flytter rytterne til den gruppe der OVERLEVEDE mergen.
  const key = event.type === "group_merged" ? "into_group_id" : "group_id";
  const value = event.params[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type GroupMembershipSnapshot = {
  km: number;
  groups: ReadonlyArray<{ group_id: string; rider_ids: readonly string[] }>;
};

/**
 * Kontrollerer at hvert gruppeskift en event annoncerer ogsaa staar i det
 * FOERSTE snapshot ved eller efter eventets km. Flere events paa samme km om
 * samme rytter: det SIDSTE vinder (samme raekkefolge som segmentLoop kaerer
 * mekanik -> merge -> snapshot). Ren funktion — returnerer brud, kaster aldrig.
 */
export function validateGroupMembership(
  events: readonly TimelineEvent[],
  snapshots: readonly GroupMembershipSnapshot[],
): TimelineViolation[] {
  const violations: TimelineViolation[] = [];
  if (snapshots.length === 0) return violations;

  const ordered = [...snapshots].sort((a, b) => a.km - b.km);
  const sortedEvents = sortTimeline(events);
  let eventIndex = 0;

  for (const snapshot of ordered) {
    // rider_id -> seneste event-udsagn siden forrige snapshot.
    const claims = new Map<string, { groupId: string; eventType: string; km: number }>();
    // Ryttere M10 (eller M3s indlejrede uheldstrappe) har trukket UD AF DERES
    // GRUPPE i samme vindue (se noten om incident-undtagelsen). #4993: kun
    // outcomes der FAKTISK flytter rytteren taeller — incidents.ts's egen gren
    // (`resolved.outcome !== "protected_three_km_rule"`) er facit for hvilke
    // det er. Et "protected_three_km_rule"-uheld aendrer INGEN gruppe (rene
    // information + evt. skadedage), saa det maa ikke undskylde en
    // ubeslaegtet gruppeskifte-konflikt for samme rytter.
    const groupChangingIncidentRiders = new Set<string>();
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].km <= snapshot.km + 1e-9) {
      const event = sortedEvents[eventIndex];
      eventIndex += 1;
      if (
        event.type === "incident"
        && typeof event.params.rider_id === "string"
        && event.params.outcome !== "protected_three_km_rule"
      ) {
        groupChangingIncidentRiders.add(event.params.rider_id);
      }
      const groupId = groupIdAssertedBy(event);
      if (!groupId) continue;
      const riderIds = event.params.rider_ids;
      if (!Array.isArray(riderIds)) continue;
      for (const riderId of riderIds) {
        if (typeof riderId === "string") claims.set(riderId, { groupId, eventType: event.type, km: event.km });
      }
    }
    if (claims.size === 0) continue;

    const actualGroupOf = new Map<string, string>();
    for (const group of snapshot.groups) {
      for (const riderId of group.rider_ids) actualGroupOf.set(riderId, group.group_id);
    }

    for (const [riderId, claim] of claims) {
      const actual = actualGroupOf.get(riderId);
      // Rytteren er ude af loebet (DNF/OTL) — ikke et gruppeskift-brud.
      if (actual === undefined) continue;
      if (actual === claim.groupId) continue;
      // Har rytteren haft et GRUPPESKIFTENDE uheld i samme vindue, ER
      // tidslinjen ikke tavs om ham: M10 (mechanics/incidents.ts) traekker en
      // uheldsramt ud i sin egen solo-gruppe EFTER at M2 har splittet
      // segmentet, og `incident`-eventet er den offentlige besked om netop
      // det. Reglen jager tavse gruppeskift, ikke fortalte.
      if (groupChangingIncidentRiders.has(riderId)) continue;
      violations.push({
        rule: "group-membership",
        message:
          `event ${claim.eventType} (km=${claim.km}) satte ${riderId} i gruppe "${claim.groupId}", ` +
          `men snapshot km=${snapshot.km} har ham i "${actual}" — gruppeskiftet naaede aldrig segment-state`,
      });
    }
  }

  return violations;
}

/** Kaster hvis validateGroupMembership finder brud. */
export function assertGroupMembershipMatchesSnapshots(
  events: readonly TimelineEvent[],
  snapshots: readonly GroupMembershipSnapshot[],
): void {
  const violations = validateGroupMembership(events, snapshots);
  if (violations.length > 0) {
    const msg = violations.map((v) => `[${v.rule}] ${v.message}`).join("; ");
    throw new Error(`timeline/snapshot-uenighed (#4971): ${msg}`);
  }
}

/** Kaster med samlet fejlbesked hvis validateTimelineEvents finder brud. */
export function assertValidTimeline(events: readonly TimelineEvent[], ctx: TimelineValidationContext): void {
  const violations = validateTimelineEvents(events, ctx);
  if (violations.length > 0) {
    const msg = violations.map((v) => `[${v.rule}] ${v.message}`).join("; ");
    throw new Error(`timeline-konsistensbrud (#2410 §2.3): ${msg}`);
  }
}

// ── Taksonomi-afvigelser fundet ved sammenligning mod raceTimeline.js (v3) ────
// Rapporteret i B4-leverancen (se ogsaa PR/session-noten):
//
// 1. v3 (raceTimeline.js) emitterer TRE events der IKKE er del af #2410 §2.2s
//    tabel og IKKE findes i types.ts's KnownTimelineEventType (frosset,
//    arkitekt-only): `virtual_leader`, `field_fading`, `leadout` — v3s "6
//    ejer-godkendte renderer-forbedringer" fra 17/8-specen. Taksonomien er
//    AABEN (KnownTimelineEventType unionet med `string`), saa en fremtidig
//    v4-mekanik KAN emittere disse tre, men denne fil bygger dem IKKE — F2s
//    scope er #2410 §2.2s kerne-taksonomi (14 typer, matcher types.ts).
// 2. gap_update: v3s param-form er { gap_seconds } (ÉN global udbryder-vs-felt-
//    kurve, ingen formaliserede grupper). v4 (segmentLoop.ts, Fase A) har et
//    reelt gruppe-lag og emitterer { group_id, gap_seconds } — group_id er
//    strukturelt noedvendigt naar flere grupper (breakaway/peloton/chase/
//    gruppetto) eksisterer samtidig, og er IKKE en fog-gate-laek (gruppe-id er
//    allerede offentligt via groupSnapshots). gapUpdateEvent() her matcher
//    segmentLoop.ts's allerede-shippede shape 1:1.
// 3. peloton_splits: v3 afleder eventet BAGLAENS af persisterede stageGaps
//    ({ groups: number[] } — kun gruppe-stoerrelser, ingen aarsag). v4
//    (mor-spec §3.3/designdoc §4 punkt 3) kraever en AARSAG paa selve splittet
//    (nativt, undervejs) — pelotonSplitsEvent() baerer derfor
//    { group_id, kind, rider_ids, reason }. Tilsigtet udvidelse, ikke en
//    regression: v3s form var en begraensning af den syntetiske efterbehandling.
