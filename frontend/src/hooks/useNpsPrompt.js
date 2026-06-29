import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getAuthedUser } from "../lib/getAuthedUser.js";
import { useConsent } from "../lib/consent.jsx";
import { shouldPromptNps, normalizeNpsSubmission } from "../lib/npsGating.js";

// #940 In-app NPS-prompt-hook.
//
// Gating-logikken er pure i lib/npsGating.js; denne hook fodrer Supabase-state
// ind og handler på beslutningen:
//   - Trigger: forbrugeren kalder markRaceResultSeen() når brugeren ser sit
//     FØRSTE løb-resultat (samme touchpoint som first_race_result_viewed).
//   - Throttle: users.nps_last_prompted_at (max 1 prompt / 90 dage).
//   - Allerede svaret: tjek nps_responses for et eget svar.
//   - Consent: NPS er en målefunktion → kræver analytics-consent, præcis som
//     player_events. Intet netværkskald før samtykke.
//
// Når prompten VISES, sættes nps_last_prompted_at = NOW() med det samme, så et
// reload ikke gen-viser den inden for vinduet (best-effort; en fejl her må ikke
// blokere UI'et).

const NECESSARY_DONE = { visible: false, submitting: false };

export function useNpsPrompt() {
  const { hasConsent } = useConsent();
  const [triggered, setTriggered] = useState(false);
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false); // svar afgivet i denne session
  // Guard så vi kun evaluerer/markerer én gang pr. mount (undgår dobbelt-write
  // hvis trigger + consent ændrer sig hurtigt).
  const evaluatedRef = useRef(false);

  const markRaceResultSeen = useCallback(() => setTriggered(true), []);

  useEffect(() => {
    if (!triggered || evaluatedRef.current) return;
    if (!hasConsent("analytics")) return; // vent på consent — samme gate som events
    let cancelled = false;

    (async () => {
      const user = await getAuthedUser();
      if (cancelled || !user) return;

      const [{ data: userRow }, { data: existing }] = await Promise.all([
        supabase.from("users").select("nps_last_prompted_at").eq("id", user.id).maybeSingle(),
        supabase.from("nps_responses").select("id").eq("user_id", user.id).limit(1),
      ]);
      if (cancelled) return;

      const decision = shouldPromptNps({
        hasSeenRaceResult: true,
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
  }, [triggered, hasConsent]);

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
      return true;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const dismiss = useCallback(() => setVisible(false), []);
  const close = useCallback(() => { setVisible(false); setDone(false); }, []);

  if (!hasConsent("analytics")) {
    // Eksponér en stabil no-op-form når consent mangler, så forbrugeren ikke skal
    // gren-kode (markRaceResultSeen forbliver kaldbar, men evaluerer aldrig).
    return { ...NECESSARY_DONE, done: false, markRaceResultSeen, submit, dismiss, close };
  }

  return { visible, submitting, done, markRaceResultSeen, submit, dismiss, close };
}
