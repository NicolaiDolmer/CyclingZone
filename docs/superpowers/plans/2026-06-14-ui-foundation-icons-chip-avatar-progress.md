# UI-fundament Plan 2c: Fuldt ikon-sæt + Chip/Avatar/ProgressMeter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg det fulde 30-50-ikon-sæt mod hus-spec A8 (via den eksisterende `IconBase`) + de tre resterende primitiver — Chip (hero-marketing-pille), Avatar (initialer/billede, hairline-ring, neutral) og ProgressMeter (hairline-track + accent-fyld, reduced-motion-aware) — som tynde, token-forbrugende React-primitiver, samlet i `/ui` kitchen-sink. Dette er fjerde og sidste bølge af primitiv-laget (#671).

**Architecture:** Mirror Plan 1/2a/2b nøjagtigt. Ikonerne er individuelle tree-shakeable named exports i `frontend/src/components/ui/icons/index.jsx` (eksisterende mønster — ingen restrukturering) der KUN leverer `<path>/<circle>/<rect>` indeni `IconBase`; `IconBase` håndhæver hele hus-spec'en centralt (24×24 viewBox, stroke-width 2, round caps/joins, fill none, stroke currentColor). Chip/Avatar/ProgressMeter følger primitiv-recepten: al variant→className-logik i rene funktioner (`chipStyles`/`avatarStyles`/`progressStyles`) unit-testet med `node --test`; komponent-adfærd verificeret med kilde-streng-asserts (repo-konvention — ingen jsdom/RTL). ProgressMeter-fyldets bredde-transition lever som CSS-klasse (`cz-progress-fill`) i `index.css` med `prefers-reduced-motion`-guard (spec A6) — samme recept som `cz-skeleton`/overlay-reveals. Visuelt verificeres via udvidet `/ui`-side (ikon-galleri + 3 nye sektioner) + Playwright fuld-side-snapshot (3 projekter). Dette bygger primitiverne; udskiftning af emoji på callsites (AdminTabs 🏁💰, DashboardCustomizeMenu osv.) er Plan 4.

**Tech Stack:** React 18 + Vite 8 + Tailwind 3.4, react-router-dom 6, `node --test` (Node 24), Playwright 1.60.

