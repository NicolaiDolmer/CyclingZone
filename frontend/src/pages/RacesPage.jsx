import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import * as XLSX from "@e965/xlsx";

const RESULT_TYPES = [
  { key: "stage", label: "Etape" },
  { key: "gc", label: "Samlet" },
  { key: "points", label: "Point" },
  { key: "mountain", label: "Bjerg" },
  { key: "young", label: "Unge" },
];

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = new Date() - new Date(dateStr);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  if (d > 0) return `${d}d siden`;
  if (h > 0) return `${h}t siden`;
  return "Lige nu";
}

export default function RacesPage() {
  const navigate = useNavigate();
  const [races, setRaces] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRace, setSelectedRace] = useState(null);
  const [tab, setTab] = useState("calendar");
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState(null);
  const [pending, setPending] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  // Upload state
  const [uploadedRows, setUploadedRows] = useState([]);
  const [uploadRaceId, setUploadRaceId] = useState("");
  const [uploadStage, setUploadStage] = useState(1);
  const [uploadResultType, setUploadResultType] = useState("stage");
  const [editingRows, setEditingRows] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user.id);
    const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).single();
    setIsAdmin(userData?.role === "admin");

    const [seasonRes, racesRes, pendingRes] = await Promise.all([
      supabase.from("seasons").select("*").eq("status", "active").single(),
      supabase.from("races").select("*, results:race_results(id)").order("start_date"),
      supabase.from("pending_race_results")
        .select("*, race:race_id(name), submitter:submitted_by(username)")
        .order("submitted_at", { ascending: false }),
    ]);

    setSeason(seasonRes.data);
    setRaces(racesRes.data || []);
    setPending(pendingRes.data || []);
    if (racesRes.data?.length) setUploadRaceId(racesRes.data[0].id);
    setLoading(false);
  }

  async function loadRaceResults(raceId) {
    const { data } = await supabase
      .from("race_results")
      .select("*, rider:rider_id(id, firstname, lastname, team:team_id(name))")
      .eq("race_id", raceId)
      .order("result_type")
      .order("rank");
    return data || [];
  }

  async function handleRaceClick(race) {
    setSelectedRace({ ...race, results: null, loading: true });
    const results = await loadRaceResults(race.id);
    setSelectedRace({ ...race, results, loading: false });
  }

  // Parse Excel file
  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      // Expect columns: Rank, Rider Name (or Rider ID)
      const parsed = rows.slice(1).filter(r => r[0] && r[1]).map((r, i) => ({
        rank: parseInt(r[0]) || i + 1,
        rider_name: String(r[1] || "").trim(),
        rider_id: null,
        matched: false,
      }));
      setUploadedRows(parsed);
      setEditingRows(parsed.map(r => ({ ...r })));
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  }

  // Match rider names to IDs
  async function matchRiders() {
    const names = editingRows.map(r => r.rider_name);
    const updated = [...editingRows];
    for (let i = 0; i < updated.length; i++) {
      const parts = updated[i].rider_name.trim().split(" ");
      const lastname = parts[parts.length - 1];
      const { data } = await supabase.from("riders")
        .select("id, firstname, lastname")
        .ilike("lastname", `%${lastname}%`)
        .limit(3);
      if (data?.length === 1) {
        updated[i].rider_id = data[0].id;
        updated[i].matched = true;
        updated[i].matched_name = `${data[0].firstname} ${data[0].lastname}`;
      }
    }
    setEditingRows(updated);
  }

  async function submitResults() {
    if (!uploadRaceId) { setSubmitMsg("❌ Vælg et løb"); return; }
    const unmatched = editingRows.filter(r => !r.rider_id);
    if (unmatched.length > 0) {
      setSubmitMsg(`❌ ${unmatched.length} ryttere er ikke matchet — ret dem manuelt`);
      return;
    }
    setSubmitting(true);
    // Create pending submission
    const { data: pending, error } = await supabase
      .from("pending_race_results")
      .insert({ race_id: uploadRaceId, submitted_by: userId, status: "pending" })
      .select("id").single();
    if (error) { setSubmitMsg(`❌ ${error.message}`); setSubmitting(false); return; }

    // Insert rows
    const rows = editingRows.map(r => ({
      pending_id: pending.id,
      rider_id: r.rider_id,
      result_type: uploadResultType,
      rank: r.rank,
      stage_number: uploadStage,
    }));
    await supabase.from("pending_race_result_rows").insert(rows);
    setSubmitMsg("✅ Resultater indsendt — afventer godkendelse fra admin");
    setEditingRows([]);
    setUploadedRows([]);
    loadAll();
    setSubmitting(false);
  }

  async function approveSubmission(pendingId) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/approve-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ pending_id: pendingId }),
    });
    const data = await res.json();
    if (res.ok) {
      loadAll();
    } else {
      alert(data.error);
    }
  }

  async function rejectSubmission(pendingId, note) {
    await supabase.from("pending_race_results")
      .update({ status: "rejected", admin_note: note, reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", pendingId);
    loadAll();
  }

  const racesByStatus = {
    upcoming: races.filter(r => !r.results?.length && r.status !== "completed"),
    completed: races.filter(r => r.results?.length > 0 || r.status === "completed"),
  };

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Løbskalender</h1>
          <p className="text-cz-3 text-sm">
            {season ? `Sæson ${season.number}` : "Ingen aktiv sæson"} — {races.length} løb
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "calendar", label: "📅 Kalender" },
          { key: "submit", label: "📤 Indberét resultater" },
          ...(isAdmin ? [{ key: "approve", label: `⚙ Godkend (${pending.filter(p => p.status === "pending").length})` }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Calendar tab */}
      {tab === "calendar" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            {/* Upcoming */}
            {racesByStatus.upcoming.length > 0 && (
              <div className="mb-5">
                <h2 className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">Kommende</h2>
                <div className="flex flex-col gap-2">
                  {racesByStatus.upcoming.map(race => (
                    <div key={race.id}
                      className={`bg-cz-card border rounded-xl p-4 cursor-pointer transition-all
                        ${selectedRace?.id === race.id ? "border-cz-accent/40" : "border-cz-border hover:border-cz-border"}`}
                      onClick={() => handleRaceClick(race)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-cz-1 font-semibold text-sm">{race.name}</p>
                          <p className="text-cz-3 text-xs mt-0.5">
                            {race.race_type === "stage_race" ? `Etapeløb · ${race.stages} etaper` : "Enkeltdagsløb"}
                          </p>
                        </div>
                        <div className="text-right">
                          {race.start_date && (
                            <p className="text-cz-2 text-xs">
                              {new Date(race.start_date).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}
                            </p>
                          )}
                          <p className="text-cz-accent-t text-xs font-mono mt-0.5">{race.prize_pool?.toLocaleString("da-DK")} CZ$</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {racesByStatus.completed.length > 0 && (
              <div>
                <h2 className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">Afsluttede</h2>
                <div className="flex flex-col gap-2">
                  {racesByStatus.completed.map(race => (
                    <div key={race.id}
                      className={`bg-cz-card border rounded-xl p-4 cursor-pointer transition-all
                        ${selectedRace?.id === race.id ? "border-cz-accent/40" : "border-cz-border hover:border-cz-border"}`}
                      onClick={() => handleRaceClick(race)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-cz-1 font-medium text-sm">{race.name}</p>
                          <p className="text-cz-3 text-xs mt-0.5">
                            {race.results?.length || 0} resultater importeret
                          </p>
                        </div>
                        <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success border border-cz-success/30 px-2 py-0.5 rounded-full">
                          Afsluttet
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {races.length === 0 && (
              <div className="text-center py-16 text-cz-3">
                <p className="text-4xl mb-3">🏁</p>
                <p>Ingen løb i denne sæson endnu</p>
                {isAdmin && <p className="text-xs mt-2">Tilføj løb i Admin-panelet</p>}
              </div>
            )}
          </div>

          {/* Race detail panel */}
          <div>
            {selectedRace ? (
              <div className="bg-cz-card border border-cz-border rounded-xl p-5 sticky top-4">
                <h2 className="text-cz-1 font-bold text-base mb-1">{selectedRace.name}</h2>
                <p className="text-cz-3 text-xs mb-4">
                  {selectedRace.race_type === "stage_race" ? `${selectedRace.stages} etaper` : "Enkeltdagsløb"}
                  {selectedRace.start_date && ` · ${new Date(selectedRace.start_date).toLocaleDateString("da-DK")}`}
                  {` · ${selectedRace.prize_pool?.toLocaleString("da-DK")} CZ$ præmiepulje`}
                </p>

                {selectedRace.loading && (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
                  </div>
                )}

                {!selectedRace.loading && selectedRace.results?.length === 0 && (
                  <div className="text-center py-8 text-cz-3 text-sm">
                    <p>Ingen resultater importeret endnu</p>
                    <button onClick={() => setTab("submit")}
                      className="mt-3 text-cz-accent-t text-xs hover:underline">
                      Indberét resultater →
                    </button>
                  </div>
                )}

                {!selectedRace.loading && selectedRace.results?.length > 0 && (
                  <div>
                    {RESULT_TYPES.map(rt => {
                      const rows = selectedRace.results.filter(r => r.result_type === rt.key).slice(0, 10);
                      if (!rows.length) return null;
                      return (
                        <div key={rt.key} className="mb-4">
                          <p className="text-cz-2 text-xs uppercase tracking-wider mb-2 font-semibold">{rt.label}</p>
                          <table className="w-full text-xs">
                            <tbody>
                              {rows.map(r => (
                                <tr key={r.id} className="border-b border-cz-border last:border-0">
                                  <td className="py-1.5 w-6 text-cz-3 font-mono">#{r.rank}</td>
                                  <td className="py-1.5 cursor-pointer hover:text-cz-accent-t transition-colors"
                                    onClick={() => navigate(`/riders/${r.rider?.id}`)}>
                                    <span className="text-cz-1">{r.rider?.firstname} {r.rider?.lastname}</span>
                                    <span className="text-cz-3 ml-2">{r.rider?.team?.name || "Fri"}</span>
                                  </td>
                                  <td className="py-1.5 text-right text-cz-success font-mono">
                                    {r.prize_money > 0 ? `+${r.prize_money}` : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-cz-card border border-cz-border rounded-xl p-8 text-center text-cz-3 sticky top-4">
                <p className="text-3xl mb-2">🏁</p>
                <p className="text-sm">Vælg et løb for at se detaljer</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Submit results tab */}
      {tab === "submit" && (
        <div className="max-w-2xl">
          <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">Indberét løbsresultater</h2>
            <p className="text-cz-3 text-xs mb-5 leading-relaxed">
              Upload en Excel-fil med resultater fra PCM. Kolonner: <span className="text-cz-2 font-mono">Placering | Rytternavn</span>.
              Du kan efterfølgende rette navnematching inden du indsender. Admin godkender inden resultaterne er officielle.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-cz-3 text-xs mb-1">Løb</label>
                <select value={uploadRaceId} onChange={e => setUploadRaceId(e.target.value)}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
                  {races.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Etape</label>
                <input type="number" min={1} value={uploadStage}
                  onChange={e => setUploadStage(parseInt(e.target.value))}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-cz-3 text-xs mb-1">Type</label>
                <select value={uploadResultType} onChange={e => setUploadResultType(e.target.value)}
                  className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
                  {RESULT_TYPES.map(rt => <option key={rt.key} value={rt.key}>{rt.label}</option>)}
                </select>
              </div>
            </div>

            <label className="block cursor-pointer mb-4">
              <div className="border-2 border-dashed border-cz-border hover:border-cz-accent/40
                rounded-xl p-6 text-center transition-all">
                <p className="text-cz-3 text-sm">📁 Klik for at uploade PCM Excel-fil (.xlsx, .xls)</p>
                <p className="text-cz-3 text-xs mt-1">Forventet format: Placering i kolonne A, Rytternavn i kolonne B</p>
              </div>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
            </label>

            {editingRows.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-cz-2 text-xs">{editingRows.length} ryttere uploadet</p>
                  <button onClick={matchRiders}
                    className="px-3 py-1.5 bg-cz-info-bg0/10 text-cz-info border border-blue-500/20 rounded-lg text-xs hover:bg-cz-info-bg0/20">
                    Auto-match navne
                  </button>
                </div>

                <div className="bg-cz-subtle rounded-xl overflow-hidden mb-4 max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-cz-card">
                      <tr className="border-b border-cz-border">
                        <th className="px-3 py-2 text-left text-cz-3 w-10">#</th>
                        <th className="px-3 py-2 text-left text-cz-3">Fra PCM</th>
                        <th className="px-3 py-2 text-left text-cz-3">Matchet til</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingRows.map((row, i) => (
                        <tr key={i} className="border-b border-cz-border">
                          <td className="px-3 py-2 text-cz-2 font-mono">{row.rank}</td>
                          <td className="px-3 py-2 text-cz-2">{row.rider_name}</td>
                          <td className="px-3 py-2">
                            {row.matched ? (
                              <span className="text-cz-success text-xs">✓ {row.matched_name}</span>
                            ) : (
                              <span className="text-cz-danger text-xs">⚠ Ikke matchet</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {submitMsg && (
                  <div className={`mb-3 px-4 py-2.5 rounded-lg text-sm border
                    ${submitMsg.startsWith("✅") ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
                    {submitMsg}
                  </div>
                )}

                <button onClick={submitResults} disabled={submitting}
                  className="w-full py-2.5 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm
                    hover:brightness-110 disabled:opacity-50 transition-all">
                  {submitting ? "Indsender..." : "Indsend til godkendelse"}
                </button>
              </div>
            )}
          </div>

          {/* My past submissions */}
          {pending.filter(p => p.submitted_by === userId).length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-xl p-5">
              <h3 className="text-cz-1 font-semibold text-sm mb-3">Mine indberetninger</h3>
              <div className="flex flex-col gap-2">
                {pending.filter(p => p.submitted_by === userId).map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-cz-border last:border-0">
                    <div>
                      <p className="text-cz-1 text-sm">{p.race?.name}</p>
                      <p className="text-cz-3 text-xs">{timeAgo(p.submitted_at)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border
                      ${p.status === "pending" ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" :
                        p.status === "approved" ? "bg-cz-success-bg text-cz-success border-cz-success/30" :
                        "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
                      {p.status === "pending" ? "Afventer" : p.status === "approved" ? "Godkendt" : "Afvist"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin approve tab */}
      {tab === "approve" && isAdmin && (
        <div className="max-w-3xl">
          {pending.filter(p => p.status === "pending").length === 0 ? (
            <div className="text-center py-16 text-cz-3">
              <p className="text-4xl mb-3">✅</p>
              <p>Ingen afventende indberetninger</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {pending.filter(p => p.status === "pending").map(p => (
                <PendingSubmission key={p.id} submission={p}
                  onApprove={() => approveSubmission(p.id)}
                  onReject={(note) => rejectSubmission(p.id, note)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendingSubmission({ submission, onApprove, onReject }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    supabase.from("pending_race_result_rows")
      .select("*, rider:rider_id(firstname, lastname, team:team_id(name))")
      .eq("pending_id", submission.id)
      .order("rank")
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, [submission.id]);

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-cz-1 font-semibold">{submission.race?.name}</p>
          <p className="text-cz-3 text-xs mt-0.5">
            Indsendt af {submission.submitter?.username} · {new Date(submission.submitted_at).toLocaleString("da-DK")}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onApprove}
            className="px-3 py-1.5 bg-cz-success-bg text-cz-success border border-cz-success/30 rounded-lg text-xs hover:bg-cz-success-bg">
            ✓ Godkend
          </button>
          <button onClick={() => setShowReject(!showReject)}
            className="px-3 py-1.5 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-xs hover:bg-cz-danger-bg">
            ✕ Afvis
          </button>
        </div>
      </div>

      {showReject && (
        <div className="flex gap-2 mb-4">
          <input type="text" value={rejectNote} onChange={e => setRejectNote(e.target.value)}
            placeholder="Årsag til afvisning..."
            className="flex-1 bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none" />
          <button onClick={() => onReject(rejectNote)}
            className="px-3 py-2 bg-cz-danger-bg text-cz-danger rounded-lg text-sm">
            Send
          </button>
        </div>
      )}

      {loading ? <div className="text-cz-3 text-sm">Indlæser...</div> : (
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-cz-border">
              <th className="py-1.5 text-left text-cz-3 w-8">#</th>
              <th className="py-1.5 text-left text-cz-3">Rytter</th>
              <th className="py-1.5 text-left text-cz-3">Hold</th>
              <th className="py-1.5 text-left text-cz-3">Type</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-cz-border">
                  <td className="py-1.5 text-cz-2 font-mono">{r.rank}</td>
                  <td className="py-1.5 text-cz-1">{r.rider?.firstname} {r.rider?.lastname}</td>
                  <td className="py-1.5 text-cz-2">{r.rider?.team?.name || "Fri"}</td>
                  <td className="py-1.5 text-cz-2">{r.result_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
