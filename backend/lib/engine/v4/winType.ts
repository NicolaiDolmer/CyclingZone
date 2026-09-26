// backend/lib/engine/v4/winType.ts
// #5577 (spor M2, docs/drafts/spec-motor-runde-2-2026-09-25.md): sejrstypen.
//
// Foer denne fil stemplede buildFinishEvent ALLE massestarts-etaper med
// pladsholderen "group_finish", og finalen udsendte `sprint_decided` for
// enhver vinder. Loebsfilmen skrev derfor "det bliver taet mellem X og
// forfoelgerne" efter en solosejr (RACE_ENGINE_RULES §7 raekke 18).
//
// Sejrstypen afgoeres nu af det motoren SELV ved om finalen: hvor mange der
// kaempede om sejren (kontendentpuljen), hvor stort feltet var, om dagens
// finale er et samlet feltopgoer (isMassFinishRoute), og om puljen alene var
// et udbrud. Ingen gap-taerskel: v3's SPRINT_GAP_S/CLOSE_GAP_S gaetter paa
// forloebet ud fra sekunderne; v4 ved hvad der skete.
//
// Noeglerne er de EKSISTERENDE, som loebsfilmen (frontend stageTimelineFilm.js
// WIN_TYPE_KEY) og etape-fortaellingen (raceNarrative.js) allerede har faerdig
// EN/DA-copy til. Ingen ny noegle uden ny copy (ejer-go).
//
// REN: ingen IO/Date/Math.random, ingen import fra oevrigt backend.

import type { TimelineEvent } from "./types.ts";

/** Alle sejrstyper finish-eventet maa baere. */
export const WIN_TYPE_KEYS = ["sprint_win", "close_win", "solo_win", "itt_win", "ttt_win"] as const;
export type WinType = (typeof WIN_TYPE_KEYS)[number];

/** Sejrstyperne en massestart kan ende i (tidskoerslerne har deres egne). */
export type RoadWinType = "sprint_win" | "close_win" | "solo_win";

const WIN_TYPE_SET: ReadonlySet<string> = new Set(WIN_TYPE_KEYS);

export function isWinType(value: unknown): value is WinType {
  return typeof value === "string" && WIN_TYPE_SET.has(value);
}

export type RoadWinTypeInput = {
  /** Ryttere der kaempede om sejren ved stregen (finalens kontendentpulje). */
  poolSize: number;
  /** Ryttere der stadig var i loebet ved finalen. */
  fieldSize: number;
  /** Er dagens finale et samlet feltopgoer (finale.ts isMassFinishRoute)? */
  massFinish: boolean;
  /** Bestod puljen KUN af udbrud/solo-grupper, uden at feltet naaede op? */
  escapeOnlyPool: boolean;
  /**
   * "Feltet"-definitionen motoren allerede bruger i finale-jagten
   * (finale.ts isBunchSizedChaseGroup, tuning.ts finaleExtra.bunchCatchMin*):
   * en andel af feltet med et absolut gulv. Massespurt-graensen N er den samme
   * stoerrelse, saa motoren har EEN definition af hvornaar en gruppe er feltet.
   */
  bunchMinFieldFraction: number;
  bunchMinRiders: number;
};

/**
 * Massestartens sejrstype (spec M2 punkt 1):
 *   - solo_win:   vinderen kom alene til stregen (puljen er 1), ogsaa et
 *                 udbrud der holdt hjem med én mand.
 *   - sprint_win: massefinale, og puljen er feltet (>= N ryttere), og det er
 *                 ikke et udbrud der kom samlet hjem.
 *   - close_win:  alt derimellem — en reduceret gruppe, et udbrud med flere,
 *                 eller en selektiv finale (bjerg, punch, nedkoersel) hvor
 *                 vinderen slap fri af de andre kontendenter.
 */
export function classifyRoadWinType(input: RoadWinTypeInput): RoadWinType {
  if (input.poolSize <= 1) return "solo_win";
  const bunchSized =
    input.fieldSize > 0 &&
    input.poolSize >= Math.max(input.bunchMinRiders, input.bunchMinFieldFraction * input.fieldSize);
  if (input.massFinish && bunchSized && !input.escapeOnlyPool) return "sprint_win";
  return "close_win";
}

/**
 * Finalens afgoerelse, laest fra tidslinjen: det SIDSTE event der baerer en
 * kendt `win_type` (finale.ts udsender praecis ét: `sprint_decided` ved en
 * massespurt, ellers `finale_attack` med kind "stage_decided"). null naar
 * finalen ikke afgjorde noget (tomt felt).
 */
export function winTypeFromFinaleEvents(events: readonly TimelineEvent[]): WinType | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const winType = events[i].params?.win_type;
    if (isWinType(winType)) return winType;
  }
  return null;
}
