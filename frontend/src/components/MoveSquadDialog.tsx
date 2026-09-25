// #5748 (ejer-go A 25/9): "Move squad", én flyt-dialog for alle trupper.
//
// Rytterprofilen (RiderManageActions) og My Team (TeamPage's "Move squad"-fane)
// monterer BEGGE denne komponent, så reglen, tallene og selve flytningen kun
// findes ét sted. Den:
//   1. henter rytterens friske trup og løn-grundlag (useAcademy.fetchMoveState)
//      og holdets pladser (useAcademy: seniorCount/seniorMax + squads),
//   2. bygger de tre rækker + forvalget med squadTarget.ts,
//   3. henter konsekvensen for det VALGTE mål: senior -> ungdom via
//      academy-demote-quote?squad=X (samme funktioner som backend demote()
//      bruger, #3784/#3805/#4582), op til senior via samme udledning som
//      AcademyPage's promote (keepsExistingContractOnPromote/projectSeniorSalary),
//      junior <-> U23 rører hverken løn eller kontrakt,
//   4. flytter via POST /api/riders/:id/squad (useAcademy.moveRider -> moveRider).
// En afvisning vises i dialogen, som bliver stående; kun en gennemført flytning
// lukker den (onMoved).
//
// Monteres kun mens dialogen er åben (kalderen gater), så /api/academy/me og
// rytter-opslaget hentes friskt ved hver åbning.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AcademyTransferConfirmModal } from "./AcademyTransferConfirmModal.jsx";
import { useAcademy } from "../lib/useAcademy.js";
import { getRiderAge } from "../lib/riderAge.js";
import { fetchRiderQuote } from "../lib/riderContractActions.js";
import { projectSeniorSalary } from "../lib/marketValues.js";
import { keepsExistingContractOnPromote } from "../lib/academyPromoteContract.js";
import { demoteCapLabels } from "../lib/squadCaps.ts";
import { resolveApiError } from "../lib/apiError.js";
import { currentSquadOf, moveSquadRows, defaultMoveTarget, type Squad, type SquadPlaces } from "../lib/squadTarget.ts";

export interface MoveSquadRider {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  birthdate?: string | null;
  salary?: number | null;
  squad?: string | null;
  is_academy?: boolean | null;
  contract_length?: number | null;
  contract_end_season?: number | null;
  current_production_value?: number | null;
  base_value?: number | null;
  prize_earnings_bonus?: number | null;
}

interface DemoteQuote {
  newSalary?: number | null;
  currentSalary?: number | null;
  keepsContract?: boolean;
  racesCleared?: number | null;
  racesOngoing?: number | null;
  targetSquad?: string;
  squadUsed?: number;
  squadMax?: number;
}

interface Props {
  rider: MoveSquadRider;
  seasonYear: number | null | undefined;
  onClose: () => void;
  onMoved: (squad: Squad) => void;
}

/** Afvisninger dialogen selv kan forklare (academy.json moveSquad.errors.*). */
const KNOWN_MOVE_ERRORS = new Set([
  "same_squad", "too_old_for_squad", "squad_full", "rider_on_market", "rider_listed",
  "rider_in_stage_race", "academy_disabled", "network",
]);

function placesFor(squad: Squad, raw: unknown): SquadPlaces | null {
  if (!raw || typeof raw !== "object") return null;
  const { used, max } = raw as { used?: unknown; max?: unknown };
  return {
    used: typeof used === "number" ? used : null,
    max: typeof max === "number" ? max : null,
  };
}

function capLabels(places: SquadPlaces | null | undefined): { capLabel: string; capAfterLabel: string } | null {
  const used = places?.used;
  const max = places?.max;
  if (typeof used !== "number" || typeof max !== "number") return null;
  return { capLabel: `${used} / ${max}`, capAfterLabel: `${used + 1} / ${max}` };
}

