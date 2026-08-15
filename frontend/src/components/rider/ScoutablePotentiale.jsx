// ScoutablePotentiale — progression L1 (#1138) + server-side skjuling (#1162)
// + job-model "under"-tilstand (#2244 Fase 3 Slice C).
//
// Viser en rytters potentiale som et SCOUTET estimat (stjerne-range + kvalitativ
// label), plus en valgfri scout-knap der starter en scouting-handling og
// indsnævrer estimatet.
//
// #1162: Estimatet beregnes på SERVEREN (POST /api/scouting/estimates) — den rå
// riders.potentiale findes ikke i klienten. #1543 beslutning 3+4: egne ryttere +
// fuldt scoutede får et SMALT REST-BÅND (aldrig eksakt) — ingen når 100% viden.
// #2244 A3: `exact`-feltet er FJERNET fra det maskerede estimat helt (serveren
// sender det aldrig længere — egne ryttere er nu ALTID et bånd). Den tidligere
// "vis eksakte stjerner"-gren herunder er derfor fjernet; `lo === hi` (fx efter
// clamping ved skalaens yderpunkter 1/6) rammer stadig samme visning naturligt.
// #1242 (ejer-beslutning dokumenteret her): egne ryttere viser SAMME kvalitative
// præsentation som andres — aldrig et råt tal. Stjernerne (0,5-trin) ER den
// fulde indsigt; potentiale-skalaen er ikke spillervendt som tal.
// #1543: en ikke-egen rytter der ikke er scoutet (level 0) returnerer serveren nu
// { hidden: true } — INTET potentiale vises (intet gratis lo–hi-spænd) før et
// scout-slot er brugt. Scout-knappen vises stadig, så spilleren kan afdække det.
// #2244: når scoutSystemEnabled er 'on' starter knappen en job-model-opgave der
// modner over dage (ingen øjeblikkelig niveau-ændring) — mens opgaven er aktiv
// vises "Spejderen arbejder" i stedet for knappen (pendingFor(riderId)).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PotentialeStars from "../PotentialeStars";
import { SearchIcon } from "../ui";
import { potentialLabelKey } from "../../lib/scouting";
import { useScoutCountdown, scoutReadyClock } from "../../lib/scoutCountdown";

// #2796: `labelAsTitle` videresendes til PotentialeStars — tætte tabel-celler
// (akademi-rosteret) viser stjernerne alene og lægger den kvalitative label i
// tooltip'en. Default false, så alle eksisterende kald-sites er uændrede.
// #2849 bølge 5 (ejer-feedback): `hideLevel` skjuler scouting-niveau-badgen
// ("2/3") — hero-stat-rækken viser kun stjernerne; niveauet hører til i
// scouting-fanen. Opt-in, eksisterende kald-sites uændrede.
// #2454 — POTENTIEL RATING erstatter stjernerne.
//
// Stjernerne var en egen enhed (1-6, i halve trin) som intet andet i spillet
// brugte. Spilleren skulle selv oversætte "4,5 stjerner" til noget der kunne
// holdes op mod rytterens rating, og det kunne han ikke: de to tal levede på
// hver sin skala. Efter #3666 er rating det vægtede snit af rollens evner, og
// potentiel rating er PRÆCIS samme regnestykke på lofterne. Så snart de deler
// enhed, er intervallet "kan nå 40-48" direkte sammenligneligt med "han er 29 nu"
// — og luften mellem dem bliver et tal spilleren kan handle på.
//
// Serveren leverer båndet (POST /scouting/estimates → `prog`, alias `ceil`),
// regnet med samme funktion som Scouting-fanens kort. #3746: båndet er en
// PROGNOSE (hvor rytteren realistisk ender med træning), ikke et loft (hvor
// højt han teoretisk kan nå) — rå potentiale/lofter forlader stadig aldrig
// serveren.
//
// ALTID et interval, aldrig ét tal (#1543 beslutning 3): ingen spejder kender en
// rytter præcist, heller ikke på egne ryttere.
//
// `labelAsTitle` er nu default TRUE (lukker #2796's anden halvdel). Den
// kvalitative label ("Højt potentiale") stod som synlig tekst på Auktioner,
// Ønskelisten og Sammenlign, hvor den både fyldte og sagde mindre end tallet.
// Den ligger nu i tooltip'en alle steder. Kaldere kan stadig sætte false.
//
// #3746: `band` er PROGNOSEN, ikke længere et loft — "hvor ender han realistisk
// med din træning", ikke "hvor højt kan han teoretisk nå". Tooltip-copyen er
// derfor en title/subtitle-parre ("Projected level" / "Where he realistically
// lands with your training") frem for ét loft-sprogs sætning.
function PotentialBand({ band, role, label, large, t }) {
  const roleName = role ? t(`riderTypes:types.${role}`) : null;
  const bandTitle = roleName
    ? t("rider:scouting.potentialBandTitle", { role: roleName, lo: band.lo, hi: band.hi })
    : null;
  const bandSubtitle = roleName ? t("rider:scouting.potentialBandSubtitle") : null;
  const title = [label, bandTitle, bandSubtitle].filter(Boolean).join(" · ") || undefined;
  return (
    <span
      title={title}
      className={`font-mono tabular-nums whitespace-nowrap text-cz-1 ${large ? "text-[17px]" : "text-[13px]"}`}
      data-potential-band={`${band.lo}-${band.hi}`}
    >
      {band.lo}–{band.hi}
    </span>
  );
}

