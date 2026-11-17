// #7859 · Klienten til /api/me/spoiler-shield og hooks til løbssiden og indstillingen.
//
// Serveren er sandheden (kontakten, valgene, de åbnede etaper). Browseren husker kun,
// om skjoldet var tændt sidst, så en kørt etapes resultat ikke glimter frem, mens
// svaret hentes (spoilerShieldModel.initialView). Fejl = slukket = som i dag.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS, OFF_VIEW, initialView, parseSettings, parseShieldResponse, raceShielded, readRememberedShield, rememberShield,
  withOpenedStage, withRaceShield, type OpenFinishedIn, type SpoilerSettings, type SpoilerShieldView,
} from "./spoilerShieldModel.ts";

const BASE = "/api/me/spoiler-shield";

// Klienten hentes dynamisk (samme greb som userUiPrefs.ts): modellen testes i node uden supabase.
async function deps() {
  const [{ apiFetch }, { authHeaders }] = await Promise.all([import("../../lib/apiFetch.ts"), import("../../lib/supabase.ts")]);
  return { apiFetch, authHeaders };
}

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; data: unknown } | null> {
  try {
    const { apiFetch, authHeaders } = await deps();
    const headers = await authHeaders({ json: init.body !== undefined });
    if (!headers) return null;
    const res = await apiFetch(BASE + path, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    return { ok: res.ok, data: res.data };
  } catch {
    return null; // catch-ok: intet svar = slukket = som i dag
  }
}

export async function fetchSpoilerShield(raceId: string | null): Promise<SpoilerShieldView> {
  const res = await call(raceId ? `?raceId=${encodeURIComponent(raceId)}` : "");
  return res?.ok ? parseShieldResponse(res.data) : OFF_VIEW;
}

export interface RaceSpoilerShield {
  view: SpoilerShieldView;
  /** Åbn en etape: ét tryk på "Show results" eller filmen i mål. Gælder på alle enheder. */
  openStage: (stage: number) => void;
  /** Kontakten i løbets hoved. */
  setRaceShield: (on: boolean) => void;
  /** Det seneste skift af kontakten kunne ikke gemmes; kontakten er rullet tilbage (Codex #8302). */
  saveFailed: boolean;
}

/** Løbssiden: skjoldet for ét løb. */
export function useRaceSpoilerShield(raceId: string | null): RaceSpoilerShield {
  const [view, setView] = useState<SpoilerShieldView>(() => initialView(readRememberedShield()));
  const [saveFailed, setSaveFailed] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!raceId) { setView(OFF_VIEW); return undefined; }
    let alive = true;
    fetchSpoilerShield(raceId).then((next) => {
      if (!alive) return;
      setView(next);
      rememberShield(raceShielded(next) || (next.enabled && next.settings.shieldAll));
    });
    return () => { alive = false; };
  }, [raceId]);

  const openStage = useCallback((stage: number) => {
    if (!raceId) return;
    setView((v) => withOpenedStage(v, stage));
    void call(`/races/${encodeURIComponent(raceId)}/opened`, { method: "POST", body: { stage } });
  }, [raceId]);

  // Et gem, der fejler, ruller kontakten tilbage og siger det (Codex #8302): ellers tror spilleren, at
  // løbet er beskyttet, mens notifikationer og andre enheder stadig bruger den gamle indstilling.
  const setRaceShield = useCallback((on: boolean) => {
    if (!raceId) return;
    const before = viewRef.current;
    setSaveFailed(false);
    setView((v) => withRaceShield(v, on));
    if (on) rememberShield(true);
    void call(`/races/${encodeURIComponent(raceId)}`, { method: "PUT", body: { shield: on } }).then((res) => {
      if (res?.ok) return;
      setView(before);
      rememberShield(raceShielded(before));
      setSaveFailed(true);
    });
  }, [raceId]);

  return { view, openStage, setRaceShield, saveFailed };
}

export type SettingsSaveState = "idle" | "saving" | "saved" | "failed";

/** Indstillingen (billede 7): valget for alle løb og hvor en færdig etape åbner. */
export function useSpoilerSettings(): {
  enabled: boolean; loaded: boolean; settings: SpoilerSettings; saveState: SettingsSaveState;
  save: (patch: Partial<{ shieldAll: boolean; openFinishedIn: OpenFinishedIn }>) => void;
} {
  const [state, setState] = useState<{ enabled: boolean; loaded: boolean; settings: SpoilerSettings }>({ enabled: false, loaded: false, settings: DEFAULT_SETTINGS });
  const [saveState, setSaveState] = useState<SettingsSaveState>("idle");
  useEffect(() => {
    let alive = true;
    fetchSpoilerShield(null).then((view) => {
      if (alive) setState({ enabled: view.enabled, loaded: true, settings: view.settings });
    });
    return () => { alive = false; };
  }, []);
  const save = useCallback((patch: Partial<SpoilerSettings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    if (patch.shieldAll !== undefined) rememberShield(patch.shieldAll);
    setSaveState("saving");
    void call("/settings", { method: "PUT", body: patch }).then((res) => {
      if (res?.ok) {
        const saved = parseSettings((res.data as { settings?: unknown } | null)?.settings);
        setState((s) => ({ ...s, settings: saved }));
        setSaveState("saved");
      } else setSaveState("failed");
    });
  }, []);
  return { ...state, saveState, save };
}
