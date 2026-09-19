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

const API = import.meta.env.VITE_API_URL;

export function useAcademy() {
  const [enabled, setEnabled]   = useState(false);
  const [slots, setSlots]       = useState({ used: 0, max: 8 });
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
      setSlots(data.slots ?? { used: 0, max: 8 });
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
  const resolveGraduate = useCallback(async (riderId, action) => {
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
      await refresh();
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

  // Flyt en U23-senior-rytter ned i akademiet (#932 S7). Returnerer { ok, error?, result? }.
  const demoteRider = useCallback(async (riderId) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    try {
      const res = await apiFetch(`${API}/api/academy/demote`, {
        method: "POST", headers, body: JSON.stringify({ riderId }),
      });
      if (res.networkError) return NETWORK_FAILURE;
      const data = res.data || {};
      if (!res.ok) {
        return { ok: false, error: data.error || "failed" };
      }
      logEvent("academy_demote", { riderId });
      await refresh();
      return { ok: true, result: data };
    } catch {
      return { ok: false, error: "network" };
    }
  }, [refresh]);

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

  return { enabled, slots, seniorCount, seniorMax, roster, intake, graduations, balance, division, intakePull, loading, error, signCandidate, rejectCandidate, resolveGraduate, promoteRider, demoteRider, fetchReleaseQuote, releaseRider, pullIntake, refresh };
}
