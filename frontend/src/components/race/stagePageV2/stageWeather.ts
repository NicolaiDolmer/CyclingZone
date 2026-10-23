// #6993 · Etapens vejr for spilleren: ét ord (tørt / regn / blæst) og, efter
// etapen, om vejret kostede rytterne kraft.
//
// Ejer-princip: vis aldrig noget der kan være forkert. Derfor:
//   FØR etapen: race_stage_profiles.weather er præcis det v4-motoren læser
//     (routeAdapter.resolveWeather). Mangler feltet, regner motoren et
//     fallback-vejr vi ikke kender her, så intet vises.
//   EFTER etapen: kun når løbsloggen er v4's egen (timeline_version 2). Motoren
//     skriver en "weather"-hændelse, når regn eller vind koster CP på et segment
//     (segmentLoop.ts). Hændelsen er beviset for sætningen. Tørt uden hændelse er
//     sandt; regn/vind uden hændelse (eller en anden slags end profilen) kan
//     ikke forklares fra data, så intet vises.
//   Holdtidskørslen kører uden vejr (mechanics/teamTimeTrial.ts), så den viser
//     intet. Enkeltstarten bruger vejret (individualTimeTrial.ts) men logger det
//     ikke: ordet vises, sætningen aldrig.
import type { RaceStory } from "./raceStoryModel.ts";

export type WeatherWord = "dry" | "rain" | "wind";

export interface StageWeather {
  word: WeatherWord;
  /** Kun efter etapen og kun når motoren selv loggede vejret. */
  mattered: boolean;
}

const WORD_BY_KIND: Record<string, WeatherWord> = { sun: "dry", overcast: "dry", rain: "rain", wind: "wind" };

/** v4-motorens egen løbslog (raceRunner: buildStageTimelineV4). */
export const V4_TIMELINE_VERSION = 2;

export function weatherWord(kind: unknown): WeatherWord | null {
  return typeof kind === "string" ? WORD_BY_KIND[kind] ?? null : null;
}

export function stageWeather(
  profile: { profile_type?: string | null; weather?: { kind?: unknown } | null } | null,
  phase: "before" | "after",
  story: RaceStory | null = null,
): StageWeather | null {
  if (!profile || profile.profile_type === "ttt") return null;
  const word = weatherWord(profile.weather?.kind);
  if (!word) return null;
  if (phase === "before") return { word, mattered: false };

  if (!story || story.timeline_version !== V4_TIMELINE_VERSION) return null;
  if (story.time_trial) return { word, mattered: false };
  const event = story.moments.find((m) => m.type === "weather");
  if (event) return weatherWord(event.data?.kind) === word ? { word, mattered: true } : null;
  return word === "dry" ? { word, mattered: false } : null;
}
