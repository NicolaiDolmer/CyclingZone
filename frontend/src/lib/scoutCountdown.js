// scoutCountdown — resterende tid til en scoutrapport er klar (#3548).
//
// Baggrund: en målrettet undersøgelse svarer på ~30 minutter (#2644), men de tre
// steder der viste ventetiden ("Rapport om ~30 min") viste et KONSTANT tal fra
// jobConfig. Det tal ændrede sig aldrig, uanset hvor længe opgaven havde kørt,
// så spilleren kunne ikke planlægge efter det (Discord 8/8, #3548).
//
// Klar-tidspunktet regnes IKKE forfra her. Serveren leverer `ready_at` (ISO UTC)
// på aktive target-opgaver, udledt af scout_assignments.created_at + etaMinutes
// (backend/lib/scoutEngine.js targetReadyAt) — præcis den deadline
// lazyCompleteDueTargetAssignments håndhæver. Denne fil oversætter kun det
// tidspunkt til "hvor mange minutter er der tilbage".
//
// Ren logik + en tynd hook, samme opdeling som useTableSort.js: alt ikke-trivielt
// bor i scoutCountdownParts/scoutReadyClock og enheds-testes uden React-render.

import { useEffect, useState } from "react";

// Hvor ofte hooken kigger efter om minut-tallet er skiftet. 15s er rigeligt til
// minut-granularitet og koster ingen re-render medmindre labelen faktisk ændrer sig.
const TICK_MS = 15_000;

export const SCOUT_COUNTDOWN_TICK_MS = TICK_MS;

// Millisekunder tilbage til `readyAt`. null hvis tidspunktet mangler/er ugyldigt
// (kalderen falder da tilbage til den gamle flade ETA-copy). Aldrig negativ.
export function msUntilReady(readyAt, now = new Date()) {
  if (!readyAt) return null;
  const ready = readyAt instanceof Date ? readyAt : new Date(readyAt);
  if (Number.isNaN(ready.getTime())) return null;
  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(reference.getTime())) return null;
  return Math.max(0, ready.getTime() - reference.getTime());
}

// Visnings-tilstanden for nedtællingen:
//   null                          — intet brugbart klar-tidspunkt
//   { state:"due", minutes:0 }    — deadline passeret, rapporten modnes ved næste hentning
//   { state:"counting", minutes } — hele minutter tilbage, altid mindst 1
//
// minutes rundes OP, så en netop startet opgave viser "30 min" (ikke 29) og en
// opgave med 40 sekunder tilbage viser "1 min" (ikke 0).
export function scoutCountdownParts(readyAt, now = new Date()) {
  const ms = msUntilReady(readyAt, now);
  if (ms === null) return null;
  if (ms <= 0) return { state: "due", minutes: 0 };
  return { state: "counting", minutes: Math.ceil(ms / 60_000) };
}

// Klar-tidspunktet som klokkeslæt i DANSK lokaltid. ready_at er UTC fra serveren,
// så tidszonen sættes eksplicit (Europe/Copenhagen) i stedet for at arve
// browserens — samme mønster som TrainingPage.jsx' trainedTime().
export function scoutReadyClock(readyAt) {
  if (!readyAt) return null;
  const ready = readyAt instanceof Date ? readyAt : new Date(readyAt);
  if (Number.isNaN(ready.getTime())) return null;
  return ready.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Copenhagen",
  });
}

// Tikkende udgave af scoutCountdownParts.
//
// To ting den gør med vilje:
//   • setParts returnerer det FORRIGE objekt når minut-tallet er uændret, så
//     React bailer ud og komponenten ikke re-renderer hvert tick. Ingen ny
//     objekt-identitet pr. tick = ingen re-render-løkke.
//   • effekten afhænger kun af `readyAt` (en streng), og intervallet ryddes både
//     ved unmount og når readyAt skifter. Når deadline er passeret stoppes
//     intervallet i selve ticket — der er intet mere at tælle ned til.
export function useScoutCountdown(readyAt) {
  const [parts, setParts] = useState(() => scoutCountdownParts(readyAt));

  useEffect(() => {
    setParts(scoutCountdownParts(readyAt));
    if (!readyAt) return undefined;

    const id = setInterval(() => {
      const next = scoutCountdownParts(readyAt);
      if (!next || next.state === "due") clearInterval(id);
      setParts((prev) => (
        prev && next && prev.state === next.state && prev.minutes === next.minutes ? prev : next
      ));
    }, TICK_MS);

    return () => clearInterval(id);
  }, [readyAt]);

  return parts;
}
