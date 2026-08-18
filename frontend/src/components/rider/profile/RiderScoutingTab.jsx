// RiderScoutingTab — Scouting-fanen på rytterprofilen (#1543 Fase 1).
//
// Viser den server-beregnede scouting-rapport (GET /api/riders/:id/scouting-report):
//   • Scout verdict — klart sprog ("Din spejders vurdering" / "Talentspejder-
//     rapport"), confidence-chip og 4 understøttende faktorer. Ingen jargon.
//   • Potentiale pr. ryttertype — nuværende rating + skraveret PROGNOSE-BÅND pr. type
//     (#3746: hvor rytteren realistisk lander med træning, ikke et loft). Prognosen
//     er ALTID et bånd (#1543 beslutning 3: ingen når 100% præcision, heller
//     ikke på egne ryttere — beslutning 4).
//   • Røverkøb? — markedsværdi vs. modellens forventede værdi; kun sammenligningen
//     og en one-line read, INGEN verdict-label (design-SSOT).
// Rå potentiale/ability_caps findes ALDRIG i klienten (#1162) — alt er bånd.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PotentialeStars from "../../PotentialeStars";
import { SearchIcon, CheckIcon } from "../../ui";
import { getSession } from "../../../lib/supabase";
import { formatCz } from "../../../lib/marketValues";
import { statPlateStyle } from "../../../lib/statColor";
import { useScoutCountdown, scoutReadyClock } from "../../../lib/scoutCountdown";

const API = import.meta.env.VITE_API_URL;

// Samme spektrum-orden som Overblik-radarens akser (flade spurtere → klatrere).
const TYPE_ORDER = [
  "sprinter", "puncheur", "brostensrytter", "baroudeur",
  "rouleur", "tt", "gc", "climber",
];

const CONFIDENCE_STYLE = {
  high: "bg-cz-success-bg text-cz-success border-cz-success/30",
  medium: "bg-cz-subtle text-cz-2 border-cz-border",
  low: "bg-cz-warning-bg text-cz-warning border-cz-warning/30",
};

function SectionCard({ children }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return (
    <span className="font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-accent-t">
      {children}
    </span>
  );
}

// Barens fulde længde i rating-point.
//
// #3666: ABSOLUT, ikke en populations-percentil. Det var 0,99 som et bart tal i
// bredde-udtrykket før. Værdien er den samme, men grunden til den skal stå et
// sted: baren viser en MAGNITUDE (og et loft, som går højere end nogen nuværende
// rating), så den må ikke skaleres efter hvor bestanden tilfældigvis ligger —
// ellers flytter en rytters bar sig fordi ANDRE ryttere har ændret sig, hvilket
// er præcis den egenskab omlægningen fjernede fra selve ratingen.
//
// Overblik-radaren bruger 0-85 med en IKKE-LINEÆR (sqrt) mapping i stedet
// (#3707, ikke 99, men heller ikke det tidligere lineære 0-40, som klampede
// alsidige toprytteres akser falsk til "maksimal i alt"). Det er ikke en
// modsigelse: radaren sammenligner otte rollers FORM mod hinanden på én
// rytter, hvor et fælles LINEÆRT 0-99-domæne enten ville klemme polygonen
// sammen til en prik for de fleste (spændet mellem en typisk lav akse og
// spillets loft er en faktor ~28) eller klampe toppen falsk. Baren her
// sammenligner niveau mod loft på én lineær akse hvor loftet skal kunne
// være med, og der er kun én værdi pr. rytter, ikke otte samtidig, så
// samme spænd-problem opstår ikke her.
const BAR_SCALE_MAX = 99;
const barPct = (v) => `${(Math.max(0, Math.min(BAR_SCALE_MAX, v)) / BAR_SCALE_MAX) * 100}%`;

// Én ryttertype-række: navn · bar (nu-fyld + skraveret prognose-bånd) · nu / prognose-tal.
// #3746: progLo/progHi er prognose-båndets navn; ceilLo/ceilHi er en alias
// (samme tal) for ældre klient-cache — se backend/routes/api.js.
// Overgangs-designet (ejer 18/8): loft-mærket (lodret streg) markerer rollens
// loft på samme lineære akse som nu-fyldet og prognose-båndet — det gamle tal
// er bevaret i fladen, prognosen er det nye ved siden af. `loft` kan mangle i
// ældre payloads → intet mærke (graceful).
function LoftTick({ loft }) {
  if (!Number.isFinite(loft)) return null;
  return (
    <div
      className="absolute inset-y-0 w-[2px] bg-cz-2"
      style={{ left: `calc(${barPct(loft)} - 1px)` }}
      data-loft-tick={loft}
    />
  );
}

