import { useEffect, useState } from "react";

export function ConfettiModal({ show, onClose, title, subtitle, amount, icon = "🏆" }) {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    if (!show) return;
    // Generate confetti particles
    const colors = ["#e8c547", "#4ade80", "#60a5fa", "#f472b6", "#a78bfa"];
    setParticles(
      Array.from({ length: 32 }, (_, i) => ({
        id: i,
        color: colors[i % colors.length],
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 0.8 + Math.random() * 0.6,
        size: 4 + Math.random() * 6,
        rotate: Math.random() * 360,
      }))
    );
    // Auto-close after 4 seconds
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map(p => (
          <div key={p.id}
            className="absolute animate-bounce"
            style={{
              left: `${p.x}%`,
              top: "-10px",
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: Math.random() > 0.5 ? "50%" : "2px",
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          />
        ))}
      </div>

      {/* Modal */}
      <div className="relative z-10 bg-white border border-slate-300 rounded-2xl p-8
        text-center max-w-sm w-full mx-4 shadow-2xl"
        style={{ animation: "scaleIn 0.3s ease-out" }}>

        <div className="text-6xl mb-4">{icon}</div>
        <h2 className="text-slate-900 font-bold text-2xl mb-2">{title}</h2>
        {subtitle && <p className="text-slate-500 text-sm mb-3">{subtitle}</p>}
        {amount > 0 && (
          <p className="text-amber-700 font-mono font-bold text-xl mb-4">
            {amount.toLocaleString("da-DK")} CZ$
          </p>
        )}
        <p className="text-slate-400 text-xs">Klik for at lukke</p>
      </div>

      <style>{`
        @keyframes scaleIn {
          from { transform: scale(0.5); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}
