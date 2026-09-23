import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getAuthedUser } from "../lib/getAuthedUser.js";
import { useConsent } from "../lib/consent.jsx";
import { logEvent } from "../lib/logEvent";
import { shouldPromptNps, normalizeNpsSubmission } from "../lib/npsGating.js";
import { getRaceCount } from "../lib/rankingsApi.ts";
import { useBottomSlot } from "../lib/bottomSlot.ts";
import { createNpsExposureMarker, isNpsPromptShown } from "../lib/npsExposure.ts";

// #940 In-app NPS-prompt-hook. Omskrevet i #4997.
//
// Gating-logikken er pure i lib/npsGating.js; denne hook fodrer Supabase-state
// ind og handler på beslutningen:
//   - Trigger: holdet har mindst NPS_MIN_RACE_DAYS afsluttede løbsdage. Kilden er
//     team_race_points_mv (én række pr. sæson/hold/løb, GRANT SELECT til
//     authenticated, refreshes ved race-finalization) læst som
//     `head: true, count: "exact"` — ét kald, nul payload. Tallet er et
//     KONSERVATIVT mål for løbsdage: et etapeløb spænder over flere løbsdage men
//     tæller som ét løb her, så gaten åbner senere end den strengt taget må,
//     aldrig tidligere. Alternativet (distinkte game_day i race_entry_days) ville
//     koste et opslag der returnerer ryttere × dage rækker.
//   - Throttle: users.nps_last_prompted_at (max 1 prompt / 90 dage).
//   - Allerede svaret: tjek nps_responses for et eget svar.
//
// #4997 — consent: prompten var tidligere gated på analytics-consent ("NPS er en
// målefunktion → kræver analytics-consent, præcis som player_events"). Den gate er
// fjernet: et NPS-svar er spillerens FRIVILLIGE input i hans egen række
// (nps_responses, RLS-scoped), ikke adfærdsmåling han ikke har bedt om. Kun
// player_events-instrumenteringen er stadig consent-gated — logEvent() gater sig
// selv, så der er ingen gren-kode her.
//
// #5440: baren deler bundkanten med cookie-banneret og release-banneret gennem
// ÉN bund-slot (lib/bottomSlot.ts, prioritet samtykke > release > NPS). Taber
// baren kanten, rendrer den null men forbliver monteret, så et valgt tal eller en
// halvskrevet begrundelse overlever og kommer tilbage når kanten er fri.
//
// #5306: nps_last_prompted_at = NOW() skrives først når baren FAKTISK er synlig
// (gaten sagde ja, samtykke-banneret står ikke, og baren har bund-slotten), ikke
// når gaten åbner. Før brændte en spiller med samtykke-banneret åbent sine 90
// dage uden at have set spørgsmålet. Skrivningen sker stadig kun én gang pr.
// mount, så et reload ikke gen-viser den inden for vinduet (best-effort; en fejl
// her må ikke blokere UI'et). Throttle og hasResponded er uændrede (ejer-
// beslutninger i #5306).

// Selve cooldown-skrivningen (best-effort, fire-and-forget).
function writeLastPrompted(userId, promptedAtIso) {
  supabase.from("users").update({ nps_last_prompted_at: promptedAtIso }).eq("id", userId)
    .then(() => { /* fire-and-forget */ }, () => { /* best-effort */ });
}

export function useNpsPrompt({ teamId, surface } = {}) {
  const { bannerOpen } = useConsent();
  // `eligible`: gaten har sagt ja og baren er ikke lukket af spilleren. Om den
  // faktisk VISES afgøres af samtykke-banneret og bund-slotten nedenfor.
  const [eligible, setEligible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false); // svar afgivet i denne session
  // Guard så vi kun evaluerer én gang pr. mount (undgår dobbelt-opslag hvis
  // teamId ankommer i to tempi).
  const evaluatedRef = useRef(false);
  // Den indloggede bruger fra evalueringen — cooldown-skrivningen skal ramme
  // samme række som gaten læste.
  const userIdRef = useRef(null);
  // Én markør pr. mount: den skriver højst én gang, uanset hvor mange gange
  // baren skjules og vises igen (samtykke-banneret genåbnet, release-banneret).
  const [exposureMarker] = useState(() => createNpsExposureMarker(writeLastPrompted));

  const slotGranted = useBottomSlot("nps", eligible);
  const shown = isNpsPromptShown({ eligible, bannerOpen, slotGranted });

  // #5306: cooldown-vinduet starter i det første øjeblik baren er synlig.
  useEffect(() => {
    exposureMarker.observe({ eligible, bannerOpen, slotGranted, userId: userIdRef.current });
  }, [exposureMarker, eligible, bannerOpen, slotGranted]);

  useEffect(() => {
    if (!teamId || evaluatedRef.current) return;
    let cancelled = false;

    (async () => {
      const user = await getAuthedUser();
      if (cancelled || !user) return;

      const [{ data: userRow }, { data: existing }, { count: raceCount }] = await Promise.all([
        supabase.from("users").select("nps_last_prompted_at").eq("id", user.id).maybeSingle(),
        supabase.from("nps_responses").select("id").eq("user_id", user.id).limit(1),
        getRaceCount(teamId),
      ]);
      if (cancelled) return;

      const decision = shouldPromptNps({
        completedRaceDays: raceCount,
        hasResponded: Array.isArray(existing) && existing.length > 0,
        lastPromptedAt: userRow?.nps_last_prompted_at ?? null,
      });
      if (!decision) return;

      evaluatedRef.current = true;
      userIdRef.current = user.id;
      // INGEN skrivning her (#5306): cooldown-effekten ovenfor skriver først når
      // baren faktisk er synlig.
      setEligible(true);
    })();

    return () => { cancelled = true; };
  }, [teamId]);

  const submit = useCallback(async ({ score, reason }) => {
    const normalized = normalizeNpsSubmission({ score, reason });
    if (!normalized) return false;
    setSubmitting(true);
    try {
      const user = await getAuthedUser();
      if (!user) return false;
      const { error } = await supabase.from("nps_responses").insert({
        user_id: user.id,
        score: normalized.score,
        reason: normalized.reason,
      });
      if (error) return false;
      setDone(true);
      // #4997: modstykket til nps_dismissed — forholdet mellem de to er svaret på
      // "lukker brugerne den bare?". with_reason (ikke selve fritekst-svaret) så
      // event_data aldrig bærer spiller-skrevet tekst.
      logEvent("nps_submitted", {
        score: normalized.score,
        with_reason: normalized.reason !== null,
        surface: surface || null,
      });
      return true;
    } finally {
      setSubmitting(false);
    }
  }, [surface]);

  // #4997: et luk blev tidligere kun til setVisible(false) — derfor kunne vi ikke
  // svare ejeren på om de 31 brugere der fik prompten uden at svare lukkede den
  // eller aldrig så den. score_selected fortæller om de nåede at vælge et tal før
  // de lukkede (delvist udfyldt = et andet problem end "ikke set").
  const dismiss = useCallback(({ scoreSelected = false } = {}) => {
    setEligible(false);
    logEvent("nps_dismissed", { score_selected: scoreSelected === true, surface: surface || null });
  }, [surface]);

  const close = useCallback(() => { setEligible(false); setDone(false); }, []);

  return { visible: shown, submitting, done, submit, dismiss, close };
}
