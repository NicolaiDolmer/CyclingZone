// Season Planner — Squad-fanen (#3086, kontrakten i #2905).
//
// Etape 2's kerne: LISTEN er input. Indtil nu var SVG-trækket på master-brættet
// den eneste vej ind, og målingen var utvetydig — 10 af 156 hold brugte
// planlæggeren i HELE sæson 1. Her sætter man et peak-mål med en `select`, og
// konsekvensen står i rækken ved siden af.
//
// Ingen nye mutationer: `usePlanner.createPeak` / `retargetPeak` fandtes allerede
// (#2905-researchen), så en tom plads og en sat peak deler nøjagtig samme
// kontrol — kun hvilken mutation den kalder er forskellig.
//
// ÉN DOM, to layouts (ejer-valg 27/7, variant A): tabellen skifter til stakkede
// kort under `md` via Tailwinds display-utilities i stedet for at rendere to
// parallelle træer. Det er ikke kun kosmetik — hver `select` bærer hele
// sæson-kalenderen som `option`-elementer, så en duplikeret markup ville
// fordoble et par tusinde noder for at skjule den ene halvdel med CSS.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { riderOverallRating } from "../../lib/riderRating";
import { riderSuitability } from "../../lib/suitability";
import { statStyle } from "../../lib/statColor";
import { Flag } from "../Flag";
import RiderTypeBadge from "../rider/RiderTypeBadge";
import { Section, SectionHeader, StarIcon, FlagIcon, AlertTriangleIcon, LockIcon, XIcon, ChevronRightIcon } from "../ui";
import { formatOrdinalShort, formatRaceDateLabel, riderShortName, dateToOrdinal, statusMeta } from "./plannerShared";
import { squadSlots, riderPendingSuggestions, targetableRacesFor, paybackRiskRaceIds, locksImmediatelyRaceIds, riderSeasonLoad } from "./plannerSquadModel";

// Tabellen bliver til en kort-liste under md. Cellerne beholder deres semantik
// (<td>), så en skærmlæser stadig læser rækken som en række.
const CELL = "block md:table-cell border-cz-border px-0 md:px-4 py-1 md:py-[13px] align-top md:border-t";
const ROW = "block md:table-row border-t border-cz-border md:border-t-0 py-3 md:py-0 first:border-t-0 md:first:border-t";

// Hvad peaken er værd, i formpoint. `current` findes først når optakten er redet
// (#3083) — indtil da står spændet gulv..loft alene, hvilket er den ærlige
// tilstand på det tidspunkt beslutningen faktisk træffes (ejer-valg: option C).
// Eksporteret: PlannerDrawer's rytter-skuffe genbruger PRÆCIS samme kort-linje
// (#4212/#4271 "kortet som kontrakt") — to formler for samme tal er
// #3071-fejlklassen, så tallene skal komme fra ét sted.
export function PeakValue({ peak, paybackDays, months }) {
  const { t } = useTranslation("planner");
  const value = peak?.value;
  if (!value || value.ceiling == null) return null;
  const payback = value.payback == null ? null : String(value.payback);
  const collisions = peak.paybackCollisions || [];
  const meta = peak.isSuggestion ? null : statusMeta(peak.status);

  return (
    <div>
      <div className="font-data text-[13px] tabular-nums text-cz-1">
        <span className="font-semibold text-cz-accent-t">
          {value.current == null
            ? t("squad.value.range", { floor: value.floor, ceiling: value.ceiling })
            : t("squad.value.current", { current: value.current })}
        </span>
        {meta && meta.key !== "pending" && (
          <span className="ms-1.5 font-sans text-2xs text-cz-2">{t(`status.${meta.key}`)}</span>
        )}
      </div>
      {payback && (
        <div className="mt-0.5 text-3xs text-cz-3">
          {value.current == null
            ? t("squad.value.rangeHint", { payback, days: paybackDays })
            : t("squad.value.currentHint", { payback, days: paybackDays })}
        </div>
      )}
      {collisions.map((c) => (
        <div key={c.raceId} className="mt-1 flex items-start gap-1 text-3xs text-cz-danger">
          <AlertTriangleIcon size={13} aria-hidden="true" className="mt-px shrink-0" />
          <span>
            {t("squad.payback.collision", {
              race: c.raceName || t("squad.payback.unknownRace"),
              days: c.daysAfterPeak,
              payback: payback ?? "",
            })}
          </span>
        </div>
      ))}
      {/* #3094: en lås uden forklaring var selve klagen ("ingen varsel, ingen
          forklaring, ingen fortryd") — badgen forklarer nu ALTID hvorfor +
          hvornår, og en endnu-ikke-låst peak viser hvornår den vil, så
          tidspunktet er kendt på forhånd i stedet for en overraskelse. */}
      {peak.locked ? (
        <div
          className="mt-1 flex items-center gap-1 text-3xs text-cz-3"
          title={peak.windowStart
            ? t("squad.lockedTooltip", { date: formatOrdinalShort(dateToOrdinal(peak.windowStart), months) })
            : t("squad.lockedTooltipGeneric")}
        >
          <LockIcon size={12} aria-hidden="true" />{t("status.locked")}
        </div>
      ) : (
        !peak.isSuggestion && peak.windowStart && (
          <div className="mt-1 flex items-center gap-1 text-3xs text-cz-3">
            {t("squad.locksOn", { date: formatOrdinalShort(dateToOrdinal(peak.windowStart), months) })}
          </div>
        )
      )}
      {!peak.isSuggestion && peak.windowStart && (
        <div className="mt-1 font-data text-3xs uppercase tracking-[.05em] tabular-nums text-cz-3">
          {t("squad.window", {
            start: formatOrdinalShort(dateToOrdinal(peak.windowStart), months),
            end: formatOrdinalShort(dateToOrdinal(peak.windowEnd), months),
          })}
        </div>
      )}
    </div>
  );
}

