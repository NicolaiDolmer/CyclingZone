# UI-fundament Plan 2a: Field-sæt + Table + states (mod det låste look)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg "side-indhold"-primitiverne — Field-sæt (Input/Select/Textarea/Checkbox/Radio/Toggle + Label/Helper/error), Table (hairline, tabular, sticky første kolonne, trøje-prik), states (EmptyState/ErrorState/Skeleton/Spinner) og Divider/Link — som tynde, token-forbrugende React-primitiver mod det ejer-låste look fra Plan 1, samlet i `/ui` kitchen-sink.

**Architecture:** Mirror Plan 1 nøjagtigt: primitiver i `frontend/src/components/ui/`, al variant→className-logik i rene funktioner unit-testet med `node --test`, komponent-adfærd verificeret med kilde-streng-asserts (repo-konvention — ingen jsdom/RTL). Skeleton-shimmer er en CSS-klasse i `index.css` med `prefers-reduced-motion`-guard (spec A6). Visuelt verificeres via udvidet `/ui`-side + Playwright fuld-side-snapshot (3 projekter). Dette bygger primitiverne; udrulning til eksisterende callsites (`.sticky-name-cell`, de 5 modaler, `OverbidToast`) er Plan 4.

**Tech Stack:** React 18 + Vite 8 + Tailwind 3.4, react-router-dom 6, `node --test`, Playwright 1.60.

**Spec:** [`2026-06-14-design-system-foundation-design.md`](../specs/2026-06-14-design-system-foundation-design.md) DEL-B (Field-sæt, Table, EmptyState, Skeleton/LoadingState, ErrorState, Divider/Link). Plan 1 (forudgående, merged): [`2026-06-14-ui-foundation-tokens-primitives.md`](2026-06-14-ui-foundation-tokens-primitives.md).

---

## Plan-rækkefølge (dette er Plan 2a af Plan 2-bølgerne)

Plan 2 deles i tre review-bare bølger (ejer-beslutning 14/6):
- **Plan 2a (her):** Field-sæt + Table + states (Empty/Error/Skeleton/Spinner) + Divider/Link + de få ikoner disse kræver.
- **Plan 2b:** overlays — Modal/Dialog, Dropdown/Menu, Tooltip, Toast, Tabs (deler portal/focus-trap/z-index/Esc).
- **Plan 2c:** fuldt 30-50-ikon-sæt (hus-spec A8) + Chip/Avatar/ProgressMeter.

Derefter Plan 3 (anti-drift lint-guard + error-boundary) og Plan 4+ (udrulning side-for-side).

## Setup (før Task 1)

Kør på en feature-branch i et worktree (brug `superpowers:using-git-worktrees`). Alt herunder er `feat(ui)` via branch + PR (ingen migration → normal PR-flow). I worktree: `npm ci` i `frontend/`, og kun `VITE_`-vars i `.env` (jf. memory).

## Anti-slop-vagt (gælder hver task)

Mod spec A9 + [[feedback_anti_ai_slop_design_taste]]: **ingen** `rounded-xl/2xl`, **ingen** glow (`shadow-[0_0...]`), **ingen** gradient-blob, **ingen** emoji som ikon. Kun token-klasser (`rounded-cz`, `cz-*`-farver). Guld (`cz-accent`) kun til primær handling/selektion — aldrig rutine-flader. Inline `style={{ backgroundColor }}` er KUN tilladt til ægte data-farver (trøjefarver) — aldrig som erstatning for et farve-token.

## Fil-struktur (Plan 2a)