**Spec:** [`2026-06-14-design-system-foundation-design.md`](../specs/2026-06-14-design-system-foundation-design.md) DEL-A A8 (Ikonografi) + DEL-B (Chip, Avatar, ProgressMeter). Forudgående (merged): Plan 1 [`2026-06-14-ui-foundation-tokens-primitives.md`](2026-06-14-ui-foundation-tokens-primitives.md) (PR #1388), Plan 2a [`2026-06-14-ui-foundation-fields-table-states.md`](2026-06-14-ui-foundation-fields-table-states.md) (PR #1391), Plan 2b [`2026-06-14-ui-foundation-overlays.md`](2026-06-14-ui-foundation-overlays.md) (PR #1392).

---

## Plan-rækkefølge (dette er Plan 2c — sidste bølge af Plan 2)

Plan 2 deltes i tre review-bare bølger (ejer-beslutning 14/6):
- **Plan 2a (merged, PR #1391):** Field-sæt + Table + states (Empty/Error/Skeleton/Spinner) + Divider/Link + interim-ikoner.
- **Plan 2b (merged, PR #1392):** overlays — Modal/Dialog, Dropdown/Menu, Tooltip, Toast, Tabs.
- **Plan 2c (her):** fuldt 30-50-ikon-sæt (hus-spec A8) + Chip/Avatar/ProgressMeter.

Derefter Plan 3 (anti-drift lint-guard + error-boundary) og Plan 4+ (udrulning side-for-side: emoji→ikoner, inline-kopi→primitiver).

## Setup (før Task 1)

Kør på en feature-branch i et worktree (brug `superpowers:using-git-worktrees` / `scripts/new-worktree.ps1`). Alt herunder er `feat(ui)` via branch + PR (ingen migration → normal PR-flow). I worktree: `npm ci` i `frontend/`, og kun `VITE_`-vars i `.env` (jf. memory [[feedback_local_logged_in_verify_via_playwright_mocks]]).

```powershell
pwsh -File scripts/new-worktree.ps1 -Branch feat/ui-foundation-2c-icons-chip-avatar-progress
```

Branch-navn: `feat/ui-foundation-2c-icons-chip-avatar-progress`. Åbn ny session i worktree-pathen FØR Task 1. Verificér branch i selve commit-kæden (delt checkout, [[feedback_verify_branch_before_commit_shared_checkout]]).

## Anti-slop-vagt (gælder hver task)

Mod spec A9 + [[feedback_anti_ai_slop_design_taste]]: **ingen** `rounded-xl/2xl`, **ingen** glow (`shadow-[0_0...]`), **ingen** gradient-blob, **ingen** `backdrop-blur`, **ingen emoji som ikon** (hele pointen med dette sæt). Ikoner = geometrisk minimal linje, stroke-only (ingen fyld-flader). Kun token-klasser (`rounded-cz`, `rounded-cz-pill`, `cz-*`-farver, `shadow-overlay`). **Guld-disciplin (A9):** `cz-accent` KUN til primær-handling/leder/vinder/nøgle-accent. Chip = **neutral** (ikke guld — det er en marketing-pille, ikke et badge). Avatar = **neutral** (hairline-ring, ikke guld). ProgressMeter-fyld = `cz-accent` (en nøgle-accent: fremdrift mod mål) — default; semantiske toner (success/danger/warning) er opt-in for meningsbærende states (fx cap-overforbrug).

## Genbrug fra fundamentet (laves IKKE om)

- **`frontend/src/components/ui/icons/IconBase.jsx`** — håndhæver hele hus-spec A8 centralt (`viewBox="0 0 24 24"`, `strokeWidth={2}`, `strokeLinecap/linejoin="round"`, `fill="none"`, `stroke="currentColor"`, `role`/`aria-hidden`/`title`-håndtering, `size`-prop). De nye ikoner leverer KUN geometri (`<path>/<circle>/<rect>`) som children. **Ingen ikon må sætte egen `stroke`/`strokeWidth`/`fill`** (testet i Task 1).
- **Eksisterende 9 ikoner** (`index.jsx`): `SearchIcon`, `ChevronRightIcon`, `TrophyIcon` (Plan 1); `ChevronDownIcon`, `CheckIcon`, `XIcon`, `AlertTriangleIcon`, `InfoIcon`, `InboxIcon` (Plan 2a). Genbruges — bygges IKKE om. De 35 nye tilføjes så sættet bliver komplet og konsistent (44 i alt).
- **Tokens i `index.css` + `tailwind.config.js`:** `--radius-pill`→`rounded-cz-pill`, `--dur-slow`/`--ease` (motion), `cz-subtle`/`cz-border`/`cz-card`/`cz-accent`/`cz-2`/`cz-3` + semantiske farver. Findes allerede.
- **Styles-mønster:** `badgeStyles.js` (StatusBadge/CategoryTag), `tableStyles.js`, `modalStyles.js` osv. — rene funktioner der returnerer className-strenge. `chipStyles`/`avatarStyles`/`progressStyles` følger præcis dette.
- **Reduced-motion-recept i `index.css`:** `.cz-skeleton::after { animation: none }` + overlay-reveal-blokken (linje 235-282). `cz-progress-fill`-reglen tilføjes i samme stil lige efter.

## Fil-struktur (Plan 2c)

| Fil | Ansvar |
|---|---|
| `frontend/src/components/ui/icons/index.jsx` (modify) | + 35 nye ikon-komponenter (named exports, kun geometri via `IconBase`) |
| `frontend/src/components/ui/icons/iconSet2c.test.js` (create) | Kilde-assert: alle 35 nye ikoner defineret + ingen stroke-override + total-sæt ≥ 44 |
| `frontend/src/components/ui/chipStyles.js` (create) | Ren `chipClass()` (neutral hero-pille) |
| `frontend/src/components/ui/chipStyles.test.js` (create) | Unit-test af chip-helper |
| `frontend/src/components/ui/Chip.jsx` (create) | `Chip` (pille + valgfri ikon-slot) |
| `frontend/src/components/ui/chip.source.test.js` (create) | Kilde-assert: Chip |
| `frontend/src/components/ui/avatarStyles.js` (create) | Ren `avatarClass({size})` + `initialsFrom(name)` |
| `frontend/src/components/ui/avatarStyles.test.js` (create) | Unit-test af avatar-helpers |
| `frontend/src/components/ui/Avatar.jsx` (create) | `Avatar` (billede ELLER initialer, hairline-ring) |
| `frontend/src/components/ui/avatar.source.test.js` (create) | Kilde-assert: Avatar |
| `frontend/src/index.css` (modify) | `cz-progress-fill` bredde-transition + `prefers-reduced-motion`-guard |
| `frontend/src/components/ui/progressMeterCss.test.js` (create) | Kilde-assert: `cz-progress-fill` + reduced-motion i `index.css` |
| `frontend/src/components/ui/progressStyles.js` (create) | Rene `trackClass()` / `fillClass({tone})` + `clampPercent(value,max)` |
| `frontend/src/components/ui/progressStyles.test.js` (create) | Unit-test af progress-helpers |
| `frontend/src/components/ui/ProgressMeter.jsx` (create) | `ProgressMeter` (track + fyld, role=progressbar, tabular-tal-label) |
| `frontend/src/components/ui/progress.source.test.js` (create) | Kilde-assert: ProgressMeter |
| `frontend/src/components/ui/index.js` (modify) | Barrel-export af Chip/Avatar/ProgressMeter |
| `frontend/src/pages/KitchenSinkPage.jsx` (modify) | Ikon-galleri (erstatter 3-ikon-sektion) + Chip/Avatar/Progress-sektioner |
| `frontend/tests/e2e/kitchen-sink.spec.js` (modify) | + assertions for de nye primitiver |
| `frontend/tests/e2e/kitchen-sink.spec.js-snapshots/` (regenerate) | Opdaterede baselines (3 projekter) |

---

## Task 1: Fuldt ikon-sæt (35 nye ikoner mod hus-spec A8)

Tilføj de 35 manglende ikoner til den eksisterende `index.jsx`. Hver er en named export der følger nøjagtigt mønsteret fra de eksisterende ikoner: `export function NavnIcon(props) { return (<IconBase {...props}>…geometri…</IconBase>); }`. `IconBase` ejer hele hus-spec'en — ikonerne leverer KUN `<path>/<circle>/<rect>`. Geometrisk korrekthed eyeballes i ikon-galleriet (Task 6) + ejer-lås (Task 7); `node --test` verificerer kun struktur (named exports + ingen stroke-override + komplet sæt).

**Files:**
- Modify: `frontend/src/components/ui/icons/index.jsx` (tilføj efter `InboxIcon`, før filens slut)
- Test: `frontend/src/components/ui/icons/iconSet2c.test.js`

- [ ] **Step 1: Write the failing test** (`frontend/src/components/ui/icons/iconSet2c.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.jsx"), "utf8");

const NEW_2C = [
  // generelle
  "SettingsIcon", "BellIcon", "ChevronUpIcon", "ChevronLeftIcon", "PlusIcon", "MinusIcon",
  "FilterIcon", "SortIcon", "CalendarIcon", "TeamIcon", "UserIcon", "EditIcon", "TrashIcon",
  "ExternalLinkIcon", "EyeIcon", "LockIcon", "DownloadIcon", "UploadIcon", "ClockIcon",
  "StarIcon", "HeartIcon", "MenuIcon", "ArrowUpIcon", "ArrowDownIcon", "CoinIcon",
  // cykel-specifikke
  "TagIcon", "JerseyIcon", "MountainIcon", "SprintIcon", "TimeTrialIcon", "BikeIcon",
  "RoadIcon", "PodiumIcon", "StopwatchIcon", "FlagIcon",
];

test("alle 35 Plan 2c-ikoner er defineret som named exports", () => {
  for (const name of NEW_2C) {
    assert.match(src, new RegExp(`export function ${name}\\(`), `mangler ${name}`);
  }
});

test("ingen ikon overrider hus-spec (IconBase ejer stroke/fill/viewBox centralt)", () => {
  assert.ok(!/stroke-width|strokeWidth/.test(src), "ikoner maa ikke override stroke");
  assert.ok(!/\bfill="(?!none)/.test(src), "ikoner maa ikke saette egen fill");
  assert.ok(!/viewBox=/.test(src), "kun IconBase saetter viewBox");
});

test("det samlede saet er komplet (>= 44 ikoner: 9 eksisterende + 35 nye)", () => {
  const count = (src.match(/export function \w+Icon\(/g) ?? []).length;
  assert.ok(count >= 44, `forventede >= 44 ikoner, fandt ${count}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/icons/iconSet2c.test.js`
Expected: FAIL (`mangler SettingsIcon`).

- [ ] **Step 3: Tilføj de 35 ikoner** til `frontend/src/components/ui/icons/index.jsx` (indsæt efter `InboxIcon`-funktionen, dvs. efter filens nuværende linje 79):

```jsx

// --- Plan 2c: fuldt saet (hus-spec A8). Stroke-only geometrisk minimal linje;
//     IconBase ejer viewBox/stroke/fill/caps. Erstatter ALLE emoji (udrulning = Plan 4). ---

// Generelle
export function SettingsIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 2.5L20.2 7.25V16.75L12 21.5 3.8 16.75V7.25z" />
      <circle cx="12" cy="12" r="3.2" />
    </IconBase>
  );
}

export function BellIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 16l1-2V9a5 5 0 0 1 10 0v5l1 2z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </IconBase>
  );
}

export function ChevronUpIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 15l6-6 6 6" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M15 6l-6 6 6 6" />
    </IconBase>
  );
}

