// ScoutingCentralPage — Scouting-central (#2244 Fase 3 Slice C): spejder-kort,
// opgavekø (aktive målrettede opgaver + missioner), start-mission-form og
// shortlist-feed (afsluttede missioner). Gated bag scout_system_enabled
// (kill-switch, ikke beta-gate) — useScoutingCentral rapporterer `enabled`
// fra samme flag som /api/scouting/me.
//
// Rytternavne (target-rytter + mission-shortlists) hentes lazily via
// GET /api/riders/:id — /api/scouting/central returnerer kun rider_id-referencer
// (aldrig potentiale), så et separat opslag er nødvendigt for visningsnavn.
// Kendt kontrakt-hul (flagget i Slice C-rapporten): ingen batch-endpoint findes,
// så dette er én GET pr. unikt rytter-id, cached i denne sides levetid.
//
// TONE: al copy i public/locales/{en,da}/scouting.json er plain/factual v1
// (spec-beslutning: verdict-tone-session med ejer FØR ship er stadig åben,
// jf. spec §Åbne detaljer) — review pending, ingen påstået lore/tone endnu.
//
// #2849 bølge 6 (design-audit 2026-07-23, "ScoutingCentral"-rækken): flyttet på
// T1 (max-w-4xl, ingen egen container-padding — Layout leverer den globale
// gutter). Den lokale SectionCard-dublet er slettet til fordel for ui/Section +
// SectionHeader; alle ad hoc font-display-kort-titler ("eget editorial
// sub-brand") er normaliseret til kanonisk SectionHeader. Sidens EGET
// editoriale sidehoved (Bebas + border-b-bånd) er BEVARET uændret — det er
// samme ejer-godkendte opskrift som Klub/SeasonPlanner, ikke en ny fortolkning.
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  EmptyState, ErrorState, PageLoader, Button, Select,
  Section, SectionStack, SectionHeader, ChevronRightIcon,
} from "../components/ui";
import RiderLink from "../components/RiderLink";
import { useScoutingCentral } from "../lib/useScoutingCentral";
import { useRiderNames } from "../lib/useRiderNames";
import { daysUntil, missionCriteriaLabel } from "../lib/scoutingCentralDisplay";
import { useScoutCountdown, scoutReadyClock } from "../lib/scoutCountdown";
import { getCountryName } from "../lib/countryUtils";
import { ISO2_TO_IOC } from "../lib/countryCodes";
import { formatDate } from "../lib/intl";

const COUNTRY_CODES = Object.keys(ISO2_TO_IOC);

function ScoutCard({ scout, capacity, t }) {
  const isDefault = scout?.isDefault !== false;
  return (
    <Section>
      <SectionHeader title={t("scoutCard.eyebrow")} />
      {isDefault ? (
        <>
          <h3 className="font-display text-[21px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
            {t("scoutCard.defaultTitle")}
          </h3>
          <p className="text-cz-2 text-[12.5px] leading-[1.55] mt-2 mb-0 max-w-prose">
            {t("scoutCard.defaultBody", { overall: scout?.overall ?? 40 })}
          </p>
        </>
      ) : (
        <>
          <h3 className="font-display text-[21px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
            {scout.name}
          </h3>
          <p className="text-cz-2 text-[12.5px] mt-1 mb-0">
            {t("scoutCard.ratingLabel")}: <span className="font-mono text-cz-1">{scout.overall}</span>
          </p>
        </>
      )}
      <p className="text-cz-3 text-2xs mt-3 pt-2.5 border-t border-cz-border mb-0">
        {t("scoutCard.capacityLabel", { capacity })}
      </p>
      {/* #2580: forebygger "byggede niveau 1, forventede 2 missioner"-forvirringen —
          kapacitet 2 kræver spejderens overall≥80, ikke blot en købt facilitets-tier. */}
      {capacity < 2 && (
        <p className="text-cz-3 text-3xs mt-1 mb-0">{t("scoutCard.capacityHintLocked")}</p>
      )}
    </Section>
  );
}

