import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveAffectedRoutes,
  extractImportSpecifiers,
  resolveImport,
  MAX_ROUTES,
} from "./affected-routes.mjs";

const S = "frontend/src/";

function makeDeps(tree, routeMap) {
  return {
    listFiles: () => Object.keys(tree),
    readFile: (p) => {
      if (!(p in tree)) throw new Error("ENOENT");
      return tree[p];
    },
    routeMap: new Map(Object.entries(routeMap)),
  };
}

test("extractImportSpecifiers: static, export-from, dynamic, kommentarer og pakker", () => {
  const src = `
    import A from "./A.jsx";
    import { b } from '../lib/b';
    import "./side.css";
    export * from "./c";
    export { d } from "./d.js";
    const E = lazy(() => import("./E"));
    import React from "react";
    // import X from "./kommenteret";
  `;
  assert.deepEqual(
    extractImportSpecifiers(src).sort(),
    ["../lib/b", "./A.jsx", "./E", "./c", "./d.js", "./side.css"].sort()
  );
});

test("resolveImport: ext, index-fil og .js til .ts", () => {
  const set = new Set([`${S}a/x.jsx`, `${S}a/idx/index.js`, `${S}a/t.ts`]);
  assert.equal(resolveImport(`${S}a/p.jsx`, "./x", set), `${S}a/x.jsx`);
  assert.equal(resolveImport(`${S}a/p.jsx`, "./idx", set), `${S}a/idx/index.js`);
  assert.equal(resolveImport(`${S}a/p.jsx`, "./t.js", set), `${S}a/t.ts`);
  assert.equal(resolveImport(`${S}a/p.jsx`, "./mangler", set), null);
});

test("direkte side-fil giver sin rute", () => {
  const deps = makeDeps(
    { [`${S}pages/TrainingPage.jsx`]: "export default function T(){}" },
    { TrainingPage: "training" }
  );
  const r = deriveAffectedRoutes([`${S}pages/TrainingPage.jsx`], deps);
  assert.deepEqual(r.routes, ["training"]);
  assert.equal(r.fallback, false);
});

test("komponent to niveauer ned giver sidens rute", () => {
  const deps = makeDeps(
    {
      [`${S}pages/RidersPage.jsx`]: `import Table from "../components/Table.jsx";`,
      [`${S}components/Table.jsx`]: `import Cell from "./cells";`,
      [`${S}components/cells/index.js`]: `export const Cell = 1;`,
    },
    { RidersPage: "riders" }
  );
  const r = deriveAffectedRoutes([`${S}components/cells/index.js`], deps);
  assert.deepEqual(r.routes, ["riders"]);
  assert.equal(r.fallback, false);
});

test("cyklus i importgrafen hænger ikke og finder siden", () => {
  const deps = makeDeps(
    {
      [`${S}pages/TeamPage.jsx`]: `import A from "../components/A";`,
      [`${S}components/A.jsx`]: `import B from "./B";`,
      [`${S}components/B.jsx`]: `import A from "./A";`,
    },
    { TeamPage: "team" }
  );
  const r = deriveAffectedRoutes([`${S}components/B.jsx`], deps);
  assert.deepEqual(r.routes, ["team"]);
  assert.equal(r.fallback, false);
});

test("dybde over 4 giver fallback", () => {
  const tree = { [`${S}pages/DeepPage.jsx`]: `import a from "../c/a1";` };
  for (let i = 1; i <= 6; i++) {
    tree[`${S}c/a${i}.js`] = i < 6 ? `import n from "./a${i + 1}";` : "export const x = 1;";
  }
  const deps = makeDeps(tree, { DeepPage: "deep" });
  // a6 -> a5 -> a4 -> a3 -> a2 (4 niveauer) -> a1 -> side: for dybt
  const r = deriveAffectedRoutes([`${S}c/a6.js`], deps);
  assert.equal(r.fallback, true);
  assert.ok(r.reasons.some((x) => x.includes("dybere")));
  // en kæde på præcis 4 niveauer er stadig sikker
  const ok = deriveAffectedRoutes([`${S}c/a4.js`], deps);
  assert.deepEqual(ok.routes, ["deep"]);
  assert.equal(ok.fallback, false);
});

