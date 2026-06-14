# UI-fundament Plan 2b: Overlays (Modal/Dropdown/Tooltip/Toast/Tabs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg overlay-primitiverne — Modal/Dialog, Dropdown/Menu, Tooltip, Toast og Tabs — som tynde, token-forbrugende React-primitiver mod det ejer-låste look, der deler portal / focus-trap / z-index / Esc-luk og konsoliderer de eksisterende ad hoc-varianter (de 5 modaler, OverbidToast, DashboardCustomizeMenu, AdminTabs), samlet i `/ui` kitchen-sink.

**Architecture:** Mirror Plan 1/2a nøjagtigt: primitiver i `frontend/src/components/ui/`, al variant→className-logik i rene funktioner unit-testet med `node --test`, komponent-/hook-adfærd verificeret med kilde-streng-asserts (repo-konvention — ingen jsdom/RTL). Overlay-reveals (fade/pop/slide) lever som CSS-klasser i `index.css` med `prefers-reduced-motion`-guard (spec A6) — samme recept som `cz-skeleton` fra 2a. Modal **genbruger den eksisterende `useModalA11y`-hook** (focus-trap + Esc + scroll-lock + focus-restore, `frontend/src/hooks/useModalA11y.js`) bag en `Portal` + scrim; Dropdown deler en ny `useDismiss`-hook (klik-udenfor + Esc). z-index bruger de eksisterende tokens (`z-dropdown/overlay/modal/toast`). Visuelt verificeres via udvidet `/ui`-side + Playwright fuld-side-snapshot (3 projekter). Dette bygger primitiverne; udrulning til eksisterende callsites (BidConfirmModal/ConfettiModal/OnboardingModal/RacePriceModal/SetupWizardModal, OverbidToast, DashboardCustomizeMenu, AdminTabs) er Plan 4.

**Tech Stack:** React 18 + Vite 8 + Tailwind 3.4, react-router-dom 6, `node --test` (Node 24), Playwright 1.60.

**Spec:** [`2026-06-14-design-system-foundation-design.md`](../specs/2026-06-14-design-system-foundation-design.md) DEL-B (Modal/Dialog, Dropdown/Menu · Tooltip · Toast · Tabs). Forudgående (merged): Plan 1 [`2026-06-14-ui-foundation-tokens-primitives.md`](2026-06-14-ui-foundation-tokens-primitives.md), Plan 2a [`2026-06-14-ui-foundation-fields-table-states.md`](2026-06-14-ui-foundation-fields-table-states.md).

---

## Plan-rækkefølge (dette er Plan 2b af Plan 2-bølgerne)