// Én række i opgavekøen. Egen komponent fordi målrettede opgaver nu tæller ned
// (#3548) og useScoutCountdown derfor skal kaldes pr. række — en hook kan ikke
// kaldes inde i en .map()-callback.
function ActiveJobRow({ assignment: a, riderNames, onCancel, cancellingId, jobConfig, t }) {
  // #3548: serveren leverer ready_at (created_at + etaMinutes) på aktive
  // målrettede opgaver. Missioner har intet minut-granulært klar-tidspunkt —
  // de modnes af den natlige 22-sweep — så de sender null ind og beholder den
  // dags-baserede copy nedenfor.
  const countdown = useScoutCountdown(a.kind === "target" ? (a.ready_at ?? null) : null);
  const readyClock = a.kind === "target" ? scoutReadyClock(a.ready_at) : null;

  const label = a.kind === "target"
    ? (riderNames[a.rider_id] ?? t("queue.loadingRider"))
    : missionCriteriaLabel(a.mission_criteria, {
        translateScope: (s) => t(`mission.scope.${s}`),
        translateCountry: (code) => getCountryName(code),
      });

  // #2644: målrettede undersøgelser svarer på ~30 min uanset niveau — den
  // dags-baserede reportIn/-Today bruges stadig til missioner (2 dage).
  // #3548: har rækken et ready_at, tæller den ned mod det; ellers falder den
  // tilbage til den gamle flade ETA-copy (ældre payload uden feltet).
  let reportLabel;
  if (a.kind !== "target") {
    reportLabel = daysUntil(a.ready_on) > 0
      ? t("queue.reportIn", { days: daysUntil(a.ready_on) })
      : t("queue.reportToday");
  } else if (!countdown) {
    reportLabel = t("queue.targetReportIn", { minutes: jobConfig?.targetEtaMinutes ?? 30 });
  } else if (countdown.state === "due") {
    reportLabel = t("queue.targetReportDue");
  } else {
    reportLabel = t("queue.targetReportCountdown", { minutes: countdown.minutes });
  }

  return (
    <li className="flex items-center justify-between gap-3 flex-wrap border-t border-cz-border pt-2.5 first:border-0 first:pt-0">
      <div>
        <span className="text-3xs font-mono uppercase tracking-[0.1em] text-cz-3">
          {t(a.kind === "target" ? "queue.kindTarget" : "queue.kindMission")}
        </span>
        {/* #3046: målrettede opgaver kender rytterens id — link til profilen
            i stedet for statisk tekst. Missioner har intet enkelt rytter-id
            (kriteriet er et scope), så de forbliver ren tekst. */}
        <p className="text-cz-1 text-[13px] m-0 mt-0.5">
          {a.kind === "target" ? (
            <RiderLink id={a.rider_id} className="hover:text-cz-accent-t transition-colors">
              {label}
            </RiderLink>
          ) : label}
        </p>
        <p
          className="text-cz-2 text-2xs m-0 mt-0.5 tabular-nums"
          title={readyClock ? t("queue.targetReadyAtTitle", { time: readyClock }) : undefined}
        >
          {reportLabel}
        </p>
      </div>
      <Button
        variant="ghost" size="sm"
        loading={cancellingId === a.id}
        onClick={() => onCancel(a.id)}
      >
        {t("queue.cancel")}
      </Button>
    </li>
  );
}

function ActiveQueue({ active, riderNames, onCancel, cancellingId, jobConfig, t }) {
  if (active.length === 0) {
    return (
      <Section>
        <SectionHeader title={t("queue.title")} />
        <p className="text-cz-3 text-[12.5px] m-0">{t("queue.empty")}</p>
      </Section>
    );
  }
  return (
    <Section>
      <SectionHeader title={t("queue.title")} />
      <ul className="list-none p-0 m-0 space-y-2.5">
        {active.map((a) => (
          <ActiveJobRow
            key={a.id}
            assignment={a}
            riderNames={riderNames}
            onCancel={onCancel}
            cancellingId={cancellingId}
            jobConfig={jobConfig}
            t={t}
          />
        ))}
      </ul>
    </Section>
  );
}

