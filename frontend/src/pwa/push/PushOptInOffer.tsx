// #6590 · Kontekst-tilbuddet efter et bud paa en auktion der slutter i dag.
//
// Samme anatomi og bund-slot som installations-tilbuddet (InstallPrompt.tsx):
// én stribe i bunden, hairline + rounded-cz + kort-baggrund, ingen skygge,
// stroke-ikon, SECONDARY-knap (siden under har sin egen gold primary). Bruger
// slot-typen "install" med vilje: begge er frivillige tilbud med laveste
// prioritet, og samtykke-, release- og NPS-flader vinder altid.
//
// Monteres i sin EGEN React-rod, lazy og kun naar offerPushAfterBid.ts har
// sagt ja, saa tilbuddet koster nul bytes i auktionssidens chunk.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n/index.js";
import Button from "../../components/ui/Button.jsx";
import { BellIcon } from "../../components/ui/icons/index.jsx";
import { useBottomSlot } from "../../lib/bottomSlot.ts";
import { enablePushOnThisDevice } from "./pushApi.ts";

export type OfferOutcome = "accepted" | "dismissed" | "failed";

export interface PushOptInOfferViewProps {
  phase: "ask" | "busy" | "done";
  onAccept: () => void;
  onLater: () => void;
}

/** Ren visning (ogsaa brugt af skaermbilledet til PR'en). */
export function PushOptInOfferView({ phase, onAccept, onLater }: PushOptInOfferViewProps) {
  const { t } = useTranslation("common");
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("push.offer.regionAriaLabel")}
      data-testid="push-optin-offer"
      className="fixed inset-x-0 bottom-(--cz-mobile-nav-offset,0px) z-toast px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-4 py-3 pointer-events-auto">
        <BellIcon size={16} className="shrink-0 text-cz-3" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm leading-snug text-cz-1">
          {phase === "done" ? t("push.offer.done") : t("push.offer.title")}
        </p>
        {phase !== "done" && (
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onLater} disabled={phase === "busy"} data-testid="push-offer-later">
              {t("push.offer.later")}
            </Button>
            <Button size="sm" variant="secondary" onClick={onAccept} disabled={phase === "busy"} data-testid="push-offer-accept">
              {t("push.offer.accept")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PushOptInOffer({ publicKey, onDone }: { publicKey: string; onDone: (outcome: OfferOutcome) => void }) {
  const { ready } = useTranslation("common");
  const [phase, setPhase] = useState<"ask" | "busy" | "done">("ask");
  const granted = useBottomSlot("install", ready);
  if (!ready || !granted) return null;

  async function handleAccept() {
    setPhase("busy");
    const outcome = await enablePushOnThisDevice(publicKey);
    if (outcome === "ok") {
      setPhase("done");
      window.setTimeout(() => onDone("accepted"), 4000);
    } else {
      onDone(outcome === "denied" ? "dismissed" : "failed");
    }
  }

  return <PushOptInOfferView phase={phase} onAccept={handleAccept} onLater={() => onDone("dismissed")} />;
}

let mounted = false;

export async function mountPushOptInOffer(publicKey: string, onOutcome: (outcome: OfferOutcome) => void): Promise<void> {
  if (mounted) return;
  mounted = true;
  await i18n.loadNamespaces("common");
  const host = document.createElement("div");
  host.setAttribute("data-cz-pwa-root", "");
  document.body.appendChild(host);
  const root = createRoot(host);
  const done = (outcome: OfferOutcome) => {
    onOutcome(outcome);
    root.unmount();
    host.remove();
    mounted = false;
  };
  root.render(<PushOptInOffer publicKey={publicKey} onDone={done} />);
}
