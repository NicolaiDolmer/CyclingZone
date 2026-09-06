// #2307 · NaN-guard: goal.target kan være 0/undefined (fx endnu-uevalueret mål) →
// division uden guard giver `width: NaN%` / Math.round(NaN) i UI. Brug ALTID
// denne helper i stedet for rå `(x / goal.target) * 100`.
//
// #4557 · Flyttet UÆNDRET ud af BoardPage.jsx så Boardroom-siden regner
// mål-fremdrift efter præcis samme regel som den gamle bestyrelsesside. Ingen
// ny formel, ingen opdigtede procenter (TASTE P11) — er `target` 0/manglende,
// er svaret 0, ikke et gæt.
export function goalProgressPct(current, target) {
  if (!target) return 0;
  return Math.min(100, Math.round(((current ?? 0) / target) * 100));
}