| Fil | Ansvar |
|---|---|
| `frontend/src/components/ui/icons/index.jsx` (modify) | + ChevronDown, Check, X, AlertTriangle, Info, Inbox (interim — fuldt sæt i 2c) |
| `frontend/src/components/ui/icons/iconSet2a.test.js` (create) | Kilde-assert: nye ikoner bruger IconBase |
| `frontend/src/components/ui/fieldStyles.js` (create) | Rene `controlClass()` / `labelClass()` / `helperClass()` |
| `frontend/src/components/ui/fieldStyles.test.js` (create) | Unit-test af field-helpers |
| `frontend/src/components/ui/Field.jsx` (create) | Layout-wrapper: Label + control-slot + helper/error |
| `frontend/src/components/ui/Input.jsx` (create) | `<input>`-wrapper |
| `frontend/src/components/ui/Textarea.jsx` (create) | `<textarea>`-wrapper |
| `frontend/src/components/ui/Select.jsx` (create) | `<select>` + chevron |
| `frontend/src/components/ui/Checkbox.jsx` (create) | Native checkbox, accent-color |
| `frontend/src/components/ui/Radio.jsx` (create) | Native radio, accent-color |
| `frontend/src/components/ui/Toggle.jsx` (create) | Switch (peer-baseret) |
| `frontend/src/components/ui/field.source.test.js` (create) | Kilde-assert: Field/Input/Textarea/Select/Checkbox/Radio/Toggle |
| `frontend/src/components/ui/tableStyles.js` (create) | Ren `cellClass()` |
| `frontend/src/components/ui/tableStyles.test.js` (create) | Unit-test af cellClass |
| `frontend/src/components/ui/Table.jsx` (create) | Table/Th/Td/Tr/JerseyDot |
| `frontend/src/components/ui/table.source.test.js` (create) | Kilde-assert: Table-dele |
| `frontend/src/components/ui/EmptyState.jsx` (create) | Ikon + titel + tekst + handling |
| `frontend/src/components/ui/ErrorState.jsx` (create) | Alert-ikon + besked + retry |
| `frontend/src/components/ui/Skeleton.jsx` (create) | Shimmer-blok (reduced-motion-aware) |
| `frontend/src/components/ui/Spinner.jsx` (create) | Wrapper om eksisterende `.spinner` |
| `frontend/src/components/ui/state.source.test.js` (create) | Kilde-assert: EmptyState/ErrorState/Skeleton/Spinner |
| `frontend/src/components/ui/Divider.jsx` (create) | Hairline-skiller (+ label-variant) |
| `frontend/src/components/ui/Link.jsx` (create) | Tekst-link (accent-t, underline, `as`-prop) |
| `frontend/src/components/ui/misc.source.test.js` (create) | Kilde-assert: Divider/Link |
| `frontend/src/index.css` (modify) | `@keyframes cz-shimmer` + `.cz-skeleton` + reduced-motion-guard |
| `frontend/src/components/ui/skeletonCss.test.js` (create) | Kilde-assert: shimmer + reduced-motion i index.css |
| `frontend/src/components/ui/index.js` (modify) | Barrel-export af alle nye primitiver |
| `frontend/src/pages/KitchenSinkPage.jsx` (modify) | Nye sektioner: Form fields, Table, States, Dividers & links |
| `frontend/tests/e2e/kitchen-sink.spec.js-snapshots/` (regenerate) | Opdaterede baselines (3 projekter) |

---

## Task 1: Interim-ikoner (ChevronDown, Check, X, AlertTriangle, Info, Inbox)

Plan 2a's controls + states kræver et par ikoner som Plan 1's starter-sæt ikke har. Det fulde 30-50-sæt er Plan 2c; her tilføjes kun det 2a bruger, mod samme hus-spec (IconBase).

**Files:**
- Modify: `frontend/src/components/ui/icons/index.jsx`
- Test: `frontend/src/components/ui/icons/iconSet2a.test.js`

