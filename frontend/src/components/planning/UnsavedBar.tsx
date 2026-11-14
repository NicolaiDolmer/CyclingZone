// #7535 · Bjaelken for ugemte aendringer. Vises naar spilleren vil skifte loeb med en ugemt trup:
// "Ugemte aendringer i X: Bliv her / Kassér / Gem og aabn". Intet gaar tabt tavst.
import { useTranslation } from "react-i18next";
import { Button } from "./primitives.ts";

export default function UnsavedBar({
  raceName,
  nextName,
  busy,
  onStay,
  onDiscard,
  onSaveAndOpen,
}: {
  raceName: string;
  nextName?: string;
  busy: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSaveAndOpen: () => void;
}) {
  const { t } = useTranslation("planning");
  return (
    <div
      role="alertdialog"
      aria-label={t("unsavedBar.label")}
      data-testid="planning-unsaved-bar"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-2.5"
    >
      <p className="min-w-0 text-[13px] text-cz-1">
        <span className="font-semibold">{t("unsavedBar.text", { race: raceName })}</span>
        {nextName ? <span className="text-cz-2"> {t("unsavedBar.next", { race: nextName })}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onStay} disabled={busy}>
          {t("unsavedBar.stay")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDiscard} disabled={busy}>
          {t("unsavedBar.discard")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onSaveAndOpen} loading={busy}>
          {t("unsavedBar.saveAndOpen")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Samme bjaelke for "Ryd udtagelser" (ejer 14/11): de viste loeb er ryddet som en kladde. Intet er
 * vaek foer spilleren gemmer; "Fortryd" stiller alle loeb tilbage, som de var.
 */
export function ClearDraftBar({
  count,
  busy,
  locked = false,
  error,
  onUndo,
  onSave,
}: {
  count: number;
  busy: boolean;
  /** Et skrivekald koerer (sidens skrive-laas): baade Gem og Fortryd venter, saa intet krydser. */
  locked?: boolean;
  error?: string | null;
  onUndo: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation("planning");
  return (
    <div
      role="region"
      aria-label={t("unsavedBar.label")}
      data-testid="planning-clear-bar"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-2.5"
    >
      <div className="min-w-0 text-[13px]">
        <p className="text-cz-1">
          <span className="font-semibold">{t("clearBar.text", { count })}</span>
          <span className="text-cz-2"> {t("clearBar.note")}</span>
        </p>
        {error && (
          <p className="mt-0.5 text-xs text-cz-danger" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onUndo} disabled={busy || locked} data-testid="planning-clear-undo">
          {t("clearBar.undo")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onSave} loading={busy} disabled={locked} data-testid="planning-clear-save">
          {t("clearBar.save")}
        </Button>
      </div>
    </div>
  );
}
