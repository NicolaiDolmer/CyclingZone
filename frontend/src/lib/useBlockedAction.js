// #2718/#2719/#2254 — modgiften mod "døde klik".
//
// Et kontrol-element der ikke kan køre lige nu er i én af to tilstande, og de
// SKAL behandles forskelligt:
//
//   • I gang (in-flight) → ægte `disabled` + spinner/label. Selv-forklarende:
//     spilleren kan se at noget sker, så han venter i stedet for at klikke igen.
//
//   • Blokeret (validering, manglende data, for lav saldo, ...) → ALDRIG bare
//     `disabled`. En disabled knap er usynlig for spilleren: han ser en knap der
//     ligner en knap, trykker, og der sker ingenting. Så trykker han igen. Og
//     igen. (#2718: 15 gange i træk, efterfulgt af et rage-click.)
//
// Blokerede kontroller får derfor `aria-disabled` i stedet for `disabled` — så
// klikket faktisk rammer et element vi kan svare på — en synlig begrundelse
// bundet via `aria-describedby`, og en kort puls-kvittering på klikket så
// handlingen aldrig føles ubesvaret.
//
// Regel: `reason` er en FÆRDIG, lokaliseret sætning der forklarer hvorfor, i
// spillerens eget sprog. Er den falsy, er kontrollen ikke blokeret.
import { useCallback, useId, useState } from "react";

export function useBlockedAction(reason) {
  const reasonId = useId();
  // Ændres ved hvert blokeret klik. BlockedNote bruger den som React-key, så
  // noten gen-monteres og CSS-pulsen starter forfra — det er selve kvitteringen.
  const [pulseKey, setPulseKey] = useState(0);
  const blocked = Boolean(reason);

  // Spredes på selve kontrollen. Bemærk: IKKE `disabled` — se filhovedet.
  const blockedProps = blocked
    ? { "aria-disabled": true, "aria-describedby": reasonId }
    : {};

  // Pak den rigtige handler: blokeret → kør den ikke, men kvittér synligt.
  const guard = useCallback(
    (run) => (event) => {
      if (!blocked) return run?.(event);
      event?.preventDefault?.();
      setPulseKey((n) => n + 1);
      return undefined;
    },
    [blocked],
  );

  return { blocked, reason, reasonId, pulseKey, blockedProps, guard };
}

export default useBlockedAction;