export function PlusIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function MinusIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function FilterIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 5h16l-6 7v6l-4-2v-4z" />
    </IconBase>
  );
}

export function SortIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M11 7L8 4 5 7M8 4v16" />
      <path d="M13 17l3 3 3-3M16 20V4" />
    </IconBase>
  );
}

export function CalendarIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </IconBase>
  );
}

export function TeamIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17 14.2a5.5 5.5 0 0 1 3.5 4.8" />
    </IconBase>
  );
}

export function UserIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </IconBase>
  );
}

export function EditIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" />
      <path d="M14 7l3 3" />
    </IconBase>
  );
}

export function TrashIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </IconBase>
  );
}

export function ExternalLinkIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </IconBase>
  );
}

export function EyeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

export function LockIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
    </IconBase>
  );
}

export function DownloadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M5 21h14" />
    </IconBase>
  );
}

export function UploadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 21h14" />
    </IconBase>
  );
}

export function ClockIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  );
}

export function StarIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8z" />
    </IconBase>
  );
}

export function HeartIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 11-8 11z" />
    </IconBase>
  );
}

export function MenuIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconBase>
  );
}

export function ArrowUpIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 20V4M6 10l6-6 6 6" />
    </IconBase>
  );
}

export function ArrowDownIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 4v16M6 14l6 6 6-6" />
    </IconBase>
  );
}

export function CoinIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 8.5a4 4 0 1 0 0 7" />
      <path d="M7 11h6M7 13.5h5" />
    </IconBase>
  );
}

// Cykel-specifikke
export function TagIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M11 3H5a2 2 0 0 0-2 2v6l9 9 8-8z" />
      <circle cx="8" cy="8" r="1.5" />
    </IconBase>
  );
}

export function JerseyIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M8 4L3 9l2.5 2.5L7 10v10h10V10l1.5 1.5L21 9l-5-5a4 4 0 0 1-8 0z" />
    </IconBase>
  );
}

export function MountainIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 19l6-11 4 6 2-3 6 8z" />
    </IconBase>
  );
}

export function SprintIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 6l6 6-6 6M12 6l6 6-6 6" />
    </IconBase>
  );
}

export function TimeTrialIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="13" cy="13" r="7" />
      <path d="M13 9v4l3 2" />
      <path d="M3 9h4M2 13h4" />
    </IconBase>
  );
}

export function BikeIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="16" r="4" />
      <circle cx="18" cy="16" r="4" />
      <path d="M6 16l5-8h5M11 8l4 8M9 8h4" />
    </IconBase>
  );
}

export function RoadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 21L11 3h2l2 18z" />
      <path d="M12 7v2.5M12 13v2.5" />
    </IconBase>
  );
}

export function PodiumIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="9" y="8" width="6" height="13" />
      <rect x="3" y="13" width="6" height="8" />
      <rect x="15" y="15" width="6" height="6" />
    </IconBase>
  );
}

export function StopwatchIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="14" r="7" />
      <path d="M12 14V10" />
      <path d="M10 3h4M12 3v2" />
      <path d="M18.5 8l1.5-1.5" />
    </IconBase>
  );
}

