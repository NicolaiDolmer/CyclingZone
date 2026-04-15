import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Forkert email eller adgangskode");
    } else {
      // Validate team name
      if (!teamName.trim() || teamName.trim().length < 3) {
        setError("Holdnavn skal være mindst 3 tegn");
        setLoading(false);
        return;
      }

      // Check team name not already taken
      const { data: existing } = await supabase
        .from("teams")
        .select("id")
        .ilike("name", teamName.trim())
        .single();

      if (existing) {
        setError("Dette holdnavn er allerede taget — vælg et andet");
        setLoading(false);
        return;
      }

      // Sign up user
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { team_name: teamName.trim() }
        }
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (data?.user) {
        // Wait a moment for the trigger to create the user profile
        await new Promise(r => setTimeout(r, 1000));

        // Create team automatically
        const { error: teamError } = await supabase
          .from("teams")
          .insert({
            user_id: data.user.id,
            name: teamName.trim(),
            division: 3,
            balance: 500,
            sponsor_income: 100,
          });

        if (teamError) {
          // Team might already exist from trigger — not critical
          console.warn("Team creation:", teamError.message);
        }

        // Create board profile
        await supabase.from("board_profiles").insert({
          team_id: null, // Will be updated after team creation
          plan_type: "1yr",
          focus: "balanced",
          satisfaction: 50,
          budget_modifier: 1.0,
          current_goals: JSON.stringify([
            { type: "top_n_finish", target: 4, label: "Top 4 i divisionen", satisfaction_bonus: 15, satisfaction_penalty: 8 },
            { type: "min_riders", target: 8, label: "Hold på min. 8 ryttere", satisfaction_bonus: 5, satisfaction_penalty: 10 },
            { type: "stage_wins", target: 1, label: "Mindst 1 etapesejr", satisfaction_bonus: 10, satisfaction_penalty: 5 },
          ]),
        }).select().single().then(async ({ data: board }) => {
          if (board) {
            // Link board to team
            const { data: team } = await supabase
              .from("teams").select("id").eq("user_id", data.user.id).single();
            if (team) {
              await supabase.from("board_profiles")
                .update({ team_id: team.id })
                .eq("id", board.id);
            }
          }
        });

        setSuccess(`Velkommen, ${teamName}! 🎉 Din konto er oprettet og dit hold er klar.`);
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(#e8c547 1px, transparent 1px), linear-gradient(90deg, #e8c547 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
        w-[500px] h-[500px] rounded-full opacity-10 blur-[120px] bg-[#e8c547] pointer-events-none" />

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
          {success ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">🎉</div>
              <p className="text-green-400 text-sm font-medium">{success}</p>
              <p className="text-white/40 text-xs mt-3">
                Tjek din email for at bekræfte din konto, og log derefter ind.
              </p>
              <button
                onClick={() => { setMode("login"); setSuccess(""); setTeamName(""); }}
                className="mt-4 w-full bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                  py-2.5 text-sm hover:bg-[#f0d060] transition-all">
                Gå til login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {mode === "signup" && (
                <div>
                  <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-1.5">
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
                    className="w-full bg-white/5 border border-white/8 rounded-lg
                      px-4 py-2.5 text-white text-sm placeholder-white/20
                      focus:outline-none focus:border-[#e8c547]/50 focus:bg-white/8 transition-all"
                  />
                  <p className="text-white/20 text-xs mt-1">3-30 tegn — dette bliver dit holdnavn i spillet</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-1.5">
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
                    focus:outline-none focus:border-[#e8c547]/50 focus:bg-white/8 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-1.5">
                  Adgangskode
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full bg-white/5 border border-white/8 rounded-lg
                    px-4 py-2.5 text-white text-sm placeholder-white/20
                    focus:outline-none focus:border-[#e8c547]/50 focus:bg-white/8 transition-all"
                />
                {mode === "signup" && (
                  <p className="text-white/20 text-xs mt-1">Minimum 6 tegn</p>
                )}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                  py-2.5 text-sm tracking-wide hover:bg-[#f0d060] transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-[0_4px_20px_rgba(232,197,71,0.2)]">
                {loading
                  ? mode === "signup" ? "Opretter konto og hold..." : "Logger ind..."
                  : mode === "login" ? "Log ind" : "Opret konto og hold"}
              </button>
            </form>
          )}

          {!success && (
            <div className="mt-4 text-center">
              <button
                onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
                className="text-sm text-white/40 hover:text-white/60 transition-colors">
                {mode === "login" ? "Ingen konto? Opret her" : "Har allerede konto? Log ind"}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          Cycling Zone Manager — Multiplayer Edition
        </p>
      </div>
    </div>
  );
}
