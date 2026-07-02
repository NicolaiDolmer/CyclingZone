// RiderInterestTab — Interesse-fanen (#2000): én-linjes opsummering, stat-kort
// (Følger · Profilvisninger · Scoutet af), "Hvem scouter din rytter?" (kun egen
// rytter) og et aktivitetsfeed.
//
// ALT er ægte data (verificeret mod prod 2026-07-03):
//   Følger          = rider_watchlist-count (eksisterende endpoint)
//   Profilvisninger = unikke besøgende 7d + trend (eksisterende view-count, #957)
//   Scoutet af      = distinkte hold med scout_actions (nyt /interest-endpoint)
//   Feed            = scout- og watchlist-events med ægte datoer + visnings-trend
//
// Privacy: scout-team-navne kommer KUN fra backend når vieweren ejer rytteren;
// fremmede ser anonymiserede events ("En rival scoutede ham") — bevidst afvigelse
// fra prototypens navngivne feed, jf. scouting-skjulet. Ingen bud-timeline her:
// bud lever i Historik-fanen (BUD-rækker) og hero'ens bid-panel.

import { useTranslation } from "react-i18next";
import { StarIcon, EyeIcon, SearchIcon } from "../../ui";
import { formatDate, formatNumber } from "../../../lib/intl.js";

function TrendSub({ pct, t }) {
  if (pct == null) return <span className="text-[11px] text-cz-3">{t("profile.interest.trendNew")}</span>;
  if (pct === 0) return <span className="text-[11px] text-cz-3">{t("profile.interest.trendFlat")}</span>;
  const up = pct > 0;
  return (
    <span className={`text-[11px] font-semibold ${up ? "text-cz-success" : "text-cz-danger"}`}>
      {up ? "▴" : "▾"} {Math.abs(pct)}%
    </span>
  );
}

function FeedIcon({ type }) {
  const cls = "flex-shrink-0 text-cz-3";
  if (type === "scout") return <SearchIcon size={15} aria-hidden="true" className={cls} />;
  if (type === "watch") return <StarIcon size={15} aria-hidden="true" className={cls} />;
  return <EyeIcon size={15} aria-hidden="true" className={cls} />;
}

export default function RiderInterestTab({ viewer = "own", watchlistCount = 0, visits = null, interest }) {
  const { t } = useTranslation("rider");

  // null = /interest-fetch undervejs (samme loading-gate som Udvikling-fanen).
  // role="status": gyldig aria-label + skærmlæser-annoncering af load-tilstanden.
  if (interest == null) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5 flex items-center justify-center py-10">
        <div role="status" className="w-5 h-5 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" aria-label={t("profile.interest.loading")} />
      </div>
    );
  }

  // Fetch-fejl vises eksplicit — nuller ville lyve om interessen (#1338-princippet).
  if (interest.error) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8 m-0">{t("profile.interest.loadError")}</p>
      </div>
    );
  }

  const isOwn = viewer === "own";
  const scoutedBy = interest.scouted_by_count ?? 0;
  const views7d = visits?.views7d ?? 0;
  const trendPct = visits?.isNew ? null : visits?.trend7dPct ?? null;

  const hasAnyInterest = watchlistCount > 0 || scoutedBy > 0 || views7d > 0;
  const summary = !hasAnyInterest
    ? t(`profile.interest.summary.${isOwn ? "own" : "scouting"}Quiet`)
    : t(`profile.interest.summary.${isOwn ? "own" : "scouting"}`, { followers: watchlistCount, scouted: scoutedBy, views: views7d });

  const statDefs = [
    { key: "followers", icon: StarIcon, value: watchlistCount, sub: <span className="text-[11px] text-cz-3">{t("profile.interest.followersSub", { count: watchlistCount })}</span> },
    { key: "views7d", icon: EyeIcon, value: views7d, sub: <TrendSub pct={trendPct} t={t} /> },
    { key: "scoutedBy", icon: SearchIcon, value: scoutedBy, sub: <span className="text-[11px] text-cz-3">{t("profile.interest.scoutedBySub", { count: scoutedBy })}</span> },
  ];

  // Visnings-trend som øverste feed-linje (beskriver "nu", har ingen event-dato).
  const feed = [
    ...(trendPct != null && trendPct !== 0
      ? [{ type: "views", key: "views-trend", text: t("profile.interest.feed.viewsTrend", { pct: `${trendPct > 0 ? "+" : ""}${trendPct}` }), meta: t("profile.interest.feed.viewsTrendMeta") }]
      : []),
    ...(interest.feed ?? []).map((e, i) => ({
      type: e.type,
      key: `${e.type}-${e.date}-${i}`,
      text: e.type === "scout"
        ? (e.team_name
            ? t("profile.interest.feed.scout", { team: e.team_name })
            : t("profile.interest.feed.scoutAnon"))
        : t("profile.interest.feed.watch"),
      meta: [e.season != null ? t("profile.interest.seasonShort", { n: e.season }) : null, e.date ? formatDate(e.date, null, { day: "numeric", month: "short" }) : null]
        .filter(Boolean).join(" · "),
    })),
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="bg-cz-card border border-cz-border border-l-2 border-l-cz-accent rounded-cz py-[15px] px-[17px]">
        <p className="m-0 text-[13px] text-cz-1 leading-normal">{summary}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[13px]">
        {statDefs.map((s) => (
          <div key={s.key} className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cz-3">
              <s.icon size={14} aria-hidden="true" />
              {t(`profile.interest.stats.${s.key}`)}
            </span>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono tabular-nums text-xl font-bold text-cz-1">{formatNumber(s.value)}</span>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {isOwn && (
        <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
          <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-2">
            {t("profile.interest.whoScouts.title")}
          </h3>
          {(interest.scouts ?? []).length === 0 ? (
            <p className="m-0 text-xs text-cz-2 leading-relaxed">{t("profile.interest.whoScouts.empty")}</p>
          ) : (
            <>
              <p className="m-0 mb-1 text-xs text-cz-2 leading-relaxed">
                {t("profile.interest.whoScouts.body", { count: interest.scouts.length })}
              </p>
              {interest.scouts.map((s) => (
                <div key={s.team_id} className="flex items-center gap-2.5 py-2 min-h-[44px] border-t border-cz-border">
                  <SearchIcon size={15} aria-hidden="true" className="text-cz-3 flex-shrink-0" />
                  <span className="flex-1 text-[12.5px] text-cz-1 truncate">{s.team_name ?? t("bids.row.teamFallback")}</span>
                  <span className="text-[11px] text-cz-3 whitespace-nowrap">
                    {t("profile.interest.whoScouts.level", { level: s.level })}
                    {s.season != null ? ` · ${t("profile.interest.seasonShort", { n: s.season })}` : ""}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className="px-[17px] py-2.5 border-b border-cz-border">
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-3">
            {t("profile.interest.feed.title")}
          </span>
        </div>
        {feed.length === 0 ? (
          <p className="text-cz-3 text-center py-8 m-0">{t("profile.interest.feed.empty")}</p>
        ) : (
          feed.map((e, i) => (
            <div key={e.key} className={`flex items-center gap-3 px-[17px] py-3 ${i > 0 ? "border-t border-cz-border" : ""}`}>
              <FeedIcon type={e.type} />
              <span className="flex-1 text-[12.5px] text-cz-1 min-w-0 truncate">{e.text}</span>
              <span className="text-[11px] text-cz-3 whitespace-nowrap">{e.meta}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
