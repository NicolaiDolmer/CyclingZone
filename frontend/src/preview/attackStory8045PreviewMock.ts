// #8045 · Preview: ?attackStoryStage=1 lægger en afviklet bjergetape (topankomst, angreb på
// sidste stigning) ind som race-live-1 etape 2, så angrebets forløb i løbsfilmen kan ses før
// kontakten tændes. ?attackStory=on tænder den nye fortælling (betaAccessMock), uden den ses
// dagens angrebslinjer på samme etape (før/efter). ?attackStoryStage=0 slukker igen.
// Kun installPreviewMock bruger filen, så Playwright-fixtures og deres billeder er uændrede.
import { buildRaceStory, storyInputsFromResults } from "../../../backend/lib/raceStory.js";
import { ATTACK_STORY_8045_ELEVATION, ATTACK_STORY_8045_EVENTS, ATTACK_STORY_8045_PROFILE, ATTACK_STORY_8045_RESULTS } from "./attackStory8045PreviewData.ts";

const RACE = "race-live-1";
const STAGE = 2;

export function attackStory8045StageActive(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("attackStoryStage");
    if (param === "1" || param === "on") localStorage.setItem("cz_mock_attack_story_stage_8045", "1");
    if (param === "0" || param === "off") localStorage.setItem("cz_mock_attack_story_stage_8045", "0");
    return localStorage.getItem("cz_mock_attack_story_stage_8045") === "1";
  } catch {
    return false;
  }
}

function query(url: string): URLSearchParams | null {
  try { return new URL(url, "http://preview.local").searchParams; } catch { return null; }
}

function isStageRow(row: unknown): boolean {
  return (row as { stage_number?: number } | null)?.stage_number === STAGE;
}

/** race_results for etape 2 (og løbets etaperækker). null = ikke dette kald eller ikke aktiv. */
export function attackStory8045Results(url: string, rows: unknown[]): unknown[] | null {
  if (!attackStory8045StageActive() || !url.includes("/rest/v1/race_results")) return null;
  const q = query(url);
  if (!q || q.get("race_id") !== `eq.${RACE}`) return null;
  const stage = q.get("stage_number");
  const type = q.get("result_type");
  if (stage === `eq.${STAGE}`) return ATTACK_STORY_8045_RESULTS.filter((r) => !type || type === `eq.${r.result_type}`);
  if (!stage && type === "eq.stage") return [...rows.filter((r) => !isStageRow(r)), ...ATTACK_STORY_8045_RESULTS];
  return null;
}

/** race_stage_profiles: etape 2 bliver bjergetapen med sin egen højdeserie. */
export function attackStory8045Profiles(url: string, rows: unknown[]): unknown[] | null {
  if (!attackStory8045StageActive() || !url.includes("/rest/v1/race_stage_profiles")) return null;
  const q = query(url);
  if (!q || q.get("race_id") !== `eq.${RACE}`) return null;
  return rows.map((row) => (isStageRow(row) ? { ...(row as object), ...ATTACK_STORY_8045_PROFILE, elevation_profile: ATTACK_STORY_8045_ELEVATION } : row));
}

let cachedStory: unknown = null;

/** GET /api/races/race-live-1/timeline?stage=2[&story=1]: motorens løbslog og historien bygget af samme kode som backenden. */
export function attackStory8045Timeline(url: string): unknown | null {
  if (!attackStory8045StageActive() || !url.includes(`/api/races/${RACE}/timeline?`)) return null;
  const q = query(url);
  if (!q || q.get("stage") !== String(STAGE)) return null;
  const timeline = { timeline_version: 2, stage_number: STAGE, events: ATTACK_STORY_8045_EVENTS, created_at: "2026-11-23T18:00:37.556Z" };
  if (q.get("story") !== "1") return timeline;
  cachedStory ??= buildRaceStory({ events: ATTACK_STORY_8045_EVENTS, timelineVersion: 2, ...storyInputsFromResults(ATTACK_STORY_8045_RESULTS, STAGE) });
  return { ...timeline, story: cachedStory };
}
