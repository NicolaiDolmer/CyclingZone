// SavedFiltersBar — #4649 Pro v1.1 del C. "Save current filter" med navn +
// chips der anvender det gemte filter med ét klik. v1 er klient-lokalt
// (localStorage, ingen migration, jf. issuet) og Pro-gated: gratis spillere
// ser en kort note + knap til /pro i stedet for kontrollerne.
//
// #6286:
// - Pro-status slås op HER (useSubscription(teamId)). Mens holdet eller
//   abonnementet indlæses vises intet, aldrig "See Pro"-reklamen. En opslagsfejl
//   giver en kort note med "Try again", ikke stille "ikke Pro".
// - Listen genindlæses når userId ændres. RidersPage kender først brugeren efter
//   første render, så en læsning kun ved mount gav altid en tom liste.
// - Slet er sin egen knap ved siden af chippen (tastatur + fuld trykflade), ikke
//   et span inde i en knap.
// - Dublet-navne afvises med en kort besked; ved loftet forklares det i stedet
//   for at Save-knappen forsvinder.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button, Input } from "../ui";
import { XIcon } from "../ui/icons/index.jsx";
import { useSubscription } from "../../lib/useSubscription.js";
import {
  loadSavedFilters, addSavedFilter, removeSavedFilter, savedFilterNameError, MAX_SAVED_FILTERS,
} from "../../lib/savedRiderFilters.js";

export default function SavedFiltersBar({ userId, teamId, filters, onApply }) {
  const { t } = useTranslation("pro");
  const navigate = useNavigate();
  const { isPro, isFounder, loading: subLoading, error: subError, reload: reloadSub } = useSubscription(teamId);
  const [saved, setSaved] = useState(() => loadSavedFilters(userId));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  // #6286 P0: userId ankommer efter første render; genindlæs når den ændres.
  useEffect(() => {
    setSaved(loadSavedFilters(userId));
  }, [userId]);

  // Holdet er ikke kendt endnu, eller abonnementet indlæses: vis intet.
  if (!teamId || subLoading) return null;

  if (subError) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap rounded-cz border border-cz-border bg-cz-card px-3 py-2">
        <span className="text-xs text-cz-2">{t("savedFilters.statusError")}</span>
        <Button size="sm" variant="secondary" onClick={reloadSub}>{t("savedFilters.retry")}</Button>
      </div>
    );
  }

  if (!(isPro || isFounder)) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap rounded-cz border border-cz-border bg-cz-card px-3 py-2">
        <span className="text-xs text-cz-2">{t("savedFilters.note")}</span>
        <Button size="sm" variant="secondary" onClick={() => navigate("/pro")}>{t("savedFilters.cta")}</Button>
      </div>
    );
  }

  const nameError = naming && name.trim() ? savedFilterNameError(saved, name) : null;
  const atLimit = saved.length >= MAX_SAVED_FILTERS;

  function handleSave() {
    if (savedFilterNameError(saved, name)) return;
    const next = addSavedFilter(userId, name, filters);
    setSaved(next);
    setName("");
    setNaming(false);
  }

  function handleCancel() {
    setNaming(false);
    setName("");
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {saved.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-stretch rounded-cz border border-cz-border bg-cz-card text-xs font-medium text-cz-2 hover:border-cz-accent/40 transition-colors"
        >
          <button
            type="button"
            onClick={() => onApply(f.filters)}
            className="min-h-10 sm:min-h-8 px-2.5 rounded-l-cz hover:text-cz-1 transition-colors"
          >
            {f.name}
          </button>
          <button
            type="button"
            onClick={() => setSaved(removeSavedFilter(userId, f.id))}
            aria-label={t("savedFilters.removeNamed", { name: f.name })}
            title={t("savedFilters.remove")}
            className="inline-flex min-w-10 sm:min-w-8 items-center justify-center border-l border-cz-border rounded-r-cz text-cz-3 hover:text-cz-danger transition-colors"
          >
            <XIcon size={13} aria-hidden="true" />
          </button>
        </span>
      ))}

      {naming ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Input
            size="sm"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("savedFilters.namePlaceholder")}
            aria-label={t("savedFilters.namePlaceholder")}
            aria-invalid={nameError === "duplicate" || undefined}
            aria-describedby={nameError === "duplicate" ? "saved-filter-name-error" : undefined}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
            className="w-40"
          />
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={!name.trim() || Boolean(nameError)}>
            {t("savedFilters.saveConfirm")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            {t("savedFilters.cancel")}
          </Button>
          {nameError === "duplicate" && (
            <span id="saved-filter-name-error" role="status" className="basis-full text-2xs text-cz-danger">
              {t("savedFilters.duplicate")}
            </span>
          )}
        </span>
      ) : atLimit ? (
        <span className="text-2xs text-cz-3">{t("savedFilters.limit", { max: MAX_SAVED_FILTERS })}</span>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setNaming(true)}>
          {t("savedFilters.save")}
        </Button>
      )}
    </div>
  );
}
