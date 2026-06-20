import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PATCHES } from "../data/patchNotes.js";
import {
  flattenChanges, filterChanges, groupByDay, pickLang, computeNewDays, CATEGORY_META,
} from "../lib/patchNotes.js";

const LAST_SEEN_KEY = "cz_patchnotes_last_seen";
const CATEGORIES = ["all", "new", "improved", "fixed"];

function formatDate(iso, lang) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(lang === "da" ? "da-DK" : "en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
}

export default function PatchNotesPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("da") ? "da" : "en";
  const da = lang === "da";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [openDays, setOpenDays] = useState(() => new Set());
  const [openChanges, setOpenChanges] = useState(() => new Set());

  const flat = useMemo(() => flattenChanges(PATCHES), []);
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Patch notes</h1>
        <p className="text-cz-3 text-sm">
          {da ? "Hvad er nyt i Cycling Zone Manager" : "What's new in Cycling Zone Manager"}
        </p>
      </div>

      <div className="mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={da ? "Søg i opdateringer" : "Search updates"}
          placeholder={da ? "Søg i opdateringer…" : "Search updates…"}
          className="w-full bg-cz-card border border-cz-border rounded-cz px-3 py-2 text-sm text-cz-1 placeholder:text-cz-3 focus:outline-none focus:border-cz-accent/50"
        />
      </div>

      <div
        className="flex flex-wrap gap-2 mb-6"
        role="group"
        aria-label={da ? "Filtrér efter kategori" : "Filter by category"}
      >
        {CATEGORIES.map((cat) => {
          const active = category === cat;
          const meta = CATEGORY_META[cat];
          const label = cat === "all" ? (da ? "Alle" : "All") : (da ? meta.da : meta.en);
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

      {days.length === 0 && (
        <p className="text-cz-3 text-sm">{da ? "Ingen opdateringer matcher." : "No updates match."}</p>
      )}

      <div className="flex flex-col gap-3">
        {days.map((day) => {
          const open = isDayOpen(day.date);
          const isNew = newDays.has(day.date);
          return (
            <div
              key={day.date}
              className={`bg-cz-card border rounded-cz overflow-hidden ${
                open ? "border-cz-accent/30" : "border-cz-border"
              }`}
            >
              <button
                onClick={() => toggleDay(day.date)}
                aria-expanded={open}
                className="w-full flex items-center justify-between px-5 py-4 text-left"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-cz-1 font-bold text-sm capitalize">
                      {formatDate(day.date, lang)}
                    </span>
                    {isNew && (
                      <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-cz-pill">
                        {da ? "Ny" : "New"}
                      </span>
                    )}
                  </div>
                  <div className="text-cz-3 text-xs mt-0.5">
                    {["new", "improved", "fixed"]
                      .filter((cat) => day.categories[cat]?.length)
                      .map((cat) => `${day.categories[cat].length} ${(da ? CATEGORY_META[cat].da : CATEGORY_META[cat].en).toLowerCase()}`)
                      .join(" · ")}
                  </div>
                </div>
                <span className={`text-cz-3 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
              </button>

              {open && (
                <div className="px-5 pb-5 border-t border-cz-border pt-4 space-y-4">
                  {["new", "improved", "fixed"].map((cat) => {
                    const list = day.categories[cat];
                    if (!list || !list.length) return null;
                    const meta = CATEGORY_META[cat];
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-1.5 h-1.5 rounded-cz-pill flex-shrink-0 ${meta.dot}`} />
                          <span className="text-cz-2 text-xs font-semibold uppercase tracking-wider">
                            {da ? meta.da : meta.en}
                          </span>
                        </div>
                        <ul className="flex flex-col gap-2 ms-3.5">
                          {list.map((c) => {
                            const v = pickLang(c, lang);
                            const expanded = openChanges.has(c._key);
                            const hasBody = v.body && v.body !== v.title;
                            return (
                              <li key={c._key}>
                                <button
                                  onClick={() => hasBody && toggleChange(c._key)}
                                  aria-expanded={hasBody ? expanded : undefined}
                                  className={`w-full flex items-start justify-between gap-2 text-left ${
                                    hasBody ? "" : "cursor-default"
                                  }`}
                                >
                                  <span className="text-cz-1 text-sm font-medium leading-snug">
                                    {v.title || v.body}
                                    {v.isFallback && (
                                      <span className="text-cz-3 text-xs ms-1">
                                        ({v.lang === "da" ? "Dansk" : "English"})
                                      </span>
                                    )}
                                  </span>
                                  {hasBody && (
                                    <span className={`text-cz-3 text-xs mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
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
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-cz-3 text-xs mt-6">
        <span>
          {da
            ? "Interne og tekniske noter er skjult fra denne side."
            : "Internal & technical notes are hidden from this page."}
        </span>
      </div>
    </div>
  );
}
