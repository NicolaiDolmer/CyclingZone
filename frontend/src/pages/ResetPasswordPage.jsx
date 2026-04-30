import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage({ session }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(Boolean(session));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    let resolved = false;

    function resolve(hasSession) {
      if (resolved || !active) return;
      resolved = true;
      setHasRecoverySession(hasSession);
      setChecking(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        resolve(Boolean(nextSession));
        return;
      }

      if (event === "SIGNED_OUT") {
        resolve(false);
      }
    });

    // Fast path for implicit flow: session may already be ready
    supabase.auth.getSession().then(({ data: { session: nextSession } }) => {
      if (nextSession) resolve(true);
    });

    // Fallback: if no auth event fires within 2s, declare no recovery session
    const timeout = setTimeout(() => resolve(false), 2000);

    return () => {
      active = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!hasRecoverySession) {
      setError("Reset-linket er udløbet eller ugyldigt. Bed om et nyt fra login-siden.");
      return;
    }

    if (password.length < 6) {
      setError("Adgangskoden skal være mindst 6 tegn");
      return;
    }

    if (password !== confirmPassword) {
      setError("Adgangskoderne matcher ikke");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setError(error.message);
        return;
      }

      setSuccess("Din adgangskode er opdateret.");
      setPassword("");
      setConfirmPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-cz-body flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(#e8c547 1px, transparent 1px), linear-gradient(90deg, #e8c547 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[500px] h-[500px] rounded-full opacity-10 blur-[120px] bg-[#e8c547] pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-16 h-16
              rounded-2xl bg-[#e8c547] mb-5 shadow-[0_0_40px_rgba(232,197,71,0.3)]"
          >
            <span className="text-[#0a0a0f] font-black text-3xl">C</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Nulstil adgangskode
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Vælg en ny adgangskode til din managerkonto
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6">
          {checking ? (
            <div className="py-10 flex justify-center">
              <div className="w-7 h-7 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
            </div>
          ) : success ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">✅</div>
              <p className="text-green-700 text-sm font-medium">{success}</p>
              <p className="text-slate-500 text-xs mt-3">
                Du kan fortsætte direkte ind i spillet med din nye adgangskode.
              </p>
              <button
                type="button"
                onClick={() => navigate("/dashboard", { replace: true })}
                className="mt-4 w-full bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                  py-2.5 text-sm hover:bg-[#f0d060] transition-all"
              >
                Gå til dashboard
              </button>
            </div>
          ) : hasRecoverySession ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Ny adgangskode
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg
                    px-4 py-2.5 text-slate-900 text-sm placeholder-slate-400
                    focus:outline-none focus:border-amber-400 focus:bg-slate-100 transition-all"
                />
                <p className="text-slate-300 text-xs mt-1">Minimum 6 tegn</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Gentag ny adgangskode
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg
                    px-4 py-2.5 text-slate-900 text-sm placeholder-slate-400
                    focus:outline-none focus:border-amber-400 focus:bg-slate-100 transition-all"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                  py-2.5 text-sm tracking-wide hover:bg-[#f0d060] transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-[0_4px_20px_rgba(232,197,71,0.2)]"
              >
                {loading ? "Gemmer ny adgangskode..." : "Gem ny adgangskode"}
              </button>
            </form>
          ) : (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">⚠️</div>
              <p className="text-red-700 text-sm font-medium">
                Reset-linket er ikke aktivt længere.
              </p>
              <p className="text-slate-500 text-xs mt-3">
                Bed om et nyt reset-link fra login-siden og åbn mailen igen.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login", { replace: true })}
                className="mt-4 w-full bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                  py-2.5 text-sm hover:bg-[#f0d060] transition-all"
              >
                Tilbage til login
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-slate-300 text-xs mt-6">
          Cycling Zone — Multiplayer Edition
        </p>
      </div>
    </div>
  );
}
