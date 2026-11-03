// #7540 · Ren afgoerelse af hvad mandatkortene (overblik + Mandat-fane) viser.
// Foer: `proposedMeeting` var null indtil GET /board/meeting svarede, og null
// blev laest som "intet forslag", saa tom-tilstanden blinkede frem mens
// aarsmoedet stadig blev hentet. Nu er "ikke svaret endnu" sin egen tilstand.

export type MandateCardState = "signed" | "loading" | "proposed" | "empty";

export interface MandateCardInput {
  mandate?: unknown;
  proposedMeeting?: { available?: boolean } | null;
  meetingLoaded?: boolean;
}

export function resolveMandateCardState({
  mandate = null,
  proposedMeeting = null,
  meetingLoaded = true,
}: MandateCardInput): MandateCardState {
  if (mandate) return "signed";
  if (!meetingLoaded) return "loading";
  if (proposedMeeting?.available) return "proposed";
  return "empty";
}