// #2644 del 2 (ejer-godkendt mockup, 18/7): targeting-valg-kort — radio-adfærd,
// ét valgt ad gangen. Native radio (sr-only) under en styled <label> for a11y/
// keyboard uden at give afkald på card-visuallet.
function TargetPoolCard({ id, name, title, subtitle, recommended, selected, onSelect, t }) {
  return (
    <label
      htmlFor={id}
      className={`flex-1 min-w-[190px] cursor-pointer rounded-cz border-2 px-3 py-2.5 transition-colors ${
        selected ? "border-cz-1 bg-cz-subtle" : "border-cz-border bg-cz-card hover:border-cz-3"
      }`}
    >
      <input
        type="radio" id={id} name={name} className="sr-only"
        checked={selected} onChange={onSelect}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[14px] leading-none tracking-[0.02em] uppercase text-cz-1">
          {title}
        </span>
        {recommended && (
          <span
            className="text-3xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-cz-pill shrink-0 bg-cz-accent text-cz-on-accent"
          >
            {t("mission.form.recommended")}
          </span>
        )}
      </div>
      <p className="text-cz-3 text-2xs mt-1.5 mb-0 leading-snug">{subtitle}</p>
    </label>
  );
}

function MissionForm({ onSubmit, busy, jobConfig, t }) {
  const [scope, setScope] = useState("u23");
  const [country, setCountry] = useState(COUNTRY_CODES[0] ?? "dk");
  const [targetPool, setTargetPool] = useState("free_agents");
  const [result, setResult] = useState(null);

  const needsCountry = scope === "country" || scope === "nm";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResult(null);
    const criteria = needsCountry ? { scope, value: country, targetPool } : { scope, targetPool };
    const r = await onSubmit(criteria);
    setResult(r);
  };

  return (
    <Section>
      <SectionHeader title={t("mission.form.title")} />
      <p className="text-cz-2 text-2xs mt-1 mb-2.5">{t("mission.form.subtitle")}</p>

      {/* #2644 del 2: targeting-valg — kontraktfrie (default/anbefalet) vs.
          ryttere på andre managers hold. */}
      <div
        role="radiogroup"
        aria-label={t("mission.form.targetPoolLabel")}
        className="flex gap-2.5 flex-wrap mb-1"
      >
        <TargetPoolCard
          id="target-pool-free-agents" name="targetPool" t={t}
          title={t("mission.form.pool.freeAgents.title")}
          subtitle={t("mission.form.pool.freeAgents.subtitle")}
          recommended
          selected={targetPool === "free_agents"}
          onSelect={() => setTargetPool("free_agents")}
        />
        <TargetPoolCard
          id="target-pool-other-teams" name="targetPool" t={t}
          title={t("mission.form.pool.otherTeams.title")}
          subtitle={t("mission.form.pool.otherTeams.subtitle")}
          selected={targetPool === "other_teams"}
          onSelect={() => setTargetPool("other_teams")}
        />
      </div>
      <p className="text-cz-3 text-2xs mt-1.5 mb-3">{t("mission.form.existenceGuarantee")}</p>
      <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-cz-3 text-3xs uppercase tracking-wider mb-1">{t("mission.form.scopeLabel")}</label>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="u23">{t("mission.scope.u23")}</option>
            <option value="country">{t("mission.scope.country")}</option>
            <option value="nm">{t("mission.scope.nm")}</option>
          </Select>
        </div>
        {needsCountry && (
          <div>
            <label className="block text-cz-3 text-3xs uppercase tracking-wider mb-1">{t("mission.form.countryLabel")}</label>
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{getCountryName(code)}</option>
              ))}
            </Select>
          </div>
        )}
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {t("mission.form.submit")}
        </Button>
      </form>
      {/* Varighed/pris fra jobConfig (SSOT: backend scoutEngine.SCOUT_JOB_CONFIG); fallbacks dækker kun før første fetch. */}
      <p className="text-cz-3 text-3xs mt-2.5 mb-0">
        {t("mission.form.costNote", { days: jobConfig?.missionDays ?? 14, cost: jobConfig?.missionCost ?? 6000 })}
      </p>
      {result && !result.ok && (
        <p className="text-cz-warning text-[12px] mt-2 mb-0">
          {t(`error.${result.error}`, { defaultValue: t("error.failed") })}
        </p>
      )}
    </Section>
  );
}

