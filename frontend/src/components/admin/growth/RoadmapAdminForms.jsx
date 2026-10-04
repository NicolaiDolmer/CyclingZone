// Roadmap-hub, admin-fanen (#6151, spec §4): formularerne bag
// /admin/growth?tab=roadmap. Opret/ret punkt (inkl. beta-kobling), opret/ret
// kendt fejl, ny opdatering + trin, og "Del punkt" (færdig-reglen, spec §2.6).
//
// Alle skrivninger går direkte mod Supabase bag is_admin()-policies, samme
// mønster som den tidligere RoadmapAdminCreateForm.jsx. Dansk tekst, hardcoded
// som resten af admin.
//
// Filen er .jsx og ikke .tsx (hard rule 31): den typede Supabase-klient
// (src/types/database.types.ts) kender ikke de nye tabeller/kolonner fra spor 1
// (#6149), før typerne regenereres efter apply, og CI's typecheck mangler
// @types/react (samme begrundelse som ui/Segmented.jsx og ui/HeroStats.jsx).
// Logikken bor i lib/roadmapAdminModel.ts, som er fuldt typet.
import { useEffect, useId, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { ENGINE_ORDER } from "../../../lib/roadmapVoting.js";
import {
  ISSUE_AREAS, ISSUE_STATUSES, ROADMAP_STATUSES, issueStatusPatch, nextSortOrder, statusPatch, validateTitles,
} from "../../../lib/roadmapAdminModel.ts";
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from "../../ui";

export const AREA_LABELS = {
  races: "Løb", training: "Træning", youth: "Ungdom", market: "Marked", club: "Klub", other: "Andet",
};
export const STATUS_LABELS = {
  active: "Idé", planned: "Planlagt", in_progress: "I gang", shipped: "Færdig", archived: "Arkiveret",
};
export const ISSUE_STATUS_LABELS = {
  checking: "Tjekkes", confirmed: "Bekræftet", fixing: "Rettes", fixed: "Rettet", dismissed: "Lukket uden fund",
};
export const HORIZON_LABELS = { next: "Next", later: "Later" };
export const FLAG_STAGE_LABELS = { off: "Fra", beta: "Beta", on: "Til" };

function parseIssueRef(value) {
  const n = Number(String(value ?? "").replace(/^#/, "").trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function SaveError({ message }) {
  return (
    <p aria-live="polite" className="text-xs text-cz-danger min-h-[1rem]">
      {message || ""}
    </p>
  );
}

function FormFooter({ formId, saving, onClose, submitLabel }) {
  return (
    <>
      <Button variant="secondary" size="sm" type="button" onClick={onClose}>Annuller</Button>
      <Button variant="primary" size="sm" type="submit" form={formId} loading={saving}>{submitLabel}</Button>
    </>
  );
}

const nowIso = () => new Date().toISOString();

// ── Punkt: opret / ret ──────────────────────────────────────────────────────
const EMPTY_ITEM = {
  engine: "races", title_en: "", title_da: "", status: "planned", horizon: "next",
  issue_ref: "", approved: false, flag_key: "", beta_soon: false, live_soon: false,
};

function itemDraft(item) {
  if (!item) return EMPTY_ITEM;
  return {
    engine: item.engine ?? "races",
    title_en: item.title_en ?? "",
    title_da: item.title_da ?? "",
    status: item.status ?? "planned",
    horizon: item.horizon ?? "next",
    issue_ref: item.issue_ref ?? "",
    approved: item.approved !== false,
    flag_key: item.flag_key ?? "",
    beta_soon: Boolean(item.beta_soon),
    live_soon: Boolean(item.live_soon),
  };
}

export function ItemFormModal({ open, item, flags, planned, onClose, onSaved }) {
  const uid = useId();
  const formId = `${uid}-item`;
  const [form, setForm] = useState(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setForm(itemDraft(item)); setError(""); setSaving(false); }
  }, [open, item]);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const flag = (flags ?? []).find((f) => f.key === form.flag_key);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validateTitles(form.title_en, form.title_da)) { setError("Begge titler skal udfyldes."); return; }
    setSaving(true);
    setError("");
    const now = nowIso();
    const payload = {
      engine: form.engine,
      title_en: form.title_en.trim(),
      title_da: form.title_da.trim(),
      horizon: form.horizon,
      issue_ref: parseIssueRef(form.issue_ref),
      approved: form.approved,
      flag_key: form.flag_key || null,
      beta_soon: form.beta_soon,
      live_soon: form.live_soon,
      updated_at: now,
    };
    // Status skrives kun når den er ændret, så shipped_at ikke nulstilles ved
    // en titelrettelse. Er punktet koblet til en kontakt, overtager triggeren.
    if (!item || item.status !== form.status) Object.assign(payload, statusPatch(form.status, now));
    const query = item
      ? supabase.from("roadmap_items").update(payload).eq("id", item.item_id)
      : supabase.from("roadmap_items").insert({ ...payload, sort_order: nextSortOrder(planned ?? []) });
    const { error: err } = await query;
    setSaving(false);
    if (err) { setError(`Kunne ikke gemme: ${err.message}`); return; }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? "Ret punkt" : "Nyt punkt"}
      description="Spillerne ser punktet, når Godkendt er slået til."
      size="lg"
      footer={<FormFooter formId={formId} saving={saving} onClose={onClose} submitLabel={item ? "Gem" : "Opret"} />}
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Område" htmlFor={`${uid}-engine`}>
            <Select id={`${uid}-engine`} size="sm" value={form.engine} onChange={(e) => set("engine", e.target.value)}>
              {ENGINE_ORDER.map((key) => <option key={key} value={key}>{AREA_LABELS[key] ?? key}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor={`${uid}-status`}>
            <Select id={`${uid}-status`} size="sm" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {ROADMAP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Next/Later" htmlFor={`${uid}-horizon`}>
            <Select id={`${uid}-horizon`} size="sm" value={form.horizon} onChange={(e) => set("horizon", e.target.value)}>
              <option value="next">Next</option>
              <option value="later">Later</option>
            </Select>
          </Field>
        </div>
        <Field label="Titel (EN)" htmlFor={`${uid}-en`}>
          <Input id={`${uid}-en`} size="sm" value={form.title_en} onChange={(e) => set("title_en", e.target.value)} />
        </Field>
        <Field label="Titel (DA)" htmlFor={`${uid}-da`}>
          <Input id={`${uid}-da`} size="sm" value={form.title_da} onChange={(e) => set("title_da", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="GitHub-issue" htmlFor={`${uid}-ref`} helper="Bruges af færdig-rutinen.">
            <Input id={`${uid}-ref`} size="sm" inputMode="numeric" placeholder="fx 5435" value={form.issue_ref}
              onChange={(e) => set("issue_ref", e.target.value)} />
          </Field>
          <Field
            label="Kontakt"
            htmlFor={`${uid}-flag`}
            helper={form.flag_key
              ? `Står nu på ${FLAG_STAGE_LABELS[flag?.stage] ?? "ukendt"}. Status følger kontakten automatisk.`
              : "Uden kontakt styrer du status selv."}
          >
            <Select id={`${uid}-flag`} size="sm" value={form.flag_key} onChange={(e) => set("flag_key", e.target.value)}>
              <option value="">Ingen kontakt</option>
              {(flags ?? []).map((f) => (
                <option key={f.key} value={f.key}>{f.label ? `${f.label} (${f.key})` : f.key}</option>
              ))}
              {form.flag_key && !flag && <option value={form.flag_key}>{form.flag_key}</option>}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox id={`${uid}-approved`} label="Godkendt (synlig for spillerne)" checked={form.approved}
            onChange={(e) => set("approved", e.target.checked)} />
          <Checkbox id={`${uid}-beta-soon`} label="Næste i beta" checked={form.beta_soon}
            onChange={(e) => set("beta_soon", e.target.checked)} />
          <Checkbox id={`${uid}-live-soon`} label="Snart for alle" checked={form.live_soon}
            onChange={(e) => set("live_soon", e.target.checked)} />
        </div>
        <SaveError message={error} />
      </form>
    </Modal>
  );
}

// ── Del punkt (færdig-reglen) ───────────────────────────────────────────────
export function SplitItemModal({ open, item, onClose, onSaved }) {
  const uid = useId();
  const formId = `${uid}-split`;
  const [form, setForm] = useState({ title_en: "", title_da: "", status: "planned", horizon: "next", issue_ref: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ title_en: "", title_da: "", status: "planned", horizon: item?.horizon ?? "next", issue_ref: "" });
      setError("");
      setSaving(false);
    }
  }, [open, item]);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validateTitles(form.title_en, form.title_da)) { setError("Begge titler skal udfyldes."); return; }
    setSaving(true);
    setError("");
    const { error: err } = await supabase.rpc("roadmap_split_item", {
      p_source: item.item_id,
      p_title_en: form.title_en.trim(),
      p_title_da: form.title_da.trim(),
      p_status: form.status,
      p_horizon: form.horizon,
      p_issue_ref: parseIssueRef(form.issue_ref),
    });
    setSaving(false);
    if (err) { setError(`Kunne ikke dele punktet: ${err.message}`); return; }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Del punkt"
      description={item ? `Resten af "${item.title_da || item.title_en}" bliver et nyt punkt med en kopi af alle stemmer.` : ""}
      size="lg"
      footer={<FormFooter formId={formId} saving={saving} onClose={onClose} submitLabel="Del punkt" />}
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Restens titel (EN)" htmlFor={`${uid}-en`}>
          <Input id={`${uid}-en`} size="sm" value={form.title_en} onChange={(e) => set("title_en", e.target.value)} />
        </Field>
        <Field label="Restens titel (DA)" htmlFor={`${uid}-da`}>
          <Input id={`${uid}-da`} size="sm" value={form.title_da} onChange={(e) => set("title_da", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Status" htmlFor={`${uid}-status`}>
            <Select id={`${uid}-status`} size="sm" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {["planned", "in_progress", "active"].map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Next/Later" htmlFor={`${uid}-horizon`}>
            <Select id={`${uid}-horizon`} size="sm" value={form.horizon} onChange={(e) => set("horizon", e.target.value)}>
              <option value="next">Next</option>
              <option value="later">Later</option>
            </Select>
          </Field>
          <Field label="GitHub-issue" htmlFor={`${uid}-ref`}>
            <Input id={`${uid}-ref`} size="sm" inputMode="numeric" value={form.issue_ref}
              onChange={(e) => set("issue_ref", e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-cz-2">
          Det nye punkt oprettes skjult, til du har godkendt teksten. Næste skridt: ret det oprindelige punkts titel
          til præcis det, der er live, og sæt det til Færdig.
        </p>
        <SaveError message={error} />
      </form>
    </Modal>
  );
}

// ── Kendt fejl: opret / ret ─────────────────────────────────────────────────
const EMPTY_ISSUE = { area: "races", title_en: "", title_da: "", status: "checking", issue_ref: "", published: false };

export function IssueFormModal({ open, issue, onClose, onSaved }) {
  const uid = useId();
  const formId = `${uid}-issue`;
  const [form, setForm] = useState(EMPTY_ISSUE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(issue ? {
      area: issue.area ?? "races",
      title_en: issue.title_en ?? "",
      title_da: issue.title_da ?? "",
      status: issue.status ?? "checking",
      issue_ref: issue.issue_ref ?? "",
      published: Boolean(issue.published),
    } : EMPTY_ISSUE);
    setError("");
    setSaving(false);
  }, [open, issue]);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validateTitles(form.title_en, form.title_da)) { setError("Begge titler skal udfyldes."); return; }
    if (form.status === "dismissed" && (!issue || issue.status !== "dismissed")) {
      setError("Lukket uden fund kræver en forklaring. Brug Opdatering og trin på rækken.");
      return;
    }
    setSaving(true);
    setError("");
    const now = nowIso();
    const payload = {
      area: form.area,
      title_en: form.title_en.trim(),
      title_da: form.title_da.trim(),
      issue_ref: parseIssueRef(form.issue_ref),
      published: form.published,
      updated_at: now,
    };
    if (!issue || issue.status !== form.status) Object.assign(payload, issueStatusPatch(form.status, now));
    const query = issue
      ? supabase.from("known_issues").update(payload).eq("id", issue.issue_id)
      : supabase.from("known_issues").insert(payload);
    const { error: err } = await query;
    setSaving(false);
    if (err) { setError(`Kunne ikke gemme: ${err.message}`); return; }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={issue ? "Ret fejl" : "Ny fejl"}
      description="Spillerne ser fejlen, når Publiceret er slået til."
      size="lg"
      footer={<FormFooter formId={formId} saving={saving} onClose={onClose} submitLabel={issue ? "Gem" : "Opret"} />}
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Område" htmlFor={`${uid}-area`}>
            <Select id={`${uid}-area`} size="sm" value={form.area} onChange={(e) => set("area", e.target.value)}>
              {ISSUE_AREAS.map((a) => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
            </Select>
          </Field>
          <Field label="Trin" htmlFor={`${uid}-status`}>
            <Select id={`${uid}-status`} size="sm" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{ISSUE_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="GitHub-issue" htmlFor={`${uid}-ref`}>
            <Input id={`${uid}-ref`} size="sm" inputMode="numeric" value={form.issue_ref}
              onChange={(e) => set("issue_ref", e.target.value)} />
          </Field>
        </div>
        <Field label="Titel (EN)" htmlFor={`${uid}-en`}>
          <Input id={`${uid}-en`} size="sm" value={form.title_en} onChange={(e) => set("title_en", e.target.value)} />
        </Field>
        <Field label="Titel (DA)" htmlFor={`${uid}-da`}>
          <Input id={`${uid}-da`} size="sm" value={form.title_da} onChange={(e) => set("title_da", e.target.value)} />
        </Field>
        <Checkbox id={`${uid}-published`} label="Publiceret (synlig for spillerne)" checked={form.published}
          onChange={(e) => set("published", e.target.checked)} />
        <SaveError message={error} />
      </form>
    </Modal>
  );
}

// ── Kendt fejl: ny opdatering og/eller nyt trin ─────────────────────────────
export function IssueUpdateModal({ open, issue, focus = "update", onClose, onSaved }) {
  const uid = useId();
  const formId = `${uid}-update`;
  const [form, setForm] = useState({ status: "checking", body_en: "", body_da: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ status: issue?.status ?? "checking", body_en: "", body_da: "" });
      setError("");
      setSaving(false);
    }
  }, [open, issue]);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const hasText = validateTitles(form.body_en, form.body_da);
  const partialText = !hasText && Boolean(form.body_en.trim() || form.body_da.trim());
  const stepChanged = issue && form.status !== issue.status;
  const needsText = stepChanged && form.status === "dismissed";

  async function handleSubmit(e) {
    e.preventDefault();
    if (partialText) { setError("Opdateringen skal skrives på både engelsk og dansk."); return; }
    if (needsText && !hasText) { setError("Lukket uden fund kræver en opdatering med forklaringen."); return; }
    if (!hasText && !stepChanged) { setError("Skriv en opdatering eller vælg et nyt trin."); return; }
    setSaving(true);
    setError("");
    const now = nowIso();
    if (hasText) {
      const { error: err } = await supabase.from("known_issue_updates").insert({
        issue_id: issue.issue_id, body_en: form.body_en.trim(), body_da: form.body_da.trim(),
      });
      if (err) { setSaving(false); setError(`Kunne ikke gemme opdateringen: ${err.message}`); return; }
    }
    const patch = stepChanged ? issueStatusPatch(form.status, now) : { updated_at: now };
    const { error: err } = await supabase.from("known_issues").update(patch).eq("id", issue.issue_id);
    setSaving(false);
    if (err) { setError(`Kunne ikke gemme trinnet: ${err.message}`); return; }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={focus === "step" ? "Skift trin" : "Ny opdatering"}
      description={issue ? issue.title_da || issue.title_en : ""}
      size="lg"
      footer={<FormFooter formId={formId} saving={saving} onClose={onClose} submitLabel="Gem" />}
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field
          label="Trin"
          htmlFor={`${uid}-status`}
          helper={needsText ? "Skriv forklaringen nedenfor. Spillerne ser den i 14 dage." : undefined}
        >
          <Select id={`${uid}-status`} size="sm" value={form.status} onChange={(e) => set("status", e.target.value)}>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{ISSUE_STATUS_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Opdatering (EN)" htmlFor={`${uid}-en`}>
          <Textarea id={`${uid}-en`} size="sm" rows={3} value={form.body_en} onChange={(e) => set("body_en", e.target.value)} />
        </Field>
        <Field label="Opdatering (DA)" htmlFor={`${uid}-da`}>
          <Textarea id={`${uid}-da`} size="sm" rows={3} value={form.body_da} onChange={(e) => set("body_da", e.target.value)} />
        </Field>
        <SaveError message={error} />
      </form>
    </Modal>
  );
}
