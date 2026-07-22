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

// #2796: `labelAsTitle` videresendes til PotentialeStars — tætte tabel-celler
// (akademi-rosteret) viser stjernerne alene og lægger den kvalitative label i
// tooltip'en. Default false, så alle eksisterende kald-sites er uændrede.
export default function ScoutablePotentiale({ rider, scouting, showScout = false, large = false, labelAsTitle = false }) {
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
  const pending = scoutSystemEnabled ? pendingFor?.(riderId) : undefined;
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
      className="text-[10px] font-bold text-cz-danger"
    >
      !
    </span>
  );

  const pendingBadge = scoutSystemEnabled && pending && (
    <span className="text-[11px] text-cz-3 whitespace-nowrap" title={t("rider:scouting.pendingTitle")}>
      {t("rider:scouting.pendingShort", { minutes: targetEtaMinutes })}
    </span>
  );

  const scoutButton = showScout && !pending && (
    <button
      type="button"
      onClick={handleScout}
      disabled={!canScout}
      title={remaining <= 0 ? t("rider:scouting.noSlots") : t("rider:scouting.scoutTitle")}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-cz border border-cz-border text-cz-2 hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
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

  // Defensiv fallback: lo === hi (fx clamping ved skalaens yderpunkter 1/6) →
  // vis som eksakte stjerner. `exact`-feltet findes ikke længere i det maskerede
  // estimat (#2244 A3) — dette er REN clamping-defensiv, ikke en "kendt eksakt"-gren.
  if (estimate.lo === estimate.hi) {
    return <PotentialeStars value={estimate.lo} label={label} birthdate={rider.birthdate} large={large} labelAsTitle={labelAsTitle} />;
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <PotentialeStars range={estimate} label={label} birthdate={rider.birthdate} large={large} labelAsTitle={labelAsTitle} />
      {level > 0 && (
        <span className="text-[10px] font-mono text-cz-3" title={t("rider:scouting.levelTitle")}>
          {level}/{maxLevel}
        </span>
      )}
      {pendingBadge}
      {scoutButton}
      {scoutErrorBadge}
    </span>
  );
}