function ShortlistFeed({ completed, riderNames, t }) {
  const missions = completed.filter((c) => c.kind === "mission" && c.result?.shortlist?.length);
  if (missions.length === 0) {
    return (
      <Section>
        <SectionHeader title={t("shortlist.title")} />
        <p className="text-cz-3 text-[12.5px] m-0">{t("shortlist.empty")}</p>
      </Section>
    );
  }
  return (
    <Section>
      <SectionHeader title={t("shortlist.title")} />
      <ul className="list-none p-0 m-0 space-y-3">
        {missions.slice(0, 10).map((m) => (
          <li key={m.id} className="border-t border-cz-border pt-2.5 first:border-0 first:pt-0">
            <p className="text-cz-3 text-2xs font-mono uppercase tracking-[0.08em] m-0">
              {missionCriteriaLabel(m.mission_criteria, {
                translateScope: (s) => t(`mission.scope.${s}`),
                translateCountry: (code) => getCountryName(code),
              })}
            </p>
            <ul className="list-none p-0 m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {m.result.shortlist.map((riderId) => {
                // #2644 beslutning 4: rytterens NUVÆRENDE status (kontraktfri /
                // holdnavn) — serveren har allerede fjernet skjulte/usøgbare
                // ryttere (scoutReportVisibility.js), så alt her er reelt synligt.
                const status = m.riderStatus?.[riderId];
                const statusLabel = status?.status === "team"
                  ? status.teamName
                  : status?.status === "free_agent"
                    ? t("shortlist.statusFreeAgent")
                    : null;
                return (
                  <li key={riderId} className="text-cz-1 text-[13px]">
                    <RiderLink id={riderId} className="hover:text-cz-accent-t transition-colors">
                      {riderNames[riderId] ?? t("queue.loadingRider")}
                    </RiderLink>
                    {statusLabel && (
                      <span className="ms-1.5 text-2xs text-cz-3">· {statusLabel}</span>
                    )}
                    {riderId === m.result.top_rider_id && (
                      <span className="ms-1.5 text-3xs font-mono uppercase tracking-[0.08em] text-cz-accent-t">
                        {t("shortlist.topFind")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// #2721 — samlet liste over ryttere HOLDET har scoutet, uafhængigt af hvilken
// scout der gjorde det (ejer-løfte 4/8, Discord: "so you can see all riders
// scouted by your team in there as well"). Historik PR. scout findes allerede
// (#3203, StaffScoutHistoryTab); dette er den holds-brede pendant.
//
// Ingen ny fetch nødvendig — `completed` er ALLEREDE hentet holds-bredt af
// GET /api/scouting/central (getScoutState → loadCompletedAssignments, capped
// til 20 nyeste, samme grænse som resten af siden bruger), og
// hydrateCompletedVisibility har allerede fjernet ryttere der er blevet
// skjulte/utilgængelige siden rapporten blev lavet (#2644). Vi filtrerer blot
// til kind==='target' (individuel-rytter-undersøgelser) — mission-shortlists
// vises allerede ovenfor i ShortlistFeed.
function TeamScoutHistory({ completed, riderNames, t }) {
  const investigations = completed.filter((c) => c.kind === "target");
  if (investigations.length === 0) {
    return (
      <Section>
        <SectionHeader title={t("teamHistory.title")} />
        <p className="text-cz-3 text-[12.5px] m-0">{t("teamHistory.empty")}</p>
      </Section>
    );
  }
  return (
    <Section>
      <SectionHeader title={t("teamHistory.title")} />
      <p className="text-cz-3 text-2xs mb-3">{t("teamHistory.subtitle")}</p>
      <ul className="list-none p-0 m-0 space-y-2">
        {investigations.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 border-t border-cz-border pt-2 first:border-0 first:pt-0">
            <span className="text-cz-1 text-[13px] min-w-0 truncate">
              {row.rider_id ? (
                <RiderLink id={row.rider_id} tab="scouting" className="hover:text-cz-accent-t transition-colors">
                  {riderNames[row.rider_id] ?? t("queue.loadingRider")}
                </RiderLink>
              ) : (
                <span className="text-cz-3">{t("teamHistory.riderUnavailable")}</span>
              )}
            </span>
            <span className="text-cz-3 text-2xs font-mono tabular-nums flex-none whitespace-nowrap">
              {t("teamHistory.levelValue", { level: row.target_level })}
              {" · "}
              {formatDate(row.completed_at, null, { day: "2-digit", month: "2-digit", year: "2-digit" })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function ScoutingCentralPage() {
  const { t } = useTranslation("scouting");
  const navigate = useNavigate();
  const central = useScoutingCentral();
  const [cancellingId, setCancellingId] = useState(null);

  const targetRiderIds = central.active.filter((a) => a.kind === "target").map((a) => a.rider_id);
  const shortlistRiderIds = central.completed
    .filter((c) => c.kind === "mission")
    .flatMap((c) => c.result?.shortlist ?? []);
  // #2721: team-historikkens rytter-id'er skal med i samme batch-navneopslag.
  const historyRiderIds = central.completed
    .filter((c) => c.kind === "target")
    .map((c) => c.rider_id)
    .filter(Boolean);
  const riderNames = useRiderNames([...new Set([...targetRiderIds, ...shortlistRiderIds, ...historyRiderIds])]);

  const handleCancel = useCallback(async (id) => {
    setCancellingId(id);
    await central.cancelAssignment(id);
    setCancellingId(null);
  }, [central]);

  if (central.loading) return <PageLoader />;

  // #2849 bølge 6 (audit-fund "manglende fejltilstand"): en fejlet
  // /api/scouting/central-hentning efterlod tidligere siden i en tavs
  // tom-tilstand (scout=null, ingen kø, ingen shortlist) — umuligt at skelne
  // fra "du har ikke startet noget endnu". Canonical ErrorState + retry (via
  // hookens refresh) i stedet.
  if (central.error) {
    return (
      <div className="max-w-4xl mx-auto">
        <ErrorState
          title={t("error.load.title")}
          description={t("error.load.description")}
          action={<Button size="sm" variant="secondary" onClick={central.refresh}>{t("error.load.retry")}</Button>}
        />
      </div>
    );
  }

  if (!central.enabled) {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4">
        <div>
          <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
          <p className="text-[12px] text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
        </div>
        {central.scout?.id && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12px] text-cz-2 hover:text-cz-1"
            onClick={() => navigate(`/staff/${central.scout.id}`)}
          >
            {t("scoutCard.viewProfile")}
            <ChevronRightIcon size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      <SectionStack>
        <ScoutCard scout={central.scout} capacity={central.capacity} t={t} />
        <ActiveQueue active={central.active} riderNames={riderNames} onCancel={handleCancel} cancellingId={cancellingId} jobConfig={central.jobConfig} t={t} />
        <MissionForm onSubmit={central.startMission} busy={central.busy} jobConfig={central.jobConfig} t={t} />
        <ShortlistFeed completed={central.completed} riderNames={riderNames} t={t} />
        <TeamScoutHistory completed={central.completed} riderNames={riderNames} t={t} />
      </SectionStack>
    </div>
  );
}
