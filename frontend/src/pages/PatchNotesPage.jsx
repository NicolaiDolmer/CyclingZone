import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  loadPatches, flattenChanges, filterChanges, groupByDay, pickLang, computeNewDays, CATEGORY_META,
} from "../lib/patchNotes.js";
import {
  PageHeader, Card, Input, Button, EmptyState, ErrorState, PageLoader,
  SearchIcon, ChevronDownIcon, ChevronRightIcon,
} from "../components/ui";

const LAST_SEEN_KEY = "cz_patchnotes_last_seen";
const CATEGORIES = ["all", "new", "improved", "fixed"];

function formatDate(iso, lang) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(lang === "da" ? "da-DK" : "en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
}

// #2849 bølge 4 — migreret til T1 (standard content, max-w-4xl). Kanonisk
// PageHeader, Section-card-recipe for versions-blokkene, EmptyState/ErrorState/
// PageLoader for states. Al ternary-i18n (da ? … : …) erstattet med rigtige
// t()-nøgler i det nye "patchnotes"-namespace (allerede wired i i18n/index.js,
// lazy-loaded — siden er allerede route-lazy, se lib/patchNotes.js).
export default function PatchNotesPage() {
  // #2849 bølge 4: patchnotes-namespacet er IKKE inlinet (lazy via HttpBackend) —
  // `ready` indgår i PageLoader-gaten nedenfor så raw keys aldrig rammer first
  // paint. Se INLINE_EXEMPT i scripts/i18n-check-namespace-inline.mjs.
  const { t, i18n, ready } = useTranslation("patchnotes");
  const lang = i18n.language?.startsWith("da") ? "da" : "en";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [openDays, setOpenDays] = useState(() => new Set());
  const [openChanges, setOpenChanges] = useState(() => new Set());

  // #2108/#2060: prosaen bundtes ikke længere i JS — hentes on-demand som statisk
  // JSON (dist/patch-notes.json) via loaderen i ../lib/patchNotes.js.
  const [patches, setPatches] = useState(null);
  const [loadError, setLoadError] = useState(false);
  // #2849 bølge 4: reloadToken driver en ægte retry (kanonisk ErrorState kræver
  // en fungerende "Try again"-knap, ikke bare en fejltekst).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    loadPatches()
      .then((data) => { if (active) setPatches(data); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [reloadToken]);

  function retryLoad() {
    setPatches(null);
    setReloadToken((n) => n + 1);
  }

  const flat = useMemo(() => flattenChanges(patches || []), [patches]);
  const days = useMemo(
    () => groupByDay(filterChanges(flat, { lang, category, query })),
    [flat, lang, category, query],
  );

  const [lastSeen] = useState(() => {
    try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
  });
  const newDays = useMemo(
    () => computeNewDays(days.map((d) => d.date), lastSeen),
    [days, lastSeen],
  );

  useEffect(() => {
    const latest = days[0]?.date;
    if (latest) {
      try { localStorage.setItem(LAST_SEEN_KEY, latest); } catch { /* ignore */ }
    }
  }, [days]);

  const latest = days[0]?.date;
  const filtering = Boolean(query) || category !== "all";
  const isDayOpen = (date) =>
    openDays.has(date) || (date === latest && openDays.size === 0 && !filtering);

  const toggleDay = (date) =>
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const toggleChange = (key) =>
    setOpenChanges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!ready || (!loadError && patches === null)) {
    return <PageLoader label={ready ? t("loading.label") : "Loading"} />;
  }

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto">
        {/* KRITISK: h1 skal rendere "Patch notes" uafhængigt af sprog — se
            core-smoke.spec.js. defaultValue er et bevidst sikkerhedsnet i
            tilfælde af at namespace-JSON'en (locales-mappen for patchnotes)
            endnu er tom. */}
        <PageHeader title={t("title", { defaultValue: "Patch notes" })} />
        <ErrorState
          title={t("loadError")}
          description={t("loadErrorBody")}
          action={<Button size="sm" variant="secondary" onClick={retryLoad}>{t("retry")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={t("title", { defaultValue: "Patch notes" })}
        subtitle={t("subtitle")}
      />

      <div className="mb-3">
        <Input
          type="search"
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("search.ariaLabel")}
          placeholder={t("search.placeholder")}
          className="w-full"
        />
      </div>

      <div
        className="flex flex-wrap gap-2 mb-6"
        role="group"
        aria-label={t("filter.ariaLabel")}
      >
        {CATEGORIES.map((cat) => {
          const active = category === cat;
          const meta = CATEGORY_META[cat];
          const label = t(`category.${cat}`);
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              aria-pressed={active}
              className={`text-xs px-3 py-1.5 rounded-cz-pill border transition-colors flex items-center gap-2 ${
                active
                  ? "border-cz-accent/40 bg-cz-accent/10 text-cz-accent-t"
                  : "border-cz-border text-cz-2 hover:text-cz-1"
              }`}
            >
              {meta && <span className={`w-1.5 h-1.5 rounded-cz-pill ${meta.dot}`} />}
              {label}
            </button>
          );
        })}
      </div>

      {days.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={26} aria-hidden="true" />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="flex flex-col gap-[14px]">
          {days.map((day) => {
            const open = isDayOpen(day.date);
            const isNew = newDays.has(day.date);
            const summary = ["new", "improved", "fixed"]
              .filter((cat) => day.categories[cat]?.length)
              .map((cat) => `${day.categories[cat].length} ${t(`category.${cat}`).toLowerCase()}`)
              .join(" · ");
            return (
              <Card
                key={day.date}
                className={`p-4 sm:p-5 ${open ? "border-cz-accent/30" : ""}`}
              >
                <button
                  onClick={() => toggleDay(day.date)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-data text-[15px] font-semibold tabular-nums text-cz-1 capitalize truncate">
                      {formatDate(day.date, lang)}
                    </span>
                    {isNew && (
                      <span className="text-3xs uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-cz-pill flex-shrink-0">
                        {t("newBadge")}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                      {summary}
                    </span>
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={`w-4 h-4 text-cz-3 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {open && (
                  <div className="mt-4 pt-4 border-t border-cz-border space-y-4">
                    {["new", "improved", "fixed"].map((cat) => {
                      const list = day.categories[cat];
                      if (!list || !list.length) return null;
                      const meta = CATEGORY_META[cat];
                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-1.5 h-1.5 rounded-cz-pill flex-shrink-0 ${meta.dot}`} />
                            <span className="text-cz-2 text-xs font-semibold uppercase tracking-wider">
                              {t(`category.${cat}`)}
                            </span>
                          </div>
                          <ul className="flex flex-col divide-y divide-cz-border ms-3.5">
                            {list.map((c) => {
                              const v = pickLang(c, lang);
                              const expanded = openChanges.has(c._key);
                              const hasBody = v.body && v.body !== v.title;
                              return (
                                <li key={c._key} className="py-[13px] first:pt-0">
                                  <button
                                    onClick={() => hasBody && toggleChange(c._key)}
                                    aria-expanded={hasBody ? expanded : undefined}
                                    className={`w-full flex items-start justify-between gap-2 text-left ${
                                      hasBody ? "" : "cursor-default"
                                    }`}
                                  >
                                    <span className="text-cz-1 text-[13.5px] font-medium leading-snug">
                                      {v.title || v.body}
                                      {v.isFallback && (
                                        <span className="text-cz-3 text-xs ms-1">
                                          ({t(`fallbackLang.${v.lang}`)})
                                        </span>
                                      )}
                                    </span>
                                    {hasBody && (
                                      <ChevronRightIcon
                                        aria-hidden="true"
                                        size={13}
                                        className={`text-cz-3 mt-0.5 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                                      />
                                    )}
                                  </button>
                                  {expanded && hasBody && (
                                    <p className="text-cz-2 text-sm leading-relaxed mt-1">{v.body}</p>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 text-cz-3 text-xs mt-6">
        <span>{t("footer.hiddenNote")}</span>
      </div>
    </div>
  );
}
