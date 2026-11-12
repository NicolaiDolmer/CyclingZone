// #7535 · Bjaelken for ugemte aendringer. Vises naar spilleren vil skifte loeb med en ugemt trup:
// "Ugemte aendringer i X: Bliv her / Kassér / Gem og aabn". Intet gaar tabt tavst.
import { useTranslation } from "react-i18next";
import { Button } from "../ui";

export default function UnsavedBar({ raceName, nextName, busy, onStay, onDiscard, onSaveAndOpen }) {
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