export function FlagIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 21V4" />
      <path d="M5 5h13l-2.5 4 2.5 4H5z" />
      <path d="M5 9h11M11.5 5v8" />
    </IconBase>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/icons/iconSet2c.test.js`
Expected: PASS (3 tests). Kør også de eksisterende ikon-tests for at bekræfte intet brød: `cd frontend && node --test src/components/ui/icons/iconBase.test.js src/components/ui/icons/iconSet2a.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/icons/index.jsx frontend/src/components/ui/icons/iconSet2c.test.js
git commit -m "feat(ui): fuldt ikon-saet (35 nye, hus-spec A8) — 44 ikoner i alt"
```

---

## Task 2: Chip (chipStyles + Chip)

Chip = hero-marketing-pille (999px `rounded-cz-pill`), **neutral** (hairline-border + subtle bg, IKKE guld), uppercase Inter-Tight-label. KUN sparsom marketing (fx "Open beta · Free to play") — aldrig som default-badge (det er StatusBadge/CategoryTag's job). Valgfri ikon-slot til venstre.

**Files:**
- Create: `frontend/src/components/ui/chipStyles.js`, `frontend/src/components/ui/Chip.jsx`
- Test: `frontend/src/components/ui/chipStyles.test.js`, `frontend/src/components/ui/chip.source.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/chipStyles.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { chipClass } from "./chipStyles.js";