test("mere end 6 ruter klippes deterministisk og markeres fallback", () => {
  const tree = { [`${S}components/Shared.jsx`]: "export default 1;" };
  const map = {};
  for (let i = 0; i < 9; i++) {
    tree[`${S}pages/P${i}Page.jsx`] = `import S from "../components/Shared";`;
    map[`P${i}Page`] = `r${i}`;
  }
  const r = deriveAffectedRoutes([`${S}components/Shared.jsx`], makeDeps(tree, map));
  assert.equal(r.routes.length, MAX_ROUTES);
  assert.deepEqual(r.routes, [...r.routes].sort());
  assert.equal(r.fallback, true);
  const again = deriveAffectedRoutes([`${S}components/Shared.jsx`], makeDeps(tree, map));
  assert.deepEqual(again.routes, r.routes);
});

test("backend-only ændring giver ingen ruter og ingen fallback", () => {
  const r = deriveAffectedRoutes(
    ["backend/lib/x.js", "docs/NOW.md", "scripts/foo.mjs"],
    makeDeps({}, {})
  );
  assert.deepEqual(r.routes, []);
  assert.equal(r.fallback, false);
});

test("fil uden sti til en side giver fallback-liste", () => {
  const deps = makeDeps(
    {
      [`${S}lib/orphan.js`]: "export const o = 1;",
      [`${S}pages/DashboardPage.jsx`]: "export default 1;",
    },
    { DashboardPage: "dashboard" }
  );
  const r = deriveAffectedRoutes([`${S}lib/orphan.js`], deps);
  assert.equal(r.fallback, true);
  assert.deepEqual(r.routes, ["dashboard"]);
});

test("parse-fejl (readFile kaster) giver fallback", () => {
  const deps = makeDeps({ [`${S}pages/TeamPage.jsx`]: "x" }, { TeamPage: "team" });
  deps.readFile = () => {
    throw new Error("boom");
  };
  const r = deriveAffectedRoutes([`${S}pages/TeamPage.jsx`], deps);
  assert.equal(r.fallback, true);
  assert.ok(r.routes.includes("team"));
});

test("testfiler alene påvirker ingen sider", () => {
  const r = deriveAffectedRoutes([`${S}pages/TeamPage.test.js`], makeDeps({}, {}));
  assert.deepEqual(r.routes, []);
  assert.equal(r.fallback, false);
});

test("delt komponent der både når en side og app-skallen giver fallback", () => {
  const deps = makeDeps(
    {
      [`${S}components/Switcher.jsx`]: "export default 1;",
      [`${S}components/Layout.jsx`]: `import S from "./Switcher";`,
      [`${S}pages/ResetPasswordPage.jsx`]: `import S from "../components/Switcher";`,
      [`${S}pages/DashboardPage.jsx`]: "export default 1;",
    },
    { ResetPasswordPage: "reset-password", DashboardPage: "dashboard" }
  );
  const r = deriveAffectedRoutes([`${S}components/Switcher.jsx`], deps);
  assert.equal(r.fallback, true);
  assert.ok(r.routes.includes("reset-password"));
  assert.ok(r.routes.includes("dashboard"));
});

test("backend-modul importeret af en side giver siden; ren backend-fil giver intet", () => {
  const deps = makeDeps(
    { [`${S}pages/TeamPage.jsx`]: `import e from "../../../backend/lib/elig.js";` },
    { TeamPage: "team" }
  );
  const hit = deriveAffectedRoutes(["backend/lib/elig.js"], deps);
  assert.deepEqual(hit.routes, ["team"]);
  assert.equal(hit.fallback, false);
  const miss = deriveAffectedRoutes(["backend/lib/other.js"], deps);
  assert.deepEqual(miss.routes, []);
  assert.equal(miss.fallback, false);
});