// Én peak-plads = én `select`. Tom plads → createPeak; sat peak → retargetPeak;
// et assistent-forslag → createPeak (forslaget HAR ingen plan-id, så at vælge et
// andet løb ER at acceptere en anden peak). Samme kontrol, samme sted, uanset
// hvilken af de tre tilstande pladsen står i.
function PeakSlot({ rider, slot, races, todayOrd, months, paybackDays, busy, disabled, onCreatePeak, onRetarget, onRemovePeak }) {
  const { t } = useTranslation("planner");
  const peak = slot.peak;
  const currentTargetId = peak?.targetRaceId ?? null;

  const options = useMemo(() => {
    const targetable = targetableRacesFor({ rider, races, todayOrd, currentTargetId });
    // Hul 2 fra #3093: payback-risikoen skal kunne ses FØR man vælger, pr. løb.
    // Vinduet kommer færdig-snappet fra boardet (race.peakWindow) — her laves kun
    // interval-tjekket mod rytterens program (alle entries + øvrige peak-mål).
    const risky = paybackRiskRaceIds({ rider, races, paybackDays, currentTargetId });
    // #3094 straks-plaster 1a: advar FØR valget når et mål-løbs vindue allerede
    // er i gang — det er stadig den ene måde en peak kan blive låst i samme
    // øjeblik den sættes, selv efter lås-tærsklen flyttede til "vinduet er
    // begyndt". Payback tjekkes FØRST: et løb kan i teorien ramme begge, og
    // "låser med det samme" er den mere overraskende af de to.
    const locksNow = locksImmediatelyRaceIds({ races, todayOrd });
    return targetable.map((r) => ({
      id: r.id,
      // Audit-punkt 1 fra #2905: konsekvensen skal kunne ses FØR man vælger.
      // Formpoint-spændet er det samme for alle løb (det er motorens konstanter),
      // så det per-løb differentierende er egnetheden — den scoring findes
      // allerede klient-side i riderSuitability, samme tal som race-skuffen
      // rangerer med. Kronologisk rækkefølge (ejer-valg 27/7): en sæsonkalender
      // læst ud af dato-orden er svær at finde et bestemt løb i.
      label: t(
        locksNow.has(r.id) ? "squad.raceOptionLocksNow"
          : risky.has(r.id) ? "squad.raceOptionPayback"
            : "squad.raceOption",
        {
          date: formatRaceDateLabel(r, months),
          race: r.name,
          fit: riderSuitability(rider.abilities, r.demandVector).score,
        },
      ),
    }));
  }, [rider, races, todayOrd, currentTargetId, months, paybackDays, t]);

  const locked = Boolean(peak?.locked);
  const isSuggestion = Boolean(peak?.isSuggestion);
  const selectDisabled = busy || disabled || locked;
  // #3094: en disabled kontrol uden forklaring ER klagen ("kan ikke fjerne hans
  // ene peak" — jonasnielsen_05591 4/8). Titlen forklarer HVORFOR + HVORNÅR den
  // låste, i stedet for at kontrollen bare holder op med at reagere.
  const lockedTitle = locked && peak?.windowStart
    ? t("squad.lockedTooltip", { date: formatOrdinalShort(dateToOrdinal(peak.windowStart), months) })
    : locked ? t("squad.lockedTooltipGeneric") : null;

  const onChange = (e) => {
    const raceId = e.target.value;
    if (!raceId || raceId === currentTargetId) return;
    if (peak && !isSuggestion) onRetarget(peak.id, raceId);
    else onCreatePeak(rider.id, raceId);
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 w-4 flex justify-center" aria-hidden="true">
        {isSuggestion
          ? <StarIcon size={13} className="text-cz-accent-t" />
          : peak
            ? <FlagIcon size={13} className="text-cz-accent-t" />
            : <span className="block w-2 h-2 rounded-full border border-dashed border-cz-3" />}
      </span>
      {/* min-h[44px] på mobil (#2883 accept-kriterie: alle interaktive mål på
          /planner ≥44×44px — en select under det er et for lille tap-mål).
          Desktop-rækkerne beholder deres tættere rytme (md:min-h-0). */}
      <select
        className={`min-h-[44px] min-w-0 flex-1 rounded-cz border bg-cz-card px-2 py-1.5 text-[12.5px] text-cz-1 disabled:opacity-50 md:min-h-0 ${peak ? "border-cz-border" : "border-dashed border-cz-border text-cz-3"}`}
        value={currentTargetId ?? ""}
        disabled={selectDisabled}
        aria-label={t("squad.pickRace", { name: riderShortName(rider) })}
        title={lockedTitle ?? undefined}
        onChange={onChange}
      >
        <option value="">{t("squad.noPeak")}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {peak && !isSuggestion && (
        <button
          type="button"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-cz-3 hover:text-cz-1 disabled:opacity-40 md:min-h-0 md:min-w-0 md:p-0.5"
          disabled={busy || locked}
          aria-label={t("squad.remove")}
          title={lockedTitle ?? t("squad.remove")}
          onClick={() => onRemovePeak(peak.id)}
        >
          <XIcon size={14} aria-hidden="true" />
        </button>
      )}
      {isSuggestion && <span className="shrink-0 w-[18px]" aria-hidden="true" />}
    </div>
  );
}

