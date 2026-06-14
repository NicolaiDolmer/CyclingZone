# UI-fundament: tokens + eksemplar-primitiver + kitchen-sink (Plan 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codificér design-tokens, global focus-ring og de primitiver der etablerer looket (Button, StatusBadge, CategoryTag, Card, Icon), samlet i en `/ui` kitchen-sink, så ejeren kan låse looket visuelt før nogen bruger-vendt flade røres.

**Architecture:** Tokens lever som CSS-vars i `index.css` + tailwind-theme-nøgler (eksisterende `cz-*` røres ikke). Primitiver er tynde React-wrappers i ny `frontend/src/components/ui/`-mappe der forbruger tokens; al variant→className-logik udtrækkes til rene funktioner der unit-testes med `node --test`. Visuelt verificeres via en `/ui`-side + Playwright-snapshot (3 projekter). Repoet har ingen jsdom/RTL, så komponent-tests er enten rene funktioner (input→output) eller kilde-streng-asserts (repo-konvention, se `DeadlineDayTicker.a11y.test.js`).

**Tech Stack:** React 18 + Vite 8 + Tailwind 3.4, react-router-dom 6, `node --test`, Playwright 1.60.

**Spec:** [`2026-06-14-design-system-foundation-design.md`](../specs/2026-06-14-design-system-foundation-design.md). Pixel-reference: companion-mocks i `.superpowers/brainstorm/936-1781446786/content/` (typography-v2, surface, components, focus-ring, display-layer, badges-v2, badges-general).

---

## Plan-rækkefølge (dette er Plan 1 af flere)

