// Ren model bag holdtabellen "retning B" (#6110 S26). Ingen I/O, kun regler der
// kan testes med `node --test`.

// Hvad Assistent-kolonnen viser for en rytter:
//   "use"      assistenten har et forslag (Use-knap)
//   "agrees"   rytterens dag er allerede i orden efter assistentens regler
//   "noDay"    rytteren har ingen dag endnu (den eksisterende "Use assistant pick")
//   "none"     assistenten har intet grundlag (dagen er afregnet/laast)
export type AssistantKind = "use" | "agrees" | "noDay" | "none";

export function assistantKindFor({
  noDay,
  suggested,
  decided,
}: {
  noDay: boolean;
  suggested: boolean;
  // Forslagene er beregnet for i dag. Efter "Train now" er dagen laast, og et
  // "Agrees" ville paastaa noget om en dag der ikke kan aendres.
  decided: boolean;
}): AssistantKind {
  if (!decided) return "none";
  if (noDay) return "noDay";
  return suggested ? "use" : "agrees";
}

// "Dage 70+": et tal pr. rytter. Feltet mangler hele vejen (flag off, fejl) =
// null = en streg, aldrig et opdigtet 0. Feltet findes men rytteren er ikke
// med = 0 dage.
export function daysOverLimit(
  byRider: Record<string, number> | null | undefined,
  riderId: string,
): number | null {
  if (!byRider) return null;
  const n = Number(byRider[riderId] ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