export default function MoveSquadDialog({ rider, seasonYear, onClose, onMoved }: Props) {
  const { t } = useTranslation(["academy", "errors", "common"]);
  const academy = useAcademy();
  const { fetchMoveState, moveRider } = academy;

  // Frisk rytter-state (nuværende trup + løn-grundlag). null indtil hentet.
  const [fresh, setFresh] = useState<MoveSquadRider | null>(null);
  const [freshLoaded, setFreshLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // riders.squad er nyere end de genererede database-typer, derfor castet.
      const state = (await fetchMoveState(rider.id)) as MoveSquadRider | null;
      if (cancelled) return;
      setFresh(state ?? null);
      setFreshLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [rider.id, fetchMoveState]);

  const base: MoveSquadRider = fresh ? { ...rider, ...fresh } : rider;
  const seasonAge: number | null = getRiderAge(base.birthdate, seasonYear);
  const currentSquad = currentSquadOf(base, seasonAge);
  const loading = academy.loading || !freshLoaded;

  const { seniorCount, seniorMax, squads } = academy;
  const places = useMemo(() => ({
    senior: { used: seniorCount, max: seniorMax },
    u23: placesFor("u23", squads?.u23),
    junior: placesFor("junior", squads?.junior),
  }), [seniorCount, seniorMax, squads]);
  const rows = useMemo(
    () => moveSquadRows({ currentSquad, seasonAge, places }),
    [currentSquad, seasonAge, places],
  );

  // Manageren valgte selv en række; ellers (og hvis valget ikke længere er
  // åbent) gælder forvalget fra squadTarget.defaultMoveTarget.
  const [picked, setPicked] = useState<Squad | null>(null);
  const pickedOpen = picked !== null && rows.some((r) => r.squad === picked && r.state === "open");
  const academyOff = !academy.loading && !academy.enabled;
  const selected: Squad | null = academyOff ? null : (pickedOpen ? picked : defaultMoveTarget(rows, currentSquad, seasonAge));

  const direction: "promote" | "demote" | "move" = selected === "senior"
    ? "promote"
    : currentSquad === "senior" ? "demote" : "move";

  // Senior -> ungdom: quoten for NETOP det valgte mål, hentet én gang pr. mål.
  const [quotes, setQuotes] = useState<Partial<Record<Squad, DemoteQuote | null>>>({});
  const needsQuote = !loading && direction === "demote" && selected !== null && !(selected in quotes);
  useEffect(() => {
    if (!needsQuote || selected === null) return;
    let cancelled = false;
    const target = selected;
    (async () => {
      let quote: DemoteQuote | null = null;
      try {
        const { ok, data } = await fetchRiderQuote(rider.id, `academy-demote-quote?squad=${target}`);
        if (ok) quote = data as DemoteQuote;
      } catch { /* netværk: dialogen viser "..." og låser bekræft (#3784) */ }
      if (!cancelled) setQuotes((prev) => ({ ...prev, [target]: quote }));
    })();
    return () => { cancelled = true; };
  }, [needsQuote, selected, rider.id]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moveErrorText = useCallback((code: string | undefined, squad: Squad) => {
    const row = rows.find((r) => r.squad === squad);
    const params = {
      squad: t(`academy:moveSquad.rowName.${squad}`),
      short: t(`academy:moveSquad.shortName.${squad}`),
      max: row?.max ?? "-",
    };
    if (code && KNOWN_MOVE_ERRORS.has(code)) return t(`academy:moveSquad.errors.${code}`, params);
    return resolveApiError({ errorCode: code }, t, t("academy:moveSquad.errors.failed"));
  }, [rows, t]);

  async function confirm(squad: Squad | null) {
    if (!squad || busy) return;
    setBusy(true);
    setError(null);
    const res = (await moveRider(rider.id, squad)) as { ok: boolean; error?: string };
    setBusy(false);
    if (res.ok) {
      onMoved(squad);
      return;
    }
    setError(moveErrorText(res.error, squad));
  }

  // ── Konsekvens-tabellen for det valgte mål ────────────────────────────────
  let consequence: {
    newSalary: number | null;
    currentSalary: number | null;
    keepsContract: boolean;
    capSquad: Squad | null;
    capLabel: string | null;
    capAfterLabel: string | null;
    racesCleared: number | null;
    racesOngoing: number | null;
  } = {
    newSalary: null, currentSalary: null, keepsContract: false,
    capSquad: null, capLabel: null, capAfterLabel: null, racesCleared: null, racesOngoing: null,
  };
  if (selected === "senior") {
    // #3620: en rytter der allerede har en kontrakt beholder den ved oprykning.
    const keepsContract = keepsExistingContractOnPromote(base);
    const cap = capLabels(places.senior);
    consequence = {
      ...consequence,
      newSalary: keepsContract ? (base.salary ?? null) : projectSeniorSalary(base),
      keepsContract,
      capSquad: "senior",
      capLabel: cap?.capLabel ?? null,
      capAfterLabel: cap?.capAfterLabel ?? null,
    };
  } else if (selected !== null && direction === "demote") {
    const quote = quotes[selected] ?? null;
    // #5568: pladserne fra quoten (samme tælling som RPC'en); ellers /academy/me.
    const quoteCap = demoteCapLabels(quote);
    const cap = quoteCap && quoteCap.capSquad === selected ? quoteCap : capLabels(places[selected]);
    consequence = {
      newSalary: quote?.newSalary ?? null,
      currentSalary: quote?.currentSalary ?? base.salary ?? null,
      // #4582: backend afgør om kontrakten arves (hasCompleteContract på en
      // frisk server-SELECT); frontend gætter IKKE ved at sammenligne løn-tal.
      keepsContract: quote?.keepsContract ?? false,
      capSquad: selected,
      capLabel: cap?.capLabel ?? null,
      capAfterLabel: cap?.capAfterLabel ?? null,
      racesCleared: quote?.racesCleared ?? 0,
      racesOngoing: quote?.racesOngoing ?? 0,
    };
  } else if (selected !== null) {
    // junior <-> U23: kun truppen skifter.
    const cap = capLabels(places[selected]);
    consequence = {
      ...consequence,
      newSalary: base.salary ?? null,
      keepsContract: true,
      capSquad: selected,
      capLabel: cap?.capLabel ?? null,
      capAfterLabel: cap?.capAfterLabel ?? null,
    };
  }

  const riderName = `${base.firstname ?? ""} ${base.lastname ?? ""}`.trim();

  return (
    <AcademyTransferConfirmModal
      show
      direction={direction}
      riderName={riderName}
      newSalary={consequence.newSalary}
      currentSalary={consequence.currentSalary}
      capLabel={consequence.capLabel}
      capAfterLabel={consequence.capAfterLabel}
      capSquad={consequence.capSquad}
      racesCleared={consequence.racesCleared}
      racesOngoing={consequence.racesOngoing}
      keepsContract={consequence.keepsContract}
      squadRows={rows}
      selectedSquad={selected}
      onSelectSquad={(squad: Squad) => { setPicked(squad); setError(null); }}
      currentSquad={currentSquad}
      seasonAge={seasonAge}
      loading={loading}
      error={academyOff ? t("academy:moveSquad.errors.academy_disabled") : error}
      busy={busy}
      onCancel={() => { if (!busy) onClose(); }}
      onConfirm={confirm}
    />
  );
}
