// #7627 · PREVIEW FIXTURE, NOT GAME DATA.
//
// The XP report is built against this fixture because the backend does not yet
// write XP per slot or the bar in XP (see lib/trainingReportXp.ts, DATA CONTRACT).
// Every rider, nation, number and price here is invented for screenshots on the
// preview build. The price curve is a made-up stand-in, not the XP model's private
// price list, and nothing here may be read as a balance number.
import type { TrainingActivity } from "../../../lib/trainingDailyReceipt.ts";
import type { XpActivity, XpReceipt, XpRiderReceipt } from "../../../lib/trainingReportXp.ts";

export const XP_FIXTURE_LAST_DATE = "2026-11-15";
const DAYS = 30;

const RIDERS: Array<{ id: string; name: string; nation: string; focus: string[][]; races: number }> = [
  { id: "fx-1", name: "Aksel Brandvig", nation: "dk", focus: [["climbing", "endurance"], ["tempo", "recovery"]], races: 3 },
  { id: "fx-2", name: "Teodor Lunde", nation: "no", focus: [["sprint", "acceleration"], ["positioning", "flat"]], races: 2 },
  { id: "fx-3", name: "Matteo Calvari", nation: "it", focus: [["punch", "acceleration"], ["climbing", "recovery"]], races: 3 },
  { id: "fx-4", name: "Pieter van Hoorn", nation: "nl", focus: [["time_trial", "tempo"], ["flat", "endurance"]], races: 2 },
  { id: "fx-5", name: "Julien Marcadet", nation: "fr", focus: [["cobblestone", "durability"], ["positioning", "flat"]], races: 3 },
  { id: "fx-6", name: "Iker Zubeldia Arregi", nation: "es", focus: [["climbing", "descending"], ["endurance", "recovery"]], races: 2 },
  { id: "fx-7", name: "Lukas Brenner", nation: "de", focus: [["tempo", "flat"], ["teamwork", "endurance"]], races: 3 },
  { id: "fx-8", name: "Owen Pellow", nation: "gb", focus: [["sprint", "positioning"], ["acceleration", "flat"]], races: 0 },
  { id: "fx-9", name: "Camilo Ortegón Vela", nation: "co", focus: [["climbing", "recovery"], ["punch", "endurance"]], races: 2 },
  { id: "fx-10", name: "Nils Ammann", nation: "ch", focus: [["time_trial", "endurance"], ["descending", "tempo"]], races: 1 },
  { id: "fx-11", name: "Jesper Hollund", nation: "dk", focus: [["aggression", "punch"], ["tactics", "flat"]], races: 3 },
  { id: "fx-12", name: "Callum Reid", nation: "au", focus: [["leadership", "tactics"], ["endurance", "tempo"]], races: 1 },
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

export interface XpFixture { receipts: XpReceipt[]; nations: Record<string, string>; scores: Map<string, number> }

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
      const levelOf = (key: string) => (s.levels[key] ??= pick(noise(r.id, key, "lvl"), 38, 76));
      const races = raceDate && r.races > 0 && noise(r.id, date) < r.races / 3.4;
      const formBefore = s.form, fatigueBefore = s.fatigue;
      const gains: Record<string, number> = {};
      const detail: Record<string, { from: number; to: number }> = {};
      const activities: XpActivity[] = [0, 1, 2, 3, 4].map(slot => {
        const race = races && (slot === 2 || slot === 4);
        const rest = !race && (races || slot === 4 || noise(r.id, date, slot, "rest") < 0.12);
        const focus = r.focus[(slot + offset) % r.focus.length];
        const xp: Record<string, number> = {};
        if (race) for (const key of RACE_ABILITIES[pick(noise(date, slot, "terrain"), 0, 2)]) xp[key] = pick(noise(r.id, date, slot, key), 3, 9);
        else if (!rest) for (const key of focus) xp[key] = pick(noise(r.id, date, slot, key), 2, 7);
        const slotGains: Record<string, number> = {};
        for (const [key, earned] of Object.entries(xp)) {
          let bar = (s.bars[key] ?? 0) + earned;
          while (bar >= fixturePrice(levelOf(key))) {
            bar -= fixturePrice(levelOf(key));
            const from = levelOf(key);
            s.levels[key] = from + 1;
            slotGains[key] = (slotGains[key] ?? 0) + 1;
            gains[key] = (gains[key] ?? 0) + 1;
            detail[key] = { from: detail[key]?.from ?? from, to: from + 1 };
          }
          s.bars[key] = bar;
        }
        s.fatigue = Math.max(0, Math.min(80, s.fatigue + (race ? 9 : rest ? -6 : 3)));
        if (!race && !rest) scores.set(`${r.id}:${date}:${slot}`, pick(noise(r.id, date, slot, "score"), 34, 82));
        const activity: XpActivity = {
          rider_id: r.id, name: r.name, game_day: slot, race_day: race,
          focus: race || rest ? null : focus[0] === "sprint" ? "sprint" : "tempo",
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
        fatigue_delta: s.fatigue - fatigueBefore, race_day: activities.some(a => a.race_day), xp_bar: xpBar,
      } satisfies XpRiderReceipt;
    });
    receipts.push({
      tick_date: date, season_id: "fixture-season", receipt_status: "complete",
      game_days: [0, 1, 2, 3, 4], expected_game_days: [0, 1, 2, 3, 4], trained_now_slots: [],
      report: { riders, condition_settled: true },
    });
  }
  receipts.reverse(); // newest first, like aggregateTrainingRuns
  return { receipts, nations: Object.fromEntries(RIDERS.map(r => [r.id, r.nation])), scores };
}

export const fixtureScoreOf = (scores: Map<string, number>) =>
  (riderId: string, date: string, activity: TrainingActivity): number | null => scores.get(`${riderId}:${date}:${activity.game_day}`) ?? null;
