// #2960: e2e-webServer for Playwright — egen tynd server oven på sirv-BIBLIOTEKET,
// ikke sirv-cli. Review-runden 1/9 fandt tre kontrakt-brud i CLI'en som dette
// script genetablerer:
//   1. strictPort: server.listen() kaster EADDRINUSE højlydt. sirv-cli bruger
//      get-port og hopper STILLE til en fri naboport (og --quiet undertrykker
//      selv advarslen) — Playwright ville så polle en død port i 180s.
//   2. Ingen env-lytten: sirv-cli lader process.env.PORT/HOST overstyre
//      --port/--host-flagene; det bryder per-worktree-portisolationen i
//      playwright.ports.js (samme invariant som vite.config.js håndhæver:
//      "Vite læser ikke PORT automatisk"). Her læses KUN argv.
//   3. Cache-paritet med `vite preview` (som internt kører sirv med
//      { etag: true, dev: true }): gentagne chunk-requests får 304 i stedet
//      for fuld gen-overførsel på den CPU-pressede CI-runner.
// Worktree-id-filen (false-green-guarden) emittes af worktreeIdPlugin ved
// build og serveres her som almindelig statisk fil — én mekanisme, ét ejerskab.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";

const args = process.argv.slice(2);
const readFlag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const host = readFlag("--host");
const port = Number(readFlag("--port"));
if (!host || !Number.isInteger(port) || port <= 0) {
  console.error("e2e-static-server: kraever eksplicit --host <ip> --port <port> (ingen env-fallback, se kommentaren).");
  process.exit(1);
}

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(FRONTEND_ROOT, "dist");
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`e2e-static-server: ${DIST}\\index.html findes ikke — koer 'npm run build' foerst.`);
  process.exit(1);
}

const serve = sirv(DIST, { single: true, etag: true, dev: true });
const server = http.createServer(serve);
// Keep-alive-racet (maalt 1/9, run 33510693713): Node lukker idle keep-alive-
// sockets efter 5s (default). Genbruger browseren socketen i praecis dét
// vindue, hænger requesten for evigt (status -1) — set med BAADE vite preview
// og sirv paa den langsomme CI-runner, 1-2 tilfaeldige tests pr. koersel.
// 0 = luk aldrig idle sockets; ufarligt her, processen dræbes efter suiten.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`e2e-static-server: port ${port} er optaget (typisk en efterladt server fra et tidligere run — se playwright.ports.js). Fejler hoejlydt i stedet for at hoppe til en naboport.`);
  } else {
    console.error(`e2e-static-server: ${err.message}`);
  }
  process.exit(1);
});
server.listen(port, host);
