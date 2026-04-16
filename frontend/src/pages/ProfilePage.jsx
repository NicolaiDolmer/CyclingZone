import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [discordId, setDiscordId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "" });

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("users")
      .select("discord_id, username, email, role")
      .eq("id", authUser.id)
      .single();
    setUser(data);
    setDiscordId(data?.discord_id || "");
    setLoading(false);
  }

  async function saveDiscordId() {
    setSaving(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("users")
      .update({ discord_id: discordId.trim() || null })
      .eq("id", authUser.id);

    if (error) {
      setMsg({ text: `❌ ${error.message}`, type: "error" });
    } else {
      setMsg({ text: "✅ Discord ID gemt!", type: "success" });
    }
    setTimeout(() => setMsg({ text: "" }), 3000);
    setSaving(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Min Profil</h1>
        <p className="text-white/30 text-sm">Indstillinger og Discord integration</p>
      </div>

      {/* Profile info */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
        <h2 className="text-white font-semibold text-sm mb-4">Konto</h2>
        <div className="space-y-3">
          <div>
            <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Email</p>
            <p className="text-white text-sm">{user?.email}</p>
          </div>
          <div>
            <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Holdnavn</p>
            <p className="text-white text-sm">{user?.username}</p>
          </div>
          {user?.role === "admin" && (
            <div>
              <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">Admin</span>
            </div>
          )}
        </div>
      </div>

      {/* Discord integration */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 flex items-center justify-center">
            <span className="text-[#5865F2] text-sm font-bold">D</span>
          </div>
          <div>
            <h2 className="text-white font-semibold text-sm">Discord Integration</h2>
            <p className="text-white/30 text-xs">Modtag notifikationer direkte i Discord</p>
          </div>
        </div>

        <div className="bg-white/3 border border-white/5 rounded-lg p-4 mb-4">
          <p className="text-white/50 text-xs leading-relaxed">
            Hvis du tilknytter dit Discord bruger-ID, vil du blive tagget i Discord
            når du overbydes på auktioner, vinder auktioner, modtager transfer-tilbud m.m.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-white/30 text-xs uppercase tracking-wider mb-2">
            Dit Discord Bruger-ID
          </label>
          <input
            type="text"
            value={discordId}
            onChange={e => setDiscordId(e.target.value)}
            placeholder="f.eks. 123456789012345678"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5
              text-white text-sm placeholder-white/20 font-mono
              focus:outline-none focus:border-[#5865F2]/50"
          />
          <p className="text-white/20 text-xs mt-2">
            Find dit ID: Discord → Indstillinger → Avanceret → Aktivér udviklertilstand
            → Højreklik på dit navn → "Kopiér bruger-ID"
          </p>
        </div>

        {msg.text && (
          <div className={`mb-3 px-4 py-2.5 rounded-lg text-sm border
            ${msg.type === "success"
              ? "bg-green-500/10 text-green-400 border-green-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
            {msg.text}
          </div>
        )}

        <button
          onClick={saveDiscordId}
          disabled={saving}
          className="w-full py-2.5 bg-[#5865F2] text-white font-bold rounded-lg text-sm
            hover:bg-[#4752c4] transition-all disabled:opacity-50">
          {saving ? "Gemmer..." : "Gem Discord ID"}
        </button>

        <div className="mt-4 bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/30 text-xs font-medium mb-2">Du modtager Discord-notifikationer når:</p>
          <ul className="space-y-1">
            {[
              "Du overbydes på en auktion",
              "Du vinder en auktion",
              "Du modtager et transfer-tilbud",
              "Dit transfer-tilbud accepteres eller afvises",
              "En ny auktion oprettes",
              "En ny sæson starter eller afsluttes",
            ].map(item => (
              <li key={item} className="flex items-center gap-2 text-white/30 text-xs">
                <span className="text-green-400">✓</span> {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
