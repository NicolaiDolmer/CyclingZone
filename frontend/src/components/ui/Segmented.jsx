// #4628 (slice 3 af #4622) — DEN kanoniske segmenterede kontrol.
//
// Idiomet var copy-pastet tre steder (Mit hold: nuvaerende/kommende + Overblik/
// Evner, holdsiden: nuvaerende/kommende) med hver sin padding og hver sin
// aktiv-stil. Audit 2026-09 (raekke #2) kaldte den ene af dem en "loesrevet
// raekke over tabellen"; naar idiomet kun findes ET sted kan det ogsaa kun
// placeres ET sted (DataTable's toolbar).
//
// Anatomi (PAGE_TEMPLATES.md: hairline-borders, 5px radius, ingen skygger):
// hairline-ramme + 5px radius om hele gruppen, 12px/500 labels, aktivt segment
// = guld-TEKST paa 10% guld-flade (TASTE fork 3, guld-sted 3 "quiet actions og
// aktiv fane"). Ingen udfyldt knap-baggrund, ingen anden radius.
//
// Det aktive segment mister sin klik-handler og sin pointer-cursor (#3188:
// et gentaget klik paa det allerede aktive segment er en garanteret no-op og
// blev maalt som en af appens stoerste dead-click-kilder).
//
// Filen er .jsx og ikke .tsx (hard rule 31) fordi frontend'ens tsconfig koerer
// strict uden @types/react installeret — enhver .tsx-KOMPONENT fejler CI's
// `npm run typecheck` paa TS7026/TS7016. Se PR-beskrivelsen (#4628).
//
// props:
//   label     — aria-label paa gruppen; segmenterne har ingen anden faelles etikette
//   value     — det aktive segments value
//   onChange  — (next) => void
//   options   — [{ value, label, title? }]
export function Segmented({ label, value, onChange, options, className = "" }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex overflow-hidden rounded-cz border border-cz-border ${className}`.trim()}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={active ? undefined : () => onChange(option.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              active
                ? "cursor-default bg-cz-accent/10 text-cz-accent-t"
                : "bg-cz-card text-cz-2 hover:text-cz-1"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