Plan 2 deles i tre review-bare bølger (ejer-beslutning 14/6):
- **Plan 2a (merged, PR #1391):** Field-sæt + Table + states (Empty/Error/Skeleton/Spinner) + Divider/Link + interim-ikoner.
- **Plan 2b (her):** overlays — Modal/Dialog, Dropdown/Menu, Tooltip, Toast, Tabs (deler portal/focus-trap/z-index/Esc).
- **Plan 2c:** fuldt 30-50-ikon-sæt (hus-spec A8) + Chip/Avatar/ProgressMeter.

Derefter Plan 3 (anti-drift lint-guard + error-boundary) og Plan 4+ (udrulning side-for-side).

## Setup (før Task 1)

Kør på en feature-branch i et worktree (brug `superpowers:using-git-worktrees` / `scripts/new-worktree.ps1`). Alt herunder er `feat(ui)` via branch + PR (ingen migration → normal PR-flow). I worktree: `npm ci` i `frontend/`, og kun `VITE_`-vars i `.env` (jf. memory).

Branch-navn: `feat/ui-foundation-2b-overlays`.

## Anti-slop-vagt (gælder hver task)

Mod spec A9 + [[feedback_anti_ai_slop_design_taste]]: **ingen** `rounded-xl/2xl`, **ingen** glow (`shadow-[0_0...]`), **ingen** gradient-blob, **ingen** `backdrop-blur` (scrim er en flad `bg-black/60` — navngiven Tailwind-farve, ikke rå hex, ingen blur), **ingen** emoji som ikon. Kun token-klasser (`rounded-cz`, `cz-*`-farver, `shadow-overlay`, `z-*`-tokens). Guld (`cz-accent`) kun til primær handling/selektion (aktiv tab-underline, primær-knap) — aldrig rutine-flader.

## Genbrug fra fundamentet (laves IKKE om)

- **`frontend/src/hooks/useModalA11y.js`** — focus-trap + Escape-luk + focus-restore + scroll-lock. Modal-primitivet hænger den returnerede ref på dialog-panelet; **ingen ny focus-trap skrives**.
- **`createPortal`** (react-dom) — pakkes i en tynd `Portal.jsx` (SSR-guard). Mønster lånt fra `LanguageSwitcher.jsx`.
- **Tokens i `index.css`:** `--dur/-fast/-slow`, `--ease`, `--shadow-overlay`, `--z-dropdown/overlay/modal/toast` — findes allerede (linje 95-100). Tailwind-mapping (`shadow-overlay`, `z-dropdown/overlay/modal/toast`) findes i `tailwind.config.js`.
- **Plan 2a-ikoner** (`XIcon`, `InfoIcon`, `CheckIcon`, `AlertTriangleIcon`, `ChevronDownIcon`) — genbruges; **ingen nye ikoner i 2b** (fuldt sæt = 2c).
- **Konsoliderings-mål** (visuelle/adfærds-referencer, migreres i Plan 4): `AdminTabs.jsx` (active = `border-cz-accent text-cz-1`, idle = `border-transparent text-cz-3 hover:text-cz-2`), `OverbidToast.jsx` (positionerings-recept: desktop bottom-right, mobil top under header; `pointer-events-none` container + `pointer-events-auto` items), `DashboardCustomizeMenu.jsx` (klik-udenfor + ankret panel).

## Fil-struktur (Plan 2b)

| Fil | Ansvar |
|---|---|
| `frontend/src/index.css` (modify) | Overlay-reveal-keyframes (`cz-overlay-fade/pop`, `cz-toast-in`) + klasser + `prefers-reduced-motion`-guard |
| `frontend/src/components/ui/overlayCss.test.js` (create) | Kilde-assert: reveal-keyframes/klasser + reduced-motion i `index.css` |
| `frontend/src/components/ui/Portal.jsx` (create) | `createPortal`→`document.body` (SSR-guard) |
| `frontend/src/components/ui/useDismiss.js` (create) | Delt klik-udenfor + Escape-hook (Dropdown) |
| `frontend/src/components/ui/portal.source.test.js` (create) | Kilde-assert: Portal + useDismiss |
| `frontend/src/components/ui/modalStyles.js` (create) | Rene `panelClass({size})` / `backdropClass()` |
| `frontend/src/components/ui/modalStyles.test.js` (create) | Unit-test af modal-helpers |
| `frontend/src/components/ui/Modal.jsx` (create) | `DialogSurface` (presentational) + `Modal` (portal+trap+scrim) |
| `frontend/src/components/ui/modal.source.test.js` (create) | Kilde-assert: Modal/DialogSurface |
| `frontend/src/components/ui/menuStyles.js` (create) | Rene `menuClass()` / `menuItemClass({active,danger})` |
| `frontend/src/components/ui/menuStyles.test.js` (create) | Unit-test af menu-helpers |
| `frontend/src/components/ui/Menu.jsx` (create) | `Menu` / `MenuItem` / `Dropdown` (ankret + useDismiss) |
| `frontend/src/components/ui/menu.source.test.js` (create) | Kilde-assert: Menu/MenuItem/Dropdown |
| `frontend/src/components/ui/tooltipStyles.js` (create) | Ren `tooltipClass({side})` |
| `frontend/src/components/ui/tooltipStyles.test.js` (create) | Unit-test af tooltip-helper |
| `frontend/src/components/ui/Tooltip.jsx` (create) | Group-ankret hover/fokus-tooltip |
| `frontend/src/components/ui/tooltip.source.test.js` (create) | Kilde-assert: Tooltip |
| `frontend/src/components/ui/toastStyles.js` (create) | Ren `toastClass({tone})` + `TOAST_TONE` |
| `frontend/src/components/ui/toastStyles.test.js` (create) | Unit-test af toast-helper |
| `frontend/src/components/ui/Toast.jsx` (create) | `Toast` (item) + `ToastViewport` (portaleret stak, auto-dismiss) |
| `frontend/src/components/ui/toast.source.test.js` (create) | Kilde-assert: Toast/ToastViewport |
| `frontend/src/components/ui/tabsStyles.js` (create) | Rene `tabClass({active})` / `tabListClass()` |
| `frontend/src/components/ui/tabsStyles.test.js` (create) | Unit-test af tab-helpers |
| `frontend/src/components/ui/Tabs.jsx` (create) | `Tabs`/`TabList`/`Tab`/`TabPanel` (context, role=tab, pil-nav) |
| `frontend/src/components/ui/tabs.source.test.js` (create) | Kilde-assert: Tabs-dele |
| `frontend/src/components/ui/index.js` (modify) | Barrel-export af alle nye overlay-primitiver |
| `frontend/src/pages/KitchenSinkPage.jsx` (modify) | Nye sektioner: Tabs, Tooltip, Toast, Dialog, Dropdown menu |
| `frontend/tests/e2e/kitchen-sink.spec.js` (modify) | + assertion for en ny overlay-primitiv |
| `frontend/tests/e2e/kitchen-sink.spec.js-snapshots/` (regenerate) | Opdaterede baselines (3 projekter) |

---

## Task 1: Overlay-reveal-CSS (reduced-motion-aware)

Alle overlay-reveals lever som CSS-klasser i `index.css` (keyframes + `prefers-reduced-motion`-guard, spec A6) — samme recept som `cz-skeleton` fra 2a. Komponenterne i de følgende tasks tilføjer bare klassen (`cz-overlay-panel` osv.).

**Files:**
- Modify: `frontend/src/index.css` (efter `.cz-skeleton`-blokken, før `.font-mono, .font-data`-reglen)
- Test: `frontend/src/components/ui/overlayCss.test.js`

- [ ] **Step 1: Write the failing test** (`frontend/src/components/ui/overlayCss.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("overlay-reveal-keyframes + klasser findes", () => {
  assert.match(css, /@keyframes cz-overlay-fade/);
  assert.match(css, /@keyframes cz-overlay-pop/);
  assert.match(css, /@keyframes cz-toast-in/);
  for (const cls of [".cz-overlay-backdrop", ".cz-overlay-panel", ".cz-menu-panel", ".cz-toast-item"]) {
    assert.ok(css.includes(cls), `mangler ${cls}`);
  }
});

test("reveals bruger motion-tokens (ingen haardkodet ms)", () => {
  assert.match(css, /\.cz-overlay-panel\s*\{\s*animation:\s*cz-overlay-pop var\(--dur-slow\) var\(--ease\)/);
  assert.match(css, /\.cz-toast-item\s*\{\s*animation:\s*cz-toast-in var\(--dur\) var\(--ease\)/);
});

test("reduced-motion slaar alle overlay-reveals + tooltip-transition fra (A6, hard krav)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cz-overlay-panel[\s\S]*animation:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cz-tooltip\s*\{\s*transition:\s*none/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/overlayCss.test.js`
Expected: FAIL (`@keyframes cz-overlay-fade` ikke fundet).

- [ ] **Step 3: Add CSS** til `frontend/src/index.css` (indsæt efter `@media (prefers-reduced-motion: reduce) { .cz-skeleton::after { animation: none; } }`-blokken, dvs. efter den nuværende linje 255, før `.font-mono,`-reglen):

```css
/* Overlay-reveals (#671 Plan 2b). Diskret fade/pop/slide; INGEN glow.
   prefers-reduced-motion slaar alle reveals fra (spec A6, hard krav). */
@keyframes cz-overlay-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes cz-overlay-pop {
  from { opacity: 0; transform: translateY(4px) scale(.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes cz-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.cz-overlay-backdrop { animation: cz-overlay-fade var(--dur) var(--ease); }
.cz-overlay-panel    { animation: cz-overlay-pop var(--dur-slow) var(--ease); }
.cz-menu-panel       { animation: cz-overlay-pop var(--dur-fast) var(--ease); }
.cz-toast-item       { animation: cz-toast-in var(--dur) var(--ease); }
.cz-tooltip          { transition: opacity var(--dur) var(--ease); }
@media (prefers-reduced-motion: reduce) {
  .cz-overlay-backdrop,
  .cz-overlay-panel,
  .cz-menu-panel,
  .cz-toast-item { animation: none; }
  .cz-tooltip { transition: none; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/overlayCss.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/components/ui/overlayCss.test.js
git commit -m "feat(ui): overlay-reveal-CSS (fade/pop/slide, reduced-motion-aware)"
```

---

## Task 2: Shared behavior — Portal + useDismiss

`Portal` pakker `createPortal` (SSR-guard); bruges af Modal + ToastViewport. `useDismiss` deler klik-udenfor + Escape for ankrede overlays (Dropdown). Modal bruger derimod den eksisterende `useModalA11y` (focus-trap).

**Files:**
- Create: `frontend/src/components/ui/Portal.jsx`, `frontend/src/components/ui/useDismiss.js`
- Test: `frontend/src/components/ui/portal.source.test.js`

- [ ] **Step 1: Write the failing test** (`frontend/src/components/ui/portal.source.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("Portal renderer via createPortal til document.body med SSR-guard", () => {
  const src = read("Portal.jsx");
  assert.match(src, /createPortal/);
  assert.match(src, /document\.body/);
  assert.match(src, /typeof document === "undefined"/);
});

test("useDismiss lytter paa mousedown + Escape og rydder op", () => {
  const src = read("useDismiss.js");
  assert.match(src, /addEventListener\("mousedown"/);
  assert.match(src, /"Escape"/);
  assert.match(src, /removeEventListener\("mousedown"/);
  assert.match(src, /removeEventListener\("keydown"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/portal.source.test.js`
Expected: FAIL (`ENOENT ... Portal.jsx`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/Portal.jsx`

```jsx
import { createPortal } from "react-dom";

// Renderer children i document.body — uden for overflow-/stacking-kontekster.
// SSR-guard: returnér null hvis document ikke findes.
export default function Portal({ children }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
```

`frontend/src/components/ui/useDismiss.js`

```js
import { useEffect } from "react";

// Delt afvisning for ankrede overlays (Dropdown): klik-udenfor + Escape.
// Modal bruger useModalA11y (focus-trap); Tooltip er hover/fokus-drevet.
export function useDismiss(ref, onDismiss, active = true) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onDismiss?.();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onDismiss, active]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/portal.source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Portal.jsx frontend/src/components/ui/useDismiss.js frontend/src/components/ui/portal.source.test.js
git commit -m "feat(ui): Portal (createPortal+SSR-guard) + useDismiss (klik-udenfor+Esc)"
```

---

## Task 3: Modal-style-helpers (rene funktioner)

**Files:**
- Create: `frontend/src/components/ui/modalStyles.js`
- Test: `frontend/src/components/ui/modalStyles.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelClass, backdropClass } from "./modalStyles.js";

test("panel er fuld-bredde hairline-kort med soft-lift overlay-skygge", () => {
  const c = panelClass();
  assert.ok(c.includes("w-full"));
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("shadow-overlay"));
  assert.ok(!/shadow-\[0_0/.test(c), "ingen glow");
});

test("size styrer max-bredde; ukendt falder tilbage til md", () => {
  assert.ok(panelClass({ size: "sm" }).includes("max-w-sm"));
  assert.ok(panelClass({ size: "lg" }).includes("max-w-2xl"));
  assert.equal(panelClass({ size: "zz" }), panelClass({ size: "md" }));
});

test("backdrop er scrim uden blur (anti-slop A9)", () => {
  const b = backdropClass();
  assert.ok(b.includes("inset-0"));
  assert.ok(b.includes("bg-black/60"));
  assert.ok(!b.includes("backdrop-blur"), "ingen backdrop-blur");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/modalStyles.test.js`
Expected: FAIL (`Cannot find module './modalStyles.js'`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/modalStyles.js`

```js
const PANEL_BASE = "w-full rounded-cz border border-cz-border bg-cz-card shadow-overlay";

const PANEL_SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function panelClass({ size = "md" } = {}) {
  return `${PANEL_BASE} ${PANEL_SIZES[size] ?? PANEL_SIZES.md}`;
}

export function backdropClass() {
  return "cz-overlay-backdrop absolute inset-0 bg-black/60";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/modalStyles.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/modalStyles.js frontend/src/components/ui/modalStyles.test.js
git commit -m "feat(ui): modalStyles (panelClass size + scrim backdropClass)"
```

---

## Task 4: Modal + DialogSurface

`DialogSurface` er den presentational overflade (panelClass + header/body/footer + valgfri luk-knap) — genbruges af `Modal` (i portal) og af kitchen-sink som statisk preview. `Modal` lægger portal + scrim + focus-trap (`useModalA11y`) ovenpå. Focus håndteres af `useModalA11y` + den globale `:focus-visible`-ring; ingen control fjerner outline.

**Files:**
- Create: `frontend/src/components/ui/Modal.jsx`
- Test: `frontend/src/components/ui/modal.source.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Modal.jsx"), "utf8");

test("Modal portaler, traper fokus via useModalA11y og ligger paa z-modal", () => {
  assert.match(src, /Portal/);
  assert.match(src, /useModalA11y/);
  assert.match(src, /z-modal/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
});

test("Modal lukker paa backdrop-klik og returnerer null naar lukket", () => {
  assert.match(src, /backdropClass\(/);
  assert.match(src, /onClick=\{onClose\}/);
  assert.match(src, /if \(!open\) return null/);
});

test("DialogSurface bruger panelClass + reveal-klasse + valgfri X-luk-knap", () => {
  assert.match(src, /export function DialogSurface|export const DialogSurface/);
  assert.match(src, /panelClass\(/);
  assert.match(src, /cz-overlay-panel/);
  assert.match(src, /XIcon/);
});

test("scrim er uden blur (A9)", () => {
  assert.ok(!/backdrop-blur/.test(src), "ingen backdrop-blur");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/modal.source.test.js`
Expected: FAIL (`ENOENT ... Modal.jsx`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/Modal.jsx`

```jsx
import { forwardRef } from "react";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import Portal from "./Portal.jsx";
import { panelClass, backdropClass } from "./modalStyles.js";
import { XIcon } from "./icons/index.jsx";

// Presentational dialog-overflade. Genbruges af Modal (i portal) + kitchen-sink
// (statisk preview). Sætter IKKE selv role/aria-modal — det gør Modal paa ref'en.
export const DialogSurface = forwardRef(function DialogSurface(
  { title, titleId, description, footer, size = "md", onClose, closeLabel = "Close", className = "", children, ...rest },
  ref
) {
  return (
    <div ref={ref} className={`relative cz-overlay-panel ${panelClass({ size })} ${className}`} {...rest}>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-cz text-cz-3 transition-colors duration-150 hover:bg-cz-subtle hover:text-cz-1"
        >
          <XIcon size={18} />
        </button>
      )}
      {(title || description) && (
        <div className="border-b border-cz-border px-6 py-4 pe-12">
          {title && (
            <h2 id={titleId} className="font-display text-2xl leading-none tracking-[.01em] text-cz-1">
              {title}
            </h2>
          )}
          {description && <p className="mt-1.5 text-sm text-cz-2">{description}</p>}
        </div>
      )}
      <div className="px-6 py-5 text-sm text-cz-1">{children}</div>
      {footer && (
        <div className="flex justify-end gap-2 border-t border-cz-border px-6 py-4">{footer}</div>
      )}
    </div>
  );
});

export default function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  closeLabel = "Close",
  titleId = "cz-modal-title",
  children,
}) {
  const ref = useModalA11y(open ? onClose : null, Boolean(open));
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
        <div className={backdropClass()} aria-hidden="true" onClick={onClose} />
        <DialogSurface
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          title={title}
          titleId={titleId}
          description={description}
          footer={footer}
          size={size}
          onClose={onClose}
          closeLabel={closeLabel}
          className="outline-none"
        >
          {children}
        </DialogSurface>
      </div>
    </Portal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/modal.source.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Modal.jsx frontend/src/components/ui/modal.source.test.js
git commit -m "feat(ui): Modal + DialogSurface (portal + useModalA11y focus-trap + scrim)"
```

---

## Task 5: Menu-style-helpers (rene funktioner)

**Files:**
- Create: `frontend/src/components/ui/menuStyles.js`
- Test: `frontend/src/components/ui/menuStyles.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuClass, menuItemClass } from "./menuStyles.js";

test("menu-panel er soft-lift hairline-kort", () => {
  const c = menuClass();
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("shadow-overlay"));
});

test("menu-item er fuld-bredde venstrestillet; danger faar danger-tone", () => {
  const item = menuItemClass();
  assert.ok(item.includes("w-full"));
  assert.ok(item.includes("text-left"));
  assert.ok(item.includes("text-cz-1"));
  const danger = menuItemClass({ danger: true });
  assert.ok(danger.includes("text-cz-danger"));
  assert.ok(!danger.includes("text-cz-1"));
});

test("active item faar subtle highlight", () => {
  assert.ok(menuItemClass({ active: true }).includes("bg-cz-subtle"));
  assert.ok(!menuItemClass().includes("bg-cz-subtle"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/menuStyles.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/menuStyles.js`

```js
const MENU_BASE = "min-w-[12rem] rounded-cz border border-cz-border bg-cz-card p-1.5 shadow-overlay";

const ITEM_BASE =
  "flex w-full items-center gap-2 rounded-cz px-2.5 py-1.5 text-left text-sm transition-colors duration-150";

export function menuClass({ className = "" } = {}) {
  return `${MENU_BASE} ${className}`.trim();
}

export function menuItemClass({ active = false, danger = false } = {}) {
  const tone = danger ? "text-cz-danger hover:bg-cz-danger/10" : "text-cz-1 hover:bg-cz-subtle";
  return `${ITEM_BASE} ${tone} ${active ? "bg-cz-subtle" : ""}`.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/menuStyles.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/menuStyles.js frontend/src/components/ui/menuStyles.test.js
git commit -m "feat(ui): menuStyles (menuClass + menuItemClass active/danger)"
```

---

## Task 6: Menu + MenuItem + Dropdown

`Dropdown` er en ankret (ikke-portaleret) controlled overlay: trigger via render-prop + open-state + `useDismiss`. `Menu`/`MenuItem` er den presentational liste (kan også bruges standalone). `defaultOpen` gør, at kitchen-sink kan vise menuen åben i snapshot. Konsoliderer `DashboardCustomizeMenu`-mønsteret.

**Files:**
- Create: `frontend/src/components/ui/Menu.jsx`
- Test: `frontend/src/components/ui/menu.source.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Menu.jsx"), "utf8");

test("Menu er role=menu med reveal + soft-lift via menuClass", () => {
  assert.match(src, /export function Menu\b/);
  assert.match(src, /role="menu"/);
  assert.match(src, /menuClass\(/);
  assert.match(src, /cz-menu-panel/);
});

test("MenuItem er en role=menuitem-knap med menuItemClass", () => {
  assert.match(src, /export function MenuItem\b/);
  assert.match(src, /role="menuitem"/);
  assert.match(src, /menuItemClass\(/);
});

test("Dropdown bruger useDismiss, z-dropdown, render-prop trigger + defaultOpen", () => {
  assert.match(src, /export function Dropdown\b/);
  assert.match(src, /useDismiss\(/);
  assert.match(src, /z-dropdown/);
  assert.match(src, /trigger\(\{/);
  assert.match(src, /defaultOpen/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/menu.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/Menu.jsx`

```jsx
import { useRef, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import { menuClass, menuItemClass } from "./menuStyles.js";

export function Menu({ className = "", children, ...rest }) {
  return (
    <div role="menu" className={`cz-menu-panel ${menuClass()} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function MenuItem({ active = false, danger = false, className = "", children, ...rest }) {
  return (
    <button type="button" role="menuitem" className={`${menuItemClass({ active, danger })} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// Ankret dropdown. `trigger` er en render-prop: ({ open, toggle }) => <button .../>
// (kalderen ejer trigger-stylingen + aria-expanded). `align` flugter panelet
// venstre/højre under trigger; `defaultOpen` til kitchen-sink/snapshot.
export function Dropdown({ trigger, children, align = "left", defaultOpen = false, className = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const toggle = () => setOpen((v) => !v);
  const alignCls = align === "right" ? "right-0" : "left-0";
  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      {trigger({ open, toggle })}
      {open && (
        <div className={`absolute z-dropdown mt-2 ${alignCls}`}>
          <Menu>{children}</Menu>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/menu.source.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Menu.jsx frontend/src/components/ui/menu.source.test.js
git commit -m "feat(ui): Menu/MenuItem + Dropdown (ankret, useDismiss, render-prop trigger)"
```

---

## Task 7: Tooltip-style-helper + Tooltip

Tooltip er CSS-drevet (group-hover + group-focus-within → opacity), ingen JS-state — robust i snapshots. `open`-prop tvinger boblen synlig til kitchen-sink. Reveal-transitionen (`cz-tooltip`) slås fra under reduced-motion (Task 1).

**Files:**
- Create: `frontend/src/components/ui/tooltipStyles.js`, `frontend/src/components/ui/Tooltip.jsx`
- Test: `frontend/src/components/ui/tooltipStyles.test.js`, `frontend/src/components/ui/tooltip.source.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/tooltipStyles.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tooltipClass } from "./tooltipStyles.js";

test("tooltip-boble er over indhold, pointer-transparent, reveal paa hover+fokus", () => {
  const c = tooltipClass();
  assert.ok(c.includes("cz-tooltip"));
  assert.ok(c.includes("z-overlay"));
  assert.ok(c.includes("pointer-events-none"));
  assert.ok(c.includes("group-hover:opacity-100"));
  assert.ok(c.includes("group-focus-within:opacity-100"));
  assert.ok(c.includes("shadow-overlay"));
});

test("side styrer placering; ukendt falder tilbage til top", () => {
  assert.ok(tooltipClass({ side: "bottom" }).includes("top-full"));
  assert.ok(tooltipClass({ side: "top" }).includes("bottom-full"));
  assert.equal(tooltipClass({ side: "zz" }), tooltipClass({ side: "top" }));
});
```

`frontend/src/components/ui/tooltip.source.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Tooltip.jsx"), "utf8");

test("Tooltip er group-ankret med role=tooltip + tooltipClass", () => {
  assert.match(src, /className="group relative/);
  assert.match(src, /role="tooltip"/);
  assert.match(src, /tooltipClass\(/);
});

test("open tvinger boblen synlig (kitchen-sink/snapshot)", () => {
  assert.match(src, /!opacity-100/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/tooltipStyles.test.js src/components/ui/tooltip.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/tooltipStyles.js`

```js
const BUBBLE =
  "cz-tooltip pointer-events-none absolute z-overlay w-max max-w-xs rounded-cz border border-cz-border " +
  "bg-cz-elevated px-2.5 py-1.5 text-xs text-cz-1 shadow-overlay opacity-0 " +
  "group-hover:opacity-100 group-focus-within:opacity-100";

const SIDE = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export function tooltipClass({ side = "top" } = {}) {
  return `${BUBBLE} ${SIDE[side] ?? SIDE.top}`;
}
```

`frontend/src/components/ui/Tooltip.jsx`

```jsx
import { tooltipClass } from "./tooltipStyles.js";

export default function Tooltip({ label, side = "top", open = false, id, className = "", children }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" id={id} className={`${tooltipClass({ side })} ${open ? "!opacity-100" : ""} ${className}`}>
        {label}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/tooltipStyles.test.js src/components/ui/tooltip.source.test.js`
Expected: PASS (tooltipStyles: 2, tooltip.source: 2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/tooltipStyles.js frontend/src/components/ui/Tooltip.jsx frontend/src/components/ui/tooltipStyles.test.js frontend/src/components/ui/tooltip.source.test.js
git commit -m "feat(ui): Tooltip (group hover/fokus-reveal, reduced-motion-aware)"
```

---

## Task 8: Toast-style-helper + Toast + ToastViewport

`Toast` er den presentational notifikation (tone-border + tone-ikon + besked + luk). `ToastViewport` er den portalerede, positionerede stak med auto-dismiss — konsoliderer `OverbidToast`-recepten (desktop bottom-right, mobil top under header; `pointer-events-none` container + `pointer-events-auto` items).

**Files:**
- Create: `frontend/src/components/ui/toastStyles.js`, `frontend/src/components/ui/Toast.jsx`
- Test: `frontend/src/components/ui/toastStyles.test.js`, `frontend/src/components/ui/toast.source.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/toastStyles.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toastClass, TOAST_TONE } from "./toastStyles.js";

test("toast er soft-lift kort der modtager pointer-events", () => {
  const c = toastClass();
  assert.ok(c.includes("pointer-events-auto"));
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("shadow-overlay"));
});

test("tone styrer kun border (broadcast, ikke fyldt pille); ukendt → info", () => {
  assert.ok(toastClass({ tone: "danger" }).includes("border-cz-danger/40"));
  assert.ok(toastClass({ tone: "success" }).includes("border-cz-success/40"));
  assert.equal(toastClass({ tone: "zz" }), toastClass({ tone: "info" }));
});

test("TOAST_TONE eksponerer de kendte toner", () => {
  assert.deepEqual(Object.keys(TOAST_TONE).sort(), ["danger", "info", "success", "warning"]);
});
```

`frontend/src/components/ui/toast.source.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Toast.jsx"), "utf8");

test("Toast er role=status med toastClass, tone-ikon + valgfri X-luk", () => {
  assert.match(src, /export function Toast\b/);
  assert.match(src, /role="status"/);
  assert.match(src, /toastClass\(/);
  assert.match(src, /cz-toast-item/);
  assert.match(src, /XIcon/);
});

test("ToastViewport portaler, ligger paa z-toast og auto-afviser", () => {
  assert.match(src, /export function ToastViewport\b/);
  assert.match(src, /Portal/);
  assert.match(src, /z-toast/);
  assert.match(src, /setTimeout/);
  assert.match(src, /clearTimeout/);
});

test("ToastViewport-container er pointer-transparent (klik gaar igennem til siden)", () => {
  assert.match(src, /pointer-events-none fixed/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/toastStyles.test.js src/components/ui/toast.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/toastStyles.js`

```js
export const TOAST_TONE = {
  info: "info",
  success: "success",
  danger: "danger",
  warning: "warning",
};

const BASE = "pointer-events-auto flex items-start gap-3 rounded-cz border bg-cz-card px-4 py-3 shadow-overlay";

const TONE_BORDER = {
  info: "border-cz-info/40",
  success: "border-cz-success/40",
  danger: "border-cz-danger/40",
  warning: "border-cz-warning/40",
};

export function toastClass({ tone = "info" } = {}) {
  return `${BASE} ${TONE_BORDER[tone] ?? TONE_BORDER.info}`;
}
```

`frontend/src/components/ui/Toast.jsx`

```jsx
import { useEffect } from "react";
import Portal from "./Portal.jsx";
import { toastClass } from "./toastStyles.js";
import { XIcon, InfoIcon, CheckIcon, AlertTriangleIcon } from "./icons/index.jsx";

const TONE_ICON = {
  info: InfoIcon,
  success: CheckIcon,
  danger: AlertTriangleIcon,
  warning: AlertTriangleIcon,
};

const TONE_ICON_COLOR = {
  info: "text-cz-info",
  success: "text-cz-success",
  danger: "text-cz-danger",
  warning: "text-cz-warning",
};

export function Toast({ tone = "info", title, description, onClose, closeLabel = "Close", className = "" }) {
  const Icon = TONE_ICON[tone] ?? InfoIcon;
  return (
    <div role="status" className={`cz-toast-item ${toastClass({ tone })} ${className}`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${TONE_ICON_COLOR[tone] ?? TONE_ICON_COLOR.info}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-cz-1">{title}</p>
        {description && <p className="mt-0.5 text-xs text-cz-2">{description}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="-me-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-cz text-cz-3 transition-colors duration-150 hover:bg-cz-subtle hover:text-cz-1"
        >
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}

// Portaleret, positioneret stak med auto-dismiss. Controlled: kalderen ejer
// `toasts`-arrayet (hvert element: { id, tone?, title, description? }) og afviser
// via onDismiss(id). Konsoliderer OverbidToast-positioneringen.
export function ToastViewport({ toasts = [], onDismiss, duration = 4000 }) {
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((t) => setTimeout(() => onDismiss?.(t.id), duration));
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismiss, duration]);

  if (!toasts.length) return null;
  return (
    <Portal>
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed left-4 right-4 top-16 z-toast flex flex-col gap-2 md:bottom-4 md:left-auto md:right-4 md:top-auto md:max-w-sm"
      >
        {toasts.map((t) => (
          <Toast
            key={t.id}
            tone={t.tone}
            title={t.title}
            description={t.description}
            onClose={() => onDismiss?.(t.id)}
          />
        ))}
      </div>
    </Portal>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/toastStyles.test.js src/components/ui/toast.source.test.js`
Expected: PASS (toastStyles: 3, toast.source: 3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/toastStyles.js frontend/src/components/ui/Toast.jsx frontend/src/components/ui/toastStyles.test.js frontend/src/components/ui/toast.source.test.js
git commit -m "feat(ui): Toast + ToastViewport (portaleret stak, auto-dismiss)"
```

---

## Task 9: Tab-style-helpers + Tabs

Kompositionel tab-primitiv: `Tabs` (context med value/onChange), `TabList` (role=tablist + pil-navigation), `Tab` (role=tab, aria-selected, roving tabindex), `TabPanel` (role=tabpanel, skjuler inaktive). Konsoliderer `AdminTabs` (active = guld-underline + `text-cz-1`, idle = `border-transparent text-cz-3 hover:text-cz-2`).

**Files:**
- Create: `frontend/src/components/ui/tabsStyles.js`, `frontend/src/components/ui/Tabs.jsx`
- Test: `frontend/src/components/ui/tabsStyles.test.js`, `frontend/src/components/ui/tabs.source.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/ui/tabsStyles.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tabClass, tabListClass } from "./tabsStyles.js";

test("aktiv tab faar guld-underline + primaer tekst", () => {
  const active = tabClass({ active: true });
  assert.ok(active.includes("border-cz-accent"));
  assert.ok(active.includes("text-cz-1"));
});

test("inaktiv tab er neutral med transparent underline", () => {
  const idle = tabClass();
  assert.ok(idle.includes("border-transparent"));
  assert.ok(idle.includes("text-cz-3"));
  assert.ok(!idle.includes("border-cz-accent"));
});

test("tablist er hairline-baseline", () => {
  const c = tabListClass();
  assert.ok(c.includes("border-b"));
  assert.ok(c.includes("border-cz-border"));
});
```

`frontend/src/components/ui/tabs.source.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Tabs.jsx"), "utf8");

test("Tabs deler value/onChange via context", () => {
  assert.match(src, /createContext/);
  assert.match(src, /TabsContext\.Provider/);
});

test("TabList er role=tablist med pil-navigation", () => {
  assert.match(src, /role="tablist"/);
  assert.match(src, /ArrowRight/);
  assert.match(src, /ArrowLeft/);
  assert.match(src, /tabListClass\(/);
});

test("Tab er role=tab med aria-selected + roving tabindex + tabClass", () => {
  assert.match(src, /role="tab"/);
  assert.match(src, /aria-selected=\{active\}/);
  assert.match(src, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(src, /tabClass\(/);
});

test("TabPanel er role=tabpanel og skjuler inaktive", () => {
  assert.match(src, /role="tabpanel"/);
  assert.match(src, /return null/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/tabsStyles.test.js src/components/ui/tabs.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/tabsStyles.js`

```js
const TAB_BASE =
  "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150";

export function tabClass({ active = false } = {}) {
  return active
    ? `${TAB_BASE} border-cz-accent text-cz-1`
    : `${TAB_BASE} border-transparent text-cz-3 hover:text-cz-2`;
}

export function tabListClass({ className = "" } = {}) {
  return `flex gap-1 overflow-x-auto border-b border-cz-border ${className}`.trim();
}
```

`frontend/src/components/ui/Tabs.jsx`

```jsx
import { createContext, useContext, useRef } from "react";
import { tabClass, tabListClass } from "./tabsStyles.js";

const TabsContext = createContext(null);

export function Tabs({ value, onChange, className = "", children }) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ label, className = "", children }) {
  const listRef = useRef(null);
  const onKeyDown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = Array.from(listRef.current?.querySelectorAll('[role="tab"]') ?? []);
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={tabListClass({ className })}>
      {children}
    </div>
  );
}

export function Tab({ value: tabValue, className = "", children }) {
  const ctx = useContext(TabsContext);
  const active = ctx?.value === tabValue;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => ctx?.onChange?.(tabValue)}
      className={`${tabClass({ active })} ${className}`}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value: panelValue, className = "", children }) {
  const ctx = useContext(TabsContext);
  if (ctx?.value !== panelValue) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/tabsStyles.test.js src/components/ui/tabs.source.test.js`
Expected: PASS (tabsStyles: 3, tabs.source: 4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/tabsStyles.js frontend/src/components/ui/Tabs.jsx frontend/src/components/ui/tabsStyles.test.js frontend/src/components/ui/tabs.source.test.js
git commit -m "feat(ui): Tabs/TabList/Tab/TabPanel (context, role=tab, pil-nav)"
```

---

## Task 10: Barrel-export + kitchen-sink-sektioner

**Files:**
- Modify: `frontend/src/components/ui/index.js`
- Modify: `frontend/src/pages/KitchenSinkPage.jsx`

- [ ] **Step 1: Udvid barrel** `frontend/src/components/ui/index.js` — tilføj efter `export { default as Link } from "./Link.jsx";` og FØR `export * from "./icons/index.jsx";`:

```js
export { default as Portal } from "./Portal.jsx";
export { useDismiss } from "./useDismiss.js";
export { default as Modal, DialogSurface } from "./Modal.jsx";
export { Menu, MenuItem, Dropdown } from "./Menu.jsx";
export { default as Tooltip } from "./Tooltip.jsx";
export { Toast, ToastViewport } from "./Toast.jsx";
export { Tabs, TabList, Tab, TabPanel } from "./Tabs.jsx";
```

- [ ] **Step 2: Erstat import-blokken** øverst i `frontend/src/pages/KitchenSinkPage.jsx` (linje 1-7) med:

```jsx
import { useState } from "react";
import {
  Button, StatusBadge, CategoryTag, Card,
  Field, Input, Textarea, Select, Checkbox, Radio, Toggle,
  Table, Tr, Th, Td, JerseyDot,
  EmptyState, ErrorState, Skeleton, Spinner, Divider, Link,
  Modal, DialogSurface, Dropdown, MenuItem, Tooltip, Toast,
  Tabs, TabList, Tab, TabPanel,
  SearchIcon, ChevronRightIcon, TrophyIcon, InboxIcon,
} from "../components/ui/index.js";
```

- [ ] **Step 3: Tilføj state** — erstat `export default function KitchenSinkPage() {` (linje 20) + den følgende `return (`-linje med:

```jsx
export default function KitchenSinkPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("roster");
  return (
```

- [ ] **Step 4: Indsæt overlay-sektioner** lige før `</main>` (efter "Dividers & links"-sektionen). Dropdown-sektionen lægges SIDST, så dens åbne (absolut-positionerede) menu kan overlappe ned i sidens bundmargen uden at kollidere med andre sektioner i snapshottet:

```jsx
      <Section title="Tabs">
        <div className="w-full">
          <Tabs value={tab} onChange={setTab}>
            <TabList label="Team views">
              <Tab value="roster">Roster</Tab>
              <Tab value="tactics">Tactics</Tab>
              <Tab value="finance">Finance</Tab>
            </TabList>
            <TabPanel value="roster"><p className="pt-4 text-sm text-cz-2">Roster panel</p></TabPanel>
            <TabPanel value="tactics"><p className="pt-4 text-sm text-cz-2">Tactics panel</p></TabPanel>
            <TabPanel value="finance"><p className="pt-4 text-sm text-cz-2">Finance panel</p></TabPanel>
          </Tabs>
        </div>
      </Section>

      <Section title="Tooltip">
        <Tooltip label="Watch this rider" open>
          <Button variant="secondary" size="sm">Hover me</Button>
        </Tooltip>
      </Section>

      <Section title="Toast">
        <Toast
          className="w-72"
          tone="danger"
          title="You've been outbid"
          description="Ada Pedersen — new price €1.72M"
          onClose={() => {}}
        />
        <Toast
          className="w-72"
          tone="success"
          title="Bid placed"
          description="You lead the auction."
          onClose={() => {}}
        />
      </Section>

      <Section title="Dialog">
        <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>Open dialog</Button>
        <DialogSurface
          size="sm"
          title="Release rider?"
          titleId="ks-dialog-preview"
          description="This frees up cap space but cannot be undone this stage."
          onClose={() => {}}
          footer={
            <>
              <Button variant="ghost" size="sm">Cancel</Button>
              <Button variant="danger" size="sm">Release</Button>
            </>
          }
        >
          <p className="text-sm text-cz-2">Ada Pedersen will return to the free-agent pool.</p>
        </DialogSurface>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Release rider?"
          description="This frees up cap space but cannot be undone this stage."
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={() => setModalOpen(false)}>Release</Button>
            </>
          }
        >
          <p className="text-sm text-cz-2">Ada Pedersen will return to the free-agent pool.</p>
        </Modal>
      </Section>

      <Section title="Dropdown menu">
        <Dropdown
          defaultOpen
          trigger={({ open, toggle }) => (
            <Button variant="secondary" size="sm" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
              Customize
            </Button>
          )}
        >
          <MenuItem>Show team value</MenuItem>
          <MenuItem active>Show form</MenuItem>
          <MenuItem danger>Reset layout</MenuItem>
        </Dropdown>
      </Section>
```

- [ ] **Step 5: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build OK, ingen import-fejl (verificerer extensionless/ESM-importerne, jf. #803).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/index.js frontend/src/pages/KitchenSinkPage.jsx
git commit -m "feat(ui): barrel-export + kitchen-sink-sektioner for Plan 2b-overlays"
```

---

## Task 11: Snapshot-regen + fuld gate + ejer-lås

**Files:**
- Modify: `frontend/tests/e2e/kitchen-sink.spec.js`
- Regenerate: `frontend/tests/e2e/kitchen-sink.spec.js-snapshots/` (3 PNG'er)

- [ ] **Step 1: Tilføj en assertion for de nye overlays** — opdatér `frontend/tests/e2e/kitchen-sink.spec.js` så test'en fanger en ny sektion (efter `Open auction`-assertionen, før `toHaveScreenshot`):

```js
  await expect(page.getByRole("tab", { name: "Roster" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open dialog" })).toBeVisible();
```

- [ ] **Step 2: Regenerér baselines (alle 3 projekter)**

Run: `cd frontend && npx playwright test kitchen-sink --update-snapshots`
Expected: 3 baseline-PNG'er opdateret (desktop-chromium + mobile-chromium + mobile-webkit). Eyeball dem i `tests/e2e/kitchen-sink.spec.js-snapshots/` — alle nye overlays synlige: Tabs (Roster aktiv = guld-underline), Tooltip-boble, 2 toasts (danger/success border-tone), Dialog-panel (soft-lift, X-knap, footer-knapper), åben Dropdown-menu (3 items, "Show form" highlighted, "Reset layout" danger). Intet slop: skarp 5px, ingen glow, ingen blur, ingen emoji.

- [ ] **Step 3: Re-run to verify they pass**

Run: `cd frontend && npx playwright test kitchen-sink`
Expected: PASS (3 projekter).

- [ ] **Step 4: Full local gate** (jf. CLAUDE.md pre-flight + [[feedback_full_ci_gate_before_pr]])

Run: `pwsh -File scripts/verify-local.ps1` (backend + frontend `node --test` + frontend build)
Run: `cd frontend && npm run lint`
Run: `cd frontend && npx playwright test core-smoke` (verificér INGEN regression i eksisterende snapshots fra de nye `index.css`-regler; en utilsigtet diff = regression der fixes, ikke snapshottes væk)
Expected: alt grønt.

- [ ] **Step 5: Commit + push + PR**

```bash
git add frontend/tests/e2e/kitchen-sink.spec.js frontend/tests/e2e/kitchen-sink.spec.js-snapshots/
git commit -m "test(ui): kitchen-sink snapshot m. Plan 2b-overlays (3 projekter)"
git push -u origin feat/ui-foundation-2b-overlays
```

Opret PR. PR-body skal have **Brugerverifikation-sektion** (frontend → ikke `backend-only`/`docs-only`) jf. [[feedback_pr_body_brugerverifikation]]. **Patch notes:** ikke nødvendige — intet bruger-vendt endnu; `/ui` er intern reference, og udrulning til callsites er Plan 4. Noter dét eksplicit i PR-body. Ingen migration → normal PR-flow (men ejer-lås før merge, jf. Step 6).

- [ ] **Step 6: EJER-LÅS (visuelt gate)**

Start preview, åbn `/ui`, og bed ejeren se de nye overlays i begge temaer (theme-toggle). **Lås looket eller noter justeringer FØR Plan 2c.** Verificér særligt live-adfærd (som snapshottet ikke fanger):
- **Modal:** klik "Open dialog" → panel åbner med scrim (ingen blur), focus springer ind i dialogen, **Tab** cykler kun inden i den (focus-trap), **Esc** + backdrop-klik + X lukker, fokus vender tilbage til "Open dialog"-knappen, body-scroll er låst mens åben.
- **Dropdown:** klik-udenfor + Esc lukker menuen; "Reset layout" er danger-tonet.
- **Tabs:** klik + **pil venstre/højre** skifter aktiv tab (roving tabindex); guld-underline følger.
- **Tooltip:** vises på hover OG tastatur-fokus af "Hover me".
- **Reduced-motion:** slå OS-reduced-motion til → ingen reveal-animation på modal/dropdown/toast, ingen tooltip-fade (spec A6).

---

## Self-review (udført)

- **Spec-dækning (DEL-B Plan 2b-del):**
  - **Modal/Dialog** (soft-lift, 5px, backdrop, focus-trap, Esc-luk) = Task 3 (modalStyles) + Task 4 (Modal genbruger `useModalA11y` for focus-trap/Esc/scroll-lock/focus-restore; `panelClass` = 5px `rounded-cz` + `shadow-overlay` soft-lift; `backdropClass` = scrim).
  - **Dropdown/Menu** (konsoliderer DashboardCustomizeMenu) = Task 5 (menuStyles) + Task 6 (Dropdown + useDismiss klik-udenfor/Esc).
  - **Tooltip** = Task 7 (hover + fokus-reveal, reduced-motion-aware).
  - **Toast** (konsoliderer OverbidToast) = Task 8 (Toast item + ToastViewport portaleret stak + auto-dismiss, samme positionerings-recept).
  - **Tabs** (konsoliderer AdminTabs) = Task 9 (role=tablist/tab/tabpanel + pil-nav + samme guld-underline-active-stil).
  - **Delt portal/focus-trap/z-index/Esc** = Task 1 (reveals + reduced-motion) + Task 2 (Portal + useDismiss) + genbrug af `useModalA11y` + z-tokens (`z-modal/dropdown/toast/overlay`).
  - Eksplicit ude af scope: Chip/Avatar/ProgressMeter + fuldt 30-50-ikon-sæt (Plan 2c); udrulning til callsites (Plan 4).
- **Placeholders:** ingen TBD/TODO; hvert kode-trin har faktisk kode + kommando + forventet output.
- **Type-konsistens:** `panelClass`/`backdropClass` (Task 3) → Modal (Task 4). `menuClass`/`menuItemClass` (Task 5) → Menu/MenuItem (Task 6). `tooltipClass` (Task 7) → Tooltip (Task 7). `toastClass`/`TOAST_TONE` (Task 8) → Toast (Task 8). `tabClass`/`tabListClass` (Task 9) → Tabs (Task 9). `Portal` (Task 2) → Modal (Task 4) + ToastViewport (Task 8). `useDismiss` (Task 2) → Dropdown (Task 6). `useModalA11y` (eksisterende) → Modal (Task 4). CSS-klasserne `cz-overlay-backdrop/-panel`, `cz-menu-panel`, `cz-toast-item`, `cz-tooltip` (Task 1) forbruges af modalStyles/Modal (3/4), Menu (6), Toast (8), tooltipStyles (7). Ikoner `XIcon/InfoIcon/CheckIcon/AlertTriangleIcon` (Plan 2a, verificeret tilstede) → Modal (4) + Toast (8). Alle nye primitiver eksporteres i Task 10 og rendres i kitchen-sink samme task.
- **Anti-slop:** ingen `rounded-xl/2xl`, ingen `shadow-[0_0`, ingen `backdrop-blur`, ingen emoji; scrim = `bg-black/60` (navngiven Tailwind-farve, ikke rå hex). Guld kun på aktiv tab-underline + primær-knap (selektion/handling, ikke rutine-flade).

## Åbne afhængigheder / noter

- **Modal genbruger `useModalA11y`** (`frontend/src/hooks/useModalA11y.js`, #1073) frem for at duplikere focus-trap — det er den eksisterende delte primitiv. Importen er `../../hooks/useModalA11y.js` fra `components/ui/`.
- **Dropdown er ankret (ikke portaleret)** i v1 — matcher DashboardCustomizeMenu og holder primitivet simpelt (ingen positionerings-engine). En `overflow-hidden`-forfader kan klippe panelet; hvis et fremtidigt callsite kræver det, kan en portaleret variant tilføjes i Plan 4-udrulningen. Bevidst snit.
- **Tooltip er CSS-drevet** (group-hover/focus-within) frem for JS-positioneret — robust i snapshots, men placeres relativt til triggeren (ingen viewport-flip). Tilstrækkeligt for primitivet; avanceret placering er ikke launch-blocker.
- **`!opacity-100`** (Tooltip `open`) bruger Tailwind important-modifier for at overskrive `opacity-0`. Verificér i kitchen-sink-snapshot at boblen faktisk er synlig.
- **Playwright-snapshots er win32-baseline** (frontend-smoke advisory, jf. memory); CI's frontend-smoke kan teardown-flake uden at være hard-gate.
- **De nye `index.css`-regler** (overlay-reveals) er nye klasser → påvirker IKKE eksisterende flader. Kør alligevel core-smoke (Task 11 Step 4) for at bekræfte nul regression.
