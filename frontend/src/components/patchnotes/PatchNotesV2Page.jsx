// #8049 · Den nye patch notes-side bag kontakten patch_notes_v2_8049 (off = gammel side).
//
// Ejerens valg 12/11 + 16/11 (issue #8049): efter område, uge for uge, arkiv pr. måned.
//  1. "Denne uge" som variant A (område med linjer); en åbnet ældre uge/måned som B.
//  2. Mandagsreglen: sidste uge står også åben, når denne uge har under 10 ændringer.
//  3. Ugens store nyhed vælges automatisk (Tændt for alle > Nyt > Beta); `highlight` overstyrer.
//  4. Billede kun ved ugens nyhed.
//  5. Gamle noter uden område ligger i "Andet" (kun arkivet).
//  6. Beta og tændt samme uge: kun den seneste vises i ugen; begge findes i arkiv og søgning.
// T1 (896 px), den kanoniske PageHeader og højst to section cards (fold-disciplinen).
// "Nyt siden sidst" og prikkerne følger brugeren via seen_markers (#6515), ikke enheden.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PATCH_NOTE_AREAS_WITH_OTHER, patchNotesRecentUrl, patchNotesIndexUrl, patchNotesMonthUrl,
  loadPatchNotesFile, weekStartOf, addDaysIso, isoWeekNumber, todayIso, dedupeWeek, pickHero,
  isNewSince, isThinWeek, filterV2Items, normalizeQuery, matchesQuery, weekSummary, tagOf,
  compareNewestFirst,
} from "../../lib/patchNotes.js";
import { markSeen, readLocalSeenMarker, useSeenMarkersSynced } from "../../lib/seenMarkers6515.ts";
import { intlLocale } from "../../lib/intlLocale.ts";
import {
  PageHeader, Section, SectionStack, SectionHeader, Input, Select, Toggle, Button, EmptyState,
  ErrorState, PageLoader, SkeletonLines, SearchIcon, XIcon,
} from "../ui";
import { AreaBlocksA, AreaRowsB, PatchHero, PatchTag, NewDot, QuietButton, TOUCH } from "./PatchNoteParts.jsx";

// UI-kittets JSX har null-defaults, som checkJs læser som "kun null" (samme som resten af appen).
const Header = /** @type {any} */ (PageHeader);
const CardHeader = /** @type {any} */ (SectionHeader);
const ErrorBox = /** @type {any} */ (ErrorState);

const PREVIOUS_WEEKS = 4;
const ARCHIVE_MONTHS_SHOWN = 3;
const SEARCH_MIN = 2;
const SEARCH_PAGE = 40;

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function capitalize(text, locale) {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}

