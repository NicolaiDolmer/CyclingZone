import { useState } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

export default function SetupWizardModal({ onComplete }) {
  const [teamName, setTeamName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (saving) return;
    if (!teamName.trim() || teamName.trim().length < 3) {
      setError("Holdnavn skal være mindst 3 tegn");
      return;
    }
    if (!managerName.trim() || managerName.trim().length < 2) {
      setError("Managernavn skal være mindst 2 tegn");
      return;
    }
    setSaving(true);
    setError("");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Session udløbet — genindlæs siden og prøv igen");
      setSaving(false);
      return;
    }
    const res = await fetch(`${API}/api/teams/my`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ name: teamName.trim(), manager_name: managerName.trim() }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Noget gik galt — prøv igen");
    } else {
      onComplete(data.team);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#e8c547] rounded-xl flex items-center justify-center text-sm font-black text-[#1a1f38] flex-shrink-0">
            CZ
          </div>
          <div>
            <h2 className="text-slate-900 font-bold text-lg leading-tight">Velkommen til Cycling Zone</h2>
            <p className="text-slate-400 text-sm">Navngiv dit hold for at komme i gang</p>
          </div>
        </div>

        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Holdnavn</label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="f.eks. Team Nordic"
              maxLength={40}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Managernavn</label>
            <input
              type="text"
              value={managerName}
              onChange={e => setManagerName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="f.eks. Lars Hansen"
              maxLength={40}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-600 text-sm mb-4 px-3 py-2 bg-red-50 rounded-lg border border-red-200">
            {error}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg
            text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? "Gemmer…" : "Opret hold og start →"}
        </button>

        <p className="text-center text-xs text-slate-400 mt-3">
          Du kan ændre navnene senere under Profil &amp; Indstillinger
        </p>
      </div>
    </div>
  );
}