function TypeRow({ typeKey, now, progLo, progHi, loft, label }) {
  return (
    <div className="flex items-center gap-3" data-type={typeKey}>
      <span className="w-[110px] flex-shrink-0 text-[12px] text-cz-2 truncate">{label}</span>
      <div className="relative flex-1 h-[7px] rounded-full bg-cz-subtle overflow-hidden" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-cz-accent rounded-full" style={{ width: barPct(now) }} />
        <div
          className="absolute inset-y-0 bg-cz-accent/25 border-x border-cz-accent/50"
          style={{ left: barPct(progLo), width: `calc(${barPct(progHi)} - ${barPct(progLo)})` }}
        />
        <LoftTick loft={loft} />
      </div>
      <span className="w-[86px] flex-shrink-0 text-right font-mono tabular-nums text-2xs">
        <span className="text-cz-1 font-bold">{now}</span>
        <span className="text-cz-3"> · {progLo}–{progHi}</span>
      </span>
    </div>
  );
}

// Rytterens EGEN rolle, stort (spec §D4). De øvrige syv er kontekst; denne ene er
// svaret på "hvor god er han, og hvor god kan han blive". Ratingen bruger den
// DELTE statPlateStyle, så tallet her og tallet i heroen er samme plade — de er
// samme tal, og må ikke kunne se forskellige ud.
// #3746: progLo/progHi + progressionLabel — se TypeRow.
function PrimaryTypeRow({ typeKey, now, progLo, progHi, loft, label, roleLabel, progressionLabel, loftLabel }) {
  return (
    <div data-type={typeKey} className="border-b border-cz-border pb-3.5 mb-3.5">
      <span className="font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-3">
        {roleLabel}
      </span>
      <div className="flex items-center gap-3 mt-1.5">
        <span
          className="inline-flex items-center justify-center min-w-[42px] h-[32px] px-2 rounded-cz font-display text-[19px] tabular-nums"
          style={statPlateStyle(now)}
        >
          {now}
        </span>
        <span className="font-display text-[19px] leading-none tracking-[0.02em] uppercase text-cz-1">
          {label}
        </span>
        <span className="ms-auto text-right">
          <span className="block font-mono text-3xs uppercase tracking-[0.12em] text-cz-3">
            {progressionLabel}
          </span>
          <span className="block font-mono tabular-nums text-[15px] text-cz-1 mt-0.5">
            {progLo}–{progHi}
            {Number.isFinite(loft) && (
              <span className="text-cz-3 text-2xs" data-testid="scouting-primary-loft"> · {loftLabel}</span>
            )}
          </span>
        </span>
      </div>
      <div className="relative h-[11px] rounded-full bg-cz-subtle overflow-hidden mt-2.5" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-cz-accent rounded-full" style={{ width: barPct(now) }} />
        <div
          className="absolute inset-y-0 bg-cz-accent/25 border-x border-cz-accent/50"
          style={{ left: barPct(progLo), width: `calc(${barPct(progHi)} - ${barPct(progLo)})` }}
        />
        <LoftTick loft={loft} />
      </div>
    </div>
  );
}

// #3671 — hvad køber det næste scout-niveau? Tre tilstande, og ingen af dem må
// være tavse: der findes en gevinst, gevinsten er for lille til at kunne ses, og
// der er ikke flere niveauer at købe. Halvbredden vises som ± point, fordi det er
// den enhed båndet ovenfor står i — spilleren skal kunne holde de to sammen.
function PrecisionNote({ precision, t, lang }) {
  // Decimalskilletegnet skal følge sproget — "±4.3" er engelsk og stod som en
  // fejl midt i en dansk sætning. i18next interpolerer tallet råt, så det
  // formateres her.
  const round1 = (n) => (Math.round(n * 10) / 10).toLocaleString(lang || "en");
  const half = round1(precision.halfWidth);

  if (precision.nextHalfWidth == null) {
    return (
      <p className="text-cz-3 text-3xs mt-1.5 mb-0" data-precision="max">
        {t("profile.scouting.precisionAtMax", { half })}
      </p>
    );
  }
  if (precision.nextLevelIsUseless) {
    return (
      <p className="text-cz-warning text-3xs mt-1.5 mb-0" data-precision="useless">
        {t("profile.scouting.precisionUseless", { half })}
      </p>
    );
  }
  return (
    <p className="text-cz-3 text-3xs mt-1.5 mb-0" data-precision="gain">
      {t("profile.scouting.precisionNext", { half, next: round1(precision.nextHalfWidth) })}
    </p>
  );
}

