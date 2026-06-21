// Player-facing roadmap (#1169, voting #954) — retning for de fire produkt-
// motorer (løb, træning, ungdom, marked), ingen datoer. Motor-prosa ("today")
// ejes af locales/{en,da}/roadmap.json; copy reviewes af ejer før ændringer.
// "Next"-items kommer fra Supabase (roadmap_items, kurateret + godkendt af
// ejer) med dual-akse 1-6-voting; de statiske i18n-bullets er fallback indtil
// items er seedet. Spillere ser kun egen stemme (ejer-beslutning 11/6).
//
// Roadmap-vedligehold (#1600): "Already built"-historik-sektion (shipped-items,
// nyeste først) + admin-only flade til at flytte item active↔shipped og oprette
// nye items uden migration. Admin-gate = supabase.rpc("is_admin"); RLS er
// source of truth (admin-INSERT/UPDATE-policies findes allerede).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import {
  SCALE,
  ENGINE_ORDER,
  groupItemsByEngine,
  isValidScore,
  itemTitle,
  buildVotePayload,
  votesByItemId,
} from "../lib/roadmapVoting.js";
import { FlagIcon, StopwatchIcon, TeamIcon, ExchangeIcon, CrownIcon } from "../components/ui";

const ENGINES = [
  { key: "races", Icon: FlagIcon },
  { key: "training", Icon: StopwatchIcon },
  { key: "youth", Icon: TeamIcon },
  { key: "market", Icon: ExchangeIcon },
  { key: "club", Icon: CrownIcon },
];

const ENGINE_ICON = Object.fromEntries(ENGINES.map((e) => [e.key, e.icon]));

const ITEM_COLUMNS = "id, engine, sort_order, title_en, title_da, approved, status, shipped_at";

