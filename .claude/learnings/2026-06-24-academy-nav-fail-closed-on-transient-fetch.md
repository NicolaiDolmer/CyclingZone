# Akademi-nav-punkt forsvandt: nav-gate fejlede lukket ved forbigående fetch-fejl

**Dato:** 2026-06-24 · **PR:** [#1822](https://github.com/NicolaiDolmer/CyclingZone/pull/1822) · **Relateret:** [#1792](https://github.com/NicolaiDolmer/CyclingZone/issues/1792) (samme session-expiry-klasse)

## Symptom
Ejer rapporterede at "LEGO-Vestas Cycling Team kan ikke se akademien i menuen til venstre". Holdet **havde** et fungerende akademi.

## Hvordan jeg fandt det (rækkefølge der virkede)
1. **Data først, ikke kode-gæt.** Live-query: flag `academy_enabled = "on"` (siden 13/6, før holdet), holdet havde 3 `offered`-kandidater fuldt afledt, ejer ejer præcis ét hold (`req.team` resolver), ingen akademi-fejl i Sentry. → backend returnerer `enabled:true`. Problemet var IKKE data/flag/backend.
2. Det udelukkede de "lette" forklaringer (beta-gate, manglende kuld, derive-bug #1478) empirisk, så jeg kunne fokusere på frontend.

## Rod-årsag
[Layout.jsx](frontend/src/components/Layout.jsx) satte nav-synlighed ud fra ét `/api/academy/me`-kald ved mount:
```js
fetch(...).then(res => res.ok ? res.json() : null).then(d => { if (d?.enabled) setAcademyEnabled(true); }).catch(()=>{});
```
`academyEnabled` start = `false`. Et forbigående **401** (udløbet/fornyende session — #1792-klassen, især mobil Safari), **5xx** eller netværksfejl → `res.ok` false → punktet forblev skjult **uden retry** til næste reload. 401 er et *håndteret* svar (ikke exception) → ingen Sentry-spor → usynligt i fejl-dashboards.

## Fix
Ren helper `resolveAcademyNavVisible({status, enabled, lastKnown})`: kun **200** (eksakt enabled) + **409** (disabled) er autoritative; alt andet **bevarer sidst kendte** (localStorage-cache, init fra cache). Flaget bevarer fuld kontrol.

## Læring / forward-guard
1. **Et permanent nav-/UI-element må ikke gates bag en per-load fetch der fejler LUKKET uden retry.** Default-skjult + `.catch(()=>{})` + ingen cache = elementet blinker ud ved et hvilket som helst auth-/netværks-hikke. Skel "autoritativt nej" (200 enabled:false / 409) fra "kunne ikke nå serveren" (401/5xx/netværk) — sidstnævnte skal bevare sidst kendte, ikke skjule.
2. **Diagnosticér data→backend→frontend i den rækkefølge.** At verificere flag + DB-state + Sentry FØRST udelukkede 4 plausible forklaringer empirisk og pegede direkte på den skrøbelige klient-gate.
3. **Håndterede 401/409-svar er usynlige i Sentry.** Fravær af fejl i Sentry ≠ "alt virker"; en fail-closed UI-gate efterlader intet spor.
4. **Søg efter samme mønster:** andre nav-items/features gated på en enkelt per-load fetch med `.catch`-swallow (presence/achievements er fire-and-forget = ok; men alt der styrer *synlighed* bør være robust).
