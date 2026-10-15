// #6514 · Løbskortet i Planlægning → Kalender (bag race_library_v2).
//
// Ejer-beslutning 15/10: klik/hold på et løb åbner et lille kort med
// etapestrimmel (farve pr. profile_type, INGEN samlet km), hvad løbet afgøres
// i, "passer til holdet" 0-100 + bedste bud, min status og én guld-knap til
// udtagelsen. "Åbn løbet" fører til løbssiden som i dag. Kalenderens visning er
// ellers uændret.
//
// Kortet er UI-kittets Modal (PAGE_TEMPLATES: ingen ny dialog-markup). Al
// regning bor i lib/racePeek.js (ren, testet); denne fil er render + IO.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase, authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import {
  stripSegments, decidedIn, groupColor, bucketGroup, raceDateRange, teamFit, selectionHref,
} from "../../lib/racePeek.js";
import { Modal, StatusBadge, Skeleton, SkeletonLines } from "../ui";
import { buttonClass } from "../ui/buttonStyles.js";

// Sæsonmatrixens svar pr. sæson (trup + rute-match pr. løb). Hentes først når et
// kort for holdets eget løb åbnes, og kun én gang pr. sæson pr. sideindlæsning.
const seasonFitCache = new Map();
function loadSeasonFit(seasonNumber) {
  const key = String(seasonNumber ?? "active");
  if (!seasonFitCache.has(key)) {
    const p = (async () => {
      const headers = await authHeaders({ json: false });
      if (!headers) return null;
      const qs = Number.isFinite(seasonNumber) ? `?season_number=${seasonNumber}` : "";
      const res = await apiFetch(`/api/races/selection/season${qs}`, { headers });
      return res.ok && res.data?.enabled ? res.data : null;
    })().catch(() => null);
    p.then((v) => { if (!v) seasonFitCache.delete(key); });
    seasonFitCache.set(key, p);
  }
  return seasonFitCache.get(key);
}

const STATUS_BADGE = { missing: "closing", selected: "won", gtBound: "info" };