Fundamentet er for stort til ét spec/plan. Sekvens:
- **Plan 1 (her):** tokens + global focus-ring + Button/StatusBadge/CategoryTag/Card/Icon + kitchen-sink. **Ender ved ejerens visuelle lås.**
- **Plan 2:** resterende primitiver (Field-sæt, Table, Modal, Dropdown, Toast, Tabs, EmptyState/Skeleton/ErrorState, fuldt ikon-sæt) mod det låste look.
- **Plan 3:** anti-re-drift lint-guard + global error-boundary.
- **Plan 4+:** udrulning side-for-side (landing #672, login, kerne-app), hver med sin egen visuelle lås.

## Setup (før Task 1)

Kør på en feature-branch (brug `superpowers:using-git-worktrees`). Alt herunder er `feat(ui)` via branch + PR (ingen migration, så normal PR-flow).

## Fil-struktur (Plan 1)

| Fil | Ansvar |
|---|---|
| `frontend/src/index.css` (modify) | Nye CSS-vars: radius, motion, shadow-overlay, z-index + global `:focus-visible`-regel |
| `frontend/tailwind.config.js` (modify) | borderRadius `cz`/`cz-pill`, boxShadow `overlay`, zIndex-skala |
| `frontend/src/components/ui/buttonStyles.js` (create) | Ren `buttonClass()` |
| `frontend/src/components/ui/buttonStyles.test.js` (create) | Unit-test af `buttonClass()` |
| `frontend/src/components/ui/Button.jsx` (create) | Button-wrapper + loading-spinner |
| `frontend/src/components/ui/badgeStyles.js` (create) | Rene `statusBadgeClass()` + `categoryTagClass()` |
| `frontend/src/components/ui/badgeStyles.test.js` (create) | Unit-test af badge-helpers |
| `frontend/src/components/ui/StatusBadge.jsx` (create) | Broadcast dot+label |
| `frontend/src/components/ui/CategoryTag.jsx` (create) | Skarp data-tag (+ dense-variant) |
| `frontend/src/components/ui/Card.jsx` (create) | Hairline-kort |
| `frontend/src/components/ui/icons/IconBase.jsx` (create) | SVG-wrapper (hus-spec) |
| `frontend/src/components/ui/icons/index.jsx` (create) | Starter-ikoner (Search, ChevronRight, Trophy) |
| `frontend/src/components/ui/icons/iconBase.test.js` (create) | Kilde-assert: hus-spec |
| `frontend/src/components/ui/index.js` (create) | Barrel-export |
| `frontend/src/pages/KitchenSinkPage.jsx` (create) | `/ui` kitchen-sink |
| `frontend/src/App.jsx` (modify) | Lazy-route `/ui` |
| `frontend/tests/e2e/kitchen-sink.spec.js` (create) | Snapshot af `/ui` (3 projekter) |

---

## Task 1: Design-tokens (CSS-vars + tailwind-theme)

**Files:**
- Modify: `frontend/src/index.css` (`:root` + `[data-theme="dark"]`)
- Modify: `frontend/tailwind.config.js:6-72` (theme.extend)
- Test: `frontend/src/components/ui/tokens.test.js`

- [ ] **Step 1: Write the failing test** (`frontend/src/components/ui/tokens.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "index.css"), "utf8");
const tw = readFileSync(join(root, "..", "tailwind.config.js"), "utf8");

test("index.css definerer fundament-tokens", () => {
  for (const v of ["--radius-sm", "--radius-pill", "--shadow-overlay", "--dur", "--ease", "--z-modal"]) {
    assert.ok(css.includes(v), `index.css mangler ${v}`);
  }
  assert.match(css, /--radius-sm:\s*5px/, "radius-sm skal vaere 5px (laast)");
});

test("tailwind eksponerer fundament-tokens", () => {
  for (const k of ["cz:", "cz-pill:", "overlay:"]) {
    assert.ok(tw.includes(k), `tailwind.config mangler ${k}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/tokens.test.js`
Expected: FAIL (`index.css mangler --radius-sm`).

- [ ] **Step 3: Add CSS vars** to `frontend/src/index.css` `:root` (efter `--on-accent`-linjen):

```css
  /* Fundament-tokens (#671 design system) */
  --radius-none: 0px;
  --radius-sm: 5px;
  --radius-pill: 9999px;
  --dur-fast: 120ms;
  --dur: 150ms;
  --dur-slow: 240ms;
  --ease: cubic-bezier(.2,.7,.2,1);
  --shadow-overlay: 0 12px 28px -10px rgba(14,15,21,.18);
  --z-base: 0; --z-dropdown: 1000; --z-sticky: 1100; --z-overlay: 1200; --z-modal: 1300; --z-toast: 1400;
```

Og i `[data-theme="dark"]` (kun det der skal afvige):

```css
  --shadow-overlay: 0 12px 30px -8px rgba(0,0,0,.6);
```

- [ ] **Step 4: Extend tailwind** `frontend/tailwind.config.js` inde i `theme.extend` (efter `colors`-blokken):

```js
      borderRadius: {
        cz: "var(--radius-sm)",
        "cz-pill": "var(--radius-pill)",
      },
      boxShadow: {
        overlay: "var(--shadow-overlay)",
      },
      zIndex: {
        dropdown: "1000", sticky: "1100", overlay: "1200", modal: "1300", toast: "1400",
      },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/tokens.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/index.css frontend/tailwind.config.js frontend/src/components/ui/tokens.test.js
git commit -m "feat(ui): design-tokens for radius, motion, elevation, z-index"
```

---

## Task 2: Global focus-ring

**Files:**
- Modify: `frontend/src/index.css` (ny global regel; behold `.board-a11y`-reglen indtil app-sweep fjerner dens behov)
- Test: `frontend/src/components/ui/focusRing.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("global focus-visible ring er defineret (laast: 2px / 1px offset, accent-t)", () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid rgb\(var\(--accent-t\)\)/s);
  assert.match(css, /:focus-visible\s*\{[^}]*outline-offset:\s*1px/s);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/focusRing.test.js`
Expected: FAIL.

- [ ] **Step 3: Add the global rule** to `frontend/src/index.css` (efter `body`-blokken):

```css
/* Global tastatur-fokus (#671). :focus-visible = kun tastatur, aldrig museklik.
   2px outline + 1px offset; outline (ikke box-shadow) overlever hoej-kontrast-mode;
   accent-t er tema-bevidst (dyb guld light / lys guld dark). */
:where(a, button, input, select, textarea, [tabindex="0"], [role="button"]):focus-visible {
  outline: 2px solid rgb(var(--accent-t));
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/focusRing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/components/ui/focusRing.test.js
git commit -m "feat(ui): global :focus-visible ring (generaliserer board-only reglen)"
```

---

## Task 3: Button-style-helper (ren funktion)

**Files:**
- Create: `frontend/src/components/ui/buttonStyles.js`
- Test: `frontend/src/components/ui/buttonStyles.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonClass } from "./buttonStyles.js";

test("primary er guld-fyld med skarp radius", () => {
  const c = buttonClass({ variant: "primary" });
  assert.ok(c.includes("bg-cz-accent"));
  assert.ok(c.includes("text-cz-on-accent"));
  assert.ok(c.includes("rounded-cz"));
});

test("secondary er neutral outline (laast valg A)", () => {
  const c = buttonClass({ variant: "secondary" });
  assert.ok(c.includes("border-cz-border"));
  assert.ok(!c.includes("border-cz-accent"), "secondary maa ikke vaere guld-outline");
});

test("ukendt variant falder tilbage til primary; size styrer padding; fullWidth", () => {
  assert.equal(buttonClass({ variant: "xx" }), buttonClass({ variant: "primary" }));
  assert.ok(buttonClass({ size: "sm" }).includes("px-3"));
  assert.ok(buttonClass({ size: "lg" }).includes("px-5"));
  assert.ok(buttonClass({ fullWidth: true }).includes("w-full"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/buttonStyles.test.js`
Expected: FAIL (`Cannot find module './buttonStyles.js'`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/buttonStyles.js`

```js
const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-cz border " +
  "transition-colors duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none";

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-[15px]",
};

const VARIANTS = {
  primary: "bg-cz-accent text-cz-on-accent border-transparent hover:brightness-105 active:translate-y-px",
  secondary: "bg-transparent text-cz-1 border-cz-border hover:border-cz-3",
  ghost: "bg-transparent text-cz-2 border-transparent hover:bg-cz-subtle hover:text-cz-1",
  danger: "bg-transparent text-cz-danger border-cz-danger/50 hover:bg-cz-danger/10",
};

export function buttonClass({ variant = "primary", size = "md", fullWidth = false } = {}) {
  return [
    BASE,
    SIZES[size] ?? SIZES.md,
    VARIANTS[variant] ?? VARIANTS.primary,
    fullWidth ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/buttonStyles.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/buttonStyles.js frontend/src/components/ui/buttonStyles.test.js
git commit -m "feat(ui): buttonClass style-helper (primary/secondary/ghost/danger)"
```

---

## Task 4: Button-komponent

**Files:**
- Create: `frontend/src/components/ui/Button.jsx`
- Test: `frontend/src/components/ui/button.source.test.js`

- [ ] **Step 1: Write the failing test** (kilde-assert, repo-konvention)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Button.jsx"), "utf8");

test("Button bruger buttonClass og saetter aldrig outline:none", () => {
  assert.match(src, /buttonClass\(/, "Button skal komme sin styling fra buttonClass");
  assert.ok(!/outline:\s*none/.test(src), "Button maa ikke fjerne fokus-ringen");
});

test("Button har loading-state og forwarder rest-props", () => {
  assert.match(src, /loading/, "Button skal have loading-prop");
  assert.match(src, /\.\.\.rest/, "Button skal forwarde rest-props til <button>");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/button.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/Button.jsx`

```jsx
import { buttonClass } from "./buttonStyles.js";

export default function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  className = "",
  children,
  ...rest
}) {
  return (
    <button
      className={`${buttonClass({ variant, size, fullWidth })} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      )}
      {!loading && iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/button.source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Button.jsx frontend/src/components/ui/button.source.test.js
git commit -m "feat(ui): Button-komponent (variants, sizes, loading, icon-slots)"
```

---

## Task 5: Badge-helpers + StatusBadge + CategoryTag

**Files:**
- Create: `frontend/src/components/ui/badgeStyles.js`, `StatusBadge.jsx`, `CategoryTag.jsx`
- Test: `frontend/src/components/ui/badgeStyles.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusBadgeClass, categoryTagClass, STATUS_TONE } from "./badgeStyles.js";

test("status er broadcast: ingen pille-baggrund som default", () => {
  const c = statusBadgeClass("live");
  assert.ok(!c.includes("rounded-cz-pill"), "status maa ikke vaere en pille");
  assert.ok(c.includes("text-cz-info"), "live skal bruge info-tonen");
});

test("emphasis-status faar skarp tonet blok (ikke pille)", () => {
  const c = statusBadgeClass("closing", { emphasis: true });
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("bg-cz-warning/10"));
});

test("category-tag er skarp data-tag; dense er borderless keyline", () => {
  assert.ok(categoryTagClass().includes("rounded-cz"));
  assert.ok(categoryTagClass().includes("border-cz-border"));
  const dense = categoryTagClass({ dense: true });
  assert.ok(dense.includes("border-l-2"), "dense = venstre guld-keyline");
  assert.ok(!dense.includes("border-cz-border"));
});

test("STATUS_TONE mapper kendte states", () => {
  assert.equal(STATUS_TONE.won, "success");
  assert.equal(STATUS_TONE.outbid, "danger");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/badgeStyles.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/badgeStyles.js`

```js
// Status = farve baerer betydning. Tone -> cz-semantiske farver.
export const STATUS_TONE = {
  live: "info",
  won: "success",
  outbid: "danger",
  closing: "warning",
  info: "info",
};

const TONE_TEXT = { info: "text-cz-info", success: "text-cz-success", danger: "text-cz-danger", warning: "text-cz-warning" };
const TONE_BG = { info: "bg-cz-info/10", success: "bg-cz-success/10", danger: "bg-cz-danger/10", warning: "bg-cz-warning/10" };

const BC_BASE = "inline-flex items-center gap-1.5 font-data text-[11px] font-semibold uppercase tracking-[.08em] tabular-nums";

export function statusBadgeClass(state, { emphasis = false } = {}) {
  const tone = STATUS_TONE[state] ?? "info";
  const parts = [BC_BASE, TONE_TEXT[tone]];
  if (emphasis) parts.push("rounded-cz px-2 py-0.5", TONE_BG[tone]);
  return parts.join(" ");
}

const TAG_BASE = "inline-flex items-center font-data text-[10px] font-semibold uppercase tracking-[.08em] text-cz-2";

export function categoryTagClass({ dense = false } = {}) {
  if (dense) return `${TAG_BASE} tracking-[.1em] pl-2 border-l-2 border-cz-accent`;
  return `${TAG_BASE} rounded-cz border border-cz-border bg-cz-subtle px-2 py-0.5`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/badgeStyles.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement components** `frontend/src/components/ui/StatusBadge.jsx`

```jsx
import { statusBadgeClass, STATUS_TONE } from "./badgeStyles.js";

const TONE_DOT = { info: "bg-cz-info", success: "bg-cz-success", danger: "bg-cz-danger", warning: "bg-cz-warning" };

export default function StatusBadge({ state, emphasis = false, pulse = false, children, className = "" }) {
  const tone = STATUS_TONE[state] ?? "info";
  return (
    <span className={`${statusBadgeClass(state, { emphasis })} ${className}`}>
      <span
        aria-hidden="true"
        className={`h-[7px] w-[7px] rounded-full ${TONE_DOT[tone]} ${pulse ? "shadow-[0_0_0_3px_rgb(var(--info)/0.18)]" : ""}`}
      />
      {children}
    </span>
  );
}
```

`frontend/src/components/ui/CategoryTag.jsx`

```jsx
import { categoryTagClass } from "./badgeStyles.js";

export default function CategoryTag({ dense = false, children, className = "" }) {
  return <span className={`${categoryTagClass({ dense })} ${className}`}>{children}</span>;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/badgeStyles.js frontend/src/components/ui/badgeStyles.test.js frontend/src/components/ui/StatusBadge.jsx frontend/src/components/ui/CategoryTag.jsx
git commit -m "feat(ui): StatusBadge (broadcast) + CategoryTag (skarp data-tag)"
```

---

## Task 6: Card-komponent

**Files:**
- Create: `frontend/src/components/ui/Card.jsx`
- Test: `frontend/src/components/ui/card.source.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Card.jsx"), "utf8");

test("Card er hairline (border + cz-card), skarp radius, ingen glow", () => {
  assert.match(src, /border-cz-border/);
  assert.match(src, /bg-cz-card/);
  assert.match(src, /rounded-cz/);
  assert.ok(!/shadow-\[0_0/.test(src), "Card maa ikke have glow");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/card.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/Card.jsx`

```jsx
export default function Card({ interactive = false, className = "", children, ...rest }) {
  const base = "rounded-cz border border-cz-border bg-cz-card";
  const hover = interactive ? "transition-colors duration-150 hover:border-cz-3" : "";
  return (
    <div className={`${base} ${hover} ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/card.source.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Card.jsx frontend/src/components/ui/card.source.test.js
git commit -m "feat(ui): Card-komponent (hairline, interactive-variant)"
```

---

## Task 7: Ikon-base + starter-ikoner

**Files:**
- Create: `frontend/src/components/ui/icons/IconBase.jsx`, `frontend/src/components/ui/icons/index.jsx`
- Test: `frontend/src/components/ui/icons/iconBase.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "IconBase.jsx"), "utf8");

test("IconBase foelger hus-spec (24-grid, stroke 2, currentColor, fill none)", () => {
  assert.match(src, /viewBox="0 0 24 24"/);
  assert.match(src, /strokeWidth=\{?2\}?|stroke-width="2"|strokeWidth="2"/);
  assert.match(src, /stroke="currentColor"/);
  assert.match(src, /fill="none"/);
  assert.match(src, /strokeLinecap="round"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/icons/iconBase.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/icons/IconBase.jsx`

```jsx
export default function IconBase({ size = 20, className = "", children, title, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {children}
    </svg>
  );
}
```

`frontend/src/components/ui/icons/index.jsx` (starter-sæt, hus-stil fra companion-mocken):

```jsx
import IconBase from "./IconBase.jsx";

export function SearchIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </IconBase>
  );
}

export function ChevronRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 6l6 6-6 6" />
    </IconBase>
  );
}

export function TrophyIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M10 17h4M12 13v4M9 21h6" />
    </IconBase>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/icons/iconBase.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/icons/
git commit -m "feat(ui): IconBase hus-spec + starter-ikoner (search, chevron, trophy)"
```

---

## Task 8: Barrel-export + kitchen-sink + route

**Files:**
- Create: `frontend/src/components/ui/index.js`, `frontend/src/pages/KitchenSinkPage.jsx`
- Modify: `frontend/src/App.jsx` (lazy-import + `<Route path="/ui" ...>`)

- [ ] **Step 1: Barrel-export** `frontend/src/components/ui/index.js`

```js
export { default as Button } from "./Button.jsx";
export { default as StatusBadge } from "./StatusBadge.jsx";
export { default as CategoryTag } from "./CategoryTag.jsx";
export { default as Card } from "./Card.jsx";
export * from "./icons/index.jsx";
```

- [ ] **Step 2: Kitchen-sink** `frontend/src/pages/KitchenSinkPage.jsx` (alle primitiver i alle states; dev-reference + snapshot-target)

```jsx
import { Button, StatusBadge, CategoryTag, Card, SearchIcon, ChevronRightIcon, TrophyIcon } from "../components/ui/index.js";

function Section({ title, children }) {
  return (
    <section className="mb-12">
      <h2 className="mb-5 inline-block border-t-2 border-cz-accent pt-3 font-display text-2xl tracking-[.02em] text-cz-1">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

export default function KitchenSinkPage() {
  return (
    <main className="mx-auto max-w-5xl px-10 py-12">
      <p className="mb-2 font-data text-xs font-semibold uppercase tracking-[.18em] text-cz-accent">
        Cycling Zone · UI-fundament
      </p>
      <h1 className="mb-10 font-display text-5xl leading-[.96] tracking-[.012em] text-cz-1">Kitchen sink</h1>

      <Section title="Buttons">
        <Button variant="primary">Place bid</Button>
        <Button variant="secondary">Watch rider</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Release rider</Button>
        <Button variant="primary" size="sm">Small</Button>
        <Button variant="primary" size="lg">Large</Button>
        <Button variant="primary" iconRight={<ChevronRightIcon size={15} />}>With icon</Button>
        <Button variant="primary" disabled>Disabled</Button>
        <Button variant="primary" loading>Placing</Button>
      </Section>

      <Section title="Status (broadcast)">
        <StatusBadge state="live" pulse>Live</StatusBadge>
        <StatusBadge state="won">Won</StatusBadge>
        <StatusBadge state="outbid">Outbid</StatusBadge>
        <StatusBadge state="closing" emphasis>Closing 0:14</StatusBadge>
      </Section>

      <Section title="Category tags">
        <CategoryTag>GC</CategoryTag>
        <CategoryTag>Sprinter</CategoryTag>
        <CategoryTag>Climber</CategoryTag>
        <CategoryTag dense>Domestique</CategoryTag>
      </Section>

      <Section title="Cards">
        <Card className="w-56 p-4">
          <div className="mb-2 font-data text-[11px] uppercase tracking-[.1em] text-cz-3">Team value</div>
          <div className="font-data text-3xl font-semibold tabular-nums text-cz-1">€1.24M</div>
        </Card>
        <Card interactive className="w-56 p-4">
          <div className="flex items-center gap-2">
            <TrophyIcon size={18} className="text-cz-accent" />
            <span className="text-sm font-semibold text-cz-1">Interactive</span>
          </div>
        </Card>
      </Section>

      <Section title="Icons">
        <SearchIcon className="text-cz-2" />
        <ChevronRightIcon className="text-cz-2" />
        <TrophyIcon className="text-cz-accent" />
      </Section>
    </main>
  );
}
```

- [ ] **Step 3: Add route** i `frontend/src/App.jsx`: tilføj lazy-import ved de andre (`const KitchenSinkPage = lazy(() => import("./pages/KitchenSinkPage"));`) og en offentlig rute uden auth ved siden af de andre `<Route>`-elementer:

```jsx
<Route path="/ui" element={<KitchenSinkPage />} />
```

- [ ] **Step 4: Verify it renders**

Run: `cd frontend && npm run build`
Expected: build OK, ingen import-fejl (verificerer at extensionless/ESM-importerne loader, jf. #803).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/index.js frontend/src/pages/KitchenSinkPage.jsx frontend/src/App.jsx
git commit -m "feat(ui): /ui kitchen-sink-side + barrel-export"
```

---

## Task 9: Kitchen-sink snapshot + fuld gate + ejer-lås

**Files:**
- Create: `frontend/tests/e2e/kitchen-sink.spec.js`

- [ ] **Step 1: Write the snapshot spec** (offentlig side, ingen login; modelleret på `core-smoke.spec.js`)

```js
import { expect, test } from "@playwright/test";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("kitchen-sink renders all primitives", async ({ page }) => {
  await page.goto("/ui");
  await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Place bid" })).toBeVisible();
  await expect(page).toHaveScreenshot("kitchen-sink.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
```

- [ ] **Step 2: Generate baselines (alle 3 projekter)**

Run: `cd frontend && npx playwright test kitchen-sink --update-snapshots`
Expected: 3 baseline-PNG'er oprettet (desktop-chromium + mobile-chromium + mobile-webkit). Eyeball dem i `tests/e2e/kitchen-sink.spec.js-snapshots/` for at de ser rigtige ud.

- [ ] **Step 3: Re-run to verify they pass**

Run: `cd frontend && npx playwright test kitchen-sink`
Expected: PASS (3 projekter).

- [ ] **Step 4: Full local gate** (jf. CLAUDE.md pre-flight)

Run: `pwsh -File scripts/verify-local.ps1` (backend + frontend `node --test` + frontend build)
Run: `cd frontend && npm run lint`
Run: `cd frontend && npx playwright test core-smoke` (verificér INGEN regression i eksisterende snapshots fra token/focus-ændringer; refresh + commit kun hvis en diff er bevidst og korrekt)
Expected: alt grønt. Hvis core-smoke viser en diff: inspicér; en utilsigtet visuel ændring fra tokens er en regression der skal fixes, ikke snapshottes væk.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/e2e/kitchen-sink.spec.js frontend/tests/e2e/kitchen-sink.spec.js-snapshots/
git commit -m "test(ui): kitchen-sink snapshot (3 projekter)"
```

- [ ] **Step 6: EJER-LÅS (visuelt gate)**

Start preview, åbn `/ui`, og bed ejeren se primitiverne endeligt og visuelt (begge temaer via theme-toggle i appen). **Lås looket eller noter justeringer FØR Plan 2.** Dette er det aftalte visuelle godkendelses-checkpoint. Patch notes: ikke nødvendige (intet bruger-vendt endnu; `/ui` er en intern reference-side).

---

## Self-review (udført)

- **Spec-dækning:** Plan 1 dækker spec-DEL-A (tokens: A1 type bruges i kitchen-sink, A3 radius, A4 elevation-token, A5 focus-ring, A6 motion-token, A7 z-index) + DEL-B-kerne (Button, StatusBadge, CategoryTag, Card, Icon, kitchen-sink-arkitektur). Resten af DEL B (Field-sæt, Table, Modal m.fl.) + DEL C (lint-guard, udrulning) er eksplicit Plan 2-4. Spacing (A2) + fuldt ikon-sæt (A8) bruges/udbygges i Plan 2.
- **Placeholders:** ingen TBD/TODO; alle kode-trin har faktisk kode + kommandoer + forventet output.
- **Type-konsistens:** `buttonClass`, `statusBadgeClass`, `categoryTagClass`, `STATUS_TONE` defineret i Task 3/5 og brugt konsistent i Task 4/5/8. `IconBase` (Task 7) bruges af starter-ikoner + kitchen-sink (Task 8). Tokens `rounded-cz`/`cz-pill`/`shadow-overlay` defineret i Task 1 og brugt i Task 3/5/6.

## Åbne afhængigheder

- `rounded-cz` virker først efter Task 1 (tailwind-nøgle). Task-rækkefølgen respekterer dette.
- `cz-warning`/`cz-info`/`cz-success`/`cz-danger` + `/10`-alpha findes allerede (channel-format i index.css) -> badge-helpers virker uden nye farve-tokens.
- Playwright-snapshots er win32-baseline (frontend-smoke er advisory, jf. memory); CI's frontend-smoke kan teardown-flake uden at være hard-gate.
