// Player-facing roadmap (#1169, voting #954) — retning for de fire produkt-
// motorer (løb, træning, ungdom, marked), ingen datoer. Motor-prosa ("today")
// ejes af locales/{en,da}/roadmap.json; copy reviewes af ejer før ændringer.
// "Next"-items kommer fra Supabase (roadmap_items, kurateret + godkendt af
// ejer) med dual-akse 1-6-voting; de statiske i18n-bullets er fallback indtil
// items er seedet. Spillere ser kun egen stemme (ejer-beslutning 11/6).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import {
  SCALE,
  groupItemsByEngine,
  isValidScore,
  itemTitle,
  buildVotePayload,
  votesByItemId,
} from "../lib/roadmapVoting.js";

const ENGINES = [
  { key: "races", icon: "🏁" },
  { key: "training", icon: "📈" },
  { key: "youth", icon: "🌱" },
  { key: "market", icon: "⚡" },
  { key: "club", icon: "🏛️" },
];

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

export default function RoadmapPage() {
  const { t, i18n } = useTranslation("roadmap");
  const [userId, setUserId] = useState(null);
  const [items, setItems] = useState(null); // null = ikke hentet endnu → statisk fallback
  const [drafts, setDrafts] = useState({}); // item_id → { idea, importance }
  const [saveState, setSaveState] = useState({}); // item_id → "saving" | "saved" | "error"

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: itemData }, { data: auth }] = await Promise.all([
        supabase
          .from("roadmap_items")
          .select("id, engine, sort_order, title_en, title_da")
          .eq("approved", true)
          .eq("status", "active")
          .order("sort_order"),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      setItems(itemData ?? []);
      const uid = auth?.user?.id ?? null;
      setUserId(uid);

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
        {ENGINES.map(({ key, icon }) => (
          <div key={key} className="bg-cz-card border border-cz-border rounded-cz px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span aria-hidden="true">{icon}</span>
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
    </div>
  );
}
