// #5177 spor 2 (LCP): udskilt fra RoadmapPage.jsx til egen lazy-loaded chunk.
// Admin-create-formen er ubrugt JS for alle ikke-admin besøgende (=~ alle
// anonyme Lighthouse-kørsler) — RoadmapPage importerer den nu via React.lazy,
// så koden slet ikke hentes/parses før en faktisk admin åbner panelet.
// Ren udflytning, ingen adfærdsændring.

import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { ENGINE_ORDER, ROADMAP_ITEM_COLUMNS } from "../lib/roadmapVoting.js";

const EMPTY_DRAFT = { engine: "races", sort_order: 0, title_en: "", title_da: "", approved: true, status: "active" };

export default function RoadmapAdminCreateForm({ t, onCreated }) {
  const [form, setForm] = useState(EMPTY_DRAFT);
  const [state, setState] = useState(null); // null | "saving" | "saved" | "error" | "missing"

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title_en.trim() || !form.title_da.trim()) {
      setState("missing");
      return;
    }
    setState("saving");
    const { data, error } = await supabase
      .from("roadmap_items")
      .insert({
        engine: form.engine,
        sort_order: Number(form.sort_order) || 0,
        title_en: form.title_en.trim(),
        title_da: form.title_da.trim(),
        approved: form.approved,
        status: form.status,
        shipped_at: form.status === "shipped" ? new Date().toISOString() : null,
      })
      .select(ROADMAP_ITEM_COLUMNS)
      .single();
    if (error) {
      setState("error");
      return;
    }
    setState("saved");
    setForm(EMPTY_DRAFT);
    onCreated(data);
  }

  const fieldClass =
    "w-full bg-cz-subtle border border-cz-border rounded-cz px-2 py-1.5 text-sm text-cz-1 focus:border-cz-accent focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <h3 className="text-cz-1 font-bold text-sm">{t("admin.createTitle")}</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-cz-3 text-xs">{t("admin.engine")}</span>
          <select className={fieldClass} value={form.engine} onChange={(e) => update("engine", e.target.value)}>
            {ENGINE_ORDER.map((key) => (
              <option key={key} value={key}>
                {t(`engines.${key}.title`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-cz-3 text-xs">{t("admin.sortOrder")}</span>
          <input
            type="number"
            className={fieldClass}
            value={form.sort_order}
            onChange={(e) => update("sort_order", e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-cz-3 text-xs">{t("admin.titleEn")}</span>
        <input type="text" className={fieldClass} value={form.title_en} onChange={(e) => update("title_en", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-cz-3 text-xs">{t("admin.titleDa")}</span>
        <input type="text" className={fieldClass} value={form.title_da} onChange={(e) => update("title_da", e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-cz-3 text-xs">{t("admin.status")}</span>
          <select className={fieldClass} value={form.status} onChange={(e) => update("status", e.target.value)}>
            <option value="active">{t("admin.statusActive")}</option>
            <option value="shipped">{t("admin.statusShipped")}</option>
            <option value="archived">{t("admin.statusArchived")}</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-cz-2 select-none pb-1.5">
          <input
            type="checkbox"
            checked={form.approved}
            onChange={(e) => update("approved", e.target.checked)}
            className="rounded-cz border-cz-border text-cz-accent focus:ring-cz-accent"
          />
          {t("admin.approved")}
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === "saving"}
          className="px-3 py-1.5 text-xs font-semibold bg-cz-accent text-cz-on-accent rounded-cz hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {state === "saving" ? t("admin.creating") : t("admin.create")}
        </button>
        <span aria-live="polite" className="text-xs">
          {state === "saved" && <span className="text-cz-3">{t("admin.created")}</span>}
          {state === "error" && <span className="text-cz-danger">{t("admin.error")}</span>}
          {state === "missing" && <span className="text-cz-danger">{t("admin.missingFields")}</span>}
        </span>
      </div>
    </form>
  );
}
