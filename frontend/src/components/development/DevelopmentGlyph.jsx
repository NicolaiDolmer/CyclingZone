// DevelopmentGlyph — vandret udviklings-bjælke, FAST skala 0-max (default 99).
// #3721: Development-fanens visuelle kerne (Train today / Development / History,
// docs/design/PAGE_TEMPLATES.md T2, ejer-godkendt design 19/8).
//
// Tre lag, samme 0-99-skala:
//   1) prognose-båndet lo-hi (progLo/progHi) — halvtransparent, tegnes FØRST
//      (nederst), så den del af båndet nu-tallet allerede har nået dækkes af
//      det fyldte "nu"-segment ovenpå. Kun VÆKSTEN der er tilbage (fra nu til
//      hi) står synligt tilbage — ikke hele det historiske spænd.
//   2) nu-rating (now) — fyldt, opak, samme rating-farve-rampe som resten af
//      spillet (statColor scale:"rating", #3666), fra 0 til now.
//   3) rollens loft (loft) — et tyndt lodret mærke, tegnes SIDST (øverst) så
//      det altid er synligt.
//
// Ingen ny beregning: alle tre tal kommer uændret fra
// POST /api/scouting/estimates (samme kilde som ScoutablePotentiale/
// PotentialBand) — komponenten er ren visning. Rå potentiale/lofter forlader
// stadig aldrig serveren (#1162); loft her er rolle+alder-bestemt, ikke
// rytter-hemmeligt (samme undtagelse som PotentialBand gør).
//
// aria-hidden: den localiserede "now · lo-hi · loft"-tekst står ved siden af
// glyffen (TrainingPage's Development-fane), så glyffen selv bærer intet
// sprog at oversætte forkert.

import { statColor } from "../../lib/statColor.js";
import { pct } from "../../lib/developmentGlyph.js";

export default function DevelopmentGlyph({ now, progLo, progHi, loft, max = 99 }) {
  const nowPct = pct(now, max);
  const loPct = pct(progLo, max);
  const hiPct = pct(progHi, max);
  const loftPct = pct(loft, max);
  const hasBand = loPct != null && hiPct != null && hiPct >= loPct;

  return (
    <div
      className="relative h-2 w-full min-w-[88px] overflow-hidden rounded-cz bg-cz-subtle"
      aria-hidden="true"
    >
      {hasBand && (
        <span
          className="absolute inset-y-0 bg-cz-accent/35"
          style={{ left: `${loPct}%`, width: `${Math.max(hiPct - loPct, 1.5)}%` }}
        />
      )}
      {nowPct != null && (
        <span
          className="absolute inset-y-0 left-0 rounded-cz"
          style={{ width: `${nowPct}%`, backgroundColor: statColor(now, { scale: "rating" }) }}
        />
      )}
      {loftPct != null && (
        <span className="absolute inset-y-0 w-px bg-cz-1" style={{ left: `${loftPct}%` }} />
      )}
    </div>
  );
}