export default function RacePeekCard({ entry, status, days, seasonNumber, t, locale, onClose }) {
  const open = entry != null;
  const raceId = entry?.id ?? null;
  const [profiles, setProfiles] = useState(null); // null = henter
  const [fitData, setFitData] = useState(undefined); // undefined = henter, null = intet

  useEffect(() => {
    if (!raceId) return undefined;
    let alive = true;
    setProfiles(null);
    // pagination-safe: filtreret på ét race_id, højst én række pr. etape.
    supabase.from("race_stage_profiles").select("stage_number, profile_type").eq("race_id", raceId).order("stage_number")
      .then(({ data, error }) => { if (alive) setProfiles(error ? [] : data || []); },
        () => { if (alive) setProfiles([]); });
    return () => { alive = false; };
  }, [raceId]);

  const mine = Boolean(entry?.isMine);
  useEffect(() => {
    if (!raceId || !mine) { setFitData(null); return undefined; }
    let alive = true;
    setFitData(undefined);
    loadSeasonFit(seasonNumber).then((d) => { if (alive) setFitData(d); });
    return () => { alive = false; };
  }, [raceId, mine, seasonNumber]);

  // Strimlen: race_stage_profiles; mangler de, falder kortet tilbage til
  // kalenderens egen terræn-bucket pr. etape (aldrig et tomt kort).
  const segments = useMemo(() => {
    if (!entry) return [];
    if (profiles && profiles.length) return stripSegments(profiles);
    const sched = (entry.stageSchedule || []).slice().sort((a, b) => a.stage - b.stage);
    if (sched.length) return sched.map((s) => ({ stage: s.stage, profileType: null, group: bucketGroup(s.terrain) }));
    return entry.terrain ? [{ stage: 1, profileType: null, group: bucketGroup(entry.terrain) }] : [];
  }, [entry, profiles]);

  const decided = useMemo(() => decidedIn(segments.map((s) => s.group)), [segments]);

  const fit = useMemo(() => {
    if (!fitData || !raceId) return null;
    const race = (fitData.races || []).find((r) => r.id === raceId);
    if (!race) return null;
    return teamFit({ demandVector: race.demandVector, riders: fitData.riders, size: race.sizeMax });
  }, [fitData, raceId]);

  if (!open) return null;

  const range = raceDateRange(entry);
  const isStageRace = entry.raceType === "stage_race";
  const meta = [
    isStageRace ? t("peek.stages", { count: entry.stages }) : t("peek.oneDay"),
    range ? formatRange(range, locale) : null,
    entry.poolLabel,
  ].filter(Boolean).join(" · ");

  const raceHref = `/races/${entry.id}`;
  const canPick = mine && (status === "missing" || status === "selected" || status === "gtBound");
  const stripLabel = segments.map((s) => t("peek.stageItem", { n: s.stage, type: t(`peek.group.${s.group}`) })).join(", ");
  const showCount = segments.length > 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry.name}
      description={meta}
      closeLabel={t("common:actions.close")}
      size="sm"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to={raceHref} className={buttonClass({ variant: "secondary", size: "sm" })} onClick={onClose}>
            {t("peek.openRace")}
          </Link>
          {canPick && (
            <Link to={selectionHref(range?.start, days)} className={buttonClass({ variant: "primary", size: "sm" })} onClick={onClose}>
              {status === "selected" ? t("peek.editSquad") : t("peek.pick")}
            </Link>
          )}
        </div>
      )}
    >
      <div className="space-y-4" data-testid="race-peek-card">
        {profiles === null ? (
          <SkeletonLines lines={1} />
        ) : (
          <div role="img" aria-label={t("peek.stripAria", { list: stripLabel })} className="flex h-2.5 gap-px" data-testid="race-peek-strip">
            {segments.map((s) => (
              <span key={s.stage} className="min-w-0 flex-1" style={{ backgroundColor: groupColor(s.group) }}
                title={t("peek.stageItem", { n: s.stage, type: t(`peek.group.${s.group}`) })} />
            ))}
          </div>
        )}

        <dl className="divide-y divide-cz-border text-[13px]">
          <Row label={t("peek.decidedIn")}>
            {profiles === null ? <Skeleton className="ms-auto h-3 w-20" /> : decided.length === 0 ? (
              <span className="text-cz-3">{t("peek.noProfile")}</span>
            ) : (
              <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
                {decided.map((d, i) => (
                  <span key={d.group} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-cz-3" aria-hidden="true">+</span>}
                    <span aria-hidden="true" className="h-2 w-2 shrink-0" style={{ backgroundColor: groupColor(d.group) }} />
                    <span className="text-cz-1">
                      {t(`peek.group.${d.group}`)}
                      {showCount && <span className="font-data tabular-nums text-cz-2"> ({d.count})</span>}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </Row>
          {mine && (
            <Row label={t("peek.teamFit")}>
              {fitData === undefined ? <Skeleton className="ms-auto h-3 w-20" /> : fit ? (
                <span className="text-right">
                  <span className="font-data font-semibold tabular-nums text-cz-1">{fit.score}</span>
                  <span className="font-data tabular-nums text-cz-3">/100</span>
                  <span className="block text-2xs text-cz-2">
                    {t("peek.bestBet", { name: fit.best.name, score: fit.best.score })}
                  </span>
                </span>
              ) : <span className="text-cz-3">{t("peek.fitUnavailable")}</span>}
            </Row>
          )}
          {status && (
            <Row label={t("peek.status.label")}>
              <StatusBadge state={STATUS_BADGE[status]}>{t(`peek.status.${status}`)}</StatusBadge>
            </Row>
          )}
        </dl>
      </div>
    </Modal>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-cz-2">{label}</dt>
      <dd className="m-0 min-w-0 text-right">{children}</dd>
    </div>
  );
}

// "18.-25. okt." / "18-25 Oct": Intl's egen interval-formattering, Europe/Copenhagen.
function formatRange({ start, end }, locale) {
  const toDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  };
  const fmt = new Intl.DateTimeFormat(locale || "en", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short" });
  if (start === end || typeof fmt.formatRange !== "function") return fmt.format(toDate(start));
  return fmt.formatRange(toDate(start), toDate(end));
}
