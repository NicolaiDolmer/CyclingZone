import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { RACE_CLASSES, getRaceClassLabel } from "../../lib/uciRaceClasses";
import RacePoolSection from "../../components/admin/RacePoolSection";
import RacePointsAdminSection from "../../components/admin/RacePointsAdminSection";
import AdminSection from "../../components/admin/shared/AdminSection";
import AdminMessageBanner from "../../components/admin/shared/AdminMessageBanner";
import { useAdminAuth } from "../../components/admin/shared/useAdminAuth";

const API = import.meta.env.VITE_API_URL;

export default function AdminDataTab() {
  const { getAuth, showMsg, msg } = useAdminAuth();
  const [seasons, setSeasons] = useState([]);
  const [races, setRaces] = useState([]);
  const [racePool, setRacePool] = useState([]);
  const [raceForm, setRaceForm] = useState({
    season_id: "", name: "", race_type: "stage_race",
    race_class: "", stages: 21, edition_year: "",
  });
  const [editingRace, setEditingRace] = useState(null);
  const [importRaceId, setImportRaceId] = useState("");
  const [importStage, setImportStage] = useState(1);
  const [poolSearchOpen, setPoolSearchOpen] = useState(false);
  const [dynCyclistUrl, setDynCyclistUrl] = useState("");
  const [dynSyncResult, setDynSyncResult] = useState(null);
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsResult, setSheetsResult] = useState(null);
  const [sheetsPreview, setSheetsPreview] = useState(null);
  const [loading, setLoading] = useState({});

  function setLoad(k, v) { setLoading(l => ({ ...l, [k]: v })); }

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

  useEffect(() => { loadData(); }, []);

  async function handleCreateRace(e) {
    e.preventDefault(); setLoad("race", true);
    const res = await fetch(`${API}/api/admin/races`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({
        ...raceForm,
        stages: parseInt(raceForm.stages),
        edition_year: raceForm.edition_year ? parseInt(raceForm.edition_year, 10) : null,
        race_class: raceForm.race_class || null,
      }),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ Løb "${data.name}" tilføjet`); loadData(); setRaceForm(f => ({ ...f, name: "", edition_year: "", race_class: "" })); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("race", false);
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
          edition_year: editingRace.edition_year === "" || editingRace.edition_year == null
            ? null
            : parseInt(editingRace.edition_year, 10),
        }),
      });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }
      if (res.ok) { showMsg("✅ Løb gemt"); setEditingRace(null); loadData(); }
      else if (res.status === 404) showMsg("❌ Endpoint ikke deployet endnu — vent 1-2 min og prøv igen", "error");
      else showMsg(`❌ ${data.error || `HTTP ${res.status}`}`, "error");
    } catch (e) {
      showMsg(`❌ Netværksfejl: ${e.message || "ukendt"}`, "error");
    } finally {
      setLoad("raceEdit", false);
    }
  }

  async function handleDeleteRace(raceId, raceName) {
    if (!confirm(`Slet "${raceName}"?\n\nAlle løbsresultater for dette løb slettes også.`)) return;
    setLoad(`del_race_${raceId}`, true);
    const res = await fetch(`${API}/api/admin/races/${raceId}`, {
      method: "DELETE", headers: await getAuth(),
    });
    const data = await res.json();
    if (res.ok) { showMsg(`✅ ${raceName} slettet`); loadData(); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad(`del_race_${raceId}`, false);
  }

  async function handleImportResults(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!importRaceId) { showMsg("❌ Vælg et løb først", "error"); return; }
    setLoad("import", true);
    showMsg("⏳ Importerer...", "info");
    const { data: { session } } = await supabase.auth.getSession();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("race_id", importRaceId);
    formData.append("stage_number", importStage);
    const res = await fetch(`${API}/api/admin/import-results`, {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: formData,
    });
    const data = await res.json();
    if (res.ok) showMsg(`✅ ${data.records_imported} resultater importeret — ${data.teams_paid} holds fik præmiepenge`);
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("import", false);
    e.target.value = "";
  }

  async function handleDynCyclistSync() {
    if (!dynCyclistUrl) { showMsg("❌ Indsæt Google Sheets URL", "error"); return; }
    setLoad("dyn_cyclist", true);
    showMsg("⏳ Synkroniserer rytterstats...", "info");
    const res = await fetch(`${API}/api/admin/sync-dyn-cyclist`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ spreadsheet_url: dynCyclistUrl }),
    });
    const data = await res.json();
    if (res.ok) { setDynSyncResult(data); showMsg(`✅ Sync fuldført — ${data.rows_matched} ryttere opdateret`); }
    else showMsg(`❌ ${data.error}`, "error");
    setLoad("dyn_cyclist", false);
  }

  async function handleSheetsPreview() {
    if (!sheetsUrl) { showMsg("❌ Indsæt Google Sheets URL", "error"); return; }
    setLoad("sheets_preview", true);
    setSheetsResult(null);
    setSheetsPreview(null);
    showMsg("⏳ Henter forhåndsvisning...", "info");
    const res = await fetch(`${API}/api/admin/import-results-sheets`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ spreadsheet_url: sheetsUrl, dry_run: true }),
    });
    const data = await res.json();
    if (res.ok) {
      setSheetsPreview(data);
      const matchedRaces = data.preview?.length || 0;
      const skipped = data.races_skipped?.length || 0;
      showMsg(`✅ Forhåndsvisning klar — ${matchedRaces} løb matchet, ${skipped} skipped`);
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
    setLoad("sheets_preview", false);
  }

  async function handleSheetsConfirm() {
    if (!sheetsUrl || !sheetsPreview) return;
    setLoad("sheets_import", true);
    showMsg("⏳ Importerer løbsresultater...", "info");
    const res = await fetch(`${API}/api/admin/import-results-sheets`, {
      method: "POST", headers: await getAuth(),
      body: JSON.stringify({ spreadsheet_url: sheetsUrl }),
    });
    const data = await res.json();
    if (res.ok) {
      setSheetsResult(data);
      setSheetsPreview(null);
      showMsg(`✅ Import fuldført — ${data.rows_imported} resultater fra ${data.races_imported.length} løb`);
    } else {
      showMsg(`❌ ${data.error}`, "error");
    }
    setLoad("sheets_import", false);
  }

  function handleSheetsCancelPreview() {
    setSheetsPreview(null);
    showMsg("Forhåndsvisning annulleret", "info");
  }

  return (
    <>
      <AdminMessageBanner msg={msg} />

      <AdminSection title="🏁 Race-katalog">
        <RacePoolSection getAuth={getAuth} onMsg={showMsg} />
      </AdminSection>

      <AdminSection title="Løbskalender">
        {races.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-lg border border-cz-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-3 py-2 text-left text-cz-3">Løb</th>
                  <th className="px-3 py-2 text-left text-cz-3 hidden sm:table-cell">Klasse</th>
                  <th className="px-3 py-2 text-left text-cz-3">Udgave</th>
                  <th className="px-3 py-2 text-right text-cz-3">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {races.map(r => (
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
                            onClick={() => { setImportRaceId(r.id); showMsg(`✅ Valgt til import: ${r.name}`, "info"); }}
                            className={`px-2 py-1 rounded text-xs border transition-all
                              ${importRaceId === r.id
                                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                                : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-1"}`}>
                            {importRaceId === r.id ? "✓ Valgt" : "Vælg"}
                          </button>
                          <button
                            onClick={() => setEditingRace(editingRace?.id === r.id ? null : { ...r })}
                            className="px-2 py-1 bg-cz-subtle text-cz-2 border border-cz-border rounded text-xs hover:bg-cz-subtle hover:text-cz-1 transition-all">
                            ✏ Rediger
                          </button>
                          <button
                            onClick={() => handleDeleteRace(r.id, r.name)}
                            disabled={loading[`del_race_${r.id}`]}
                            className="px-2 py-1 bg-cz-danger-bg text-red-600 border border-cz-danger/30 rounded text-xs hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
                            {loading[`del_race_${r.id}`] ? "..." : "Slet"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingRace?.id === r.id && (
                      <tr key={`edit-${r.id}`} className="border-b border-[#e8c547]/10 bg-cz-accent/3">
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
                            <div>
                              <label className="block text-cz-3 text-xs mb-1">Løbsudgave (årstal)</label>
                              <input type="number" min={2000} max={2099} placeholder="fx 2024"
                                value={editingRace.edition_year || ""}
                                onChange={e => setEditingRace(er => ({ ...er, edition_year: e.target.value }))}
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
              <span className="text-cz-3 normal-case ml-1">— søg i katalog eller skriv frihånd</span>
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
          <div>
            <label className="block text-cz-3 text-xs mb-1">Løbsudgave (årstal)</label>
            <input type="number" min={2000} max={2099} placeholder="fx 2024"
              value={raceForm.edition_year}
              onChange={e => setRaceForm(f => ({ ...f, edition_year: e.target.value }))}
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

      <AdminSection title="Importer løbsresultater (Excel)">
        <p className="text-cz-3 text-xs mb-4">Vælg løb i tabellen ovenfor, angiv etape og upload fil.</p>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Valgt løb</label>
            <p className="text-cz-1 text-sm px-3 py-2 bg-cz-subtle rounded-lg border border-cz-border">
              {races.find(r => r.id === importRaceId)?.name || <span className="text-cz-3 italic">Intet valgt</span>}
            </p>
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Etape #</label>
            <input type="number" min={1} value={importStage}
              onChange={e => setImportStage(parseInt(e.target.value))}
              className="w-24 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-cz-3 text-xs mb-1">Excel-fil</label>
            <label className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-bold border transition-all flex items-center gap-2
              ${importRaceId
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 hover:bg-cz-accent/10"
                : "bg-cz-subtle text-cz-3 border-cz-border cursor-not-allowed"}`}>
              {loading.import ? "⏳ Importerer..." : "📁 Upload fil"}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={handleImportResults} disabled={!importRaceId || loading.import} />
            </label>
          </div>
        </div>
      </AdminSection>

      <AdminSection title="Importer løbsresultater fra Google Sheets">
        <p className="text-cz-3 text-xs mb-4 leading-relaxed">
          Importerer resultater fra et Google Sheet med kolonnerne: <span className="font-mono text-cz-2">Rank, Name, Team, Benævnelse, Løb, Sæson</span>.
          Sæson-kolonnen bestemmer hvilken sæson hvert resultat tilhører — arket kan indeholde flere sæsoner på én gang.
          Løbene skal eksistere i databasen. Re-import sletter og erstatter eksisterende resultater.
          <strong className="text-cz-1"> Forhåndsvis altid før du bekræfter</strong> — preview viser hvilke ryttere/hold der matcher, og hvilke der bliver droppet.
        </p>
        <div className="flex gap-2 flex-wrap items-end mb-3">
          <div className="flex-1">
            <label className="block text-cz-3 text-xs mb-1">Google Sheets URL</label>
            <input type="text" value={sheetsUrl} onChange={e => { setSheetsUrl(e.target.value); setSheetsPreview(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
          </div>
          <button onClick={handleSheetsPreview} disabled={loading.sheets_preview || loading.sheets_import || !sheetsUrl}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
            {loading.sheets_preview ? "Henter..." : "Forhåndsvis"}
          </button>
        </div>

        {sheetsPreview && (
          <div className="bg-cz-subtle border border-cz-border rounded-lg p-4 text-xs space-y-3 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-cz-1 font-semibold">
                Forhåndsvisning — {sheetsPreview.preview.length} løb klar, {sheetsPreview.rows_imported} rækker, {sheetsPreview.races_skipped.length} skipped
              </p>
              <div className="flex gap-2">
                <button onClick={handleSheetsCancelPreview} disabled={loading.sheets_import}
                  className="px-3 py-1.5 bg-cz-subtle text-cz-3 border border-cz-border rounded-lg text-xs hover:text-cz-1 disabled:opacity-50">
                  Annullér
                </button>
                <button onClick={handleSheetsConfirm} disabled={loading.sheets_import || sheetsPreview.preview.length === 0}
                  className="px-3 py-1.5 bg-cz-success text-white border border-cz-success rounded-lg text-xs hover:opacity-90 disabled:opacity-50">
                  {loading.sheets_import ? "Importerer..." : "Bekræft import"}
                </button>
              </div>
            </div>

            {sheetsPreview.races_skipped.length > 0 && (
              <div className="bg-cz-accent-t-bg border border-cz-accent-t/30 rounded p-2">
                <p className="text-cz-accent-t font-semibold mb-1">Skipped løb ({sheetsPreview.races_skipped.length}) — match ikke fundet i DB:</p>
                <p className="text-cz-2">{sheetsPreview.races_skipped.join(", ")}</p>
              </div>
            )}

            {sheetsPreview.preview.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-cz-3 border-b border-cz-border">
                      <th className="text-left py-1 px-2">Sæson</th>
                      <th className="text-left py-1 px-2">Sheet-navn</th>
                      <th className="text-left py-1 px-2">DB-navn</th>
                      <th className="text-right py-1 px-2">Rækker</th>
                      <th className="text-right py-1 px-2">Ryttere ✓</th>
                      <th className="text-right py-1 px-2">Ryttere ⚠</th>
                      <th className="text-right py-1 px-2">Hold ✓</th>
                      <th className="text-right py-1 px-2">Hold ⚠</th>
                      <th className="text-right py-1 px-2">Total points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetsPreview.preview.map((p, i) => (
                      <tr key={i} className="border-b border-cz-border/50 align-top">
                        <td className="py-1 px-2 text-cz-2">{p.season}</td>
                        <td className="py-1 px-2 text-cz-1">{p.sheet_race_name}</td>
                        <td className="py-1 px-2 text-cz-2">{p.db_race_name}</td>
                        <td className="py-1 px-2 text-cz-1 text-right">{p.total_rows}</td>
                        <td className="py-1 px-2 text-cz-success text-right">{p.matched_riders}</td>
                        <td className="py-1 px-2 text-right" title={p.unmatched_riders.join(", ")}>
                          <span className={p.unmatched_riders.length > 0 ? "text-cz-accent-t" : "text-cz-3"}>
                            {p.unmatched_riders.length}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-cz-success text-right">{p.matched_teams}</td>
                        <td className="py-1 px-2 text-right" title={p.unmatched_teams.join(", ")}>
                          <span className={p.unmatched_teams.length > 0 ? "text-cz-accent-t" : "text-cz-3"}>
                            {p.unmatched_teams.length}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-cz-1 text-right">{p.total_points.toLocaleString("da-DK")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-cz-3 text-xs mt-2 italic">Hover over ⚠-tal for at se navne på unmatched.</p>
              </div>
            ) : (
              <p className="text-cz-accent-t">Ingen løb klar til import — alle blev skipped.</p>
            )}
          </div>
        )}

        {sheetsResult && (
          <div className="bg-cz-success-bg border border-cz-success/30 rounded-lg px-4 py-3 text-xs space-y-2">
            <p className="text-cz-success font-semibold">Import fuldført — {sheetsResult.rows_imported} resultater fra {sheetsResult.races_imported.length} løb</p>
            {sheetsResult.seasons?.length > 0 && (
              <div className="flex gap-4 text-green-600 flex-wrap">
                {sheetsResult.seasons.map(s => (
                  <span key={s.season}>Sæson {s.season}: <strong>{s.races}</strong> løb · <strong>{s.rows}</strong> rækker</span>
                ))}
              </div>
            )}
            {sheetsResult.races_skipped.length > 0 && (
              <p className="text-cz-accent-t">Ikke matchet ({sheetsResult.races_skipped.length}): {sheetsResult.races_skipped.join(", ")}</p>
            )}
          </div>
        )}
      </AdminSection>

      <AdminSection title="dyn_cyclist stats sync">
        <p className="text-cz-3 text-xs mb-4">
          Opdaterer rytterstats fra PCM dyn_cyclist Google Sheet. Match sker på pcm_id (IDcyclist-kolonne).
          Synkroniserer: FL, BJ, KB, BK, TT, PRL, BRO, SP, ACC, NED, UDH, MOD, RES, FTR, højde, vægt, popularitet.
        </p>
        <div className="flex gap-2 flex-wrap items-end mb-3">
          <div className="flex-1">
            <label className="block text-cz-3 text-xs mb-1">Google Sheets URL</label>
            <input type="text" value={dynCyclistUrl} onChange={e => setDynCyclistUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent" />
          </div>
          <button onClick={handleDynCyclistSync} disabled={loading.dyn_cyclist || !dynCyclistUrl}
            className="px-4 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50 transition-all">
            {loading.dyn_cyclist ? "Synkroniserer..." : "Synkroniser"}
          </button>
        </div>
        {dynSyncResult && (
          <div className="bg-cz-success-bg border border-cz-success/30 rounded-lg px-4 py-3 text-xs">
            <p className="text-cz-success font-semibold mb-1">Sync fuldført</p>
            <div className="flex gap-4 text-green-600">
              <span>Rækker i ark: <strong>{dynSyncResult.rows_in_sheet}</strong></span>
              <span>Opdateret: <strong>{dynSyncResult.rows_matched}</strong></span>
              <span>Ikke fundet: <strong>{dynSyncResult.not_found}</strong></span>
            </div>
          </div>
        )}
      </AdminSection>
    </>
  );
}
