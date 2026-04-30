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
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <div className="mb-5">
          <p className="text-amber-700 font-bold text-sm mb-0.5">🚴 Kom i gang</p>
          <h2 className="text-slate-900 font-bold text-xl leading-tight">Dit hold er klar — hvad nu?</h2>
          <p className="text-slate-400 text-sm mt-1">Her er de tre vigtigste ting at kende til:</p>
        </div>

        <div className="grid gap-3 mb-5">
          {CARDS.map(card => (
            <div key={card.title} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-2xl flex-shrink-0 mt-0.5">{card.icon}</span>
              <div className="min-w-0">
                <p className="text-slate-900 font-semibold text-sm">{card.title}</p>
                <p className="text-slate-500 text-xs mt-0.5 mb-2 leading-relaxed">{card.desc}</p>
                <Link to={card.link} onClick={onClose} className="text-amber-700 text-xs hover:underline font-medium">
                  {card.linkLabel}
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <Link
            to="/help"
            onClick={onClose}
            className="text-slate-400 text-xs hover:text-amber-700 transition-colors font-medium"
          >
            Hjælp &amp; Regler →
          </Link>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-sm transition-colors"
          >
            Kom i gang
          </button>
        </div>
      </div>
    </div>
  );
}
