// #7859 · Billede 7: "Results and spoilers" på profilsidens indstillinger.
//
// Usynlig, så længe kontakten spoiler_shield_7859 er slukket for spilleren (svaret
// fra GET /api/me/spoiler-shield). Samme kort-anatomi som push-kortet ved siden af
// (Card p-5, text-sm-overskrift, text-xs-undertekst, Toggle-rækker). Ingen guld:
// et til/fra-valg er ikke sidens hovedhandling (TASTE: én gold pr. view).
//
// "Spoiler shield for all races" står som Off fra start (ejervalg 16/11). Browser-
// notifikationer slås til og fra i push-kortet; her står kun, hvad skjoldet gør ved dem.
import { useTranslation } from "react-i18next";
import I18nReadyGate from "../I18nReadyGate.jsx";
import { Card, Segmented, Toggle } from "../ui";
import { useSpoilerSettings } from "./useSpoilerShield.ts";
import type { OpenFinishedIn } from "./spoilerShieldModel.ts";

export default function SpoilerShieldSettingsCard() {
  const state = useSpoilerSettings();
  if (!state.loaded || !state.enabled) return null;
  return <I18nReadyGate ns="spoiler" fallback={null}><SettingsCardView {...state} /></I18nReadyGate>;
}

export function SettingsCardView({ settings, saveState, save }: Pick<ReturnType<typeof useSpoilerSettings>, "settings" | "saveState" | "save">) {
  const { t } = useTranslation("spoiler");
  return (
    <Card id="settings-spoiler-shield" className="p-5 mb-4" data-testid="spoiler-settings">
      <h2 className="text-cz-1 font-semibold text-sm mb-1">{t("settings.title")}</h2>
      <p className="text-cz-3 text-xs mb-4 leading-relaxed">{t("settings.intro")}</p>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-cz-1 text-sm">{t("settings.all")}</p>
            <p className="text-cz-3 text-xs leading-snug">{t("settings.allHint")}</p>
          </div>
          <Toggle
            id="spoiler-shield-all"
            label={null}
            aria-label={t("settings.all")}
            checked={settings.shieldAll}
            onChange={(e: { target: { checked: boolean } }) => save({ shieldAll: e.target.checked })}
          />
        </div>
        <div className="border-t border-cz-border pt-3">
          <p className="text-cz-1 text-sm">{t("settings.notifications")}</p>
          <p className="text-cz-3 text-xs leading-snug">{t("settings.notificationsHint")}</p>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-cz-border pt-3">
          <div className="min-w-0">
            <p className="text-cz-1 text-sm">{t("settings.openIn")}</p>
            <p className="text-cz-3 text-xs leading-snug">{t("settings.openInHint")}</p>
          </div>
          <Segmented
            label={t("settings.openIn")}
            value={settings.openFinishedIn}
            onChange={(v: OpenFinishedIn) => save({ openFinishedIn: v })}
            options={[{ value: "results", label: t("settings.results") }, { value: "story", label: t("settings.story") }]}
          />
        </div>
      </div>
      {saveState === "failed" && <p role="alert" className="text-cz-danger text-xs mt-3">{t("settings.failed")}</p>}
      {saveState === "saved" && <p role="status" className="text-cz-3 text-xs mt-3">{t("settings.saved")}</p>}
    </Card>
  );
}
