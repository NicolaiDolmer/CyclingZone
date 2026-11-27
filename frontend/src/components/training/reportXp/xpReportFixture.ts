// #7627 · PREVIEW FIXTURE, NOT GAME DATA.
//
// The XP report is built against this fixture because the backend does not yet
// write XP per slot or the bar in XP (see lib/trainingReportXp.ts, DATA CONTRACT).
// Every rider, nation, number and price here is invented for screenshots on the
// preview build. The price curve is a made-up stand-in, not the XP model's private
// price list, and nothing here may be read as a balance number.
import type { TrainingActivity } from "../../../lib/trainingDailyReceipt.ts";
import type { XpActivity, XpReceipt, XpRiderReceipt } from "../../../lib/trainingReportXp.ts";
import { ABILITY_KEYS } from "../../../lib/abilities.js";

export const XP_FIXTURE_LAST_DATE = "2026-11-15";
const DAYS = 30;

const RIDERS: Array<{ id: string; name: string; nation: string; type: [string, string]; focus: string[][]; races: number }> = [
  { id: "fx-1", name: "Aksel Brandvig", nation: "dk", type: ["climber", "gc"], focus: [["climbing", "endurance"], ["tempo", "recovery"]], races: 3 },
  { id: "fx-2", name: "Teodor Lunde", nation: "no", type: ["sprinter", "rouleur"], focus: [["sprint", "acceleration"], ["positioning", "flat"]], races: 2 },
  { id: "fx-3", name: "Matteo Calvari", nation: "it", type: ["puncheur", "climber"], focus: [["punch", "acceleration"], ["climbing", "recovery"]], races: 3 },
  { id: "fx-4", name: "Pieter van Hoorn", nation: "nl", type: ["tt", "rouleur"], focus: [["time_trial", "tempo"], ["flat", "endurance"]], races: 2 },
  { id: "fx-5", name: "Julien Marcadet", nation: "fr", type: ["brostensrytter", "rouleur"], focus: [["cobblestone", "durability"], ["positioning", "flat"]], races: 3 },
  { id: "fx-6", name: "Iker Zubeldia Arregi", nation: "es", type: ["climber", "puncheur"], focus: [["climbing", "descending"], ["endurance", "recovery"]], races: 2 },
  { id: "fx-7", name: "Lukas Brenner", nation: "de", type: ["rouleur", "tt"], focus: [["tempo", "flat"], ["teamwork", "endurance"]], races: 3 },
  { id: "fx-8", name: "Owen Pellow", nation: "gb", type: ["sprinter", "puncheur"], focus: [["sprint", "positioning"], ["acceleration", "flat"]], races: 0 },
  { id: "fx-9", name: "Camilo Ortegón Vela", nation: "co", type: ["climber", "gc"], focus: [["climbing", "recovery"], ["punch", "endurance"]], races: 2 },
  { id: "fx-10", name: "Nils Ammann", nation: "ch", type: ["tt", "gc"], focus: [["time_trial", "endurance"], ["descending", "tempo"]], races: 1 },
  { id: "fx-11", name: "Jesper Hollund", nation: "dk", type: ["baroudeur", "puncheur"], focus: [["aggression", "punch"], ["tactics", "flat"]], races: 3 },
  { id: "fx-12", name: "Callum Reid", nation: "au", type: ["gc", "climber"], focus: [["leadership", "tactics"], ["endurance", "tempo"]], races: 1 },
];
const RACE_ABILITIES = [["endurance", "flat", "tempo"], ["climbing", "endurance", "recovery"], ["punch", "acceleration", "positioning"]];