export default function ScoutablePotentiale({ rider, scouting, showScout = false, large = false, labelAsTitle = true, hideLevel = false }) {
  const { t } = useTranslation();
  const {
    maxLevel, scout, scoutingId, slots, requestEstimates, estimateFor,
    scoutSystemEnabled, jobCapacity, jobActiveCount, pendingFor, jobConfig,
  } = scouting;
  // #2644 (ejer-beslutning 18/7): målrettet undersøgelse svarer på ~30 min,
  // uanset niveau — se scoutEngine.js for den fulde nattelige-sweep-forbeholdelse.
  const targetEtaMinutes = jobConfig?.targetEtaMinutes ?? 30;

  const riderId = rider?.id;
  useEffect(() => {
    if (riderId) requestEstimates([riderId]);
  }, [riderId, requestEstimates]);

  // #2465: scout() returnerer eksplicit {ok, error} — handlingen koster CZ$, så en
  // fejl skal vises. Hook skal stå FØR de tidlige returns nedenfor (rules-of-hooks).
  const [scoutError, setScoutError] = useState(null);

  // #3548: nedtælling til rapporten. Både `pending` og hooken skal stå FØR de
  // tidlige returns nedenfor (rules-of-hooks) — derfor er pending flyttet op hertil.
  const pending = scoutSystemEnabled ? pendingFor?.(riderId) : undefined;
  const pendingCountdown = useScoutCountdown(pending?.readyAt ?? null);
  const pendingReadyClock = scoutReadyClock(pending?.readyAt);

  const estimate = estimateFor(riderId);

  // undefined = ikke hentet endnu, null = rytter uden potentiale → begge "—".
  if (estimate == null) {
    return <PotentialeStars value={null} />;
  }

  // #1543: skjult, uscoutet rytter (level 0, ikke egen) → vis ALDRIG et estimat.
  // Stjerner og kvalitativ label hentes ikke for et hidden-estimat (intet midtpunkt
  // findes); kun en neutral "ikke scoutet"-markør + den valgfrie scout-knap.
  const hidden = estimate.hidden === true;

  const level = estimate.level ?? 0;
  const busy = scoutingId === riderId;
  const remaining = scoutSystemEnabled ? Math.max(0, jobCapacity - jobActiveCount) : (slots?.remaining ?? 0);
  const canScout = remaining > 0 && level < maxLevel && !busy && !pending;

  // Kompakt kontekst (kort/tabelrække) → et lille fejl-mærke i stedet for en
  // fuld banner (samme kontrakt som RiderScoutingTab.jsx).
  const handleScout = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canScout) return;
    setScoutError(null);
    const r = await scout(riderId);
    if (r && !r.ok) setScoutError(r.error || "failed");
  };
  const scoutErrorBadge = scoutError && (
    <span
      role="alert"
      title={t([`rider:scouting.scoutErrors.${scoutError}`, "rider:scouting.scoutFailed"])}
      className="text-3xs font-bold text-cz-danger"
    >
      !
    </span>
  );

  // #3548: tæl ned mod serverens ready_at når det findes; ellers den gamle
  // flade ETA-copy (ældre payload uden feltet).
  const pendingLabel = !pendingCountdown
    ? t("rider:scouting.pendingShort", { minutes: targetEtaMinutes })
    : pendingCountdown.state === "due"
      ? t("rider:scouting.pendingShortDue")
      : t("rider:scouting.pendingShortCountdown", { minutes: pendingCountdown.minutes });
  const pendingBadgeTitle = [
    t("rider:scouting.pendingTitle"),
    pendingReadyClock ? t("rider:scouting.pendingReadyAtTitle", { time: pendingReadyClock }) : null,
  ].filter(Boolean).join(" · ");

  const pendingBadge = scoutSystemEnabled && pending && (
    <span className="text-2xs text-cz-3 whitespace-nowrap tabular-nums" title={pendingBadgeTitle}>
      {pendingLabel}
    </span>
  );

  const scoutButton = showScout && !pending && (
    <button
      type="button"
      onClick={handleScout}
      disabled={!canScout}
      title={remaining <= 0 ? t("rider:scouting.noSlots") : t("rider:scouting.scoutTitle")}
      className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-cz border border-cz-border text-cz-2 hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
    >
      {busy ? (
        t("rider:scouting.scouting")
      ) : (
        <>
          <SearchIcon size={11} aria-hidden="true" className="flex-shrink-0" />
          {level > 0 ? t("rider:scouting.rescout") : t("rider:scouting.scout")}
        </>
      )}
      {!scoutSystemEnabled && slots && <span className="ms-1 text-cz-3">{slots.remaining}/{slots.total}</span>}
    </button>
  );

  if (hidden) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <span className="text-cz-3 text-xs whitespace-nowrap" title={t("rider:scouting.scoutToReveal")}>
          {t("rider:scouting.notScouted")}
        </span>
        {pendingBadge}
        {scoutButton}
        {scoutErrorBadge}
      </span>
    );
  }

  const labelKey = potentialLabelKey(estimate);
  const label = labelKey ? t(`rider:scouting.label_${labelKey}`) : null;

  // #2454/#3746: serveren har leveret et rating-bånd → det er visningen. `prog`
  // er prognose-båndets navn; `ceil` er en midlertidig alias (samme tal) for
  // ældre klient-cache, se backend/routes/api.js. Stjernerne bliver stående som
  // fallback for payloads uden bånd (den defensive gren hvor rytteren mangler
  // evne-data). Målt 14/8 mod prod: 0 af 8.782 ryttere mangler primary_type,
  // evne-række eller ability_caps, så fallbacken er defensiv — ikke en tilstand
  // spillere reelt møder.
  const band = estimate.prog ?? estimate.ceil;
  if (band) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <PotentialBand band={band} role={estimate.role} label={labelAsTitle ? label : null}
          large={large} t={t} />
        {!labelAsTitle && label && <span className="text-2xs text-cz-3">{label}</span>}
        {!hideLevel && level > 0 && (
          <span className="text-3xs font-mono text-cz-3" title={t("rider:scouting.levelTitle")}>
            {level}/{maxLevel}
          </span>
        )}
        {pendingBadge}
        {scoutButton}
        {scoutErrorBadge}
      </span>
    );
  }

  // Defensiv fallback: lo === hi (fx clamping ved skalaens yderpunkter 1/6) →
  // vis som eksakte stjerner. `exact`-feltet findes ikke længere i det maskerede
  // estimat (#2244 A3) — dette er REN clamping-defensiv, ikke en "kendt eksakt"-gren.
  if (estimate.lo === estimate.hi) {
    return <PotentialeStars value={estimate.lo} label={label} large={large} labelAsTitle={labelAsTitle} />;
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <PotentialeStars range={estimate} label={label} large={large} labelAsTitle={labelAsTitle} />
      {!hideLevel && level > 0 && (
        <span className="text-3xs font-mono text-cz-3" title={t("rider:scouting.levelTitle")}>
          {level}/{maxLevel}
        </span>
      )}
      {pendingBadge}
      {scoutButton}
      {scoutErrorBadge}
    </span>
  );
}
