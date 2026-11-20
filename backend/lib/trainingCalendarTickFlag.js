// #6110 ejer 19/11: "Hold uden division skal ikke træne."
//
// Kalenderdagens reservevej (isLegacyCalendarTickTeam) giver i dag et tick til ethvert hold uden
// division, der ikke er parkeret. For AI-hold er det kun form, træthed og skade (ingen udvikling,
// D6). For et menneskehold uden division er det et fuldt træningstick med udvikling. Med kontakten
// tændt får kun AI-hold uden division reservevejens tick; et menneskehold uden division træner ikke.
//
// Kontakten er binær: kun den eksakte værdi "on" tænder. En manglende række eller en fejlet
// læsning er slukket, altså præcis dagens regel. Læses frisk hver gang (motorkontakt).
import { readFlagStage } from "./featureStage.js";

export const TRAINING_CALENDAR_TICK_AI_ONLY_KEY = "training_calendar_tick_ai_only";

export async function isCalendarTickAiOnly(supabase) {
  return (await readFlagStage(supabase, TRAINING_CALENDAR_TICK_AI_ONLY_KEY, { fresh: true })) === "on";
}
