import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { RACE_CLASSES, getRaceClassLabel } from "../../lib/uciRaceClasses";

const API = import.meta.env.VITE_API_URL;

const WORLD_TOUR_KEYS = new Set([
  "TourFrance",
  "GiroVuelta",
  "Monuments",
  "OtherWorldTourA",
  "OtherWorldTourB",
  "OtherWorldTourC",
]);

/**
 * Slice 09 — Race-katalog (#242)
 *
 * Lader admin:
 *  1. Se verdens-kalenderen (race_pool) opdelt per klasse
 *  2. Vælge en sæson + filtre (klasser + race-dage-mål + ekskluder WT)
 *  3. Generere foreslået kalender (preview-endpoint)
 *  4. Justere forslag (af-vælge enkelte løb)
 *  5. Gemme valgte løb som races-rows for sæsonen
 */
export default function RacePoolSection({ getAuth, onMsg }) {
  const [pool, setPool] = useState([]);
  const [summary, setSummary] = useState({});
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [excludeWt, setExcludeWt] = useState(true);
  const [includeClasses, setIncludeClasses] = useState({});
  const [raceDaysTarget, setRaceDaysTarget] = useState(60);
  const [stageRaceQuota, setStageRaceQuota] = useState(8);
  const [preview, setPreview] = useState(null);
  const [unselectedFromPreview, setUnselectedFromPreview] = useState(new Set());
  const [extraSelected, setExtraSelected] = useState(new Set());
  const [showOmitted, setShowOmitted] = useState(false);
  const [raceTypeFilter, setRaceTypeFilter] = useState("all"); // all | single | stage_race
  const [replaceMode, setReplaceMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existingRaceCount, setExistingRaceCount] = useState(null);

  async function fetchPool() {
    setLoading(true);
    try {
      const headers = await getAuth();
      const res = await fetch(`${API}/api/admin/race-pool`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kunne ikke hente pool");
      setPool(data.pool || []);
      setSummary(data.summary || {});

      const initial = {};
      for (const cls of RACE_CLASSES) {
        initial[cls.key] = !WORLD_TOUR_KEYS.has(cls.key);
      }
      setIncludeClasses(initial);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchSeasons() {
    const { data } = await supabase
      .from("seasons")
      .select("id, number, status")
      .neq("status", "completed")
      .order("number");
    setSeasons(data || []);
    if (data && data.length > 0 && !selectedSeasonId) {
      setSelectedSeasonId(data[0].id);
    }
  }

  useEffect(() => {
    fetchPool();
    fetchSeasons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSeasonId) {
      setExistingRaceCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("races")
        .select("id", { count: "exact", head: true })
        .eq("season_id", selectedSeasonId);
      if (!cancelled) setExistingRaceCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSeasonId, preview]);

  const totalPoolRaceDays = useMemo(
    () => Object.values(summary).reduce((sum, s) => sum + (s.raceDays || 0), 0),
    [summary],
  );

  const includedClassKeys = useMemo(
    () => Object.keys(includeClasses).filter((k) => includeClasses[k]),
    [includeClasses],
  );

  const availableInIncluded = useMemo(() => {
    let races = 0;
    let raceDays = 0;
    for (const key of includedClassKeys) {
      if (excludeWt && WORLD_TOUR_KEYS.has(key)) continue;
      const s = summary[key];
      if (s) {
        races += s.count;
        raceDays += s.raceDays;
      }
    }
    return { races, raceDays };
  }, [summary, includedClassKeys, excludeWt]);

  function toggleClass(key) {
    setIncludeClasses((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function generatePreview() {
    if (!selectedSeasonId) {
      onMsg("Vælg en sæson først", "error");
      return;
    }
    setGenerating(true);
    setPreview(null);
    setUnselectedFromPreview(new Set());
    setExtraSelected(new Set());
    try {
      const headers = await getAuth();
      const body = {
        include_classes: includedClassKeys,
        exclude_classes: excludeWt ? [...WORLD_TOUR_KEYS] : [],
        race_days_target: Number(raceDaysTarget) || 60,
        stage_race_quota: Number.isFinite(Number(stageRaceQuota))
          ? Math.max(0, Math.min(20, Number(stageRaceQuota)))
          : 0,
      };
      const res = await fetch(
        `${API}/api/admin/seasons/${selectedSeasonId}/race-selection/preview`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Forslag fejlede");
      setPreview(data);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setGenerating(false);
    }
  }

  function toggleRaceFromPreview(raceId) {
    setUnselectedFromPreview((prev) => {
      const next = new Set(prev);
      if (next.has(raceId)) next.delete(raceId);
      else next.add(raceId);
      return next;
    });
  }

  function toggleExtraRace(raceId) {
    setExtraSelected((prev) => {
      const next = new Set(prev);
      if (next.has(raceId)) next.delete(raceId);
      else next.add(raceId);
      return next;
    });
  }

  const finalSelected = useMemo(() => {
    if (!preview) return [];
    const fromSelected = preview.selected.filter((r) => !unselectedFromPreview.has(r.id));
    const fromOmitted = (preview.omitted || []).filter((r) => extraSelected.has(r.id));
    return [...fromSelected, ...fromOmitted];
  }, [preview, unselectedFromPreview, extraSelected]);

  const filteredSelected = useMemo(() => {
    if (!preview) return [];
    if (raceTypeFilter === "all") return preview.selected;
    return preview.selected.filter((r) => r.race_type === raceTypeFilter);
  }, [preview, raceTypeFilter]);

  const filteredOmitted = useMemo(() => {
    if (!preview) return [];
    if (raceTypeFilter === "all") return preview.omitted || [];
    return (preview.omitted || []).filter((r) => r.race_type === raceTypeFilter);
  }, [preview, raceTypeFilter]);

  const finalRaceDays = useMemo(
    () => finalSelected.reduce((sum, r) => sum + (Number(r.stages) || 0), 0),
    [finalSelected],
  );

  const selectedStageRaceCount = useMemo(
    () => finalSelected.filter((r) => r.race_type === "stage_race").length,
    [finalSelected],
  );

  const selectedSingleCount = useMemo(
    () => finalSelected.filter((r) => r.race_type === "single").length,
    [finalSelected],
  );

  async function saveSelection() {
    if (finalSelected.length === 0) {
      onMsg("Ingen løb valgt", "error");
      return;
    }
    let confirmText;
    if (replaceMode && existingRaceCount > 0) {
      confirmText =
        `⚠ ERSTAT-tilstand: De ${existingRaceCount} eksisterende løb i sæsonen SLETTES, ` +
        `og ${finalSelected.length} nye løb (${finalRaceDays} race-dage) oprettes.\n\n` +
        `Hvis nogen af de eksisterende løb allerede har resultater, blokeres operationen.\n\n` +
        `Fortsæt?`;
    } else {
      confirmText =
        `Du er ved at oprette ${finalSelected.length} løb (${finalRaceDays} race-dage) ` +
        `i sæsonen. Eksisterende løb i sæsonen påvirkes ikke.\n\nFortsæt?`;
    }
    if (!window.confirm(confirmText)) return;

    setSaving(true);
    try {
      const headers = await getAuth();
      const res = await fetch(
        `${API}/api/admin/seasons/${selectedSeasonId}/race-selection`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            pool_race_ids: finalSelected.map((r) => r.id),
            replace: replaceMode,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gem fejlede");
      const replacedMsg = data.replaced ? `, erstattede ${data.replaced} eksisterende` : "";
      onMsg(
        `✅ Oprettet ${data.inserted} løb${replacedMsg} (sprunget over ${data.skipped_already_present})`,
      );
      setPreview(null);
      setUnselectedFromPreview(new Set());
      setExtraSelected(new Set());
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-cz-3 text-sm">Indlæser race-katalog…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Pool-overblik */}
      <div className="bg-cz-subtle rounded-xl p-4">
        <p className="text-cz-2 font-medium text-sm mb-3">
          Verdens-kalender — {pool.length} løb · {totalPoolRaceDays} race-dage
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
          {RACE_CLASSES.map((cls) => {
            const s = summary[cls.key] || { count: 0, raceDays: 0 };
            const isWt = WORLD_TOUR_KEYS.has(cls.key);
            return (
              <div
                key={cls.key}
                className={`flex justify-between items-center px-3 py-2 rounded-lg border ${
                  s.count === 0
                    ? "border-cz-border opacity-50"
                    : "border-cz-border"
                }`}
              >
                <span className="text-cz-2 truncate">
                  {cls.label}
                  {isWt && <span className="ml-1 text-cz-3 text-xs">[WT]</span>}
                </span>
                <span className="text-cz-3 text-xs whitespace-nowrap ml-2">
                  {s.count} løb · {s.raceDays} dage
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter-form */}
      <div className="bg-cz-subtle rounded-xl p-4 space-y-3">
        <p className="text-cz-2 font-medium text-sm">Sammensæt sæsons kalender</p>

        <div>
          <label className="block text-cz-3 text-xs mb-1">Sæson</label>
          <select
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
            className="w-full bg-cz-bg border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm"
          >
            <option value="">— vælg sæson —</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                Sæson {s.number} ({s.status})
              </option>
            ))}
          </select>
          {existingRaceCount !== null && existingRaceCount > 0 && (
            <p className="text-cz-3 text-xs mt-1">
              ⚠ Sæsonen har allerede {existingRaceCount} løb. Nye valg lægges til (eksisterende
              berøres ikke).
            </p>
          )}
        </div>

        <div>
          <label className="block text-cz-3 text-xs mb-2">Klasser at vælge fra</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {RACE_CLASSES.map((cls) => {
              const s = summary[cls.key] || { count: 0, raceDays: 0 };
              const disabled = s.count === 0;
              return (
                <label
                  key={cls.key}
                  className={`flex items-center gap-2 px-2 py-1 rounded ${
                    disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={includeClasses[cls.key] || false}
                    disabled={disabled}
                    onChange={() => toggleClass(cls.key)}
                  />
                  <span className="text-cz-2 truncate">{cls.label}</span>
                  <span className="text-cz-3 text-xs ml-auto">
                    {s.count}/{s.raceDays}d
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="exclude-wt"
            checked={excludeWt}
            onChange={(e) => setExcludeWt(e.target.checked)}
          />
          <label htmlFor="exclude-wt" className="text-cz-2 text-sm">
            Ekskluder WorldTour-klasser (anbefalet for sæson 1)
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-cz-3 text-xs mb-1">Race-dage-mål</label>
            <input
              type="number"
              min="10"
              max="200"
              value={raceDaysTarget}
              onChange={(e) => setRaceDaysTarget(e.target.value)}
              className="w-full bg-cz-bg border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm"
            />
          </div>
          <div>
            <label
              className="block text-cz-3 text-xs mb-1"
              title="Garanterer at de første N stage races vælges fra prioritets-liste (Tour of Oman, Vuelta a Burgos, Tour of the Alps osv.) før resten fyldes alfabetisk. 0 = backward compatible (gammel adfærd)."
            >
              Min. etapeløb (garanteret)
            </label>
            <input
              type="number"
              min="0"
              max="20"
              value={stageRaceQuota}
              onChange={(e) => setStageRaceQuota(e.target.value)}
              className="w-full bg-cz-bg border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm"
            />
          </div>
          <div className="text-sm self-end">
            <p className="text-cz-3 text-xs">Tilgængeligt i valg</p>
            <p className="text-cz-2 font-medium">
              {availableInIncluded.races} løb · {availableInIncluded.raceDays} dage
            </p>
          </div>
        </div>

        <button
          onClick={generatePreview}
          disabled={generating || !selectedSeasonId}
          className="w-full sm:w-auto px-4 py-2 bg-cz-accent-bg text-cz-accent border border-cz-accent/30 rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50"
        >
          {generating ? "Genererer…" : "Generér forslag"}
        </button>
      </div>

      {/* Preview + gem */}
      {preview && (
        <div className="bg-cz-subtle rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <p className="text-cz-2 font-medium text-sm">
              Forslag: {finalSelected.length} løb · {finalRaceDays} race-dage (mål{" "}
              {preview.raceDaysTarget})
            </p>
            <p className="text-cz-3 text-xs">
              {selectedSingleCount} endags · {selectedStageRaceCount} etape
              {preview.omitted.length > 0 && ` · ${preview.omitted.length} sprunget over`}
            </p>
          </div>

          {/* Race-type filter */}
          <div className="flex gap-2 text-xs">
            <span className="text-cz-3 self-center">Filter:</span>
            {[
              { key: "all", label: "Alle" },
              { key: "single", label: "Endags" },
              { key: "stage_race", label: "Etape" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setRaceTypeFilter(opt.key)}
                className={`px-2.5 py-1 rounded border ${
                  raceTypeFilter === opt.key
                    ? "bg-cz-accent-bg text-cz-accent border-cz-accent/30"
                    : "text-cz-3 border-cz-border hover:bg-cz-bg"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Valgte løb */}
          <div className="max-h-96 overflow-y-auto border border-cz-border rounded-lg divide-y divide-cz-border">
            {filteredSelected.map((r) => {
              const isUnchecked = unselectedFromPreview.has(r.id);
              return (
                <label
                  key={r.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-cz-bg ${
                    isUnchecked ? "opacity-50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!isUnchecked}
                    onChange={() => toggleRaceFromPreview(r.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-cz-1 text-sm truncate">{r.name}</p>
                    <p className="text-cz-3 text-xs">
                      {getRaceClassLabel(r.race_class)} · {r.race_type === "single" ? "Endags" : "Etape"} ·{" "}
                      {r.stages} dag{r.stages !== 1 ? "e" : ""}
                      {r.country ? ` · ${r.country}` : ""}
                      {r.date_text ? ` · ${r.date_text}` : ""}
                    </p>
                  </div>
                </label>
              );
            })}
            {filteredSelected.length === 0 && (
              <p className="text-cz-3 text-xs px-3 py-2">Ingen løb matcher filteret.</p>
            )}
          </div>

          {/* Omitted (sprunget over af generatoren) — kan inkluderes manuelt */}
          {preview.omitted && preview.omitted.length > 0 && (
            <div className="border border-cz-border rounded-lg">
              <button
                onClick={() => setShowOmitted(!showOmitted)}
                className="w-full px-3 py-2 text-left text-cz-2 text-sm hover:bg-cz-bg flex justify-between items-center"
              >
                <span>
                  {showOmitted ? "▼" : "▶"} Sprunget over af generator ({filteredOmitted.length})
                </span>
                {extraSelected.size > 0 && (
                  <span className="text-cz-accent text-xs">+{extraSelected.size} tilføjet manuelt</span>
                )}
              </button>
              {showOmitted && (
                <div className="max-h-64 overflow-y-auto border-t border-cz-border divide-y divide-cz-border">
                  {filteredOmitted.map((r) => {
                    const isExtra = extraSelected.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-cz-bg ${
                          !isExtra ? "opacity-60" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isExtra}
                          onChange={() => toggleExtraRace(r.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-cz-1 text-sm truncate">{r.name}</p>
                          <p className="text-cz-3 text-xs">
                            {getRaceClassLabel(r.race_class)} · {r.race_type === "single" ? "Endags" : "Etape"} ·{" "}
                            {r.stages} dag{r.stages !== 1 ? "e" : ""}
                            {r.country ? ` · ${r.country}` : ""}
                            {r.reason === "target_reached" ? " · (mål nået)" : ""}
                            {r.reason === "would_overshoot" ? " · (ville overshoote)" : ""}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                  {filteredOmitted.length === 0 && (
                    <p className="text-cz-3 text-xs px-3 py-2">Ingen sprungede løb matcher filteret.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Replace-toggle */}
          {existingRaceCount > 0 && (
            <div className="bg-cz-danger-bg/10 border border-cz-danger/20 rounded-lg p-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceMode}
                  onChange={(e) => setReplaceMode(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <span className="text-cz-danger font-medium">
                    Erstat eksisterende {existingRaceCount} løb
                  </span>
                  <p className="text-cz-3 text-xs mt-0.5">
                    De gamle løb slettes før de nye oprettes. Operationen blokeres hvis nogen af de
                    eksisterende løb har race_results.
                  </p>
                </div>
              </label>
            </div>
          )}

          <button
            onClick={saveSelection}
            disabled={saving || finalSelected.length === 0}
            className="w-full sm:w-auto px-4 py-2 bg-cz-accent-bg text-cz-accent border border-cz-accent/30 rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50"
          >
            {saving
              ? "Gemmer…"
              : replaceMode && existingRaceCount > 0
              ? `Erstat med ${finalSelected.length} løb`
              : `Gem som sæsonens kalender (${finalSelected.length} løb)`}
          </button>
        </div>
      )}
    </div>
  );
}