export default function RiderScoutingTab({ rider, scouting }) {
  const { t, i18n } = useTranslation("rider");
  const { t: tTypes } = useTranslation("riderTypes");
  const [report, setReport] = useState(null);   // null = loader, ellers payload
  const [failed, setFailed] = useState(false);
  // #2465: scout() returnerer eksplicit {ok, error} — handlingen koster CZ$, så en
  // fejl (fuld kapacitet, ikke nok CZ$, netværk) skal vises, ikke forsvinde stille.
  const [scoutError, setScoutError] = useState(null);

  const riderId = rider?.id;
  const {
    maxLevel, scout, scoutingId, slots, levels,
    scoutSystemEnabled, jobCapacity, jobActiveCount, jobConfig, pendingFor,
  } = scouting;
  // Scout-niveauet kan også stige via hero'ens scout-knap (useScouting er delt
  // side-state) — genindlæs rapporten når niveauet ændrer sig, uanset hvor der
  // blev scoutet fra.
  const hookLevel = levels?.[riderId] ?? 0;
  // #2244: mens job-modellen er 'on' er der ingen slots — en aktiv målrettet
  // opgave på DENNE rytter blokerer knappen ("Spejderen arbejder"), uanset
  // holdets samlede kapacitet (det håndteres af knap-disable nedenfor).
  const pending = scoutSystemEnabled ? pendingFor?.(riderId) : undefined;
  // #3548: nedtælling mod serverens ready_at (created_at + etaMinutes) i stedet
  // for det konstante ETA-tal, så ventetiden faktisk falder mens man kigger.
  const pendingCountdown = useScoutCountdown(pending?.readyAt ?? null);
  const pendingReadyClock = scoutReadyClock(pending?.readyAt);

  const load = useCallback(async () => {
    if (!riderId) return;
    try {
      const { data } = await getSession();
      const token = data?.session?.access_token;
      if (!token) { setFailed(true); return; }
      const res = await fetch(`${API}/api/riders/${riderId}/scouting-report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("report_failed");
      setReport(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [riderId]);

  useEffect(() => { setReport(null); load(); }, [load]);
  useEffect(() => { if (hookLevel > 0) load(); }, [hookLevel, load]);

  const level = report?.level ?? 0;
  const remaining = scoutSystemEnabled ? Math.max(0, jobCapacity - jobActiveCount) : (slots?.remaining ?? 0);
  const busy = scoutingId === riderId;
  // #3671: relative gulv (scoutEngine.scoutHalfWidth) betyder at næste niveau
  // ALTID køber noget for enhver spejder-rating (målt: 0 af 180 kombinationer
  // under MIN_USEFUL_GAIN). Dæmpningen her er derfor et SIKKERHEDSNET, ikke en
  // normaltilstand — den fanger regressionen hvis nogen ændrer en konstant i
  // scoutEngine/scoutingReport igen uden at måle konsekvensen. `precision`
  // mangler for uscoutede mål (report.hidden) og for capsMissing-payloads —
  // begge tilfælde falder sikkert tilbage til "ikke dæmpet".
  const nextLevelUseless = report?.precision?.nextLevelIsUseless === true;
  const canScout = remaining > 0 && level < maxLevel && !busy && !pending && !nextLevelUseless;

  const handleScout = async () => {
    if (!canScout) return;
    setScoutError(null);
    const r = await scout(riderId);
    if (r?.ok) {
      // Job-model: niveauet ændrer sig først når opgaven modner (dagens sweep) —
      // genindlæs IKKE rapporten her (intet nyt at vise endnu). Legacy-model:
      // slot-brug ændrer niveauet med det samme → genindlæs.
      if (!scoutSystemEnabled) load();
    } else {
      setScoutError(r?.error || "failed");
    }
  };

  // #2244: job-model-knappen viser opgavens pris fra jobConfig i GET /scouting/me
  // (SSOT: backend scoutEngine.SCOUT_JOB_CONFIG.target); fallbacks dækker kun
  // vinduet før første fetch.
  // TONE: "Send scout"/"Send spejder"-copy er plain/factual v1 — ejer-tone-session
  // for scouting-job-copy er stadig åben (spec §Åbne detaljer); review pending.
  // #2644 (ejer-beslutning 18/7): ~30 min svartid, uanset niveau — afløser den
  // gamle dags-baserede varighed (se scoutEngine.js for den fulde forbeholdelse).
  const TARGET_JOB_MINUTES = jobConfig?.targetEtaMinutes ?? 30;
  const TARGET_JOB_COST = jobConfig?.targetCostPerLevel ?? 1000;

  // #3548: tæl ned mod serverens ready_at når det findes; ellers den gamle flade
  // ETA-copy (ældre payload uden feltet).
  const pendingJobLabel = !pendingCountdown
    ? t("scouting.pendingJob", { minutes: TARGET_JOB_MINUTES })
    : pendingCountdown.state === "due"
      ? t("scouting.pendingJobDue")
      : t("scouting.pendingJobCountdown", { minutes: pendingCountdown.minutes });

  const scoutButton = (labelKey) => {
    if (pending) {
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-cz border border-cz-border text-cz-2 whitespace-nowrap tabular-nums"
          title={pendingReadyClock ? t("scouting.pendingReadyAtTitle", { time: pendingReadyClock }) : undefined}
        >
          <SearchIcon size={13} aria-hidden="true" className="flex-shrink-0" />
          {pendingJobLabel}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={handleScout}
        disabled={!canScout}
        title={
          remaining <= 0
            ? t("scouting.noSlots")
            : nextLevelUseless
              ? t("scouting.levelUseless")
              : t("scouting.scoutTitle")
        }
        className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-cz border border-cz-border text-cz-1 hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        <SearchIcon size={13} aria-hidden="true" className="flex-shrink-0" />
        {busy
          ? t("scouting.scouting")
          : scoutSystemEnabled
            ? t("scouting.sendScoutJob", { minutes: TARGET_JOB_MINUTES, cost: TARGET_JOB_COST })
            : t(labelKey)}
        {!scoutSystemEnabled && slots && <span className="text-cz-3 font-mono text-3xs">{slots.remaining}/{slots.total}</span>}
      </button>
    );
  };

  if (failed) {
    return (
      <SectionCard>
        <p className="text-cz-2 text-[12.5px] m-0">{t("profile.scouting.loadFailed")}</p>
      </SectionCard>
    );
  }
  if (!report) {
    return (
      <SectionCard>
        <p className="text-cz-3 text-[12.5px] m-0">{t("profile.scouting.loading")}</p>
      </SectionCard>
    );
  }

  // FØR: uscoutet, ikke-egen rytter — intet potentiale, kun invitationen.
  if (report.hidden) {
    return (
      <SectionCard>
        <Eyebrow>{t("profile.scouting.eyebrowOther")}</Eyebrow>
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mt-2">
          {t("profile.scouting.notScoutedTitle")}
        </h3>
        <p className="text-cz-2 text-[12.5px] leading-[1.55] mt-2 mb-3 max-w-prose">
          {t("profile.scouting.notScoutedBody")}
        </p>
        {scoutButton("scouting.scout")}
        {scoutError && (
          <p role="alert" className="mt-2 text-2xs text-cz-danger">
            {t([`profile.scouting.scoutErrors.${scoutError}`, "profile.scouting.scoutFailed"])}
          </p>
        )}
      </SectionCard>
    );
  }

  const { verdict, types, stars, value, own, scout: scoutMeta, precision, primaryKey } = report;
  const orderedTypes = TYPE_ORDER
    .map((key) => types?.find((x) => x.key === key))
    .filter(Boolean);
  // #3666 spec §D4: rytterens egen rolle løftes ud og vises stort; resten er
  // kontekst. `primaryKey` kommer fra serveren (rytterens archetype_draw), ikke
  // fra "hvilken rolle scorer højest" — en rytter må ikke skifte identitet fordi
  // et estimat bevægede sig. Mangler den (ældre payload), falder kortet tilbage
  // til den flade liste af otte, som før.
  const primaryRow = primaryKey ? orderedTypes.find((r) => r.key === primaryKey) : null;
  const secondaryRows = primaryRow ? orderedTypes.filter((r) => r.key !== primaryRow.key) : orderedTypes;
  // Ukendt/manglende scout-provenance (fx ældre klient-cache) degraderer sikkert
  // til "default"-linjen frem for at interpolere undefined navn/tier.
  const isDefaultScout = scoutMeta?.isDefault !== false;

  return (
    <div className="space-y-3">
      {/* EFTER: verdict-kortet — spejderens vurdering i klart sprog. */}
      <SectionCard>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Eyebrow>{t(own ? "profile.scouting.eyebrowOwn" : "profile.scouting.eyebrowOther")}</Eyebrow>
            {/* #3334: rapportens kilde — hvilken af HOLDETS EGNE scouts der pt.
                driver præcisionen. Altid synlig (ikke kun hover) så et scout-
                skift ikke er en overraskelse næste gang rapporten åbnes. Ingen
                ny potentiale-lækage (#2798): beskriver kun viewer-holdets eget
                personale, aldrig noget om målets skjulte evner. */}
            <p className="text-cz-3 text-3xs font-mono mt-1 mb-0">
              {isDefaultScout
                ? t("profile.scouting.provenanceDefault", { overall: scoutMeta?.overall ?? 40 })
                : t("profile.scouting.provenanceNamed", { name: scoutMeta?.name, tier: scoutMeta?.tier })}
            </p>
            <div className="flex items-center gap-2.5 mt-2 flex-wrap">
              <h3 className="font-display text-[21px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
                {verdict ? t(`profile.scouting.headline_${verdict.headlineKey}`) : t("profile.scouting.capsMissingTitle")}
              </h3>
              {verdict && (
                // #3667: chippen måler hvor FULDT scoutet rytteren er (buildVerdict:
                // `own || level >= maxLevel`), ikke hvor præcist estimatet er — det
                // sidste afhænger alene af spejderens rating. Den hed "Høj tillid" og
                // stod dermed og modsagde recalcNote nedenfor, som siger at båndet
                // afspejler spejderens præcision. Titlen siger nu forskellen højt.
                <span
                  title={t(`profile.scouting.confidenceTitle_${verdict.confidence}`)}
                  className={`text-3xs font-mono font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-cz border ${CONFIDENCE_STYLE[verdict.confidence] ?? CONFIDENCE_STYLE.medium}`}
                >
                  {t(`profile.scouting.confidence_${verdict.confidence}`)}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className="block font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-3">
              {t("profile.scouting.potentialLabel")}
            </span>
            {/* #2454/#3746: potentialet står i RATING-point, samme enhed som
                ratingen selv og som de otte tabel-flader — nu som PROGNOSE
                (progLo/progHi), ikke et loft. Stjernerne var en egen skala
                (1-6) som intet andet i spillet brugte, så tallet her kunne ikke
                holdes op mod noget. Faldbacken beholder dem for payloads uden
                prognose-bånd. */}
            <div className="mt-1">
              {primaryRow ? (
                <span className="font-mono tabular-nums text-[17px] text-cz-1">
                  {primaryRow.progLo ?? primaryRow.ceilLo}–{primaryRow.progHi ?? primaryRow.ceilHi}
                </span>
              ) : stars ? (
                <PotentialeStars range={stars} />
              ) : (
                <PotentialeStars value={null} />
              )}
            </div>
            {!own && (
              <span className="block text-3xs font-mono text-cz-3 mt-0.5" title={t("scouting.levelTitle")}>
                {level}/{maxLevel}
              </span>
            )}
          </div>
        </div>
        {verdict && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3.5 pt-3 border-t border-cz-border list-none p-0 m-0">
            {verdict.factorKeys.map((k) => (
              <li key={k} className="flex items-start gap-2 text-[12px] text-cz-2">
                <CheckIcon size={14} aria-hidden="true" className="text-cz-success mt-px flex-shrink-0" />
                {t(`profile.scouting.factor_${k}`)}
              </li>
            ))}
          </ul>
        )}
        {/* #3667: dommen er bygget på båndets MIDTPUNKT, som er bevidst forskudt pr.
            manager (scoutingReport.CEIL_BIAS_FACTOR) — den er altså en vurdering, ikke
            en kendsgerning. Målt 13/8 mod 300 prod-ryttere × 120 simulerede managere:
            4,7 % af rytterne får forskellig dom afhængigt af hvem der kigger. Lille,
            men ikke nul, og intet på kortet sagde det før. */}
        {verdict && (
          <p className="text-cz-3 text-3xs mt-2.5 mb-0 max-w-prose">
            {t("profile.scouting.verdictIsRead")}
          </p>
        )}
        {!own && level < maxLevel && (
          <div className="mt-3.5 pt-3 border-t border-cz-border flex items-center gap-3 flex-wrap">
            <p className="text-cz-3 text-[12px] m-0">{t("profile.scouting.rescoutHint")}</p>
            {scoutButton("scouting.rescout")}
            {scoutError && (
              <p role="alert" className="text-2xs text-cz-danger w-full m-0">
                {t([`profile.scouting.scoutErrors.${scoutError}`, "profile.scouting.scoutFailed"])}
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* Potentiale pr. ryttertype — nu + skraveret prognose-bånd. */}
      {orderedTypes.length > 0 && (
        <SectionCard>
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
              {t("profile.scouting.typesTitle")}
            </h3>
            <span className="text-3xs text-cz-3">{t("profile.scouting.typesSubtitle")}</span>
          </div>
          {primaryRow && (
            <PrimaryTypeRow
              typeKey={primaryRow.key}
              now={primaryRow.now}
              progLo={primaryRow.progLo ?? primaryRow.ceilLo}
              progHi={primaryRow.progHi ?? primaryRow.ceilHi}
              loft={primaryRow.loft}
              label={tTypes(`types.${primaryRow.key}`)}
              roleLabel={t("profile.scouting.primaryRoleLabel")}
              progressionLabel={t("profile.scouting.primaryProgressionLabel")}
              loftLabel={t("scouting.loftShort", { value: primaryRow.loft })}
            />
          )}
          {primaryRow && secondaryRows.length > 0 && (
            <span className="block font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-3 mb-2">
              {t("profile.scouting.otherRolesLabel")}
            </span>
          )}
          <div className="space-y-2">
            {secondaryRows.map((row) => (
              <TypeRow key={row.key} typeKey={row.key} now={row.now}
                progLo={row.progLo ?? row.ceilLo} progHi={row.progHi ?? row.ceilHi}
                loft={row.loft} label={tTypes(`types.${row.key}`)} />
            ))}
          </div>
          <p className="text-cz-3 text-3xs mt-3 mb-0">{t("profile.scouting.typesLegend")}</p>
          {/* #3334: den forklaring der var savnet i nosyaras sag — hvorfor
              båndet kan se anderledes ud fra én visning til den næste, og at
              rytterens egne evner aldrig er berørt af det. */}
          <p className="text-cz-3 text-3xs mt-1.5 mb-0">{t("profile.scouting.recalcNote")}</p>
          {/* #3671: hvad køber det næste scout-niveau egentlig? Knappen har hidtil
              lovet at scouting "snævrer estimatet ind" og taget 1.000 CZ$, uden at
              kunne vide om spillerens chefscout kan levere en indsnævring. Med det
              gamle absolutte gulv var svaret for 150 af 203 menneskehold: nul.
              Linjen siger nu tallet højt — og ved loftet siger den hvad der ER
              vejen frem (en bedre chefscout), i stedet for at tie. */}
          {precision && <PrecisionNote precision={precision} t={t} lang={i18n.language} />}
        </SectionCard>
      )}

      {report.capsMissing && (
        <SectionCard>
          <p className="text-cz-2 text-[12.5px] m-0">{t("profile.scouting.capsMissingBody")}</p>
        </SectionCard>
      )}

      {/* Røverkøb? — sammenligning + one-line read, ingen verdict-label.
          Skjules når markedsværdi == modelværdi (tautologi — market_value ER
          i dag modelbaseret for ryttere uden auktions-drift; kortet siger så
          intet. Får reel signalværdi når expected bliver potentiale-justeret
          i Fase 2/3). */}
      {value && value.expected !== value.market && (
        <SectionCard>
          <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
            {t("profile.scouting.valueTitle")}
          </h3>
          <div className="grid grid-cols-2 gap-3 max-w-[420px]">
            <div>
              <span className="block font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-3">
                {t("profile.scouting.valueMarket")}
              </span>
              <span className="block font-display text-[19px] text-cz-1 mt-0.5">{formatCz(value.market)}</span>
            </div>
            <div>
              <span className="block font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-3">
                {t("profile.scouting.valueExpected")}
              </span>
              <span className="block font-display text-[19px] text-cz-1 mt-0.5">{formatCz(value.expected)}</span>
            </div>
          </div>
          <p className="text-cz-2 text-[12px] mt-2.5 mb-0 max-w-prose">
            {t(value.expected > (value.market ?? 0)
              ? "profile.scouting.valueReadAbove"
              : "profile.scouting.valueReadBelow")}
          </p>
        </SectionCard>
      )}
    </div>
  );
}