// #4212 (retning B): et uaccepteret assistent-forslag optager ALDRIG en af de
// faste pladser fra `squadSlots` — det vises i stedet i sit eget stiplede
// ghost-spor herunder, tydeligt adskilt fra de pladser manageren selv har
// besat. Accept = samme createPeak-kald som en manuel peak (forslaget har
// ingen egen plan-id); "Nulstil til blank" fjerner ALLE rytterens forslag
// denne sæson (samme dismiss-mekanisme som rytter-skuffen).
function SuggestionGhostRow({ rider, suggestion, busy, disabled, onAcceptSuggestion, onDismissSuggestion }) {
  const { t } = useTranslation("planner");
  const months = t("months", { returnObjects: true });
  return (
    <div className="flex items-center gap-1.5 rounded-cz border border-dashed border-cz-accent-t bg-cz-subtle px-2 py-1.5">
      <StarIcon size={12} className="shrink-0 text-cz-accent-t" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-2xs text-cz-2">
        {formatOrdinalShort(dateToOrdinal(suggestion.windowStart), months)} · {suggestion.targetRaceName || "—"}
      </span>
      <button
        type="button"
        className="shrink-0 text-3xs text-cz-accent-t hover:underline disabled:opacity-40"
        disabled={busy || disabled}
        onClick={() => onAcceptSuggestion(rider.id, suggestion.targetRaceId)}
      >{t("assistant.accept")}</button>
      <button
        type="button"
        className="shrink-0 text-3xs text-cz-3 hover:text-cz-1 disabled:opacity-40"
        disabled={busy || disabled}
        onClick={() => onDismissSuggestion(rider.id)}
      >{t("assistant.reset")}</button>
    </div>
  );
}

