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
import { draftBindingMap, findSelectionOverlaps } from "../../lib/raceHubLogic.js";
import { decodeDrag, dropAction } from "../../lib/raceHubDnd.js";
import { pickFallbackCaptain } from "../../lib/raceSelectionLogic.js";
import { Spinner, EmptyState, FlagIcon, Button } from "../ui";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

// Er en kolonnes kladde forskellig fra server-sandheden? (ugemte ændringer). Pure → delt af
// dirty-tælleren (UI) og beforeunload-vagten, så de aldrig divergerer.
function selectionDirty(draft, serverSel) {
  if (!draft) return false;
  const s = serverSel || {};
  const a = [...(draft.rider_ids || [])].sort().join(",");
  const b = [...(s.rider_ids || [])].sort().join(",");
  return a !== b
    || (draft.captain_id ?? null) !== (s.captain_id ?? null)
    || (draft.sprint_captain_id ?? null) !== (s.sprint_captain_id ?? null)
    || (draft.hunter_id ?? null) !== (s.hunter_id ?? null);
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
  // Ugemte ændringer på board'et (afledt; delt af forlad-vagt + dag/scope-guard + UI-bar).
  const boardDirty = (data?.columns || []).some((col) => selectionDirty(drafts[col.id], col.selection));
  // Skift af dag/scope viser andre kolonner → ryd kladder (de hører til de gamle løb).
  useEffect(() => { setDrafts({}); }, [dayParam, scope]);
  // Forlad-vagt (ejer 28/6): advar ved luk/genindlæsning hvis der er ugemte ændringer.
  // (BrowserRouter → ingen useBlocker; beforeunload dækker browser-niveau.)
  useEffect(() => {
    if (!boardDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [boardDirty]);

  // In-app dag/scope-skift rydder kladderne (effekten ovenfor) → bekræft FØRST hvis ugemt,
  // ellers ryger ændringerne tavst (CodeRabbit). Afbryder manageren, sker skiftet ikke.
  const confirmLeaveIfDirty = () => !boardDirty || window.confirm(t("racehub.leaveUnsaved"));
  const setDay = (d) => { if (!confirmLeaveIfDirty()) return; params.set("day", String(d)); setParams(params, { replace: true }); };
  const setScope = (s) => { if (!confirmLeaveIfDirty()) return; params.set("scope", s); setParams(params, { replace: true }); };

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
  // Ugemte ændringer (ejer 28/6: INGEN auto-gem — eksplicit Gem-knap).
  const columnDirty = (col) => selectionDirty(drafts[col.id], col.selection);
  const dirtyColumns = columns.filter(columnDirty);
  const isDirty = dirtyColumns.length > 0;

  // commitDraft muterer KUN den lokale kladde. Persistering sker udelukkende via "Gem ændringer".
  // Rediger frit i vilkårlig rækkefølge — fjern en rytter → han er straks fri i kladden til et andet løb.
  function commitDraft(col, sel) {
    setDrafts((d) => ({ ...d, [col.id]: sel }));
  }

  // Gem ALLE ændrede kolonner i to faser, så ryttere kan flyttes mellem OVERLAPPENDE løb —
  // inkl. 2-vejs-bytte, hvor en simpel sortering deadlocker (begge løb beholder deres tilføjede
  // rytter indtil det andets PUT kører). Fase 1 frigiver (gem beholdt sæt for løb der fjerner),
  // fase 2 binder (gem fuld endelig trup). Delvis trup er gyldig (backend, top-fyldes ved race-tid).
  // Fejl pr. kolonne stopper og bevarer de resterende kladder.
  async function saveAll() {
    const headers = await authHeaders();
    if (!headers) return;
    setBusy(true); setError(null);
    const serverIdsOf = (col) => new Set(col.selection?.rider_ids || []);
    const draftIdsOf = (col) => draftOf(col).rider_ids;
    const addedCount = (col) => { const s = serverIdsOf(col); return draftIdsOf(col).filter((id) => !s.has(id)).length; };
    const removedCount = (col) => { const d = new Set(draftIdsOf(col)); return [...serverIdsOf(col)].filter((id) => !d.has(id)).length; };
    const putColumn = async (col, ids) => {
      const sel = draftOf(col);
      // Roller skal være distinkte (backend afviser captain==sprint/hunter med role_overlap).
      // Når fase 1's beholdte sæt IKKE indeholder draft-kaptajnen, vælg en fallback der ikke
      // kolliderer med sprint/jæger; tvinges vi til ids[0] som er en anden rolle, ryd den rolle.
      let sprint = ids.includes(sel.sprint_captain_id) ? sel.sprint_captain_id : null;
      let hunter = ids.includes(sel.hunter_id) ? sel.hunter_id : null;
      let captain = ids.includes(sel.captain_id) ? sel.captain_id : null;
      if (!captain && ids.length) {
        // #2028: fortjenst-baseret fallback (stærkeste rytter), ikke positionel ids[0].
        const suitabilityOf = (id) => col.riders?.find((r) => r.id === id)?.suitability;
        captain = pickFallbackCaptain({ riderIds: ids, sprintId: sprint, hunterId: hunter, suitabilityOf });
        if (captain === sprint) sprint = null;
        if (captain === hunter) hunter = null;
      }
      const body = { rider_ids: ids, captain_id: captain ?? null, sprint_captain_id: sprint, hunter_id: hunter };
      // #2173: putColumn returnerer et resultat-objekt i stedet for selv at kalde setError.
      // Én PUT der fejler må IKKE stoppe de andre kolonners gem (det var rod-årsagen: et
      // `break` efterlod resten ugemt, mens KUN én fejl blev vist → manageren troede alt
      // blev gemt, og næste dag/scope-skift ryddede de tabte kladder tavst). saveAll samler
      // alle fejl og viser hvilke løb der IKKE blev gemt.
      let res;
      try {
        res = await fetch(`${API}/api/races/${col.id}/selection`, { method: "PUT", headers, body: JSON.stringify(body) });
      } catch {
        return { ok: false, error: { code: "generic", params: { min: col.size?.min, max: col.size?.max } } };
      }
      if (res && !res.ok) {
        const b = await res.json().catch(() => ({}));
        // #1983/#1984: backend's overlap-afvisning er opak ("en rytter kører et overlappende løb").
        // Den NAVNGIVES her — rytter + det konkrete overlappende løb — udledt af kladden + bound_rider_ids.
        if (b.error === "selection_rider_bound") {
          const draftCols = columns.map((c) => ({ ...c, selection: { rider_ids: draftOf(c).rider_ids } }));
          const overlaps = findSelectionOverlaps({ columns: draftCols });
          const boundIds = new Set(b.bound_rider_ids || []);
          // Vælg KONFLIKTEN der involverer netop dette løb (col) — ikke bare en hvilken som
          // helst overlap-par med en bundet rytter (CodeRabbit): en rytter kan optræde i flere
          // overlap-par, så filtrér på col.id først, ellers navngives det forkerte blokerende løb.
          const conf =
            overlaps.find((o) => o.raceIds.includes(col.id) && boundIds.has(o.riderId)) ||
            overlaps.find((o) => o.raceIds.includes(col.id));
          if (conf) {
            const riderName = roster.find((r) => r.id === conf.riderId)?.name || "—";
            const otherName = conf.raceIds[0] === col.id ? conf.raceNames[1] : conf.raceNames[0];
            return { ok: false, error: { code: "selection_rider_bound_named", params: { rider: riderName, race: otherName } } };
          }
        }
        return { ok: false, error: { code: b.error || "generic", params: { min: col.size?.min, max: col.size?.max } } };
      }
      return { ok: true };
    };
    const savedIds = [];
    const releasedFinal = new Set(); // rene fjernelser: endelige allerede efter fase 1
    const failedCols = []; // #2173: løb der IKKE blev gemt (navn + fejl), til den tydelige besked
    // Kolonner hvis fase-1-frigivelse fejlede: deres tilføjede ryttere er ikke frigivet
    // sikkert, så de springes også over i fase 2 (undgå at binde mod et ikke-frigivet sæt).
    const releaseFailed = new Set();
    let firstError = null;
    const recordFail = (col, error) => {
      failedCols.push(col);
      if (!firstError) firstError = error; // bevar den mest specifikke (fx navngiven binding)
    };
    try {
      // Fase 1 (frigiv): løb der fjerner ryttere → gem deres beholdte sæt (kladde ∩ server) først.
      // #2173: fortsæt gennem ALLE (ingen break) — én fejl stopper ikke resten.
      for (const col of dirtyColumns) {
        if (removedCount(col) === 0) continue;
        const retained = draftIdsOf(col).filter((id) => serverIdsOf(col).has(id));
        const r = await putColumn(col, retained);
        if (!r.ok) { recordFail(col, r.error); releaseFailed.add(col.id); continue; }
        if (addedCount(col) === 0) { releasedFinal.add(col.id); savedIds.push(col.id); }
      }
      // Fase 2 (bind): gem fuld endelig trup for resten — tilføjede ryttere er nu frie på serveren.
      for (const col of dirtyColumns) {
        if (releasedFinal.has(col.id) || releaseFailed.has(col.id)) continue;
        const r = await putColumn(col, draftIdsOf(col));
        if (!r.ok) { recordFail(col, r.error); continue; }
        savedIds.push(col.id);
      }
    } catch {
      setError({ code: "generic" });
    } finally {
      await load(day);
      setDrafts((d) => { const next = { ...d }; for (const id of savedIds) delete next[id]; return next; });
      setBusy(false);
    }
    // #2173: tydelig besked om at gemme delvist fejlede — navngiv de løb der IKKE blev gemt,
    // så en enkelt fejl aldrig kan skjule et tavst tab af en anden kolonnes udtagelse.
    if (failedCols.length === 1) {
      setError(firstError);
    } else if (failedCols.length > 1) {
      setError({ code: "saveAllPartial", params: { races: failedCols.map((c) => c.name).join(", ") } });
    }
  }

  const discardAll = () => { setDrafts({}); setError(null); };

  const addRider = (raceId, riderId) => {
    const col = columns.find((c) => c.id === raceId);
    if (!col) return;
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
      // #2028: fortjenst-baseret fallback (stærkeste rytter), ikke positionel ids[0].
      const suitabilityOf = (id) => col.riders?.find((r) => r.id === id)?.suitability;
      captain = pickFallbackCaptain({ riderIds, sprintId: sprint, hunterId: hunter, suitabilityOf });
      if (captain === sprint) sprint = null;
      if (captain === hunter) hunter = null;
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
    // Flyt = ren kladde-operation (ejer 28/6): fjern fra kilde + tilføj til mål. Ingen server-
    // move undervejs; binding håndhæves ved Gem. Kilde-løbet må gerne ende underbemandet.
    if (action === "add") addRider(toRaceId, payload.riderId);
    else if (action === "move") { removeRider(payload.fromRaceId, payload.riderId); addRider(toRaceId, payload.riderId); }
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
      {/* Ejer 28/6: eksplicit Gem (ingen auto-save). Sticky dirty-bar med Gem/Kassér + forlad-vagt. */}
      {isDirty && (
        <div className="sticky top-2 z-10 mb-3 flex items-center justify-between gap-3 rounded-cz border border-cz-accent/40 bg-cz-accent/10 px-3 py-2">
          <span className="text-xs text-cz-1">{t("racehub.unsaved", { count: dirtyColumns.length })}</span>
          <span className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={discardAll} disabled={busy}>{t("racehub.discard")}</Button>
            <Button variant="primary" size="sm" onClick={saveAll} loading={busy}>{t("racehub.save")}</Button>
          </span>
        </div>
      )}
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
