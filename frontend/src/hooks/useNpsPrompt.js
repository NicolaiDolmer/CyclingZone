import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getAuthedUser } from "../lib/getAuthedUser.js";
import { useConsent } from "../lib/consent.jsx";
import { logEvent } from "../lib/logEvent";
import { shouldPromptNps, normalizeNpsSubmission } from "../lib/npsGating.js";

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
// Prompten holdes ude af vejen mens cookie-banneret står: begge er fixed bund-
// overlays, og to bundbjælker oven på hinanden er ingen af dem tjent med.
//
// Når prompten VISES, sættes nps_last_prompted_at = NOW() med det samme, så et
// reload ikke gen-viser den inden for vinduet (best-effort; en fejl her må ikke
// blokere UI'et).

export function useNpsPrompt({ teamId, surface } = {}) {
  const { bannerOpen } = useConsent();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false); // svar afgivet i denne session
  // Guard så vi kun evaluerer/markerer én gang pr. mount (undgår dobbelt-write
  // hvis teamId ankommer i to tempi).
  const evaluatedRef = useRef(false);

  useEffect(() => {
    if (!teamId || evaluatedRef.current) return;
    let cancelled = false;

    (async () => {
      const user = await getAuthedUser();
      if (cancelled || !user) return;

      const [{ data: userRow }, { data: existing }, { count: raceCount }] = await Promise.all([
        supabase.from("users").select("nps_last_prompted_at").eq("id", user.id).maybeSingle(),
        supabase.from("nps_responses").select("id").eq("user_id", user.id).limit(1),
        supabase.from("team_race_points_mv").select("race_id", { count: "exact", head: true }).eq("team_id", teamId),
      ]);
      if (cancelled) return;

      const decision = shouldPromptNps({
        completedRaceDays: raceCount,
        hasResponded: Array.isArray(existing) && existing.length > 0,
        lastPromptedAt: userRow?.nps_last_prompted_at ?? null,
      });
      if (!decision) return;

      evaluatedRef.current = true;
      setVisible(true);

      // Markér "vist nu" så throttle-vinduet starter — best-effort.
      const nowIso = new Date().toISOString();
      supabase.from("users").update({ nps_last_prompted_at: nowIso }).eq("id", user.id)
        .then(() => { /* fire-and-forget */ }, () => { /* best-effort */ });
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
    setVisible(false);
    logEvent("nps_dismissed", { score_selected: scoreSelected === true, surface: surface || null });
  }, [surface]);

  const close = useCallback(() => { setVisible(false); setDone(false); }, []);

  return { visible: visible && !bannerOpen, submitting, done, submit, dismiss, close };
}