export default function PlannerSquad({
  riders, races, maxPerRider, months, today, paybackDays, busy, divisionPending,
  onCreatePeak, onRetarget, onRemovePeak, onSelectRider, selectedRiderId,
  onAcceptSuggestion, onDismissSuggestion,
}) {
  const { t } = useTranslation("planner");
  const todayOrd = dateToOrdinal(today);

  // Bedste ryttere først: det er dem en manager bruger sine peaks på, og det er
  // den rækkefølge truppen ellers vises i på tværs af appen. #2772: belastningen
  // (løbsdage) regnes samme sted, så rækken har den ved hånden.
  const rows = useMemo(() => (riders || [])
    .map((rd) => ({
      rider: rd,
      ovr: riderOverallRating({ ...rd.abilities, primary_type: rd.primaryType }),
      load: riderSeasonLoad({ rider: rd, races }),
    }))
    .sort((a, b) => b.ovr - a.ovr || String(a.rider.lastname).localeCompare(String(b.rider.lastname))),
  [riders, races]);

  return (
    <Section>
      <SectionHeader title={t("squad.title")} meta={t("squad.count", { count: rows.length })} />
      {/* Bevidst usorteret: rækkefølgen ER information (bedste ryttere først, det
          er dem peaks bruges på), og rækkerne bærer input-kontroller frem for
          sammenlignelige tal-kolonner. Det man leder efter — hvad der kræver
          handling — findes via status-linjen og advarslerne, ikke via en sortering. */}
      <table className="block w-full border-collapse md:table" data-sort-exempt="Rangeret efter rating; input-raekker, ikke en sammenlignings-tabel">
        <thead className="hidden md:table-header-group">
          <tr>
            <th className="whitespace-nowrap bg-cz-card px-4 py-3 text-left font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("squad.colRider")}</th>
            <th className="whitespace-nowrap bg-cz-card px-2 py-3 text-right font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("squad.colForm")}</th>
            <th className="w-[38%] whitespace-nowrap bg-cz-card px-4 py-3 text-left font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("squad.colTarget")}</th>
            <th className="whitespace-nowrap bg-cz-card px-4 py-3 text-left font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("squad.colValue")}</th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {rows.map(({ rider, ovr, load }) => {
            const slots = squadSlots(rider, maxPerRider);
            const suggestions = riderPendingSuggestions(rider);
            const selected = rider.id === selectedRiderId;
            return (
              <tr key={rider.id} className={`${ROW} ${selected ? "bg-cz-subtle" : ""}`}>
                <td className={CELL}>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cz font-data text-[12.5px] font-medium tabular-nums"
                      style={statStyle(ovr)}
                    >{ovr}</span>
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t"
                        onClick={() => onSelectRider(rider.id)}
                      >
                        <span className="truncate">{riderShortName(rider)}</span>
                        <ChevronRightIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                      </button>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {rider.nationality && <Flag code={rider.nationality} className="text-[11px]" />}
                        {rider.primaryType && <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} size="sm" />}
                        {rider.age != null && (
                          <span className="whitespace-nowrap font-data text-3xs uppercase tracking-[.05em] tabular-nums text-cz-3">{t("squad.age", { age: rider.age })}</span>
                        )}
                        {/* #2772: sæson-belastning — en peak er kun troværdig hvis
                            rytteren ikke også er kørt træt i optakten. Tallet gør
                            opportunity cost synlig, uden en opfundet farve-tærskel. */}
                        {load.raceDays > 0 && (
                          <span
                            className="whitespace-nowrap font-data text-3xs uppercase tracking-[.05em] tabular-nums text-cz-3"
                            title={t("squad.loadTitle", { races: load.races, days: load.raceDays })}
                          >{t("squad.load", { days: load.raceDays })}</span>
                        )}
                      </div>
                    </div>
                    {/* Formen står hos navnet på mobil; på desktop har den sin egen kolonne. */}
                    <span className="ms-auto font-data text-[13px] tabular-nums text-cz-1 md:hidden">
                      {t("squad.formInline", { value: rider.form ?? "-" })}
                    </span>
                  </div>
                </td>
                <td className={`${CELL} hidden md:table-cell md:px-2 md:text-right`}>
                  <span className="font-data text-[13px] tabular-nums text-cz-1">{rider.form ?? "-"}</span>
                </td>
                <td className={`${CELL} md:w-[38%]`}>
                  <div className="mt-2 flex flex-col gap-1.5 md:mt-0">
                    {slots.map((slot) => (
                      <PeakSlot
                        key={slot.key}
                        rider={rider} slot={slot} races={races} todayOrd={todayOrd} months={months}
                        paybackDays={paybackDays} busy={busy} disabled={divisionPending}
                        onCreatePeak={onCreatePeak} onRetarget={onRetarget} onRemovePeak={onRemovePeak}
                      />
                    ))}
                    {/* #4212: forslag i eget stiplet spor, ALDRIG inde i en plads
                        ovenfor — se squadSlots' topkommentar. */}
                    {suggestions.map((s) => (
                      <SuggestionGhostRow
                        key={s.id}
                        rider={rider} suggestion={s} busy={busy} disabled={divisionPending}
                        onAcceptSuggestion={onAcceptSuggestion} onDismissSuggestion={onDismissSuggestion}
                      />
                    ))}
                  </div>
                </td>
                <td className={CELL}>
                  <div className="mt-1.5 flex flex-col gap-2 md:mt-0">
                    {slots.filter((s) => s.peak).map((slot) => (
                      <PeakValue key={slot.key} peak={slot.peak} paybackDays={paybackDays} months={months} />
                    ))}
                    {slots.every((s) => !s.peak) && (
                      <span className="text-3xs text-cz-3">{t("squad.value.unset")}</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}
