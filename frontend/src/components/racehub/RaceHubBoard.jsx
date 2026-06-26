// Race Hub Fase 1 — orkestrator for trup-fordeling-board'et. Henter aggregat-
// endpointet GET /api/races/distribution, ejer URL-params (day/scope), og gemmer
// via det eksisterende PUT /selection pr. løb (guards bevares). Afmeld via
// withdrawal-endpoint; "auto-udfyld" (dual-mode) via regenerate-endpoint.
//
// #1823: alle mutationer tjekker res.ok, viser en mappet fejlbesked (toast), og
// re-henter board'et bagefter (server-sandhed = optimistisk rollback ved fejl).
import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSession } from "../../lib/supabase";
import ContextBand from "./ContextBand.jsx";
import RaceColumn from "./RaceColumn.jsx";
import AvailableRidersPool from "./AvailableRidersPool.jsx";
import DivisionStartLists from "./DivisionStartLists.jsx";
import { isSelectionSavable, draftBindingMap } from "../../lib/raceHubLogic.js";
import { decodeDrag, dropAction } from "../../lib/raceHubDnd.js";
import { Spinner, EmptyState, FlagIcon } from "../ui";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

export default function RaceHubBoard() {
  const { t } = useTranslation("races");
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") || "mine";
  const dayParam = Number.parseInt(params.get("day"), 10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { code, params } | null
  // Rod A (#1823): lokal redigerings-kladde pr. kolonne. add/remove/rolle muterer
  // kladden med det samme; den PUT'es kun når den er en GYLDIG udtagelse (auto-gem-
  // når-gyldig). En ugyldig mellemtilstand (5 eller 7 på en 6/6) lever lokalt uden at
  // gemmes, så manageren kan redigere/bytte frit uden den hårde 6-og-6-lås.
  const [drafts, setDrafts] = useState({}); // raceId → { rider_ids, captain_id, sprint_captain_id, hunter_id }

  const load = useCallback(async (day) => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    // Path som egen literal (query konkateneres separat) — holder /api/races/distribution
    // matchbar for feature-liveness-auditens frontend-scan (ellers læses qs som path-segment).
    const url = `${API}/api/races/distribution`;
    try {
      const res = await fetch(Number.isFinite(day) ? `${url}?day=${day}` : url, { headers });
      if (res.ok) setData(await res.json());
    } catch {
      /* netværk — board forbliver i forrige tilstand */
    }
    setLoading(false);
  }, []);

  // Mine-board hentes kun i "mine"-scope; browse-scopes (division/others, S6) bruger
  // DivisionStartLists med sit eget read-only endpoint.
  useEffect(() => { if (scope === "mine") load(Number.isFinite(dayParam) ? dayParam : undefined); }, [load, dayParam, scope]);
  // Skift af dag/scope viser andre kolonner → ryd kladder (de hører til de gamle løb).
  useEffect(() => { setDrafts({}); }, [dayParam, scope]);

  const setDay = (d) => { params.set("day", String(d)); setParams(params, { replace: true }); };
  const setScope = (s) => { params.set("scope", s); setParams(params, { replace: true }); };

  // Fase 5 (#1835 / S6): read-only "andre divisioner" — pulje-vælger + bruttotrupper.
  // Egen render-gren (eget endpoint + URL-state), så mine-board'et er uændret.
  if (scope !== "mine") return <DivisionStartLists scope={scope} onScopeChange={setScope} />;

  if (loading) return <div className="flex justify-center py-10"><Spinner size={20} /></div>;
  if (!data?.enabled) return null; // flag OFF → board skjult (kalender-faner viser stadig)

  const day = Number.isFinite(dayParam) ? dayParam : (data.focusDay ?? data.currentDay);
  const columns = data.columns || [];
  const roster = columns[0]?.riders || [];

  // Fælles mutations-wrapper: tjek res.ok, surfacér fejlkode (+ evt. params til ICU-
  // beskeden, fx min/max ved selection_wrong_size), re-hent (rollback) bagefter.
  async function mutate(req, errParams = {}) {
    const headers = await authHeaders();
    if (!headers) return;
    setBusy(true);
    setError(null);
    try {
      const res = await req(headers);
      if (res && !res.ok) {
        const body = await res.json().catch(() => ({}));
        setError({ code: body.error || "generic", params: errParams });
      }
    } catch {
      setError({ code: "generic", params: errParams });
    } finally {
      await load(day);
      setBusy(false);
    }
  }

  // Kladden for en kolonne: lokal redigering hvis den findes, ellers server-sandheden.
  const draftOf = (col) => drafts[col.id] || {
    rider_ids: col.selection?.rider_ids || [],
    captain_id: col.selection?.captain_id ?? null,
    sprint_captain_id: col.selection?.sprint_captain_id ?? null,
    hunter_id: col.selection?.hunter_id ?? null,
  };
  const availableCount = (col) => (col.riders || []).filter((r) => !r.injured).length;

  // Gem kladden til serveren (kun kaldt når den er gyldig). Rydder kolonnens kladde
  // bagefter, så visningen re-synkes til server-sandheden (mutate re-henter board'et).
  async function persistDraft(col, sel) {
    const ids = sel.rider_ids;
    const body = {
      rider_ids: ids,
      captain_id: ids.includes(sel.captain_id) ? sel.captain_id : (ids[0] ?? null),
      sprint_captain_id: ids.includes(sel.sprint_captain_id) ? sel.sprint_captain_id : null,
      hunter_id: ids.includes(sel.hunter_id) ? sel.hunter_id : null,
    };
    await mutate(
      (headers) => fetch(`${API}/api/races/${col.id}/selection`, { method: "PUT", headers, body: JSON.stringify(body) }),
      { min: col.size?.min, max: col.size?.max });
    setDrafts((d) => { const next = { ...d }; delete next[col.id]; return next; });
  }

  // Sæt kladden + auto-gem hvis den nu er en gyldig udtagelse (størrelse inden for
  // [effectiveMin, max]). Ugyldig → bliver liggende lokalt (vises som mangler/for mange).
  function commitDraft(col, sel) {
    setDrafts((d) => ({ ...d, [col.id]: sel }));
    if (isSelectionSavable({ count: sel.rider_ids.length, min: col.size?.min, max: col.size?.max, available: availableCount(col) })) {
      persistDraft(col, sel);
    }
  }

  // #1925: atomisk flyt-til-løb (evicter rytteren fra et overlappende kilde-løb i DB).
  async function moveRiderToRace(riderId, toRaceId) {
    await mutate((headers) => fetch(`${API}/api/races/lineup/move`, {
      method: "POST", headers, body: JSON.stringify({ riderId, toRaceId }),
    }));
  }

  const addRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
    // #1925: er rytteren udtaget i et ANDET (overlappende) løb iflg. SERVER-tilstanden? Så
    // er det et MOVE (atomisk eviction + indsæt) — ikke en lokal kladde-add, ellers afviser
    // backend gemmet med selection_rider_bound-409. data.bindingMap er serverens binding;
    // den kladde-bevidste binding bruges kun til at TILBYDE mål i popoveren.
    const serverBound = (data.bindingMap?.[riderId] || []).some((id) => id !== raceId);
    if (serverBound) { moveRiderToRace(riderId, raceId); return; }
    const cur = draftOf(col);
    if (cur.rider_ids.includes(riderId)) return;
    commitDraft(col, { ...cur, rider_ids: [...cur.rider_ids, riderId] });
  };
  const removeRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
    const cur = draftOf(col);
    commitDraft(col, {
      rider_ids: cur.rider_ids.filter((id) => id !== riderId),
      captain_id: cur.captain_id === riderId ? null : cur.captain_id,
      sprint_captain_id: cur.sprint_captain_id === riderId ? null : cur.sprint_captain_id,
      hunter_id: cur.hunter_id === riderId ? null : cur.hunter_id,
    });
  };

  // Klik rytter → rolle: ryd rytteren fra alle roller, sæt den valgte. Kaptajn er
  // påkrævet, så hvis vi rydder kaptajnen uden at sætte en ny, falder vi tilbage til
  // første rytter der ikke har en anden rolle (matcher backend-validering).
  function setRole(raceId, riderId, role) {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
    const sel = draftOf(col);
    const riderIds = sel.rider_ids || [];
    if (!riderIds.includes(riderId)) return;
    let captain = sel.captain_id, sprint = sel.sprint_captain_id, hunter = sel.hunter_id;
    if (captain === riderId) captain = null;
    if (sprint === riderId) sprint = null;
    if (hunter === riderId) hunter = null;
    if (role === "captain") captain = riderId;
    else if (role === "sprint_captain") sprint = riderId;
    else if (role === "hunter") hunter = riderId;
    // Kaptajn er påkrævet og skal være forskellig fra sprint/jæger. Find en rytter uden
    // anden rolle; findes ingen (lille trup hvor alle har en rolle), tag den første og
    // fjern dens evt. anden rolle, så trekanten forbliver distinkt (ellers role_overlap).
    if (!captain) {
      captain = riderIds.find((id) => id !== sprint && id !== hunter) ?? null;
      if (!captain) {
        captain = riderIds[0] ?? null;
        if (captain === sprint) sprint = null;
        if (captain === hunter) hunter = null;
      }
    }
    commitDraft(col, { rider_ids: riderIds, captain_id: captain, sprint_captain_id: sprint, hunter_id: hunter });
  }

  const toggleWithdraw = (raceId, withdraw) =>
    mutate((headers) => fetch(`${API}/api/races/${raceId}/withdrawal`, { method: withdraw ? "POST" : "DELETE", headers }));

  function regenerate(mode) {
    // "all" overskriver alle (også manuelle) → bekræft. "missing" bevarer manuelle.
    if (mode === "all") {
      const hasManual = columns.some((c) => c.selection && c.selection.is_auto_filled === false);
      if (hasManual && !window.confirm(t("racehub.regenerateWarn"))) return;
    }
    return mutate((headers) =>
      fetch(`${API}/api/races/distribution/regenerate?day=${day}&mode=${mode}`, { method: "POST", headers }));
  }

  // Effektive kolonner: kladde-selection overlejret server-data + counts afledt af
  // kladden, så transiente tilstande (5/6 mangler, 7/6 for mange) vises mens man
  // redigerer. RaceColumn + puljen renderer disse, så lås/status følger kladden.
  const effectiveColumns = columns.map((c) => {
    const sel = draftOf(c);
    return {
      ...c,
      selection: { ...sel, is_auto_filled: c.selection?.is_auto_filled ?? false },
      counts: { selected: sel.rider_ids.length, target: c.size?.max ?? sel.rider_ids.length },
    };
  });

  // #1925: kladde-bevidst binding til pulje/popover (afspejler dine live-redigeringer).
  const liveBindingMap = draftBindingMap(effectiveColumns);

  // #1925: oversæt et drag-and-drop til board-handling (add / move / remove).
  function handleDrop(toKind, toRaceId, raw) {
    const payload = decodeDrag(raw);
    if (!payload) return;
    const target = effectiveColumns.find((c) => c.id === toRaceId);
    const targetFull = target ? target.counts.selected >= (target.size?.max ?? Infinity) : false;
    const targetLocked = target ? (!!target.lineup_locked || (target.stages_completed ?? 0) > 0 || !!target.withdrawn) : false;
    const action = dropAction({ fromRaceId: payload.fromRaceId, toRaceId, toKind, targetFull, targetLocked });
    if (action === "add" || action === "move") addRider(toRaceId, payload.riderId);
    else if (action === "remove") removeRider(payload.fromRaceId, payload.riderId);
  }

  return (
    <div data-testid="race-hub-board">
      <ContextBand scope={scope} day={day} currentDay={data.currentDay} timeline={data.timeline} onScopeChange={setScope} onDayChange={setDay} />
      {error && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-cz border border-cz-danger/30 bg-cz-danger/10 px-3 py-2">
          <span className="text-xs text-cz-danger">{t([`selection.errors.${error.code}`, "selection.errors.generic"], error.params)}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("racehub.dismiss")} className="text-cz-danger/70 hover:text-cz-danger text-sm leading-none">×</button>
        </div>
      )}
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-bold text-cz-1">{t("racehub.heading")}</h2>
        <span className="flex items-baseline gap-3">
          <Link to="/races/strategy" className="text-xs text-cz-accent-t hover:underline">{t("strategy.open")}</Link>
          <span className="text-xs text-cz-3">{t("racehub.overlap", { count: columns.length })}</span>
        </span>
      </div>
      {columns.length === 0 ? (
        <EmptyState icon={<FlagIcon size={24} />} title={t("racehub.empty")} />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {effectiveColumns.map((c) => (
              <RaceColumn key={c.id} column={c} busy={busy} onRemoveRider={removeRider} onSetRole={setRole}
                onToggleWithdraw={toggleWithdraw} onDropRider={(raw) => handleDrop("column", c.id, raw)} />
            ))}
          </div>
          <AvailableRidersPool roster={roster} columns={effectiveColumns} bindingMap={liveBindingMap}
            onAddRiderToRace={addRider} onRegenerate={regenerate} busy={busy}
            onDropRider={(raw) => handleDrop("pool", null, raw)} />
        </>
      )}
    </div>
  );
}
