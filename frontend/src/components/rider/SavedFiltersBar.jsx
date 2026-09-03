// SavedFiltersBar — #4649 Pro v1.1 del C. "Save current filter" med navn +
// chips der anvender det gemte filter med ét klik. v1 er klient-lokalt
// (localStorage, ingen migration, jf. issuet) og Pro-gated: gratis spillere
// ser en kort note + knap til /pro i stedet for kontrollerne.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button, Input } from "../ui";
import { XIcon } from "../ui/icons/index.jsx";
import { loadSavedFilters, addSavedFilter, removeSavedFilter, MAX_SAVED_FILTERS } from "../../lib/savedRiderFilters.js";

export default function SavedFiltersBar({ userId, filters, onApply, eligible }) {
  const { t } = useTranslation("pro");
  const navigate = useNavigate();
  const [saved, setSaved] = useState(() => loadSavedFilters(userId));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  if (!eligible) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-cz-card border border-cz-border border-l-2 border-l-cz-accent rounded-cz px-3 py-2">
        <span className="text-2xs text-cz-2">{t("savedFilters.note")}</span>
        <Button size="sm" variant="secondary" onClick={() => navigate("/pro")}>{t("savedFilters.cta")}</Button>
      </div>
    );
  }

  function handleSave() {
    const next = addSavedFilter(userId, name, filters);
    setSaved(next);
    setName("");
    setNaming(false);
  }

  function handleRemove(id, e) {
    e.stopPropagation();
    setSaved(removeSavedFilter(userId, id));
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {saved.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onApply(f.filters)}
          className="inline-flex items-center gap-1.5 rounded-cz border border-cz-border bg-cz-card px-2.5 py-1 text-xs font-medium text-cz-2 hover:text-cz-1 hover:border-cz-accent/40 transition-colors"
        >
          {f.name}
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => handleRemove(f.id, e)}
            aria-label={t("savedFilters.remove")}
            className="text-cz-3 hover:text-cz-danger"
          >
            <XIcon size={11} aria-hidden="true" />
          </span>
        </button>
      ))}

      {naming ? (
        <span className="inline-flex items-center gap-1.5">
          <Input
            size="sm"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("savedFilters.namePlaceholder")}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setNaming(false); }}
            className="w-40"
          />
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={!name.trim()}>
            {t("savedFilters.saveConfirm")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setNaming(false); setName(""); }}>
            {t("savedFilters.cancel")}
          </Button>
        </span>
      ) : (
        saved.length < MAX_SAVED_FILTERS && (
          <Button size="sm" variant="secondary" onClick={() => setNaming(true)}>
            {t("savedFilters.save")}
          </Button>
        )
      )}
    </div>
  );
}
