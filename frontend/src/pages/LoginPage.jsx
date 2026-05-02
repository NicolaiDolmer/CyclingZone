import { useState } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

function getPasswordResetRedirectUrl() {
  return new URL("/reset-password", window.location.origin).toString();
}

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamName, setTeamName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  const isLoginMode = mode === "login";
  const isSignupMode = mode === "signup";
  const isForgotMode = mode === "forgot";

  function resetMessages() {
    setError("");
    setSuccess(null);
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    resetMessages();

    if (nextMode !== "signup") {
      setTeamName("");
      setManagerName("");
    }
  }

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) setError("Forkert email eller adgangskode");
        return;
      }

      if (isForgotMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getPasswordResetRedirectUrl(),
        });

        if (error) {
          setError(error.message);
          return;
        }

        setSuccess({
          kind: "forgot",
          message: "Vi har sendt et reset-link til din email.",
        });
        setPassword("");
        return;
      }

      if (!teamName.trim() || teamName.trim().length < 3) {
        setError("Holdnavn skal være mindst 3 tegn");
        return;
      }

      if (!managerName.trim() || managerName.trim().length < 2) {
        setError("Managernavn skal være mindst 2 tegn");
        return;
      }

      const { data: existing } = await supabase
        .from("teams")
        .select("id")
        .ilike("name", teamName.trim())
        .single();

      if (existing) {
        setError("Dette holdnavn er allerede taget — vælg et andet");
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { team_name: teamName.trim() },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (!data?.user) return;

      await new Promise(resolve => setTimeout(resolve, 1000));

      const headers = await getAuthHeaders();
      if (!headers) {
        setSuccess({
          kind: "signup",
          message: "Konto oprettet. Log ind for at færdiggøre holdopsætning.",
        });
        return;
      }

      const bootstrapRes = await fetch(`${API}/api/teams/my`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: teamName.trim(),
          manager_name: managerName.trim(),
        }),
      });
      const bootstrapData = await bootstrapRes.json();

      if (!bootstrapRes.ok) {
        setError(`Konto oprettet, men holdet kunne ikke initialiseres: ${bootstrapData.error}`);
        return;
      }

      setSuccess({
        kind: "signup",
        message: `Velkommen, ${bootstrapData.team.name}! Dit hold er klar.`,
      });
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full bg-cz-subtle border border-cz-border rounded-lg " +
    "px-4 py-2.5 text-cz-1 text-sm placeholder-cz-3 " +
    "focus:outline-none focus:border-cz-accent transition-all";

  return (
    <div className="min-h-screen bg-cz-body flex items-center justify-center p-4 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[500px] h-[500px] rounded-full opacity-10 blur-[120px] bg-cz-accent pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-16 h-16
              rounded-2xl bg-cz-accent mb-5 shadow-[0_0_40px_rgba(232,197,71,0.3)]"
          >
            <span className="text-cz-on-accent font-black text-3xl">C</span>
          </div>
          <h1 className="text-2xl font-bold text-cz-1 tracking-tight">
            Cycling Zone
          </h1>
          <p className="text-cz-2 text-sm mt-1">
            {isLoginMode
              ? "Log ind for at fortsætte"
              : isSignupMode
                ? "Opret din managerkonto"
                : "Få et link til at nulstille din adgangskode"}
          </p>
        </div>

        <div className="bg-cz-card border border-cz-border rounded-2xl p-6">
          {success ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">{success.kind === "signup" ? "🎉" : "✉️"}</div>
              <p className="text-cz-success text-sm font-medium">{success.message}</p>
              <p className="text-cz-3 text-xs mt-3">
                {success.kind === "signup"
                  ? "Tjek din email for at bekræfte din konto, og log derefter ind."
                  : "Åbn mailen og følg reset-linket for at vælge en ny adgangskode."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setSuccess(null);
                  setTeamName("");
                  setManagerName("");
                  setPassword("");
                }}
                className="mt-4 w-full bg-cz-accent text-cz-on-accent font-bold rounded-lg
                  py-2.5 text-sm hover:brightness-110 transition-all"
              >
                Gå til login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {isSignupMode && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                      Holdnavn
                    </label>
                    <input
                      type="text"
                      value={teamName}
                      onChange={e => setTeamName(e.target.value)}
                      placeholder="f.eks. Dolmer Racing"
                      required
                      minLength={3}
                      maxLength={30}
                      className={inputClass}
                    />
                    <p className="text-cz-3 text-xs mt-1">3-30 tegn — dette bliver dit holdnavn i spillet</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                      Managernavn
                    </label>
                    <input
                      type="text"
                      value={managerName}
                      onChange={e => setManagerName(e.target.value)}
                      placeholder="f.eks. Nicolai Hansen"
                      required
                      minLength={2}
                      maxLength={50}
                      className={inputClass}
                    />
                    <p className="text-cz-3 text-xs mt-1">Dit navn som manager — vises på holdprofilen</p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="din@email.dk"
                  required
                  className={inputClass}
                />
                {isForgotMode && (
                  <p className="text-cz-3 text-xs mt-1">
                    Vi sender et sikkert reset-link til denne email.
                  </p>
                )}
              </div>

              {!isForgotMode && (
                <div>
                  <label className="block text-xs font-medium text-cz-2 uppercase tracking-wider mb-1.5">
                    Adgangskode
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className={inputClass}
                  />
                  {isSignupMode && (
                    <p className="text-cz-3 text-xs mt-1">Minimum 6 tegn</p>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-lg px-4 py-2.5 text-cz-danger text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-cz-accent text-cz-on-accent font-bold rounded-lg
                  py-2.5 text-sm tracking-wide hover:brightness-110 transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-[0_4px_20px_rgba(232,197,71,0.2)]"
              >
                {loading
                  ? isSignupMode
                    ? "Opretter konto og hold..."
                    : isForgotMode
                      ? "Sender reset-link..."
                      : "Logger ind..."
                  : isSignupMode
                    ? "Opret konto og hold"
                    : isForgotMode
                      ? "Send reset-link"
                      : "Log ind"}
              </button>
            </form>
          )}

          {!success && (
            <div className="mt-4 flex flex-col gap-2 text-center">
              {isLoginMode && (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                  >
                    Glemt password?
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                  >
                    Ingen konto? Opret her
                  </button>
                </>
              )}

              {isSignupMode && (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                >
                  Har allerede konto? Log ind
                </button>
              )}

              {isForgotMode && (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-sm text-cz-2 hover:text-cz-1 transition-colors"
                >
                  Tilbage til login
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-cz-3 text-xs mt-6">
          Cycling Zone — Multiplayer Edition
        </p>
      </div>
    </div>
  );
}
