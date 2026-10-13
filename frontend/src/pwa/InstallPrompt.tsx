// #6584 · Installations-tilbuddet: én stribe i bunden, samme anatomi som
// ReleaseUpdateBanner (#5159) og paa den samme delte bund-slot (lib/bottomSlot.ts)
// med laveste prioritet, saa samtykke, release-banner og NPS altid vinder.
//
// TASTE: hairline + rounded-cz + kort-baggrund, ingen skygge, stroke-ikon.
// Knappen er SECONDARY (P3): striben ligger oven paa en vilkaarlig side, hvis
// egen gold primary skal blive ved med at vaere den ene guld-flade.
// Copy: TONE_OF_VOICE, EN foerst, DA i public/locales/da/pwa.json.
//
// Monteres i sin EGEN lille React-rod (mountInstallPrompt), lazy og kun naar
// installTiming.ts har sagt ja. Saa koster tilbuddet nul bytes i entry-chunken
// og intet i App-traeet, som deles med build-time-prerenderen.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import i18n from "../i18n/index.js";
import Button from "../components/ui/Button.jsx";
import { DownloadIcon } from "../components/ui/icons/index.jsx";
import { useBottomSlot } from "../lib/bottomSlot.ts";
import { promptInstall } from "./installPrompt.ts";
import type { InstallPlatform } from "./installTiming.ts";

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallPromptProps {
  platform: Exclude<InstallPlatform, "none">;
  onDone: (outcome: InstallOutcome) => void;
}

export function InstallPrompt({ platform, onDone }: InstallPromptProps) {
  const { t, ready } = useTranslation("pwa");
  const [busy, setBusy] = useState(false);
  const granted = useBottomSlot("install", ready);
  if (!ready || !granted) return null;

  async function handleInstall() {
    setBusy(true);
    const outcome = await promptInstall();
    onDone(outcome);
  }

  const isIos = platform === "ios";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("install.regionAriaLabel")}
      data-testid="pwa-install-prompt"
      className="fixed inset-x-0 bottom-(--cz-mobile-nav-offset,0px) z-toast px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-4 py-3 pointer-events-auto">
        <DownloadIcon size={16} className="shrink-0 text-cz-3" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm leading-snug text-cz-1">
          {isIos ? t("install.iosTitle") : t("install.title")}
        </p>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {isIos ? (
            <Button size="sm" variant="secondary" onClick={() => onDone("dismissed")} data-testid="pwa-install-ios-dismiss">
              {t("install.iosDismiss")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => onDone("dismissed")} disabled={busy} data-testid="pwa-install-later">
                {t("install.later")}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleInstall} disabled={busy} data-testid="pwa-install-action">
                {t("install.action")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Monterer tilbuddet i en egen rod paa <body>. Namespacet hentes FOER render
 * (ready-gate), saa der aldrig staar en raa noegle paa skaermen.
 */
export async function mountInstallPrompt(
  platform: Exclude<InstallPlatform, "none">,
  onOutcome: (outcome: InstallOutcome) => void,
): Promise<void> {
  await i18n.loadNamespaces("pwa");
  const host = document.createElement("div");
  host.setAttribute("data-cz-pwa-root", "");
  document.body.appendChild(host);
  const root = createRoot(host);
  const done = (outcome: InstallOutcome) => {
    onOutcome(outcome);
    root.unmount();
    host.remove();
  };
  root.render(<InstallPrompt platform={platform} onDone={done} />);
}
