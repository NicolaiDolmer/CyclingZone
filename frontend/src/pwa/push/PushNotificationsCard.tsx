// #6590 · "Push notifications" paa profilsidens Notifikationer-fane.
//
// Usynlig saa laenge push er slukket for spilleren (app_config.push_enabled +
// VAPID, svaret fra GET /api/push/config). Samme kort-anatomi som de andre
// sektioner paa fanen (Card p-5, text-sm-overskrift, text-xs-undertekst,
// Toggle-raekker). Knappen er SECONDARY: fanen har ingen gold primary, og et
// til/fra-valg er ikke sidens ene hovedhandling (TASTE: én gold pr. view).
// Browserens tilladelses-dialog vises KUN efter et tryk paa knappen.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CheckIcon, Toggle } from "../../components/ui";
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  fetchPushConfig,
  getDeviceSubscription,
  savePushCategories,
  syncDeviceSubscription,
  type PushConfig,
} from "./pushApi.ts";
import { PUSH_CATEGORY_KEYS, pushSupportState, readPushEnv, type PushCategoryKey, type PushSupport } from "./pushSupport.ts";

export interface PushNotificationsCardViewProps {
  support: PushSupport;
  subscribed: boolean;
  categories: PushConfig["categories"];
  busy: boolean;
  savingCategory: PushCategoryKey | null;
  error: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onToggleCategory: (key: PushCategoryKey, value: boolean) => void;
}

/** Ren visning (ogsaa brugt af skaermbilledet til PR'en). */
export function PushNotificationsCardView({
  support,
  subscribed,
  categories,
  busy,
  savingCategory,
  error,
  onEnable,
  onDisable,
  onToggleCategory,
}: PushNotificationsCardViewProps) {
  const { t } = useTranslation("common");
  const note =
    support === "ios-install" ? t("push.iosInstall") : support === "unsupported" ? t("push.unsupported") : support === "denied" ? t("push.denied") : null;
  return (
    <Card id="settings-push" className="p-5 mb-4" data-testid="push-settings">
      <h2 className="text-cz-1 font-semibold text-sm mb-1">{t("push.title")}</h2>
      <p className="text-cz-3 text-xs mb-4 leading-relaxed">{t("push.subtitle")}</p>

      {note && <p className="text-cz-2 text-xs leading-relaxed bg-cz-subtle border border-cz-border rounded-cz p-3">{note}</p>}

      {support === "ok" && !subscribed && (
        <Button variant="secondary" size="sm" onClick={onEnable} loading={busy} disabled={busy} data-testid="push-enable">
          {t("push.enable")}
        </Button>
      )}

      {support === "ok" && subscribed && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-cz-1 text-sm">
              <CheckIcon size={14} className="text-cz-success shrink-0" aria-hidden="true" />
              {t("push.statusOn")}
            </p>
            <Button variant="ghost" size="sm" onClick={onDisable} disabled={busy} data-testid="push-disable">
              {t("push.disable")}
            </Button>
          </div>
          <div className="mt-4 pt-3 border-t border-cz-border space-y-3">
            <p className="text-cz-3 text-xs font-medium">{t("push.categoriesHeading")}</p>
            {PUSH_CATEGORY_KEYS.map((key) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-cz-1 text-sm">{t(`push.category.${key}.label`)}</p>
                  <p className="text-cz-3 text-xs leading-snug">{t(`push.category.${key}.desc`)}</p>
                </div>
                <Toggle
                  id={`push-category-${key}`}
                  aria-label={t(`push.category.${key}.label`)}
                  checked={categories[key]}
                  disabled={savingCategory === key}
                  onChange={(e: { target: { checked: boolean } }) => onToggleCategory(key, e.target.checked)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-cz-danger text-xs mt-3">
          {t("push.error")}
        </p>
      )}
    </Card>
  );
}

export default function PushNotificationsCard() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingCategory, setSavingCategory] = useState<PushCategoryKey | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cfg = await fetchPushConfig();
      if (!alive || !cfg?.enabled || !cfg.publicKey) return;
      const state = pushSupportState(readPushEnv(window));
      const sub = state === "ok" ? await getDeviceSubscription() : null;
      // Samme enhed kan skifte konto: knyt endpointet til den der er logget ind nu.
      const synced = sub ? await syncDeviceSubscription(sub, cfg.publicKey) : false;
      if (!alive) return;
      setSupport(state);
      setSubscribed(synced);
      setConfig(cfg);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!config?.enabled || !config.publicKey) return null;
  const publicKey = config.publicKey;

  async function handleEnable() {
    setBusy(true);
    setError(false);
    const outcome = await enablePushOnThisDevice(publicKey);
    setBusy(false);
    if (outcome === "ok") setSubscribed(true);
    else if (outcome === "denied") setSupport(pushSupportState(readPushEnv(window)));
    else if (outcome === "unsupported") setSupport("unsupported");
    else setError(true);
  }

  async function handleDisable() {
    setBusy(true);
    setError(false);
    const ok = await disablePushOnThisDevice();
    setBusy(false);
    if (ok) setSubscribed(false);
    else setError(true);
  }

  async function handleToggle(key: PushCategoryKey, value: boolean) {
    if (!config) return;
    const previous = config.categories;
    setConfig({ ...config, categories: { ...previous, [key]: value } });
    setSavingCategory(key);
    setError(false);
    const saved = await savePushCategories({ [key]: value });
    setSavingCategory(null);
    if (saved) setConfig((c) => (c ? { ...c, categories: saved } : c));
    else {
      setConfig((c) => (c ? { ...c, categories: previous } : c));
      setError(true);
    }
  }

  return (
    <PushNotificationsCardView
      support={support}
      subscribed={subscribed}
      categories={config.categories}
      busy={busy}
      savingCategory={savingCategory}
      error={error}
      onEnable={handleEnable}
      onDisable={handleDisable}
      onToggleCategory={handleToggle}
    />
  );
}
