// Syntetiske ryttere til skitsen. Ingen rigtige ryttere, hold eller managers.
// Tal er opfundne og kun der for at raekkerne ligner en rigtig tilstand.

import type { Plan } from "./effortModel.ts";

export type SketchRider = {
  id: string;
  label: string; // "Rider 1" ... vises som "Rytter 1" via copy-prefix i UI
  type: "climber" | "sprinter" | "allround" | "puncheur" | "tt" | "classics";
  fatigue: number;
  form: number;
  plan: Plan; // gemt plan som i dag: (focus, intensity)
  // Assistentens forslag pr. indsats for denne rytter (kun til variant C).
  suggest: { easy: string; normal: string; hard: string };
};

export const RIDERS: SketchRider[] = [
  { id: "r1", label: "1", type: "climber", fatigue: 34, form: 78, plan: { focus: "long_climbs", intensity: "hard" },
    suggest: { easy: "endurance", normal: "tempo", hard: "long_climbs" } },
  { id: "r2", label: "2", type: "sprinter", fatigue: 61, form: 70, plan: { focus: "sprint", intensity: "hard" },
    suggest: { easy: "endurance", normal: "tempo", hard: "sprint" } },
  { id: "r3", label: "3", type: "allround", fatigue: 48, form: 66, plan: { focus: "tempo", intensity: "normal" },
    suggest: { easy: "endurance", normal: "tempo", hard: "vo2max" } },
  { id: "r4", label: "4", type: "puncheur", fatigue: 72, form: 59, plan: { focus: "restitution", intensity: "recovery" },
    suggest: { easy: "endurance", normal: "tempo", hard: "vo2max_punch" } },
  { id: "r5", label: "5", type: "tt", fatigue: 29, form: 81, plan: { focus: "itt_long", intensity: "hard" },
    suggest: { easy: "endurance", normal: "tempo", hard: "itt_long" } },
  { id: "r6", label: "6", type: "classics", fatigue: 55, form: 63, plan: { focus: "endurance", intensity: "easy" },
    suggest: { easy: "endurance", normal: "tempo", hard: "cobbled_classic" } },
  // Hvile med et gemt fokus, som i dag: fokus staar i kolonnen men trænes ikke.
  { id: "r7", label: "7", type: "climber", fatigue: 83, form: 52, plan: { focus: "vo2max_climb", intensity: "rest" },
    suggest: { easy: "endurance", normal: "tempo", hard: "vo2max_climb" } },
  { id: "r8", label: "8", type: "allround", fatigue: 41, form: 69, plan: { focus: "technique", intensity: "easy" },
    suggest: { easy: "technique", normal: "tempo", hard: "threshold" } },
];
