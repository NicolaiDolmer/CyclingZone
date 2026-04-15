import { useState } from "react";
import { signIn, signUp } from "../lib/supabase";

export default function LoginPage() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (mode === "login") {
      const { error } = await signIn(email, password);
      if (error) setError("Forkert email eller adgangskode");
    } else {
      const { error } = await signUp(email, password);
      if (error) setError(error.message);
      else setSuccess("Tjek din email for at bekræfte din konto!");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4
      relative overflow-hidden">

      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(#e8c547 1px, transparent 1px), linear-gradient(90deg, #e8c547 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
        w-[500px] h-[500px] rounded-full opacity-10 blur-[120px]
        bg-[#e8c547] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16
            rounded-2xl bg-[#e8c547] mb-5 shadow-[0_0_40px_rgba(232,197,71,0.3)]">
            <span className="text-[#0a0a0f] font-black text-3xl">C</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Cycling Zone Manager
          </h1>
          <p className="text-white/40 text-sm mt-1">
            {mode === "login" ? "Log ind for at fortsætte" : "Opret din managerkonto"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#0f0f18] border border-white/8 rounded-2xl p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-medium text-white/40
                  uppercase tracking-wider mb-1.5">
                  Hold- og managernavn
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="f.eks. Dolmer Racing"
                  required={mode === "signup"}
                  className="w-full bg-white/5 border border-white/8 rounded-lg
                    px-4 py-2.5 text-white text-sm placeholder-white/20
                    focus:outline-none focus:border-[#e8c547]/50 focus:bg-white/8
                    transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-white/40
                uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="din@email.dk"
                required
                className="w-full bg-white/5 border border-white/8 rounded-lg
                  px-4 py-2.5 text-white text-sm placeholder-white/20
                  focus:outline-none focus:border-[#e8c547]/50 focus:bg-white/8
                  transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/40
                uppercase tracking-wider mb-1.5">
                Adgangskode
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-white/5 border border-white/8 rounded-lg
                  px-4 py-2.5 text-white text-sm placeholder-white/20
                  focus:outline-none focus:border-[#e8c547]/50 focus:bg-white/8
                  transition-all"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg
                px-4 py-2.5 text-red-400 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg
                px-4 py-2.5 text-green-400 text-sm">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                py-2.5 text-sm tracking-wide hover:bg-[#f0d060] transition-all
                disabled:opacity-50 disabled:cursor-not-allowed
                shadow-[0_4px_20px_rgba(232,197,71,0.2)]">
              {loading ? "Vent..." : mode === "login" ? "Log ind" : "Opret konto"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
              className="text-sm text-white/40 hover:text-white/60 transition-colors">
              {mode === "login"
                ? "Ingen konto? Opret her"
                : "Har allerede konto? Log ind"}
            </button>
          </div>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          Cycling Zone Manager — Multiplayer Edition
        </p>
      </div>
    </div>
  );
}
