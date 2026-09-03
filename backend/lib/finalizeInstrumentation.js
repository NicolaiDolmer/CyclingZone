// #4148: rene måle-hjælpere til afslutningsstien (raceRunner.simulateStageByIndex,
// prizePayoutEngine.paySeasonPrizesToDate, autoPrizeSweep.runAutoPrizeSweep).
//
// Baggrund: 23/8-målingen viste 148.681 Supabase-requests/time under et løbsheat,
// men INGEN fordeling pr. trin (simulering, resultat-skrivning, standings-RPC,
// matview-refresh, præmieudbetaling, rytterværdier, notifikationer) — se #4148.
// Denne fil tilføjer den fordeling UDEN at ændre nogen adfærd: den tæller kald og
// måler varighed, den ændrer aldrig hvad en forespørgsel gør eller returnerer.
//
// Tilgang: wrap `.from()` og `.rpc()` på den EKSISTERENDE supabase-klient-instans
// (samme reference bruges nedstrøms af alle hjælpere, så indpakningen tæller
// korrekt uanset hvor mange lag kaldet går gennem). Hver `.from(...)`/`.rpc(...)`-
// invokation svarer i praksis til ét HTTP-kald til PostgREST (chaining sker på det
// returnerede query-objekt, ikke via nye from/rpc-kald) — god nok præcision til
// fordelingsformål uden at hooke ind i den underliggende fetch.

/**
 * @param {object} supabase - en ægte (eller mock-) supabase-klient.
 * @returns {{ client: object, counter: { calls: number } }}
 */
export function wrapSupabaseWithCallCounter(supabase) {
  const counter = { calls: 0 };
  if (!supabase || typeof supabase !== "object") {
    return { client: supabase, counter };
  }
  const client = new Proxy(supabase, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if ((prop === "from" || prop === "rpc") && typeof value === "function") {
        return (...args) => {
          counter.calls += 1;
          return value.apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { client, counter };
}

/**
 * Måler ét navngivet trin: kører `fn`, returnerer dens resultat uændret, og
 * lægger { name, ms, calls } i `phases`-arrayet. `counter` er den delte tæller
 * fra wrapSupabaseWithCallCounter — diffet før/efter isolerer trinnets EGNE kald.
 */
export async function measurePhase(phases, counter, name, fn) {
  const startMs = Date.now();
  const startCalls = counter.calls;
  try {
    return await fn();
  } finally {
    phases.push({ name, ms: Date.now() - startMs, calls: counter.calls - startCalls });
  }
}

/**
 * Formaterer én struktureret log-linje: `⏱ <label>: <fase>=<calls>c/<ms>ms · … · total=<calls>c/<ms>ms`.
 */
export function formatPhaseLogLine(label, phases) {
  const totalMs = phases.reduce((s, p) => s + p.ms, 0);
  const totalCalls = phases.reduce((s, p) => s + p.calls, 0);
  const parts = phases.map((p) => `${p.name}=${p.calls}c/${p.ms}ms`);
  parts.push(`total=${totalCalls}c/${totalMs}ms`);
  return `⏱ ${label}: ${parts.join(" · ")}`;
}