- [ ] **Step 1: Write the failing test** (`frontend/src/components/ui/icons/iconSet2a.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.jsx"), "utf8");

test("2a-ikoner er defineret og bygger paa IconBase", () => {
  for (const name of ["ChevronDownIcon", "CheckIcon", "XIcon", "AlertTriangleIcon", "InfoIcon", "InboxIcon"]) {
    assert.match(src, new RegExp(`export function ${name}\\(`), `mangler ${name}`);
  }
  // Hus-spec haandhaeves centralt af IconBase; ikonerne maa kun levere <path>/<circle> indeni.
  assert.ok(!/stroke-width|strokeWidth/.test(src), "ikoner maa ikke override stroke (IconBase ejer hus-spec)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/icons/iconSet2a.test.js`
Expected: FAIL (`mangler ChevronDownIcon`).

- [ ] **Step 3: Append ikoner** til `frontend/src/components/ui/icons/index.jsx` (efter `TrophyIcon`):

```jsx
export function ChevronDownIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 9l6 6 6-6" />
    </IconBase>
  );
}

export function CheckIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M20 6L9 17l-5-5" />
    </IconBase>
  );
}

export function XIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </IconBase>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </IconBase>
  );
}

export function InfoIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </IconBase>
  );
}

export function InboxIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M5 6h14l2 6v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-6z" />
    </IconBase>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/icons/iconSet2a.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/icons/index.jsx frontend/src/components/ui/icons/iconSet2a.test.js
git commit -m "feat(ui): interim-ikoner for Plan 2a (chevron-down, check, x, alert, info, inbox)"
```

---

## Task 2: Field-style-helpers (rene funktioner)

**Files:**
- Create: `frontend/src/components/ui/fieldStyles.js`
- Test: `frontend/src/components/ui/fieldStyles.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlClass, labelClass, helperClass } from "./fieldStyles.js";

test("control er fuld-bredde, skarp radius, hairline border som default", () => {
  const c = controlClass();
  assert.ok(c.includes("w-full"));
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("border-cz-border"));
  assert.ok(!c.includes("border-cz-danger"), "default maa ikke vaere error");
});

test("error-state giver danger-border (laast)", () => {
  const c = controlClass({ error: true });
  assert.ok(c.includes("border-cz-danger"));
  assert.ok(!c.includes("border-cz-border"));
});

test("size styrer padding; ukendt size falder tilbage til md", () => {
  assert.ok(controlClass({ size: "sm" }).includes("px-2.5"));
  assert.ok(controlClass({ size: "lg" }).includes("px-3.5"));
  assert.equal(controlClass({ size: "xx" }), controlClass({ size: "md" }));
});

test("label er versal Inter Tight; helper bliver danger ved error", () => {
  assert.ok(labelClass().includes("uppercase"));
  assert.ok(labelClass().includes("font-data"));
  assert.ok(helperClass().includes("text-cz-3"));
  assert.ok(helperClass({ error: true }).includes("text-cz-danger"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/fieldStyles.test.js`
Expected: FAIL (`Cannot find module './fieldStyles.js'`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/fieldStyles.js`

```js
const CONTROL_BASE =
  "w-full rounded-cz border bg-cz-card text-cz-1 placeholder:text-cz-3 " +
  "transition-colors duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed";

const CONTROL_SIZES = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-3.5 py-2.5 text-[15px]",
};

export function controlClass({ size = "md", error = false } = {}) {
  return [
    CONTROL_BASE,
    CONTROL_SIZES[size] ?? CONTROL_SIZES.md,
    error ? "border-cz-danger focus:border-cz-danger" : "border-cz-border focus:border-cz-3",
  ].join(" ");
}

export function labelClass() {
  return "mb-1.5 block font-data text-[11px] font-semibold uppercase tracking-[.12em] text-cz-2";
}

export function helperClass({ error = false } = {}) {
  return error ? "mt-1.5 text-xs text-cz-danger" : "mt-1.5 text-xs text-cz-3";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/fieldStyles.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/fieldStyles.js frontend/src/components/ui/fieldStyles.test.js
git commit -m "feat(ui): fieldStyles helpers (control/label/helper + error-state)"
```

---

## Task 3: Field-wrapper + controls (Input, Textarea, Select, Checkbox, Radio, Toggle)

Bygger alle form-komponenterne i én task (de deler `fieldStyles` og testes med ét kilde-assert). `Field` er en ren layout-wrapper; controls er tynde wrappers. Focus håndteres af den globale `:focus-visible`-ring (Plan 1) — controls fjerner ALDRIG outline.

**Files:**
- Create: `frontend/src/components/ui/Field.jsx`, `Input.jsx`, `Textarea.jsx`, `Select.jsx`, `Checkbox.jsx`, `Radio.jsx`, `Toggle.jsx`
- Test: `frontend/src/components/ui/field.source.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("Field lader label/helper/error komme fra fieldStyles", () => {
  const src = read("Field.jsx");
  assert.match(src, /labelClass\(/);
  assert.match(src, /helperClass\(/);
  assert.match(src, /error/, "Field skal kunne vise error-besked");
});

test("Input/Textarea bruger controlClass, saetter aria-invalid, forwarder rest", () => {
  for (const f of ["Input.jsx", "Textarea.jsx"]) {
    const src = read(f);
    assert.match(src, /controlClass\(/, `${f} skal bruge controlClass`);
    assert.match(src, /aria-invalid/, `${f} skal saette aria-invalid`);
    assert.match(src, /\.\.\.rest/, `${f} skal forwarde rest-props`);
    assert.ok(!/outline:\s*none/.test(src), `${f} maa ikke fjerne fokus-ringen`);
  }
});

test("Select er chevron-baseret native select", () => {
  const src = read("Select.jsx");
  assert.match(src, /appearance-none/);
  assert.match(src, /ChevronDownIcon/);
});

test("Checkbox/Radio bruger native input + accent-color (guld-selektion)", () => {
  assert.match(read("Checkbox.jsx"), /type="checkbox"/);
  assert.match(read("Checkbox.jsx"), /accent-cz-accent/);
  assert.match(read("Radio.jsx"), /type="radio"/);
  assert.match(read("Radio.jsx"), /rounded-cz-pill|rounded-full/);
});

test("Toggle er en switch med peer-dreven thumb", () => {
  const src = read("Toggle.jsx");
  assert.match(src, /role="switch"/);
  assert.match(src, /peer-checked:translate-x-4/);
  assert.match(src, /peer-checked:bg-cz-accent/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/field.source.test.js`
Expected: FAIL (`ENOENT ... Field.jsx`).

- [ ] **Step 3: Implement** `frontend/src/components/ui/Field.jsx`

```jsx
import { labelClass, helperClass } from "./fieldStyles.js";

export default function Field({ label, htmlFor, helper, error, children, className = "" }) {
  const message = error || helper;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className={labelClass()}>
          {label}
        </label>
      )}
      {children}
      {message && <p className={helperClass({ error: Boolean(error) })}>{message}</p>}
    </div>
  );
}
```

`frontend/src/components/ui/Input.jsx`

```jsx
import { controlClass } from "./fieldStyles.js";

export default function Input({ size = "md", error = false, className = "", ...rest }) {
  return (
    <input
      className={`${controlClass({ size, error })} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}
```

`frontend/src/components/ui/Textarea.jsx`

```jsx
import { controlClass } from "./fieldStyles.js";

export default function Textarea({ size = "md", error = false, rows = 4, className = "", ...rest }) {
  return (
    <textarea
      rows={rows}
      className={`${controlClass({ size, error })} ${className}`}
      aria-invalid={error || undefined}
      {...rest}
    />
  );
}
```

`frontend/src/components/ui/Select.jsx`

```jsx
import { controlClass } from "./fieldStyles.js";
import { ChevronDownIcon } from "./icons/index.jsx";

export default function Select({ size = "md", error = false, className = "", children, ...rest }) {
  return (
    <div className="relative">
      <select
        className={`${controlClass({ size, error })} appearance-none pr-9 ${className}`}
        aria-invalid={error || undefined}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-cz-3"
      />
    </div>
  );
}
```

`frontend/src/components/ui/Checkbox.jsx`

```jsx
export default function Checkbox({ label, id, className = "", ...rest }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-cz-1">
      <input
        id={id}
        type="checkbox"
        className={`h-4 w-4 rounded-[3px] accent-cz-accent ${className}`}
        {...rest}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
```

`frontend/src/components/ui/Radio.jsx`

```jsx
export default function Radio({ label, id, className = "", ...rest }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-cz-1">
      <input
        id={id}
        type="radio"
        className={`h-4 w-4 rounded-cz-pill accent-cz-accent ${className}`}
        {...rest}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
```

`frontend/src/components/ui/Toggle.jsx` (peer-baseret switch — track + thumb er søskende EFTER den sr-only input, så `peer-checked:` rammer dem; ringen surfaces på track via `peer-focus-visible`)

```jsx
export default function Toggle({ label, id, checked, className = "", ...rest }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-cz-1">
      <span className={`relative inline-block h-5 w-9 shrink-0 ${className}`}>
        <input id={id} type="checkbox" role="switch" checked={checked} className="peer sr-only" {...rest} />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-cz-pill bg-cz-subtle transition-colors duration-150 peer-checked:bg-cz-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cz-accent-t"
        />
        <span
          aria-hidden="true"
          className="absolute left-0.5 top-0.5 h-4 w-4 rounded-cz-pill bg-cz-card transition-transform duration-150 peer-checked:translate-x-4"
        />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/field.source.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Field.jsx frontend/src/components/ui/Input.jsx frontend/src/components/ui/Textarea.jsx frontend/src/components/ui/Select.jsx frontend/src/components/ui/Checkbox.jsx frontend/src/components/ui/Radio.jsx frontend/src/components/ui/Toggle.jsx frontend/src/components/ui/field.source.test.js
git commit -m "feat(ui): Field-saet (Field/Input/Textarea/Select/Checkbox/Radio/Toggle)"
```

---

## Task 4: Table-style-helper (ren funktion)

**Files:**
- Create: `frontend/src/components/ui/tableStyles.js`
- Test: `frontend/src/components/ui/tableStyles.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellClass } from "./tableStyles.js";

test("data-celle er venstrestillet med hairline-toplinje", () => {
  const c = cellClass();
  assert.ok(c.includes("text-left"));
  assert.ok(c.includes("border-t"));
  assert.ok(c.includes("border-cz-border"));
});

test("numerisk celle er hoejrestillet + tabular", () => {
  const c = cellClass({ numeric: true });
  assert.ok(c.includes("text-right"));
  assert.ok(c.includes("tabular-nums"));
  assert.ok(c.includes("font-data"));
});

test("header er versal label-stil uden raekke-border", () => {
  const c = cellClass({ header: true });
  assert.ok(c.includes("uppercase"));
  assert.ok(c.includes("text-cz-3"));
  assert.ok(!c.includes("border-t"), "header skal ikke have raekke-toplinje");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/tableStyles.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/tableStyles.js`

```js
const HEADER = "px-3 py-2 font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3";
const CELL = "px-3 py-2.5 text-sm text-cz-1 border-t border-cz-border";

export function cellClass({ numeric = false, header = false } = {}) {
  const base = header ? HEADER : CELL;
  return numeric ? `${base} text-right font-data tabular-nums` : `${base} text-left`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/tableStyles.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/tableStyles.js frontend/src/components/ui/tableStyles.test.js
git commit -m "feat(ui): tableStyles cellClass (data/numeric/header)"
```

---

## Task 5: Table-komponenter (Table, Th, Td, Tr, JerseyDot)

Kompositionelle dele frem for ét monolitisk `<Table>` — så callsites kan blande tabular- og data-celler. `sticky`-prop'en konsoliderer `.sticky-name-cell`-mønsteret (solid bg + `group-hover` bevarer række-feedback). `JerseyDot` tager en ægte trøjefarve via inline `style` (data-farve, ikke token).

**Files:**
- Create: `frontend/src/components/ui/Table.jsx`
- Test: `frontend/src/components/ui/table.source.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Table.jsx"), "utf8");

test("Table scroller horisontalt og eksporterer dele", () => {
  assert.match(src, /overflow-x-auto/);
  for (const part of ["function Table", "function Th", "function Td", "function Tr", "function JerseyDot"]) {
    assert.match(src, new RegExp(`export ${part}\\b`), `mangler ${part}`);
  }
});

test("Th sidder paa subtle-bg; sticky-prop giver sticky foerste kolonne", () => {
  assert.match(src, /bg-cz-subtle/);
  assert.match(src, /sticky left-0/);
});

test("Tr giver raekke-hover som group", () => {
  assert.match(src, /hover:bg-cz-subtle/);
  assert.match(src, /\bgroup\b/);
});

test("JerseyDot tager data-farve via style (ikke token)", () => {
  assert.match(src, /style=\{\{\s*backgroundColor/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/table.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/Table.jsx`

```jsx
import { cellClass } from "./tableStyles.js";

export function Table({ className = "", children, ...rest }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Tr({ className = "", children, ...rest }) {
  return (
    <tr className={`group transition-colors duration-150 hover:bg-cz-subtle ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function Th({ numeric = false, sticky = false, className = "", children, ...rest }) {
  const stickyCls = sticky ? "sticky left-0 z-sticky" : "";
  return (
    <th className={`${cellClass({ numeric, header: true })} bg-cz-subtle ${stickyCls} ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ numeric = false, sticky = false, className = "", children, ...rest }) {
  const stickyCls = sticky ? "sticky left-0 z-sticky bg-cz-card group-hover:bg-cz-subtle" : "";
  return (
    <td className={`${cellClass({ numeric })} ${stickyCls} ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function JerseyDot({ color = "#888", title, className = "" }) {
  return (
    <span
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      title={title}
      className={`inline-block h-2.5 w-2.5 rounded-cz-pill ring-1 ring-cz-border ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/table.source.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Table.jsx frontend/src/components/ui/table.source.test.js
git commit -m "feat(ui): Table-dele (Table/Th/Td/Tr + JerseyDot, sticky foerste kolonne)"
```

---

## Task 6: EmptyState + ErrorState

**Files:**
- Create: `frontend/src/components/ui/EmptyState.jsx`, `frontend/src/components/ui/ErrorState.jsx`
- Test: `frontend/src/components/ui/state.source.test.js` (delt med Task 7)

- [ ] **Step 1: Write the failing test** (komponent-delen; Skeleton/Spinner tilføjes i Task 7)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("EmptyState er et hairline-kort med ikon/titel/tekst/handling", () => {
  const src = read("EmptyState.jsx");
  assert.match(src, /border-cz-border/);
  assert.match(src, /rounded-cz/);
  assert.match(src, /\{icon\}/);
  assert.match(src, /\{title\}/);
  assert.match(src, /\{action\}/);
});

test("ErrorState bruger AlertTriangle + danger-tone + retry-slot", () => {
  const src = read("ErrorState.jsx");
  assert.match(src, /AlertTriangleIcon/);
  assert.match(src, /text-cz-danger/);
  assert.match(src, /\{action\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/state.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/EmptyState.jsx`

```jsx
export default function EmptyState({ icon = null, title, description, action = null, className = "" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-cz border border-cz-border bg-cz-card px-6 py-12 text-center ${className}`}
    >
      {icon && <div className="mb-3 text-cz-3">{icon}</div>}
      <p className="font-data text-sm font-semibold uppercase tracking-[.08em] text-cz-1">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-cz-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
```

`frontend/src/components/ui/ErrorState.jsx`

```jsx
import { AlertTriangleIcon } from "./icons/index.jsx";

export default function ErrorState({
  title = "Something went wrong",
  description,
  action = null,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-cz border border-cz-danger/40 bg-cz-danger/5 px-6 py-12 text-center ${className}`}
    >
      <AlertTriangleIcon size={24} className="mb-3 text-cz-danger" />
      <p className="text-sm font-semibold text-cz-1">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-cz-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/state.source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/EmptyState.jsx frontend/src/components/ui/ErrorState.jsx frontend/src/components/ui/state.source.test.js
git commit -m "feat(ui): EmptyState + ErrorState"
```

---

## Task 7: Skeleton + Spinner + reduced-motion-CSS

Shimmer lever som CSS-klasse i `index.css` (keyframe + `prefers-reduced-motion`-guard, spec A6). Spinner genbruger den eksisterende `.spinner`-klasse (token-baserede border-farver i `index.css:188`).

**Files:**
- Modify: `frontend/src/index.css` (efter `.sticky-name-cell`-blokken)
- Create: `frontend/src/components/ui/Skeleton.jsx`, `frontend/src/components/ui/Spinner.jsx`
- Test: `frontend/src/components/ui/skeletonCss.test.js`, og udvid `state.source.test.js`

- [ ] **Step 1: Write the failing CSS-test** (`frontend/src/components/ui/skeletonCss.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("shimmer-keyframe + .cz-skeleton findes", () => {
  assert.match(css, /@keyframes cz-shimmer/);
  assert.match(css, /\.cz-skeleton/);
});

test("reduced-motion slaar shimmer fra (spec A6, hard krav)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*cz-skeleton::after[^}]*animation:\s*none/s);
});
```

- [ ] **Step 2: Add the failing source-test** — tilføj til `frontend/src/components/ui/state.source.test.js`:

```js
test("Skeleton bruger cz-skeleton-klassen og er aria-hidden", () => {
  const src = read("Skeleton.jsx");
  assert.match(src, /cz-skeleton/);
  assert.match(src, /aria-hidden/);
});

test("Spinner genbruger .spinner + animate-spin og melder status", () => {
  const src = read("Spinner.jsx");
  assert.match(src, /"spinner|spinner /);
  assert.match(src, /animate-spin/);
  assert.match(src, /role="status"/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && node --test src/components/ui/skeletonCss.test.js src/components/ui/state.source.test.js`
Expected: FAIL.

- [ ] **Step 4: Add CSS** til `frontend/src/index.css` (efter `.sticky-name-cell`-blokken, før `.font-mono`-reglen):

```css
/* Skeleton-shimmer (#671 Plan 2a). Sweep i diskret accent-t; INGEN glow.
   prefers-reduced-motion slaar sweepet fra (spec A6, hard krav). */
@keyframes cz-shimmer {
  100% { transform: translateX(100%); }
}
.cz-skeleton {
  position: relative;
  overflow: hidden;
  background-color: var(--bg-subtle);
}
.cz-skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(var(--accent-t) / 0.08), transparent);
  animation: cz-shimmer 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .cz-skeleton::after { animation: none; }
}
```

- [ ] **Step 5: Implement** `frontend/src/components/ui/Skeleton.jsx`

```jsx
export default function Skeleton({ className = "h-4 w-full", rounded = "rounded-cz" }) {
  return <span aria-hidden="true" className={`block cz-skeleton ${rounded} ${className}`} />;
}
```

`frontend/src/components/ui/Spinner.jsx`

```jsx
export default function Spinner({ size = 20, className = "" }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`spinner inline-block animate-spin rounded-cz-pill border-2 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && node --test src/components/ui/skeletonCss.test.js src/components/ui/state.source.test.js`
Expected: PASS (skeletonCss: 2, state.source: 4).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/components/ui/Skeleton.jsx frontend/src/components/ui/Spinner.jsx frontend/src/components/ui/skeletonCss.test.js frontend/src/components/ui/state.source.test.js
git commit -m "feat(ui): Skeleton (reduced-motion-aware shimmer) + Spinner"
```

---

## Task 8: Divider + Link

**Files:**
- Create: `frontend/src/components/ui/Divider.jsx`, `frontend/src/components/ui/Link.jsx`
- Test: `frontend/src/components/ui/misc.source.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("Divider er en hairline (border-cz-border) med valgfri label", () => {
  const src = read("Divider.jsx");
  assert.match(src, /border-cz-border|bg-cz-border/);
  assert.match(src, /label/);
});

test("Link bruger accent-t + underline og understoetter as-prop", () => {
  const src = read("Link.jsx");
  assert.match(src, /text-cz-accent-t/);
  assert.match(src, /underline/);
  assert.match(src, /as:\s*As|as = /);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/components/ui/misc.source.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `frontend/src/components/ui/Divider.jsx`

```jsx
export default function Divider({ label, className = "" }) {
  if (label) {
    return (
      <div role="separator" className={`flex items-center gap-3 ${className}`}>
        <span className="h-px flex-1 bg-cz-border" />
        <span className="font-data text-[11px] font-semibold uppercase tracking-[.12em] text-cz-3">
          {label}
        </span>
        <span className="h-px flex-1 bg-cz-border" />
      </div>
    );
  }
  return <hr className={`border-0 border-t border-cz-border ${className}`} />;
}
```

`frontend/src/components/ui/Link.jsx`

```jsx
export default function Link({ as: As = "a", className = "", children, ...rest }) {
  return (
    <As
      className={`font-semibold text-cz-accent-t underline decoration-cz-border underline-offset-2 transition-colors duration-150 hover:decoration-cz-accent-t ${className}`}
      {...rest}
    >
      {children}
    </As>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/components/ui/misc.source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Divider.jsx frontend/src/components/ui/Link.jsx frontend/src/components/ui/misc.source.test.js
git commit -m "feat(ui): Divider (hairline + label) + Link (accent-t underline)"
```

---

## Task 9: Barrel-export + kitchen-sink-sektioner

**Files:**
- Modify: `frontend/src/components/ui/index.js`
- Modify: `frontend/src/pages/KitchenSinkPage.jsx`

- [ ] **Step 1: Udvid barrel** `frontend/src/components/ui/index.js` — tilføj efter de eksisterende eksporter (behold `export * from "./icons/index.jsx";` til sidst):

```js
export { default as Field } from "./Field.jsx";
export { default as Input } from "./Input.jsx";
export { default as Textarea } from "./Textarea.jsx";
export { default as Select } from "./Select.jsx";
export { default as Checkbox } from "./Checkbox.jsx";
export { default as Radio } from "./Radio.jsx";
export { default as Toggle } from "./Toggle.jsx";
export { Table, Tr, Th, Td, JerseyDot } from "./Table.jsx";
export { default as EmptyState } from "./EmptyState.jsx";
export { default as ErrorState } from "./ErrorState.jsx";
export { default as Skeleton } from "./Skeleton.jsx";
export { default as Spinner } from "./Spinner.jsx";
export { default as Divider } from "./Divider.jsx";
export { default as Link } from "./Link.jsx";
```

- [ ] **Step 2: Tilføj kitchen-sink-sektioner** — opdatér `frontend/src/pages/KitchenSinkPage.jsx`. Erstat import-linjen øverst med:

```jsx
import {
  Button, StatusBadge, CategoryTag, Card,
  Field, Input, Textarea, Select, Checkbox, Radio, Toggle,
  Table, Tr, Th, Td, JerseyDot,
  EmptyState, ErrorState, Skeleton, Spinner, Divider, Link,
  SearchIcon, ChevronRightIcon, TrophyIcon, InboxIcon,
} from "../components/ui/index.js";
```

Og indsæt disse sektioner lige før `</main>` (efter "Icons"-sektionen):

```jsx
      <Section title="Form fields">
        <Field label="Team name" htmlFor="ks-name" helper="Shown on the standings." className="w-64">
          <Input id="ks-name" placeholder="E2E Racing" />
        </Field>
        <Field label="Strategy" htmlFor="ks-strat" className="w-64">
          <Select id="ks-strat" defaultValue="gc">
            <option value="gc">General classification</option>
            <option value="sprint">Sprint</option>
            <option value="break">Breakaway</option>
          </Select>
        </Field>
        <Field label="Budget" htmlFor="ks-budget" error="Exceeds remaining balance." className="w-64">
          <Input id="ks-budget" defaultValue="1,400,000" error />
        </Field>
        <Field label="Note" htmlFor="ks-note" className="w-64">
          <Textarea id="ks-note" rows={3} placeholder="Tactics for the day…" />
        </Field>
      </Section>

      <Section title="Choices">
        <Checkbox id="ks-cap" label="Captain" defaultChecked />
        <Checkbox id="ks-dom" label="Domestique" />
        <Radio id="ks-r1" name="ks-role" label="Leader" defaultChecked />
        <Radio id="ks-r2" name="ks-role" label="Support" />
        <Toggle id="ks-auto" label="Auto-bid" defaultChecked />
        <Toggle id="ks-notify" label="Notifications" />
      </Section>

      <Section title="Table">
        <Table className="w-full">
          <thead>
            <Tr>
              <Th sticky>Rider</Th>
              <Th>Type</Th>
              <Th numeric>Value</Th>
              <Th numeric>Form</Th>
            </Tr>
          </thead>
          <tbody>
            <Tr>
              <Td sticky>
                <span className="inline-flex items-center gap-2">
                  <JerseyDot color="#e8c547" title="Maillot jaune" /> Ada Pedersen
                </span>
              </Td>
              <Td><CategoryTag>GC</CategoryTag></Td>
              <Td numeric>€1.68M</Td>
              <Td numeric>+4</Td>
            </Tr>
            <Tr>
              <Td sticky>
                <span className="inline-flex items-center gap-2">
                  <JerseyDot color="#1a47c0" title="Team kit" /> Bo Nielsen
                </span>
              </Td>
              <Td><CategoryTag>Sprinter</CategoryTag></Td>
              <Td numeric>€0.94M</Td>
              <Td numeric>−1</Td>
            </Tr>
          </tbody>
        </Table>
      </Section>

      <Section title="States">
        <EmptyState
          className="w-72"
          icon={<InboxIcon size={28} />}
          title="No riders yet"
          description="Draft your first rider in the live auction."
          action={<Button size="sm">Open auction</Button>}
        />
        <ErrorState
          className="w-72"
          title="Couldn't load riders"
          description="The request timed out."
          action={<Button size="sm" variant="secondary">Retry</Button>}
        />
        <Card className="w-72 p-4">
          <Skeleton className="mb-3 h-5 w-2/3" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Card>
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-sm text-cz-2">Loading…</span>
        </div>
      </Section>

      <Section title="Dividers & links">
        <div className="w-72">
          <p className="text-sm text-cz-2">
            Read the <Link href="#">tactics guide</Link> before the stage.
          </p>
          <Divider className="my-4" />
          <Divider label="or" />
        </div>
      </Section>
```

- [ ] **Step 3: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build OK, ingen import-fejl (verificerer extensionless/ESM-importerne, jf. #803).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/index.js frontend/src/pages/KitchenSinkPage.jsx
git commit -m "feat(ui): barrel-export + kitchen-sink-sektioner for Plan 2a-primitiver"
```

---

## Task 10: Snapshot-regen + fuld gate + ejer-lås

**Files:**
- Regenerate: `frontend/tests/e2e/kitchen-sink.spec.js-snapshots/` (3 PNG'er)

- [ ] **Step 1: Tilføj en assertion for de nye primitiver** — opdatér `frontend/tests/e2e/kitchen-sink.spec.js` så test'en fanger en af de nye sektioner (efter `Place bid`-assertionen):

```js
  await expect(page.getByRole("button", { name: "Open auction" })).toBeVisible();
```

- [ ] **Step 2: Regenerér baselines (alle 3 projekter)**

Run: `cd frontend && npx playwright test kitchen-sink --update-snapshots`
Expected: 3 baseline-PNG'er opdateret (desktop-chromium + mobile-chromium + mobile-webkit). Eyeball dem i `tests/e2e/kitchen-sink.spec.js-snapshots/` — alle nye primitiver synlige, intet slop (skarp 5px, ingen glow, ingen emoji).

- [ ] **Step 3: Re-run to verify they pass**

Run: `cd frontend && npx playwright test kitchen-sink`
Expected: PASS (3 projekter).

- [ ] **Step 4: Full local gate** (jf. CLAUDE.md pre-flight)

Run: `pwsh -File scripts/verify-local.ps1` (backend + frontend `node --test` + frontend build)
Run: `cd frontend && npm run lint`
Run: `cd frontend && npx playwright test core-smoke` (verificér INGEN regression i eksisterende snapshots fra de nye `index.css`-regler; en utilsigtet diff = regression der fixes, ikke snapshottes væk)
Expected: alt grønt.

- [ ] **Step 5: Commit + PR**

```bash
git add frontend/tests/e2e/kitchen-sink.spec.js frontend/tests/e2e/kitchen-sink.spec.js-snapshots/
git commit -m "test(ui): kitchen-sink snapshot m. Plan 2a-primitiver (3 projekter)"
git push -u origin <branch>
```

PR-body skal have **Brugerverifikation-sektion** (eller `backend-only`/`docs-only`-label gælder ikke her — dette er frontend) jf. [[feedback_pr_body_brugerverifikation]]. Patch notes: ikke nødvendige (intet bruger-vendt endnu; `/ui` er intern reference — udrulning er Plan 4). Noter dét eksplicit i PR-body.

- [ ] **Step 6: EJER-LÅS (visuelt gate)**

Start preview, åbn `/ui`, og bed ejeren se de nye primitiver i begge temaer (theme-toggle). **Lås looket eller noter justeringer FØR Plan 2b.** Verificér særligt: error-state field (danger-border + besked), Toggle on/off, sticky første kolonne ved scroll, EmptyState/ErrorState, Skeleton-shimmer (og at den stopper under reduced-motion).

---

## Self-review (udført)

- **Spec-dækning (DEL-B Plan 2a-del):** Field-sæt (Input/Select/Textarea/Checkbox/Radio/Toggle + Label/Helper/error) = Task 2-3. Table (hairline, tabular højre, label-header på subtle, række-hover, sticky første kolonne, trøje-prik) = Task 4-5. EmptyState = Task 6. ErrorState = Task 6. Skeleton/LoadingState (shimmer reduced-motion-aware + Spinner) = Task 7. Divider/Link (fra DEL-B "småting") = Task 8. Resten af DEL-B (Modal/Dropdown/Tooltip/Toast/Tabs = Plan 2b; Chip/Avatar/ProgressMeter + fuldt ikon-sæt = Plan 2c) eksplicit ude af scope.
- **Placeholders:** ingen TBD/TODO; hvert kode-trin har faktisk kode + kommando + forventet output.
- **Type-konsistens:** `controlClass`/`labelClass`/`helperClass` defineret i Task 2, brugt i Task 3. `cellClass` defineret i Task 4, brugt i Task 5. `ChevronDownIcon`/`AlertTriangleIcon`/`InboxIcon` defineret i Task 1, brugt i Task 3/5/6/9. Alle nye primitiver eksporteres i Task 9 og rendres i kitchen-sink samme task. `.cz-skeleton` (Task 7 CSS) forbruges af `Skeleton.jsx` (Task 7).
- **Anti-slop:** ingen `rounded-xl/2xl`, ingen `shadow-[0_0`, ingen emoji; guld kun på primær-knap + checkbox/radio/toggle-selektion (selektions-accent, ikke rutine-flade). JerseyDot's inline `style` er ægte data-farve (tilladt undtagelse).

## Åbne afhængigheder

- `accent-cz-accent` (Checkbox/Radio) kræver at Tailwind genererer `accent-color`-utility fra `cz-accent` (colors-key findes → virker). Hvis en celle ser forkert ud i snapshot: fallback er `accent-[rgb(var(--accent))]` (stadig token-drevet, ingen rå hex).
- `peer-focus-visible:outline-cz-accent-t` (Toggle) kræver Tailwind outline-color-utility (v3.3+ → findes). Verificér ringen er synlig på track ved tab i ejer-lås.
- Playwright-snapshots er win32-baseline (frontend-smoke advisory, jf. memory); CI's frontend-smoke kan teardown-flake uden at være hard-gate.
- De nye `index.css`-regler (`.cz-skeleton`) påvirker IKKE eksisterende flader (ny klasse) — men kør core-smoke for at bekræfte nul regression.
