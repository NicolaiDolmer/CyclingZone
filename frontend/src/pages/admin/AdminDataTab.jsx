import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { RACE_CLASSES, getRaceClassLabel } from "../../lib/uciRaceClasses";
import RacePoolSection from "../../components/admin/RacePoolSection";
import RacePointsAdminSection from "../../components/admin/RacePointsAdminSection";
import RiderExplorerSection from "../../components/admin/RiderExplorerSection";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { adminErrorMessage, readAdminJson, useAdminAuth } from "../../components/admin/shared/useAdminAuth";
import { FlagIcon, EditIcon, CheckIcon, XIcon } from "../../components/ui";
import { useTableSort } from "../../lib/useTableSort.js";
import SortableTh from "../../components/ui/SortableTh.jsx";

const API = import.meta.env.VITE_API_URL;

// Løbskalender — sorterbare kolonner (#2294). Klasse sorterer på den
// menneskelæsbare label (samme rækkefølge som visningen), udgave numerisk.
const RACES_SORT_ACCESSORS = {
  name: (r) => r.name ?? null,
  race_class: (r) => (r.race_class ? getRaceClassLabel(r.race_class) : null),
  edition_year: (r) => (typeof r.edition_year === "number" ? r.edition_year : null),
};

export default function AdminDataTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [seasons, setSeasons] = useState([]);
  const [races, setRaces] = useState([]);
  const [racePool, setRacePool] = useState([]);
  const [raceForm, setRaceForm] = useState({
    season_id: "", name: "", race_type: "stage_race",
    race_class: "", stages: 21,
  });
  const [editingRace, setEditingRace] = useState(null);
  const [poolSearchOpen, setPoolSearchOpen] = useState(false);
  const [engineStatus, setEngineStatus] = useState(null);
  const [simBusyId, setSimBusyId] = useState(null);
  const [simPreview, setSimPreview] = useState(null);
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

  const { rows: sortedRaces, sort: racesSort, sortDir: racesSortDir, handleSort: handleRacesSort } =
    useTableSort(races, RACES_SORT_ACCESSORS, { initialDir: "asc" });

  async function loadData() {
    const [s, r, rp] = await Promise.all([
      supabase.from("seasons").select("*").order("number", { ascending: false }),
      supabase.from("races").select("*").order("name"),
      supabase.from("race_pool").select("id, name, race_class, race_type, stages, date_text, country").order("name"),
    ]);
    setSeasons(s.data || []);
    setRaces(r.data || []);
    setRacePool(rp.data || []);
  }

  async function loadEngineStatus() {
    try {
      const res = await fetch(`${API}/api/admin/race-engine-status`, {
        headers: await getAuth(),
      });
      const data = await readAdminJson(res);
      if (res.ok) setEngineStatus(data);
      else showMsg(`Race-motor status: ${adminErrorMessage(data, res)}`, "error");
    } catch (e) {
      showMsg(`Race-motor status fejlede: ${e.message || "ukendt"}`, "error");
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); loadEngineStatus(); }, []);

  async function handleCreateRace(e) {
    e.preventDefault(); setLoad("race", true);
    try {
      const res = await fetch(`${API}/api/admin/races`, {
        method: "POST", headers: await getAuth(),
        body: JSON.stringify({
          ...raceForm,
          stages: parseInt(raceForm.stages),
          race_class: raceForm.race_class || null,
        }),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg(`Løb "${data.name}" tilføjet`); loadData(); setRaceForm(f => ({ ...f, name: "", race_class: "" })); }
      else showMsg(adminErrorMessage(data, res), "error");
    } catch (e) {
      showMsg(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("race", false);
    }
  }

  function pickFromRacePool(poolRace) {
    setRaceForm(f => ({
      ...f,
      name: poolRace.name,
      race_class: poolRace.race_class || "",
      race_type: poolRace.race_type || "single",
      stages: poolRace.stages || 1,
    }));
    setPoolSearchOpen(false);
  }

  async function saveRaceEdit() {
    if (!editingRace) return;
    setLoad("raceEdit", true);
    try {
      const res = await fetch(`${API}/api/admin/races/${editingRace.id}`, {
        method: "PUT",
        headers: await getAuth(),
        body: JSON.stringify({
          name: editingRace.name,
          race_class: editingRace.race_class || null,
          race_type: editingRace.race_type,
          stages: parseInt(editingRace.stages) || 1,
        }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }
      if (res.ok) { showMsg("Løb gemt"); setEditingRace(null); loadData(); }
      else if (res.status === 404) showMsg("Endpoint ikke deployet endnu — vent 1-2 min og prøv igen", "error");
      else showMsg(data.error || `HTTP ${res.status}`, "error");
    } catch (e) {
      showMsg(`Netværksfejl: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("raceEdit", false);
    }
  }

  async function handleDeleteRace(raceId, raceName) {
    if (!confirm(`Slet "${raceName}"?\n\nAlle løbsresultater for dette løb slettes også.`)) return;
    setLoad(`del_race_${raceId}`, true);
    try {
      const res = await fetch(`${API}/api/admin/races/${raceId}`, {
        method: "DELETE", headers: await getAuth(),
      });
      const data = await readAdminJson(res);
      if (res.ok) { showMsg(`${raceName} slettet`); loadData(); }
      else showMsg(adminErrorMessage(data, res), "error");
    } catch (e) {
      showMsg(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad(`del_race_${raceId}`, false);
    }
  }

  // Resultat-indberetning fra PCM (manuel Excel-upload + admin-PCM-import) fjernet fra
  // UI'et 2026-06-19 (#1532): PCM bruges ikke længere til at afvikle løb — race-motoren
  // er resultat-kilden. Backend-pipelinen (POST /admin/import-results-pcm + pcmResultsImport.js)
  // er bevidst bevaret og udfases separat. PCM lever videre som derive-kilde for evner (#1529).

  async function handleSimulate(race, dryRun) {
    if (!dryRun) {
      if (!window.confirm(`Afvikl "${race.name}" med race-motoren? Resultater skrives og bestyrelsen opdateres.`)) return;
    }
    setSimBusyId(race.id);
    try {
      const res = await fetch(`${API}/api/admin/simulate-race`, {
        method: "POST",
        headers: await getAuth(),
        body: JSON.stringify({ race_id: race.id, dry_run: dryRun }),
      });
      const data = await readAdminJson(res);
      if (!res.ok) {
        showMsg(adminErrorMessage(data, res), "error");
        return;
      }
      if (dryRun) {
        setSimPreview({ race, ...data });
      } else {
        setSimPreview(null); // ryd evt. stale dry-run panel med et andet resultat
        showMsg(`${race.name}: ${data.rows} resultatrækker skrevet via motoren`);
        loadEngineStatus();
      }
    } catch (e) {
      showMsg(`Forbindelsen fejlede: ${e.message || "ukendt"}`, "error");
    } finally {
      setSimBusyId(null);
    }
  }

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <AdminSection title={<span className="inline-flex items-center gap-1.5"><FlagIcon size={14} aria-hidden="true" />Race-katalog</span>}>
        <RacePoolSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title="Løbskalender">
        {races.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-lg border border-cz-border">
            <table data-sortable className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <SortableTh sortKey="name" sort={racesSort} sortDir={racesSortDir} onSort={handleRacesSort}
                    className="px-3 py-2 text-left">Løb</SortableTh>
                  <SortableTh sortKey="race_class" sort={racesSort} sortDir={racesSortDir} onSort={handleRacesSort}
                    className="px-3 py-2 text-left hidden sm:table-cell">Klasse</SortableTh>
                  <SortableTh sortKey="edition_year" sort={racesSort} sortDir={racesSortDir} onSort={handleRacesSort}
                    className="px-3 py-2 text-left">Udgave</SortableTh>
                  <th className="px-3 py-2 text-right text-cz-3">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {sortedRaces.map(r => (
                  <>
                    <tr key={r.id} className="border-b border-cz-border hover:bg-cz-subtle">
                      <td className="px-3 py-2.5">
                        <p className="text-cz-1 font-medium">{r.name}</p>
                        <p className="text-cz-3">{r.race_type === "stage_race" ? `${r.stages} etaper` : "Enkeltdagsløb"}</p>
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        {r.race_class ? (
                          <span className="text-cz-accent-t text-xs font-mono">{getRaceClassLabel(r.race_class)}</span>
                        ) : (
                          <span className="text-cz-3 text-xs italic">Ikke sat</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-cz-2">
                        {r.edition_year ? `${r.edition_year}-udgave` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setEditingRace(editingRace?.id === r.id ? null : { ...r })}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded text-xs hover:bg-cz-subtle hover:text-cz-1 transition-all">
                            <EditIcon size={12} aria-hidden="true" />Rediger
                          </button>
                          <button
                            onClick={() => handleDeleteRace(r.id, r.name)}
                            disabled={loading[`del_race_${r.id}`]}
                            className="px-2 py-1 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded text-xs hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
                            {loading[`del_race_${r.id}`] ? "..." : "Slet"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingRace?.id === r.id && (
                      <tr key={`edit-${r.id}`} className="border-b border-cz-accent/10 bg-cz-accent/3">
                        <td colSpan={4} className="px-3 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                            <div className="col-span-2 sm:col-span-1">
                              <label className="block text-cz-3 text-xs mb-1">Løbsnavn</label>
                              <input type="text" value={editingRace.name}
                                onChange={e => setEditingRace(er => ({ ...er, name: e.target.value }))}
                                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Løbsklasse</label>
                              <select value={editingRace.race_class || ""}
                                onChange={e => setEditingRace(er => ({ ...er, race_class: e.target.value }))}
                                className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
                                <option value="">— Ingen klasse —</option>
                                {["Grand Tour", "WorldTour", "Endagsløb", "Continental Circuit"].map(type => (
                                  <optgroup key={type} label={type}>
                                    {RACE_CLASSES.filter(c => c.type === type).map(c => (
                                      <option key={c.key} value={c.key}>{c.label}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Type</label>
                              <select value={editingRace.race_type}
                                onChange={e => setEditingRace(er => ({ ...er, race_type: e.target.value }))}
                                className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
                                <option value="stage_race">Etapeløb</option>
                                <option value="single">Enkeltdagsløb</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Etaper</label>
                              <input type="number" min={1} value={editingRace.stages}
                                onChange={e => setEditingRace(er => ({ ...er, stages: e.target.value }))}
                                className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveRaceEdit} disabled={loading.raceEdit}
                              className="px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
                              {loading.raceEdit ? "Gemmer..." : "Gem ændringer"}
                            </button>
                            <button onClick={() => setEditingRace(null)}
                              className="px-4 py-2 bg-cz-subtle text-cz-2 rounded-lg text-sm hover:bg-cz-subtle">
                              Annuller
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-cz-3 text-xs uppercase tracking-wider mb-2 font-semibold">Tilføj nyt løb</p>
        <form onSubmit={handleCreateRace} className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Sæson</label>
            <select value={raceForm.season_id} onChange={e => setRaceForm(f => ({ ...f, season_id: e.target.value }))} required
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="">Vælg sæson...</option>
              {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number} ({s.status})</option>)}
            </select>
          </div>
          <div className="relative">
            <label className="block text-cz-3 text-xs mb-1">
              Løbsnavn
              <span className="text-cz-3 normal-case ms-1">— søg i katalog eller skriv frihånd</span>
            </label>
            <input type="text" required placeholder="Skriv for at søge i race-katalog..." value={raceForm.name}
              onChange={e => { setRaceForm(f => ({ ...f, name: e.target.value })); setPoolSearchOpen(true); }}
              onFocus={() => setPoolSearchOpen(true)}
              onBlur={() => setTimeout(() => setPoolSearchOpen(false), 150)}
              autoComplete="off"
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
            {poolSearchOpen && raceForm.name.length >= 1 && (() => {
              const q = raceForm.name.toLowerCase().trim();
              const matches = racePool
                .filter(p => p.name.toLowerCase().includes(q))
                .slice(0, 8);
              if (matches.length === 0) return null;
              const seasonRaceNames = new Set(
                races.filter(r => r.season_id === raceForm.season_id).map(r => r.name.toLowerCase())
              );
              return (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-cz-card border border-cz-border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {matches.map(p => {
                    const alreadyInSeason = seasonRaceNames.has(p.name.toLowerCase());
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => pickFromRacePool(p)}
                        className="w-full text-left px-3 py-2 hover:bg-cz-subtle border-b border-cz-border last:border-b-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-cz-1 text-sm truncate">{p.name}</span>
                          {alreadyInSeason && (
                            <span className="text-cz-3 text-xs italic shrink-0">allerede i sæson</span>
                          )}
                        </div>
                        <div className="text-cz-3 text-xs">
                          {getRaceClassLabel(p.race_class) || p.race_class || "ingen klasse"}
                          {" · "}
                          {p.race_type === "stage_race" ? `${p.stages} etaper` : "Enkeltdagsløb"}
                          {p.country ? ` · ${p.country}` : ""}
                          {p.date_text ? ` · ${p.date_text}` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Løbsklasse</label>
            <select value={raceForm.race_class} onChange={e => setRaceForm(f => ({ ...f, race_class: e.target.value }))}
              className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="">— Ingen klasse —</option>
              {["Grand Tour", "WorldTour", "Endagsløb", "Continental Circuit"].map(type => (
                <optgroup key={type} label={type}>
                  {RACE_CLASSES.filter(c => c.type === type).map(c => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Type</label>
            <select value={raceForm.race_type} onChange={e => setRaceForm(f => ({ ...f, race_type: e.target.value }))}
              className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
              <option value="stage_race">Etapeløb</option>
              <option value="single">Enkeltdagsløb</option>
            </select>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Etaper</label>
            <input type="number" min={1} value={raceForm.stages}
              onChange={e => setRaceForm(f => ({ ...f, stages: e.target.value }))}
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={loading.race}
              className="w-full px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
              {loading.race ? "..." : "Tilføj løb"}
            </button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Pointtabel per løbsklasse">
        <RacePointsAdminSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title={<span className="inline-flex items-center gap-1.5"><FlagIcon size={14} aria-hidden="true" />Race-motor V2 (#1102)</span>}>
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <p className="text-cz-2 text-xs">
            Flag:{" "}
            {engineStatus == null
              ? <span className="text-cz-3 italic">ikke hentet endnu</span>
              : engineStatus.enabled
                ? <span className="inline-flex items-center gap-1 text-cz-success font-semibold"><CheckIcon size={12} aria-hidden="true" />ON</span>
                : <span className="inline-flex items-center gap-1 text-cz-danger font-semibold"><XIcon size={12} aria-hidden="true" />OFF <span className="text-cz-3 font-normal">(ægte afvikling deaktiveret — kun preview)</span></span>
            }
          </p>
          <p className="text-cz-3 text-xs italic">preview virker altid; ægte afvikling kræver flag ON</p>
          <button
            onClick={loadEngineStatus}
            className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs hover:bg-cz-subtle hover:text-cz-1 transition-all">
            Genindlæs
          </button>
        </div>

        {engineStatus?.races?.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-lg border border-cz-border">
            <table data-sort-exempt="Admin race-engine-liste; sortering er opfoelgning" className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Løb</th>
                  <th className="px-3 py-2 text-left text-cz-3">Etaper</th>
                  <th className="px-3 py-2 text-left text-cz-3">Profiler</th>
                  <th className="px-3 py-2 text-left text-cz-3">Startfelt</th>
                  <th className="px-3 py-2 text-right text-cz-3">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {engineStatus.races.map(race => {
                  // ready er sat server-side i getRaceEngineStatus (og valideret i runAdminSimulateRace):
                  // kræver at alle race.stages stage-profiler er til stede — single source of truth.
                  return (
                  <tr key={race.id} className="border-b border-cz-border hover:bg-cz-subtle">
                    <td className="px-3 py-2.5">
                      <p className="text-cz-1 font-medium">{race.name}</p>
                      <p className="text-cz-3">{race.race_class || race.race_type}</p>
                    </td>
                    <td className="px-3 py-2.5 text-cz-2">{race.stages}</td>
                    <td className="px-3 py-2.5">
                      {race.ready
                        ? <span className="inline-flex items-center gap-1 text-cz-success"><CheckIcon size={12} aria-hidden="true" />{race.profile_count}</span>
                        : <span className="inline-flex items-center gap-1 text-cz-accent-t"><XIcon size={12} aria-hidden="true" />kør backfill</span>
                      }
                    </td>
                    <td className="px-3 py-2.5 text-cz-2">
                      {race.entry_count > 0 ? race.entry_count : <span className="text-cz-3 italic">auto-fill</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleSimulate(race, true)}
                          disabled={!race.ready || simBusyId === race.id}
                          className="px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded text-xs hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
                          {simBusyId === race.id ? "..." : "Preview"}
                        </button>
                        <button
                          onClick={() => handleSimulate(race, false)}
                          disabled={!race.ready || !engineStatus.enabled || simBusyId === race.id}
                          className="px-2 py-1 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 rounded text-xs hover:bg-cz-accent/20 disabled:opacity-50 transition-all">
                          {simBusyId === race.id ? "..." : "Afvikl"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {engineStatus != null && !engineStatus?.races?.length && (
          <p className="text-cz-3 text-xs italic mb-4">Ingen løb fundet for aktiv sæson.</p>
        )}

        {simPreview && (
          <div className="bg-cz-subtle border border-cz-border rounded-lg p-4 text-xs space-y-3 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-cz-1 font-semibold">
                Preview — {simPreview.race.name}
              </p>
              <button
                onClick={() => setSimPreview(null)}
                className="px-3 py-1.5 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-xs hover:text-cz-1">
                Luk
              </button>
            </div>
            <p className="text-cz-2">
              {simPreview.entrants} ryttere · {simPreview.stages} etaper · {simPreview.rows} resultatrækker
            </p>
            {simPreview.gcPodium?.length > 0 && (
              <div>
                <p className="text-cz-3 uppercase tracking-wider text-xs mb-1 font-semibold">GC-podie</p>
                <p className="text-cz-1">{simPreview.gcPodium.map(p => `${p.rank}. ${p.rider}`).join(" · ")}</p>
              </div>
            )}
            {simPreview.stageWinners?.length > 0 && (
              <div>
                <p className="text-cz-3 uppercase tracking-wider text-xs mb-1 font-semibold">Etapevindere</p>
                <p className="text-cz-1">{simPreview.stageWinners.map(w => `${w.stage}. ${w.rider}`).join(" · ")}</p>
              </div>
            )}
          </div>
        )}
      </AdminSection>

      <AdminSection title="Rider Explorer (fiktiv launch-population)">
        <RiderExplorerSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>
    </>
  );
}