/** Small deterministic hash, so every preview build shows the same fixture. */
function noise(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const pick = (n: number, lo: number, hi: number) => Math.round(lo + n * (hi - lo));
// Invented stand-in price: rises with the level. Not the model's price list.
const fixturePrice = (level: number) => 20 + Math.round(level / 2);

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export interface XpFixture { receipts: XpReceipt[]; nations: Record<string, string>; types: Record<string, { primary: string; secondary: string }>; scores: Map<string, number>; abilities: Record<string, Record<string, number>> }

// Invented fixture rule, not the engine's: at most this many points per ability
// per date. XP over it stays on the bar and is paid out on a later date, which is
// how the fixture shows "paid out from the bar" next to "earned today".
const FIXTURE_POINTS_PER_DATE = 1;

/**
 * Scripted moments on the last two dates, so the preview's default day shows the
 * two cases the report must explain: a rider who rests all day and still gets a
 * point (paid out from the bar), and a rider whose focus moved on while the old
 * focus is paid out from the bar. `boost` is extra XP, in shares of the ability's
 * fixture price, on the scripted date's first session.
 */
// #8856: the session a slot rode, picked from its first ability, so the preview shows the three
// VO2max sessions apart (mixed, climbing and punch intervals) and a few others.
const SESSION_BY_ABILITY: Record<string, string> = { climbing: "vo2max_climb", punch: "vo2max_punch", sprint: "sprint", time_trial: "threshold", endurance: "endurance", cobblestone: "cobbled_sectors", aggression: "attack_repeats" };
const VARIED = ["tempo", "vo2max_climb", "vo2max", "vo2max_punch"];
const sessionFor = (ability: string, slot: number): string => SESSION_BY_ABILITY[ability] ?? VARIED[slot % VARIED.length];
const SCRIPT: Record<string, Record<number, { rest?: true; race?: boolean; focus?: string[]; boost?: { key: string; share: number } }>> = {
  "fx-6": { 1: { race: true, boost: { key: "climbing", share: 2.4 } }, 0: { rest: true } },
  "fx-1": { 1: { focus: ["climbing", "endurance"], boost: { key: "climbing", share: 2.3 } }, 0: { race: false, focus: ["tempo", "recovery"] } },
};

export function buildXpReportFixture(): XpFixture {
  const scores = new Map<string, number>();
  const state = new Map(RIDERS.map(r => [r.id, {
    levels: {} as Record<string, number>, bars: {} as Record<string, number>,
    form: pick(noise(r.id, "form"), 48, 78), fatigue: pick(noise(r.id, "fat"), 4, 30),
  }]));
  const receipts: XpReceipt[] = [];
  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    const date = addDays(XP_FIXTURE_LAST_DATE, -offset);
    const raceDate = noise(date, "race") < 0.55;
    const riders: XpRiderReceipt[] = RIDERS.map(r => {
      const s = state.get(r.id)!;
      const script = SCRIPT[r.id]?.[offset] ?? {};
      const levelOf = (key: string) => (s.levels[key] ??= pick(noise(r.id, key, "lvl"), 38, 76));
      const races = script.rest ? false : script.race ?? (raceDate && r.races > 0 && noise(r.id, date) < r.races / 3.4);
      const formBefore = s.form, fatigueBefore = s.fatigue;
      const gains: Record<string, number> = {};
      const paid: Record<string, number> = {};
      const detail: Record<string, { from: number; to: number }> = {};
      const buy = (key: string, into: Record<string, number>[]) => {
        const from = levelOf(key);
        s.bars[key] -= fixturePrice(from);
        s.levels[key] = from + 1;
        for (const map of into) map[key] = (map[key] ?? 0) + 1;
        detail[key] = { from: detail[key]?.from ?? from, to: from + 1 };
      };
      const room = (key: string) => (gains[key] ?? 0) < FIXTURE_POINTS_PER_DATE;
      // The date's start: XP saved on the bar that already covers a point is paid
      // out first, before any of today's XP (rest day or not).
      for (const key of Object.keys(s.bars)) {
        while (room(key) && s.bars[key] >= fixturePrice(levelOf(key))) buy(key, [gains, paid]);
      }
      const activities: XpActivity[] = [0, 1, 2, 3, 4].map(slot => {
        const race = races && (slot === 2 || slot === 4);
        const rest = script.rest || (!race && (races || slot === 4 || noise(r.id, date, slot, "rest") < 0.12));
        const focus = script.focus ?? r.focus[(slot + offset) % r.focus.length];
        const xp: Record<string, number> = {};
        if (race) for (const key of RACE_ABILITIES[pick(noise(date, slot, "terrain"), 0, 2)]) xp[key] = pick(noise(r.id, date, slot, key), 3, 9);
        else if (!rest) for (const key of focus) xp[key] = pick(noise(r.id, date, slot, key), 2, 7);
        const boost = script.boost;
        if (boost && slot === (race ? 2 : 0)) xp[boost.key] = (xp[boost.key] ?? 0) + Math.round(boost.share * fixturePrice(levelOf(boost.key)));
        const slotGains: Record<string, number> = {};
        for (const [key, earned] of Object.entries(xp)) {
          s.bars[key] = (s.bars[key] ?? 0) + earned;
          while (room(key) && s.bars[key] >= fixturePrice(levelOf(key))) buy(key, [gains, slotGains]);
        }
        s.fatigue = Math.max(0, Math.min(80, s.fatigue + (race ? 9 : rest ? -6 : 3)));
        if (!race && !rest) scores.set(`${r.id}:${date}:${slot}`, pick(noise(r.id, date, slot, "score"), 34, 82));
        const activity: XpActivity = {
          rider_id: r.id, name: r.name, game_day: slot, race_day: race,
          focus: race || rest ? null : sessionFor(focus[0], slot),
          intensity: rest ? "rest" : race ? null : "hard", gains: slotGains, xp,
        };
        return activity;
      });
      s.form = Math.max(30, Math.min(92, s.form + pick(noise(r.id, date, "f"), -3, 3)));
      const xpBar = Object.fromEntries(Object.keys(s.bars).map(key => [key, { xp: s.bars[key], price: fixturePrice(levelOf(key)) }]));
      const last = activities.at(-1)!;
      return {
        ...last, rider_id: r.id, name: r.name, activities, receipt_status: "complete",
        gains, gains_detail: detail, gain_percent: {}, progress_before: {}, trained_now: null,
        form_before: formBefore, fatigue_before: fatigueBefore, form: s.form, fatigue: s.fatigue,
        fatigue_delta: s.fatigue - fatigueBefore, race_day: activities.some(a => a.race_day), xp_bar: xpBar, bar_paid: paid,
      } satisfies XpRiderReceipt;
    });
    receipts.push({
      tick_date: date, season_id: "fixture-season", receipt_status: "complete",
      game_days: [0, 1, 2, 3, 4], expected_game_days: [0, 1, 2, 3, 4], trained_now_slots: [],
      report: { riders, condition_settled: true },
    });
  }
  receipts.reverse(); // newest first, like aggregateTrainingRuns
  // #7947: every ability after the last date, for the rating change. Untrained abilities
  // are invented too (own salt), picked so the default day shows one rating move.
  const abilities = Object.fromEntries(RIDERS.map(r => {
    const s = state.get(r.id)!;
    return [r.id, Object.fromEntries((ABILITY_KEYS as readonly string[]).map(key => [key, s.levels[key] ?? pick(noise(r.id, key, "ability"), 38, 76)]))];
  }));
  return { receipts, nations: Object.fromEntries(RIDERS.map(r => [r.id, r.nation])), types: Object.fromEntries(RIDERS.map(r => [r.id, { primary: r.type[0], secondary: r.type[1] }])), scores, abilities };
}

export const fixtureScoreOf = (scores: Map<string, number>) =>
  (riderId: string, date: string, activity: TrainingActivity): number | null => scores.get(`${riderId}:${date}:${activity.game_day}`) ?? null;
