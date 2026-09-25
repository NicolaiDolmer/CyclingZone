// useAcademy — frontend-state for Akademi-MVP (#1308).
//
// Henter /api/academy/me (flag-gated), eksponerer signCandidate/rejectCandidate
// + pillar-events academy_sign / academy_reject. Spejler useTraining.

import { useState, useEffect, useCallback } from "react";
import { authHeaders, supabase } from "./supabase.js"; // #4348: kanonisk kopi
// #5242: Retry-After-respekt paa 429 + centraliseret 401-vej. Alle ni kaldsteder
// herunder læser kroppen som `res.data || {}` i stedet for
// `await res.json().catch(() => ({}))`; apiFetch har allerede parset den og
// giver null ved limited/unauthorized/networkError og ved et tomt svar.
import { apiFetch } from "./apiFetch.ts";
import { getAuthedUser } from "./getAuthedUser.js";
// #5242/#5322: apiFetch KASTER ikke ved et netværksudfald — den returnerer
// `networkError: true` med status 0. Hver handling herunder skelnede FØR mellem
// "backenden sagde nej" (fejlkode fra kroppen) og "vi naaede aldrig serveren"
// (fetch'ens rejection → catch → error: "network"), og AcademyPage viser to
// forskellige beskeder for de to. Den skelnen bevares med NETWORK_FAILURE i
// stedet for at lade transportfejlen falde i `!res.ok` og blive til "failed".
const NETWORK_FAILURE = { ok: false, error: "network" };
import { logEvent } from "./logEvent.js";
import { squadCapRows } from "./squadCaps.ts";

// #5568: brugte pladser + loft PR. UNGDOMSTRUP ({ u23:{used,max}, junior:{used,max} })
// fra /api/academy/me. Default = tomme trupper med lofterne fra squadCaps.ts, så
// fladen aldrig falder tilbage til det gamle flade akademi-loft.
const EMPTY_SQUADS = Object.fromEntries(squadCapRows(null).map(({ squad, used, max }) => [squad, { used, max }]));

const API = import.meta.env.VITE_API_URL;

