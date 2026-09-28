# Seniortruppens startpåmindelser: implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Et aktivt managerhold under startgulvet ser en aktuel dashboard-advarsel og får højst én indbakke-påmindelse i hvert af de godkendte tidsvinduer før første berørte start.

**Architecture:** Dashboardet bruger den allerede hentede seniortrup og viser en strip øverst i det eksisterende advarselsområde. Backendens femminutters selection-warning-cron får et særskilt read-only planlægningsled for rostersvaghed; kun `notifications` skrives gennem den etablerede dedup-sti. Nøglen er hold, løbsdag og 24/3-timers-slot. Ingen Discord, automatisk køb eller udtagelse.

**Tech Stack:** React, TypeScript/JSX, Supabase JS, Node tests, Playwright.

**Spec:** Ejerens godkendte [#5867-design](https://github.com/NicolaiDolmer/CyclingZone/issues/5867) og privat billede `OneDrive-context/private-handoffs/2026-09-28-5867-squad-reminder-combined.png`.

## Global constraints

- Læs og opdatér `docs/DASHBOARD_RULES.md`, `docs/ASSISTANT_RULES.md`, `docs/SOCIAL_RULES.md`; PAGE_TEMPLATES/TASTE styrer advarselsfladen.
- Brug startgulvet fra `raceAutopick.MIN_RACE_ENTRIES`, ikke markedets særskilte buffer.
- Nye frontend-testfiler er `.ts`/`.tsx`; EN-copy først og DA parallelt.
- Ingen prod-skrivning, flag-flip eller merge i denne session. Ét annoteret før/efter-billede før release.

## Review focus

- Ingen advarsel for parkerede, frosne, AI- eller test-hold.
- Én besked pr. hold/løbsdag/slot, også ved cron-retry og flere løb samme dato.
- En rytter købt før næste tick fjerner advarslen og forhindrer påmindelsen.
- Eksisterende selection-warning siger ikke, at assistenten kan skaffe manglende ryttere.
- Notifikationsklik fører til markedet; historiske beskeder bevares.

---

### Task 1: Delte rytter- og tidsregler

- [ ] Skriv fejlande tests for streng senioroptælling, aktive hold, fravalgte løb, nærmeste løbsdag og 24/3-timers-slots i `backend/lib/seniorStartReminder.test.js`.
- [ ] Implementér ren planlægningsfunktion i `backend/lib/seniorStartReminder.js`, med eksplicit `now` og ingen vægur-default i tests.

### Task 2: Indbakke og cron

- [ ] Test injicerbar Supabase-fetch og notification-dedup for to slots, flere samtidige løb og løst trupmangel.
- [ ] Tilføj sweep til eksisterende selection-warning-kadence i `backend/cron.js`; brug eksisterende `squad_below_minimum`-type, EN/DA metadata og ingen Discord-spejling.
- [ ] Ret den eksisterende sæsonskiftebeskeds starttekst til det faktiske deltagelsesgulv; markedets risikoværn ændres ikke.

### Task 3: Dashboard og klikmål

- [ ] Test den rene visningsbeslutning i `frontend/src/lib/seniorStartWarning.test.ts`.
- [ ] Vis advarsel i `DashboardPage.jsx` over dagens etaper, med manglende antal og roligt link til auktioner/frie agenter; ingen ekstra guld-primær eller dismiss.
- [ ] Lad nye indbakke-beskeder pege på markedet; bevar historiske notifikationers link.

### Task 4: Releasebevis

- [ ] Opdatér områdets SSOT, EN/DA-locale, hjælp og patch note i næste unikke version efter åbne #5828/#5889.
- [ ] Kør TIER FULL-preflight, relevante unit/e2e på 390 og 1440, fuld CI og ét annoteret før/efter-billede.
- [ ] Opret draft-PR. Sæt først “klar til merge”, når CI, konfliktstatus, CodeRabbit og ejerens konkrete tekst-/billedgo er afklaret.
