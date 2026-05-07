import { useEffect } from "react";
import { Link } from "react-router-dom";

const CARDS = [
  {
    icon: "🏪",
    title: "Marked",
    desc: "Gennemse alle ledige ryttere og filtrer på statistik og pris. Start en auktion for at byde hjem din første rytter.",
    link: "/riders",
    linkLabel: "Gå til Marked →",
  },
  {
    icon: "🔨",
    title: "Auktioner",
    desc: "Følg aktive auktioner, byd på andre holds ryttere, og hold øje med dine egne. Vinderen trækkes automatisk.",
    link: "/auctions",
    linkLabel: "Se Auktioner →",
  },
  {
    icon: "🏛️",
    title: "Bestyrelse",
    desc: "Bestyrelsen vurderer dig løbende ud fra holdkvalitet og resultater. Hold tilfredsheden høj for at undgå pres.",
    link: "/board",
    linkLabel: "Åbn Bestyrelse →",
  },
];

export default function OnboardingModal({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-cz-card rounded-2xl shadow-2xl max-w-lg w-full p-6 my-auto relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Luk"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full
            text-cz-3 hover:text-cz-1 hover:bg-cz-subtle transition-colors text-xl leading-none"
        >
          ×
        </button>

        <div className="mb-5 pr-8">
          <p className="text-cz-accent-t font-bold text-sm mb-0.5">🚴 Kom i gang</p>
          <h2 className="text-cz-1 font-bold text-xl leading-tight">Dit hold er klar — hvad nu?</h2>
          <p className="text-cz-3 text-sm mt-1">Her er de tre vigtigste ting at kende til:</p>
        </div>

        <div className="grid gap-3 mb-5">
          {CARDS.map(card => (
            <div key={card.title} className="flex items-start gap-3 bg-cz-subtle border border-cz-border rounded-xl p-4">
              <span className="text-2xl flex-shrink-0 mt-0.5">{card.icon}</span>
              <div className="min-w-0">
                <p className="text-cz-1 font-semibold text-sm">{card.title}</p>
                <p className="text-cz-2 text-xs mt-0.5 mb-2 leading-relaxed">{card.desc}</p>
                <Link to={card.link} onClick={onClose} className="text-cz-accent-t text-xs hover:underline font-medium">
                  {card.linkLabel}
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-cz-border">
          <Link
            to="/help"
            onClick={onClose}
            className="text-cz-3 text-xs hover:text-cz-accent-t transition-colors font-medium"
          >
            Hjælp &amp; Regler →
          </Link>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-cz-accent hover:brightness-110 text-white font-bold rounded-lg text-sm transition-colors"
          >
            Forstået
          </button>
        </div>
      </div>
    </div>
  );
}