export function useAcademy() {
  const [enabled, setEnabled]   = useState(false);
  const [squads, setSquads]     = useState(EMPTY_SQUADS);
  const [roster, setRoster]     = useState([]);
  const [intake, setIntake]     = useState([]);
  const [graduations, setGraduations] = useState([]);
  const [seniorCount, setSeniorCount] = useState(0);
  const [seniorMax, setSeniorMax] = useState(30);
  const [balance, setBalance]   = useState(null);
  const [division, setDivision] = useState(null); // #2594: løn-satsen er per-division
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  // #3550: pull-baseret intake — { enabled, pulledThisWeek }. enabled=false (default
  // indtil cutover-flip) betyder uændret adfærd (den gamle auto-drip-visning).
  const [intakePull, setIntakePull] = useState({ enabled: false, pulledThisWeek: false });

  // Holdets saldo hentes direkte fra Supabase (samme mønster som AuctionsPage) — så
  // bekræftelses-modalen (#1744) kan vise saldo-effekt uden en backend-ændring på
  // /api/academy/me (ejes af en anden fleet-agent). Fejl er ikke-kritiske: saldo-
  // raekken udelades blot hvis hentningen fejler.
  const refreshBalance = useCallback(async () => {
    try {
      const user = await getAuthedUser();
      if (!user?.id) return;
      const { data: team } = await supabase
        .from("teams")
        .select("balance, division")
        .eq("user_id", user.id)
        .maybeSingle();
      if (team && team.balance != null) setBalance(Number(team.balance));
      if (team && team.division != null) setDivision(Number(team.division));
    } catch {
      /* saldo er nice-to-have — behold tidligere state */
    }
  }, []);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    refreshBalance();
    try {
      const res = await apiFetch(`${API}/api/academy/me`, { headers });
      // Et netværksudfald må ikke sætte en fejl-tilstand på fladen: catch'en
      // nedenfor beholdt FØR den forrige visning ved et fetch-rejection, og et
      // kortvarigt udfald skal stadig bare lade akademiet stå som det var.
      if (res.networkError) { setLoading(false); return; }
      // #5242: res.data kan læses flere gange. Det rå Response kunne ikke — den
      // anden json() på SAMME svar afviste altid med "body stream already read",
      // så et 409 der IKKE var academy_disabled mistede sin fejlkode og endte på
      // det generiske "failed". Nu vises backendens egen kode.
      const body = res.data || {};
      if (res.status === 409 && body.error === "academy_disabled") {
        // Flag disabled — graceful disabled state.
        setEnabled(false);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(body.error || "failed");
        setLoading(false);
        return;
      }
      const data = body;
      setEnabled(data.enabled ?? false);
      setSquads(data.squads ?? EMPTY_SQUADS);
      setRoster(data.roster ?? []);
      setIntake(data.intake ?? []);
      setGraduations(data.graduations ?? []);
      setSeniorCount(data.seniorCount ?? 0);
      setSeniorMax(data.seniorMax ?? 30);
      setIntakePull(data.intakePull ?? { enabled: false, pulledThisWeek: false });
      setError(null);
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, [refreshBalance]);

  useEffect(() => { refresh(); }, [refresh]);

  // Sign-kandidat. Returnerer { ok, error? } (med brugervenlig fejlbesked).
  const signCandidate = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/academy/sign`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        const errKey = data.error || "failed";
        return { ok: false, error: errKey };
      }
      logEvent("academy_sign", { riderId });
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Afvis-kandidat. Returnerer { ok, error? }.
  const rejectCandidate = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/academy/reject`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_reject", { riderId });
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Resolvér en graduate (#932). action ∈ promote|sell|release. Returnerer { ok, error? }.
  //
  // #2491: `options.refresh = false` springer den efterfølgende hentning over.
  // Graduation Day's "Confirm all" kører N valg i træk, og en refetch efter
  // HVERT kald ville sende N-1 overflødige requests og lade listen hoppe under
  // kæden. Siden henter selv ÉN gang til sidst. Default er uændret true, så de
  // eksisterende kaldsteder (AcademyPage) opfører sig præcis som før.
  const resolveGraduate = useCallback(async (riderId, action, { refresh: doRefresh = true } = {}) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/academy/graduate`, {
        method: "POST", headers, body: JSON.stringify({ riderId, action }),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_graduate", { riderId, action });
      if (doRefresh) await refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // Promovér en akademi-rytter til senior-truppen (#932 S7). Returnerer { ok, error? }.
  const promoteRider = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/academy/promote`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_promote", { riderId });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // #3550: hent ugens akademi-kuld (pull-intake). Returnerer { ok, error?, result? }.
  const pullIntake = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/academy/intake/pull`, { method: "POST", headers });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_intake_pull", { alreadyPulled: Boolean(data.alreadyPulled) });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // #5748: flyt en rytter til en VALGT trup ('senior' | 'u23' | 'junior') via
  // POST /api/riders/:id/squad (moveRider i backend). Én handling for alle
  // retninger: op til senior, ned fra senior og junior <-> U23. Afløser den
  // gamle demoteRider, der kun kunne den trup sæsonalderen valgte.
  // Returnerer { ok, error?, result? }.
  const moveRider = useCallback(async (riderId, squad) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/riders/${riderId}/squad`, {
        method: "POST", headers, body: JSON.stringify({ squad }),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.errorCode || data.error || "failed" };
      }
      // Samme to event-navne som før (KNOWN_EVENTS/liveness-audit kender dem):
      // op til senior = academy_promote, alt andet = academy_demote med målet.
      logEvent(data.action === "promoted" ? "academy_promote" : "academy_demote", { riderId, squad, action: data.action ?? null });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  // #5748: flyt-dialogens friske udgangspunkt for rytteren. Rytterprofilen
  // SELECT'er hverken riders.squad eller current_production_value (#3784), så
  // dialogen henter selv den nuværende trup og løn-grundlaget i stedet for at
  // stole på objektet fra den side der åbnede den. null ved fejl: dialogen
  // falder da tilbage til det kalderen gav den.
  const fetchMoveState = useCallback(async (riderId) => {
    try {
      const { data, error: loadErr } = await supabase
        .from("riders")
        .select("id, team_id, squad, is_academy, birthdate, salary, contract_length, contract_end_season, current_production_value, base_value, prize_earnings_bonus")
        .eq("id", riderId)
        .maybeSingle();
      if (loadErr || !data) return null;
      return data;
    } catch {
      return null;
    }
  }, []);

  // #4009: preview af buyout-gebyret for en akademi-fyring (samme fee-formel som
  // senior-release, GET-side af /api/riders/:id/academy-release). Returnerer
  // { ok, data } (samme kontrakt som riderContractActions.js's fetchRiderQuote)
  // så AcademyPage kan vise gebyret som speed-bump før bekræftelse — samme
  // mønster som rytterprofilens Fyr-panel.
  const fetchReleaseQuote = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, data: {} };
    try {
      const res = await apiFetch(`${API}/api/riders/${riderId}/academy-release-quote`, { headers });
      const data = res.data || {};
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: {} };
    }
  }, []);

  // Fyr en akademi-rytter (#4009, ejer-ja 20/8). Rytteren forlader akademiet
  // (team_id=NULL) mod samme buyout-gebyr som senior-fyring. Returnerer
  // { ok, error?, result? } — samme kontrakt som promoteRider/demoteRider.
  const releaseRider = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/riders/${riderId}/academy-release`, {
        method: "POST", headers, body: JSON.stringify({}),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.errorCode || data.error || "failed" };
      }
      logEvent("academy_release", { riderId });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

  return { enabled, squads, seniorCount, seniorMax, roster, intake, graduations, balance, division, intakePull, loading, error, signCandidate, rejectCandidate, resolveGraduate, promoteRider, moveRider, fetchMoveState, fetchReleaseQuote, releaseRider, pullIntake, refresh };
}
