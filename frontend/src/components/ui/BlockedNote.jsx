// #2718/#2719/#2254 — den synlige halvdel af useBlockedAction.
//
// Står under (eller ved siden af) et kontrol-element der er blokeret, og siger i
// klar tekst hvorfor det ikke kan køre lige nu. Uden den er en blokeret knap et
// dødt klik: spilleren ser en knap, trykker, og får intet svar.
//
// Æstetik: hairline-fri inline-note i warning-tone, stroke-ikon (aldrig emoji),
// tabular figures så beløb i begrundelsen står lige. Ingen skygge, ingen glow.
import { AlertTriangleIcon } from "./icons/index.jsx";

export default function BlockedNote({ id, pulseKey = 0, children, className = "" }) {
  if (!children) return null;
  return (
    // `key` skifter ved hvert blokeret klik → React gen-monterer <p>, og
    // cz-blocked-note-animationen starter forfra. Det er puls-kvitteringen.
    <p
      key={pulseKey}
      id={id}
      role="status"
      className={`cz-blocked-note flex items-start gap-1 leading-tight text-cz-warning ${className}`}
    >
      <AlertTriangleIcon size={12} aria-hidden="true" className="mt-[2px] shrink-0" />
      <span className="tabular-nums">{children}</span>
    </p>
  );
}
