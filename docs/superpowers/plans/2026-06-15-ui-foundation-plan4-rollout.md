# UI-fundament Plan 4: Udrulning side-for-side (Fase 2 / DEL-C)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Hver slice = én PR, ingen adfærdsændring (kun UI), fuld gate før push.

**Goal:** Migrér hver flade fra inline-kopi → `ui/`-primitiver + emoji → `ui/icons/`, hvilket skrumper `scripts/ui-slop-baseline.json` (anti-drift-ratchet lagt i Plan 3) mod 0. Ingen adfærdsændring — kun UI. Spec: [`2026-06-14-design-system-foundation-design.md`](../specs/2026-06-14-design-system-foundation-design.md) **DEL-C C2** (migrations-sekvens) + **C3** (gates).

**Forudgående (alt merged):** Plan 1 (tokens+primitiver), 2a (Field/Table/states), 2b (overlays), 2c (ikon-sæt+Chip/Avatar/ProgressMeter), 3 (anti-drift-lint + error-boundary). Primitiv-laget + ikon-sættet er komplet — Plan 4 forbruger det.

---

## Slice-sekvens (per spec C2 — én PR pr. slice, reviewbar visuel diff)

| Slice | Flader | Baseline-gæld (slop/emoji) | Status |
|---|---|---|---|
| **A — Auth (front door)** | `LoginPage`, `ResetPasswordPage` | 5 / 4 | **MERGED** (PR #1395) |
| **B — Kerne-spiller-flader** | Dashboard, Auctions, Riders, Team, Finance, Races (+ tilhørende components) | tungest: `BoardPage` 45/10, `FinancePage` 11/1, `RacesPage` 13/5 | **delt per side** (reviewbar visuel diff, spec C2): `DashboardPage` (5 hex/11 slop/2 emoji) ✓ denne PR · resten TODO |
| **C — Profil/notifikationer/admin** | Profile, Notifications, Transfers, alle `admin/*`-tabs | tungest emoji: `AdminSeasonTab` 37, `AdminDataTab` 32, `NotificationsPage` 34 | TODO |
| **(særskilt beslutning)** | `PatchNotesPage` (68 emoji, bevidst dekorativt) | 68 emoji | kræver ejer-beslutning: behold dekorativ-emoji (EXEMPT_FILES) vs. konvertér |

Efter hver slice: ratchet `ui-slop-baseline.json` ned (`node scripts/lint-ui-slop.mjs --update-baseline`) i samme PR, så guarden strammes.

---

## Slice A — beslutninger (denne PR)

Begge auth-sider dup-kopierer `inputClass`/`primaryBtnClass` inline + bærer spec-A9-slop (grid-overlay-baggrund, accent-blur-blob, glow-shadows, `rounded-2xl`/`rounded-lg`, emoji-som-ikon).

- **Baggrunds-dekoration fjernes** (spec A9): grid-overlay (`linear-gradient`-grid) + `blur-[120px]`-accent-blob + alle `shadow-[0_0…]`/`shadow-[0_4px…]`-glows. Login bliver et rent editorial-kort på `bg-cz-body`. **Mest synlige bruger-ændring** → ejer-visuel-lås.
- **Inputs → `Input`-primitiv** as-is (`bg-cz-card` + hairline-border + global focus-ring). Ingen `bg-cz-subtle`-override — Tailwind resolver ikke bg-konflikter på class-rækkefølge, og hairline-feltet på kortet er on-spec editorial. Felt-affordance = border, ikke fill.
- **Labels/help → `labelClass()`/`helperClass()`** fra `fieldStyles.js` (fjerner inline label/help-dup), men **eksplicitte `id`'er bevares** for `aria-describedby`.
- **Delt fejl-region bevares** bespoke: `<div id="…-error" role="alert">` + alle felter `aria-describedby` den. `Field`-primitivens per-felt-error-model passer IKKE her (auth har én delt fejl-region). `rounded-lg` → `rounded-cz`.
- **Knapper → `Button`-primitiv**: submit = `variant="primary" fullWidth loading={loading}` (spinner+disabled gratis); mode-switch-links ("Forgot?"/"Sign up"/"Back to login") = `variant="ghost" size="sm"`; success/CTA = `variant="primary" fullWidth`.
- **Kort → `Card`-primitiv** (`rounded-cz` hairline) i stedet for inline `rounded-2xl`.
- **Emoji → ikoner**: signup-success 🎉 → `CheckIcon` (cz-success), forgot ✉️ → `InboxIcon` (cz-accent), reset-success ✅ → `CheckIcon`, link-inaktiv ⚠️ → `AlertTriangleIcon` (cz-danger). `IconBase size={32}`, farve via `className`.
- **ResetPasswordPage**: placeholder-"C"-tile (`rounded-2xl`+glow) → `StackedMark` (brand-konsistens m. LoginPage, #481).

### a11y-tests evolveres (ikke fjernes)
`LoginPage.a11y.test.js` + `ResetPasswordPage.a11y.test.js` er source-assertion-tests (ingen jsdom i repoet) der pinner eksakt nuværende JSX. De **rewrites til den nye source** men asserter SAMME a11y-kontrakt: htmlFor↔id, `aria-invalid` på felter ved error (nu via `Input error={…}`-prop), `aria-describedby`→fejl-id, `role="alert"`/`role="status"` live-regions, `handleSubmit`-catch-gren (#1348), `finally`-loading-clear. Kontrakten er uændret — kun udtrykket skifter.

### Gates (C3)
`cd frontend && node --test` (a11y-tests + alle frontend-tests grønne) · `npm run build` · `npm run lint` · `npm run check:i18n` (root) · `node scripts/check-eslint-warning-budget.mjs` (root) · `npm run test:lint-ui-slop && npm run lint:ui-slop` (root — baseline skrumpet, ingen nye fund) · preview-screenshots begge temaer (ejer-lås). Ingen e2e-snapshot for auth → ingen PNG-refresh.

### Patch notes
Brugerrettet (login-flade redesignes visuelt) → **ja**, kort "Changed/Improved · brand"-linje. Help/FAQ: N/A (ingen spilmekanik).

---

## Slice B — DashboardPage (post-login-landing)

Første side i Slice B; resten af kerne-fladerne følger som egne per-side-PR'er (spec C2: reviewbar visuel diff pr. PR). 18 overtrædelser (5 hex / 11 slop / 2 emoji) → 0.

- **7 neutrale kort + season-banner → `Card`-primitiv** (`bg-cz-card border border-cz-border rounded-cz`). Fjerner den duplikerede inline-kort-kopi — kernen i Plan 4. 11× `rounded-xl` (12px) → `rounded-cz` (5px).
- **3 farve-bannere bevares bespoke** (squad-warning, Discord-nudge, deadline-day): `rounded-xl` → `rounded-cz` inline. `Card` tvinger `bg-cz-card`+`border-cz-border` → passer ikke til de semantiske farve-bannere (`bg-cz-danger-bg`/`bg-cz-warning-bg` + Discord-border). Samme pragmatik som Slice A's delte fejl-region.
- **Emoji → ikoner**: squad-warning ⚠️ → `AlertTriangleIcon` (arver banner-farven via `currentColor` — bedre end emoji, der ignorerede tema), deadline 🔔 → `BellIcon` (`text-cz-danger`).
- **Discord-hex tokeniseres** (de 5 hex): `#5865F2`/`#4752c4` (Blurple + hover) → `--discord`/`--discord-hover` i `index.css` + `cz-discord`/`cz-discord-hover` i `tailwind.config`. Ekstern brand-farve på en Discord-CTA → legitim som token (samme i begge temaer); bevarer farven præcist, fjerner rå hex per anti-drift-reglen.
- **Ingen DashboardPage-source/a11y-test** → ingen pinned JSX at evolvere (modsat auth-siderne).
- **Snapshots**: `dashboard.png` (masket layout-guard) består på alle 3 projekter — radius-diff under tolerance → ingen PNG-refresh. Umasket begge-tema-verify (Playwright-mocks) bekræftede Card-migration + ikon/token-skift.

Baseline ratchet: 94 → 93 filer (DashboardPage helt fjernet). Patch note 5.37.