/** @param {{ liveFlags?: Record<string, boolean> | null, initialMarker?: string | null }} props */
export default function PatchNotesV2Page({ liveFlags = null, initialMarker }) {
  const { t, i18n } = useTranslation("patchnotes");
  const lang = i18n.language?.startsWith("da") ? "da" : "en";
  const locale = intlLocale(i18n.language);

  const [recent, setRecent] = useState(/** @type {any} */ (null));
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadError(false);
    setRecent(null);
    loadPatchNotesFile(patchNotesRecentUrl(lang))
      .then((data) => { if (active) setRecent(data); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [lang, reloadToken]);

  // "Sidst set" ved ankomst (#6515): fanges før siden markerer, så prikkerne viser
  // hvad der var nyt, da spilleren kom. Rykker kun frem, når en anden enhed har set mere.
  const [marker, setMarker] = useState(() => (initialMarker !== undefined ? initialMarker : readLocalSeenMarker("patch_notes")));
  useSeenMarkersSynced("patch_notes", setMarker);
  useEffect(() => {
    if (recent?.seenKey) markSeen("patch_notes", recent.seenKey);
  }, [recent?.seenKey]);

  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [betaOnly, setBetaOnly] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const areaLabel = useCallback((a) => t(`v2.area.${a}`), [t]);
  const filters = { area, betaOnly, onlyNew, marker, liveFlags };
  const filtering = area !== "all" || betaOnly || onlyNew;

  const today = todayIso();
  const thisWeek = weekStartOf(today);
  const allRecent = recent?.items || [];
  const weeks = Array.from({ length: PREVIOUS_WEEKS + 1 }, (_, i) => {
    const start = addDaysIso(thisWeek, -7 * i);
    const end = addDaysIso(start, 6);
    return { start, end, items: dedupeWeek(allRecent.filter((it) => it.d >= start && it.d <= end)) };
  });
  const thin = isThinWeek(weeks[0]?.items.length ?? 0);
  const isWeekOpen = (i) => expanded.has(`week:${i}`) !== (i === 1 && thin);

  const newCount = allRecent.filter((it) => isNewSince(it, marker)).length;

  // ── Arkivmåneder: listen står i recent, indholdet hentes først når måneden åbnes ──
  const currentMonth = today.slice(0, 7);
  const archiveMonths = (recent?.months || []).filter((m) => m.m < currentMonth);
  const [monthData, setMonthData] = useState(/** @type {Record<string, any>} */ ({}));
  const loadMonth = useCallback((m) => {
    const key = `${m}.${lang}`;
    setMonthData((prev) => ({ ...prev, [key]: { status: "loading" } }));
    loadPatchNotesFile(patchNotesMonthUrl(m, lang))
      .then((data) => setMonthData((prev) => ({ ...prev, [key]: { status: "ready", items: data.items || [] } })))
      .catch(() => setMonthData((prev) => ({ ...prev, [key]: { status: "error" } })));
  }, [lang]);
  const toggleMonth = (m) => {
    const key = `month:${m}`;
    if (!expanded.has(key) && !["ready", "loading"].includes(monthData[`${m}.${lang}`]?.status)) loadMonth(m);
    toggle(key);
  };

  // ── Søgning: hentede uger i titel og tekst; ældre noter via titelindekset (hentes ved første søgning) ──
  const debouncedQuery = useDebounced(query, 250);
  const q = normalizeQuery(debouncedQuery);
  const searching = q.length >= SEARCH_MIN;
  const [index, setIndex] = useState(/** @type {{ status: string, lang: string | null, items: any[] }} */ ({ status: "idle", lang: null, items: [] }));
  useEffect(() => {
    if (!searching || (index.lang === lang && index.status !== "error")) return undefined;
    let active = true;
    setIndex({ status: "loading", lang, items: [] });
    loadPatchNotesFile(patchNotesIndexUrl(lang))
      .then((data) => { if (active) setIndex({ status: "ready", lang, items: data.items || [] }); })
      .catch(() => { if (active) setIndex({ status: "error", lang, items: [] }); });
    return () => { active = false; };
    // index.status/lang er bevidst kun et værn: hentes én gang pr. sprog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, lang]);
  const [searchLimit, setSearchLimit] = useState(SEARCH_PAGE);
  useEffect(() => { setSearchLimit(SEARCH_PAGE); }, [q, area, betaOnly, onlyNew]);
  let hits = [];
  if (searching) {
    const fromRecent = filterV2Items(recent?.items, filters).filter((it) => matchesQuery(it, q));
    const recentKeys = new Set((recent?.items || []).map((it) => it.k));
    const fromIndex = index.lang === lang
      ? filterV2Items(index.items, filters).filter((it) => !recentKeys.has(it.k) && (it.ti || "").toLowerCase().includes(q))
      : [];
    hits = [...fromRecent, ...fromIndex].sort((a, b) => (a.d !== b.d ? (a.d < b.d ? 1 : -1) : compareNewestFirst(a, b)));
  }

  // ── Datoer i spillerens sprog ──
  const rangeLabel = (start, end) => {
    const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    const a = new Date(`${start}T12:00:00Z`);
    const b = new Date(`${end}T12:00:00Z`);
    return typeof fmt.formatRange === "function" ? fmt.formatRange(a, b) : `${fmt.format(a)} - ${fmt.format(b)}`;
  };
  const monthLabel = (m) => capitalize(
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`)),
    locale,
  );
  const weekLabel = (i, start) => (i === 0 ? t("v2.thisWeek") : i === 1 ? t("v2.lastWeek") : t("v2.week", { week: isoWeekNumber(start) }));
  const sourceLabel = (item) => {
    const i = weeks.findIndex((w) => item.d >= w.start && item.d <= w.end);
    if (i >= 0) return `${weekLabel(i, weeks[i].start)} · ${rangeLabel(weeks[i].start, weeks[i].end)}`;
    return monthLabel(item.d.slice(0, 7));
  };

  if (!recent && !loadError) {
    return (
      <div className="max-w-4xl mx-auto">
        <Header title={t("title", { defaultValue: "Patch notes" })} />
        <PageLoader label={t("loading.label")} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto">
        <Header title={t("title", { defaultValue: "Patch notes" })} />
        <ErrorBox
          title={t("loadError")}
          description={t("loadErrorBody")}
          action={<Button size="sm" variant="secondary" onClick={() => setReloadToken((n) => n + 1)}>{t("retry")}</Button>}
        />
      </div>
    );
  }

  const clearFilters = () => { setArea("all"); setBetaOnly(false); setOnlyNew(false); setQuery(""); };
  const lineProps = { t, liveFlags, marker, areaLabel, expanded, toggle };

  const header = (
    <Header
      title={t("title", { defaultValue: "Patch notes" })}
      subtitle={t("v2.subtitle")}
      actions={newCount > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={onlyNew}
          onClick={() => setOnlyNew((v) => !v)}
          className={onlyNew ? "bg-cz-subtle" : ""}
        >
          <NewDot t={t} />
          <span className="font-data tabular-nums">{t("v2.newSince", { count: newCount })}</span>
          {/* Aktiv filtrering vises ikke kun med farve: et kryds siger "tryk for at fjerne" (WCAG 1.4.1). */}
          {onlyNew && <XIcon size={13} aria-hidden="true" className="text-cz-2" />}
        </Button>
      ) : null}
    />
  );

  const filterBar = (
    <div className="mb-[14px] flex flex-wrap items-center gap-2.5">
      <label className="relative min-w-0 flex-1 max-sm:basis-full">
        <span className="sr-only">{t("v2.search.ariaLabel")}</span>
        <SearchIcon size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cz-3" />
        <Input
          type="search"
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("v2.search.placeholder")}
          className="w-full ps-9"
        />
      </label>
      <div className="max-sm:flex-1">
        <Select size="sm" value={area} onChange={(e) => setArea(e.target.value)} aria-label={t("v2.area.label")} className="w-full">
          <option value="all">{t("v2.area.all")}</option>
          {PATCH_NOTE_AREAS_WITH_OTHER.map((a) => <option key={a} value={a}>{areaLabel(a)}</option>)}
        </Select>
      </div>
      <Toggle
        id="patchnotes-v2-beta-only"
        checked={betaOnly}
        onChange={(e) => setBetaOnly(e.target.checked)}
        label={<span className="whitespace-nowrap text-[13px] text-cz-2">{t("filter.betaOnly")}</span>}
      />
    </div>
  );

  if (searching) {
    const shown = hits.slice(0, searchLimit);
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        {filterBar}
        <Section>
          <CardHeader title={t("v2.searchResults")} meta={t("v2.hits", { count: hits.length })} />
          {index.status === "loading" && hits.length === 0 ? (
            <SkeletonLines lines={4} />
          ) : hits.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={26} aria-hidden="true" />}
              title={t("v2.searchEmpty.title")}
              description={t("v2.searchEmpty.description")}
              action={<Button size="sm" variant="secondary" onClick={clearFilters}>{t("v2.clear")}</Button>}
            />
          ) : (
            <ul>
              {shown.map((it) => (
                <li key={it.k} className="grid grid-cols-[132px_minmax(0,1fr)_12px] items-start gap-x-3 border-t border-cz-border py-2.5 first:border-t-0 first:pt-0 max-sm:grid-cols-[minmax(0,1fr)_12px] max-sm:gap-y-1">
                  <PatchTag tag={tagOf(it, liveFlags)} t={t} className="justify-self-start max-sm:col-span-2" />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium leading-snug text-cz-1">{it.ti || it.b}</p>
                    {it.b && it.b !== it.ti && <p className="mt-px line-clamp-2 text-[12.5px] leading-[1.45] text-cz-2">{it.b}</p>}
                    <p className="mt-1 font-data text-2xs tabular-nums text-cz-3">{areaLabel(it.a)} · {sourceLabel(it)}</p>
                  </div>
                  <span className="pt-[6px] max-sm:col-start-2 max-sm:row-start-2">{isNewSince(it, marker) && <NewDot t={t} />}</span>
                </li>
              ))}
            </ul>
          )}
          {index.status === "error" && (
            <p className="mt-3 text-[13px] text-cz-2">{t("v2.indexError")}</p>
          )}
          {hits.length > shown.length && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-cz-border pt-3">
              <span className="font-data text-xs tabular-nums text-cz-3">{t("v2.showing", { shown: shown.length, total: hits.length })}</span>
              <Button size="sm" variant="secondary" onClick={() => setSearchLimit((n) => n + SEARCH_PAGE)}>{t("v2.showMore")}</Button>
            </div>
          )}
        </Section>
      </div>
    );
  }

  const week0 = filterV2Items(weeks[0].items, filters);
  const hero = filtering ? null : pickHero(week0, liveFlags);
  const rest0 = hero ? week0.filter((it) => it.k !== hero.k) : week0;
  const previous = weeks.slice(1);
  const anyContent = week0.length > 0 || previous.some((w) => filterV2Items(w.items, filters).length > 0);
  const olderMonths = archiveMonths.slice(ARCHIVE_MONTHS_SHOWN);
  const olderOpen = expanded.has("months:older");
  const visibleMonths = olderOpen ? archiveMonths : archiveMonths.slice(0, ARCHIVE_MONTHS_SHOWN);

  return (
    <div className="max-w-4xl mx-auto">
      {header}
      {filterBar}

      {filtering && !anyContent && archiveMonths.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={26} aria-hidden="true" />}
          title={t("v2.filterEmpty.title")}
          description={t("v2.filterEmpty.description")}
          action={<Button size="sm" variant="secondary" onClick={clearFilters}>{t("v2.clear")}</Button>}
        />
      ) : (
        <SectionStack>
          <Section aria-labelledby="pn-this-week">
            <CardHeader
              title={<span id="pn-this-week">{t("v2.thisWeek")}</span>}
              meta={<span className="tabular-nums">{t("v2.weekMeta", { range: rangeLabel(weeks[0].start, weeks[0].end), count: week0.length })}</span>}
            />
            {hero && <PatchHero item={hero} t={t} liveFlags={liveFlags} marker={marker} areaLabel={areaLabel(hero.a)} />}
            {rest0.length > 0 ? (
              <AreaBlocksA items={rest0} prefix="w0" {...lineProps} />
            ) : (
              !hero && <p className="text-[13px] text-cz-2">{t(filtering ? "v2.emptyWeekFiltered" : "v2.emptyWeek")}</p>
            )}
          </Section>

          <Section aria-labelledby="pn-earlier">
            <CardHeader title={<span id="pn-earlier">{t("v2.earlierWeeks")}</span>} />
            <ul>
              {previous.map((w, j) => {
                const i = j + 1;
                const open = isWeekOpen(i);
                const list = filterV2Items(w.items, filters);
                const summary = weekSummary(list, liveFlags);
                return (
                  <li key={w.start} className="border-t border-cz-border py-3 first:border-t-0 first:pt-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(`week:${i}`)}
                      className={`flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-left ${TOUCH}`}
                    >
                      <span className="whitespace-nowrap text-sm font-semibold text-cz-1">{weekLabel(i, w.start)}</span>
                      <span className="whitespace-nowrap font-data text-2xs uppercase tabular-nums tracking-[.08em] text-cz-3 max-sm:order-3 max-sm:basis-full">
                        {t("v2.weekMeta", { range: rangeLabel(w.start, w.end), count: list.length })}
                        {i === 1 && thin && !expanded.has("week:1") ? ` · ${t("v2.openOnMonday")}` : ""}
                      </span>
                      <span className="flex-1" />
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-cz-accent-t">
                        {open ? t("v2.close") : t("v2.openWeek")}
                      </span>
                    </button>
                    {open ? (
                      list.length > 0 ? (
                        <div className="mt-3 rounded-cz border border-cz-border px-3.5 py-1">
                          <AreaRowsB items={list} prefix={`w${i}`} {...lineProps} />
                        </div>
                      ) : (
                        <p className="mt-1 text-[13px] text-cz-2">{t("v2.emptyWeekFiltered")}</p>
                      )
                    ) : list.length > 0 && (
                      <p className="mt-1 text-[12.5px] leading-normal text-cz-2">
                        {summary.top.length > 0 && (
                          <span className="block">{t("v2.mostImportant")}: {summary.top.map((it) => it.ti || it.b).join(" · ")}</span>
                        )}
                        <span className="block text-cz-3">
                          {summary.areas.map(([a, n]) => `${areaLabel(a)} ${n}`).join(" · ")}
                          {summary.rest > 0 ? ` · ${t("v2.otherCount", { count: summary.rest })}` : ""}
                        </span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {archiveMonths.length > 0 && (
              <div className="mt-4 border-t border-cz-border pt-4">
                <h3 className="mb-1 font-data text-2xs uppercase tracking-[.08em] text-cz-3">{t("v2.archive")}</h3>
                <ul>
                  {visibleMonths.map(({ m, n }) => {
                    const open = expanded.has(`month:${m}`);
                    const data = monthData[`${m}.${lang}`];
                    const list = data?.status === "ready" ? filterV2Items(data.items, filters) : [];
                    return (
                      <li key={m} className="border-t border-cz-border first:border-t-0">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggleMonth(m)}
                          className={`flex w-full items-baseline gap-2.5 py-2.5 text-left ${TOUCH}`}
                        >
                          <span className="text-[13.5px] font-medium text-cz-1">{monthLabel(m)}</span>
                          <span className="font-data text-2xs uppercase tabular-nums tracking-[.08em] text-cz-3">
                            {t("v2.changes", { count: data?.status === "ready" ? list.length : n })}
                          </span>
                          <span className="flex-1" />
                          <span className="whitespace-nowrap text-xs font-medium text-cz-accent-t">{open ? t("v2.close") : t("v2.open")}</span>
                        </button>
                        {open && (
                          <div className="mb-2.5 rounded-cz border border-cz-border px-3.5 py-1" aria-busy={data?.status === "loading" || undefined}>
                            {data?.status === "ready" ? (
                              list.length > 0
                                ? <AreaRowsB items={list} prefix={`m${m}`} {...lineProps} />
                                : <p className="py-2.5 text-[13px] text-cz-2">{t("v2.emptyWeekFiltered")}</p>
                            ) : data?.status === "error" ? (
                              <div className="flex items-center justify-between gap-3 py-2.5">
                                <span className="text-[13px] text-cz-2">{t("v2.monthError")}</span>
                                <Button size="sm" variant="secondary" onClick={() => loadMonth(m)}>{t("retry")}</Button>
                              </div>
                            ) : (
                              <div className="py-2.5"><SkeletonLines lines={3} /></div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {olderMonths.length > 0 && !olderOpen && (
                  <div className="flex items-baseline gap-2.5 border-t border-cz-border py-2.5">
                    <span className="text-[13.5px] font-medium text-cz-1">
                      {t("v2.olderMonths", { from: monthLabel(olderMonths[olderMonths.length - 1].m), to: monthLabel(olderMonths[0].m) })}
                    </span>
                    <span className="font-data text-2xs uppercase tabular-nums tracking-[.08em] text-cz-3">
                      {t("v2.changes", { count: olderMonths.reduce((s, x) => s + x.n, 0) })}
                    </span>
                    <span className="flex-1" />
                    <QuietButton chevron="down" onClick={() => toggle("months:older")}>{t("v2.showMonths")}</QuietButton>
                  </div>
                )}
              </div>
            )}
          </Section>
        </SectionStack>
      )}
    </div>
  );
}
