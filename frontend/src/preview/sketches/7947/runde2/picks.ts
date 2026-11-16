// Syntetiske tillaeg til rytterne fra runde 1 (../data.ts). Ingen regler: hvert
// forslag og hver farve er skrevet direkte pr. rytter, saa skitsen ikke ligner
// en kalibreret graense i motoren.

import type { Quick } from "./quickModel.ts";

export type Tone = "ok" | "warn" | "risk";

export const EXTRA: Record<string, {
  tone: Tone;
  pick: Quick; // assistentens et-tryks-forslag (D4)
  reason: "fresh" | "tired" | "veryTired" | "overLimit" | "steady";
  season: [string, number][]; // gammel flade: "Denne saeson", syntetisk
}> = {
  r1: { tone: "ok", pick: "own", reason: "fresh", season: [["Bjerg", 3], ["Bakke", 1]] },
  r2: { tone: "warn", pick: "easy", reason: "tired", season: [["Sprint", 2], ["Acc.", 1]] },
  r3: { tone: "ok", pick: "own", reason: "steady", season: [["Bjerg", 1], ["Flad", 1]] },
  r4: { tone: "risk", pick: "active", reason: "veryTired", season: [["Punch", 2]] },
  r5: { tone: "ok", pick: "own", reason: "fresh", season: [["Enkeltstart", 3]] },
  r6: { tone: "warn", pick: "normal", reason: "tired", season: [["Brosten", 2], ["Flad", 1]] },
  r7: { tone: "risk", pick: "rest", reason: "overLimit", season: [["Bjerg", 2]] },
  r8: { tone: "ok", pick: "hard", reason: "fresh", season: [["Teknik", 1]] },
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-cz-success",
  warn: "text-cz-warning",
  risk: "text-cz-danger",
};