function VoteAxis({ label, value, disabled, onSelect }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span className="text-cz-3 text-xs">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {SCALE.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onSelect(n)}
            className={`w-7 h-7 rounded-md text-xs font-semibold border transition-colors disabled:opacity-50 ${
              value === n
                ? "bg-cz-accent text-cz-on-accent border-cz-accent"
                : "bg-transparent text-cz-2 border-cz-border hover:border-cz-accent"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

const EMPTY_DRAFT = { engine: "races", sort_order: 0, title_en: "", title_da: "", approved: true, status: "active" };

function AdminCreateForm({ t, onCreated }) {
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
      .select(ITEM_COLUMNS)
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
    "w-full bg-cz-subtle border border-cz-border rounded-md px-2 py-1.5 text-sm text-cz-1 focus:border-cz-accent focus:outline-none";

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
            className="rounded border-cz-border text-cz-accent focus:ring-cz-accent"
          />
          {t("admin.approved")}
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === "saving"}
          className="px-3 py-1.5 text-xs font-semibold bg-cz-accent text-cz-on-accent rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
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

export default function RoadmapPage() {
  const { t, i18n } = useTranslation("roadmap");
  const [userId, setUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [items, setItems] = useState(null); // null = ikke hentet endnu → statisk fallback
  const [shipped, setShipped] = useState([]); // historik (status='shipped'), nyeste først
  const [drafts, setDrafts] = useState({}); // item_id → { idea, importance }
  const [saveState, setSaveState] = useState({}); // item_id → "saving" | "saved" | "error"
  const [statusState, setStatusState] = useState({}); // item_id → "saving" | "error" (admin-toggle)

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: itemData }, { data: auth }, { data: adminRaw }] = await Promise.all([
        supabase
          .from("roadmap_items")
          .select(ITEM_COLUMNS)
          .eq("approved", true)
          .in("status", ["active", "shipped"])
          .order("sort_order"),
        supabase.auth.getUser(),
        supabase.rpc("is_admin"),
      ]);
      if (cancelled) return;
      const all = itemData ?? [];
      setItems(all.filter((it) => it.status === "active"));
      setShipped(
        all
          .filter((it) => it.status === "shipped")
          .sort((a, b) => new Date(b.shipped_at ?? 0) - new Date(a.shipped_at ?? 0))
      );
      const uid = auth?.user?.id ?? null;
      setUserId(uid);
      setIsAdmin(adminRaw === true);

      // Privacy (#1599): hent KUN egne stemmer. Anonyme har ingen.
      // .eq filtrerer i querien; votesByItemId(uid) er forsvars-lag 2 mod
      // en evt. admin-RLS-undtagelse der returnerer andres rows.
      if (!uid) return;
      const { data: voteData } = await supabase
        .from("roadmap_votes")
        .select("item_id, idea_score, importance_score, user_id")
        .eq("user_id", uid);
      if (cancelled) return;
      const byItem = votesByItemId(voteData, uid);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const [itemId, vote] of byItem) {
          next[itemId] = { idea: vote.idea_score, importance: vote.importance_score };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleScore(item, axis, value) {
    const draft = { ...(drafts[item.id] ?? {}), [axis]: value };
    setDrafts((prev) => ({ ...prev, [item.id]: draft }));
    if (!isValidScore(draft.idea) || !isValidScore(draft.importance) || !userId) return;

    setSaveState((prev) => ({ ...prev, [item.id]: "saving" }));
    const { error } = await supabase.from("roadmap_votes").upsert(
      buildVotePayload({
        itemId: item.id,
        userId,
        ideaScore: draft.idea,
        importanceScore: draft.importance,
      }),
      { onConflict: "user_id,item_id" }
    );
    setSaveState((prev) => ({ ...prev, [item.id]: error ? "error" : "saved" }));
  }

  // Admin: flyt et item active ↔ shipped (RLS gater til is_admin()).
  async function handleSetStatus(item, nextStatus) {
    const confirmKey = nextStatus === "shipped" ? "admin.markShippedConfirm" : "admin.markActiveConfirm";
    if (!window.confirm(t(confirmKey))) return;
    setStatusState((prev) => ({ ...prev, [item.id]: "saving" }));
    const shipped_at = nextStatus === "shipped" ? new Date().toISOString() : null;
    const { data, error } = await supabase
      .from("roadmap_items")
      .update({ status: nextStatus, shipped_at })
      .eq("id", item.id)
      .select(ITEM_COLUMNS)
      .single();
    if (error || !data) {
      setStatusState((prev) => ({ ...prev, [item.id]: "error" }));
      return;
    }
    setStatusState((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    // Flyt rækken mellem aktiv-listen og historikken lokalt.
    if (nextStatus === "shipped") {
      setItems((prev) => (prev ?? []).filter((it) => it.id !== item.id));
      setShipped((prev) =>
        [data, ...prev].sort((a, b) => new Date(b.shipped_at ?? 0) - new Date(a.shipped_at ?? 0))
      );
    } else {
      setShipped((prev) => prev.filter((it) => it.id !== item.id));
      setItems((prev) => [...(prev ?? []), data].sort((a, b) => a.sort_order - b.sort_order));
    }
  }

  function handleCreated(item) {
    if (item.status === "active" && item.approved) {
      setItems((prev) => [...(prev ?? []), item].sort((a, b) => a.sort_order - b.sort_order));
    } else if (item.status === "shipped" && item.approved) {
      setShipped((prev) =>
        [item, ...prev].sort((a, b) => new Date(b.shipped_at ?? 0) - new Date(a.shipped_at ?? 0))
      );
    }
  }

  const grouped = groupItemsByEngine(items);
  const hasVotableItems = (items?.length ?? 0) > 0;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
        <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
        {hasVotableItems && (
          <p className="text-cz-2 text-sm mt-2">{t("voting.intro")}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {ENGINES.map(({ key, Icon }) => (
          <div key={key} className="bg-cz-card border border-cz-border rounded-cz px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-4 h-4 text-cz-accent-t flex-shrink-0" aria-hidden="true" />
              <h2 className="text-cz-1 font-bold text-sm">{t(`engines.${key}.title`)}</h2>
            </div>

            <div className="mb-3">
              <div className="text-cz-3 text-[10px] font-semibold uppercase tracking-wider mb-1">
                {t("labels.today")}
              </div>
              <p className="text-cz-2 text-sm leading-relaxed">{t(`engines.${key}.today`)}</p>
            </div>

            <div>
              <div className="text-cz-accent-t text-[10px] font-semibold uppercase tracking-wider mb-1">
                {t("labels.next")}
              </div>

              {grouped[key].length > 0 ? (
                <ul className="flex flex-col gap-4">
                  {grouped[key].map((item) => {
                    const draft = drafts[item.id] ?? {};
                    const state = saveState[item.id];
                    return (
                      <li key={item.id}>
                        <div className="flex items-start gap-2">
                          <div className="w-1 h-1 rounded-full flex-shrink-0 mt-1.5 bg-cz-accent" />
                          <span className="text-cz-2 text-sm leading-relaxed">
                            {itemTitle(item, i18n.language)}
                          </span>
                        </div>
                        <div className="mt-2 ms-3 flex flex-col gap-1.5">
                          <VoteAxis
                            label={t("voting.idea")}
                            value={draft.idea}
                            disabled={state === "saving"}
                            onSelect={(n) => handleScore(item, "idea", n)}
                          />
                          <VoteAxis
                            label={t("voting.importance")}
                            value={draft.importance}
                            disabled={state === "saving"}
                            onSelect={(n) => handleScore(item, "importance", n)}
                          />
                          <div aria-live="polite" className="min-h-[1rem]">
                            {state === "saved" && (
                              <span className="text-cz-3 text-xs">{t("voting.saved")}</span>
                            )}
                            {state === "error" && (
                              <span className="text-cz-danger text-xs">{t("voting.error")}</span>
                            )}
                          </div>
                          {isAdmin && (
                            <button
                              type="button"
                              disabled={statusState[item.id] === "saving"}
                              onClick={() => handleSetStatus(item, "shipped")}
                              className="self-start text-cz-3 text-xs underline hover:text-cz-accent-t disabled:opacity-50"
                            >
                              {statusState[item.id] === "error" ? t("admin.error") : t("admin.markShipped")}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {t(`engines.${key}.next`, { returnObjects: true }).map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full flex-shrink-0 mt-1.5 bg-cz-accent" />
                      <span className="text-cz-2 text-sm leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {shipped.length > 0 && (
        <div className="mt-8">
          <h2 className="text-cz-1 font-bold text-sm">{t("shipped.title")}</h2>
          <p className="text-cz-3 text-xs mb-3">{t("shipped.subtitle")}</p>
          <div className="bg-cz-card border border-cz-border rounded-cz px-5 py-4">
            <ul className="flex flex-col gap-3">
              {shipped.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-0.5">{ENGINE_ICON[item.engine] ?? "•"}</span>
                  <span className="text-cz-2 text-sm leading-relaxed flex-1">
                    {itemTitle(item, i18n.language)}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={statusState[item.id] === "saving"}
                      onClick={() => handleSetStatus(item, "active")}
                      className="flex-shrink-0 text-cz-3 text-xs underline hover:text-cz-accent-t disabled:opacity-50"
                    >
                      {statusState[item.id] === "error" ? t("admin.error") : t("admin.markActive")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mt-8">
          <h2 className="text-cz-accent-t text-[10px] font-semibold uppercase tracking-wider mb-2">
            {t("admin.panel")}
          </h2>
          <div className="bg-cz-card border border-cz-border rounded-cz px-5 py-4">
            <AdminCreateForm t={t} onCreated={handleCreated} />
          </div>
        </div>
      )}
    </div>
  );
}
