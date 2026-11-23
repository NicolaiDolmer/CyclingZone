import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider } from "react-i18next";
import { transformSync } from "rolldown/utils";

const env = '({ DEV: false, VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test" })';
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      for (const ext of [".js", ".ts", ".jsx", ".tsx", "/index.js", "/index.ts", "/index.jsx", "/index.tsx"]) {
        try { return nextResolve(specifier + ext, context); } catch { /* Try the next source extension. */ }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Keep dialog contents in the static tree so their accessible states can be tested.
    if (url.endsWith("/ui/Portal.jsx")) {
      return { format: "module", shortCircuit: true, source: "export default ({ children }) => children;" };
    }
    if (/\.css(?:\?.*)?$/.test(url)) return { format: "module", shortCircuit: true, source: "export default {};" };
    const ext = url.match(/\.(tsx|jsx|ts|js)$/)?.[1] as "tsx" | "jsx" | "ts" | "js" | undefined;
    if (ext && url.startsWith("file:") && !url.includes("node_modules") && url.includes("/frontend/src/")) {
      const source = readFileSync(new URL(url), "utf8").replaceAll("import.meta.env", env);
      return { format: "module", shortCircuit: true,
        source: transformSync(fileURLToPath(url), source, { lang: ext, jsx: { runtime: "automatic" } }).code };
    }
    return nextLoad(url, context);
  },
});
const { default: ProgramR5, MoveRiderDialog, ProgramAssignmentConfirmation } = await import("./ProgramR5.tsx");
hook.deregister();

const i18n = createInstance();
const en = Object.fromEntries(["training", "trainingR5", "riderTypes"].map((ns) => [
  ns, JSON.parse(readFileSync(new URL(`../../../../public/locales/en/${ns}.json`, import.meta.url), "utf8")),
]));
await i18n.use(ICU).init({ lng: "en", initAsync: false, resources: { en }, fallbackLng: false });

type Props = ComponentProps<typeof ProgramR5>;
const ok = async () => ({ ok: true });
const noop = () => {};
const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const catalog = ["Sprinter", "Puncheur", "Rouleur", "Cobbles", "Time trial", "Climber"].map((name) => ({
  key: name.toLowerCase(), name: { en: name, da: name }, tagline: { en: "", da: "" },
  targetTypes: [], audience: null, days: Object.fromEntries(weekdays.map((day) => [day, "tempo"])),
}));
const props = {
  riders: [{ id: "a", firstname: "Rider A" }, { id: "b", firstname: "Rider B" }],
  weekdays, todayWeekday: "mon", todayLocked: false, mobile: false,
  riderWeekPlans: {}, catalogV3: false, actionsEl: null, forecast: null,
  programs: { catalog, assigned: {}, seeds: {}, busy: false, applyProgram: ok, setCell: ok },
  groups: {
    enabled: true, busy: false,
    groups: [{ id: "g", name: "Group A", programKey: "sprinter", days: null, fatigue: null, isSeed: false, members: [{ riderId: "a", followsGroup: true }] }],
    create: ok, update: ok, remove: ok, putProgram: ok, setCell: ok, follow: ok, setFatigue: ok, reload: async () => {},
  },
  fatigueRules: { enabled: false },
  drafts: {}, onDrafts: noop, onClearRider: ok,
};

const renderComponent = (component: ReactElement) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, component));
const render = (mobile: boolean) => renderComponent(createElement(ProgramR5, {
    ...props, mobile,
    // This fixture exercises the flag-off view, which reads only fatigueRules.enabled.
    fatigueRules: props.fatigueRules as Props["fatigueRules"],
}));

test("#8608 no initial program selection or assignment on either layout", () => {
  for (const mobile of [false, true]) {
    const html = render(mobile);
    const copy = html.match(/<button[^>]*data-testid="program-r5-copy"[^>]*>/)?.[0];
    assert.ok(copy);
    assert.match(copy, /\bdisabled=""/);
    assert.doesNotMatch(html, /aria-pressed="true"|program-r5-add-target/);
  }
});

test("#8608 the desktop library includes the full catalog and direct membership actions", () => {
  const html = render(false);
  assert.match(html, />Climber</);
  assert.doesNotMatch(html, /All programs/);
  assert.match(html, /data-testid="program-r5-group-members"[^>]*>Members<\/button>/);
  assert.match(html, />Move to group<\/button>/);
  assert.match(html, />Add to group<\/button>/);
});

test("#8608 confirmation identifies the selected program and exact targets", () => {
  const common = { name: "Climber", busy: false, saving: false, actionId: "confirm", onClose: noop, onConfirm: noop };
  const forRiders = renderComponent(createElement(ProgramAssignmentConfirmation, {
    ...common, target: { riders: [{ id: "a", name: "Rider A" }, { id: "b", name: "Rider B" }] },
  }));
  assert.match(forRiders, /Apply Climber to 2 riders\?/);
  assert.match(forRiders, /<li>Rider A<\/li><li>Rider B<\/li>/);
  const forGroup = renderComponent(createElement(ProgramAssignmentConfirmation, {
    ...common, target: { group: "Group A" }, error: true,
  }));
  assert.match(forGroup, /Apply Climber to group Group A\?/);
  assert.match(forGroup, /role="alert"/);
  const confirmButton = forGroup.match(/<button[^>]*data-testid="confirm"[^>]*>/)?.[0];
  assert.ok(confirmButton);
  assert.doesNotMatch(confirmButton, /\bdisabled=""/);
});

test("#8608 the move dialog starts without a destination and displays a failed PATCH", () => {
  const html = renderComponent(createElement(MoveRiderDialog, {
    name: "Rider A", add: false, targets: props.groups.groups, busy: false, saving: false,
    error: true, onClose: noop, onMove: noop,
  }));
  assert.match(html, /<option value="" disabled="" selected="">Choose a group<\/option>/);
  assert.match(html, /<option value="g">Group A<\/option>/);
  assert.match(html.match(/<button[^>]*data-testid="program-r5-move-confirm"[^>]*>/)?.[0] ?? "", /\bdisabled=""/);
  assert.match(html, /role="alert"/);
});