test("chip er en pille (999px) med hairline-border + subtle flade", () => {
  const c = chipClass();
  assert.ok(c.includes("rounded-cz-pill"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(c.includes("bg-cz-subtle"));
  assert.ok(c.includes("uppercase"));
});

test("chip er neutral — ALDRIG guld (guld-disciplin A9)", () => {
  const c = chipClass();
  assert.ok(!c.includes("cz-accent"), "chip maa ikke bruge guld");
});

test("chip er ikke et slop-badge (ingen rounded-xl/2xl)", () => {
  const c = chipClass();
  assert.ok(!/rounded-(xl|2xl)/.test(c));
});

test("ekstra className foejes til", () => {
  assert.ok(chipClass({ className: "w-40" }).includes("w-40"));
});
```

`frontend/src/components/ui/chip.source.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Chip.jsx"), "utf8");

test("Chip bruger chipClass og forwarder rest-props", () => {
  assert.match(src, /chipClass\(/);
  assert.match(src, /\.\.\.rest/);
});

test("Chip har en valgfri ikon-slot (aria-hidden)", () => {
  assert.match(src, /icon/);
  assert.match(src, /aria-hidden/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/chipStyles.test.js src/components/ui/chip.source.test.js`
Expected: FAIL (`Cannot find module './chipStyles.js'`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/chipStyles.js`

```js
// Hero-marketing-pille (spec B2 + A9). Neutral — ALDRIG guld (det er et badge-look
// vi bevidst undgaar). Sparsom brug: kun marketing ("Open beta · Free to play").
const CHIP_BASE =
  "inline-flex items-center gap-2 rounded-cz-pill border border-cz-border bg-cz-subtle " +
  "px-3.5 py-1.5 font-data text-xs font-semibold uppercase tracking-[.08em] text-cz-2";

export function chipClass({ className = "" } = {}) {
  return `${CHIP_BASE} ${className}`.trim();
}
```

`frontend/src/components/ui/Chip.jsx`

```jsx
import { chipClass } from "./chipStyles.js";

// Sparsom hero-pille. `icon` er valgfri (et ikon-element); placeres til venstre.
export default function Chip({ icon, className = "", children, ...rest }) {
  return (
    <span className={chipClass({ className })} {...rest}>
      {icon && (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/chipStyles.test.js src/components/ui/chip.source.test.js`
Expected: PASS (chipStyles: 4, chip.source: 2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/chipStyles.js frontend/src/components/ui/Chip.jsx frontend/src/components/ui/chipStyles.test.js frontend/src/components/ui/chip.source.test.js
git commit -m "feat(ui): Chip (neutral hero-marketing-pille, valgfri ikon-slot)"
```

---

## Task 3: Avatar (avatarStyles + Avatar)

Avatar = rund (`rounded-cz-pill`), neutral subtle-flade med **hairline-ring** (`ring-1 ring-cz-border`, IKKE guld). Viser `<img src>` hvis givet, ellers initialer udledt fra `name` (første bogstav af de første to ord). Sizes sm/md/lg. `role="img"` + `aria-label={name}` for tilgængelighed.

**Files:**
- Create: `frontend/src/components/ui/avatarStyles.js`, `frontend/src/components/ui/Avatar.jsx`
- Test: `frontend/src/components/ui/avatarStyles.test.js`, `frontend/src/components/ui/avatar.source.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/avatarStyles.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarClass, initialsFrom } from "./avatarStyles.js";

test("avatar er rund, neutral, med hairline-ring (ikke guld)", () => {
  const c = avatarClass();
  assert.ok(c.includes("rounded-cz-pill"));
  assert.ok(c.includes("ring-1"));
  assert.ok(c.includes("ring-cz-border"));
  assert.ok(c.includes("bg-cz-subtle"));
  assert.ok(!c.includes("cz-accent"), "avatar er neutral, aldrig guld");
});

test("size styrer dimension; ukendt falder tilbage til md", () => {
  assert.ok(avatarClass({ size: "sm" }).includes("h-7 w-7"));
  assert.ok(avatarClass({ size: "lg" }).includes("h-12 w-12"));
  assert.equal(avatarClass({ size: "zz" }), avatarClass({ size: "md" }));
});

test("initialsFrom tager foerste bogstav af de foerste to ord, uppercase", () => {
  assert.equal(initialsFrom("Ada Pedersen"), "AP");
  assert.equal(initialsFrom("ada van der poel"), "AV");
  assert.equal(initialsFrom("Bo"), "B");
  assert.equal(initialsFrom("  spaced   out  "), "SO");
});

test("initialsFrom haandterer tom/ugyldig input", () => {
  assert.equal(initialsFrom(""), "");
  assert.equal(initialsFrom(), "");
});
```

`frontend/src/components/ui/avatar.source.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Avatar.jsx"), "utf8");

test("Avatar bruger avatarClass + initialsFrom", () => {
  assert.match(src, /avatarClass\(/);
  assert.match(src, /initialsFrom\(/);
});

test("Avatar viser billede naar src er sat, ellers initialer", () => {
  assert.match(src, /src \?/);
  assert.match(src, /<img/);
  assert.match(src, /object-cover/);
});

test("Avatar er a11y-mærket (role=img + aria-label)", () => {
  assert.match(src, /role="img"/);
  assert.match(src, /aria-label=/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/avatarStyles.test.js src/components/ui/avatar.source.test.js`
Expected: FAIL (`Cannot find module './avatarStyles.js'`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/avatarStyles.js`

```js
// Neutral avatar (spec B2). Hairline-ring, aldrig guld. Bærer initialer ELLER billede.
const AVATAR_BASE =
  "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-cz-pill " +
  "bg-cz-subtle text-cz-2 ring-1 ring-cz-border font-data font-semibold uppercase";

const AVATAR_SIZES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

export function avatarClass({ size = "md" } = {}) {
  return `${AVATAR_BASE} ${AVATAR_SIZES[size] ?? AVATAR_SIZES.md}`;
}

// Initialer: foerste bogstav af de foerste to ord (maks 2), uppercase.
export function initialsFrom(name = "") {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
```

`frontend/src/components/ui/Avatar.jsx`

```jsx
import { avatarClass, initialsFrom } from "./avatarStyles.js";

// Billede ELLER initialer (udledt af `name`). Neutral hairline-ring.
export default function Avatar({ name = "", src, size = "md", className = "", ...rest }) {
  return (
    <span
      role="img"
      aria-label={name || undefined}
      className={`${avatarClass({ size })} ${className}`}
      {...rest}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{initialsFrom(name)}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/avatarStyles.test.js src/components/ui/avatar.source.test.js`
Expected: PASS (avatarStyles: 4, avatar.source: 3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/avatarStyles.js frontend/src/components/ui/Avatar.jsx frontend/src/components/ui/avatarStyles.test.js frontend/src/components/ui/avatar.source.test.js
git commit -m "feat(ui): Avatar (initialer/billede, hairline-ring, neutral)"
```

---

## Task 4: ProgressMeter-fyld-CSS (reduced-motion-aware)

ProgressMeter-fyldets bredde-overgang lever som CSS-klasse i `index.css` (samme recept som `cz-skeleton`/overlay-reveals). `prefers-reduced-motion` slår overgangen fra (spec A6, hard krav). Komponenten (Task 5) tilføjer bare `cz-progress-fill`-klassen + sætter `width` inline.

**Files:**
- Modify: `frontend/src/index.css` (efter overlay-reveal-blokken, før `.font-mono,`-reglen)
- Test: `frontend/src/components/ui/progressMeterCss.test.js`

- [ ] **Step 1: Write the failing test** (`frontend/src/components/ui/progressMeterCss.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("cz-progress-fill har en bredde-overgang paa motion-tokens", () => {
  assert.match(css, /\.cz-progress-fill\s*\{\s*transition:\s*width var\(--dur-slow\) var\(--ease\)/);
});

test("reduced-motion slaar fyld-overgangen fra (A6, hard krav)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cz-progress-fill\s*\{\s*transition:\s*none/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/progressMeterCss.test.js`
Expected: FAIL (`.cz-progress-fill` ikke fundet).

- [ ] **Step 3: Add CSS** til `frontend/src/index.css` (indsæt efter overlay-reveal-blokkens afsluttende `}` på linje 282, før `/* Inter Tight is the data font ... */`-kommentaren på linje 284):

```css

/* ProgressMeter-fyld (#671 Plan 2c). Glidende bredde-overgang; INGEN glow.
   prefers-reduced-motion slaar overgangen fra (spec A6, hard krav). */
.cz-progress-fill { transition: width var(--dur-slow) var(--ease); }
@media (prefers-reduced-motion: reduce) {
  .cz-progress-fill { transition: none; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/progressMeterCss.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/components/ui/progressMeterCss.test.js
git commit -m "feat(ui): cz-progress-fill bredde-overgang (reduced-motion-aware)"
```

---

## Task 5: ProgressMeter (progressStyles + ProgressMeter)

`trackClass()` = hairline-track (subtle bg, fuld bredde, pille-rundet, clipper fyldet). `fillClass({tone})` = fyld-bar; default `cz-accent` (nøgle-accent: fremdrift), semantiske toner opt-in. `clampPercent(value, max)` klamper til 0-100 og er robust mod ugyldig input. `ProgressMeter` er `role="progressbar"` med aria-værdier + valgfri label + valgfri tabular-tal-procent.

**Files:**
- Create: `frontend/src/components/ui/progressStyles.js`, `frontend/src/components/ui/ProgressMeter.jsx`
- Test: `frontend/src/components/ui/progressStyles.test.js`, `frontend/src/components/ui/progress.source.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/progressStyles.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { trackClass, fillClass, clampPercent } from "./progressStyles.js";

test("track er hairline-pille der clipper fyldet", () => {
  const c = trackClass();
  assert.ok(c.includes("w-full"));
  assert.ok(c.includes("overflow-hidden"));
  assert.ok(c.includes("rounded-cz-pill"));
  assert.ok(c.includes("bg-cz-subtle"));
});

test("fyld er accent som default (nøgle-accent) + cz-progress-fill-klasse", () => {
  const c = fillClass();
  assert.ok(c.includes("cz-progress-fill"));
  assert.ok(c.includes("bg-cz-accent"));
});

test("tone styrer fyld-farve; ukendt falder tilbage til accent", () => {
  assert.ok(fillClass({ tone: "danger" }).includes("bg-cz-danger"));
  assert.ok(fillClass({ tone: "success" }).includes("bg-cz-success"));
  assert.equal(fillClass({ tone: "zz" }), fillClass({ tone: "accent" }));
});

test("clampPercent normaliserer value/max til 0-100 og er robust", () => {
  assert.equal(clampPercent(50, 100), 50);
  assert.equal(clampPercent(1, 4), 25);
  assert.equal(clampPercent(150, 100), 100);
  assert.equal(clampPercent(-5, 100), 0);
  assert.equal(clampPercent(Number.NaN, 100), 0);
  assert.equal(clampPercent(5, 0), 0);
});
```

`frontend/src/components/ui/progress.source.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ProgressMeter.jsx"), "utf8");

test("ProgressMeter bruger track/fill-helpers + clampPercent", () => {
  assert.match(src, /trackClass\(/);
  assert.match(src, /fillClass\(/);
  assert.match(src, /clampPercent\(/);
});

test("ProgressMeter er role=progressbar med aria-værdier", () => {
  assert.match(src, /role="progressbar"/);
  assert.match(src, /aria-valuenow=/);
  assert.match(src, /aria-valuemin=/);
  assert.match(src, /aria-valuemax=/);
});

test("fyldet sætter bredde inline efter clampet procent", () => {
  assert.match(src, /style=\{\{ width: `\$\{pct\}%` \}\}/);
});

test("valgfri tal-label er tabular (Inter Tight)", () => {
  assert.match(src, /tabular-nums/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/progressStyles.test.js src/components/ui/progress.source.test.js`
Expected: FAIL (`Cannot find module './progressStyles.js'`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/progressStyles.js`

```js
const TRACK_BASE = "h-2 w-full overflow-hidden rounded-cz-pill bg-cz-subtle";

const FILL_TONE = {
  accent: "bg-cz-accent",
  success: "bg-cz-success",
  danger: "bg-cz-danger",
  warning: "bg-cz-warning",
};

export function trackClass({ className = "" } = {}) {
  return `${TRACK_BASE} ${className}`.trim();
}

export function fillClass({ tone = "accent" } = {}) {
  return `cz-progress-fill h-full rounded-cz-pill ${FILL_TONE[tone] ?? FILL_TONE.accent}`;
}

// Normalisér value/max -> 0-100. Robust mod NaN/negativ/0-max (returnér 0).
export function clampPercent(value, max = 100) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
```

`frontend/src/components/ui/ProgressMeter.jsx`

```jsx
import { trackClass, fillClass, clampPercent } from "./progressStyles.js";

// Hairline-track + accent-fyld (spec B2). Glidende bredde-overgang (cz-progress-fill,
// reduced-motion-aware). Valgfri label + tabular-tal-procent.
export default function ProgressMeter({
  value = 0,
  max = 100,
  tone = "accent",
  label,
  showValue = false,
  ariaLabel,
  className = "",
  trackClassName = "",
  ...rest
}) {
  const pct = clampPercent(value, max);
  return (
    <div className={className} {...rest}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label ? <span className="text-xs font-medium text-cz-2">{label}</span> : <span />}
          {showValue && (
            <span className="font-data text-xs font-semibold tabular-nums text-cz-1">{Math.round(pct)}%</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel ?? label}
        className={trackClass({ className: trackClassName })}
      >
        <div className={fillClass({ tone })} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/progressStyles.test.js src/components/ui/progress.source.test.js`
Expected: PASS (progressStyles: 4, progress.source: 4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/progressStyles.js frontend/src/components/ui/ProgressMeter.jsx frontend/src/components/ui/progressStyles.test.js frontend/src/components/ui/progress.source.test.js
git commit -m "feat(ui): ProgressMeter (hairline-track + accent-fyld, role=progressbar, tabular-label)"
```

---

## Task 6: Barrel-export + kitchen-sink (ikon-galleri + Chip/Avatar/Progress)

**Files:**
- Modify: `frontend/src/components/ui/index.js`
- Modify: `frontend/src/pages/KitchenSinkPage.jsx`

- [ ] **Step 1: Udvid barrel** `frontend/src/components/ui/index.js` — tilføj efter `export { Tabs, TabList, Tab, TabPanel } from "./Tabs.jsx";` og FØR `export * from "./icons/index.jsx";`:

```js
export { default as Chip } from "./Chip.jsx";
export { default as Avatar } from "./Avatar.jsx";
export { default as ProgressMeter } from "./ProgressMeter.jsx";
```

- [ ] **Step 2: Erstat import-blokken** øverst i `frontend/src/pages/KitchenSinkPage.jsx` (linje 1-10) med (tilføjer Chip/Avatar/ProgressMeter + en namespace-import af hele ikon-sættet til galleriet):

```jsx
import { useState } from "react";
import {
  Button, StatusBadge, CategoryTag, Card,
  Field, Input, Textarea, Select, Checkbox, Radio, Toggle,
  Table, Tr, Th, Td, JerseyDot,
  EmptyState, ErrorState, Skeleton, Spinner, Divider, Link,
  Modal, DialogSurface, Dropdown, MenuItem, Tooltip, Toast,
  Tabs, TabList, Tab, TabPanel,
  Chip, Avatar, ProgressMeter,
  SearchIcon, ChevronRightIcon, TrophyIcon, InboxIcon,
} from "../components/ui/index.js";
import * as Icons from "../components/ui/icons/index.jsx";

// Hele ikon-sættet, alfabetisk (module-namespace -> sorterede nøgler = stabilt snapshot).
const ICON_ENTRIES = Object.entries(Icons).filter(([name]) => name.endsWith("Icon"));
```

- [ ] **Step 3: Erstat den eksisterende `Icons`-sektion** (de nuværende linje 72-76: `<Section title="Icons"> … </Section>`) med et fuldt ikon-galleri:

```jsx
      <Section title="Icon set">
        <div className="grid w-full grid-cols-6 gap-px overflow-hidden rounded-cz border border-cz-border bg-cz-border sm:grid-cols-8">
          {ICON_ENTRIES.map(([name, Icon]) => (
            <div key={name} className="flex flex-col items-center gap-2 bg-cz-card px-2 py-3">
              <Icon size={20} className="text-cz-2" />
              <span className="font-data text-[9px] uppercase tracking-[.05em] text-cz-3">
                {name.replace(/Icon$/, "")}
              </span>
            </div>
          ))}
        </div>
      </Section>
```

- [ ] **Step 4: Indsæt Chip/Avatar/Progress-sektioner** lige EFTER `</Section>` der lukker "Dividers & links" (nuværende linje 174) og FØR `<Section title="Tabs">`. (Holder den åbne Dropdown-menu sidst i siden, så dens absolut-positionerede panel ikke overlapper de nye sektioner i snapshottet.)

```jsx
      <Section title="Chip (marketing)">
        <Chip>Open beta · Free to play</Chip>
        <Chip icon={<TrophyIcon size={13} className="text-cz-2" />}>Season 1 · Live</Chip>
      </Section>

      <Section title="Avatar">
        <Avatar name="Ada Pedersen" size="sm" />
        <Avatar name="Bo Nielsen" />
        <Avatar name="Casper Vingegaard" size="lg" />
      </Section>

      <Section title="Progress">
        <div className="w-72 space-y-4">
          <ProgressMeter label="Season form" value={72} showValue />
          <ProgressMeter label="Cap used" tone="danger" value={94} showValue />
          <ProgressMeter value={40} ariaLabel="Stage completion" />
        </div>
      </Section>
```

- [ ] **Step 5: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build OK, ingen import-fejl (verificerer extensionless/ESM-importerne, jf. #803). Bekræft INGEN ny eslint-warning der bryder warning-budget (galleriets `key={name}` + `Icon`-komponent-variabel skal være rene).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/index.js frontend/src/pages/KitchenSinkPage.jsx
git commit -m "feat(ui): barrel-export + kitchen-sink ikon-galleri + Chip/Avatar/Progress"
```

---

## Task 7: Snapshot-regen + fuld gate + ejer-lås

**Files:**
- Modify: `frontend/tests/e2e/kitchen-sink.spec.js`
- Regenerate: `frontend/tests/e2e/kitchen-sink.spec.js-snapshots/` (3 PNG'er)

- [ ] **Step 1: Tilføj assertions for de nye primitiver** — opdatér `frontend/tests/e2e/kitchen-sink.spec.js` så test'en fanger de nye sektioner (efter `Open dialog`-assertionen, før `toHaveScreenshot`):

```js
  await expect(page.getByText("Open beta · Free to play")).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toBeVisible();
```

- [ ] **Step 2: Regenerér baselines (alle 3 projekter)**

Run: `cd frontend && npx playwright test kitchen-sink --update-snapshots`
Expected: 3 baseline-PNG'er opdateret (desktop-chromium + mobile-chromium + mobile-webkit). Eyeball dem i `tests/e2e/kitchen-sink.spec.js-snapshots/` — kontrollér:
- **Ikon-galleri:** alle 44 ikoner rendrer rent, samme stroke-vægt/optisk størrelse, ingen tomme celler, ingen fyldte flader (stroke-only). Tjek de håndskrevne paths visuelt: bell, settings (hex+cirkel), jersey, mountain, bike, podium, stopwatch, flag, coin (€), tag — at de er genkendelige. Justér paths hvis en ser forkert ud (geometri er ikke gate-testet, kun struktur).
- **Chip:** neutral pille (ingen guld), 999px, hairline-border.
- **Avatar:** 3 størrelser, runde, hairline-ring, initialer "AP"/"BN"/"CV".
- **Progress:** 3 meters — "Season form" guld-fyld + "72%", "Cap used" danger-fyld + "94%", umærket 40%.
- Intet slop: skarp 5px på galleri-rammen, ingen glow, ingen blur, ingen emoji.

- [ ] **Step 3: Re-run to verify they pass**

Run: `cd frontend && npx playwright test kitchen-sink`
Expected: PASS (3 projekter).

- [ ] **Step 4: Full local gate** (jf. CLAUDE.md pre-flight + [[feedback_full_ci_gate_before_pr]])

Run: `pwsh -File scripts/verify-local.ps1` (backend + frontend `node --test` + frontend build)
Run: `cd frontend && npm run lint`
Run: `cd frontend && npm run check:i18n` (eller projektets i18n-leak-kommando — `/ui` er intern, men gaten skal være grøn)
Run: `cd frontend && npx playwright test core-smoke` (verificér INGEN regression i eksisterende snapshots fra den nye `index.css`-regel; en utilsigtet diff = regression der fixes, ikke snapshottes væk)
Expected: alt grønt. Warning-budget ikke overskredet.

- [ ] **Step 5: Commit + push + PR**

```bash
git add frontend/tests/e2e/kitchen-sink.spec.js frontend/tests/e2e/kitchen-sink.spec.js-snapshots/
git commit -m "test(ui): kitchen-sink snapshot m. Plan 2c ikon-galleri + Chip/Avatar/Progress (3 projekter)"
git push -u origin feat/ui-foundation-2c-icons-chip-avatar-progress
```

Opret PR. PR-body skal have **Brugerverifikation-sektion** (frontend → ikke `backend-only`/`docs-only`) jf. [[feedback_pr_body_brugerverifikation]]. **Patch notes:** ikke nødvendige — intet bruger-vendt endnu; `/ui` er intern reference, og udrulning til callsites (emoji→ikoner) er Plan 4. Noter dét eksplicit i PR-body. Ingen migration → normal PR-flow (men ejer-lås før merge, jf. Step 6).

- [ ] **Step 6: EJER-LÅS (visuelt gate)**

Start preview, åbn `/ui`, og bed ejeren se ikon-galleriet + de tre primitiver i begge temaer (theme-toggle). **Lås looket eller noter justeringer FØR Plan 2c afsluttes.** Verificér særligt:
- **Ikon-sæt:** hvert ikon genkendeligt + optisk konsistent (samme vægt, samme luft); cykel-specifikke (jersey, mountain/KOM, sprint, time-trial, bike, road, podium, stopwatch, flag, trophy, tag) bærer brand-følelsen. Noter ALLE der skal omtegnes.
- **Chip:** neutral, sparsom, premium marketing-følelse — ikke et badge.
- **Avatar:** hairline-ring læselig i begge temaer; initialer centreret; billed-variant (manuelt: sæt `src` midlertidigt) clipper rundt.
- **ProgressMeter:** guld-fyld (default) vs. danger-fyld; tabular-tal flugter; **reduced-motion:** slå OS-reduced-motion til → ingen bredde-animation når value ændres (spec A6).
- **VIGTIGT — verifikations-gotcha (Plan 2b):** ved MANUEL/interaktiv Playwright-verifikation lokalt, kør altid med en frisk `PW_PORT` (`reuseExistingServer: true` kan ellers servere et stale build → false-red). Se `.claude/learnings/2026-06-14-playwright-reuse-existing-server-stale-build-false-red.md`.

---

## Self-review (udført)

- **Spec-dækning:**
  - **A8 Ikonografi** (24×24, stroke 2, round caps, fill none, currentColor, geometrisk minimal linje, tree-shakeable, 30-50 ikoner, generelle + cykel-specifikke) = Task 1: 35 nye + 9 eksisterende = **44 ikoner** via `IconBase` (håndhæver hus-spec centralt). Generelle dækket: search✓, settings, bell, chevron up/down✓/left/right✓, plus, minus, close✓(X), check✓, alert✓, info✓, filter, sort, calendar, team, user, edit, trash, external-link, eye, lock, download, upload, clock, star, heart, menu, arrow-up/down, coin. Cykel: trophy✓, tag(auction), jersey, mountain/KOM, sprint, time-trial, bike, road, podium, stopwatch, flag. (✓ = allerede bygget i Plan 1/2a.)
  - **Chip** (hero-pille 999px, sparsom marketing) = Task 2 (`chipClass` = `rounded-cz-pill` + hairline + subtle, neutral/ikke-guld; valgfri ikon-slot).
  - **Avatar** (initialer/billede, hairline-ring, neutral) = Task 3 (`avatarClass` + `initialsFrom`; img-fallback; `role=img`).
  - **ProgressMeter** (hairline-track + accent-fyld, reduced-motion-aware, tabular-tal-label) = Task 4 (`cz-progress-fill`-CSS + reduced-motion-guard) + Task 5 (`trackClass`/`fillClass`/`clampPercent`; `role=progressbar`; tabular `%`-label).
  - Eksplicit ude af scope: udskiftning af emoji på callsites (AdminTabs 🏁💰, DashboardCustomizeMenu) = Plan 4; anti-drift-lint + error-boundary = Plan 3.
- **Placeholders:** ingen TBD/TODO; hvert kode-trin har faktisk kode + kommando + forventet output. (Ikon-paths er konkrete; geometrisk finpudsning sker i eyeball/ejer-lås — struktur er testet, geometri er et visuelt gate, samme rytme som Plan 2a/2b.)
- **Type-konsistens:** `chipClass` (Task 2) → Chip (Task 2). `avatarClass`/`initialsFrom` (Task 3) → Avatar (Task 3). `trackClass`/`fillClass`/`clampPercent` (Task 5) → ProgressMeter (Task 5). CSS-klassen `cz-progress-fill` (Task 4) forbruges af `fillClass` (Task 5). `IconBase` (eksisterende) → alle 35 ikoner (Task 1). Alle nye primitiver eksporteres i Task 6's barrel og rendres i kitchen-sink samme task; ikon-galleriet henter hele sættet via `import * as Icons` (auto-inkluderer alle named `*Icon`-exports, alfabetisk → stabilt snapshot).
- **Anti-slop:** ingen `rounded-xl/2xl` (testet i chipStyles); ingen glow/blur/gradient; ingen emoji (sættet ER emoji-erstatningen); ikoner stroke-only (testet: ingen `fill="…"` ≠ none, ingen stroke-override). **Guld-disciplin:** Chip neutral (testet `!cz-accent`), Avatar neutral (testet `!cz-accent`), ProgressMeter-fyld accent som default (nøgle-accent: fremdrift) + semantiske toner opt-in — ikke en rutine-flade.

## Åbne afhængigheder / noter

- **Ikoner bliver i `index.jsx`** (named exports) frem for én fil pr. ikon — følger Plan 1/2a-konventionen og er tree-shakeable via Rollup (named exports drops hvis ubrugt). Ingen unilateral restrukturering.
- **Ikon-geometri er IKKE node-test-gated** (kun struktur: named exports + ingen stroke-override). Visuel korrekthed fanges i ikon-galleri-eyeball (Task 7 Step 2) + ejer-lås (Step 6). Forvent at 2-5 paths skal finpudses efter første render — det er bevidst (samme build→snapshot→lås-rytme som 2a/2b).
- **CoinIcon tegner et €-symbol** (ikke $) — on-brand, da spillet er €-denomineret (team value €1.24M). Navnet er generisk (`CoinIcon`) jf. spec-listens "money/coin".
- **ProgressMeter-fyld bruger `cz-accent` som default** — bevidst undtagelse fra "guld kun på handling/leder": fremdrift mod mål er en nøgle-accent (spec A9 tillader "nøgle-accenter"). Semantiske toner (danger/warning/success) er til meningsbærende states (cap-overforbrug osv.).
- **Playwright-snapshots er win32-baseline** (frontend-smoke advisory, jf. [[reference_frontend_smoke_teardown_flake]]); CI's frontend-smoke kan teardown-flake uden at være hard-gate.
- **Den nye `index.css`-regel** (`cz-progress-fill`) er en ny klasse → påvirker IKKE eksisterende flader. Kør alligevel core-smoke (Task 7 Step 4) for at bekræfte nul regression.
