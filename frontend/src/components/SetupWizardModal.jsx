import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { getAttribution } from "../lib/attribution";

const API = import.meta.env.VITE_API_URL;

export default function SetupWizardModal({ onComplete, initialTeamName = "", initialManagerName = "" }) {
  const { t } = useTranslation("auth");
  // #2068: præudfyldt fra signup-metadata når auto-bootstrap i Layout fejlede
  // (fx holdnavn taget i mellemtiden) — brugeren retter kun det der gik galt,
  // i stedet for at starte forfra med tomme felter.
  const [teamName, setTeamName] = useState(initialTeamName);
  const [managerName, setManagerName] = useState(initialManagerName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (saving) return;
    if (!teamName.trim() || teamName.trim().length < 3) {
      setError(t("error.teamNameTooShort"));
      return;
    }
    if (!managerName.trim() || managerName.trim().length < 2) {
      setError(t("error.managerNameTooShort"));
      return;
    }
    if (!API) {
      setError(t("error.connectionFailed"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError(t("error.sessionExpired"));
        return;
      }
      const res = await fetch(`${API}/api/teams/my`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        // #2079: denne fallback-sti var den ENESTE team-create-sti i hele
        // confirm-on-perioden 15/6-2/7 og sendte ingen attribution — derfor var
        // signup_attribution tom. Send snapshottet med her også, med metadata
        // som cross-device-fallback (samme kæde som Layout-bootstrappen).
        body: JSON.stringify({
          name: teamName.trim(),
          manager_name: managerName.trim(),
          attribution: getAttribution() || session.user?.user_metadata?.attribution || null,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || t("error.unknown"));
      } else {
        onComplete(data.team);
      }
    } catch {
      // Netværksfejl, CORS, eller backend nede — efterlad ALDRIG knappen
      // hængende i loading-state uden besked (#792).
      setError(t("error.connectionFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-cz-card rounded-cz shadow-2xl max-w-md w-full p-6">
        {/* #1569: intet monogram i chrome (jf. #671 — titlen bærer brandet);
            rounded-cz matcher resten af appens modaler (var rounded-2xl SaaS-slop). */}
        <div className="mb-6">
          <h2 className="text-cz-1 font-bold text-lg leading-tight">{t("setupWizard.title")}</h2>
          <p className="text-cz-3 text-sm">{t("setupWizard.subtitle")}</p>
        </div>

        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-cz-2 mb-1.5">{t("field.teamName.label")}</label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder={t("setupWizard.teamNamePlaceholder")}
              maxLength={40}
              className="w-full px-3 py-2.5 border border-cz-border rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-cz-accent focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-cz-2 mb-1.5">{t("field.managerName.label")}</label>
            <input
              type="text"
              value={managerName}
              onChange={e => setManagerName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder={t("setupWizard.managerNamePlaceholder")}
              maxLength={40}
              className="w-full px-3 py-2.5 border border-cz-border rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-cz-accent focus:border-transparent"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-600 text-sm mb-4 px-3 py-2 bg-cz-danger-bg rounded-lg border border-cz-danger/30">
            {error}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 bg-cz-accent hover:brightness-110 text-white font-bold rounded-lg
            text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? t("setupWizard.submitLoading") : t("setupWizard.submitIdle")}
        </button>

        <p className="text-center text-xs text-cz-3 mt-3">
          {t("setupWizard.footnote")}
        </p>
      </div>
    </div>
  );
}
