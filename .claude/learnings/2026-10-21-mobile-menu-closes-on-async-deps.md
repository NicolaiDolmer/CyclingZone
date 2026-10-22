# Postmortem · 2026-10-21 · Mobilmenuen lukkede af sig selv (#7009)

## Hvad skete der?
E2E-testen `6904-sidebar-contact-width` (mobile-chromium) fejlede skiftevis på flere branches med "element(s) not found" for Kontakt-knappen. CI's fejlkontekst viste, at mobilmenuen var lukket, efter at testen havde klikket "Åbn menu", og at siden lige var skiftet til dansk.

## Root cause
`frontend/src/components/Layout.jsx`: effekten der bygger nav-grupperne kaldte også `setMobileOpen(false)`, med afhængighederne `[location, isAdmin, isOwner, t, …feature-flags]`. Menuen lukkede derfor ikke kun ved navigation, men også når sprog (`t`), admin-status eller et feature-flag blev indlæst asynkront lige efter åbningen. Det rammer også spillere på langsomme telefoner.

## Fix
Lukningen er flyttet til en egen effekt, der kun afhænger af `location` (PR #7010). Testen er uændret.

## Forhindret-fremover
Den eksisterende 6904-test fanger det nu stabilt (5/5 på mobile-chromium uden retries). Ved review: en UI-tilstand, der kun skal nulstilles ved navigation, må ikke ligge i en effekt med andre afhængigheder.

## Læring
En effekt med mange afhængigheder er en "kør ved alt"-effekt. Læg sideeffekter, der kun hører til ét bestemt trigger (her navigation), i deres egen effekt. Skiftevis fejlende e2e-tests på flere branches er værd at læse fejlkonteksten på, før de mærkes `@flaky`: her var det en ægte fejl.
